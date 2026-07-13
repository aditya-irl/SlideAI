import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

// Load env variables
dotenv.config();

export const PORT = process.env.PORT || 5001;
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

export const DATA_DIR = path.join(__dirname, '../data');
export const UPLOAD_DIR = path.join(__dirname, '../uploads');
export const PAGE_DIR = path.join(UPLOAD_DIR, 'pages');
export const DIAGRAM_DIR = path.join(UPLOAD_DIR, 'diagrams');
export const DB_PATH = path.join(DATA_DIR, 'database.db');

// Ensure necessary directories exist
[DATA_DIR, UPLOAD_DIR, PAGE_DIR, DIAGRAM_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});
