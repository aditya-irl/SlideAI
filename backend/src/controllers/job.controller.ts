import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db from '../db';
import { UPLOAD_DIR, PAGE_DIR, DIAGRAM_DIR } from '../config';
import { StorageService } from '../services/storageService';
import { UploadService } from '../services/uploadService';
import { PptService, BoardTheme, SlideLayout } from '../services/ppt.service';
import { triggerWorker, jobEvents, activeJobs } from '../queue';

export class JobController {
  /**
   * POST /upload
   * Receives files, creates jobId, saves files to disk, and inserts job metadata.
   */
  static uploadFiles(req: Request, res: Response): any {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded.' });
      }

      // Process files using UploadService
      const uploadResult = UploadService.processUpload(files);

      // Save job with 'pending' state initially to support autostart
      StorageService.createJob(uploadResult.jobId, uploadResult.originalName, uploadResult.totalPages);
      console.log(`[Job Controller] Job ${uploadResult.jobId} created successfully`);
      console.log(`[Job Controller] Job ${uploadResult.jobId} queued`);

      // Instantly launch background task processor
      triggerWorker();

      return res.status(200).json({
        jobId: uploadResult.jobId,
        name: uploadResult.originalName,
        message: 'Files uploaded successfully.'
      });
    } catch (error: any) {
      console.error('[Job Controller] uploadFiles error:', error.message);
      return res.status(500).json({ error: error.message || 'File upload failed.' });
    }
  }

  /**
   * POST /process
   * Starts or resumes the AI question extraction pipeline for a given jobId.
   */
  static processJob(req: Request, res: Response): any {
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
        console.log(`[Job Controller] Job ${jobId} set to pending, triggering worker...`);
        triggerWorker();
      }

      return res.status(200).json({
        jobId,
        status: 'pending',
        message: 'AI processing pipeline started.'
      });
    } catch (error: any) {
      console.error('[Job Controller] processJob error:', error.message);
      return res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /status/:jobId
   * Returns JSON status or triggers Server-Sent Events stream.
   */
  static getJobStatus(req: Request, res: Response): any {
    const jobId = req.params.jobId as string;
    const job = StorageService.getJob(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

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

    // Regular JSON response
    return res.status(200).json({
      jobId: job.id,
      name: job.name,
      status: job.status,
      progress: job.progress,
      total_pages: job.total_pages,
      processed_pages: job.processed_pages,
      error_message: job.error_message
    });
  }

  /**
   * GET /download/:jobId
   * Compiles the presentation from database records and initiates download transmission.
   */
  static async downloadPresentation(req: Request, res: Response): Promise<any> {
    try {
      const jobId = req.params.jobId as string;
      const job = StorageService.getJob(jobId);
      if (!job) {
        return res.status(404).json({ error: 'Job not found.' });
      }

      const theme = (req.query.theme as BoardTheme) || 'blackboard';
      const layout = (req.query.layout as SlideLayout) || 'question_only';
      const showGrid = req.query.showGrid !== 'false';
      const bookName = (req.query.bookName as string) || job.name.replace(/\.[^/.]+$/, "");

      const questions = StorageService.getQuestions(jobId);
      if (questions.length === 0) {
        return res.status(400).json({ error: 'No content slides compiled for this job.' });
      }

      const tempFileName = `ppt_${jobId}_${Date.now()}.pptx`;
      const tempFilePath = path.join(UPLOAD_DIR, tempFileName);

      console.log(`[Job Controller] Compiling presentation for Job ${jobId} on download request...`);
      
      await PptService.generatePresentation(jobId, questions, {
        bookName,
        theme,
        layout,
        showGrid
      }, tempFilePath);

      const safeTitle = bookName.replace(/[^a-zA-Z0-9]/g, '_');
      
      res.download(tempFilePath, `${safeTitle}.pptx`, (err) => {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
        if (err) {
          console.error('[Job Controller] Download compilation error:', err);
        }
      });
    } catch (error: any) {
      console.error('[Job Controller] downloadPresentation error:', error);
      return res.status(500).json({ error: error.message || 'PowerPoint generation failed.' });
    }
  }

  /**
   * POST /jobs/:jobId/cancel
   * Aborts a running pipeline and performs cleanups.
   */
  static cancelJob(req: Request, res: Response): any {
    try {
      const jobId = req.params.jobId as string;
      const job = StorageService.getJob(jobId);
      if (!job) {
        return res.status(404).json({ error: 'Job not found.' });
      }

      if (job.status === 'completed') {
        return res.status(400).json({ error: 'Cannot cancel a completed compilation.' });
      }

      if (job.status === 'cancelled') {
        return res.status(200).json({ jobId, message: 'Processing is already cancelled.' });
      }

      // Trigger AbortSignal
      const activeJob = activeJobs.get(jobId);
      if (activeJob) {
        console.log(`[Job Controller] Triggering Abort for Job: ${jobId}`);
        activeJob.abortController.abort();
      }

      StorageService.updateJobStatus(jobId, 'cancelled', job.progress, 'Processing Cancelled');

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
        console.error(`[Job Controller] Cleanup failed on cancellation:`, cleanErr.message);
      }

      if (activeJob) {
        activeJobs.delete(jobId);
      }

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
      console.error('[Job Controller] cancelJob error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // -------------------------------------------------------------
  // Jobs Management Controllers (mapping /api/jobs routes)
  // -------------------------------------------------------------

  static getJobsList(req: Request, res: Response): any {
    try {
      const jobs = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all();
      return res.status(200).json(jobs);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  static getJobDetail(req: Request, res: Response): any {
    try {
      const id = req.params.id as string;
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
      if (!job) {
        return res.status(404).json({ error: 'Job not found.' });
      }
      return res.status(200).json(job);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  static getQuestionsList(req: Request, res: Response): any {
    try {
      const id = req.params.id as string;
      const questions = db.prepare(`
        SELECT * FROM questions 
        WHERE job_id = ? 
        ORDER BY page_number ASC, order_index ASC
      `).all(id);
      
      const parsedQuestions = questions.map((q: any) => ({
        ...q,
        diagram_bbox: q.diagram_bbox ? JSON.parse(q.diagram_bbox) : null,
        question_bbox: q.question_bbox ? JSON.parse(q.question_bbox) : null,
      }));

      return res.status(200).json(parsedQuestions);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  static updateQuestions(req: Request, res: Response): any {
    const jobId = req.params.id as string;
    const { questions } = req.body;

    if (!Array.isArray(questions)) {
      return res.status(400).json({ error: 'Questions must be an array.' });
    }

    try {
      const transaction = db.transaction(() => {
        db.prepare('DELETE FROM questions WHERE job_id = ?').run(jobId);

        const insertStmt = db.prepare(`
          INSERT INTO questions (
            id, job_id, chapter, exercise, question_number, question_text, 
            latex_text, diagram_url, diagram_bbox, question_bbox, 
            page_number, order_index, status, confidence_score, feedback
          ) VALUES (
            ?, ?, ?, ?, ?, ?, 
            ?, ?, ?, ?, 
            ?, ?, ?, ?, ?
          )
        `);

        questions.forEach((q: any, index: number) => {
          insertStmt.run(
            q.id || crypto.randomUUID(),
            jobId,
            q.chapter || 'Chapter 1',
            q.exercise || 'Exercise 1.1',
            q.question_number || String(index + 1),
            q.question_text,
            q.latex_text || q.question_text,
            q.diagram_url || null,
            q.diagram_bbox ? JSON.stringify(q.diagram_bbox) : null,
            q.question_bbox ? JSON.stringify(q.question_bbox) : null,
            q.page_number || 1,
            index,
            q.status || 'verified',
            q.confidence_score !== undefined ? q.confidence_score : 1.0,
            q.feedback || null
          );
        });
      });

      transaction();
      
      db.prepare('UPDATE jobs SET updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), jobId);

      return res.status(200).json({ message: 'Questions updated successfully.' });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  static deleteJob(req: Request, res: Response): any {
    try {
      const id = req.params.id as string;
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
      if (!job) {
        return res.status(404).json({ error: 'Job not found.' });
      }

      db.prepare('DELETE FROM jobs WHERE id = ?').run(id);

      const pdfPath = path.join(UPLOAD_DIR, `${id}.pdf`);
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);

      const pagesDir = path.join(PAGE_DIR, id);
      if (fs.existsSync(pagesDir)) fs.rmSync(pagesDir, { recursive: true, force: true });

      const diagramsDir = path.join(DIAGRAM_DIR, id);
      if (fs.existsSync(diagramsDir)) fs.rmSync(diagramsDir, { recursive: true, force: true });

      return res.status(200).json({ message: 'Job deleted successfully.' });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  static serveDiagram(req: Request, res: Response): any {
    const id = req.params.id as string;
    const filename = req.params.filename as string;
    const filePath = path.join(DIAGRAM_DIR, id, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Diagram not found.' });
    }
    return res.sendFile(filePath);
  }

  static servePageImage(req: Request, res: Response): any {
    const id = req.params.id as string;
    const filename = req.params.filename as string;
    const filePath = path.join(PAGE_DIR, id, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Page image not found.' });
    }
    return res.sendFile(filePath);
  }

  static getPagesList(req: Request, res: Response): any {
    const id = req.params.id as string;
    const jobPagesDir = path.join(PAGE_DIR, id);
    if (!fs.existsSync(jobPagesDir)) {
      return res.status(200).json([]);
    }
    try {
      const files = fs.readdirSync(jobPagesDir)
        .filter(file => file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      return res.status(200).json(files);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  static getProgressSse(req: Request, res: Response): any {
    const id = req.params.id as string;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
    if (job) {
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
    }

    const onProgress = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (data.status === 'completed' || data.status === 'failed') {
        res.end();
      }
    };

    jobEvents.on(`progress:${id}`, onProgress);
    req.on('close', () => {
      jobEvents.off(`progress:${id}`, onProgress);
    });
  }
}
