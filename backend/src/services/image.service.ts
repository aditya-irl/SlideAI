import cvReady from '@techstark/opencv-js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

export class ImageService {
  /**
   * Run OpenCV filters on the input image to prepare it for OCR.
   * Auto crops, corrects perspective, removes noise, sharpens, deskews, and binarizes.
   */
  static async preprocessImage(inputPath: string, outputPath: string): Promise<void> {
    const cv = await cvReady;
    
    console.log(`[Image Service] Preprocessing image: ${path.basename(inputPath)}`);
    
    // 1. Load image using Sharp to get raw RGBA buffer
    const sharpImg = sharp(inputPath);
    const metadata = await sharpImg.metadata();
    const origWidth = metadata.width || 800;
    const origHeight = metadata.height || 600;

    const { data } = await sharpImg
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // 2. Initialize source OpenCV Matrix
    const src = cv.matFromArray(origHeight, origWidth, cv.CV_8UC4, new Uint8Array(data));
    let currentMat = src.clone();

    try {
      // 3. Auto Crop & Perspective Correction
      const grayForContours = new cv.Mat();
      cv.cvtColor(currentMat, grayForContours, cv.COLOR_RGBA2GRAY);
      
      const blurredContours = new cv.Mat();
      cv.GaussianBlur(grayForContours, blurredContours, new cv.Size(5, 5), 0);
      
      const edged = new cv.Mat();
      cv.Canny(blurredContours, edged, 75, 200);

      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(edged, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

      // Find largest 4-corner contour
      let docContour: any = null;
      let maxArea = 0;

      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const area = cv.contourArea(c);
        if (area > origWidth * origHeight * 0.1) { // must cover at least 10% of image
          const peri = cv.arcLength(c, true);
          const approx = new cv.Mat();
          cv.approxPolyDP(c, approx, 0.02 * peri, true);

          if (approx.rows === 4 && area > maxArea) {
            docContour = approx;
            maxArea = area;
          } else {
            approx.delete();
          }
        }
      }

      // If we found a valid 4-corner document outline, apply perspective correction
      if (docContour) {
        console.log('[Image Service] Detected page borders. Applying perspective correction...');
        
        // Extract 4 corners
        const points = [];
        for (let i = 0; i < 4; i++) {
          points.push({
            x: docContour.data32S[i * 2],
            y: docContour.data32S[i * 2 + 1]
          });
        }

        // Sort corners: TL, TR, BR, BL
        points.sort((a, b) => a.y - b.y);
        const top = [points[0], points[1]].sort((a, b) => a.x - b.x);
        const bottom = [points[2], points[3]].sort((a, b) => a.x - b.x);
        
        const tl = top[0];
        const tr = top[1];
        const br = bottom[1];
        const bl = bottom[0];

        const srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
          tl.x, tl.y,
          tr.x, tr.y,
          br.x, br.y,
          bl.x, bl.y
        ]);

        const w1 = Math.hypot(tr.x - tl.x, tr.y - tl.y);
        const w2 = Math.hypot(br.x - bl.x, br.y - bl.y);
        const targetWidth = Math.max(w1, w2);

        const h1 = Math.hypot(bl.x - tl.x, bl.y - tl.y);
        const h2 = Math.hypot(br.x - tr.x, br.y - tr.y);
        const targetHeight = Math.max(h1, h2);

        const dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
          0, 0,
          targetWidth - 1, 0,
          targetWidth - 1, targetHeight - 1,
          0, targetHeight - 1
        ]);

        const M = cv.getPerspectiveTransform(srcCoords, dstCoords);
        const warped = new cv.Mat();
        cv.warpPerspective(currentMat, warped, M, new cv.Size(targetWidth, targetHeight));

        // Update active Mat to the warped image crop
        currentMat.delete();
        currentMat = warped;

        srcCoords.delete();
        dstCoords.delete();
        M.delete();
        docContour.delete();
      }

      // Cleanup contour mats
      grayForContours.delete();
      blurredContours.delete();
      edged.delete();
      contours.delete();
      hierarchy.delete();

    } catch (err: any) {
      console.warn('[Image Service] Auto-crop/Perspective failed, continuing without warp:', err.message);
    }

    // Now, run standard filters on the active matrix (original or warped crop)
    const gray = new cv.Mat();
    cv.cvtColor(currentMat, gray, cv.COLOR_RGBA2GRAY);

    // 4. Noise removal (Gaussian Blur)
    const blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0);

    // 5. Adaptive Thresholding (highly effective for scanned textbook pages with shadows)
    const thresh = new cv.Mat();
    cv.adaptiveThreshold(
      blurred,
      thresh,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      11,
      2
    );

    // 6. Deskewing
    let finalMat = thresh;
    try {
      const inverted = new cv.Mat();
      cv.bitwise_not(thresh, inverted);
      
      const pts = new cv.Mat();
      cv.findNonZero(inverted, pts);
      
      if (!pts.empty()) {
        const box = cv.minAreaRect(pts);
        let angle = box.angle;
        
        if (angle < -45) {
          angle = angle + 90;
        }

        // Apply rotation if skew is between 0.5 and 15 degrees
        if (Math.abs(angle) > 0.5 && Math.abs(angle) < 15) {
          console.log(`[Image Service] Deskewing image. Angle detected: ${angle.toFixed(2)} deg`);
          const center = new cv.Point(thresh.cols / 2, thresh.rows / 2);
          const M = cv.getRotationMatrix2D(center, angle, 1.0);
          const rotated = new cv.Mat();
          cv.warpAffine(
            thresh,
            rotated,
            M,
            new cv.Size(thresh.cols, thresh.rows),
            cv.INTER_CUBIC,
            cv.BORDER_CONSTANT,
            new cv.Scalar(255, 255, 255, 255)
          );
          
          finalMat = rotated;
          M.delete();
        }
      }
      inverted.delete();
      pts.delete();
    } catch (deskewErr: any) {
      console.warn('[Image Service] Deskew operation failed:', deskewErr.message);
    }

    // 7. Image Sharpening
    const sharpenedMat = new cv.Mat();
    const kernelData = [
      0, -1, 0,
      -1, 5, -1,
      0, -1, 0
    ];
    const kernel = cv.matFromArray(3, 3, cv.CV_32F, kernelData);
    cv.filter2D(finalMat, sharpenedMat, -1, kernel);

    // 8. Convert binarized single channel back to RGBA for writing
    const outMat = new cv.Mat();
    cv.cvtColor(sharpenedMat, outMat, cv.COLOR_GRAY2RGBA);

    // Write final file using sharp
    const outData = Buffer.from(outMat.data);
    await sharp(outData, {
      raw: {
        width: outMat.cols,
        height: outMat.rows,
        channels: 4
      }
    })
    .png({ compressionLevel: 8 }) // Compress output
    .toFile(outputPath);

    // Free resources
    src.delete();
    currentMat.delete();
    gray.delete();
    blurred.delete();
    thresh.delete();
    kernel.delete();
    sharpenedMat.delete();
    outMat.delete();
    if (finalMat !== thresh && finalMat !== sharpenedMat) {
      finalMat.delete();
    }
  }
}
