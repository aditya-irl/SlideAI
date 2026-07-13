import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowLeft, Save, HelpCircle, Trash2, Plus, ArrowUp, ArrowDown, 
  Scissors, Merge, Grid, AlertTriangle, Loader2, Presentation, Image as ImageIcon 
} from 'lucide-react';
import LaTeXText from './LaTeXText';
import ReferencePanel from './ReferencePanel';
import { generatePptx } from '../utils/pptxExport';
import type { BoardTheme, SlideLayout } from '../utils/pptxExport';

interface Question {
  id: string;
  chapter: string;
  exercise: string;
  question_number: string;
  question_text: string;
  latex_text: string;
  diagram_url?: string | null;
  diagram_bbox?: any | null;
  question_bbox?: any | null;
  page_number: number;
  order_index: number;
  status: 'pending_review' | 'verified' | 'flagged';
  confidence_score: number;
  feedback?: string | null;
}

interface EditorWorkspaceProps {
  jobId: string;
  onBack: () => void;
}

const API_BASE = 'http://localhost:5001';

export const EditorWorkspace: React.FC<EditorWorkspaceProps> = ({ jobId, onBack }) => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [jobName, setJobName] = useState('');
  const [selectedQId, setSelectedQId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Teacher Mode Layout settings
  const [bookName, setBookName] = useState('RD Sharma Mathematics');
  const [theme, setTheme] = useState<BoardTheme>('blackboard');
  const [layout, setLayout] = useState<SlideLayout>('question_only');
  const [showGrid, setShowGrid] = useState(true);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch Questions and Job Details
  useEffect(() => {
    const loadJobData = async () => {
      try {
        const jobRes = await fetch(`${API_BASE}/api/jobs/${jobId}`);
        if (jobRes.ok) {
          const job = await jobRes.json();
          setJobName(job.name);
          // Set book name to job name as default
          setBookName(job.name.replace(/\.[^/.]+$/, "")); 
        }

        const qRes = await fetch(`${API_BASE}/api/jobs/${jobId}/questions`);
        if (qRes.ok) {
          const data = await qRes.json();
          setQuestions(data);
          if (data.length > 0) {
            setSelectedQId(data[0].id);
          }
        }
      } catch (err) {
        console.error('Error loading job/question data:', err);
      } finally {
        setLoading(false);
      }
    };
    loadJobData();
  }, [jobId]);

  const activeQuestion = questions.find(q => q.id === selectedQId) || null;

  // Update field of current selected question
  const updateActiveQuestion = (fields: Partial<Question>) => {
    if (!selectedQId) return;
    setQuestions(prev => prev.map(q => q.id === selectedQId ? { ...q, ...fields } : q));
  };

  // Reorder Questions
  const moveQuestion = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= questions.length) return;

    const newQuestions = [...questions];
    const temp = newQuestions[index];
    newQuestions[index] = newQuestions[targetIndex];
    newQuestions[targetIndex] = temp;

    // Recalculate order indices
    const ordered = newQuestions.map((q, idx) => ({ ...q, order_index: idx }));
    setQuestions(ordered);
  };

  // Delete Question
  const deleteQuestion = (id: string) => {
    if (questions.length <= 1) {
      alert("Cannot delete the last remaining slide.");
      return;
    }
    const idx = questions.findIndex(q => q.id === id);
    const newQuestions = questions.filter(q => q.id !== id);
    setQuestions(newQuestions);

    // Set new active question
    const nextActive = newQuestions[Math.max(0, idx - 1)];
    setSelectedQId(nextActive.id);
  };

  // Add New Question
  const addNewQuestion = () => {
    const active = activeQuestion;
    const newQ: Question = {
      id: crypto.randomUUID(),
      chapter: active?.chapter || 'Chapter 1',
      exercise: active?.exercise || 'Exercise 1.1',
      question_number: String(questions.length + 1),
      question_text: 'Type a new math question here...',
      latex_text: 'Type a new math question here...',
      page_number: active?.page_number || 1,
      order_index: questions.length,
      status: 'verified',
      confidence_score: 1.0
    };
    
    setQuestions([...questions, newQ]);
    setSelectedQId(newQ.id);
  };

  // Split Question at Textarea Cursor
  const splitQuestion = () => {
    if (!activeQuestion || !textareaRef.current) return;
    
    const textarea = textareaRef.current;
    const cursorPosition = textarea.selectionStart;
    const fullText = activeQuestion.question_text;
    const fullLatex = activeQuestion.latex_text;

    const textPart1 = fullText.substring(0, cursorPosition).trim();
    const textPart2 = fullText.substring(cursorPosition).trim();

    if (!textPart2) {
      alert("Place your cursor inside the question text box where you want to split.");
      return;
    }

    // Split LaTeX similarly or duplicate it for refinement
    const latexPart1 = fullLatex.substring(0, cursorPosition).trim() || textPart1;
    const latexPart2 = fullLatex.substring(cursorPosition).trim() || textPart2;

    const currentIdx = questions.findIndex(q => q.id === activeQuestion.id);

    // Create a new question matching coordinates
    const splitQ: Question = {
      id: crypto.randomUUID(),
      chapter: activeQuestion.chapter,
      exercise: activeQuestion.exercise,
      question_number: `${activeQuestion.question_number}b`,
      question_text: textPart2,
      latex_text: latexPart2,
      page_number: activeQuestion.page_number,
      order_index: currentIdx + 1,
      status: 'verified',
      confidence_score: 1.0
    };

    // Update original question text
    const updatedQuestions = [...questions];
    updatedQuestions[currentIdx] = {
      ...activeQuestion,
      question_text: textPart1,
      latex_text: latexPart1,
      question_number: `${activeQuestion.question_number}a`
    };

    // Insert new question
    updatedQuestions.splice(currentIdx + 1, 0, splitQ);

    // Recalculate order indices
    const finalQuestions = updatedQuestions.map((q, idx) => ({ ...q, order_index: idx }));
    
    setQuestions(finalQuestions);
    setSelectedQId(splitQ.id);
  };

  // Merge Question with Previous
  const mergeWithPrevious = (index: number) => {
    if (index === 0) return;
    const prevQ = questions[index - 1];
    const currQ = questions[index];

    // Combine texts
    const mergedText = `${prevQ.question_text}\n${currQ.question_text}`;
    const mergedLatex = `${prevQ.latex_text}\n${currQ.latex_text}`;

    const updatedQuestions = [...questions];
    
    // Update previous question
    updatedQuestions[index - 1] = {
      ...prevQ,
      question_text: mergedText,
      latex_text: mergedLatex,
      // Carry over diagram if previous doesn't have one but current does
      diagram_url: prevQ.diagram_url || currQ.diagram_url,
      diagram_bbox: prevQ.diagram_bbox || currQ.diagram_bbox,
    };

    // Remove current
    const finalQuestions = updatedQuestions.filter((_, idx) => idx !== index)
      .map((q, idx) => ({ ...q, order_index: idx }));

    setQuestions(finalQuestions);
    setSelectedQId(prevQ.id);
  };

  // Save changes to database
  const handleSaveToDb = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/api/jobs/${jobId}/questions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions }),
      });

      if (!response.ok) {
        throw new Error('Failed to save changes.');
      }
      
      // Update local state statuses to verified
      setQuestions(prev => prev.map(q => ({ ...q, status: q.status === 'flagged' ? 'verified' : q.status })));
      alert('Presentation changes saved successfully!');
    } catch (err: any) {
      alert(err.message || 'Error saving changes.');
    } finally {
      setSaving(false);
    }
  };

  // Export slides to PPTX
  const handleExportPptx = async () => {
    try {
      await generatePptx(questions, {
        bookName,
        theme,
        layout,
        showGrid
      });
    } catch (err) {
      alert('Failed to generate PowerPoint file.');
    }
  };

  // Render theme-based background styles
  const getThemeClass = () => {
    switch (theme) {
      case 'blackboard': return 'bg-board-green text-emerald-50';
      case 'charcoal': return 'bg-board-charcoal text-slate-100';
      case 'whiteboard': return 'bg-board-slate/5 text-slate-900 border border-slate-200';
      case 'plain': return 'bg-white text-slate-800 border border-slate-200';
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-73px)] w-full overflow-hidden bg-slate-950">
      
      {/* Editor Sub-header Action controls */}
      <div className="px-6 py-3 border-b border-slate-850 flex items-center justify-between bg-slate-900/60 shadow-md shrink-0">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h2 className="text-sm font-bold text-white line-clamp-1">{jobName}</h2>
            <p className="text-[10px] text-slate-400">WYSIWYG Slide Workspace</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveToDb}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-750 text-xs font-semibold rounded-xl transition-all"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save Changes
          </button>

          <button
            onClick={handleExportPptx}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-indigo-600/20 transition-all"
          >
            <Presentation className="w-3.5 h-3.5" />
            Export PPTX
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <Loader2 className="h-10 w-10 text-indigo-500 animate-spin mb-4" />
          <p className="text-slate-400 text-sm">Preparing workspace editor...</p>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          
          {/* LEFT OUTLINE SIDEBAR */}
          <div className="w-64 border-r border-slate-850 flex flex-col bg-slate-900/40 shrink-0">
            <div className="p-3 border-b border-slate-850 flex items-center justify-between bg-slate-950/20">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Slide Outline</span>
              <span className="px-2 py-0.5 bg-slate-800 rounded text-[10px] font-semibold text-slate-300">
                {questions.length} Slide{questions.length > 1 ? 's' : ''}
              </span>
            </div>

            {/* List of slide thumbnail outline cards */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin">
              {questions.map((q, index) => {
                const isSelected = q.id === selectedQId;
                const isFlagged = q.status === 'flagged';
                
                return (
                  <div
                    key={q.id}
                    onClick={() => setSelectedQId(q.id)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex gap-3 relative ${
                      isSelected
                        ? 'bg-indigo-600/10 border-indigo-500/50 shadow-md shadow-indigo-500/5'
                        : isFlagged
                        ? 'bg-red-500/5 border-red-500/20 hover:border-red-500/40'
                        : 'bg-slate-950/40 border-slate-850 hover:border-slate-800'
                    }`}
                  >
                    {/* Index number label */}
                    <div className="text-[10px] font-extrabold text-slate-500 bg-slate-900/60 w-5 h-5 rounded-full flex items-center justify-center shrink-0">
                      {index + 1}
                    </div>

                    <div className="flex-1 overflow-hidden">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-slate-200">Q{q.question_number}</span>
                        
                        {isFlagged && (
                          <span 
                            className="text-[9px] bg-amber-500/10 border border-amber-500/20 text-amber-400 font-bold px-1 rounded flex items-center gap-0.5"
                            title={q.feedback || 'Potential layout discrepancy detected.'}
                          >
                            <AlertTriangle className="w-2.5 h-2.5" />
                            Review
                          </span>
                        )}
                      </div>
                      
                      <p className="text-[10px] text-slate-400 line-clamp-2 mt-0.5">
                        {q.question_text}
                      </p>

                      {/* Small inline image indicator */}
                      {q.diagram_url && (
                        <div className="mt-1.5 flex items-center gap-1 text-[9px] text-amber-300/80 bg-amber-400/5 px-1 py-0.5 rounded border border-amber-400/10 w-fit">
                          <ImageIcon className="w-3 h-3" />
                          <span>Diagram Attached</span>
                        </div>
                      )}

                      {/* Outline action buttons */}
                      <div className="mt-2.5 pt-2 border-t border-slate-850/60 flex items-center justify-between text-slate-500 opacity-60 hover:opacity-100 transition-opacity">
                        <div className="flex items-center gap-1">
                          <button
                            disabled={index === 0}
                            onClick={(e) => { e.stopPropagation(); moveQuestion(index, 'up'); }}
                            className="p-1 hover:text-slate-200 rounded hover:bg-slate-800 disabled:opacity-30"
                            title="Move Up"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            disabled={index === questions.length - 1}
                            onClick={(e) => { e.stopPropagation(); moveQuestion(index, 'down'); }}
                            className="p-1 hover:text-slate-200 rounded hover:bg-slate-800 disabled:opacity-30"
                            title="Move Down"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>

                        <div className="flex items-center gap-1">
                          {index > 0 && (
                            <button
                              onClick={(e) => { e.stopPropagation(); mergeWithPrevious(index); }}
                              className="p-1 hover:text-indigo-400 rounded hover:bg-indigo-950/20"
                              title="Merge with Previous"
                            >
                              <Merge className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteQuestion(q.id); }}
                            className="p-1 hover:text-red-400 rounded hover:bg-red-950/20"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-3 border-t border-slate-850 bg-slate-950/20 shrink-0">
              <button
                onClick={addNewQuestion}
                className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-slate-750 hover:border-slate-600 rounded-xl text-xs font-semibold text-slate-300 hover:text-slate-100 transition-all"
              >
                <Plus className="w-4 h-4" />
                Add Blank Question
              </button>
            </div>
          </div>

          {/* MIDDLE WYSIWYG SLIDE PREVIEW & CONTROLS */}
          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 scrollbar-none items-center">
            
            {/* Editor slide details settings bar */}
            <div className="w-full max-w-[800px] grid grid-cols-2 md:grid-cols-4 gap-4 p-4 glass rounded-2xl border-slate-850 shrink-0 text-slate-300 text-xs">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-500">Book Name</label>
                <input 
                  type="text" 
                  value={bookName}
                  onChange={(e) => setBookName(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-white font-medium focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-500">Board Theme</label>
                <select 
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as BoardTheme)}
                  className="bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-white font-medium focus:border-indigo-500 focus:outline-none"
                >
                  <option value="blackboard">Green Blackboard</option>
                  <option value="charcoal">Charcoal Dark Board</option>
                  <option value="whiteboard">Whiteboard</option>
                  <option value="plain">Plain White</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-500">Slide Layout</label>
                <select 
                  value={layout}
                  onChange={(e) => setLayout(e.target.value as SlideLayout)}
                  className="bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-white font-medium focus:border-indigo-500 focus:outline-none"
                >
                  <option value="question_only">Question Only</option>
                  <option value="question_solution_space">Solution Space (Bottom 60% Blank)</option>
                  <option value="question_half_blank">Split Screen (Right Half Blank)</option>
                  <option value="question_left_board_right">Left Question, Right Solves</option>
                  <option value="question_full_blank">Double Slide (Blank Slide Follows)</option>
                </select>
              </div>

              <div className="flex items-center justify-between md:justify-center gap-2 md:pt-4">
                <label className="text-[10px] font-bold uppercase text-slate-500 md:hidden">Grid Overlay</label>
                <button
                  onClick={() => setShowGrid(!showGrid)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                    showGrid 
                      ? 'bg-indigo-600/10 border-indigo-500/40 text-indigo-300' 
                      : 'border-slate-800 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Grid className="w-3.5 h-3.5" />
                  Grid Pattern
                </button>
              </div>
            </div>

            {/* WYSIWYG PPTX SLIDE CANVAS MOCKUP */}
            {activeQuestion ? (
              <div className="w-full max-w-[800px] shrink-0">
                <div className="w-full relative shadow-2xl rounded-2xl overflow-hidden aspect-[16/9]">
                  {/* Slide canvas container */}
                  <div className={`absolute inset-0 p-8 flex flex-col font-sans select-none overflow-hidden ${getThemeClass()} ${
                    showGrid && theme !== 'plain' 
                      ? theme === 'whiteboard' ? 'grid-bg-white' : 'grid-bg-dark' 
                      : ''
                  }`}>
                    
                    {/* Header info */}
                    <div className="flex items-center justify-between text-[11px] font-semibold opacity-60 tracking-wider">
                      <span>{bookName ? bookName + '  •  ' : ''}{activeQuestion.chapter}  •  {activeQuestion.exercise}</span>
                    </div>

                    <h4 className={`text-base font-extrabold tracking-wide uppercase mt-2 ${
                      theme === 'blackboard' ? 'text-[#FFDD67]' :
                      theme === 'charcoal' ? 'text-[#38BDF8]' :
                      theme === 'whiteboard' ? 'text-[#2563EB]' :
                      'text-slate-500'
                    }`}>
                      QUESTION {activeQuestion.question_number}
                    </h4>

                    {/* Thin border divider */}
                    <div className="w-full h-[1px] bg-current opacity-10 my-3" />

                    {/* Main Content Layout blocks */}
                    <div className="flex-1 flex gap-6 overflow-hidden items-stretch">
                      
                      {/* Left: Question Box */}
                      <div className={`flex flex-col overflow-y-auto ${
                        layout === 'question_half_blank' ? 'w-1/2 pr-3' : 
                        layout === 'question_left_board_right' ? 'w-[35%] pr-3' : 
                        layout === 'question_solution_space' ? 'h-[35%] w-full' :
                        'w-full'
                      }`}>
                        <LaTeXText 
                          text={activeQuestion.latex_text || activeQuestion.question_text} 
                          className="text-lg font-medium leading-relaxed" 
                        />
                        
                        {/* Nested Diagram (if layout puts diagram under question) */}
                        {activeQuestion.diagram_url && (layout === 'question_half_blank' || layout === 'question_left_board_right') && (
                          <div className="mt-4 border border-slate-550/20 bg-slate-500/5 p-2 rounded-xl flex items-center justify-center aspect-[4/3] max-h-[160px] overflow-hidden">
                            <img
                              src={`${API_BASE}${activeQuestion.diagram_url}`}
                              alt="Diagram"
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                        )}
                      </div>

                      {/* Right: Board spaces or Diagram layouts */}
                      {layout === 'question_only' && activeQuestion.diagram_url && (
                        <div className="w-[35%] border border-slate-550/20 bg-slate-500/5 p-2 rounded-xl flex items-center justify-center shrink-0">
                          <img
                            src={`${API_BASE}${activeQuestion.diagram_url}`}
                            alt="Diagram"
                            className="max-h-full max-w-full object-contain"
                          />
                        </div>
                      )}

                      {layout === 'question_solution_space' && activeQuestion.diagram_url && (
                        <div className="absolute right-8 top-16 w-1/4 aspect-[4/3] max-h-[100px] border border-slate-550/20 bg-slate-500/5 p-1 rounded-lg flex items-center justify-center shrink-0">
                          <img
                            src={`${API_BASE}${activeQuestion.diagram_url}`}
                            alt="Diagram"
                            className="max-h-full max-w-full object-contain"
                          />
                        </div>
                      )}

                      {/* Dividers for board screen splits */}
                      {(layout === 'question_half_blank' || layout === 'question_left_board_right') && (
                        <div className="w-[1px] bg-current opacity-10 border-dashed border-l" />
                      )}

                      {/* Right-half blank chalkboard space */}
                      {layout === 'question_half_blank' && (
                        <div className="w-1/2 flex items-center justify-center border border-dashed border-current/5 rounded-xl bg-current/2">
                          <span className="text-[10px] font-bold uppercase opacity-35 tracking-wider">Solution Chalk Space</span>
                        </div>
                      )}

                      {layout === 'question_left_board_right' && (
                        <div className="w-[65%] flex items-center justify-center border border-dashed border-current/5 rounded-xl bg-current/2">
                          <span className="text-[10px] font-bold uppercase opacity-35 tracking-wider">Blank Writing Board</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Subtext warning */}
                {layout === 'question_full_blank' && (
                  <p className="text-[10px] text-slate-500 text-center mt-2 italic">
                    Note: A secondary blank slide with the chalkboard layout will automatically follow this slide.
                  </p>
                )}
              </div>
            ) : null}

            {/* FORM METADATA EDITOR PANEL */}
            {activeQuestion ? (
              <div className="w-full max-w-[800px] glass rounded-2xl border-slate-850 p-6 flex flex-col gap-4 text-xs text-slate-300">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold uppercase text-slate-500">Chapter</label>
                    <input 
                      type="text" 
                      value={activeQuestion.chapter}
                      onChange={(e) => updateActiveQuestion({ chapter: e.target.value })}
                      className="bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-medium focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold uppercase text-slate-500">Exercise</label>
                    <input 
                      type="text" 
                      value={activeQuestion.exercise}
                      onChange={(e) => updateActiveQuestion({ exercise: e.target.value })}
                      className="bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-medium focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold uppercase text-slate-500">Question Number</label>
                    <input 
                      type="text" 
                      value={activeQuestion.question_number}
                      onChange={(e) => updateActiveQuestion({ question_number: e.target.value })}
                      className="bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-medium focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold uppercase text-slate-500">Source Book Page</label>
                    <input 
                      type="number" 
                      value={activeQuestion.page_number}
                      onChange={(e) => updateActiveQuestion({ page_number: Number(e.target.value) })}
                      className="bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-medium focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1 relative">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase text-slate-500">Plain Question Text (Unicode math)</label>
                    
                    <button
                      onClick={splitQuestion}
                      className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-bold"
                      title="Slices this question at the current text cursor position into two slides"
                    >
                      <Scissors className="w-3.5 h-3.5" />
                      Split at Cursor
                    </button>
                  </div>
                  <textarea 
                    ref={textareaRef}
                    rows={4}
                    value={activeQuestion.question_text}
                    onChange={(e) => updateActiveQuestion({ 
                      question_text: e.target.value,
                      // keep latex aligned if no latex exists
                      latex_text: activeQuestion.latex_text === activeQuestion.question_text ? e.target.value : activeQuestion.latex_text
                    })}
                    className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-white font-medium focus:border-indigo-500 focus:outline-none font-mono text-[11px] leading-relaxed"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase text-slate-500">LaTeX Formatted Text (renders in editor preview)</label>
                  <textarea 
                    rows={3}
                    value={activeQuestion.latex_text}
                    onChange={(e) => updateActiveQuestion({ latex_text: e.target.value })}
                    placeholder="Put formulas between \( ... \) for inline or $$ ... $$ for block math."
                    className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-white font-medium focus:border-indigo-500 focus:outline-none font-mono text-[11px] leading-relaxed"
                  />
                </div>

                {/* Attached Diagram section */}
                <div className="border-t border-slate-850/60 pt-4 flex flex-col md:flex-row gap-4 items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-slate-900 rounded-lg text-slate-400 border border-slate-800">
                      <ImageIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-200">Geometry Diagram</span>
                      <p className="text-[10px] text-slate-500">Crop diagram attached to this slide</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full md:w-auto">
                    {activeQuestion.diagram_url ? (
                      <>
                        <button
                          onClick={() => updateActiveQuestion({ diagram_url: null, diagram_bbox: null })}
                          className="px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg font-semibold text-[10px] hover:bg-red-500/20"
                        >
                          Remove Diagram
                        </button>
                        <a 
                          href={`${API_BASE}${activeQuestion.diagram_url}`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-1.5 bg-slate-850 text-slate-300 border border-slate-750 rounded-lg font-semibold text-[10px] hover:bg-slate-800"
                        >
                          View Cropped PNG
                        </a>
                      </>
                    ) : (
                      <input 
                        type="text" 
                        placeholder="Paste image url to attach..." 
                        onChange={(e) => updateActiveQuestion({ diagram_url: e.target.value })}
                        className="bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-white font-medium focus:border-indigo-500 focus:outline-none w-full md:w-48 text-[10px]"
                      />
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* RIGHT REFERENCE PANEL */}
          <div className="w-[380px] border-l border-slate-850 shrink-0">
            {activeQuestion ? (
              <ReferencePanel
                jobId={jobId}
                currentPageNumber={activeQuestion.page_number}
                questions={questions}
                selectedQuestionId={selectedQId}
                onSelectQuestion={(id) => setSelectedQId(id)}
              />
            ) : (
              <div className="h-full flex items-center justify-center p-6 text-center text-slate-600 bg-slate-900">
                <HelpCircle className="h-8 w-8 mb-2 mx-auto" />
                <span className="text-xs">Select a slide to see page context.</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
export default EditorWorkspace;
