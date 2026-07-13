import pptxgen from 'pptxgenjs';

export interface QuestionSlideData {
  id: string;
  chapter: string;
  exercise: string;
  question_number: string;
  question_text: string;
  diagram_url?: string | null;
  page_number: number;
}

export type BoardTheme = 'blackboard' | 'charcoal' | 'whiteboard' | 'plain';

export type SlideLayout = 
  | 'question_only' 
  | 'question_solution_space' 
  | 'question_half_blank' 
  | 'question_full_blank' 
  | 'question_left_board_right';

interface ExportSettings {
  bookName: string;
  theme: BoardTheme;
  layout: SlideLayout;
  showGrid: boolean;
}

import { API_BASE_URL as API_BASE } from '../utils/api';

// Fetch helper to convert image URL to base64 string for PptxGenJS compatibility
async function urlToBase64(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status} fetching image`);
    }
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;
        resolve(base64data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Failed to convert image to base64:', error);
    throw error;
  }
}

/**
 * Generates and triggers download of a custom formatted PowerPoint presentation.
 */
export async function generatePptx(
  questions: QuestionSlideData[],
  settings: ExportSettings
): Promise<void> {
  const pres = new pptxgen();
  
  // Set 16:9 widescreen layout (10 x 5.625 inches)
  pres.layout = 'LAYOUT_16x9';

  let slideCount = 0;

  // Generate slides
  for (const q of questions) {
    const slide = pres.addSlide();
    slideCount++;
    
    // Set Background Color to White (FFFFFF) to keep Black Calibri text readable
    slide.background = { fill: 'FFFFFF' };

    // Add Grid Lines (using light gray for readability with black text)
    if (settings.showGrid && settings.theme !== 'plain') {
      const gridSpacing = 0.5;
      for (let y = gridSpacing; y < 5.625; y += gridSpacing) {
        slide.addShape(pres.ShapeType.line, {
          x: 0, y: y, w: 10.0, h: 0,
          line: { color: 'E2E8F0', width: 0.5, dashType: 'dash' }
        });
      }
      for (let x = gridSpacing; x < 10.0; x += gridSpacing) {
        slide.addShape(pres.ShapeType.line, {
          x: x, y: 0, w: 0, h: 5.625,
          line: { color: 'E2E8F0', width: 0.5, dashType: 'dash' }
        });
      }
    }

    // 3. Add Header Details (Book, Chapter, Exercise) at the very top (Y: 0.15)
    const headerText = `${settings.bookName ? settings.bookName + '  •  ' : ''}${q.chapter}  •  ${q.exercise}`;
    slide.addText(headerText, {
      x: 0.5,
      y: 0.15,
      w: 8.5,
      h: 0.25,
      fontSize: 9,
      fontFace: 'Calibri',
      color: '64748B', // Slate gray
      bold: false
    });

    // 4. Calculate layout-specific text box coordinates
    let hasDiagram = !!q.diagram_url;
    let diagramBase64: string | null = null;
    let resolvedUrl = '';

    if (hasDiagram && q.diagram_url) {
      try {
        resolvedUrl = q.diagram_url.startsWith('http') || q.diagram_url.startsWith('blob:') || q.diagram_url.startsWith('data:')
          ? q.diagram_url 
          : `${API_BASE}${q.diagram_url}`;
        
        diagramBase64 = await urlToBase64(resolvedUrl);

        if (!diagramBase64 || diagramBase64.length === 0) {
          throw new Error('Fetched image base64 data is empty');
        }

        const formatMatch = diagramBase64.match(/^data:image\/(png|jpeg|jpg);base64,/);
        if (!formatMatch) {
          throw new Error('Unsupported image format. Only PNG and JPEG/JPG are supported in PPT generation');
        }
      } catch (err: any) {
        console.error('Failed to convert diagram image for slide:', err);
        throw new Error(`Failed to load diagram image on Slide ${slideCount} (Q${q.question_number}): ${err.message}`);
      }
    }

    // Positions as requested by user:
    // Left: 0.5 in, Top: 0.5 in, Width: 8.5 in (or 5.4 in if diagram is present)
    // Height: capped at 2.3 in (~40% of the 5.625 total slide height) to guarantee 40-50% blank bottom space
    const qX = 0.5;
    const qY = 0.5;
    const qW = hasDiagram ? 5.4 : 8.5;
    const qH = 2.3;

    const diagX = 6.2;
    const diagY = 0.5;
    const diagW = 3.3;
    const diagH = 4.5;

    // 5. Add Editable Question Text (Formatted exactly as requested)
    slide.addText(`Question ${q.question_number}: ${q.question_text}`, {
      x: qX,
      y: qY,
      w: qW,
      h: qH,
      fontSize: 11,
      fontFace: 'Calibri',
      color: '000000', // Black
      valign: 'top',
      align: 'left',
      margin: 0,
      breakLine: true, // Word wrap enabled
      isTextBox: true,
      fit: 'shrink' // Shrink if exceptionally long, preventing overflow
    });

    // 6. Add Crop Diagram (if exists)
    if (hasDiagram && diagramBase64) {
      try {
        slide.addImage({
          data: diagramBase64,
          x: diagX,
          y: diagY,
          w: diagW,
          h: diagH,
          sizing: { type: 'contain', w: diagW, h: diagH }
        });

        console.log(`[PPTX Export Log] Image successfully added:
- Slide Number: ${slideCount}
- Question Number: ${q.question_number}
- Image Path: ${resolvedUrl}
- Image Width: ${diagW} inches
- Image Height: ${diagH} inches`);
      } catch (addImageErr: any) {
        throw new Error(`PptxGenJS addImage failed on Slide ${slideCount} (Q${q.question_number}): ${addImageErr.message}`);
      }
    }

    // 7. For "Question + Full Slide Blank" layout, inject a blank page after the question
    if (settings.layout === 'question_full_blank') {
      const blankSlide = pres.addSlide();
      slideCount++;
      blankSlide.background = { fill: 'FFFFFF' };

      // Add Grid lines to blank slide
      if (settings.showGrid && settings.theme !== 'plain') {
        const gridSpacing = 0.5;
        for (let y = gridSpacing; y < 5.625; y += gridSpacing) {
          blankSlide.addShape(pres.ShapeType.line, {
            x: 0, y: y, w: 10.0, h: 0,
            line: { color: 'E2E8F0', width: 0.5, dashType: 'dash' }
          });
        }
        for (let x = gridSpacing; x < 10.0; x += gridSpacing) {
          blankSlide.addShape(pres.ShapeType.line, {
            x: x, y: 0, w: 0, h: 5.625,
            line: { color: 'E2E8F0', width: 0.5, dashType: 'dash' }
          });
        }
      }

      blankSlide.addText(`Solving: Q${q.question_number}`, {
        x: 0.5,
        y: 0.25,
        w: 5.0,
        h: 0.35,
        fontSize: 10,
        fontFace: 'Calibri',
        color: '64748B'
      });
    }
  }

  // Trigger browser download
  const safeTitle = settings.bookName.replace(/[^a-zA-Z0-9]/g, '_') || 'Math_Slides';
  await pres.writeFile({ fileName: `${safeTitle}.pptx` });
}
