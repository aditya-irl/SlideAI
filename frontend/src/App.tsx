import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Dashboard from './components/Dashboard';
import UploadZone from './components/UploadZone';
import EditorWorkspace from './components/EditorWorkspace';
import { API_BASE_URL } from './utils/api';

type ViewState = 'dashboard' | 'upload' | 'editor';

export const App: React.FC = () => {
  const [view, setView] = useState<ViewState>('dashboard');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [uiTheme, setUiTheme] = useState<'dark' | 'light'>('dark');
  const [healthStatus, setHealthStatus] = useState<'checking' | 'waking' | 'ok' | 'error'>('checking');

  // Backend startup health check (handle Render cold startup sleep state)
  useEffect(() => {
    let active = true;
    
    // Switch to waking message if server doesn't respond quickly
    const wakeTimer = setTimeout(() => {
      if (active) setHealthStatus('waking');
    }, 2000);

    const verifyServer = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/health`);
        if (response.ok) {
          clearTimeout(wakeTimer);
          if (active) setHealthStatus('ok');
        } else {
          throw new Error('Healthy handshake failed');
        }
      } catch (err) {
        clearTimeout(wakeTimer);
        if (active) setHealthStatus('error');
      }
    };

    verifyServer();

    return () => {
      active = false;
      clearTimeout(wakeTimer);
    };
  }, []);

  const handleRetry = () => {
    setHealthStatus('checking');
    
    const wakeTimer = setTimeout(() => {
      setHealthStatus('waking');
    }, 2000);

    const verifyServer = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/health`);
        if (response.ok) {
          clearTimeout(wakeTimer);
          setHealthStatus('ok');
        } else {
          throw new Error('Handshake failed');
        }
      } catch (err) {
        clearTimeout(wakeTimer);
        setHealthStatus('error');
      }
    };

    verifyServer();
  };

  // Synchronise dark mode class on html tag
  useEffect(() => {
    const root = window.document.documentElement;
    if (uiTheme === 'dark') {
      root.classList.add('dark');
      root.style.backgroundColor = '#020617'; // slate-950
    } else {
      root.classList.remove('dark');
      root.style.backgroundColor = '#f8fafc'; // slate-50
    }
  }, [uiTheme]);

  const handleOpenJob = (jobId: string) => {
    setActiveJobId(jobId);
    setView('editor');
  };

  const handleUploadSuccess = (jobId: string) => {
    setActiveJobId(jobId);
    setView('editor');
  };

  if (healthStatus !== 'ok') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-100 p-6 relative overflow-hidden font-sans">
        {/* Ambient background glows */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-500/5 rounded-full blur-3xl" />

        <div className="glass max-w-md w-full rounded-3xl p-8 border border-slate-800 shadow-2xl flex flex-col items-center text-center relative z-10">
          <div className="h-16 w-16 mb-6 relative flex items-center justify-center">
            {healthStatus !== 'error' ? (
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-400 border-t-transparent" />
            ) : (
              <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center text-red-400 border border-red-500/20 text-lg">
                ⚠️
              </div>
            )}
          </div>

          <h2 className="text-xl font-extrabold text-white mb-2 tracking-tight">
            {healthStatus === 'checking' && "Connecting to server…"}
            {healthStatus === 'waking' && "Waking up the server…"}
            {healthStatus === 'error' && "Backend unavailable"}
          </h2>

          <p className="text-slate-400 text-sm mb-6 leading-relaxed">
            {healthStatus === 'checking' && "Establishing connection to SlideAI. Please wait."}
            {healthStatus === 'waking' && "This may take 30–60 seconds. Deployed servers sleep automatically during inactivity."}
            {healthStatus === 'error' && "We could not establish a connection to the API backend. Please check your connection and try again."}
          </p>

          {healthStatus === 'error' && (
            <button
              onClick={handleRetry}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
            >
              Retry Connection
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen font-sans transition-colors duration-300 ${
      uiTheme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
    }`}>
      {/* Navigation header */}
      <Navbar 
        currentView={view} 
        setView={setView} 
        uiTheme={uiTheme} 
        setUiTheme={setUiTheme} 
      />

      {/* View routing */}
      <main className="w-full">
        {view === 'dashboard' && (
          <Dashboard 
            onSelectJob={handleOpenJob} 
            onCreateNew={() => setView('upload')} 
          />
        )}
        
        {view === 'upload' && (
          <UploadZone 
            onSuccess={handleUploadSuccess} 
          />
        )}

        {view === 'editor' && activeJobId && (
          <EditorWorkspace 
            jobId={activeJobId} 
            onBack={() => setView('dashboard')} 
          />
        )}
      </main>
    </div>
  );
};

export default App;
