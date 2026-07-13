import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import fs from 'fs';
import { GEMINI_API_KEY } from '../config';

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || '');

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
  hasDiagram: boolean;
  diagram_bbox?: BoundingBox;
  question_bbox?: BoundingBox;
}

export interface PageAnalysisResult {
  chapter: string;
  exercise: string;
  questions: QuestionData[];
}

function fileToGenerativePart(filePath: string, mimeType: string) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(filePath)).toString('base64'),
      mimeType,
    },
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class GeminiService {
  /**
   * Sends a page image to the best available Google Gemini Flash model to segment and extract questions.
   * Leverages a dynamic model fallback chain (3.5 -> 2.5 -> 1.5) to maintain cross-account compatibility.
   * 
   * @param imagePath Absolute path to the page PNG image.
   * @param pageNumber The page index number.
   * @param mathpixText Optional Mathpix OCR text to use as reference.
   * @param retries Number of rate-limit retries.
   */
  static async analyzePageImage(
    imagePath: string,
    pageNumber: number,
    mathpixText?: string,
    retries = 3,
    signal?: AbortSignal
  ): Promise<PageAnalysisResult> {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not defined in the backend environment.');
    }

    const candidateModels = ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'];
    let lastError: any;

    const systemInstruction = `
      You are an expert mathematics document parser.
      Analyze this textbook page.
      Extract every complete question.
      
      Rules:
      - Preserve equations (use LaTeX formatting for math inside the text, e.g. \\( x^2 + 5 = 9 \\)).
      - Preserve numbering.
      - Preserve multi-line questions.
      - Preserve subparts (e.g. (a), (b), (c)).
      - Preserve diagrams.
      - Never merge two questions.
      - Never split one question.
      - Detect chapter and exercise.
      - Ignore page numbers.
      - Ignore headers and footers.
      
      Bounding Box Coordinates:
      - For each question, provide "question_bbox" covering the text.
      - If hasDiagram is true, provide "diagram_bbox" covering only the diagram associated with that question.
      - Coordinates are normalized integers from 0 to 1000 (representing percentage of page height/width).
    `;

    // Try each model candidate sequentially
    for (const modelName of candidateModels) {
      console.log(`[Gemini Service] Attempting analysis using model: ${modelName}`);
      
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              chapter: { type: SchemaType.STRING },
              exercise: { type: SchemaType.STRING },
              questions: {
                type: SchemaType.ARRAY,
                items: {
                  type: SchemaType.OBJECT,
                  properties: {
                    number: { type: SchemaType.STRING },
                    text: { type: SchemaType.STRING },
                    latex_text: { type: SchemaType.STRING },
                    hasDiagram: { type: SchemaType.BOOLEAN },
                    diagram_bbox: {
                      type: SchemaType.OBJECT,
                      description: 'Normalized bounding box containing the diagram if hasDiagram is true (0-1000 integers). Omit if hasDiagram is false.',
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
                      description: 'Normalized bounding box containing the question text block (0-1000 integers).',
                      properties: {
                        ymin: { type: SchemaType.INTEGER },
                        xmin: { type: SchemaType.INTEGER },
                        ymax: { type: SchemaType.INTEGER },
                        xmax: { type: SchemaType.INTEGER }
                      },
                      required: ['ymin', 'xmin', 'ymax', 'xmax']
                    }
                  },
                  required: ['number', 'text', 'latex_text', 'hasDiagram', 'question_bbox']
                }
              }
            },
            required: ['questions']
          }
        }
      });

      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const imagePart = fileToGenerativePart(imagePath, 'image/png');
          
          let prompt = `Analyze this textbook page. Extract all complete questions.
          Return ONLY valid JSON.
          Format:
          {
            "chapter": "",
            "exercise": "",
            "questions": [
              {
                "number": "",
                "text": "",
                "hasDiagram": false
              }
            ]
          }`;

          if (mathpixText) {
            prompt = `Analyze this textbook page. Extract all complete questions.
            Here is the premium LaTeX OCR reference text for this page:
            ---
            ${mathpixText}
            ---
            Ensure you match the question text block and formatting with this reference.
            Return ONLY valid JSON in the requested format.`;
          }

          const result = await model.generateContent([
            { text: systemInstruction },
            imagePart,
            { text: prompt }
          ], { signal });

          const responseText = result.response.text();
          const parsed = JSON.parse(responseText) as PageAnalysisResult;
          
          parsed.chapter = parsed.chapter || '';
          parsed.exercise = parsed.exercise || '';
          parsed.questions = parsed.questions || [];
          
          console.log(`[Gemini Service] Successfully parsed questions using model ${modelName}`);
          return parsed;
        } catch (err: any) {
          lastError = err;
          const msg = err.message || '';
          const isModelUnavailable = msg.includes('not found') || msg.includes('no longer available') || msg.includes('404');
          
          if (isModelUnavailable) {
            console.warn(`[Gemini Service] Model ${modelName} is not available/supported. Falling back...`);
            break; // Break attempt loop to move to the next candidate model
          }

          console.warn(`[Gemini Service] Attempt ${attempt} failed with ${modelName}:`, msg);
          if (attempt < retries) {
            await delay(Math.pow(2, attempt) * 1000);
          }
        }
      }
    }

    throw new Error(`Failed to parse page ${pageNumber} using all available Gemini Flash models. Last error: ${lastError?.message}`);
  }
}
