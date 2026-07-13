import { createWorker } from 'tesseract.js';
import { getMathpixOCR, isMathpixConfigured } from '../mathpix';
import db from '../db';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export class OcrService {
  /**
   * Calculates a SHA-256 hash of a file to facilitate unique caching.
   */
  static getFileHash(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  /**
   * Resolves plain text from an image by checking the local SQLite cache first,
   * falling back to Tesseract OCR or Mathpix OCR on cache misses.
   * 
   * @param imagePath Absolute path to the page image file.
   * @param useMathpix If true and Mathpix is configured, uses Mathpix; otherwise defaults.
   */
  static async extractText(imagePath: string, useMathpix = true): Promise<string> {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`File not found for OCR: ${imagePath}`);
    }

    const hash = this.getFileHash(imagePath);
    
    // 1. Database Cache Lookup
    try {
      const cached = db.prepare('SELECT extracted_text FROM ocr_cache WHERE image_hash = ?').get(hash) as { extracted_text: string } | undefined;
      if (cached && cached.extracted_text) {
        console.log(`[OCR Service] Cache HIT for image hash: ${hash}. Reusing cached text.`);
        return cached.extracted_text;
      }
    } catch (cacheErr: any) {
      console.warn('[OCR Service] Database cache lookup failed, proceeding with fresh OCR:', cacheErr.message);
    }

    console.log(`[OCR Service] Cache MISS for image hash: ${hash}. Initializing fresh OCR recognition...`);

    let extractedText = '';

    // 2. OCR Extraction (Mathpix or Tesseract.js)
    if (useMathpix && isMathpixConfigured()) {
      try {
        console.log('[OCR Service] Mathpix credentials detected. Using Mathpix premium LaTeX OCR...');
        extractedText = await getMathpixOCR(imagePath);
      } catch (mathpixErr: any) {
        console.warn('[OCR Service] Mathpix OCR failed, falling back to local Tesseract.js:', mathpixErr.message);
      }
    }

    if (!extractedText) {
      console.log('[OCR Service] Running local Tesseract.js OCR engine...');
      const worker = await createWorker('eng');
      try {
        const result = await worker.recognize(imagePath);
        extractedText = result.data.text;
      } catch (tessErr: any) {
        console.error('[OCR Service] Tesseract.js OCR engine error:', tessErr);
        throw tessErr;
      } finally {
        await worker.terminate();
      }
    }

    // Clean up text double linebreaks and empty chunks
    extractedText = extractedText
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // 3. Save to Cache Database
    try {
      const now = new Date().toISOString();
      db.prepare('INSERT OR REPLACE INTO ocr_cache (image_hash, extracted_text, created_at) VALUES (?, ?, ?)').run(hash, extractedText, now);
      console.log(`[OCR Service] Saved extracted text to cache. Hash: ${hash}`);
    } catch (saveErr: any) {
      console.warn('[OCR Service] Failed to save OCR result to cache:', saveErr.message);
    }

    return extractedText;
  }
}
