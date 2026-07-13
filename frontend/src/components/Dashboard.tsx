import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Trash2, Calendar, FileText, ChevronRight, Loader2, BookOpen, AlertTriangle } from 'lucide-react';

interface Job {
  id: string;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  total_pages: number;
  processed_pages: number;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

interface DashboardProps {
  onSelectJob: (jobId: string) => void;
  onCreateNew: () => void;
}

const API_BASE = 'http://localhost:5001';

export const Dashboard: React.FC<DashboardProps> = ({ onSelectJob, onCreateNew }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Fetch jobs list
  const fetchJobs = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/jobs`);
      if (!response.ok) {
        throw new Error('Failed to load presentation jobs.');
      }
      const data = await response.json();
      setJobs(data);
    } catch (err: any) {
      setError(err.message || 'Error fetching jobs.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();

    // Set up polling for pending/processing jobs to keep progress bars active
    const interval = setInterval(() => {
      const hasActiveJobs = jobs.some(j => j.status === 'pending' || j.status === 'processing');
      if (hasActiveJobs) {
        fetchJobs();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [jobs]);

  // Delete job asset helper
  const handleDeleteJob = async (e: React.MouseEvent, jobId: string) => {
    e.stopPropagation(); // prevent opening editor
    if (!confirm('Are you sure you want to delete this presentation and all its cropped diagrams? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/jobs/${jobId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete job.');
      }
      setJobs(jobs.filter(j => j.id !== jobId));
    } catch (err: any) {
      alert(err.message || 'Failed to delete presentation.');
    }
  };

  const formatDate = (isoStr: string) => {
    const date = new Date(isoStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header section with Stats summary */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Your Presentation Library</h1>
          <p className="text-slate-400 text-sm mt-1">
            Manage your AI question splits and smart PowerPoint lecture decks.
          </p>
        </div>

        <button
          onClick={onCreateNew}
          className="flex items-center justify-center gap-2 px-5 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold rounded-2xl shadow-lg shadow-indigo-600/30 transition-all duration-300 hover:scale-[1.02]"
        >
          <Plus className="h-5 w-5" />
          Create New Deck
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-10 w-10 text-indigo-500 animate-spin mb-4" />
          <p className="text-slate-400 text-sm">Loading presentation documents...</p>
        </div>
      ) : error ? (
        <div className="glass rounded-2xl p-8 border border-red-500/20 bg-red-500/5 text-center max-w-lg mx-auto">
          <AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-3" />
          <p className="text-slate-200 text-sm font-semibold mb-4">{error}</p>
          <button
            onClick={fetchJobs}
            className="px-4 py-2 bg-slate-900 border border-slate-800 text-slate-300 text-xs font-semibold rounded-xl hover:bg-slate-800 transition-colors"
          >
            Retry Connection
          </button>
        </div>
      ) : jobs.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-3xl p-12 text-center border border-slate-800/80 shadow-xl max-w-xl mx-auto flex flex-col items-center justify-center"
        >
          <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-2xl mb-6 text-slate-500">
            <BookOpen className="h-10 w-10" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">No presentations created yet</h3>
          <p className="text-slate-400 text-sm mb-8 max-w-sm">
            Upload your first RD Sharma or mathematics textbook chapter to generate interactive board slides!
          </p>
          <button
            onClick={onCreateNew}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition-all"
          >
            Upload a Textbook Chapter
          </button>
        </motion.div>
      ) : (
        /* Jobs listing grid */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {jobs.map((job) => {
            const isActive = job.status === 'pending' || job.status === 'processing';
            
            return (
              <motion.div
                key={job.id}
                onClick={() => job.status === 'completed' && onSelectJob(job.id)}
                className={`glass rounded-2xl p-6 border transition-all duration-300 flex flex-col justify-between relative overflow-hidden ${
                  job.status === 'completed' 
                    ? 'cursor-pointer border-slate-800/80 hover:border-slate-700/80 hover:bg-slate-800/30 hover:shadow-lg hover:shadow-indigo-500/5' 
                    : 'border-slate-900 bg-slate-950/20'
                }`}
              >
                <div>
                  {/* Status Badges */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-slate-500 text-xs">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>{formatDate(job.created_at)}</span>
                    </div>

                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                      job.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                      job.status === 'processing' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' :
                      job.status === 'pending' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                      'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}>
                      {job.status}
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-white mb-2 line-clamp-1 flex items-center gap-2">
                    <FileText className="h-4.5 w-4.5 text-indigo-400 shrink-0" />
                    {job.name}
                  </h3>

                  {/* Page details or Error reports */}
                  {job.status === 'failed' ? (
                    <p className="text-red-400/90 text-xs mt-1 bg-red-500/5 p-3 rounded-xl border border-red-500/10 line-clamp-2">
                      Error: {job.error_message}
                    </p>
                  ) : (
                    <p className="text-slate-400 text-xs mt-1">
                      {job.total_pages > 0 
                        ? `${job.total_pages} Page${job.total_pages > 1 ? 's' : ''} Rendered`
                        : 'Awaiting page analysis...'}
                    </p>
                  )}
                </div>

                {/* Progress bars / Action footer */}
                <div className="mt-6 pt-4 border-t border-slate-900/60 flex items-center justify-between">
                  {isActive ? (
                    <div className="w-full">
                      <div className="flex justify-between text-xs font-medium text-slate-400 mb-1">
                        <span>{job.status === 'processing' ? `Page ${job.processed_pages} of ${job.total_pages} processed` : 'Waiting in Queue'}</span>
                        <span>{job.progress}%</span>
                      </div>
                      <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                        <div 
                          className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={(e) => handleDeleteJob(e, job.id)}
                        className="p-2 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/5 border border-transparent hover:border-red-500/10 transition-colors"
                        title="Delete Presentation"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>

                      {job.status === 'completed' && (
                        <div className="flex items-center gap-1.5 text-sm font-bold text-indigo-400 hover:text-indigo-300">
                          Edit Presentation
                          <ChevronRight className="h-4 w-4" />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};
export default Dashboard;
