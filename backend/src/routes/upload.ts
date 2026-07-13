import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { UPLOAD_DIR, PAGE_DIR } from '../config';
import { enqueueJob } from '../queue';
import db from '../db';

const router = Router();

// Set up temporary storage for incoming uploads
const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max limit
  }
});

// Endpoint supporting single PDF or multiple images
router.post('/', upload.array('files'), async (req: Request, res: Response): Promise<any> => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded.' });
    }

    const jobId = crypto.randomUUID();
    const isPdf = files[0].mimetype === 'application/pdf' || files[0].originalname.endsWith('.pdf');

    if (isPdf) {
      // 1. PDF File Upload
      const uploadedFile = files[0];
      const targetPdfPath = path.join(UPLOAD_DIR, `${jobId}.pdf`);
      
      // Move temp file to final location
      fs.renameSync(uploadedFile.path, targetPdfPath);
      
      console.log(`[Upload Route] PDF Uploaded, job enqueued: ${jobId}`);
      enqueueJob(jobId, uploadedFile.originalname);
      
      return res.status(200).json({
        jobId,
        message: 'PDF uploaded successfully. Processing started.',
        type: 'pdf'
      });
    } else {
      // 2. Image uploads (multiple JPG/PNG files)
      const jobPagesDir = path.join(PAGE_DIR, jobId);
      if (!fs.existsSync(jobPagesDir)) {
        fs.mkdirSync(jobPagesDir, { recursive: true });
      }

      // Filter and copy images
      const imageFiles = files.filter(f => f.mimetype.startsWith('image/'));
      if (imageFiles.length === 0) {
        // Clean up temp files
        files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
        return res.status(400).json({ error: 'Only PDF or image files (JPG, PNG) are supported.' });
      }

      // Sort files alphabetically to preserve page order
      imageFiles.sort((a, b) => a.originalname.localeCompare(b.originalname));

      imageFiles.forEach((file, index) => {
        const pageNumber = index + 1;
        // Keep original extension or standardise as png/jpg
        const ext = path.extname(file.originalname) || '.png';
        const targetImagePath = path.join(jobPagesDir, `page_${pageNumber}${ext}`);
        
        fs.renameSync(file.path, targetImagePath);
      });

      // Insert job in DB with total pages set, skipping PDF rasterization
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO jobs (id, name, status, progress, total_pages, processed_pages, created_at, updated_at)
        VALUES (?, ?, 'pending', 0, ?, 0, ?, ?)
      `).run(jobId, `Batch Upload (${imageFiles.length} images)`, imageFiles.length, now, now);

      console.log(`[Upload Route] Multiple images uploaded, job enqueued: ${jobId}`);
      enqueueJob(jobId, `Batch Upload (${imageFiles.length} images)`);

      return res.status(200).json({
        jobId,
        message: 'Images uploaded successfully. Processing started.',
        type: 'images'
      });
    }
  } catch (error: any) {
    console.error('[Upload Route Error]', error);
    return res.status(500).json({ error: error.message || 'Internal server error.' });
  }
});

export default router;
