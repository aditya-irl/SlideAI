import React, { useEffect, useState } from 'react';
import { HelpCircle, Layers, Image as ImageIcon } from 'lucide-react';

interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

interface Question {
  id: string;
  page_number: number;
  question_number: string;
  question_bbox?: BoundingBox | null;
  diagram_bbox?: BoundingBox | null;
}

interface ReferencePanelProps {
  jobId: string;
  currentPageNumber: number;
  questions: Question[];
  selectedQuestionId: string | null;
  onSelectQuestion: (id: string) => void;
}

const API_BASE = 'http://localhost:5001';

export const ReferencePanel: React.FC<ReferencePanelProps> = ({
  jobId,
  currentPageNumber,
  questions,
  selectedQuestionId,
  onSelectQuestion,
}) => {
  const [pageFiles, setPageFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Load the list of page files to find the correct filename
  useEffect(() => {
    const fetchPages = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/jobs/${jobId}/pages`);
        if (res.ok) {
          const data = await res.json();
          setPageFiles(data);
        }
      } catch (err) {
        console.error('Error fetching page list:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchPages();
  }, [jobId]);

  // Find the file matching the current page number
  const pageFilename = pageFiles.find(name => {
    // Check if filename contains page number like "_p3." or "_page_3." or "page_3." or ends with "_3.png"
    const regex = new RegExp(`_p${currentPageNumber}\\b|page_${currentPageNumber}\\b|_page${currentPageNumber}\\b|_${currentPageNumber}\\.png`, 'i');
    return regex.test(name);
  }) || (pageFiles.length > 0 ? pageFiles[currentPageNumber - 1] : `page_${currentPageNumber}.png`);

  const pageImgUrl = `${API_BASE}/api/jobs/${jobId}/pages/${pageFilename}`;

  // Filter questions that are on the current page and have bounding boxes
  const pageQuestions = questions.filter(q => q.page_number === currentPageNumber);

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800">
      {/* Panel Header */}
      <div className="px-4 py-3 border-b border-slate-850 flex items-center justify-between bg-slate-950/40">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-indigo-400" />
          <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Original Page Reference
          </span>
        </div>
        <span className="px-2 py-0.5 bg-slate-800 text-slate-400 rounded-md text-[10px] font-semibold">
          PAGE {currentPageNumber}
        </span>
      </div>

      {/* Main Image Viewport */}
      <div className="flex-1 overflow-y-auto p-4 flex items-start justify-center relative min-h-[350px] bg-slate-950/20 scrollbar-thin">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-slate-500">Loading page coordinates...</span>
          </div>
        ) : pageFiles.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <HelpCircle className="h-8 w-8 text-slate-700 mb-2" />
            <span className="text-xs text-slate-500">No original document pages found.</span>
          </div>
        ) : (
          <div className="relative w-full max-w-md shadow-2xl border border-slate-800 rounded-lg overflow-hidden group">
            {/* Textbook Page Image */}
            <img
              src={pageImgUrl}
              alt={`Page ${currentPageNumber}`}
              className="w-full h-auto pointer-events-none block"
            />

            {/* Bounding Box Highlights */}
            {pageQuestions.map((q) => {
              if (!q.question_bbox) return null;
              
              const isSelected = q.id === selectedQuestionId;
              const { ymin, xmin, ymax, xmax } = q.question_bbox;

              // Convert 0-1000 coordinates to percentages
              const top = ymin / 10;
              const left = xmin / 10;
              const width = (xmax - xmin) / 10;
              const height = (ymax - ymin) / 10;

              return (
                <div
                  key={q.id}
                  onClick={() => onSelectQuestion(q.id)}
                  style={{
                    top: `${top}%`,
                    left: `${left}%`,
                    width: `${width}%`,
                    height: `${height}%`,
                  }}
                  className={`absolute rounded cursor-pointer transition-all duration-200 group-hover:opacity-100 ${
                    isSelected
                      ? 'border-2 border-indigo-500 bg-indigo-500/20 z-20 shadow-[0_0_15px_rgba(99,102,241,0.4)]'
                      : 'border border-dashed border-slate-400/50 hover:border-indigo-400 hover:bg-indigo-500/10 z-10'
                  }`}
                  title={`Select Question ${q.question_number}`}
                >
                  {/* Small tooltip tag */}
                  <span className={`absolute -top-4 -left-1 px-1 py-0.5 rounded text-[8px] font-bold ${
                    isSelected 
                      ? 'bg-indigo-500 text-white shadow-md' 
                      : 'bg-slate-800/90 text-slate-300 border border-slate-700 opacity-0 hover:opacity-100'
                  }`}>
                    Q{q.question_number}
                  </span>

                  {/* Highlight diagram box nested inside if present */}
                  {q.diagram_bbox && (
                    <div
                      style={{
                        position: 'absolute',
                        top: `${((q.diagram_bbox.ymin - ymin) / (ymax - ymin)) * 100}%`,
                        left: `${((q.diagram_bbox.xmin - xmin) / (xmax - xmin)) * 100}%`,
                        width: `${((q.diagram_bbox.xmax - q.diagram_bbox.xmin) / (xmax - xmin)) * 100}%`,
                        height: `${((q.diagram_bbox.ymax - q.diagram_bbox.ymin) / (ymax - ymin)) * 100}%`,
                      }}
                      className="border border-amber-400/60 bg-amber-400/10 pointer-events-none rounded flex items-center justify-center"
                    >
                      <ImageIcon className="w-3.5 h-3.5 text-amber-300 opacity-60" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info Legend */}
      <div className="p-3 bg-slate-950/50 border-t border-slate-850 flex items-center justify-around text-[10px] text-slate-500">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 border border-dashed border-slate-500 rounded bg-slate-800/20" />
          <span>Questions</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 border border-indigo-500 rounded bg-indigo-500/20" />
          <span>Selected</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 border border-amber-400 rounded bg-amber-400/25" />
          <span>Diagram Box</span>
        </div>
      </div>
    </div>
  );
};
export default ReferencePanel;
