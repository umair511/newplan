import React from 'react';
import { UserProfile, UserRole } from '../types';
import { ThemeId } from '../types/theme';
import { ThemeSelectorDropdown } from './ThemeSelectorDropdown';
import { 
  ShieldCheck, 
  RotateCcw,
  Menu,
  ChevronRight,
  Sparkles,
  Command,
  User
} from 'lucide-react';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: UserProfile;
  setCurrentUser: (user: UserProfile) => void;
  onOpenTests: () => void;
  onResetDatabase: () => void;
  onToggleSidebar: () => void;
  isSidebarOpen?: boolean;
  pendingOrdersCount?: number;
  openPlansCount?: number;
  currentTheme: ThemeId;
  onSelectTheme: (theme: ThemeId) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  currentUser,
  setCurrentUser,
  onOpenTests,
  onResetDatabase,
  onToggleSidebar,
  isSidebarOpen = false,
  currentTheme,
  onSelectTheme,
}) => {
  const getBreadcrumbInfo = () => {
    if (activeTab.startsWith('stuffing-') || activeTab === 'stuffing') {
      const titles: Record<string, string> = {
        'stuffing': 'Planner & Floor Layout',
        'stuffing-planner': 'Planner & Floor Layout',
        'stuffing-specs': 'Film Specs Master',
        'stuffing-rules': 'Packaging & Math Rules',
      };
      return { module: 'Container Stuffing (CS)', title: titles[activeTab] || 'Stuffing Planner' };
    }
    if (activeTab.startsWith('ss-')) {
      const titles: Record<string, string> = {
        'ss-dashboard': 'Overview',
        'ss-demand': 'Orders Backlog',
        'ss-requirements': 'Jumbo Requirements',
        'ss-inventory': 'Jumbo Inventory',
        'ss-generator': 'Planning Studio',
        'ss-plans': 'Production Plans',
        'ss-consumption': 'Consumption Log',
        'ss-reports': 'Reports & Yield',
        'ss-settings': 'Machine Parameters',
      };
      return { module: 'Secondary Slitter (SS)', title: titles[activeTab] || 'Workspace' };
    }
    if (activeTab.startsWith('msl-')) {
      const titles: Record<string, string> = {
        'msl-dashboard': 'Overview',
        'msl-demand': 'Orders Backlog',
        'msl-requirements': 'Jumbo Requirements',
        'msl-inventory': 'Jumbo Inventory',
        'msl-generator': 'Planning Studio',
        'msl-plans': 'Production Plans',
        'msl-consumption': 'Consumption Log',
        'msl-reports': 'Reports & Yield',
        'msl-settings': 'Machine Parameters',
      };
      return { module: 'Metallizer (MSL)', title: titles[activeTab] || 'Workspace' };
    }
    const titles: Record<string, string> = {
      'dashboard': 'Overview',
      'films': 'Films Backlog',
      'generator': 'Planning Studio',
      'orders': 'Master Orders',
      'plans': 'Plans & Schedules',
      'reports': 'Reports & Analytics',
      'rules': 'Machine Parameters',
      'audit': 'Audit Trail',
    };
    if (activeTab === 'films' || activeTab === 'orders') {
      return { module: 'Master Backlog', title: titles[activeTab] || 'Backlog' };
    }
    return { module: 'Primary Slitter (PS)', title: titles[activeTab] || 'Workspace' };
  };

  const breadcrumb = getBreadcrumbInfo();

  return (
    <header id="app-top-navbar" className={`bg-slate-950/95 backdrop-blur-md text-slate-100 border-b border-slate-800/80 sticky top-0 z-30 transition-all duration-300 ease-in-out ${
      isSidebarOpen ? 'lg:pl-64 xl:pl-72' : 'pl-0'
    }`}>
      <div className="w-full px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-13 sm:h-14 gap-3">
          {/* Left: Sidebar Toggle + Breadcrumb Path */}
          <div className="flex items-center space-x-2.5 sm:space-x-3 min-w-0">
            <button
              id="sidebar-toggle-button"
              onClick={onToggleSidebar}
              aria-label="Toggle navigation sidebar"
              aria-expanded={isSidebarOpen}
              className={`p-1.5 sm:p-2 rounded-md border transition-all cursor-pointer flex items-center justify-center shrink-0 ${
                isSidebarOpen
                  ? 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
              }`}
              title="Toggle Sidebar (Ctrl+\)"
            >
              <Menu className="w-4 h-4" />
            </button>

            {/* Breadcrumb Path */}
            <div className="flex items-center space-x-1.5 text-xs text-slate-400 min-w-0">
              <button
                onClick={() => setActiveTab('dashboard')}
                className="font-bold text-slate-200 hover:text-white transition-colors cursor-pointer shrink-0"
              >
                PlanneX
              </button>
              <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              <span className="text-slate-400 font-medium truncate hidden xs:inline">
                {breadcrumb.module}
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0 hidden xs:inline" />
              <span className="font-semibold text-slate-100 truncate bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/60">
                {breadcrumb.title}
              </span>
            </div>
          </div>

          {/* Right section: System Status & Controls */}
          <div className="flex items-center space-x-2 sm:space-x-2.5 shrink-0">
            {/* Deterministic Engine Status Pill */}
            <div className="hidden md:flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono text-slate-300">100% Deterministic</span>
            </div>

            {/* Acceptance Test Suite Trigger */}
            <button
              id="header-rule-tests-btn"
              onClick={onOpenTests}
              className="flex items-center space-x-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 hover:border-slate-600 rounded-md transition-all cursor-pointer"
              title="Run Automated Acceptance Test Suite (64 Rules)"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Verify Rules</span>
              <span className="sm:hidden text-[11px]">Tests</span>
            </button>

            {/* Theme Selector Dropdown (All 6 Catalog Themes) */}
            <ThemeSelectorDropdown
              currentTheme={currentTheme}
              onSelectTheme={onSelectTheme}
            />

            {/* Reset Factory Seed DB */}
            <button
              id="header-reset-db-btn"
              onClick={onResetDatabase}
              className="hidden xl:flex items-center space-x-1 px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 rounded-md transition-all cursor-pointer"
              title="Reset data to factory baseline"
            >
              <RotateCcw className="w-3 h-3 text-slate-400" />
              <span>Reset</span>
            </button>

            {/* Compact User Role Pill */}
            <div className="flex items-center space-x-1.5 bg-slate-900 border border-slate-800 pl-2 pr-2.5 py-1 rounded-md text-xs">
              <div className="w-4 h-4 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-700/50 flex items-center justify-center text-[10px] font-bold">
                {currentUser.name.charAt(0)}
              </div>
              <select
                id="header-user-role-select"
                value={currentUser.role}
                onChange={(e) => setCurrentUser({ ...currentUser, role: e.target.value as UserRole })}
                className="bg-transparent text-slate-200 font-semibold focus:outline-none cursor-pointer text-xs pr-1"
                aria-label="Current user role"
              >
                <option value="PLANNER" className="bg-slate-900 text-slate-200">Planner</option>
                <option value="ADMIN" className="bg-slate-900 text-slate-200">Admin</option>
                <option value="VIEWER" className="bg-slate-900 text-slate-200">Viewer</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
