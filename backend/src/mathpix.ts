import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const MATHPIX_APP_ID = process.env.MATHPIX_APP_ID || '';
const MATHPIX_APP_KEY = process.env.MATHPIX_APP_KEY || '';

/**
 * Checks if Mathpix API keys are configured in the environment.
 */
export function isMathpixConfigured(): boolean {
  return !!(MATHPIX_APP_ID && MATHPIX_APP_KEY);
}

/**
 * Sends a high-resolution page image to the Mathpix v3/text API to perform
 * premium mathematics OCR.
 * 
 * @param imagePath Absolute path to the page image.
 * @returns Raw LaTeX formatted text of the page.
 */
export async function getMathpixOCR(imagePath: string): Promise<string> {
  if (!isMathpixConfigured()) {
    throw new Error('Mathpix API keys are not configured.');
  }

  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const dataUrl = `data:image/png;base64,${base64Image}`;

    console.log(`[Mathpix OCR] Sending page image to Mathpix API...`);

    const response = await fetch('https://api.mathpix.com/v3/text', {
      method: 'POST',
      headers: {
        'app_id': MATHPIX_APP_ID,
        'app_key': MATHPIX_APP_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        src: dataUrl,
        formats: ['text'],
        data_options: {
          include_latex: true,
          include_asciimath: false,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mathpix API error (${response.status}): ${errorText}`);
    }

    const result = await response.json() as any;
    
    if (!result.text) {
      throw new Error('Mathpix OCR did not return any text.');
    }

    console.log(`[Mathpix OCR] Successfully extracted LaTeX text (${result.text.length} chars).`);
    return result.text;
  } catch (error: any) {
    console.error(`[Mathpix OCR Error] OCR failed:`, error.message);
    throw error;
  }
}
