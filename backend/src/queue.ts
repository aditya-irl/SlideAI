import { convertPdfToImages } from './pdf';
import { GeminiService } from './services/geminiService';
import { StorageService, Job } from './services/storageService';
import { PptService } from './services/pptService';
import { getMathpixOCR, isMathpixConfigured } from './mathpix';
import { cropDiagram } from './image';
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
 * Enqueues a new PDF processing job.
 */
export function enqueueJob(id: string, name: string) {
  StorageService.createJob(id, name, 0);
  
  // Trigger worker process immediately in the background
  triggerWorker();
}

/**
 * Starts the worker loop if not already running.
 */
export function triggerWorker() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;
  
  runWorker()
    .catch((err) => {
      console.error('[Queue Worker] Global worker failure:', err);
    })
    .finally(() => {
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
        console.log(`[Queue Worker] Rendering PDF pages to high-res images...`);
        renderedPages = await convertPdfToImages(pdfPath, job.id);
        totalPages = renderedPages.length;
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
      }

      if (signal.aborted) {
        throw new Error('cancelled');
      }

      // Update total pages counts
      StorageService.updateJobStatus(job.id, 'processing', 20);
      dbUpdateTotalPages(job.id, totalPages);
      emitProgress(job.id, 'processing', 20, totalPages, 0);

      console.log(`[Queue Worker] Starting AI OCR and diagram split analysis...`);

      const allQuestions: any[] = [];
      let currentChapter = '';
      let currentExercise = '';

      // 3. Process each page sequentially
      for (let i = 0; i < totalPages; i++) {
        const page = renderedPages[i];
        
        if (signal.aborted) {
          throw new Error('cancelled');
        }

        console.log(`[Queue Worker] Processing page ${page.pageNumber}/${totalPages}...`);

        // Update progress metric
        const pageProgress = Math.min(95, Math.round(20 + (i / totalPages) * 70));
        StorageService.updateJobProgress(job.id, page.pageNumber, pageProgress);
        emitProgress(job.id, 'processing', pageProgress, totalPages, page.pageNumber);

        let mathpixText: string | undefined;

        // Mathpix math OCR extraction (if credentials present)
        if (isMathpixConfigured()) {
          try {
            mathpixText = await getMathpixOCR(page.filePath);
          } catch (err: any) {
            console.warn(`[Queue Worker] Mathpix failed on page ${page.pageNumber}, falling back to Gemini:`, err.message);
          }
        }

        if (signal.aborted) {
          throw new Error('cancelled');
        }

        // Segment page text & diagrams using Google Gemini 3.5 Flash (with abort signal)
        let analysis;
        try {
          analysis = await GeminiService.analyzePageImage(page.filePath, page.pageNumber, mathpixText, 3, signal);
        } catch (ocrErr: any) {
          if (signal.aborted || ocrErr.name === 'AbortError' || ocrErr.message === 'cancelled') {
            throw new Error('cancelled');
          }

          console.error(`[Queue Worker] Gemini failed on page ${page.pageNumber}:`, ocrErr.message);
          // Insert placeholder slide on parsing failure
          allQuestions.push({
            id: crypto.randomUUID(),
            chapter: currentChapter || 'Chapter 1',
            exercise: currentExercise || 'Exercise 1.1',
            question_number: 'ERR',
            question_text: `Failed to analyze page ${page.pageNumber} automatically. Please check your keys or edit this slide manually.`,
            latex_text: `\\text{OCR failed on page } ${page.pageNumber}`,
            page_number: page.pageNumber,
            status: 'flagged',
            feedback: ocrErr.message || 'Page analysis error.'
          });
          continue;
        }

        if (signal.aborted) {
          throw new Error('cancelled');
        }

        // Sync chapters/exercises metadata
        if (analysis.chapter) currentChapter = analysis.chapter;
        if (analysis.exercise) currentExercise = analysis.exercise;

        // Parse individual questions
        for (const q of analysis.questions) {
          let diagramUrl: string | null = null;

          // Crop diagram image using sharp if detected
          if (q.hasDiagram && q.diagram_bbox) {
            console.log(`[Queue Worker] Cropping geometry figure for Q${q.number}...`);
            const crop = await cropDiagram(page.filePath, job.id, page.pageNumber, q.number, q.diagram_bbox);
            if (crop) {
              diagramUrl = `/api/jobs/${job.id}/diagrams/${crop.fileName}`;
            }
          }

          allQuestions.push({
            id: crypto.randomUUID(),
            chapter: currentChapter || 'Chapter 1',
            exercise: currentExercise || 'Exercise 1.1',
            question_number: q.number,
            question_text: q.text,
            latex_text: q.latex_text || q.text,
            diagram_url: diagramUrl,
            diagram_bbox: q.diagram_bbox,
            question_bbox: q.question_bbox,
            page_number: page.pageNumber,
            status: 'pending_review'
          });
        }
      }

      if (signal.aborted) {
        throw new Error('cancelled');
      }

      // 4. Run Sequential numbering and duplicate checks (smart validation)
      console.log(`[Queue Worker] Running validator checks across ${allQuestions.length} questions...`);
      runSequenceValidation(allQuestions);

      // 5. Store questions in database
      StorageService.saveQuestions(job.id, allQuestions);

      if (signal.aborted) {
        throw new Error('cancelled');
      }

      // 6. Pre-generate the default Blackboard PPTX presentation
      console.log(`[Queue Worker] Pre-generating editable PowerPoint presentation...`);
      const generatedFilePath = path.join(UPLOAD_DIR, `${job.id}.pptx`);
      
      const formattedSlides = allQuestions.map(q => ({
        chapter: q.chapter,
        exercise: q.exercise,
        question_number: q.question_number,
        question_text: q.question_text,
        diagram_url: q.diagram_url,
        page_number: q.page_number
      }));

      await PptService.generatePresentation(job.id, formattedSlides, {
        bookName: job.name.replace(/\.[^/.]+$/, ""),
        theme: 'blackboard',
        layout: 'question_only',
        showGrid: true
      }, generatedFilePath);

      // 7. Complete job execution
      StorageService.updateJobStatus(job.id, 'completed', 100);
      emitProgress(job.id, 'completed', 100, totalPages, totalPages);
      console.log(`[Queue Worker] Presentation compilation complete for ${job.id}`);

    } catch (jobErr: any) {
      console.error(`[Queue Worker] Job execution failed or aborted:`, jobErr.message);
      
      const isCancelled = signal.aborted || jobErr.message === 'cancelled' || jobErr.name === 'AbortError';
      const finalStatus = isCancelled ? 'cancelled' : 'failed';
      const errMsg = isCancelled ? 'Processing Cancelled' : (jobErr.message || 'Unknown processing error');
      
      StorageService.updateJobStatus(job.id, finalStatus, 100, errMsg);
      emitProgress(job.id, finalStatus, 100, 0, 0, errMsg);
      
      // Strict cancellation cleanup: ensure no orphan temporary files remain
      try {
        const jobPagesDir = path.join(UPLOAD_DIR, 'pages', job.id);
        const jobDiagDir = path.join(UPLOAD_DIR, 'diagrams', job.id);
        if (fs.existsSync(jobPagesDir)) fs.rmSync(jobPagesDir, { recursive: true, force: true });
        if (fs.existsSync(jobDiagDir)) fs.rmSync(jobDiagDir, { recursive: true, force: true });
        
        const pdfPath = path.join(UPLOAD_DIR, `${job.id}.pdf`);
        if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
        
        const pptPath = path.join(UPLOAD_DIR, `${job.id}.pptx`);
        if (fs.existsSync(pptPath)) fs.unlinkSync(pptPath);
      } catch (cleanErr: any) {
        console.error(`[Queue Worker] Cleanup error on cancellation:`, cleanErr.message);
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
