import React from 'react';
import { Presentation, FolderKanban, Sun, Moon, Plus } from 'lucide-react';

interface NavbarProps {
  currentView: 'dashboard' | 'editor' | 'upload';
  setView: (view: 'dashboard' | 'editor' | 'upload') => void;
  uiTheme: 'dark' | 'light';
  setUiTheme: (theme: 'dark' | 'light') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  setView,
  uiTheme,
  setUiTheme,
}) => {
  return (
    <nav className="sticky top-0 z-50 w-full px-6 py-4 glass border-b border-slate-800 flex items-center justify-between">
      {/* Brand logo */}
      <div 
        className="flex items-center gap-2 cursor-pointer group"
        onClick={() => setView('dashboard')}
      >
        <div className="bg-gradient-to-tr from-indigo-500 to-violet-500 p-2 rounded-xl text-white shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform duration-300">
          <Presentation className="h-6 w-6" />
        </div>
        <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
          Antigravity<span className="text-indigo-400 font-medium text-lg ml-1 font-serif">Slides</span>
        </span>
      </div>

      {/* Nav Controls */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => setView('dashboard')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
            currentView === 'dashboard'
              ? 'bg-indigo-600/20 border border-indigo-500/30 text-indigo-300'
              : 'text-slate-400 hover:text-slate-200 border border-transparent'
          }`}
        >
          <FolderKanban className="h-4 w-4" />
          Dashboard
        </button>

        <button
          onClick={() => setView('upload')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
            currentView === 'upload'
              ? 'bg-indigo-600/20 border border-indigo-500/30 text-indigo-300'
              : 'text-slate-400 hover:text-slate-200 border border-transparent'
          }`}
        >
          <Plus className="h-4 w-4" />
          New Presentation
        </button>

        <div className="w-[1px] h-6 bg-slate-800" />

        {/* UI Theme Toggle */}
        <button
          onClick={() => setUiTheme(uiTheme === 'dark' ? 'light' : 'dark')}
          className="p-2 rounded-xl border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors"
          title="Toggle UI Theme"
        >
          {uiTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </nav>
  );
};
export default Navbar;
