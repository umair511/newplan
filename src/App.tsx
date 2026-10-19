import React, { useState, useEffect } from 'react';
import { 
  VA05Order, 
  SlitterPlan, 
  PlanningRun, 
  ImportBatch, 
  PlanningRules, 
  AuditLogEntry, 
  UserProfile,
  PlanStatus 
} from './types';
import { ThemeId } from './types/theme';
import { getStoredTheme, saveStoredTheme, applyThemeToDocument } from './services/themeStorage';
import { 
  JumboRoll,
  MetallizerPlan,
  JumboRequirement,
  MetallizerMachineSettings
} from './types/metallizer';
import {
  SSJumboRoll,
  SSPlan,
  SSJumboRequirement,
  SSMachineSettings
} from './types/ss';
import { 
  getStoredOrders, 
  saveStoredOrders, 
  getStoredPlans, 
  saveStoredPlans, 
  getStoredRuns, 
  saveStoredRuns,
  getStoredPlanningRuns,
  saveStoredPlanningRuns, 
  getStoredBatches, 
  saveStoredBatches, 
  getStoredRules, 
  saveStoredRules, 
  getStoredAuditLogs, 
  logAuditEvent, 
  resetDatabaseToSeed,
  STORAGE_KEYS
} from './services/storage';
import {
  getStoredJumboRolls,
  saveStoredJumboRolls,
  getStoredMetallizerPlans,
  saveStoredMetallizerPlans,
  getStoredJumboRequirements,
  saveStoredJumboRequirements,
  getStoredMetallizerSettings,
  saveStoredMetallizerSettings,
  deleteMetallizerPlansWithLedgerReversal
} from './services/metallizer/metallizerStorage';
import {
  getStoredSSJumboRolls,
  saveStoredSSJumboRolls,
  getStoredSSPlans,
  saveStoredSSPlans,
  getStoredSSJumboRequirements,
  saveStoredSSJumboRequirements,
  getStoredSSSettings,
  saveStoredSSSettings,
  deleteSSPlansWithLedgerReversal
} from './services/ss/ssStorage';

// PS01 Components (Locked & Untouched)
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { PS01FilmDemand } from './components/PS01FilmDemand';
import { PS01Demand } from './components/PS01Demand';
import { OrdersImport } from './components/OrdersImport';
import { FilmsDashboard } from './components/FilmsDashboard';
import { PlanGeneratorStudio } from './components/PlanGeneratorStudio';
import { isPS01Order } from './services/optimizer/deckleOptimizer';
import { PlanningRunsList } from './components/PlanningRunsList';
import { PlanDetailViewer } from './components/PlanDetailViewer';
import { ReportsView } from './components/ReportsView';
import { MastersRules } from './components/MastersRules';
import { FilmSpecsManager } from './components/stuffing/FilmSpecsManager';
import { AuditLogView } from './components/AuditLogView';
import { TestSuiteModal } from './components/TestSuiteModal';

// Metallizer Slitter Components (Isolated Module)
import { MetallizerDashboard } from './components/metallizer/MetallizerDashboard';
import { MetallizerDemand } from './components/metallizer/MetallizerDemand';
import { JumboRequirementsView } from './components/metallizer/JumboRequirementsView';
import { JumboInventoryView } from './components/metallizer/JumboInventoryView';
import { MetallizerPlanningStudio } from './components/metallizer/MetallizerPlanningStudio';
import { MetallizerPlansList } from './components/metallizer/MetallizerPlansList';
import { MetallizerPlanDetailViewer } from './components/metallizer/MetallizerPlanDetailViewer';
import { RollConsumptionView } from './components/metallizer/RollConsumptionView';
import { MetallizerReportsView } from './components/metallizer/MetallizerReportsView';
import { MetallizerSettingsView } from './components/metallizer/MetallizerSettingsView';
import { MetallizerTestSuiteModal } from './components/metallizer/MetallizerTestSuiteModal';

// Secondary Slitter (SS) Components (Independent Module)
import { SSDashboard } from './components/ss/SSDashboard';
import { SSDemand } from './components/ss/SSDemand';
import { SSJumboRequirementsView } from './components/ss/SSJumboRequirementsView';
import { SSJumboInventoryView } from './components/ss/SSJumboInventoryView';
import { SSPlanningStudio } from './components/ss/SSPlanningStudio';
import { SSPlansList } from './components/ss/SSPlansList';
import { SSPlanDetailViewer } from './components/ss/SSPlanDetailViewer';
import { SSRollConsumptionView } from './components/ss/SSRollConsumptionView';
import { SSReportsView } from './components/ss/SSReportsView';
import { SSSettingsView } from './components/ss/SSSettingsView';
import { SSTestSuiteModal } from './components/ss/SSTestSuiteModal';

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile>({
    id: 'user-planner-01',
    name: 'Muhammad Tariq',
    role: 'PLANNER',
    department: 'Slitter Planning Department',
  });

  const [activeTab, setActiveTab] = useState<string>('films');
  const [preselectedFilm, setPreselectedFilm] = useState<string | undefined>('TNO20');
  const [preselectedMslFilm, setPreselectedMslFilm] = useState<string>('MZ18');
  const [preselectedSsFilm, setPreselectedSsFilm] = useState<string>('TH21-20');

  // PS01 Application Data States
  const [orders, setOrders] = useState<VA05Order[]>([]);
  const [plans, setPlans] = useState<SlitterPlan[]>([]);
  const [planningRuns, setPlanningRuns] = useState<PlanningRun[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [rules, setRules] = useState<PlanningRules>(getStoredRules());
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  // Metallizer Data States
  const [jumboRolls, setJumboRolls] = useState<JumboRoll[]>([]);
  const [metallizerPlans, setMetallizerPlans] = useState<MetallizerPlan[]>([]);
  const [jumboRequirements, setJumboRequirements] = useState<JumboRequirement[]>([]);
  const [metallizerSettings, setMetallizerSettings] = useState<MetallizerMachineSettings>(getStoredMetallizerSettings());

  // Secondary Slitter (SS) Data States
  const [ssJumboRolls, setSsJumboRolls] = useState<SSJumboRoll[]>([]);
  const [ssPlans, setSsPlans] = useState<SSPlan[]>([]);
  const [ssJumboRequirements, setSsJumboRequirements] = useState<SSJumboRequirement[]>([]);
  const [ssSettings, setSsSettings] = useState<SSMachineSettings>(getStoredSSSettings());

  // Modals
  const [selectedPlanForView, setSelectedPlanForView] = useState<SlitterPlan | null>(null);
  const [selectedMslPlanForView, setSelectedMslPlanForView] = useState<MetallizerPlan | null>(null);
  const [selectedSsPlanForView, setSelectedSsPlanForView] = useState<SSPlan | null>(null);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [isMslTestModalOpen, setIsMslTestModalOpen] = useState(false);
  const [isSsTestModalOpen, setIsSsTestModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => 
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );

  // Active UI Theme
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(getStoredTheme);

  // Apply theme to document on mount and change
  useEffect(() => {
    applyThemeToDocument(currentTheme);
  }, [currentTheme]);

  const handleThemeChange = (newTheme: ThemeId) => {
    setCurrentTheme(newTheme);
    saveStoredTheme(newTheme);
  };

  // Initialize and load persisted data
  const loadData = () => {
    setOrders(getStoredOrders());
    setPlans(getStoredPlans());
    setPlanningRuns(getStoredRuns());
    setBatches(getStoredBatches());
    setRules(getStoredRules());
    setAuditLogs(getStoredAuditLogs());

    // Metallizer
    setJumboRolls(getStoredJumboRolls());
    setMetallizerPlans(getStoredMetallizerPlans());
    setJumboRequirements(getStoredJumboRequirements());
    setMetallizerSettings(getStoredMetallizerSettings());

    // Secondary Slitter (SS)
    setSsJumboRolls(getStoredSSJumboRolls());
    setSsPlans(getStoredSSPlans());
    setSsJumboRequirements(getStoredSSJumboRequirements());
    setSsSettings(getStoredSSSettings());
  };

  useEffect(() => {
    // One-time startup migration: ensure no pre-generated / demo plans exist on initial load.
    // Planner must generate all plans from clean slate.
    const CLEAN_START_KEY = 'gpak_clean_start_manual_v1';
    if (typeof window !== 'undefined' && !localStorage.getItem(CLEAN_START_KEY)) {
      localStorage.setItem(CLEAN_START_KEY, 'true');
      localStorage.removeItem(STORAGE_KEYS.PLANS);
      localStorage.removeItem(STORAGE_KEYS.RUNS);
      localStorage.removeItem('gpak_msl_plans_v1');
      localStorage.removeItem('gpak_msl_plans_version_v2');
      localStorage.removeItem('gpak_ss_plans_v1');

      // Restore all order demand to 100% available/unfulfilled state
      const stored = getStoredOrders();
      const resetOrders = stored.map(o => ({
        ...o,
        produced_qty: 0,
        remaining_qty: o.balance_qty || o.ordered_qty,
        status: 'PENDING' as const,
      }));
      saveStoredOrders(resetOrders);
    }
    loadData();
  }, []);

  const handleResetDatabase = () => {
    if (window.confirm('Are you sure you want to reset all data back to the original factory seed order backlog?')) {
      resetDatabaseToSeed();
      loadData();
      logAuditEvent(currentUser, 'UPDATE', 'DATABASE', 'RESET', 'Database reset to factory seed dataset');
    }
  };

  const handleTogglePriority = (orderId: string) => {
    const updated = orders.map(o => {
      if (o.id === orderId) {
        const nextPrio = !o.priority;
        logAuditEvent(
          currentUser,
          'UPDATE',
          'VA05_ORDER',
          o.sales_order,
          `Priority flag set to ${nextPrio} on SO# ${o.sales_order} Item #${o.item_number}`
        );
        return { ...o, priority: nextPrio, updated_at: new Date().toISOString() };
      }
      return o;
    });
    setOrders(updated);
    saveStoredOrders(updated);
  };

  const handlePlanFilm = (film: string) => {
    setPreselectedFilm(film);
    setActiveTab('generator');
  };

  const handleMslPlanFilm = (film: string) => {
    setPreselectedMslFilm(film);
    setActiveTab('msl-generator');
  };

  const handleSsPlanFilm = (film: string) => {
    setPreselectedSsFilm(film);
    setActiveTab('ss-generator');
  };

  const handleRunCommitted = (run: PlanningRun, newPlans: SlitterPlan[], remainingOrders: VA05Order[]) => {
    loadData();
  };

  const handleMslRunCommitted = (newPlans: MetallizerPlan[], updatedRolls: JumboRoll[], updatedOrders: VA05Order[]) => {
    setMetallizerPlans(newPlans);
    setJumboRolls(updatedRolls);
    setOrders(updatedOrders);
  };

  const handleSsRunCommitted = (newPlans: SSPlan[], updatedRolls: SSJumboRoll[], updatedOrders: VA05Order[]) => {
    setSsPlans(newPlans);
    setSsJumboRolls(updatedRolls);
    setOrders(updatedOrders);
  };

  // PLX-A07: deleting a plan must also return its jumbo length and its order
  // demand to the ledger, otherwise the material is orphaned and the demand is
  // silently lost. Plans + rolls + orders are committed as one batch (PLX-A06).
  const handleDeleteMslPlan = (planId: string) => {
    const result = deleteMetallizerPlansWithLedgerReversal([planId], currentUser);
    if (!result.committed) {
      alert('Could not delete the plan: the storage commit failed and was rolled back. No changes were made.');
      return;
    }
    setMetallizerPlans(result.plans);
    setJumboRolls(result.rolls);
    setOrders(result.orders);
  };

  const handleDeleteAllMslPlans = () => {
    const result = deleteMetallizerPlansWithLedgerReversal(metallizerPlans.map(p => p.id), currentUser);
    if (!result.committed) {
      alert('Could not delete the plans: the storage commit failed and was rolled back. No changes were made.');
      return;
    }
    setMetallizerPlans(result.plans);
    setJumboRolls(result.rolls);
    setOrders(result.orders);
  };

  const handleDeleteSsPlan = (planId: string) => {
    const result = deleteSSPlansWithLedgerReversal([planId], currentUser);
    if (!result.committed) {
      alert('Could not delete the plan: the storage commit failed and was rolled back. No changes were made.');
      return;
    }
    setSsPlans(result.plans);
    setSsJumboRolls(result.rolls);
    setOrders(result.orders);
  };

  const handleDeleteAllSsPlans = () => {
    const result = deleteSSPlansWithLedgerReversal(ssPlans.map(p => p.id), currentUser);
    if (!result.committed) {
      alert('Could not delete the plans: the storage commit failed and was rolled back. No changes were made.');
      return;
    }
    setSsPlans(result.plans);
    setSsJumboRolls(result.rolls);
    setOrders(result.orders);
  };

  const handleDeletePrimaryPlan = (planId: string) => {
    const updatedPlans = plans.filter(p => p.id !== planId);
    setPlans(updatedPlans);
    saveStoredPlans(updatedPlans);
    logAuditEvent(
      currentUser,
      'STATUS_CHANGE',
      'SLITTER_PLAN',
      planId,
      `Deleted Primary Slitter plan ${planId}`
    );
    setAuditLogs(getStoredAuditLogs());
  };

  const handleDeleteAllPrimaryPlans = () => {
    setPlans([]);
    saveStoredPlans([]);
    logAuditEvent(
      currentUser,
      'STATUS_CHANGE',
      'SLITTER_PLAN',
      'ALL_PLANS',
      `Deleted all Primary Slitter plans`
    );
    setAuditLogs(getStoredAuditLogs());
  };

  const handleDeletePrimaryRun = (runId: string) => {
    const updatedRuns = planningRuns.filter(r => r.id !== runId && r.run_number !== runId);
    setPlanningRuns(updatedRuns);
    saveStoredPlanningRuns(updatedRuns);
    logAuditEvent(
      currentUser,
      'STATUS_CHANGE',
      'PLANNING_RUN',
      runId,
      `Deleted Primary planning run ${runId}`
    );
    setAuditLogs(getStoredAuditLogs());
  };

  const handleDeleteAllPrimaryRuns = () => {
    setPlanningRuns([]);
    saveStoredPlanningRuns([]);
    logAuditEvent(
      currentUser,
      'STATUS_CHANGE',
      'PLANNING_RUN',
      'ALL_RUNS',
      `Deleted all Primary planning runs`
    );
    setAuditLogs(getStoredAuditLogs());
  };

  const handleUpdatePlanStatus = (planId: string, newStatus: PlanStatus, notes?: string) => {
    const updatedPlans = plans.map(p => {
      if (p.id === planId) {
        const updated = {
          ...p,
          status: newStatus,
          approved_by: newStatus === 'APPROVED' ? currentUser.name : p.approved_by,
          approved_at: newStatus === 'APPROVED' ? new Date().toISOString() : p.approved_at,
          notes: notes ? `${p.notes ? p.notes + ' | ' : ''}${notes}` : p.notes,
        };
        if (selectedPlanForView && selectedPlanForView.id === planId) {
          setSelectedPlanForView(updated);
        }
        return updated;
      }
      return p;
    });

    setPlans(updatedPlans);
    saveStoredPlans(updatedPlans);

    logAuditEvent(
      currentUser,
      newStatus === 'APPROVED' ? 'APPROVE' : 'STATUS_CHANGE',
      'SLITTER_PLAN',
      planId,
      `Status changed to ${newStatus}${notes ? ` Notes: ${notes}` : ''}`
    );
    setAuditLogs(getStoredAuditLogs());
  };

  const ps01Orders = orders.filter(isPS01Order);
  const pendingOrdersCount = ps01Orders.filter(o => o.remaining_qty > 0).length;
  const psPendingOrdersCount = pendingOrdersCount;
  const openPlansCount = plans.filter(p => p.status === 'DRAFT' || p.status === 'APPROVED').length;
  const availableJumboRollsCount = jumboRolls.filter(r => r.status === 'AVAILABLE' || r.status === 'PARTIALLY_CONSUMED').length;
  const mslPlansCount = metallizerPlans.length;
  const availableSsJumboRollsCount = ssJumboRolls.filter(r => r.status === 'AVAILABLE' || r.status === 'PARTIALLY_CONSUMED').length;
  const ssPlansCount = ssPlans.length;

  return (
    <div className={`min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-slate-900 selection:text-white theme-${currentTheme}`}>
      {/* Top Modern Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentUser={currentUser}
        setCurrentUser={setCurrentUser}
        onOpenTests={() => setIsTestModalOpen(true)}
        onResetDatabase={handleResetDatabase}
        onToggleSidebar={() => setIsSidebarOpen(prev => !prev)}
        isSidebarOpen={isSidebarOpen}
        pendingOrdersCount={pendingOrdersCount}
        openPlansCount={openPlansCount}
        currentTheme={currentTheme}
        onSelectTheme={handleThemeChange}
      />

      {/* Collapsible Left Navigation Sidebar Drawer */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentUser={currentUser}
        setCurrentUser={setCurrentUser}
        onOpenTests={() => setIsTestModalOpen(true)}
        onOpenMslTests={() => setIsMslTestModalOpen(true)}
        onOpenSsTests={() => setIsSsTestModalOpen(true)}
        onResetDatabase={handleResetDatabase}
        pendingOrdersCount={pendingOrdersCount}
        psPendingOrdersCount={psPendingOrdersCount}
        openPlansCount={openPlansCount}
        availableJumboRollsCount={availableJumboRollsCount}
        mslPlansCount={mslPlansCount}
        availableSsJumboRollsCount={availableSsJumboRollsCount}
        ssPlansCount={ssPlansCount}
      />

      {/* Main Content Area and Footer with responsive sidebar offset */}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ease-in-out ${
        isSidebarOpen ? 'lg:pl-64 xl:pl-72' : 'pl-0'
      }`}>
        <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-6">
          {/* ========================================================================= */}
          {/* SECTION 1: SECONDARY SLITTER (SS) VIEWS (INDEPENDENT MODULE) */}
          {/* ========================================================================= */}
          {activeTab === 'ss-dashboard' && (
            <SSDashboard
              orders={orders}
              jumboRolls={ssJumboRolls}
              plans={ssPlans}
              requirements={ssJumboRequirements}
              onNavigate={(tab, film) => {
                if (film) setPreselectedSsFilm(film);
                setActiveTab(tab);
              }}
              onOpenPlan={(plan) => setSelectedSsPlanForView(plan)}
              onOpenTests={() => setIsSsTestModalOpen(true)}
            />
          )}

          {activeTab === 'ss-demand' && (
            <SSDemand
              orders={orders}
              onPlanFilm={handleSsPlanFilm}
              onGenerateRequirements={(film) => {
                if (film) setPreselectedSsFilm(film);
                setActiveTab('ss-requirements');
              }}
              onTogglePriority={handleTogglePriority}
            />
          )}

          {activeTab === 'ss-requirements' && (
            <SSJumboRequirementsView
              orders={orders}
              requirements={ssJumboRequirements}
              plans={ssPlans}
              settings={ssSettings}
              onSettingsSaved={(newSettings) => setSsSettings(newSettings)}
              currentUser={currentUser}
              preselectedFilm={preselectedSsFilm}
              onRequirementsUpdated={(reqs) => setSsJumboRequirements(reqs)}
              onNavigateToStudio={() => setActiveTab('ss-generator')}
            />
          )}

          {activeTab === 'ss-inventory' && (
            <SSJumboInventoryView
              jumboRolls={ssJumboRolls}
              settings={ssSettings}
              onJumboRollsUpdated={(rolls) => setSsJumboRolls(rolls)}
            />
          )}

          {activeTab === 'ss-generator' && (
            <SSPlanningStudio
              orders={orders}
              jumboRolls={ssJumboRolls}
              plans={ssPlans}
              settings={ssSettings}
              currentUser={currentUser}
              preselectedFilm={preselectedSsFilm}
              onRunCommitted={handleSsRunCommitted}
              onOpenPlan={(plan) => setSelectedSsPlanForView(plan)}
            />
          )}

          {activeTab === 'ss-plans' && (
            <SSPlansList
              plans={ssPlans}
              onOpenPlan={(plan) => setSelectedSsPlanForView(plan)}
              onNewPlan={() => setActiveTab('ss-generator')}
              onDeletePlan={handleDeleteSsPlan}
              onDeleteAllPlans={handleDeleteAllSsPlans}
            />
          )}

          {activeTab === 'ss-consumption' && (
            <SSRollConsumptionView
              jumboRolls={ssJumboRolls}
              plans={ssPlans}
              onOpenPlan={(plan) => setSelectedSsPlanForView(plan)}
            />
          )}

          {activeTab === 'ss-reports' && (
            <SSReportsView
              orders={orders}
              jumboRolls={ssJumboRolls}
              plans={ssPlans}
              requirements={ssJumboRequirements}
            />
          )}

          {activeTab === 'ss-settings' && (
            <SSSettingsView
              settings={ssSettings}
              onSettingsSaved={(newSettings) => setSsSettings(newSettings)}
            />
          )}

          {/* ========================================================================= */}
          {/* SECTION 2: METALLIZER SLITTER VIEWS (ISOLATED MODULE) */}
          {/* ========================================================================= */}
          {activeTab === 'msl-dashboard' && (
            <MetallizerDashboard
              orders={orders}
              jumboRolls={jumboRolls}
              plans={metallizerPlans}
              requirements={jumboRequirements}
              onNavigate={(tab, film) => {
                if (film) setPreselectedMslFilm(film);
                setActiveTab(tab);
              }}
              onOpenPlan={(plan) => setSelectedMslPlanForView(plan)}
              onOpenTests={() => setIsMslTestModalOpen(true)}
            />
          )}

          {activeTab === 'msl-demand' && (
            <MetallizerDemand
              orders={orders}
              onPlanFilm={handleMslPlanFilm}
              onGenerateRequirements={(film) => {
                if (film) setPreselectedMslFilm(film);
                setActiveTab('msl-requirements');
              }}
              onTogglePriority={handleTogglePriority}
            />
          )}

          {activeTab === 'msl-requirements' && (
            <JumboRequirementsView
              orders={orders}
              requirements={jumboRequirements}
              plans={metallizerPlans}
              settings={metallizerSettings}
              currentUser={currentUser}
              preselectedFilm={preselectedMslFilm}
              onRequirementsUpdated={(reqs) => setJumboRequirements(reqs)}
              onJumboRollsUpdated={(rolls) => setJumboRolls(rolls)}
              onSettingsSaved={(newSettings) => setMetallizerSettings(newSettings)}
              onNavigateToStudio={() => {
                setJumboRolls(getStoredJumboRolls());
                setActiveTab('msl-generator');
              }}
            />
          )}

          {activeTab === 'msl-inventory' && (
            <JumboInventoryView
              jumboRolls={jumboRolls}
              settings={metallizerSettings}
              onJumboRollsUpdated={(rolls) => setJumboRolls(rolls)}
            />
          )}

          {activeTab === 'msl-generator' && (
            <MetallizerPlanningStudio
              orders={orders}
              jumboRolls={jumboRolls}
              plans={metallizerPlans}
              settings={metallizerSettings}
              onSettingsSaved={(newSettings) => setMetallizerSettings(newSettings)}
              currentUser={currentUser}
              preselectedFilm={preselectedMslFilm}
              onRunCommitted={handleMslRunCommitted}
              onOpenPlan={(plan) => setSelectedMslPlanForView(plan)}
            />
          )}

          {activeTab === 'msl-plans' && (
            <MetallizerPlansList
              plans={metallizerPlans}
              onOpenPlan={(plan) => setSelectedMslPlanForView(plan)}
              onNewPlan={() => setActiveTab('msl-generator')}
              onDeletePlan={handleDeleteMslPlan}
              onDeleteAllPlans={handleDeleteAllMslPlans}
            />
          )}

          {activeTab === 'msl-consumption' && (
            <RollConsumptionView
              jumboRolls={jumboRolls}
              plans={metallizerPlans}
              onOpenPlan={(plan) => setSelectedMslPlanForView(plan)}
            />
          )}

          {activeTab === 'msl-reports' && (
            <MetallizerReportsView
              orders={orders}
              jumboRolls={jumboRolls}
              plans={metallizerPlans}
              requirements={jumboRequirements}
            />
          )}

          {activeTab === 'msl-settings' && (
            <MetallizerSettingsView
              settings={metallizerSettings}
              onSettingsSaved={(newSettings) => setMetallizerSettings(newSettings)}
            />
          )}

          {/* ========================================================================= */}
          {/* SECTION 3: PRIMARY SLITTER PS01 VIEWS (LOCKED & FROZEN) */}
          {/* ========================================================================= */}
          {activeTab === 'dashboard' && (
            <Dashboard
              orders={orders}
              plans={plans}
              planningRuns={planningRuns}
              onNavigate={(tab, film) => {
                if (film) setPreselectedFilm(film);
                setActiveTab(tab);
              }}
              onOpenPlan={(plan) => setSelectedPlanForView(plan)}
              onOpenTests={() => setIsTestModalOpen(true)}
            />
          )}

          {activeTab === 'ps-films' && (
            <PS01FilmDemand
              orders={orders}
              plans={plans}
              onPlanFilm={handlePlanFilm}
              onNavigate={(tab, film) => {
                if (film) setPreselectedFilm(film);
                setActiveTab(tab);
              }}
            />
          )}

          {activeTab === 'ps-demand' && (
            <PS01Demand
              orders={orders}
              onPlanFilm={handlePlanFilm}
              onTogglePriority={handleTogglePriority}
            />
          )}

          {activeTab === 'film-specs' && (
            <FilmSpecsManager />
          )}

          {activeTab === 'orders' && (
            <OrdersImport
              orders={orders}
              batches={batches}
              currentUser={currentUser}
              onOrdersUpdated={(newOrders) => setOrders(newOrders)}
              onBatchesUpdated={(newBatches) => setBatches(newBatches)}
              onTogglePriority={handleTogglePriority}
              onPlanFilm={handlePlanFilm}
            />
          )}

          {activeTab === 'films' && (
            <FilmsDashboard
              orders={orders}
              plans={plans}
              onPlanFilm={handlePlanFilm}
            />
          )}

          {activeTab === 'generator' && (
            <PlanGeneratorStudio
              orders={orders}
              rules={rules}
              onRulesUpdated={(newRules) => setRules(newRules)}
              currentUser={currentUser}
              preselectedFilm={preselectedFilm}
              onRunCommitted={handleRunCommitted}
              onOpenPlan={(plan) => setSelectedPlanForView(plan)}
            />
          )}

          {activeTab === 'plans' && (
            <PlanningRunsList
              plans={plans}
              planningRuns={planningRuns}
              orders={orders}
              currentUser={currentUser}
              onOpenPlan={(plan) => setSelectedPlanForView(plan)}
              onNewPlanRun={() => setActiveTab('generator')}
              onDeletePlan={handleDeletePrimaryPlan}
              onDeleteAllPlans={handleDeleteAllPrimaryPlans}
              onDeleteRun={handleDeletePrimaryRun}
              onDeleteAllRuns={handleDeleteAllPrimaryRuns}
            />
          )}

          {activeTab === 'reports' && (
            <ReportsView
              orders={orders}
              plans={plans}
              planningRuns={planningRuns}
            />
          )}

          {activeTab === 'rules' && (
            <MastersRules
              rules={rules}
              currentUser={currentUser}
              onRulesUpdated={(newRules) => setRules(newRules)}
            />
          )}

          {activeTab === 'audit' && (
            <AuditLogView
              logs={auditLogs}
            />
          )}
        </main>

        {/* Footer */}
        <footer className="border-t border-slate-200 bg-white text-slate-500 text-xs py-3 mt-auto">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-slate-800">PlanneX</span>
              <span className="text-slate-300">·</span>
              <span className="text-slate-500">Deterministic Planning Co-Worker</span>
            </div>
            <div className="text-slate-400 text-[11px] font-mono">
              Deterministic Engine · PS01 / MSL / SS Compliant
            </div>
          </div>
        </footer>
      </div>

      {/* PS01 Slitter Factory Sheet Viewer Modal */}
      {selectedPlanForView && (
        <PlanDetailViewer
          plan={selectedPlanForView}
          currentUser={currentUser}
          onClose={() => setSelectedPlanForView(null)}
          onUpdateStatus={handleUpdatePlanStatus}
        />
      )}

      {/* Metallizer Slitter Factory Sheet Viewer Modal */}
      {selectedMslPlanForView && (
        <MetallizerPlanDetailViewer
          plan={selectedMslPlanForView}
          currentUser={currentUser}
          onClose={() => setSelectedMslPlanForView(null)}
        />
      )}

      {/* Secondary Slitter (SS) Factory Sheet Viewer Modal */}
      {selectedSsPlanForView && (
        <SSPlanDetailViewer
          plan={selectedSsPlanForView}
          currentUser={currentUser}
          onClose={() => setSelectedSsPlanForView(null)}
        />
      )}

      {/* PS01 Acceptance Test Suite Modal */}
      {isTestModalOpen && (
        <TestSuiteModal
          onClose={() => setIsTestModalOpen(false)}
        />
      )}

      {/* Metallizer Slitter Acceptance Test Suite Modal */}
      {isMslTestModalOpen && (
        <MetallizerTestSuiteModal
          onClose={() => setIsMslTestModalOpen(false)}
        />
      )}

      {/* Secondary Slitter (SS) Acceptance Test Suite Modal */}
      {isSsTestModalOpen && (
        <SSTestSuiteModal
          onClose={() => setIsSsTestModalOpen(false)}
        />
      )}
    </div>
  );
}
