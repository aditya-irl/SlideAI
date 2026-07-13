import pptxgen from 'pptxgenjs';
import path from 'path';
import fs from 'fs';

export type BoardTheme = 'blackboard' | 'charcoal' | 'whiteboard' | 'plain';
export type SlideLayout = 'question_only' | 'question_solution_space' | 'question_half_blank' | 'question_full_blank' | 'question_left_board_right';

export interface PptSettings {
  bookName: string;
  theme: BoardTheme;
  layout: SlideLayout;
  showGrid: boolean;
}

export class PptService {
  /**
   * Compiles and writes the PowerPoint presentation using PptxGenJS.
   * Maps questions/slides from the SQLite database to the slide template layouts.
   * 
   * @param jobId The associated job ID.
   * @param questions List of questions (mapped slides) retrieved from database.
   * @param settings Teacher mode presentation visual style configurations.
   * @param outputPath Target path to output the generated presentation file.
   */
  static async generatePresentation(
    jobId: string,
    questions: any[],
    settings: PptSettings,
    outputPath: string
  ): Promise<void> {
    console.log(`[PPT Service] Starting presentation generation for Job ${jobId}. Slides count: ${questions.length}`);

    const pres = new pptxgen();
    
    // Set 16:9 widescreen layout (10 x 5.625 inches)
    pres.layout = 'LAYOUT_16x9';

    let slideCount = 0;

    for (const q of questions) {
      const slide = pres.addSlide();
      slideCount++;
      
      // Set background fill to White (FFFFFF) to keep Black Calibri text readable
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

      // 1. Add Sub-Header Details (overall presentation title) at the very top (Y: 0.15)
      const headerText = `${settings.bookName ? settings.bookName + '  •  ' : ''}${q.chapter || 'Lecture'}`;
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

      // 2. Add Slide Title (exercise stores slide title)
      const slideTitle = q.exercise || `Slide ${q.question_number}`;
      slide.addText(slideTitle, {
        x: 0.5,
        y: 0.35,
        w: 8.5,
        h: 0.4,
        fontSize: 16,
        fontFace: 'Calibri',
        color: '1E293B', // Slate-800
        bold: true,
        valign: 'middle'
      });

      // 3. Format bullets and text box coordinates
      // Left: 0.5 in, Top: 0.8 in, Width: 5.4 in (if visual suggestions are present) or 8.5 in
      const hasImageSuggestion = !!(q.feedback && q.feedback.trim());
      
      const qX = 0.5;
      const qY = 0.8;
      const qW = hasImageSuggestion ? 5.4 : 8.5;
      const qH = 2.0; // Height capped to leave bottom 50% blank for board handwriting

      const bulletPoints = q.question_text ? q.question_text.split('\n') : [];
      // Construct bullet paragraphs for PptxGenJS
      const textObjects = bulletPoints.map((bp: string) => ({
        text: bp,
        options: { bullet: true, color: '000000', fontSize: 11, fontFace: 'Calibri' }
      }));

      // Add Bullet points inside an editable text box
      if (textObjects.length > 0) {
        slide.addText(textObjects, {
          x: qX,
          y: qY,
          w: qW,
          h: qH,
          valign: 'top',
          align: 'left',
          margin: 0,
          isTextBox: true
        });
      } else {
        // Fallback placeholder text if blank
        slide.addText('(No content bullets for this slide)', {
          x: qX,
          y: qY,
          w: qW,
          h: qH,
          fontSize: 11,
          fontFace: 'Calibri',
          color: '64748B',
          valign: 'top',
          align: 'left',
          isTextBox: true
        });
      }

      // 4. Add Diagram/Image Suggestion Box at top right (if suggestion is present)
      if (hasImageSuggestion) {
        const diagX = 6.2;
        const diagY = 0.8;
        const diagW = 3.3;
        const diagH = 2.0;

        // Visual bounding box for suggestion
        slide.addShape(pres.ShapeType.rect, {
          x: diagX,
          y: diagY,
          w: diagW,
          h: diagH,
          fill: { color: 'F8FAFC' },
          line: { color: 'E2E8F0', width: 1 }
        });

        slide.addText(`💡 Image Suggestion:\n${q.feedback}`, {
          x: diagX + 0.1,
          y: diagY + 0.1,
          w: diagW - 0.2,
          h: diagH - 0.2,
          fontSize: 9,
          fontFace: 'Calibri',
          color: '475569',
          valign: 'top',
          align: 'left',
          breakLine: true
        });
      }

      // 5. Add Speaker Notes to PowerPoint slide notes
      if (q.latex_text && q.latex_text.trim()) {
        slide.addNotes(q.latex_text);
      }

      // 6. Support double-slide format (Question + full blank solution board)
      if (settings.layout === 'question_full_blank') {
        const blankSlide = pres.addSlide();
        slideCount++;
        blankSlide.background = { fill: 'FFFFFF' };

        // Grid overlay
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

        // Subtitle header mapping
        blankSlide.addText(`Solving Board: ${slideTitle}`, {
          x: 0.5,
          y: 0.25,
          w: 5.0,
          h: 0.35,
          fontSize: 10,
          fontFace: 'Calibri',
          color: '64748B'
        });

        // Copy Speaker notes to the blank solving slide as well
        if (q.latex_text && q.latex_text.trim()) {
          blankSlide.addNotes(q.latex_text);
        }
      }
    }

    // Write file directly to output path on the server
    await pres.writeFile({ fileName: outputPath });
    console.log(`[PPT Service] Presentation generation complete: ${outputPath}`);
  }
}
