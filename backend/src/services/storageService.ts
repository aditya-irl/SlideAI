import db from '../db';
import crypto from 'crypto';

export interface Job {
  id: string;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  total_pages: number;
  processed_pages: number;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Question {
  id: string;
  job_id: string;
  chapter: string;
  exercise: string;
  question_number: string;
  question_text: string;
  latex_text?: string | null;
  diagram_url?: string | null;
  diagram_bbox?: string | null;
  question_bbox?: string | null;
  page_number: number;
  order_index: number;
  status: string;
}

export class StorageService {
  /**
   * Creates a new job entry.
   */
  static createJob(id: string, name: string, totalPages = 0): void {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO jobs (id, name, status, progress, total_pages, processed_pages, created_at, updated_at)
      VALUES (?, ?, 'pending', 0, ?, 0, ?, ?)
    `).run(id, name, totalPages, now, now);
  }

  /**
   * Fetches a job by ID.
   */
  static getJob(id: string): Job | null {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job | undefined;
    return job || null;
  }

  /**
   * Fetches all jobs.
   */
  static getAllJobs(): Job[] {
    return db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as Job[];
  }

  /**
   * Updates job status and percentage progress.
   */
  static updateJobStatus(id: string, status: string, progress: number, errorMessage: string | null = null): void {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE jobs 
      SET status = ?, progress = ?, error_message = ?, updated_at = ? 
      WHERE id = ?
    `).run(status, progress, errorMessage, now, id);
  }

  /**
   * Updates processed page counts and current progress.
   */
  static updateJobProgress(id: string, processedPages: number, progress: number): void {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE jobs 
      SET processed_pages = ?, progress = ?, updated_at = ? 
      WHERE id = ?
    `).run(processedPages, progress, now, id);
  }

  /**
   * Fetches questions for a job.
   */
  static getQuestions(jobId: string): Question[] {
    return db.prepare(`
      SELECT * FROM questions 
      WHERE job_id = ? 
      ORDER BY page_number ASC, order_index ASC
    `).all(jobId) as Question[];
  }

  /**
   * Bulk saves/updates questions for a job.
   */
  static saveQuestions(jobId: string, questions: any[]): void {
    const transaction = db.transaction(() => {
      // Clear previous questions
      db.prepare('DELETE FROM questions WHERE job_id = ?').run(jobId);

      // Insert new/updated list
      const insertStmt = db.prepare(`
        INSERT INTO questions (
          id, job_id, chapter, exercise, question_number, question_text, 
          latex_text, diagram_url, diagram_bbox, question_bbox, 
          page_number, order_index, status
        ) VALUES (
          ?, ?, ?, ?, ?, ?, 
          ?, ?, ?, ?, 
          ?, ?, ?
        )
      `);

      questions.forEach((q, index) => {
        insertStmt.run(
          q.id || crypto.randomUUID(),
          jobId,
          q.chapter || 'Chapter 1',
          q.exercise || 'Exercise 1.1',
          q.question_number || String(index + 1),
          q.question_text,
          q.latex_text || q.question_text,
          q.diagram_url || null,
          q.diagram_bbox ? (typeof q.diagram_bbox === 'string' ? q.diagram_bbox : JSON.stringify(q.diagram_bbox)) : null,
          q.question_bbox ? (typeof q.question_bbox === 'string' ? q.question_bbox : JSON.stringify(q.question_bbox)) : null,
          q.page_number || 1,
          index, // preserve order_index
          q.status || 'verified'
        );
      });
    });

    transaction();
    
    // Touch job update timestamp
    const now = new Date().toISOString();
    db.prepare('UPDATE jobs SET updated_at = ? WHERE id = ?').run(now, jobId);
  }

  /**
   * Deletes job and Cascade deletes all questions.
   */
  static deleteJob(id: string): void {
    db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  }
}
