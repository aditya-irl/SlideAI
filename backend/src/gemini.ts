import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import fs from 'fs';
import { GEMINI_API_KEY } from './config';

// Initialise the Gemini API client
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface QuestionData {
  number: string;
  text: string;
  latex_text: string;
  diagram_detected: boolean;
  diagram_bbox?: BoundingBox;
  question_bbox: BoundingBox;
  confidence_score?: number;
  chapter?: string;
  exercise?: string;
}

export interface PageAnalysisResult {
  chapter?: string;
  exercise?: string;
  questions: QuestionData[];
}

// Convert local file to the Generative AI Inline Data format
function fileToGenerativePart(filePath: string, mimeType: string) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(filePath)).toString('base64'),
      mimeType,
    },
  };
}

// Helper for waiting/retry logic
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Analyzes a page image using Gemini Vision to extract math questions, LaTeX text,
 * and diagram coordinates. Retries on failure (e.g. rate limits).
 */
export async function analyzePageImage(
  imagePath: string,
  pageNumber: number,
  retries = 3,
  mathpixText?: string
): Promise<PageAnalysisResult> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not defined. Please add it to your environment variables.');
  }

  // Use Gemini 1.5 Flash as it is highly efficient and supports structured output
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          chapter: { 
            type: SchemaType.STRING, 
            description: 'Name of the chapter detected on the page, e.g. "Chapter 5" (if visible)' 
          },
          exercise: { 
            type: SchemaType.STRING, 
            description: 'Name of the exercise detected on the page, e.g. "Exercise 5.2" (if visible)' 
          },
          questions: {
            type: SchemaType.ARRAY,
            description: 'List of all individual questions extracted from this page.',
            items: {
              type: SchemaType.OBJECT,
              properties: {
                number: { 
                  type: SchemaType.STRING, 
                  description: 'The question number, e.g., "1", "2(a)", "3". Generate a sequential one if missing.' 
                },
                text: { 
                  type: SchemaType.STRING, 
                  description: 'The complete question text. Render standard math formulas using readable unicode characters (e.g. x², √y, θ) so that they are fully editable as plain text.' 
                },
                latex_text: { 
                  type: SchemaType.STRING, 
                  description: 'The question text with math formulas formatted in standard inline LaTeX notation using \\( ... \\) or block LaTeX $$ ... $$.' 
                },
                diagram_detected: { 
                  type: SchemaType.BOOLEAN, 
                  description: 'True if there is a graph, geometry diagram, figure, chart or visual math shape associated with this question.' 
                },
                diagram_bbox: {
                  type: SchemaType.OBJECT,
                  description: 'The bounding box containing ONLY the diagram associated with this question. Coordinates are 0-1000 integers relative to the page. Omit if no diagram.',
                  properties: {
                    ymin: { type: SchemaType.INTEGER },
                    xmin: { type: SchemaType.INTEGER },
                    ymax: { type: SchemaType.INTEGER },
                    xmax: { type: SchemaType.INTEGER }
                  },
                  required: ['ymin', 'xmin', 'ymax', 'xmax']
                },
                question_bbox: {
                  type: SchemaType.OBJECT,
                  description: 'The bounding box containing the text and number of the question (excluding diagrams if they are separate). Coordinates are 0-1000 integers.',
                  properties: {
                    ymin: { type: SchemaType.INTEGER },
                    xmin: { type: SchemaType.INTEGER },
                    ymax: { type: SchemaType.INTEGER },
                    xmax: { type: SchemaType.INTEGER }
                  },
                  required: ['ymin', 'xmin', 'ymax', 'xmax']
                }
              },
              required: ['number', 'text', 'latex_text', 'diagram_detected', 'question_bbox']
            }
          }
        },
        required: ['questions']
      }
    }
  });

  const systemInstruction = `
    You are a premium AI textbook layout analyzer, OCR engine, and mathematics specialist.
    Your task is to analyze the provided page image and identify all individual mathematics questions.
    
    CRITICAL INSTRUCTIONS:
    1. SEGMENTATION: You must identify and separate individual questions accurately. Never split a single multi-part question (like 1(a), (b), (c)) into separate slides if they belong to a single parent question. Keep them together.
    2. TEXT EXTRACT: For the "text" field, provide clean, readable text using standard Unicode formatting for simple math (superscripts like ², subscripts, fractions like ½, symbols like θ, π, √). This text should be professional and look like a typed slides document.
    3. LATEX: In the "latex_text" field, provide standard LaTeX formatting for all formulas. Use standard LaTeX symbols: e.g. \\( \\int_{0}^{\\infty} x^2 dx \\) or \\( A = \\pi r^2 \\). This is used for rendering crisp equations in our UI.
    4. BOUNDING BOXES: Specify accurate normalized bounding boxes (from 0 to 1000 where 0 is top/left, 1000 is bottom/right).
       - question_bbox: Covers the main text of the question.
       - diagram_bbox: Covers only the visual diagram, graph, or shape associated with the question. Be precise so we can crop it cleanly.
    5. Exercise & Chapter headings: If this page contains a visible chapter header or exercise label, identify it (e.g. "Exercise 6.1").
  `;

  let lastError: any;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const imagePart = fileToGenerativePart(imagePath, 'image/png');
      
      let prompt = `Analyze this textbook page (Page ${pageNumber}) and extract all questions. Keep math formatted neatly as requested.`;
      
      if (mathpixText) {
        prompt = `Analyze this textbook page (Page ${pageNumber}) and segment it into individual questions. 
        We have already run premium Mathpix LaTeX OCR on this page image. Here is the raw output:
        ---
        ${mathpixText}
        ---
        Please match the questions on the page to this Mathpix OCR context. For each question, extract the relevant 'text' (Unicode formatted) and 'latex_text' (containing exact LaTeX math expressions from the Mathpix output above). 
        Identify bounding boxes for both the question text block ('question_bbox') and the geometry diagram ('diagram_bbox', if present) on the page image.`;
      }
      
      const result = await model.generateContent([
        { text: systemInstruction },
        imagePart,
        { text: prompt }
      ]);
      
      const responseText = result.response.text();
      const parsedData = JSON.parse(responseText) as PageAnalysisResult;
      
      // Inject safety/confidence check
      parsedData.questions = parsedData.questions.map(q => ({
        ...q,
        confidence_score: q.text.length > 5 ? 0.95 : 0.6 // basic heuristic, can be adjusted
      }));
      
      return parsedData;
    } catch (error: any) {
      lastError = error;
      console.warn(`[Gemini API] Attempt ${attempt} failed for Page ${pageNumber}:`, error.message);
      
      if (attempt < retries) {
        // Wait: 2s, 4s, 8s...
        const waitTime = Math.pow(2, attempt) * 1000;
        await delay(waitTime);
      }
    }
  }

  throw new Error(`Failed to analyze page ${pageNumber} after ${retries} attempts. Last error: ${lastError?.message}`);
}
