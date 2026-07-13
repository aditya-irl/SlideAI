import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Dashboard from './components/Dashboard';
import UploadZone from './components/UploadZone';
import EditorWorkspace from './components/EditorWorkspace';

type ViewState = 'dashboard' | 'upload' | 'editor';

export const App: React.FC = () => {
  const [view, setView] = useState<ViewState>('dashboard');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [uiTheme, setUiTheme] = useState<'dark' | 'light'>('dark');

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
