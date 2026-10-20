import React, { useState, useEffect, useMemo, useRef } from 'react';
import { VA05Order, PlanningRules, UserProfile, SlitterPlan, PlanningRun, TrimRuleMode } from '../types';
import { OptimizationResult, generatePrimarySlitterPlans, isPS01Order } from '../services/optimizer/deckleOptimizer';
import { findFilmsMissingDensity, getFilmSpecsSnapshotForPlanning } from '../services/stuffing/filmDensities';
import type { WorkerMessageResponse } from '../services/optimizer/optimizer.worker';
import OptimizerWorker from '../services/optimizer/optimizer.worker?worker&inline';
import { commitPlanningRun, getOrdersLedgerFingerprint , saveStoredRules} from '../services/storage';
import { exportCompleteRunToExcelStyled, exportAllPlansToExcelStyled, exportAllFactoryPlansOnlyStyled, downloadExcelBuffer } from '../services/excelExporter';
import { FILM_MASTERS } from '../services/masterData';
import { RemainingOrdersTable } from './RemainingOrdersTable';
import { 
  Play, 
  Layers, 
  CheckCircle2, 
  AlertTriangle, 
  Star, 
  FileText, 
  Download, 
  Scissors, 
  ArrowRight,
  RefreshCw,
  Info,
  ShieldCheck,
  Check,
  Sliders,
  AlertCircle,
  X,
  Target,
  Plus,
  StopCircle
} from 'lucide-react';

interface PlanGeneratorStudioProps {
  orders: VA05Order[];
  rules: PlanningRules;
  currentUser: UserProfile;
  preselectedFilm?: string;
  onRunCommitted: (run: PlanningRun, plans: SlitterPlan[], updatedOrders: VA05Order[]) => void;
  onOpenPlan: (plan: SlitterPlan) => void;
  onRulesUpdated?: (rules: PlanningRules) => void;
}

export const PlanGeneratorStudio: React.FC<PlanGeneratorStudioProps> = ({
  orders,
  rules,
  currentUser,
  preselectedFilm,
  onRunCommitted,
  onOpenPlan,
  onRulesUpdated,
}) => {
  const psOrders = useMemo(() => orders.filter(isPS01Order), [orders]);
  const distinctFilms = useMemo(() => Array.from(new Set(psOrders.map(o => o.film))).sort(), [psOrders]);

  // Helper to determine film thickness
  const getFilmThickness = (filmCode: string) => {
    const master = FILM_MASTERS.find(m => m.code === filmCode);
    if (master) return master.thickness_micron;
    const order = orders.find(o => o.film === filmCode);
    return order?.thickness_micron || 20;
  };

  // Film Selection State (Single, Dual, or 3 Films of same thickness)
  const [filmSelectionMode, setFilmSelectionMode] = useState<'SINGLE' | 'DUAL' | 'TRIO'>('SINGLE');
  const [selectedFilm1, setSelectedFilm1] = useState<string>(preselectedFilm || distinctFilms[0] || 'TNO20');
  const [selectedFilm2, setSelectedFilm2] = useState<string>('');
  const [selectedFilm3, setSelectedFilm3] = useState<string>('');

  // Compatible secondary films sharing the exact same thickness as Film 1
  const film1Thickness = getFilmThickness(selectedFilm1);
  const compatibleFilms = useMemo(() => {
    return distinctFilms.filter(f => f !== selectedFilm1 && getFilmThickness(f) === film1Thickness);
  }, [distinctFilms, selectedFilm1, film1Thickness]);

  // Compatible tertiary films sharing exact thickness and not already chosen as Film 2
  const compatibleFilmsFor3 = useMemo(() => {
    return compatibleFilms.filter(f => f !== selectedFilm2);
  }, [compatibleFilms, selectedFilm2]);

  // Auto-manage selectedFilm2 and selectedFilm3 when mode or selectedFilm1 changes
  useEffect(() => {
    if (filmSelectionMode === 'DUAL' || filmSelectionMode === 'TRIO') {
      if (!selectedFilm2 || !compatibleFilms.includes(selectedFilm2)) {
        if (compatibleFilms.length > 0) {
          setSelectedFilm2(compatibleFilms[0]);
        } else {
          setSelectedFilm2('');
        }
      }
    }
    if (filmSelectionMode === 'TRIO') {
      const availableFor3 = compatibleFilms.filter(f => f !== selectedFilm2);
      if (!selectedFilm3 || !availableFor3.includes(selectedFilm3)) {
        if (availableFor3.length > 0) {
          setSelectedFilm3(availableFor3[0]);
        } else {
          setSelectedFilm3('');
        }
      }
    }
  }, [filmSelectionMode, selectedFilm1, compatibleFilms, selectedFilm2]);

  useEffect(() => {
    if (preselectedFilm && distinctFilms.includes(preselectedFilm)) {
      setSelectedFilm1(preselectedFilm);
    }
  }, [preselectedFilm, distinctFilms]);

  // Active films array
  const activeFilms = useMemo(() => {
    if (filmSelectionMode === 'TRIO') {
      const list = [selectedFilm1];
      if (selectedFilm2) list.push(selectedFilm2);
      if (selectedFilm3) list.push(selectedFilm3);
      return Array.from(new Set(list));
    }
    if (filmSelectionMode === 'DUAL' && selectedFilm2) {
      return [selectedFilm1, selectedFilm2];
    }
    return [selectedFilm1];
  }, [filmSelectionMode, selectedFilm1, selectedFilm2, selectedFilm3]);

  const activeFilmDisplay = activeFilms.join(' + ');

  const [planningMode, setPlanningMode] = useState<'TARGET_QUANTITY' | 'ALL_REMAINING'>('TARGET_QUANTITY');
  const [targetKg, setTargetKg] = useState<number>(33865);
  const [selectedPriorityIds, setSelectedPriorityIds] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [optResult, setOptResult] = useState<OptimizationResult | null>(null);
  const [isCommitted, setIsCommitted] = useState(false);
  // PLX-A05: fingerprint of the shared order ledger at the moment this run was
  // generated, so a stale result can never overwrite an MSL/SS deduction.
  const [resultLedgerFingerprint, setResultLedgerFingerprint] = useState<string | null>(null);

  // Trim Rules & Override State
  const [trimRuleMode, setTrimRuleMode] = useState<TrimRuleMode>('NORMAL');
  const [allowCustomTrim, setAllowCustomTrim] = useState<boolean>(false);
  const [customMinTrim, setCustomMinTrim] = useState<number>(50);
  const [customMaxTrim, setCustomMaxTrim] = useState<number>(300);
  const [customReason, setCustomReason] = useState<string>('Jumbo roll issue / edge defect');
  const [showRelaxationModal, setShowRelaxationModal] = useState<boolean>(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Dedicated Web Worker Reference for Background Optimization
  const workerRef = useRef<Worker | null>(null);
  const timerRef = useRef<any>(null);

  // Progress & Execution Metrics State
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [wasCancelled, setWasCancelled] = useState<boolean>(false);
  const [lastCompletionStats, setLastCompletionStats] = useState<{
    durationSec: number;
    planCount: number;
    plannedKg: number;
    remainingKg: number;
  } | null>(null);

  // Terminate any active worker & clear timer on component unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // Live Timer Controller (Main UI Thread - 100ms interval)
  useEffect(() => {
    if (isGenerating) {
      const startT = performance.now();
      setElapsedMs(0);
      timerRef.current = setInterval(() => {
        setElapsedMs(performance.now() - startT);
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isGenerating]);

  // Open orders for selected films
  const activeOpenOrders = useMemo(() => {
    return psOrders.filter(o => activeFilms.includes(o.film) && o.remaining_qty > 0);
  }, [psOrders, activeFilms]);

  const film1OpenOrders = useMemo(() => {
    return psOrders.filter(o => o.film === selectedFilm1 && o.remaining_qty > 0);
  }, [psOrders, selectedFilm1]);
  const film1DemandKg = film1OpenOrders.reduce((sum, o) => sum + o.remaining_qty, 0);

  const film2OpenOrders = useMemo(() => {
    return selectedFilm2 ? psOrders.filter(o => o.film === selectedFilm2 && o.remaining_qty > 0) : [];
  }, [psOrders, selectedFilm2]);
  const film2DemandKg = film2OpenOrders.reduce((sum, o) => sum + o.remaining_qty, 0);

  const film3OpenOrders = useMemo(() => {
    return selectedFilm3 ? psOrders.filter(o => o.film === selectedFilm3 && o.remaining_qty > 0) : [];
  }, [psOrders, selectedFilm3]);  const film3DemandKg = film3OpenOrders.reduce((sum, o) => sum + o.remaining_qty, 0);

  const totalActiveDemandKg = activeOpenOrders.reduce((sum, o) => sum + o.remaining_qty, 0);

  // Initialize priority IDs from orders' own priority flag & update targetKg on film change
  useEffect(() => {
    const prios = new Set<string>();
    activeOpenOrders.forEach(o => {
      if (o.priority) prios.add(o.id);
    });
    setSelectedPriorityIds(prios);
    if (totalActiveDemandKg > 0) {
      setTargetKg(Math.round(totalActiveDemandKg * 100) / 100);
    }
  }, [selectedFilm1, selectedFilm2, selectedFilm3, filmSelectionMode]);

  const handleTogglePriority = (orderId: string) => {
    const next = new Set(selectedPriorityIds);
    if (next.has(orderId)) next.delete(orderId);
    else next.add(orderId);
    setSelectedPriorityIds(next);
  };

  const handleCancelOptimization = () => {
    console.log('[UI] Optimization cancelled by user');
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsGenerating(false);
    setWasCancelled(true);
  };


  const formatDensityError = (msg: string) => {
    const m = msg || '';
    if (/density not saved/i.test(m)) {
      // Prefer explicit film list from engine message
      const listed = m.match(/for:\s*([^.]+)/i);
      const films = listed ? listed[1].trim() : activeFilms.join(', ');
      return (
        `Density not saved for film(s): ${films}.\n\n` +
        `Open Master Backlog → Film Specs Master DB and save density for each film, then try Generate Plans again.`
      );
    }
    return m;
  };

  const executeOptimization = (overrideMode?: TrimRuleMode, minT?: number, maxT?: number, reason?: string) => {
    if (isGenerating) return;

    const execId = 'EXEC-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    console.log(`[OPTIMIZER DEBUG] UI request started | Execution ID: ${execId} START`);
    console.log(`[OPTIMIZER DEBUG] Target: ${targetKg} kg | Film: [${activeFilmDisplay}] | Orders: ${orders.length}`);

    setGenerationError(null);
    setIsGenerating(true);
    setIsCommitted(false);
    setWasCancelled(false);
    setShowRelaxationModal(false);
    setLastCompletionStats(null);

    // Pre-flight: density must exist in Film Specs Master DB (no silent seed)
    // Permanent: always snapshot from localStorage (just-saved films included)
    const filmSpecsSnapshot = getFilmSpecsSnapshotForPlanning();
    const missingDensity = findFilmsMissingDensity(activeFilms);
    if (missingDensity.length > 0) {
      setIsGenerating(false);
      setGenerationError(
        `Density not saved for film(s): ${missingDensity.join(', ')}.\n\n` +
        `Open Master Backlog → Film Specs Master DB and save density for each film, then try Generate Plans again.`
      );
      return;
    }

    const activeMode = overrideMode || (allowCustomTrim ? 'MANUAL_OVERRIDE' : trimRuleMode);
    const activeMin = minT !== undefined ? minT : (allowCustomTrim ? customMinTrim : undefined);
    const activeMax = maxT !== undefined ? maxT : (allowCustomTrim ? customMaxTrim : undefined);
    const activeReason = reason !== undefined ? reason : (allowCustomTrim ? customReason : undefined);

    // Terminate any previous worker if still lingering
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    const optimizationInput = {
      film: activeFilmDisplay,
      films: activeFilms,
      orders,
      rules,
      target_quantity_kg: targetKg,
      planning_mode: planningMode,
      priority_order_ids: Array.from(selectedPriorityIds) as string[],
      created_by: currentUser.name,
      trim_rule_mode: activeMode,
      custom_min_trim_mm: activeMin,
      custom_max_trim_mm: activeMax,
      trim_override_reason: activeReason,
    };

    const handleSuccess = (result: OptimizationResult, durationMs?: number) => {
      console.log(`[OPTIMIZER DEBUG] UI result received | Execution ID: ${execId} in ${durationMs ?? elapsedMs}ms (Plans: ${result.plans.length})`);
      setOptResult(result);
      setResultLedgerFingerprint(getOrdersLedgerFingerprint());

      const durationSec = durationMs ? Math.round((durationMs / 1000) * 10) / 10 : Math.round((elapsedMs / 1000) * 10) / 10;
      setLastCompletionStats({
        durationSec: Math.max(0.1, durationSec),
        planCount: result.plans.length,
        plannedKg: result.run.planned_quantity_kg,
        remainingKg: result.run.remaining_quantity_kg,
      });

      // If no feasible plan in normal mode, show planner confirmation prompt
      if (result.suggest_trim_relaxation && activeMode === 'NORMAL') {
        setShowRelaxationModal(true);
      }

      setIsGenerating(false);
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };

    try {
      console.log(`[OPTIMIZER DEBUG] Worker created | Execution ID: ${execId}`);
      const worker = new OptimizerWorker();
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent<WorkerMessageResponse>) => {
        const { type, result, error, durationMs } = e.data;

        if (type === 'OPTIMIZATION_SUCCESS' && result) {
          handleSuccess(result, durationMs);
        } else if (type === 'OPTIMIZATION_ERROR') {
          console.error(`[OPTIMIZER DEBUG] Worker error | Execution ID: ${execId}:`, error);
          setIsGenerating(false);
          setGenerationError(formatDensityError(String(error || 'Optimization failed.')));
          if (workerRef.current === worker) {
            worker.terminate();
            workerRef.current = null;
          }
        }
      };

      worker.onerror = (err) => {
        console.error(`[OPTIMIZER DEBUG] Worker onerror | Execution ID: ${execId}:`, err);
        // Fallback to direct synchronous execution if worker thread was blocked
        try {
          console.log(`[OPTIMIZER DEBUG] Falling back to direct optimizer execution | Execution ID: ${execId}`);
          const res = generatePrimarySlitterPlans(optimizationInput);
          handleSuccess(res);
        } catch (directErr) {
          console.error(`[OPTIMIZER DEBUG] Direct execution error | Execution ID: ${execId}:`, directErr);
          setIsGenerating(false);
          setGenerationError(formatDensityError(directErr instanceof Error ? directErr.message : String(directErr)));
        }
      };

      console.log(`[OPTIMIZER DEBUG] Input posted to worker | Execution ID: ${execId}`);
      worker.postMessage({
        type: 'RUN_OPTIMIZATION',
        input: optimizationInput,
        executionId: execId,
        // Permanent: same snapshot as pre-flight (workers have no localStorage)
        filmSpecs: filmSpecsSnapshot,
      });
    } catch (err) {
      console.warn(`[OPTIMIZER DEBUG] Worker initialization threw, using direct execution | Execution ID: ${execId}:`, err);
      try {
        const res = generatePrimarySlitterPlans(optimizationInput);
        handleSuccess(res);
      } catch (directErr) {
        console.error(`[OPTIMIZER DEBUG] Direct execution error | Execution ID: ${execId}:`, directErr);
        setIsGenerating(false);
        setGenerationError(formatDensityError(directErr instanceof Error ? directErr.message : String(directErr)));
      }
    }
  };

  const handleGenerate = () => {
    executeOptimization();
  };

  const handleAccept50mmRelaxation = () => {
    setTrimRuleMode('RELAXED_50MM');
    setShowRelaxationModal(false);
    executeOptimization('RELAXED_50MM', 150, 500, 'Planner authorized Yellow Zone trim relaxation (281–500 mm)');
  };

  const handleDecline50mmRelaxation = () => {
    setShowRelaxationModal(false);
  };

  const handleCommit = () => {
    if (!optResult || isCommitted) return;

    // PLX-A05: the order ledger is shared with MSL and SS and nothing reserves
    // it. If it moved since this run was generated, committing would write back
    // pre-deduction quantities and erase the other module's allocation.
    if (resultLedgerFingerprint !== null && resultLedgerFingerprint !== getOrdersLedgerFingerprint()) {
      alert('The order ledger changed since this run was generated (another module committed a run). Nothing was saved — please re-generate against the current demand.');
      return;
    }

    // PLX-A06: commitPlanningRun is now all-or-nothing and reports failure.
    const committed = commitPlanningRun(currentUser, optResult.run, optResult.plans, optResult.remaining_orders);
    if (!committed) {
      alert('Commit failed: the run, plans and order ledger could not be saved together, so nothing was changed. Please retry.');
      return;
    }

    onRunCommitted(optResult.run, optResult.plans, optResult.remaining_orders);
    setIsCommitted(true);
  };

  const handleDownloadRunExcel = async () => {
    if (!optResult) return;
    // One .xlsx file: Summary + Plan1 sheet + Plan2 sheet + … + Remaining
    const excelBuffer = await exportAllPlansToExcelStyled(optResult.run, optResult.plans, optResult.remaining_orders);
    downloadExcelBuffer(
      excelBuffer,
      `All_Plans_${optResult.run.run_number || 'PS'}_${optResult.plans.length}plans.xlsx`
    );
  };

  const targetMax = targetKg * 1.10;

  return (
    <div className="space-y-6">
      {/* Studio Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
              <Scissors className="w-5 h-5 text-emerald-600" />
              <span>Primary Slitter Planning Studio</span>
            </h2>
            <span className="px-2 py-0.5 text-xs font-semibold rounded bg-emerald-100 text-emerald-800">
              Primary Slitter 1
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Multi-pack dynamic replacement engine with strict +10% target ceiling & consolidated planning sheets.
          </p>
        </div>

        <div className="flex items-center space-x-3 text-xs">
          <span className="text-slate-500">Trim Architecture:</span>
          <span className="font-bold text-slate-800 bg-slate-100 px-2.5 py-1 rounded border border-slate-200">
            {allowCustomTrim ? `Custom: ${customMinTrim}–${customMaxTrim}mm` : trimRuleMode === 'RELAXED_50MM' ? 'Relaxed Yellow: 281–500mm' : 'Normal Green: 150–280mm'} (Deckle {(rules.deckle_width_mm || 10400).toLocaleString()}mm)
          </span>
        </div>
      </div>

      {/* Configuration Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Planning Form */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-5">
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center justify-between">
            <span>1. Plan Parameters</span>
            <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              {filmSelectionMode === 'SINGLE' ? 'Single Film' : filmSelectionMode === 'DUAL' ? 'Dual Film Co-Plan' : '3-Film Co-Plan'}
            </span>
          </h3>

          {/* Film Selection Mode Toggle */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">Film Selection Mode (Same Thickness):</label>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setFilmSelectionMode('SINGLE')}
                className={`py-1.5 px-2 text-center text-xs font-bold rounded-md transition-all cursor-pointer ${
                  filmSelectionMode === 'SINGLE'
                    ? 'bg-white text-slate-950 shadow-xs border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                1 Film
              </button>
              <button
                type="button"
                onClick={() => setFilmSelectionMode('DUAL')}
                className={`py-1.5 px-2 text-center text-xs font-bold rounded-md transition-all flex items-center justify-center space-x-1 cursor-pointer ${
                  filmSelectionMode === 'DUAL'
                    ? 'bg-emerald-700 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-emerald-700'
                }`}
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">2 Films</span>
              </button>
              <button
                type="button"
                onClick={() => setFilmSelectionMode('TRIO')}
                className={`py-1.5 px-2 text-center text-xs font-bold rounded-md transition-all flex items-center justify-center space-x-1 cursor-pointer ${
                  filmSelectionMode === 'TRIO'
                    ? 'bg-emerald-700 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-emerald-700'
                }`}
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">3 Films</span>
              </button>
            </div>
          </div>

          {/* Film Selection Controls */}
          {filmSelectionMode === 'SINGLE' ? (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Select Film Grade:</label>
              <select
                value={selectedFilm1}
                onChange={(e) => setSelectedFilm1(e.target.value)}
                className="w-full px-3 py-2 text-xs font-semibold text-slate-900 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50"
              >
                {distinctFilms.map(film => (
                  <option key={film} value={film}>
                    {film} ({getFilmThickness(film)}µ · {psOrders.filter(o => o.film === film && o.remaining_qty > 0).length} open orders)
                  </option>
                ))}
              </select>
              <div className="flex justify-between text-[11px] text-slate-500 pt-1">
                <span>Open Demand ({selectedFilm1}):</span>
                <strong className="text-emerald-800 font-mono">{film1DemandKg.toLocaleString()} kg</strong>
              </div>
            </div>
          ) : (
            <div className="space-y-3 p-3 bg-emerald-50/50 border border-emerald-200 rounded-xl">
              <div className="flex items-center justify-between text-xs font-bold text-emerald-950">
                <span className="flex items-center space-x-1.5">
                  <Layers className="w-4 h-4 text-emerald-700" />
                  <span>{filmSelectionMode === 'TRIO' ? '3-Film Co-Planning' : 'Dual Film Co-Planning'}</span>
                </span>
                <span className="px-2 py-0.5 bg-emerald-200 text-emerald-950 text-[10px] font-mono font-bold rounded">
                  {film1Thickness} Micron
                </span>
              </div>

              {/* Film 1 Select */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 block">Primary Film 1:</label>
                <select
                  value={selectedFilm1}
                  onChange={(e) => setSelectedFilm1(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-semibold text-slate-900 border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                >
                  {distinctFilms.map(film => (
                    <option key={film} value={film}>
                      {film} ({getFilmThickness(film)}µ · {psOrders.filter(o => o.film === film && o.remaining_qty > 0).length} orders)
                    </option>
                  ))}
                </select>
              </div>

              {/* Film 2 Select (Matching Thickness) */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 block">
                  Secondary Film 2 (Matching {film1Thickness}µ):
                </label>
                {compatibleFilms.length > 0 ? (
                  <select
                    value={selectedFilm2}
                    onChange={(e) => setSelectedFilm2(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-semibold text-slate-900 border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                  >
                    {compatibleFilms.map(film => (
                      <option key={film} value={film}>
                        {film} ({getFilmThickness(film)}µ · {psOrders.filter(o => o.film === film && o.remaining_qty > 0).length} orders)
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-[11px] leading-tight">
                    No other open orders found with <strong>{film1Thickness}µ</strong> thickness. Please select another primary film or switch to Single Film mode.
                  </div>
                )}
              </div>

              {/* Film 3 Select (Matching Thickness) - Only in TRIO mode */}
              {filmSelectionMode === 'TRIO' && (
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 block">
                    Tertiary Film 3 (Matching {film1Thickness}µ):
                  </label>
                  {compatibleFilmsFor3.length > 0 ? (
                    <select
                      value={selectedFilm3}
                      onChange={(e) => setSelectedFilm3(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-semibold text-slate-900 border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                    >
                      {compatibleFilmsFor3.map(film => (
                        <option key={film} value={film}>
                          {film} ({getFilmThickness(film)}µ · {psOrders.filter(o => o.film === film && o.remaining_qty > 0).length} orders)
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-[11px] leading-tight">
                      No 3rd open order film found with <strong>{film1Thickness}µ</strong> thickness.
                    </div>
                  )}
                </div>
              )}

              {/* Combined Demand Breakdown */}
              <div className="pt-2 border-t border-emerald-200 space-y-1 text-[11px]">
                <div className="flex justify-between text-slate-600">
                  <span>{selectedFilm1}:</span>
                  <span className="font-mono font-bold text-slate-900">{film1DemandKg.toLocaleString()} kg</span>
                </div>
                {selectedFilm2 && (
                  <div className="flex justify-between text-slate-600">
                    <span>{selectedFilm2}:</span>
                    <span className="font-mono font-bold text-slate-900">{film2DemandKg.toLocaleString()} kg</span>
                  </div>
                )}
                {filmSelectionMode === 'TRIO' && selectedFilm3 && (
                  <div className="flex justify-between text-slate-600">
                    <span>{selectedFilm3}:</span>
                    <span className="font-mono font-bold text-slate-900">{film3DemandKg.toLocaleString()} kg</span>
                  </div>
                )}
                <div className="flex justify-between text-emerald-950 font-bold pt-1 border-t border-emerald-200">
                  <span>Combined Total Demand:</span>
                  <span className="font-mono text-emerald-800 text-xs">{totalActiveDemandKg.toLocaleString()} kg</span>
                </div>
              </div>
            </div>
          )}

          {/* Planning Mode & Target Quantity with +10% Ceiling */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 block">Planning Quantity Target:</label>
            <div className="space-y-2">
              <label className="flex items-center space-x-2 text-xs text-slate-800 cursor-pointer">
                <input
                  type="radio"
                  name="planningMode"
                  checked={planningMode === 'TARGET_QUANTITY'}
                  onChange={() => setPlanningMode('TARGET_QUANTITY')}
                  className="text-emerald-600 focus:ring-emerald-500"
                />
                <span>Specify Target Quantity (kg) with Strict +10% Ceiling</span>
              </label>

              <label className="flex items-center space-x-2 text-xs text-slate-800 cursor-pointer">
                <input
                  type="radio"
                  name="planningMode"
                  checked={planningMode === 'ALL_REMAINING'}
                  onChange={() => {
                    setPlanningMode('ALL_REMAINING');
                    setTargetKg(Math.round(totalActiveDemandKg));
                  }}
                  className="text-emerald-600 focus:ring-emerald-500"
                />
                <span>Plan All Remaining Demand ({totalActiveDemandKg.toLocaleString()} kg)</span>
              </label>
            </div>

            {planningMode === 'TARGET_QUANTITY' && (
              <div className="pt-2 space-y-2">
                <div className="relative">
                  <input
                    type="number"
                    value={targetKg}
                    onChange={(e) => setTargetKg(Math.max(100, parseFloat(e.target.value) || 0))}
                    className="w-full pl-3 pr-10 py-2 text-xs font-bold font-mono text-slate-900 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                    placeholder="Enter target in KG"
                  />
                  <span className="absolute right-3 top-2 text-xs font-semibold text-slate-400">KG</span>
                </div>

                {/* Target Range +10% Max Ceiling Indicator */}
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs space-y-1">
                  <div className="flex items-center justify-between font-bold text-emerald-950 text-[11px]">
                    <span className="flex items-center space-x-1">
                      <Target className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Target Ceiling (+10% Max Limit):</span>
                    </span>
                    <span className="font-mono text-emerald-800">Max +10% Cap</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-700 pt-0.5">
                    <div className="bg-white p-1.5 rounded border border-emerald-100">
                      <span className="text-slate-500 block text-[10px]">Target Qty:</span>
                      <strong>{targetKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg</strong>
                    </div>
                    <div className="bg-white p-1.5 rounded border border-emerald-100">
                      <span className="text-slate-500 block text-[10px]">Max Allowed (+10%):</span>
                      <strong className="text-emerald-800">{targetMax.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg</strong>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Controlled Manual Trim Override */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-slate-600" />
                <span className="text-xs font-bold text-slate-800">Trim Rules Control</span>
              </div>
              <label className="flex items-center space-x-1.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowCustomTrim}
                  onChange={(e) => {
                    setAllowCustomTrim(e.target.checked);
                    if (e.target.checked) setTrimRuleMode('MANUAL_OVERRIDE');
                    else setTrimRuleMode('NORMAL');
                  }}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                <span className="font-semibold text-[11px]">Allow Custom Trim</span>
              </label>
            </div>

            {!allowCustomTrim ? (
              <div className="text-[11px] text-slate-500 flex justify-between">
                <span>Normal Minimum: <strong>{rules.min_trim_mm ?? 150} mm</strong></span>
                <span>Normal Maximum: <strong>{rules.max_trim_mm ?? 280} mm</strong></span>
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="text-[10px] text-slate-500 font-bold block">Custom Min (mm):</label>
                    <input
                      type="number"
                      value={customMinTrim}
                      onChange={(e) => setCustomMinTrim(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full px-2 py-1 bg-white border border-slate-300 rounded font-mono text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 font-bold block">Custom Max (mm):</label>
                    <input
                      type="number"
                      value={customMaxTrim}
                      onChange={(e) => setCustomMaxTrim(Math.max(customMinTrim, parseInt(e.target.value) || 300))}
                      className="w-full px-2 py-1 bg-white border border-slate-300 rounded font-mono text-xs font-bold"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 font-bold block">Override Reason (Audited):</label>
                  <input
                    type="text"
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    placeholder="e.g. Jumbo roll issue / defect edge"
                    className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-[11px]"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Run Button & Background Worker Status HUD */}
          <div className="pt-2 border-t border-slate-100 space-y-3">
            {wasCancelled && (
              <div className="p-3 bg-slate-100 border border-slate-300 rounded-lg text-xs text-slate-700 flex items-center justify-between">
                <span className="font-semibold">Optimization was cancelled by user.</span>
                <button 
                  onClick={() => setWasCancelled(false)}
                  className="text-[10px] text-slate-500 hover:text-slate-800 underline"
                >
                  Dismiss
                </button>
              </div>
            )}

            {lastCompletionStats && !isGenerating && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-xl space-y-2 text-xs text-emerald-950 shadow-xs">
                <div className="flex items-center justify-between border-b border-emerald-200 pb-1.5">
                  <div className="flex items-center space-x-1.5 font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>OPTIMIZATION COMPLETE</span>
                  </div>
                  <span className="px-2 py-0.5 bg-emerald-200 text-emerald-900 rounded text-[10px] font-mono font-bold">
                    {lastCompletionStats.durationSec}s
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] font-mono text-center">
                  <div className="bg-white/80 p-1.5 rounded border border-emerald-200">
                    <div className="text-slate-500 text-[10px]">Plans</div>
                    <div className="font-bold text-emerald-900 text-sm">{lastCompletionStats.planCount}</div>
                  </div>
                  <div className="bg-white/80 p-1.5 rounded border border-emerald-200">
                    <div className="text-slate-500 text-[10px]">Planned Qty</div>
                    <div className="font-bold text-emerald-900">{lastCompletionStats.plannedKg.toLocaleString()} kg</div>
                  </div>
                  <div className="bg-white/80 p-1.5 rounded border border-emerald-200">
                    <div className="text-slate-500 text-[10px]">Remaining</div>
                    <div className="font-bold text-slate-800">{lastCompletionStats.remainingKg.toLocaleString()} kg</div>
                  </div>
                </div>
              </div>
            )}

            {!isGenerating ? (
              <button
                onClick={handleGenerate}
                disabled={activeOpenOrders.length === 0 || currentUser.role === 'VIEWER'}
                className="w-full py-3 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-md hover:shadow transition-all flex items-center justify-center space-x-2 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>GENERATE PLANS ({activeFilms.join(' + ')})</span>
              </button>
            ) : (
              <div className="bg-slate-900 text-white p-4 rounded-xl shadow-lg border border-slate-800 space-y-3.5 animate-in fade-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center space-x-2">
                    <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" />
                    <span className="font-bold text-xs uppercase tracking-wider text-emerald-400">
                      INTELLIGENT OPTIMIZER
                    </span>
                  </div>
                  <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                    Background Worker
                  </span>
                </div>

                {/* Indeterminate Progress Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono">
                    <span className="text-slate-300 font-semibold">Stage: Deep Combinatorial Optimization</span>
                    <span className="text-emerald-400 font-bold animate-pulse">Computing...</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden border border-slate-700 relative">
                    <div className="h-full bg-emerald-500 rounded-full animate-indeterminate" />
                  </div>
                </div>

                {/* Details & Metrics Grid */}
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                  <div>
                    <span className="text-slate-500 text-[10px] block">Elapsed:</span>
                    <span className="font-bold text-slate-200">
                      {Math.floor(elapsedMs / 60000).toString().padStart(2, '0')}:{Math.floor((elapsedMs % 60000) / 1000).toString().padStart(2, '0')}.{Math.floor((elapsedMs % 1000) / 100)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] block">Status:</span>
                    <span className="text-emerald-400 font-semibold">
                      Actively calculating...
                    </span>
                  </div>
                  <div className="col-span-2 pt-1 border-t border-slate-800/60 text-[10px] text-slate-400 flex justify-between">
                    <span>Target: <strong>{targetKg.toLocaleString()} kg</strong></span>
                    <span>Orders: <strong>{activeOpenOrders.length} lines</strong></span>
                  </div>
                </div>

                {/* Notice if processing takes > 8s */}
                {elapsedMs > 8000 && (
                  <div className="p-2 bg-amber-950/50 border border-amber-800/80 rounded-lg text-[10px] text-amber-300 leading-tight">
                    <strong>Notice:</strong> Optimization is actively calculating across a deep combinatorial search space. You may wait for completion or cancel below at any time.
                  </div>
                )}

                {/* Cancel Button */}
                <button
                  type="button"
                  onClick={handleCancelOptimization}
                  className="w-full py-2 px-3 bg-red-950/60 hover:bg-red-900/80 text-red-300 hover:text-white border border-red-800/80 font-bold text-xs rounded-lg transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  <span>Cancel Optimization</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right 2-Cols: Priority Orders Queue Selection */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  2. Select Priority Orders (⭐) for {activeFilmDisplay}
                </h3>
                <p className="text-xs text-slate-500">
                  Starred orders receive priority scoring during pattern optimization without violating physical constraints.
                </p>
              </div>
              <span className="text-xs font-bold text-amber-800 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                {selectedPriorityIds.size} Starred
              </span>
            </div>

            {/* Orders Checklist */}
            <div className="mt-3 overflow-x-auto max-h-[300px] border border-slate-200 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold sticky top-0 border-b border-slate-200">
                  <tr>
                    <th className="py-2 px-3 w-10 text-center">⭐</th>
                    {activeFilms.length > 1 && (
                      <th className="py-2 px-2">Film</th>
                    )}
                    <th className="py-2 px-3">SO# / Item</th>
                    <th className="py-2 px-3">Customer</th>
                    <th className="py-2 px-3 text-right">Width (mm)</th>
                    <th className="py-2 px-3 text-right">Length (m)</th>
                    <th className="py-2 px-3 text-right">Remaining (kg)</th>
                    <th className="py-2 px-3">PO Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeOpenOrders.length === 0 ? (
                    <tr>
                      <td colSpan={activeFilms.length > 1 ? 8 : 7} className="py-8 text-center text-slate-400">
                        No open pending orders for {activeFilmDisplay}.
                      </td>
                    </tr>
                  ) : (
                    activeOpenOrders.map(order => {
                      const isSelected = selectedPriorityIds.has(order.id);
                      return (
                        <tr
                          key={order.id}
                          onClick={() => handleTogglePriority(order.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-amber-50/70 hover:bg-amber-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2 px-3 text-center">
                            <Star className={`w-4 h-4 ${isSelected ? 'fill-amber-400 text-amber-500' : 'text-slate-300'}`} />
                          </td>
                          {activeFilms.length > 1 && (
                            <td className="py-2 px-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono border ${
                                order.film === activeFilms[0]
                                  ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                  : order.film === activeFilms[1]
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : order.film === activeFilms[2]
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-slate-100 text-slate-800 border-slate-200'
                              }`}>
                                {order.film}
                              </span>
                            </td>
                          )}
                          <td className="py-2 px-3 font-bold text-slate-900">
                            {order.sales_order} <span className="text-[10px] text-slate-400">#{order.item_number}</span>
                          </td>
                          <td className="py-2 px-3 font-medium text-slate-800 truncate max-w-[180px]">
                            {order.customer}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                            {order.width_mm}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-slate-600">
                            {order.length_m}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-emerald-800">
                            {order.remaining_qty.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 text-slate-500 text-[11px] truncate max-w-[120px]">
                            {order.customer_reference || '-'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 flex items-center justify-between pt-2">
            <span>Click row or star to toggle priority weighting.</span>
            <span>Total open lines: <strong>{activeOpenOrders.length}</strong></span>
          </div>
        </div>
      </div>

      {/* Generated Plans & Optimization Results Section */}
      {optResult && (
        <div className="space-y-5 animate-in fade-in duration-300">
          {/* Planning Run Summary Bar */}
          <div className={`rounded-xl p-5 border shadow-sm ${
            optResult.status === 'COMPLETED' ? 'bg-emerald-950 text-emerald-100 border-emerald-800' :
            optResult.status === 'PARTIALLY_PLANNED' ? 'bg-amber-950 text-amber-100 border-amber-800' :
            'bg-rose-950 text-rose-100 border-rose-800'
          }`}>
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-white/10 uppercase tracking-wider font-mono">
                    {optResult.run.run_number}
                  </span>
                  <span className="font-bold text-xs uppercase px-2 py-0.5 rounded bg-white text-slate-900">
                    {optResult.status}
                  </span>
                  {optResult.run.target_deviation_percent !== undefined && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                      Math.abs(optResult.run.target_deviation_percent) <= 5
                        ? 'bg-emerald-400 text-slate-950'
                        : 'bg-amber-400 text-slate-950'
                    }`}>
                      {optResult.run.target_deviation_percent >= 0 ? '+' : ''}{optResult.run.target_deviation_percent}% OF TARGET
                    </span>
                  )}
                  {optResult.run.trim_rule_mode && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-400 text-slate-950 uppercase">
                      Trim: {optResult.run.trim_rule_mode} ({optResult.run.min_trim_mm_used}–{optResult.run.max_trim_mm_used}mm)
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-bold mt-1 text-white">
                  Planning Run Output: {optResult.plans.length} Primary Slitter Plans Generated
                </h3>
                <p className="text-xs opacity-80 mt-0.5">
                  Stop Reason: <strong>{optResult.stop_reason}</strong>
                </p>
              </div>

              {/* Commit & Download Actions */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleDownloadRunExcel}
                  className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-lg border border-white/20 transition-colors flex items-center space-x-1.5"
                  title="Download ALL plans — factory CPAK sample format, Plan1/Plan2 sheets"
                >
                  <Download className="w-4 h-4" />
                  <span>Download All Plans (.xlsx)</span>
                </button>

                <button
                  onClick={handleCommit}
                  disabled={isCommitted || optResult.plans.length === 0 || currentUser.role === 'VIEWER'}
                  className={`px-4 py-2 text-xs font-bold rounded-lg shadow-sm transition-all flex items-center space-x-1.5 cursor-pointer ${
                    isCommitted
                      ? 'bg-white text-emerald-800 cursor-default'
                      : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold'
                  }`}
                >
                  {isCommitted ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-800" />
                      <span>Committed to Database</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Commit & Save Plans</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Run Stats Ribbon */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 pt-3 border-t border-white/15 text-xs">
              <div>
                <div className="opacity-70 text-[11px]">Target Qty:</div>
                <div className="font-bold text-white text-sm font-mono">{optResult.run.target_quantity_kg.toLocaleString()} kg</div>
                {optResult.run.target_min_kg && (
                  <div className="text-[10px] text-emerald-300">({optResult.run.target_min_kg.toFixed(0)} - {optResult.run.target_max_kg?.toFixed(0)} kg)</div>
                )}
              </div>
              <div>
                <div className="opacity-70 text-[11px]">Planned Qty:</div>
                <div className="font-bold text-white text-sm font-mono">{optResult.run.planned_quantity_kg.toLocaleString()} kg</div>
              </div>
              <div>
                <div className="opacity-70 text-[11px]">Remaining Backlog:</div>
                <div className="font-bold text-white text-sm font-mono">{optResult.run.remaining_quantity_kg.toLocaleString()} kg</div>
              </div>
              <div>
                <div className="opacity-70 text-[11px]">Orders Closed:</div>
                <div className="font-bold text-emerald-300 text-sm">{optResult.run.orders_closed_count} Orders</div>
              </div>
              <div>
                <div className="opacity-70 text-[11px]">Orders Partial:</div>
                <div className="font-bold text-white text-sm">{optResult.run.orders_partial_count} Orders</div>
              </div>
            </div>
          </div>

          {/* Individual Generated Plans Grid */}
          <div className="space-y-4">
            <h4 className="text-sm font-bold text-slate-900">Generated Primary Slitter Plan Schedules</h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {optResult.plans.map((plan) => (
                <div
                  key={plan.id}
                  className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs hover:border-emerald-500 transition-all flex flex-col justify-between"
                >
                  <div>
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-base text-slate-900 font-mono">{plan.plan_number}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                            Primary Slitter
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 font-mono">
                            {plan.repetitions} Packs ({plan.planned_mr_length_m.toLocaleString()}m MR)
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {plan.film} · {plan.thickness_micron}µ · {plan.length_m.toLocaleString()}m per pack
                        </p>
                      </div>

                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                        {plan.status}
                      </span>
                    </div>

                    {/* Technical Deckle Metrics */}
                    <div className="grid grid-cols-4 gap-2 mt-4 bg-slate-50 p-2.5 rounded-lg border border-slate-200/80 text-center text-xs">
                      <div>
                        <div className="text-[10px] text-slate-500">Slit Width</div>
                        <div className="font-bold font-mono text-slate-900">{plan.total_slit_width_mm} mm</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">Trim</div>
                        <div className={`font-bold font-mono ${plan.trim_mm >= 150 && plan.trim_mm <= 280 ? 'text-emerald-700' : plan.trim_mm >= 281 && plan.trim_mm <= 500 ? 'text-amber-700' : 'text-rose-700'}`}>{plan.trim_mm} mm</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">Active Arms</div>
                        <div className="font-bold font-mono text-slate-900">{plan.ups} / 16</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">Total Output</div>
                        <div className="font-bold font-mono text-slate-900">{plan.planned_quantity_kg.toLocaleString()} kg</div>
                      </div>
                    </div>

                    {/* Duplex Rewind Station (8+8 Arm Split) Indicator */}
                    {plan.duplex_layout && (
                      <div className="mt-2.5 px-3 py-1.5 bg-slate-100/90 rounded-lg border border-slate-200 text-[11px] font-mono flex items-center justify-between text-slate-800">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-slate-900">Duplex 8+8 Split:</span>
                          <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-900 rounded font-semibold border border-indigo-200">
                            Side A: {plan.duplex_layout.side_a_ups} Arms {plan.duplex_layout.side_a_length_m ? `(${plan.duplex_layout.side_a_length_m}m)` : ''} {plan.duplex_layout.side_a_core ? `[${plan.duplex_layout.side_a_core}"]` : ''}
                          </span>
                          <span className="text-slate-400">|</span>
                          <span className="px-1.5 py-0.5 bg-purple-50 text-purple-900 rounded font-semibold border border-purple-200">
                            Side B: {plan.duplex_layout.side_b_ups} Arms {plan.duplex_layout.side_b_length_m ? `(${plan.duplex_layout.side_b_length_m}m)` : ''} {plan.duplex_layout.side_b_core ? `[${plan.duplex_layout.side_b_core}"]` : ''}
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          plan.duplex_layout.balance_delta <= 1 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          Δ: ±{plan.duplex_layout.balance_delta} (Balanced)
                        </span>
                      </div>
                    )}

                    {/* Slit Knives / Positions preview (Consolidated) */}
                    <div className="mt-3">
                      <div className="text-[11px] font-semibold text-slate-600 mb-1.5">Slitter Orders ({plan.items.length} consolidated order lines):</div>
                      <div className="flex flex-wrap gap-1">
                        {plan.items.map(item => (
                          <span
                            key={item.id}
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium border ${
                              item.is_future_replacement
                                ? 'bg-amber-50 text-amber-900 border-amber-300'
                                : item.is_closed 
                                  ? 'bg-emerald-50 text-emerald-900 border-emerald-200' 
                                  : 'bg-slate-100 text-slate-800 border-slate-200'
                            }`}
                            title={`Pos ${item.position_label || item.position}: ${item.width_mm}mm x ${item.reels} reels (${item.customer})`}
                          >
                            Pos {item.position_label || item.position}: {item.width_mm}mm (UPS {item.is_future_replacement ? '0' : (item.initial_ups || item.ups)}) {item.is_future_replacement ? '⏳ Shift' : item.is_closed ? '✓' : ''}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Dynamic Size Changes / Operator Instruction Note (SRS Section 33) */}
                    {plan.changes && plan.changes.length > 0 && (
                      <div className="mt-3 p-2.5 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-950 space-y-1">
                        <span className="font-bold block uppercase tracking-wide text-[10px] text-amber-800">
                          Dynamic Size Replacement Sequence ({plan.changes.length} In-Run Changes):
                        </span>
                        {plan.changes.map((chg, idx) => (
                          <div key={chg.id} className="font-mono text-xs text-slate-900 font-semibold flex items-center space-x-1.5">
                            <span className="text-amber-700">#{idx + 1}</span>
                            <span>{chg.instruction}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">
                      Total Reels: <strong>{plan.total_reels}</strong>
                    </span>
                    <button
                      onClick={() => onOpenPlan(plan)}
                      className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors flex items-center space-x-1 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>View Factory Sheet</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Remaining Unplanned Orders & Fulfillment Tracking Table */}
          <RemainingOrdersTable
            film={activeFilmDisplay}
            originalOrders={orders}
            remainingOrders={optResult.remaining_orders}
            plans={optResult.plans}
          />

          {/* Solver Step Trace / Explanations */}
          <div className="bg-slate-900 text-slate-300 rounded-xl p-5 border border-slate-800 space-y-2 text-xs">
            <h4 className="font-bold text-white flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Deterministic Solver Execution Trace</span>
            </h4>
            <div className="space-y-1 font-mono text-[11px] max-h-48 overflow-y-auto pr-2">
              {optResult.logs.map(log => (
                <div key={log.step} className="flex items-start space-x-2">
                  <span className="text-slate-500">[{String(log.step).padStart(2, '0')}]</span>
                  <span className={
                    log.type === 'SUCCESS' ? 'text-emerald-400 font-semibold' :
                    log.type === 'WARNING' ? 'text-amber-400' :
                    log.type === 'ERROR' ? 'text-rose-400' :
                    'text-slate-300'
                  }>
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for 50mm Trim Relaxation (Section 9) */}
      
      {/* Density / generation error popup */}
      {generationError && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-[2px]">
          <div className="bg-white rounded-xl shadow-2xl border border-rose-200 max-w-md w-full p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start space-x-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-rose-600" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900">Cannot Generate Plans</h3>
                <p className="text-xs text-slate-600 mt-1.5 whitespace-pre-line leading-relaxed">
                  {generationError}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setGenerationError(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                OK — Save Density First
              </button>
            </div>
          </div>
        </div>
      )}

{showRelaxationModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-300 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-xl bg-amber-100 text-amber-800">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Trim Range Relaxation Required</h3>
                <p className="text-xs text-slate-500">Normal Green trim range: 150 mm to 280 mm</p>
              </div>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed bg-amber-50 p-3 rounded-lg border border-amber-200">
              No feasible plan was found within the normal Green trim range of 150–280 mm. Would you like to relax the trim to the Yellow Zone (281–500 mm) and generate plans again?
            </p>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={handleDecline50mmRelaxation}
                className="w-full py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold transition-colors"
              >
                NO — KEEP 150–280 MM NORMAL
              </button>
              <button
                onClick={handleAccept50mmRelaxation}
                className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors shadow-xs"
              >
                YES — RELAX TO YELLOW (UP TO 500 MM)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
