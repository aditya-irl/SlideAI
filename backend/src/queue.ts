import { convertPdfToImages } from './pdf';
import { ImageService } from './services/image.service';
import { OcrService } from './services/ocr.service';
import { GeminiService } from './services/gemini.service';
import { StorageService, Job } from './services/storageService';
import { PptService } from './services/ppt.service';
import { UPLOAD_DIR } from './config';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

// Global Event Emitter for SSE progress tracking
export const jobEvents = new EventEmitter();

// Global map to track active AbortControllers and their associated temp directories/files
export const activeJobs = new Map<string, {
  abortController: AbortController;
  tempDirectories: string[];
}>();

let isWorkerRunning = false;

/**
 * Enqueues a new PDF/image processing job.
 */
export function enqueueJob(id: string, name: string) {
  console.log(`[Queue Manager] Job created: ${id}`);
  StorageService.createJob(id, name, 0);
  console.log(`[Queue Manager] Job queued: ${id}`);
  
  // Trigger worker process immediately in the background
  triggerWorker();
}

/**
 * Starts the worker loop if not already running.
 */
export function triggerWorker() {
  if (isWorkerRunning) {
    console.log('[Queue Worker] Worker trigger requested, but worker is already running.');
    return;
  }
  isWorkerRunning = true;
  console.log('[Queue Worker] Worker started processing jobs...');
  
  runWorker()
    .catch((err) => {
      console.error('[Queue Worker] Global worker failure:', err);
    })
    .finally(() => {
      console.log('[Queue Worker] Worker idle, loop terminated.');
      isWorkerRunning = false;
    });
}

/**
 * Main worker loop that fetches and processes pending jobs sequentially.
 */
async function runWorker() {
  while (true) {
    const job = dbGetNextPendingJob();
    if (!job) {
      break;
    }

    console.log(`[Queue Worker] Starting job: ${job.id} (${job.name})`);
    
    // Register active abort controller for the job
    const abortController = new AbortController();
    const tempDirs = [
      path.join(UPLOAD_DIR, 'pages', job.id),
      path.join(UPLOAD_DIR, 'preprocessed', job.id),
      path.join(UPLOAD_DIR, 'diagrams', job.id)
    ];
    activeJobs.set(job.id, { abortController, tempDirectories: tempDirs });
    const { signal } = abortController;

    try {
      if (signal.aborted) {
        throw new Error('cancelled');
      }

      // 1. Mark job as processing
      StorageService.updateJobStatus(job.id, 'processing', 5);
      emitProgress(job.id, 'processing', 5, 0, 0);

      const pdfPath = path.join(UPLOAD_DIR, `${job.id}.pdf`);
      
      let renderedPages;
      let totalPages = 0;

      // Check if this was a PDF upload
      if (fs.existsSync(pdfPath)) {
        console.log(`[Queue Worker] PDF rendering started for job: ${job.id}`);
        try {
          renderedPages = await convertPdfToImages(pdfPath, job.id);
          totalPages = renderedPages.length;
          console.log(`[Queue Worker] PDF rendering completed for job: ${job.id}. Total pages: ${totalPages}`);
        } catch (pdfErr: any) {
          console.error(`[Queue Worker] PDF rendering failed for job ${job.id}:`, pdfErr);
          throw new Error(`PDF rendering failed: ${pdfErr.message || pdfErr}`);
        }
      } else {
        // Handle image page collections
        const jobPagesDir = path.join(UPLOAD_DIR, 'pages', job.id);
        if (!fs.existsSync(jobPagesDir)) {
          throw new Error('Upload files not found on disk.');
        }

        const files = fs.readdirSync(jobPagesDir)
          .filter(f => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg'))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        
        renderedPages = files.map((file, idx) => ({
          pageNumber: idx + 1,
          filePath: path.join(jobPagesDir, file),
          width: 0,
          height: 0
        }));
        totalPages = renderedPages.length;
        console.log(`[Queue Worker] Image pages conversion completed. Total pages: ${totalPages}`);
      }

      if (signal.aborted) {
        throw new Error('cancelled');
      }

      // Update total pages counts
      StorageService.updateJobStatus(job.id, 'processing', 15);
      dbUpdateTotalPages(job.id, totalPages);
      emitProgress(job.id, 'processing', 15, totalPages, 0);

      const preprocessedDir = path.join(UPLOAD_DIR, 'preprocessed', job.id);
      if (!fs.existsSync(preprocessedDir)) {
        fs.mkdirSync(preprocessedDir, { recursive: true });
      }

      console.log(`[Queue Worker] Starting parallel OpenCV preprocessing and OCR for ${totalPages} pages...`);

      // Run parallel preprocessing and OCR for all pages
      const pageTexts: string[] = new Array(totalPages);
      const ocrPromises = renderedPages.map(async (page, index) => {
        if (signal.aborted) return;

        const filename = path.basename(page.filePath);
        const preprocessedPath = path.join(preprocessedDir, filename);

        // A. Run OpenCV image filtering (Binarization, Deskew, Sharpen)
        try {
          await ImageService.preprocessImage(page.filePath, preprocessedPath);
        } catch (prepErr: any) {
          console.warn(`[Queue Worker] OpenCV Preprocessing failed for Page ${page.pageNumber}, falling back to original:`, prepErr.message);
          fs.copyFileSync(page.filePath, preprocessedPath); // Fallback to raw copy if OpenCV fails
        }

        if (signal.aborted) return;

        // B. Run cached OCR extraction
        const pageText = await OcrService.extractText(preprocessedPath);
        pageTexts[index] = `--- PAGE ${page.pageNumber} ---\n${pageText}`;

        // C. Emit granular page progress updates
        const pageProgress = Math.min(80, Math.round(15 + ((index + 1) / totalPages) * 55));
        StorageService.updateJobProgress(job.id, page.pageNumber, pageProgress);
        emitProgress(job.id, 'processing', pageProgress, totalPages, page.pageNumber);
        
        console.log(`[Queue Worker] Successfully processed page ${page.pageNumber}/${totalPages}`);
      });

      // Await all parallel OCR routines
      await Promise.all(ocrPromises);

      if (signal.aborted) {
        throw new Error('cancelled');
      }

      // 3. Merge all page text contents into one document
      const mergedText = pageTexts.filter(Boolean).join('\n\n');
      console.log(`[Queue Worker] Document merging complete. Merged character length: ${mergedText.length}`);

      if (!mergedText.trim()) {
        throw new Error('OCR failed to extract any readable text from the uploaded pages.');
      }

      // 4. Single Gemini API compilation request (reduce model usage >90%)
      StorageService.updateJobStatus(job.id, 'processing', 85);
      emitProgress(job.id, 'processing', 85, totalPages, totalPages);

      console.log('[Queue Worker] Invoking single-request Gemini text-to-slide compiler...');
      const presentation = await GeminiService.compilePresentation(mergedText, signal);

      if (signal.aborted) {
        throw new Error('cancelled');
      }

      // 5. Map presentation slides JSON objects to SQLite database questions schema
      const presentationTitle = presentation.title || job.name.replace(/\.[^/.]+$/, "");
      const dbSlides = presentation.slides.map((slide, index) => ({
        id: crypto.randomUUID(),
        chapter: presentationTitle, // Mapped to overall deck title
        exercise: slide.title,       // Mapped to Slide Title
        question_number: String(index + 1),
        question_text: slide.bullets.join('\n'), // Bullet points split by newline
        latex_text: slide.speakerNotes || "",    // Mapped to Speaker Notes
        diagram_url: null,
        diagram_bbox: null,
        question_bbox: null,
        page_number: 1,
        status: 'verified',
        feedback: slide.imageSuggestion || ""    // Mapped to visual suggestions
      }));

      StorageService.saveQuestions(job.id, dbSlides);

      if (signal.aborted) {
        throw new Error('cancelled');
      }

      // 6. Pre-generate editable presentation on server
      StorageService.updateJobStatus(job.id, 'processing', 95);
      emitProgress(job.id, 'processing', 95, totalPages, totalPages);

      console.log('[Queue Worker] Initiating slide PPTX file compilation...');
      const generatedFilePath = path.join(UPLOAD_DIR, `${job.id}.pptx`);

      try {
        await PptService.generatePresentation(job.id, dbSlides, {
          bookName: presentationTitle,
          theme: 'blackboard',
          layout: 'question_only',
          showGrid: true
        }, generatedFilePath);
      } catch (pptErr: any) {
        console.error(`[Queue Worker] PPT compilation failed for job ${job.id}:`, pptErr);
        throw new Error(`PowerPoint compilation failed: ${pptErr.message || pptErr}`);
      }

      // 7. Complete job execution
      StorageService.updateJobStatus(job.id, 'completed', 100);
      emitProgress(job.id, 'completed', 100, totalPages, totalPages);
      console.log(`[Queue Worker] Presentation compilation complete for Job ${job.id}`);

    } catch (jobErr: any) {
      const isCancelled = signal.aborted || jobErr.message === 'cancelled' || jobErr.name === 'AbortError';
      const finalStatus = isCancelled ? 'cancelled' : 'failed';
      const errMsg = isCancelled ? 'Processing Cancelled' : (jobErr.message || 'Unknown processing error');
      
      console.error(`[Queue Worker] Job failed for job: ${job.id}. Error: ${errMsg}`);
      
      StorageService.updateJobStatus(job.id, finalStatus, 100, errMsg);
      emitProgress(job.id, finalStatus, 100, 0, 0, errMsg);
      
      // Cleanup staging directories
      try {
        const jobPagesDir = path.join(UPLOAD_DIR, 'pages', job.id);
        const jobPreDir = path.join(UPLOAD_DIR, 'preprocessed', job.id);
        const jobDiagDir = path.join(UPLOAD_DIR, 'diagrams', job.id);
        if (fs.existsSync(jobPagesDir)) fs.rmSync(jobPagesDir, { recursive: true, force: true });
        if (fs.existsSync(jobPreDir)) fs.rmSync(jobPreDir, { recursive: true, force: true });
        if (fs.existsSync(jobDiagDir)) fs.rmSync(jobDiagDir, { recursive: true, force: true });
        
        const pdfPath = path.join(UPLOAD_DIR, `${job.id}.pdf`);
        if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
        
        const pptPath = path.join(UPLOAD_DIR, `${job.id}.pptx`);
        if (fs.existsSync(pptPath)) fs.unlinkSync(pptPath);
      } catch (cleanErr: any) {
        console.error(`[Queue Worker] Cleanup error on cancellation/failure:`, cleanErr.message);
      }
    } finally {
      activeJobs.delete(job.id);
    }
  }
}

/**
 * Helpers for SQLite mapping to dodge circular import compilation errors
 */
import db from './db';

function dbGetNextPendingJob() {
  return db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1").get() as Job | undefined;
}

function dbUpdateTotalPages(id: string, count: number) {
  db.prepare("UPDATE jobs SET total_pages = ? WHERE id = ?").run(count, id);
}

function emitProgress(
  id: string, 
  status: string, 
  progress: number, 
  totalPages: number, 
  processedPages: number, 
  errorMsg: string | null = null
) {
  jobEvents.emit(`progress:${id}`, {
    id,
    status,
    progress,
    total_pages: totalPages,
    processed_pages: processedPages,
    error_message: errorMsg
  });
}

/**
 * Validator mapping duplicate checking and sequence gap highlights
 */
function runSequenceValidation(questions: any[]) {
  const seenTexts = new Set<string>();
  
  questions.forEach((q, index) => {
    const issues: string[] = [];
    const cleanText = q.question_text.trim().toLowerCase();

    // Check duplicate
    if (seenTexts.has(cleanText)) {
      issues.push('Possible duplicate question text.');
    } else {
      seenTexts.add(cleanText);
    }

    // Sequence checks
    if (index > 0) {
      const prevQ = questions[index - 1];
      const prevNum = parseInt(prevQ.question_number, 10);
      const currNum = parseInt(q.question_number, 10);

      if (!isNaN(prevNum) && !isNaN(currNum) && q.exercise === prevQ.exercise) {
        if (currNum > prevNum + 1) {
          issues.push(`Gap in sequencing detected. Jumps from ${prevNum} to ${currNum}.`);
        }
      }
    }

    if (issues.length > 0) {
      q.status = 'flagged';
      q.feedback = issues.join(' ');
    }
  });
}
