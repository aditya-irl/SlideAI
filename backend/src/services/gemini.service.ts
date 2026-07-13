import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Fallback Google Generative AI SDK init
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export interface SlideContent {
  title: string;
  bullets: string[];
  speakerNotes: string;
  imageSuggestion: string;
}

export interface PresentationJSON {
  title: string;
  slides: SlideContent[];
}

export class GeminiService {
  /**
   * Compiles the merged document text into a structured presentation slide deck.
   * Sends exactly ONE API request for the entire document text.
   * 
   * @param mergedText Merged plain text of all textbook pages.
   * @param signal AbortSignal to cancel requests.
   */
  static async compilePresentation(
    mergedText: string,
    signal?: AbortSignal
  ): Promise<PresentationJSON> {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not defined in the backend environment.');
    }

    const candidateModels = ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'];
    let lastError: any;

    const systemInstruction = `
      You are an expert curriculum designer and senior slide presentation architect.
      Analyze this mathematics textbook chapter text and structure it into a cohesive slide presentation.
      
      Rules:
      - Split the content logically into separate slides (each covering exactly one topic, concept, or theorem/question).
      - Set the presentation title that summarizes the whole chapter.
      - For each slide:
        1. "title": A clear, short slide title.
        2. "bullets": An array of 3-5 concise, classroom-ready bullet points. Make sure all math formulas or questions are formatted in LaTeX inline formatting (e.g. \\( x^2 + y^2 = r^2 \\)).
        3. "speakerNotes": Detailed explanation notes for the teacher to use during lecture, explaining solutions or derivations step-by-step.
        4. "imageSuggestion": Detailed description of any geometry diagrams, figures, or plots that should be drawn on the board for this slide.
    `;

    const prompt = `
      Please compile the following textbook document text into a structured slide presentation deck.
      
      Textbook Document Content:
      ---
      ${mergedText}
      ---
      
      Return ONLY valid JSON matching the requested schema.
    `;

    // Try candidate models sequentially
    for (const modelName of candidateModels) {
      console.log(`[Gemini Service] Attempting slide compilation using model: ${modelName}`);
      
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              title: { type: SchemaType.STRING, description: 'Overall slide deck presentation title' },
              slides: {
                type: SchemaType.ARRAY,
                items: {
                  type: SchemaType.OBJECT,
                  properties: {
                    title: { type: SchemaType.STRING, description: 'Slide title' },
                    bullets: {
                      type: SchemaType.ARRAY,
                      items: { type: SchemaType.STRING },
                      description: 'Concise bullet points containing key slide concepts'
                    },
                    speakerNotes: { type: SchemaType.STRING, description: 'Notes for the speaker/teacher' },
                    imageSuggestion: { type: SchemaType.STRING, description: 'Detailed visual image/diagram suggestion' }
                  },
                  required: ['title', 'bullets', 'speakerNotes', 'imageSuggestion']
                }
              }
            },
            required: ['title', 'slides']
          }
        }
      });

      try {
        const result = await model.generateContent([
          { text: systemInstruction },
          { text: prompt }
        ], { signal });

        const responseText = result.response.text();
        const parsed = JSON.parse(responseText) as PresentationJSON;
        
        if (!parsed.slides || parsed.slides.length === 0) {
          throw new Error('Gemini did not return any slides in the compiled JSON.');
        }

        console.log(`[Gemini Service] Slide compile succeeded with model ${modelName}. Total slides: ${parsed.slides.length}`);
        return parsed;
      } catch (err: any) {
        if (signal?.aborted || err.name === 'AbortError' || err.message === 'cancelled') {
          console.log('[Gemini Service] Slide compile aborted by the user.');
          throw err;
        }
        console.error(`[Gemini Service] Model ${modelName} compile failed:`, err.message);
        lastError = err;
      }
    }

    throw new Error(`Gemini Slide compilation failed across all candidate models. Last error: ${lastError?.message || lastError}`);
  }
}
