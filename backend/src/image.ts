import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { DIAGRAM_DIR } from './config';
import { BoundingBox } from './gemini';

export interface CropResult {
  filePath: string;
  fileName: string;
  width: number;
  height: number;
}

/**
 * Crops a diagram from a page image using normalized coordinates (0-1000 scale).
 * Saves the cropped image inside DIAGRAM_DIR.
 */
export async function cropDiagram(
  pageImagePath: string,
  jobId: string,
  pageNumber: number,
  questionNumber: string,
  bbox: BoundingBox
): Promise<CropResult | null> {
  try {
    const jobDiagramDir = path.join(DIAGRAM_DIR, jobId);
    if (!fs.existsSync(jobDiagramDir)) {
      fs.mkdirSync(jobDiagramDir, { recursive: true });
    }

    // Clean question number for filename safety
    const safeQNum = questionNumber.replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `diagram_p${pageNumber}_q${safeQNum}.png`;
    const outputPath = path.join(jobDiagramDir, fileName);

    // Get metadata of original page image
    const image = sharp(pageImagePath);
    const metadata = await image.metadata();
    
    if (!metadata.width || !metadata.height) {
      throw new Error(`Could not load dimensions of page image: ${pageImagePath}`);
    }

    const { width, height } = metadata;

    // Convert normalized coordinates (0-1000) to actual pixel dimensions
    let left = Math.round((bbox.xmin / 1000) * width);
    let top = Math.round((bbox.ymin / 1000) * height);
    let cropWidth = Math.round(((bbox.xmax - bbox.xmin) / 1000) * width);
    let cropHeight = Math.round(((bbox.ymax - bbox.ymin) / 1000) * height);

    // Clamp values to image bounds
    left = Math.max(0, Math.min(left, width - 1));
    top = Math.max(0, Math.min(top, height - 1));
    cropWidth = Math.max(10, Math.min(cropWidth, width - left));
    cropHeight = Math.max(10, Math.min(cropHeight, height - top));

    // Extract diagram using sharp
    await image
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .png()
      .toFile(outputPath);

    return {
      filePath: outputPath,
      fileName,
      width: cropWidth,
      height: cropHeight,
    };
  } catch (error: any) {
    console.error(`[Image Cropper] Error cropping diagram for page ${pageNumber}, question ${questionNumber}:`, error.message);
    return null; // Return null rather than breaking the queue job
  }
}
