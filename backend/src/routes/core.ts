import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { UPLOAD_DIR } from '../config';
import { UploadService } from '../services/uploadService';
import { StorageService } from '../services/storageService';
import { PptService, BoardTheme, SlideLayout } from '../services/pptService';
import { triggerWorker, jobEvents, activeJobs } from '../queue';

const router = Router();

// Multar config for temporary file storage
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB max limit
});

/**
 * 1. POST /upload
 * Receives files, creates jobId, saves files to disk, and inserts job metadata.
 */
router.post('/upload', upload.array('files'), (req: Request, res: Response): any => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded.' });
    }

    // Process files using UploadService
    const uploadResult = UploadService.processUpload(files);

    // Save job with 'pending' state initially to support autostart, or 'uploaded'
    StorageService.createJob(uploadResult.jobId, uploadResult.originalName, uploadResult.totalPages);

    return res.status(200).json({
      jobId: uploadResult.jobId,
      name: uploadResult.originalName,
      message: 'Files uploaded successfully.'
    });
  } catch (error: any) {
    console.error('[Core Routes] POST /upload error:', error.message);
    return res.status(500).json({ error: error.message || 'File upload failed.' });
  }
});

/**
 * 2. POST /process
 * Starts the AI question extraction pipeline for a given jobId.
 */
router.post('/process', (req: Request, res: Response): any => {
  try {
    const { jobId } = req.body;
    if (!jobId) {
      return res.status(400).json({ error: 'Missing jobId parameter.' });
    }

    const job = StorageService.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    // Update status to pending (if not already processing or complete)
    if (job.status !== 'processing' && job.status !== 'completed') {
      StorageService.updateJobStatus(jobId, 'pending', 0);
      console.log(`[Core Routes] Job ${jobId} set to pending, triggering worker...`);
      triggerWorker();
    }

    return res.status(200).json({
      jobId,
      status: 'pending',
      message: 'AI processing pipeline started.'
    });
  } catch (error: any) {
    console.error('[Core Routes] POST /process error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 3. GET /status/:jobId
 * Returns JSON status, or Server-Sent Events progress stream if requested.
 */
router.get('/status/:jobId', (req: Request, res: Response): any => {
  const jobId = req.params.jobId as string;

  const job = StorageService.getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  // Check if client is requesting a Server-Sent Events stream
  const acceptHeader = req.headers.accept || '';
  if (acceptHeader.includes('text/event-stream')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send initial status tick
    res.write(`data: ${JSON.stringify({
      id: job.id,
      status: job.status,
      progress: job.progress,
      total_pages: job.total_pages,
      processed_pages: job.processed_pages,
      error_message: job.error_message
    })}\n\n`);

    if (job.status === 'completed' || job.status === 'failed') {
      res.end();
      return;
    }

    const onProgress = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (data.status === 'completed' || data.status === 'failed') {
        res.end();
      }
    };

    jobEvents.on(`progress:${jobId}`, onProgress);

    req.on('close', () => {
      jobEvents.off(`progress:${jobId}`, onProgress);
    });
    return;
  }

  // Regular JSON status response
  return res.status(200).json({
    jobId: job.id,
    name: job.name,
    status: job.status,
    progress: job.progress,
    total_pages: job.total_pages,
    processed_pages: job.processed_pages,
    error_message: job.error_message
  });
});

/**
 * 4. GET /download/:jobId
 * Generates and downloads the PowerPoint presentation deck.
 */
router.get('/download/:jobId', async (req: Request, res: Response): Promise<any> => {
  try {
    const jobId = req.params.jobId as string;
    const job = StorageService.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    // Get query parameters for slide customization (Teacher Mode)
    const theme = (req.query.theme as BoardTheme) || 'blackboard';
    const layout = (req.query.layout as SlideLayout) || 'question_only';
    const showGrid = req.query.showGrid !== 'false';
    const bookName = (req.query.bookName as string) || job.name.replace(/\.[^/.]+$/, "");

    // Fetch latest questions from DB
    const questions = StorageService.getQuestions(jobId);
    if (questions.length === 0) {
      return res.status(400).json({ error: 'No questions available for this presentation.' });
    }

    const tempFileName = `ppt_${jobId}_${Date.now()}.pptx`;
    const tempFilePath = path.join(UPLOAD_DIR, tempFileName);

    console.log(`[Core Routes] Generating PowerPoint for Job ${jobId}...`);
    
    // Generate presentation on disk
    await PptService.generatePresentation(jobId, questions, {
      bookName,
      theme,
      layout,
      showGrid
    }, tempFilePath);

    // Stream download back to client
    const safeTitle = bookName.replace(/[^a-zA-Z0-9]/g, '_') || 'presentation';
    res.download(tempFilePath, `${safeTitle}.pptx`, (err) => {
      // Clean up temp file on completion
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      if (err) {
        console.error('[Core Routes] Download transmission error:', err);
      }
    });
  } catch (error: any) {
    console.error('[Core Routes] GET /download error:', error);
    return res.status(500).json({ error: error.message || 'PowerPoint generation failed.' });
  }
});

/**
 * 5. POST /jobs/:jobId/cancel
 * Aborts a running job immediately and cleans up all staged file assets.
 */
router.post('/jobs/:jobId/cancel', (req: Request, res: Response): any => {
  try {
    const jobId = req.params.jobId as string;
    const job = StorageService.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    if (job.status === 'completed') {
      return res.status(400).json({ error: 'Cannot cancel a completed presentation compile.' });
    }

    if (job.status === 'cancelled') {
      return res.status(200).json({ jobId, message: 'Processing is already cancelled.' });
    }

    // Trigger AbortSignal to interrupt loops and Gemini network requests
    const activeJob = activeJobs.get(jobId);
    if (activeJob) {
      console.log(`[Cancel API] Triggering abort for job: ${jobId}`);
      activeJob.abortController.abort();
    }

    // Update job status in database
    StorageService.updateJobStatus(jobId, 'cancelled', job.progress, 'Processing Cancelled');

    // Perform filesystem cleanup of temporary folders
    try {
      const jobPagesDir = path.join(UPLOAD_DIR, 'pages', jobId);
      const jobDiagDir = path.join(UPLOAD_DIR, 'diagrams', jobId);
      if (fs.existsSync(jobPagesDir)) fs.rmSync(jobPagesDir, { recursive: true, force: true });
      if (fs.existsSync(jobDiagDir)) fs.rmSync(jobDiagDir, { recursive: true, force: true });
      
      const pdfPath = path.join(UPLOAD_DIR, `${jobId}.pdf`);
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
      
      const pptPath = path.join(UPLOAD_DIR, `${jobId}.pptx`);
      if (fs.existsSync(pptPath)) fs.unlinkSync(pptPath);
    } catch (cleanErr: any) {
      console.error(`[Cancel API] File cleanup failed:`, cleanErr.message);
    }

    if (activeJob) {
      activeJobs.delete(jobId);
    }

    // Push immediate status update over Server-Sent Events (SSE) channel
    jobEvents.emit(`progress:${jobId}`, {
      id: jobId,
      status: 'cancelled',
      progress: job.progress,
      total_pages: job.total_pages,
      processed_pages: job.processed_pages,
      error_message: 'Processing Cancelled'
    });

    return res.status(200).json({
      jobId,
      status: 'cancelled',
      message: 'Processing cancelled successfully.'
    });
  } catch (error: any) {
    console.error('[Cancel API] Failed to cancel job:', error);
    return res.status(500).json({ error: error.message || 'Cancellation failed.' });
  }
});

export default router;
