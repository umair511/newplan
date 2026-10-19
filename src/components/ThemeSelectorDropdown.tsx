import React, { useState, useRef, useEffect } from 'react';
import { Palette, Check, Sparkles, ChevronDown } from 'lucide-react';
import { ThemeId, THEME_OPTIONS, ThemeOption } from '../types/theme';

interface ThemeSelectorDropdownProps {
  currentTheme: ThemeId;
  onSelectTheme: (themeId: ThemeId) => void;
}

export const ThemeSelectorDropdown: React.FC<ThemeSelectorDropdownProps> = ({
  currentTheme,
  onSelectTheme,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeThemeObj = THEME_OPTIONS.find(t => t.id === currentTheme) || THEME_OPTIONS[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button in Header */}
      <button
        id="header-theme-selector-btn"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className="flex items-center space-x-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 hover:border-slate-600 rounded-md transition-all cursor-pointer shadow-xs"
        title="Switch UI Theme (7 Catalog Themes Available - Stripe Active)"
      >
        {/* Color preview circle */}
        <span className="flex items-center space-x-0.5">
          <span 
            className="w-2.5 h-2.5 rounded-full border border-white/20"
            style={{ backgroundColor: activeThemeObj.swatches[2] }}
          />
        </span>
        <Palette className="w-3.5 h-3.5 text-slate-400" />
        <span className="hidden sm:inline">{activeThemeObj.name}</span>
        <ChevronDown className="w-3 h-3 text-slate-400 opacity-80" />
      </button>

      {/* Popover Dropdown Panel */}
      {isOpen && (
        <div 
          className="absolute right-0 mt-2 w-80 sm:w-96 bg-slate-950/98 backdrop-blur-xl border border-slate-800 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          role="menu"
          aria-orientation="vertical"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
            <div>
              <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-100">
                <Palette className="w-3.5 h-3.5 text-slate-300" />
                <span>Theme Catalog ({THEME_OPTIONS.length} Themes)</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Switch workspaces between light minimal, plant dark mode, and papercraft.
              </p>
            </div>
            <span className="text-[10px] font-mono uppercase font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
              Live
            </span>
          </div>

          {/* Theme List Grid */}
          <div className="p-2 space-y-1 max-h-[380px] overflow-y-auto">
            {THEME_OPTIONS.map((theme: ThemeOption) => {
              const isSelected = theme.id === currentTheme;
              return (
                <button
                  key={theme.id}
                  onClick={() => {
                    onSelectTheme(theme.id);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left p-2.5 rounded-lg transition-all flex items-start justify-between gap-3 cursor-pointer ${
                    isSelected
                      ? 'bg-slate-800/90 border border-slate-700/90 text-white shadow-xs'
                      : 'hover:bg-slate-900/80 border border-transparent text-slate-300 hover:text-white'
                  }`}
                  role="menuitem"
                >
                  <div className="flex items-start space-x-3 min-w-0">
                    {/* Swatch Previews */}
                    <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5">
                      <div className="flex items-center -space-x-1">
                        <span 
                          className="w-3.5 h-3.5 rounded-full border border-black/40 shadow-xs" 
                          style={{ backgroundColor: theme.swatches[0] }}
                          title="Canvas"
                        />
                        <span 
                          className="w-3.5 h-3.5 rounded-full border border-black/40 shadow-xs" 
                          style={{ backgroundColor: theme.swatches[1] }}
                          title="Surface"
                        />
                        <span 
                          className="w-3.5 h-3.5 rounded-full border border-black/40 shadow-xs ring-1 ring-white/30" 
                          style={{ backgroundColor: theme.swatches[2] }}
                          title="Accent"
                        />
                      </div>
                      <span className="text-[9px] font-mono text-slate-500 uppercase">
                        {theme.category}
                      </span>
                    </div>

                    {/* Information */}
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold truncate">
                          {theme.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {theme.subtitle}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5 leading-snug">
                        {theme.description}
                      </p>
                    </div>
                  </div>

                  {/* Status / Selected Checkmark */}
                  <div className="shrink-0 pt-0.5">
                    {isSelected ? (
                      <div className="w-5 h-5 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center shadow-xs">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                    ) : (
                      <span className="text-[10px] font-mono text-slate-500 px-1.5 py-0.5 rounded bg-slate-900/60 border border-slate-800">
                        {theme.tag}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Footer note */}
          <div className="px-4 py-2 bg-slate-900/40 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between font-mono">
            <span>Theme auto-persists in browser</span>
            <span className="text-slate-500">PlanneX Engine</span>
          </div>
        </div>
      )}
    </div>
  );
};
