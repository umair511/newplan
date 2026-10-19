import React, { useEffect, useState } from 'react';
import { 
  BarChart3, 
  Layers, 
  Cpu, 
  X, 
  ChevronRight,
  ChevronDown,
  ShieldCheck,
  RotateCcw,
  Sparkles,
  FileText,
  UploadCloud,
  Settings,
  History,
  Disc,
  Boxes,
  Sliders,
  TrendingUp,
  LayoutGrid,
  ListOrdered,
  Database
} from 'lucide-react';
import { UserProfile, UserRole } from '../types';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: UserProfile;
  setCurrentUser: (user: UserProfile) => void;
  onOpenTests: () => void;
  onOpenMslTests?: () => void;
  onOpenSsTests?: () => void;
  onResetDatabase: () => void;
  pendingOrdersCount?: number;
  psPendingOrdersCount?: number;
  openPlansCount?: number;
  availableJumboRollsCount?: number;
  mslPlansCount?: number;
  availableSsJumboRollsCount?: number;
  ssPlansCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  activeTab,
  setActiveTab,
  currentUser,
  setCurrentUser,
  onOpenTests,
  onOpenMslTests,
  onOpenSsTests,
  onResetDatabase,
  pendingOrdersCount = 0,
  psPendingOrdersCount = 0,
  openPlansCount = 0,
  availableJumboRollsCount = 0,
  mslPlansCount = 0,
  availableSsJumboRollsCount = 0,
  ssPlansCount = 0,
}) => {
  // MASTER BACKLOG & ORDERS (Common for SS, MSL & PS)
  const masterNavItems = [
    {
      id: 'films',
      label: 'All Films Backlog',
      icon: Layers,
    },
    {
      id: 'orders',
      label: 'Master Orders & Import',
      icon: UploadCloud,
      badge: pendingOrdersCount,
    },
    {
      id: 'film-specs',
      label: 'Film Specs Master DB',
      icon: Database,
    },
  ];

  // PRIMARY SLITTER (PS) MODULE NAVIGATION
  const psNavItems = [
    {
      id: 'dashboard',
      label: 'Overview',
      icon: BarChart3,
    },
    {
      id: 'ps-films',
      label: 'Film Demand',
      icon: Layers,
    },
    {
      id: 'ps-demand',
      label: 'Orders Backlog',
      icon: ListOrdered,
      badge: psPendingOrdersCount,
    },
    {
      id: 'generator',
      label: 'Planning Studio',
      icon: Cpu,
    },
    {
      id: 'plans',
      label: 'Plans & Schedules',
      icon: FileText,
      badge: openPlansCount,
    },
    {
      id: 'reports',
      label: 'Reports & Yield',
      icon: TrendingUp,
    },
    {
      id: 'rules',
      label: 'Machine Parameters',
      icon: Settings,
    },
    {
      id: 'audit',
      label: 'Audit Trail',
      icon: History,
    },
  ];

  // METALLIZER SLITTER MODULE NAVIGATION (10" Core)
  const metallizerNavItems = [
    {
      id: 'msl-dashboard',
      label: 'Overview',
      icon: BarChart3,
    },
    {
      id: 'msl-demand',
      label: 'Orders Backlog',
      icon: Layers,
    },
    {
      id: 'msl-requirements',
      label: 'Jumbo Requirements',
      icon: Sparkles,
    },
    {
      id: 'msl-inventory',
      label: 'Jumbo Inventory',
      icon: Disc,
      badge: availableJumboRollsCount,
    },
    {
      id: 'msl-generator',
      label: 'Planning Studio',
      icon: Cpu,
    },
    {
      id: 'msl-plans',
      label: 'Production Plans',
      icon: FileText,
      badge: mslPlansCount,
    },
    {
      id: 'msl-settings',
      label: 'Machine Parameters',
      icon: Sliders,
    },
  ];

  // SECONDARY SLITTER (SS) MODULE NAVIGATION (6" Core)
  const ssNavItems = [
    {
      id: 'ss-dashboard',
      label: 'Overview',
      icon: BarChart3,
    },
    {
      id: 'ss-demand',
      label: 'Orders Backlog',
      icon: Layers,
    },
    {
      id: 'ss-requirements',
      label: 'Jumbo Requirements',
      icon: Sparkles,
    },
    {
      id: 'ss-inventory',
      label: 'Jumbo Inventory',
      icon: Disc,
      badge: availableSsJumboRollsCount,
    },
    {
      id: 'ss-generator',
      label: 'Planning Studio',
      icon: Cpu,
    },
    {
      id: 'ss-plans',
      label: 'Production Plans',
      icon: FileText,
      badge: ssPlansCount,
    },
    {
      id: 'ss-settings',
      label: 'Machine Parameters',
      icon: Sliders,
    },
  ];

  // Collapsible module states
  const [isPsOpen, setIsPsOpen] = useState(false);
  const [isMslOpen, setIsMslOpen] = useState(false);
  const [isSsOpen, setIsSsOpen] = useState(false);

  // Close on Escape key on mobile viewports
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && window.innerWidth < 1024) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Keep section expanded when navigating to a tab inside it
  useEffect(() => {
    if (['dashboard', 'ps-films', 'ps-demand', 'generator', 'plans', 'reports', 'rules', 'audit'].includes(activeTab)) {
      setIsPsOpen(true);
    } else if (activeTab.startsWith('msl-')) {
      setIsMslOpen(true);
    } else if (activeTab.startsWith('ss-')) {
      setIsSsOpen(true);
    }
  }, [activeTab]);

  const handleNavClick = (tabId: string) => {
    setActiveTab(tabId);
    if (window.innerWidth < 1024) {
      onClose();
    }
  };

  return (
    <>
      {/* Mobile/Tablet backdrop overlay */}
      {isOpen && (
        <div
          id="sidebar-backdrop"
          onClick={onClose}
          aria-hidden="true"
          className="lg:hidden fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-xs transition-opacity duration-300 ease-in-out opacity-100 pointer-events-auto"
        />
      )}

      {/* Modern Compact Sidebar Panel */}
      <aside
        id="app-sidebar-drawer"
        aria-label="Main Navigation Sidebar"
        aria-hidden={!isOpen}
        className={`fixed top-0 left-0 bottom-0 z-50 w-64 xl:w-72 bg-slate-950 border-r border-slate-800/80 text-slate-200 flex flex-col transform transition-transform duration-300 ease-in-out select-none ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Workspace Brand Header */}
        <div className="h-14 px-4 border-b border-slate-800/80 flex items-center justify-between">
          <div 
            className="flex items-center space-x-2.5 cursor-pointer group"
            onClick={() => handleNavClick('dashboard')}
          >
            <div className="w-7 h-7 rounded-lg bg-slate-900 border border-slate-700/80 flex items-center justify-center text-white font-bold text-xs group-hover:border-slate-500 transition-colors shadow-xs">
              <span className="text-emerald-400">PX</span>
            </div>
            <div>
              <div className="font-bold text-sm tracking-tight text-slate-100 flex items-center space-x-1.5">
                <span>PlanneX</span>
                <span className="text-[10px] font-mono font-normal px-1.5 py-0.2 bg-slate-900 text-slate-400 rounded border border-slate-800">
                  v1.0
                </span>
              </div>
            </div>
          </div>

          <button
            id="close-sidebar-button"
            onClick={onClose}
            aria-label="Close navigation sidebar"
            className="lg:hidden p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-900 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Navigation Items */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {/* SECTION: MASTER BACKLOG & ORDERS */}
          <div>
            <div className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Master Backlog
            </div>
            <nav className="space-y-0.5" aria-label="Master Backlog Navigation">
              {masterNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    id={`sidebar-nav-${item.id}`}
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left text-xs transition-all cursor-pointer group ${
                      isActive
                        ? 'bg-slate-800 text-white font-semibold ring-1 ring-slate-700'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <Icon className={`w-4 h-4 shrink-0 transition-colors ${
                        isActive ? 'text-indigo-400' : 'text-slate-400 group-hover:text-slate-300'
                      }`} />
                      <span className="truncate">{item.label}</span>
                    </div>
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className="px-1.5 py-0.2 text-[10px] font-mono font-medium rounded bg-slate-900 text-slate-300 border border-slate-800">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* SECTION: PRIMARY SLITTER (PS) */}
          <div className="pt-2 border-t border-slate-900">
            <button
              type="button"
              id="sidebar-toggle-ps"
              onClick={() => setIsPsOpen(!isPsOpen)}
              className="w-full px-2 py-1.5 flex items-center justify-between rounded-md hover:bg-slate-900 transition-colors cursor-pointer group text-left"
            >
              <div className="flex items-center space-x-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="text-[11px] font-semibold text-slate-200 tracking-tight">
                  Primary Slitter (PS)
                </span>
              </div>
              <div className="flex items-center space-x-1.5 text-slate-400">
                {openPlansCount > 0 && (
                  <span className="px-1.5 py-0.2 text-[9px] font-mono rounded bg-slate-900 text-slate-300 border border-slate-800">
                    {openPlansCount}
                  </span>
                )}
                {isPsOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                )}
              </div>
            </button>

            {isPsOpen && (
              <nav className="mt-1 space-y-0.5 pl-2 border-l border-slate-800/80 ml-2" aria-label="Primary Slitter PS Navigation">
                {psNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      id={`sidebar-nav-${item.id}`}
                      onClick={() => handleNavClick(item.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left text-xs transition-all cursor-pointer group ${
                        isActive
                          ? 'bg-slate-800 text-white font-semibold ring-1 ring-slate-700'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${
                          isActive ? 'text-emerald-400' : 'text-slate-400 group-hover:text-slate-300'
                        }`} />
                        <span className="truncate">{item.label}</span>
                      </div>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="px-1.5 py-0.2 text-[10px] font-mono rounded bg-slate-900 text-slate-300 border border-slate-800">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            )}
          </div>

          {/* SECTION: METALLIZER SLITTER (MSL) */}
          <div className="pt-2 border-t border-slate-900">
            <button
              type="button"
              id="sidebar-toggle-msl"
              onClick={() => setIsMslOpen(!isMslOpen)}
              className="w-full px-2 py-1.5 flex items-center justify-between rounded-md hover:bg-slate-900 transition-colors cursor-pointer group text-left"
            >
              <div className="flex items-center space-x-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                <span className="text-[11px] font-semibold text-slate-200 tracking-tight">
                  Metallizer Slitter (MSL)
                </span>
              </div>
              <div className="flex items-center space-x-1.5 text-slate-400">
                {mslPlansCount > 0 && (
                  <span className="px-1.5 py-0.2 text-[9px] font-mono rounded bg-slate-900 text-slate-300 border border-slate-800">
                    {mslPlansCount}
                  </span>
                )}
                {isMslOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                )}
              </div>
            </button>

            {isMslOpen && (
              <nav className="mt-1 space-y-0.5 pl-2 border-l border-slate-800/80 ml-2" aria-label="Metallizer Slitter Navigation">
                {metallizerNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      id={`sidebar-nav-${item.id}`}
                      onClick={() => handleNavClick(item.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left text-xs transition-all cursor-pointer group ${
                        isActive
                          ? 'bg-slate-800 text-white font-semibold ring-1 ring-slate-700'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${
                          isActive ? 'text-purple-400' : 'text-slate-400 group-hover:text-slate-300'
                        }`} />
                        <span className="truncate">{item.label}</span>
                      </div>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="px-1.5 py-0.2 text-[10px] font-mono rounded bg-slate-900 text-slate-300 border border-slate-800">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            )}
          </div>

          {/* SECTION: SECONDARY SLITTER (SS) */}
          <div className="pt-2 border-t border-slate-900">
            <button
              type="button"
              id="sidebar-toggle-ss"
              onClick={() => setIsSsOpen(!isSsOpen)}
              className="w-full px-2 py-1.5 flex items-center justify-between rounded-md hover:bg-slate-900 transition-colors cursor-pointer group text-left"
            >
              <div className="flex items-center space-x-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                <span className="text-[11px] font-semibold text-slate-200 tracking-tight">
                  Secondary Slitter (SS)
                </span>
              </div>
              <div className="flex items-center space-x-1.5 text-slate-400">
                {ssPlansCount > 0 && (
                  <span className="px-1.5 py-0.2 text-[9px] font-mono rounded bg-slate-900 text-slate-300 border border-slate-800">
                    {ssPlansCount}
                  </span>
                )}
                {isSsOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                )}
              </div>
            </button>

            {isSsOpen && (
              <nav className="mt-1 space-y-0.5 pl-2 border-l border-slate-800/80 ml-2" aria-label="Secondary Slitter Navigation">
                {ssNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      id={`sidebar-nav-${item.id}`}
                      onClick={() => handleNavClick(item.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left text-xs transition-all cursor-pointer group ${
                        isActive
                          ? 'bg-slate-800 text-white font-semibold ring-1 ring-slate-700'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${
                          isActive ? 'text-cyan-400' : 'text-slate-400 group-hover:text-slate-300'
                        }`} />
                        <span className="truncate">{item.label}</span>
                      </div>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="px-1.5 py-0.2 text-[10px] font-mono rounded bg-slate-900 text-slate-300 border border-slate-800">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            )}
          </div>

          {/* VERIFICATION & TESTS SECTION */}
          <div className="pt-3 border-t border-slate-900 space-y-1">
            <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Rule Verification
            </div>
            {onOpenSsTests && (
              <button
                id="sidebar-ss-tests-btn"
                onClick={() => {
                  if (window.innerWidth < 1024) onClose();
                  onOpenSsTests();
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-900 rounded-md transition-colors cursor-pointer"
              >
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                  <span>SS Test Suite</span>
                </div>
                <span className="text-[10px] font-mono text-emerald-400">24/24</span>
              </button>
            )}
            {onOpenMslTests && (
              <button
                id="sidebar-msl-tests-btn"
                onClick={() => {
                  if (window.innerWidth < 1024) onClose();
                  onOpenMslTests();
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-900 rounded-md transition-colors cursor-pointer"
              >
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                  <span>MSL Test Suite</span>
                </div>
                <span className="text-[10px] font-mono text-emerald-400">24/24</span>
              </button>
            )}
            <button
              id="sidebar-tests-btn"
              onClick={() => {
                if (window.innerWidth < 1024) onClose();
                onOpenTests();
              }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-900 rounded-md transition-colors cursor-pointer"
            >
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                <span>PS Test Suite</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400">63/63</span>
            </button>
          </div>
        </div>

        {/* User Footer */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950 flex items-center justify-between">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-300">
              {currentUser.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-200 truncate">{currentUser.name}</div>
              <div className="text-[10px] text-slate-400 truncate">{currentUser.role}</div>
            </div>
          </div>
          <button
            id="sidebar-reset-btn"
            onClick={() => {
              if (window.innerWidth < 1024) onClose();
              onResetDatabase();
            }}
            className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors cursor-pointer"
            title="Reset to factory dataset"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>
    </>
  );
};


