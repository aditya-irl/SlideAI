import pptxgen from 'pptxgenjs';
import path from 'path';
import fs from 'fs';
import { DIAGRAM_DIR } from '../config';

export interface QuestionSlideData {
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

export class PptService {
  /**
   * Generates a PowerPoint presentation file on the backend.
   * 
   * @param jobId The processing job ID.
   * @param questions List of questions to include.
   * @param settings Layout and style customisations.
   * @param outputPath Output path to save the PPTX file.
   */
  static async generatePresentation(
    jobId: string,
    questions: QuestionSlideData[],
    settings: ExportSettings,
    outputPath: string
  ): Promise<void> {
    const pres = new pptxgen();
    pres.layout = 'LAYOUT_16x9';

    let slideCount = 0;

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

      // Metadata headers (Book, Chapter, Exercise) at the very top (Y: 0.15)
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

      // Calculate coordinates (as requested by user):
      // Left: 0.5 in, Top: 0.5 in, Width: 8.5 in (or 5.4 in if diagram is present)
      // Height: capped at 2.3 in (~40% of the 5.625 total slide height) to guarantee 40-50% blank bottom space
      let hasDiagram = false;
      let localDiagramPath = '';

      if (q.diagram_url) {
        try {
          const filename = path.basename(q.diagram_url);
          localDiagramPath = path.join(DIAGRAM_DIR, jobId, filename);
          
          if (!path.isAbsolute(localDiagramPath)) {
            throw new Error(`Path is not absolute: ${localDiagramPath}`);
          }
          if (!fs.existsSync(localDiagramPath)) {
            throw new Error(`File does not exist: ${localDiagramPath}`);
          }
          const stats = fs.statSync(localDiagramPath);
          if (stats.size === 0) {
            throw new Error(`File size is 0 bytes: ${localDiagramPath}`);
          }
          const ext = path.extname(localDiagramPath).toLowerCase();
          if (!['.png', '.jpg', '.jpeg'].includes(ext)) {
            throw new Error(`Unsupported image extension "${ext}": Only PNG/JPEG are supported`);
          }

          hasDiagram = true;
        } catch (err: any) {
          console.error(`[PPTX Gen Service] Image validation failed on Slide ${slideCount}:`, err.message);
          throw new Error(`Failed to validate diagram image on Slide ${slideCount} (Q${q.question_number}): ${err.message}`);
        }
      }

      const qX = 0.5;
      const qY = 0.5;
      const qW = hasDiagram ? 5.4 : 8.5;
      const qH = 2.3;

      const diagX = 6.2;
      const diagY = 0.5;
      const diagW = 3.3;
      const diagH = 4.5;

      // Add Editable Question Text (Formatted exactly as requested)
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

      // Add local diagram image if available
      if (hasDiagram && localDiagramPath) {
        try {
          slide.addImage({
            path: localDiagramPath,
            x: diagX, y: diagY, w: diagW, h: diagH,
            sizing: { type: 'contain', w: diagW, h: diagH }
          });

          console.log(`[PPTX Gen Service Log] Local image successfully added:
- Slide Number: ${slideCount}
- Question Number: ${q.question_number}
- Image Path: ${localDiagramPath}
- Image Width: ${diagW} inches
- Image Height: ${diagH} inches`);
        } catch (err: any) {
          throw new Error(`PptxGenJS addImage failed on Slide ${slideCount} (Q${q.question_number}) with local path: ${err.message}`);
        }
      }

      // Secondary blank slide for "Double Slide" layouts
      if (settings.layout === 'question_full_blank') {
        const blankSlide = pres.addSlide();
        slideCount++;
        blankSlide.background = { fill: 'FFFFFF' };

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

    // Write file directly to output path on the server
    await pres.writeFile({ fileName: outputPath });
  }
}
