import Database from 'better-sqlite3';
import { DB_PATH } from './config';

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER DEFAULT 0,
    total_pages INTEGER DEFAULT 0,
    processed_pages INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    chapter TEXT,
    exercise TEXT,
    question_number TEXT,
    question_text TEXT NOT NULL,
    latex_text TEXT,
    diagram_url TEXT,
    diagram_bbox TEXT,
    question_bbox TEXT,
    page_number INTEGER NOT NULL,
    order_index INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending_review',
    confidence_score REAL DEFAULT 1.0,
    feedback TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  );
`);

export default db;
