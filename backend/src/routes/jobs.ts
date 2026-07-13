import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db from '../db';
import { UPLOAD_DIR, PAGE_DIR, DIAGRAM_DIR } from '../config';
import { jobEvents } from '../queue';

const router = Router();

// 1. Get all jobs
router.get('/', (req: Request, res: Response): any => {
  try {
    const jobs = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all();
    return res.status(200).json(jobs);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 2. Get specific job metadata
router.get('/:id', (req: Request, res: Response): any => {
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
});

// 3. Get questions for a specific job
router.get('/:id/questions', (req: Request, res: Response): any => {
  try {
    const id = req.params.id as string;
    const questions = db.prepare(`
      SELECT * FROM questions 
      WHERE job_id = ? 
      ORDER BY page_number ASC, order_index ASC
    `).all(id);
    
    // Parse JSON strings back to objects for the client
    const parsedQuestions = questions.map((q: any) => ({
      ...q,
      diagram_bbox: q.diagram_bbox ? JSON.parse(q.diagram_bbox) : null,
      question_bbox: q.question_bbox ? JSON.parse(q.question_bbox) : null,
    }));

    return res.status(200).json(parsedQuestions);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 4. Bulk update questions for a specific job (supports edits, splits, merges, reorders)
router.put('/:id/questions', (req: Request, res: Response): any => {
  const jobId = req.params.id as string;
  const { questions } = req.body;

  if (!Array.isArray(questions)) {
    return res.status(400).json({ error: 'Questions must be an array.' });
  }

  try {
    // Start SQLite Transaction to ensure atomic update
    const transaction = db.transaction(() => {
      // Delete old questions
      db.prepare('DELETE FROM questions WHERE job_id = ?').run(jobId);

      // Insert updated questions
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
          index, // use array order as new order_index
          q.status || 'verified',
          q.confidence_score !== undefined ? q.confidence_score : 1.0,
          q.feedback || null
        );
      });
    });

    transaction();
    
    // Update job updated_at timestamp
    db.prepare('UPDATE jobs SET updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), jobId);

    return res.status(200).json({ message: 'Questions updated successfully.' });
  } catch (error: any) {
    console.error('[Jobs Route PUT Error]', error);
    return res.status(500).json({ error: error.message });
  }
});

// 5. Delete a job and all its assets
router.delete('/:id', (req: Request, res: Response): any => {
  try {
    const id = req.params.id as string;
    
    // Fetch job details first
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    // 1. Delete DB entries (foreign keys ON DELETE CASCADE handles questions)
    db.prepare('DELETE FROM jobs WHERE id = ?').run(id);

    // 2. Delete PDF upload file
    const pdfPath = path.join(UPLOAD_DIR, `${id}.pdf`);
    if (fs.existsSync(pdfPath)) {
      fs.unlinkSync(pdfPath);
    }

    // 3. Delete rendered pages directory
    const pagesDir = path.join(PAGE_DIR, id);
    if (fs.existsSync(pagesDir)) {
      fs.rmSync(pagesDir, { recursive: true, force: true });
    }

    // 4. Delete cropped diagrams directory
    const diagramsDir = path.join(DIAGRAM_DIR, id);
    if (fs.existsSync(diagramsDir)) {
      fs.rmSync(diagramsDir, { recursive: true, force: true });
    }

    return res.status(200).json({ message: 'Job and associated assets deleted successfully.' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 6. Serve cropped diagrams securely
router.get('/:id/diagrams/:filename', (req: Request, res: Response): any => {
  const id = req.params.id as string;
  const filename = req.params.filename as string;
  const filePath = path.join(DIAGRAM_DIR, id, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Diagram not found.' });
  }
  
  return res.sendFile(filePath);
});

// 7. Serve high-res page images securely
router.get('/:id/pages/:filename', (req: Request, res: Response): any => {
  const id = req.params.id as string;
  const filename = req.params.filename as string;
  
  // Find standard files (like page_1.png or document_page_1.png)
  const jobPagesDir = path.join(PAGE_DIR, id);
  const filePath = path.join(jobPagesDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Page image not found.' });
  }

  return res.sendFile(filePath);
});

// 8. Get list of actual page files in rendered pages (to map filenames on the frontend)
router.get('/:id/pages', (req: Request, res: Response): any => {
  const id = req.params.id as string;
  const jobPagesDir = path.join(PAGE_DIR, id);

  if (!fs.existsSync(jobPagesDir)) {
    return res.status(200).json([]);
  }

  try {
    const files = fs.readdirSync(jobPagesDir)
      .filter(file => file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg'))
      .sort((a, b) => {
        // Natural sort of filenames (e.g. page_1 before page_10)
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      });

    return res.status(200).json(files);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 9. SSE stream for real-time progress tracking
router.get('/:id/progress', (req: Request, res: Response): any => {
  const id = req.params.id as string;
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Send current status immediately
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

  // Define callback
  const onProgress = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (data.status === 'completed' || data.status === 'failed') {
      res.end();
    }
  };

  // Listen to emitter
  jobEvents.on(`progress:${id}`, onProgress);

  // Clean up on connection close
  req.on('close', () => {
    jobEvents.off(`progress:${id}`, onProgress);
  });
});

export default router;
