import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { UPLOAD_DIR, PAGE_DIR } from '../config';

export interface UploadResult {
  jobId: string;
  originalName: string;
  isPdf: boolean;
  totalPages: number;
}

export class UploadService {
  /**
   * Processes uploaded file buffers, moves them to uploads folder, and returns job info.
   * 
   * @param files List of uploaded multer files.
   * @returns Job metadata.
   */
  static processUpload(files: Express.Multer.File[]): UploadResult {
    if (!files || files.length === 0) {
      throw new Error('No files provided.');
    }

    const jobId = crypto.randomUUID();
    const firstFile = files[0];
    const isPdf = firstFile.mimetype === 'application/pdf' || firstFile.originalname.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      if (files.length > 1) {
        throw new Error('Please upload only one PDF file.');
      }
      
      const targetPath = path.join(UPLOAD_DIR, `${jobId}.pdf`);
      fs.renameSync(firstFile.path, targetPath);

      return {
        jobId,
        originalName: firstFile.originalname,
        isPdf: true,
        totalPages: 0, // determined by PDF renderer
      };
    } else {
      // Validate all are images
      const invalid = files.find(f => !f.mimetype.startsWith('image/'));
      if (invalid) {
        throw new Error(`Unsupported file type: ${invalid.originalname}. Only PDF, JPG, PNG, and JPEG formats are supported.`);
      }

      // Create target page images directory
      const jobPagesDir = path.join(PAGE_DIR, jobId);
      if (!fs.existsSync(jobPagesDir)) {
        fs.mkdirSync(jobPagesDir, { recursive: true });
      }

      // Sort alphabetically to maintain correct scan ordering
      const sorted = [...files].sort((a, b) => a.originalname.localeCompare(b.originalname));

      sorted.forEach((file, index) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.png';
        const targetPath = path.join(jobPagesDir, `page_${index + 1}${ext}`);
        fs.renameSync(file.path, targetPath);
      });

      return {
        jobId,
        originalName: `Batch Scan (${sorted.length} images)`,
        isPdf: false,
        totalPages: sorted.length,
      };
    }
  }
}
