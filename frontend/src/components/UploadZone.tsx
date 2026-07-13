import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UploadCloud, FileText, Images, AlertCircle, RefreshCw, CheckCircle, Square } from 'lucide-react';

interface UploadZoneProps {
  onSuccess: (jobId: string) => void;
}

import { API_BASE_URL as API_BASE } from '../utils/api';

type ProcessingStep = 'uploading' | 'converting' | 'ocr' | 'cropping' | 'verifying' | 'completed';

export const UploadZone: React.FC<UploadZoneProps> = ({ onSuccess }) => {
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [currentStep, setCurrentStep] = useState<ProcessingStep>('uploading');
  const [jobInfo, setJobInfo] = useState({ page: 0, total: 0 });
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const filesArray = Array.from(e.dataTransfer.files);
      validateAndProcessFiles(filesArray);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const filesArray = Array.from(e.target.files);
      validateAndProcessFiles(filesArray);
    }
  };

  const validateAndProcessFiles = (files: File[]) => {
    const isPdf = files[0].type === "application/pdf" || files[0].name.endsWith(".pdf");
    const imageFiles = files.filter(f => f.type.startsWith("image/"));

    if (isPdf && files.length > 1) {
      setErrorMessage("Please upload only one PDF file at a time.");
      setStatus('error');
      return;
    }

    if (!isPdf && imageFiles.length === 0) {
      setErrorMessage("Unsupported file type. Please upload a PDF or JPG/PNG textbook page images.");
      setStatus('error');
      return;
    }

    setUploadedFiles(files);
    uploadFiles(files);
  };

  const uploadFiles = async (files: File[]) => {
    setStatus('uploading');
    setProgress(15);
    setCurrentStep('uploading');
    setErrorMessage('');

    const formData = new FormData();
    files.forEach((file) => {
      formData.append("files", file);
    });

    try {
      const response = await fetch(`${API_BASE}/api/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to upload file.");
      }

      const data = await response.json();
      const jobId = data.jobId;
      setActiveJobId(jobId);

      // Start Polling loop to check worker progress
      pollJobStatus(jobId);
    } catch (err: any) {
      console.error('[Upload Component error]', err);
      setErrorMessage(err.message || "An error occurred during file upload.");
      setStatus('error');
    }
  };

  const pollJobStatus = (jobId: string) => {
    setStatus('processing');
    setCurrentStep('uploading');

    const eventSource = new EventSource(`${API_BASE}/api/jobs/${jobId}/progress`);

    eventSource.onmessage = (event) => {
      try {
        const job = JSON.parse(event.data);

        // Map backend progress to frontend pipeline steps
        setProgress(job.progress);
        setJobInfo({ page: job.processed_pages, total: job.total_pages });

        if (job.status === 'processing') {
          if (job.progress < 20) {
            setCurrentStep('converting');
          } else if (job.progress >= 20 && job.progress < 85) {
            setCurrentStep('ocr');
          } else {
            setCurrentStep('cropping');
          }
        } else if (job.status === 'completed') {
          setCurrentStep('completed');
          eventSource.close();
          setTimeout(() => {
            onSuccess(jobId);
          }, 1000);
        } else if (job.status === 'failed' || job.status === 'cancelled') {
          eventSource.close();
          setErrorMessage(job.error_message || "AI processing pipeline was cancelled.");
          setStatus('error');
        }
      } catch (err) {
        console.error("SSE parsing error:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE connection error:", err);
      eventSource.close();
      setErrorMessage("Real-time communication with backend lost.");
      setStatus('error');
    };
  };

  const handleCancel = async () => {
    if (!activeJobId) return;

    const confirmCancel = window.confirm(
      "Are you sure you want to stop processing? Any unfinished progress will be discarded."
    );

    if (!confirmCancel) return;

    setCancelling(true);

    try {
      const response = await fetch(`${API_BASE}/api/jobs/${activeJobId}/cancel`, {
        method: "POST",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to cancel processing.");
      }

      setStatus('error');
      setErrorMessage("Processing Cancelled");
    } catch (err: any) {
      alert(err.message || "An error occurred while stopping processing.");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <AnimatePresence mode="wait">
        {status === 'idle' && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="glass rounded-3xl p-10 flex flex-col items-center justify-center border border-slate-800 shadow-2xl relative overflow-hidden"
          >
            {/* Ambient glowing orb */}
            <div className="absolute -top-24 -left-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl" />
            <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-violet-500/10 rounded-full blur-3xl" />

            <div className="p-4 bg-slate-900 rounded-2xl text-indigo-400 mb-6 border border-slate-800 shadow-inner">
              <UploadCloud className="h-10 w-10 animate-pulse" />
            </div>

            <h2 className="text-2xl font-extrabold text-white mb-2 text-center tracking-tight">
              Create Smart Blackboard Presentation
            </h2>
            <p className="text-slate-400 text-sm mb-8 text-center max-w-md">
              Upload a mathematics book PDF or drag-and-drop scanned textbook page images. Our AI will split them into clean, individual question slides.
            </p>

            {/* Drag & Drop Area */}
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`w-full max-w-lg border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 ${
                dragActive
                  ? "border-indigo-400 bg-indigo-500/5 shadow-[0_0_20px_rgba(99,102,241,0.15)]Scale(1.02)"
                  : "border-slate-800 bg-slate-950/40 hover:border-slate-700 hover:bg-slate-900/10"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,image/png,image/jpeg,image/jpg"
                className="hidden"
                onChange={handleFileChange}
              />
              
              <div className="flex items-center gap-4 text-slate-400 mb-4">
                <div className="flex flex-col items-center">
                  <FileText className="h-8 w-8 mb-1 text-slate-500" />
                  <span className="text-xs">PDF Textbook</span>
                </div>
                <div className="text-xs text-slate-600 font-bold">OR</div>
                <div className="flex flex-col items-center">
                  <Images className="h-8 w-8 mb-1 text-slate-500" />
                  <span className="text-xs">Multiple PNG/JPG</span>
                </div>
              </div>

              <p className="text-slate-300 text-sm font-semibold text-center mb-1">
                Drag & drop files here, or <span className="text-indigo-400 hover:underline">browse files</span>
              </p>
              <p className="text-slate-500 text-xs text-center">
                Supports books up to 100MB
              </p>
            </div>
          </motion.div>
        )}

        {(status === 'uploading' || status === 'processing') && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="glass rounded-3xl p-10 border border-slate-800 shadow-2xl relative overflow-hidden"
          >
            {/* Glowing background */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-2xl" />

            <div className="flex flex-col items-center text-center">
              {/* Circular progress loader */}
              <div className="relative h-24 w-24 mb-8">
                <svg className="h-full w-full transform -rotate-90">
                  <circle
                    cx="48"
                    cy="48"
                    r="40"
                    stroke="rgba(30, 41, 59, 0.5)"
                    strokeWidth="8"
                    fill="transparent"
                  />
                  <circle
                    cx="48"
                    cy="48"
                    r="40"
                    stroke="rgb(99, 102, 241)"
                    strokeWidth="8"
                    fill="transparent"
                    strokeDasharray="251.2"
                    strokeDashoffset={251.2 - (251.2 * progress) / 100}
                    className="transition-all duration-300 ease-out"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-bold text-white">{progress}%</span>
                </div>
              </div>

              <h3 className="text-xl font-bold text-white mb-2">
                {currentStep === 'uploading' && "Uploading files..."}
                {currentStep === 'converting' && "Rendering pages (300 DPI)..."}
                {currentStep === 'ocr' && `Analyzing page layout & OCR...`}
                {currentStep === 'cropping' && "Extracting geometry diagrams..."}
                {currentStep === 'completed' && "Verification complete!"}
              </h3>
              
              <p className="text-slate-400 text-sm mb-8 max-w-sm">
                {currentStep === 'ocr' && jobInfo.total > 0
                  ? `Processing page ${jobInfo.page} of ${jobInfo.total}. Extracting LaTeX math and checking tables.`
                  : "Please keep this tab open. The AI background worker is preparing your slide deck."}
              </p>

              {/* Step Pipeline tracker list */}
              <div className="w-full max-w-md text-left space-y-3 bg-slate-950/40 p-5 rounded-2xl border border-slate-900/60 shadow-inner">
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                    currentStep === 'uploading' 
                      ? 'bg-indigo-500 text-white font-bold animate-spin' 
                      : progress > 15 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-900 text-slate-500'
                  }`}>
                    {progress > 15 ? <CheckCircle className="w-4.5 h-4.5 text-emerald-400" /> : '1'}
                  </div>
                  <span className={`text-sm ${progress > 15 ? 'text-slate-400 line-through' : 'text-slate-200 font-medium'}`}>
                    Upload File and Book Metadata
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                    currentStep === 'converting' 
                      ? 'bg-indigo-500 text-white animate-pulse' 
                      : progress > 20 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-900 text-slate-500'
                  }`}>
                    {progress > 20 ? <CheckCircle className="w-4.5 h-4.5 text-emerald-400" /> : '2'}
                  </div>
                  <span className={`text-sm ${progress > 20 ? 'text-slate-400 line-through' : currentStep === 'converting' ? 'text-indigo-300 font-medium' : 'text-slate-500'}`}>
                    DPI Rasterization (vector to high-res PNG)
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                    currentStep === 'ocr' 
                      ? 'bg-indigo-500 text-white animate-bounce' 
                      : progress > 80 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-900 text-slate-500'
                  }`}>
                    {progress > 80 ? <CheckCircle className="w-4.5 h-4.5 text-emerald-400" /> : '3'}
                  </div>
                  <span className={`text-sm ${progress > 80 ? 'text-slate-400 line-through' : currentStep === 'ocr' ? 'text-indigo-300 font-medium' : 'text-slate-500'}`}>
                    AI OCR & Question Boundary Detection
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                    currentStep === 'cropping' 
                      ? 'bg-indigo-500 text-white animate-spin' 
                      : progress > 90 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-900 text-slate-500'
                  }`}>
                    {progress > 90 ? <CheckCircle className="w-4.5 h-4.5 text-emerald-400" /> : '4'}
                  </div>
                  <span className={`text-sm ${progress > 90 ? 'text-slate-400 line-through' : currentStep === 'cropping' ? 'text-indigo-300 font-medium' : 'text-slate-500'}`}>
                    Diagram Extraction & Cropping
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                    currentStep === 'completed' 
                      ? 'bg-emerald-500 text-white' 
                      : 'bg-slate-900 text-slate-500'
                  }`}>
                    {currentStep === 'completed' ? <CheckCircle className="w-4.5 h-4.5 text-white" /> : '5'}
                  </div>
                  <span className={`text-sm ${currentStep === 'completed' ? 'text-emerald-400 font-bold' : 'text-slate-500'}`}>
                    Smart Validation & Sequencer check
                  </span>
                </div>
              </div>

              {/* Stop Processing Button */}
              {status === 'processing' && (
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="mt-6 flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-red-500/10 border border-slate-800 hover:border-red-500/30 text-red-400 text-sm font-semibold rounded-xl transition-all disabled:opacity-50 shadow-md"
                >
                  <Square className="h-3.5 w-3.5 fill-red-400/20" />
                  {cancelling ? "Stopping..." : "Stop Processing"}
                </button>
              )}
            </div>
          </motion.div>
        )}

        {status === 'error' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="glass rounded-3xl p-10 border border-red-500/20 bg-red-500/5 shadow-2xl relative overflow-hidden flex flex-col items-center justify-center"
          >
            <div className="p-4 bg-red-500/20 text-red-400 rounded-2xl mb-6 border border-red-500/30">
              <AlertCircle className="h-10 w-10" />
            </div>

            <h3 className="text-xl font-bold text-white mb-2">Processing Error</h3>
            <p className="text-slate-300 text-sm mb-8 text-center max-w-md">
              {errorMessage || "An unexpected error occurred while extracting questions."}
            </p>

            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  setStatus('idle');
                  setUploadedFiles([]);
                }}
                className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-sm font-semibold rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (uploadedFiles.length > 0) {
                    uploadFiles(uploadedFiles);
                  } else {
                    setStatus('idle');
                  }
                }}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl shadow-lg shadow-indigo-600/20 transition-all"
              >
                <RefreshCw className="h-4 w-4" />
                Retry Process
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
export default UploadZone;
