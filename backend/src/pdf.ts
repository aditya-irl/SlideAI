import { pdfToPng } from 'pdf-to-png-converter';
import fs from 'fs';
import path from 'path';
import { PAGE_DIR } from './config';

export interface RenderedPage {
  pageNumber: number;
  filePath: string;
  width: number;
  height: number;
}

/**
 * Converts a PDF file into high-resolution PNG images.
 * Saves the images in a subfolder inside PAGE_DIR named after the jobId.
 */
export async function convertPdfToImages(pdfPath: string, jobId: string): Promise<RenderedPage[]> {
  const jobPagesDir = path.join(PAGE_DIR, jobId);
  if (!fs.existsSync(jobPagesDir)) {
    fs.mkdirSync(jobPagesDir, { recursive: true });
  }

  // Convert PDF to PNGs with a scale factor of 3.0 (e.g. 72 DPI * 3 = 216 DPI)
  // This balances excellent OCR quality with memory/processing speed.
  const pages = await pdfToPng(pdfPath, {
    outputFolder: jobPagesDir,
    viewportScale: 3.0,
  });

  return pages.map((page) => {
    // If outputFolder is specified, pdf-to-png-converter saves the file to that folder.
    // We get the file path from page.path or construct it using page.name.
    const filePath = (page as any).path || path.join(jobPagesDir, page.name);
    
    return {
      pageNumber: page.pageNumber,
      filePath,
      width: page.width,
      height: page.height,
    };
  });
}
