import { getFilmSpecsSnapshotForPlanning } from '../../services/stuffing/filmDensities';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Sparkles, 
  Disc, 
  Layers, 
  CheckCircle2, 
  ArrowRight, 
  AlertTriangle,
  XCircle,
  Boxes, 
  Info,
  Sliders,
  Send,
  Eye,
  Check,
  CheckSquare,
  Square,
  ShieldCheck,
  FileSpreadsheet,
  AlertCircle,
  Network,
  RotateCcw,
  Trash2,
  Filter,
  StopCircle
} from 'lucide-react';
import { VA05Order, SlitterPlan, UserProfile, PlanStatus } from '../../types';
import { JumboRequirement, MetallizerMachineSettings, JumboRoll, MetallizerPlan } from '../../types/metallizer';
import { isMetallizerOrder, generateJumboRollRequirements } from '../../services/metallizer/metallizerOptimizer';
import { MSL_CUSTOMER_MAX_OVERALLOCATION_FACTOR } from '../../services/metallizer/metallizerMasterData';
import type { MSLWorkerResponse } from '../../services/metallizer/msl.worker';
import MSLWorker from '../../services/metallizer/msl.worker?worker&inline';
import { 
  fetchJumboRequirementsAsync, 
  fetchPS01PlansAsync,
  getStoredActiveJob,
  resumeActiveSynthesisJob,
  clearStoredActiveJob
} from '../../services/metallizer/metallizerApi';
import { 
  saveStoredJumboRequirements, 
  getStoredJumboRolls, 
  saveStoredJumboRolls,
  getStoredMetallizerPlans, saveStoredMetallizerSettings } from '../../services/metallizer/metallizerStorage';
import { 
  generatePS01PlanForSingleJumbo,
  generatePS01PlanForDeckleGroup,
  generateMSLSlitterPlan,
  generatePS01ManufacturingPlansForJumbos
} from '../../services/metallizer/ps01FeasibilityAdapter';
import { 
  getCompatibleFilmsFor,
  getCompatibleGroupForFilm,
  getAllCompatibleGroups,
  DEFAULT_FILM_COMPATIBILITY_RULES
} from '../../services/metallizer/filmCompatibilityMaster';
import { PlanDetailViewer } from '../PlanDetailViewer';
import { MetallizerPlanDetailViewer } from './MetallizerPlanDetailViewer';
import { consolidatePlanItems } from '../../services/excelExporter';

interface JumboRequirementsViewProps {
  orders: VA05Order[];
  requirements: JumboRequirement[];
  plans?: MetallizerPlan[];
  settings: MetallizerMachineSettings;
  currentUser?: UserProfile;
  preselectedFilm?: string;
  onRequirementsUpdated: (reqs: JumboRequirement[]) => void;
  onJumboRollsUpdated?: (rolls: JumboRoll[]) => void;
  onNavigateToStudio: () => void;
  onSettingsSaved?: (settings: MetallizerMachineSettings) => void;
}

export const JumboRequirementsView: React.FC<JumboRequirementsViewProps> = ({
  orders,
  requirements,
  plans,
  settings,
  currentUser,
  preselectedFilm,
  onRequirementsUpdated,
  onJumboRollsUpdated,
  onNavigateToStudio,
  onSettingsSaved,
}) => {
  // Filter metallized orders (strictly Film Code contains "MZ")
  const metallizedOrders = orders.filter(o => isMetallizerOrder(o));
  const availableFilms: string[] = (Array.from(new Set(metallizedOrders.map(o => o.film))) as string[]).sort();
  const compatibleGroups = getAllCompatibleGroups(availableFilms);

  const [selectedFilm, setSelectedFilm] = useState<string>(
    preselectedFilm && availableFilms.includes(preselectedFilm)
      ? preselectedFilm
      : availableFilms[0] || 'MZ18'
  );

  // Sync selectedFilm if preselectedFilm prop changes
  useEffect(() => {
    if (preselectedFilm && availableFilms.includes(preselectedFilm)) {
      setSelectedFilm(preselectedFilm);
    }
  }, [preselectedFilm]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<string>('');
  const [generationPercent, setGenerationPercent] = useState<number>(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [wasCancelled, setWasCancelled] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [errorState, setErrorState] = useState<{ message: string; film: string } | null>(null);
  const [isSendingToMsl, setIsSendingToMsl] = useState(false);
  const [isGeneratingPs01, setIsGeneratingPs01] = useState(false);

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

  useEffect(() => {
    if (isGenerating) {
      const startT = performance.now();
      setElapsedMs(0);
      timerRef.current = setInterval(() => {
        setElapsedMs(performance.now() - startT);
      }, 100);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isGenerating]);

  const handleCancelSynthesis = () => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsGenerating(false);
    setGenerationProgress('');
    setGenerationPercent(0);
    setWasCancelled(true);
  };

  // Determine compatible films for the currently selected film
  const compatibleFilmsForSelection = getCompatibleFilmsFor(selectedFilm);
  const isCompatibleGroupSelected = compatibleFilmsForSelection.length > 1;

  // Requirements for the selected film or compatible group
  const filteredReqs = requirements.filter(r => {
    if (r.film === selectedFilm) return true;
    if (compatibleFilmsForSelection.includes(r.film)) return true;
    if (r.film.includes(selectedFilm)) return true;
    return false;
  });

  // Selection & Approval States
  const [selectedReqIds, setSelectedReqIds] = useState<Set<string>>(() => {
    const initialSet = new Set<string>();
    filteredReqs
      .filter(r => r.selected_for_msl !== false && r.ps01_feasibility?.status === 'GREEN')
      .forEach(r => initialSet.add(r.id));
    return initialSet;
  });
  const [acknowledgedYellowReqIds, setAcknowledgedYellowReqIds] = useState<Set<string>>(new Set());
  const [feasibilityFilter, setFeasibilityFilter] = useState<'ALL' | 'GREEN' | 'YELLOW' | 'RED'>('ALL');
  const [mslSentSuccess, setMslSentSuccess] = useState<{
    count: number;
    totalKg: number;
    timestamp: string;
  } | null>(null);

  // Custom in-app Confirmation Dialog Modal State
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    actionLabel: string;
    onConfirm: () => void;
  } | null>(null);

  // Delete handlers
  const handleDeleteSingleReq = (reqId: string, planIndex?: number) => {
    const planTitle = planIndex !== undefined ? `MSL Plan #${planIndex + 1}` : 'this MSL requirement plan';
    setDeleteConfirmModal({
      isOpen: true,
      title: 'Delete MSL Requirement Plan',
      message: `Are you sure you want to cancel and delete ${planTitle}? This action cannot be undone.`,
      actionLabel: 'Delete Plan',
      onConfirm: () => {
        const updatedReqs = requirements.filter(r => r.id !== reqId);
        onRequirementsUpdated(updatedReqs);
        saveStoredJumboRequirements(updatedReqs);

        const nextSel = new Set(selectedReqIds);
        nextSel.delete(reqId);
        setSelectedReqIds(nextSel);

        const nextAck = new Set(acknowledgedYellowReqIds);
        nextAck.delete(reqId);
        setAcknowledgedYellowReqIds(nextAck);
        setMslSentSuccess(null);
        setDeleteConfirmModal(null);
      }
    });
  };

  const handleDeleteAllForFilm = () => {
    if (filteredReqs.length === 0) return;
    const count = filteredReqs.length;
    setDeleteConfirmModal({
      isOpen: true,
      title: 'Delete All MSL Requirement Plans',
      message: `Are you sure you want to cancel and delete all ${count} MSL requirement plans for ${selectedFilm}?`,
      actionLabel: `Delete All (${count}) Plans`,
      onConfirm: () => {
        const deleteIds = new Set(filteredReqs.map(r => r.id));
        const remainingOtherReqs = requirements.filter(r => !deleteIds.has(r.id));
        onRequirementsUpdated(remainingOtherReqs);
        saveStoredJumboRequirements(remainingOtherReqs);

        setSelectedReqIds(new Set());
        setAcknowledgedYellowReqIds(new Set());
        setMslSentSuccess(null);
        setDeleteConfirmModal(null);
      }
    });
  };

  // PS01 Manufacturing Plan Modal & Factory Sheet Viewer State
  const [ps01ManufacturingModal, setPs01ManufacturingModal] = useState<{
    isOpen: boolean;
    plans: SlitterPlan[];
    film: string;
    logs: any[];
  }>({
    isOpen: false,
    plans: [],
    film: '',
    logs: [],
  });
  const [selectedPlanForFactorySheet, setSelectedPlanForFactorySheet] = useState<SlitterPlan | null>(null);
  const [selectedPhysicalMslPlan, setSelectedPhysicalMslPlan] = useState<MetallizerPlan | null>(null);
  const activePhysicalPlans = useMemo(() => {
    return plans && plans.length > 0 ? plans : getStoredMetallizerPlans();
  }, [plans]);

  // Open full industrial Slitter Sheet (PlanDetailViewer) for an MSL Plan
  const handleOpenMslSheet = (req: JumboRequirement, originalIndex: number) => {
    const mslSlitterPlan = generateMSLSlitterPlan(
      req,
      originalIndex,
      selectedFilm,
      currentUser?.name
    );
    setSelectedPlanForFactorySheet(mslSlitterPlan);
  };

  // Selected film demand stats (across compatible pool)
  const filmOrders = metallizedOrders.filter(o => compatibleFilmsForSelection.includes(o.film) && o.remaining_qty > 0);
  const totalFilmDemandKg = filmOrders.reduce((sum, o) => sum + o.remaining_qty, 0);
  const uniqueFinishedWidths = Array.from(new Set(filmOrders.map(o => o.width_mm))).sort((a, b) => Number(a) - Number(b));
  const uniqueFinishedLengths = Array.from(new Set(filmOrders.map(o => o.length_m))).sort((a, b) => Number(a) - Number(b));
  const thicknessMicron = filmOrders[0]?.thickness_micron || 18;

  // Sync selected requirements when film changes or requirements refresh
  useEffect(() => {
    const nextSet = new Set<string>();
    const currentFilmReqs = requirements.filter(r => 
      r.film === selectedFilm || compatibleFilmsForSelection.includes(r.film) || r.film.includes(selectedFilm)
    );
    currentFilmReqs.forEach(r => {
      if (r.selected_for_msl === true || (r.selected_for_msl === undefined && r.ps01_feasibility?.status === 'GREEN')) {
        nextSet.add(r.id);
      }
    });
    setSelectedReqIds(nextSet);
    setMslSentSuccess(null);
    setErrorState(null);
  }, [selectedFilm, requirements.length]);

  const applySynthesisResult = (generated: JumboRequirement[]) => {
    const otherFilmReqs = requirements.filter(r =>
      !compatibleFilmsForSelection.includes(r.film) && !r.film.includes(selectedFilm)
    );
    const merged = [...otherFilmReqs, ...generated];
    onRequirementsUpdated(merged);
    saveStoredJumboRequirements(merged);
    const greenSet = new Set<string>();
    generated.filter(r => r.ps01_feasibility?.status === 'GREEN').forEach(r => greenSet.add(r.id));
    setSelectedReqIds(greenSet);
    setAcknowledgedYellowReqIds(new Set());
    setMslSentSuccess(null);
    setErrorState(null);
    setGenerationPercent(100);
    setGenerationProgress('Optimization complete!');
    setTimeout(() => {
      setIsGenerating(false);
      setGenerationProgress('');
      setGenerationPercent(0);
    }, 150);
  };

  const handleGenerate = () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setWasCancelled(false);
    setErrorState(null);
    setGenerationPercent(15);
    setGenerationProgress('Synthesizing 1–6 UPS combinations & evaluating PS01 deckles...');

    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    const finishError = (message: string) => {
      setErrorState({ message, film: selectedFilm });
      setIsGenerating(false);
      setGenerationProgress('');
      setGenerationPercent(0);
    };

    try {
      const worker = new MSLWorker();
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent<MSLWorkerResponse>) => {
        const msg = e.data;
        if (msg.type === 'SYNTHESIS_SUCCESS' && msg.requirements) {
          applySynthesisResult(msg.requirements as JumboRequirement[]);
          if (workerRef.current === worker) {
            worker.terminate();
            workerRef.current = null;
          }
        } else if (msg.type === 'MSL_ERROR') {
          finishError(msg.error || 'Synthesis encountered an issue. You can safely retry.');
          if (workerRef.current === worker) {
            worker.terminate();
            workerRef.current = null;
          }
        }
      };

      worker.onerror = () => {
        try {
          const generated = generateJumboRollRequirements(orders, settings, selectedFilm);
          applySynthesisResult(generated);
        } catch (err: any) {
          finishError(err?.message || 'Synthesis encountered an issue. You can safely retry.');
        }
        if (workerRef.current === worker) {
          worker.terminate();
          workerRef.current = null;
        }
      };

      worker.postMessage({
        type: 'RUN_SYNTHESIS',
        orders,
        settings,
        film: selectedFilm,
        filmSpecs: getFilmSpecsSnapshotForPlanning(),
      });

      // SYNTHESIS_WATCHDOG: never leave UI timer spinning forever
      const watchdogId = window.setTimeout(() => {
        if (workerRef.current === worker) {
          worker.terminate();
          workerRef.current = null;
          finishError('Synthesis timed out (120s). Try a single film or fewer orders, then retry.');
        }
      }, 120000);
      const prevOnMessage = worker.onmessage;
      worker.onmessage = (e: MessageEvent<any>) => {
        window.clearTimeout(watchdogId);
        if (typeof prevOnMessage === 'function') prevOnMessage.call(worker, e);
      };
      const prevOnError = worker.onerror;
      worker.onerror = (ev: ErrorEvent) => {
        window.clearTimeout(watchdogId);
        if (typeof prevOnError === 'function') prevOnError.call(worker, ev);
      };
    } catch {
      try {
        const generated = generateJumboRollRequirements(orders, settings, selectedFilm);
        applySynthesisResult(generated);
      } catch (err: any) {
        finishError(err?.message || 'Synthesis encountered an issue. You can safely retry.');
      }
    }
  };

  // Toggle selection for a plan
  const handleToggleSelectReq = (req: JumboRequirement) => {
    const isRed = req.ps01_feasibility?.status === 'RED';
    if (isRed) return; // RED plans are locked and cannot proceed

    const isYellow = req.ps01_feasibility?.status === 'YELLOW';
    const next = new Set(selectedReqIds);

    if (next.has(req.id)) {
      next.delete(req.id);
    } else {
      // If YELLOW and not yet acknowledged, auto-acknowledge upon explicit selection
      if (isYellow && !acknowledgedYellowReqIds.has(req.id)) {
        const nextAck = new Set(acknowledgedYellowReqIds);
        nextAck.add(req.id);
        setAcknowledgedYellowReqIds(nextAck);
      }
      next.add(req.id);
    }
    setSelectedReqIds(next);
    setMslSentSuccess(null);
  };

  // Toggle explicit relaxation acknowledgment for YELLOW proposed plans
  const handleToggleAcknowledgeYellow = (reqId: string) => {
    const nextAck = new Set(acknowledgedYellowReqIds);
    const nextSel = new Set(selectedReqIds);
    if (nextAck.has(reqId)) {
      nextAck.delete(reqId);
      nextSel.delete(reqId);
    } else {
      nextAck.add(reqId);
      nextSel.add(reqId);
    }
    setAcknowledgedYellowReqIds(nextAck);
    setSelectedReqIds(nextSel);
    setMslSentSuccess(null);
  };

  // Select all auto-approved GREEN plans
  const handleSelectAllGreen = () => {
    const next = new Set<string>();
    filteredReqs.filter(r => r.ps01_feasibility?.status === 'GREEN').forEach(r => next.add(r.id));
    setSelectedReqIds(next);
    setMslSentSuccess(null);
  };

  // Deselect all
  const handleDeselectAll = () => {
    setSelectedReqIds(new Set());
    setMslSentSuccess(null);
  };

  // Send manually selected plans to MSL Planning Studio & physical stock
  const handleSendSelectedToMSL = () => {
    if (isSendingToMsl) return; // Prevent duplicate submissions
    const selectedList = filteredReqs.filter(r => selectedReqIds.has(r.id));
    if (selectedList.length === 0) {
      alert('Please select at least one approved plan to send to MSL.');
      return;
    }

    setIsSendingToMsl(true);
    try {
      // Update requirements with selection flags
      const updatedReqs = requirements.map(r => {
        if (r.film === selectedFilm || compatibleFilmsForSelection.includes(r.film)) {
          return {
            ...r,
            selected_for_msl: selectedReqIds.has(r.id),
            relaxation_accepted: acknowledgedYellowReqIds.has(r.id),
          };
        }
        return r;
      });

      onRequirementsUpdated(updatedReqs);
      saveStoredJumboRequirements(updatedReqs);

      // Synchronize physical jumbo rolls into inventory for MSL Studio (deduplicated by deterministic key)
      // PLX-A08: this used to drop every roll of the selected/compatible films and
      // replace them with freshly synthesized AVAILABLE rolls, destroying
      // PARTIALLY_CONSUMED/CONSUMED material and orphaning the plans that
      // referenced it. Existing rolls are now preserved untouched and only
      // genuinely new roll ids are appended.
      const existingRolls = getStoredJumboRolls();
      const existingRollIds = new Set(existingRolls.map(r => r.id));
      
      const newRolls: JumboRoll[] = selectedList.flatMap((req, rIdx) => {
        const rollsForReq: JumboRoll[] = [];
        for (let i = 0; i < req.required_rolls_count; i++) {
          const singleRollKg = Number((req.total_weight_kg / req.required_rolls_count).toFixed(2));
          const rollId = `jr-roll-${req.film}-${req.id}-${i + 1}`;
          rollsForReq.push({
            id: rollId,
            roll_id: `JR-${req.film}-${req.required_jumbo_width_mm}-${String(i + 1).padStart(2, '0')}`,
            film: req.film,
            width_mm: req.required_jumbo_width_mm,
            length_m: req.required_jumbo_length_m,
            remaining_length_m: req.required_jumbo_length_m,
            thickness_micron: req.thickness_micron,
            density: 0.91,
            core: req.core || '10-inch steel core',
            diameter_mm: req.calculated_diameter_mm,
            total_weight_kg: singleRollKg,
            remaining_quantity_kg: singleRollKg,
            status: 'AVAILABLE',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            source_plan: `PS01-${req.film}-${rIdx + 1}`,
            source_requirement_id: req.id,
            source_requirement: req,
          });
        }
        return rollsForReq;
      });

      // Filter out any duplicates, and never re-add a roll id that already exists
      // (re-adding would reset a partially consumed roll back to AVAILABLE).
      const dedupedNewRolls = newRolls.filter(
        (roll, idx, self) => self.findIndex(r => r.id === roll.id) === idx && !existingRollIds.has(roll.id)
      );
      const finalRolls = [...existingRolls, ...dedupedNewRolls];
      saveStoredJumboRolls(finalRolls);
      if (onJumboRollsUpdated) {
        onJumboRollsUpdated(finalRolls);
      }

      const totalKg = selectedList.reduce((sum, r) => sum + r.total_weight_kg, 0);
      setMslSentSuccess({
        count: selectedList.length,
        totalKg,
        timestamp: new Date().toLocaleTimeString(),
      });
    } finally {
      setIsSendingToMsl(false);
    }
  };

  const handleGeneratePS01Plan = async (reqs: JumboRequirement[]) => {
    if (isGeneratingPs01) return;
    const plansToUse = reqs.filter(r => selectedReqIds.has(r.id));
    const targetReqs = plansToUse.length > 0 ? plansToUse : reqs.filter(r => r.ps01_feasibility?.status === 'GREEN');
    
    if (targetReqs.length === 0) {
      alert('No eligible approved or selected jumbo requirements to generate PS01 Manufacturing Plan.');
      return;
    }

    setIsGeneratingPs01(true);
    try {
      const result = generatePS01ManufacturingPlansForJumbos(targetReqs, selectedFilm, currentUser?.name);
      setPs01ManufacturingModal({
        isOpen: true,
        plans: result.plans,
        film: selectedFilm,
        logs: result.logs,
      });
    } catch (err: any) {
      console.error('PS01 Plan generation error:', err);
      alert(`PS01 Plan generation encountered an issue: ${err?.message || err}`);
    } finally {
      setIsGeneratingPs01(false);
    }
  };

  const selectedCount = filteredReqs.filter(r => selectedReqIds.has(r.id)).length;
  const selectedWeightKg = filteredReqs
    .filter(r => selectedReqIds.has(r.id))
    .reduce((sum, r) => sum + r.total_weight_kg, 0);

  const totalRequiredRolls = filteredReqs.reduce((sum, r) => sum + r.required_rolls_count, 0);
  const totalRequiredWeightKg = filteredReqs.reduce((sum, r) => sum + r.total_weight_kg, 0);

  const defaultPlannerUser: UserProfile = currentUser || {
    id: 'planner-msl-01',
    name: 'Muhammad Tariq',
    role: 'PLANNER',
    department: 'Slitter Planning Department',
  };

  return (
    <div className="space-y-6" id="msl-requirements-view">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 text-xs font-bold rounded bg-purple-100 text-purple-800">
              UPSTREAM MSL ↔ PS01 HANDSHAKE
            </span>
            <span className="text-xs text-slate-500 font-mono">Mutual Feasibility Authority</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-1">Jumbo Roll Requirement & Feasibility Planner</h1>
          <p className="text-xs text-slate-500">
            Synthesizes 1–6 UPS finished slitting configurations with PS01 mother deckle feasibility handshake (deckle from Machine Parameters)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleGenerate}
            disabled={isGenerating || filmOrders.length === 0}
            className="flex items-center space-x-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <Sparkles className={`w-4 h-4 ${isGenerating ? 'animate-spin text-purple-200' : ''}`} />
            <span>{isGenerating ? 'Handshaking PS01...' : `Synthesize & Handshake (${selectedFilm})`}</span>
          </button>
          
          {filteredReqs.length > 0 && (
            <button
              onClick={() => handleGeneratePS01Plan(filteredReqs)}
              disabled={isGeneratingPs01}
              className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              title="Generate full PS01 manufacturing factory sheet for selected requirements"
            >
              <Send className={`w-4 h-4 text-indigo-200 ${isGeneratingPs01 ? 'animate-spin' : ''}`} />
              <span>{isGeneratingPs01 ? 'Generating PS01 Plan...' : 'Generate PS01 Manufacturing Plan'}</span>
            </button>
          )}

          <button
            onClick={onNavigateToStudio}
            className="flex items-center space-x-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            <span>Proceed to MSL Studio</span>
            <ArrowRight className="w-4 h-4 ml-1 text-purple-400" />
          </button>
        </div>
      </div>

      {/* Error Recovery Banner */}
      {errorState && (
        <div className="bg-rose-950 text-white rounded-xl p-4 shadow-md border border-rose-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start space-x-3 text-xs">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm text-rose-200">
                Synthesis Stopped with Error ({errorState.film})
              </p>
              <p className="text-rose-300 mt-0.5 font-mono text-[11px]">
                {errorState.message}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={handleGenerate}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry Synthesis</span>
            </button>
            <button
              onClick={() => setErrorState(null)}
              className="px-2.5 py-1.5 bg-rose-900/60 hover:bg-rose-900 text-rose-300 text-xs font-medium rounded-lg transition-colors cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {wasCancelled && !isGenerating && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-xs flex items-center justify-between">
          <span className="font-semibold">Synthesis was cancelled by user.</span>
          <button type="button" onClick={() => setWasCancelled(false)} className="text-amber-600 hover:underline cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Real-time Handshake Progress Indicator Banner (PS-style timer + cancel) */}
      {isGenerating && (
        <div className="bg-purple-950 text-white rounded-xl p-4 shadow-md border border-purple-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 text-xs">
              <Sparkles className="w-5 h-5 text-purple-300 animate-spin shrink-0" />
              <div>
                <p className="font-bold text-sm text-purple-100 flex items-center space-x-2">
                  <span>Combinatorial Optimizer Active</span>
                  <span className="text-purple-300 font-mono text-xs">({generationPercent}%)</span>
                </p>
                <p className="text-purple-300 mt-0.5 text-xs">
                  {generationProgress || 'Synthesizing multi-width patterns & evaluating PS01 deckles...'}
                </p>
              </div>
            </div>
            <span className="text-[11px] font-mono bg-purple-900/80 px-2.5 py-1 rounded text-purple-200 border border-purple-700 hidden sm:inline-block">
              Elapsed {Math.floor(elapsedMs / 60000).toString().padStart(2, '0')}:
              {Math.floor((elapsedMs % 60000) / 1000).toString().padStart(2, '0')}.
              {Math.floor((elapsedMs % 1000) / 100)}
            </span>
          </div>

          <div className="w-full bg-purple-900/60 rounded-full h-2 overflow-hidden border border-purple-800/60">
            <div
              className="bg-gradient-to-r from-purple-500 to-indigo-400 h-full transition-all duration-150 rounded-full animate-pulse"
              style={{ width: `${Math.max(10, Math.min(100, generationPercent || 35))}%` }}
            />
          </div>

          {elapsedMs > 8000 && (
            <p className="text-[10px] text-purple-200/90 leading-tight">
              <strong>Notice:</strong> Deep combinatorial search is running in a background worker. UI stays responsive — cancel below anytime.
            </p>
          )}

          <button
            type="button"
            onClick={handleCancelSynthesis}
            className="w-full py-2 px-3 bg-red-950/60 hover:bg-red-900/80 text-red-300 hover:text-white border border-red-800/80 font-bold text-xs rounded-lg transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
          >
            <StopCircle className="w-3.5 h-3.5" />
            <span>Cancel Synthesis</span>
          </button>
        </div>
      )}

      {/* Film Grade Selector & Demand Analysis Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center space-x-2 mb-1">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Target Film Grade / Compatible Group
              </label>
              {isCompatibleGroupSelected && (
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center space-x-1">
                  <Network className="w-3 h-3 inline mr-0.5" />
                  <span>Compatible Group: {compatibleFilmsForSelection.join(' ↔ ')}</span>
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {availableFilms.map(film => {
                const isCompat = compatibleFilmsForSelection.includes(film);
                const isPrimarySelected = selectedFilm === film;
                return (
                  <button
                    key={film}
                    onClick={() => setSelectedFilm(film)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer flex items-center space-x-1.5 ${
                      isPrimarySelected
                        ? 'bg-purple-900 text-purple-100 border-purple-900 shadow-xs'
                        : isCompat && isCompatibleGroupSelected
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <span>{film}</span>
                    {isCompat && isCompatibleGroupSelected && !isPrimarySelected && (
                      <span className="text-[10px] bg-emerald-200 text-emerald-900 px-1 py-0.2 rounded">Compat</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center space-x-3 text-xs">
            <span className="px-2.5 py-1 rounded bg-slate-100 text-slate-700 font-mono">
              Thickness: <b>{thicknessMicron} µm</b>
            </span>
            <span className="px-2.5 py-1 rounded bg-purple-50 text-purple-800 font-mono">
              Open Demand: <b>{totalFilmDemandKg.toLocaleString()} kg</b> ({filmOrders.length} orders)
            </span>
          </div>
        </div>

        {/* Selected Film Demand Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <span className="font-bold text-slate-600 block mb-1 text-[11px] uppercase">Finished Widths:</span>
            <div className="flex flex-wrap gap-1.5">
              {uniqueFinishedWidths.map(w => (
                <span key={w} className="px-2 py-0.5 bg-white border border-slate-200 rounded font-mono font-bold text-slate-800">
                  {w} mm
                </span>
              ))}
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <span className="font-bold text-slate-600 block mb-1 text-[11px] uppercase">Package Lengths:</span>
            <div className="flex flex-wrap gap-1.5">
              {uniqueFinishedLengths.map(l => (
                <span key={l} className="px-2 py-0.5 bg-white border border-slate-200 rounded font-mono font-bold text-slate-800">
                  {l.toLocaleString()} m
                </span>
              ))}
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <span className="font-bold text-slate-600 block mb-1 text-[11px] uppercase">MSL Planning Capability:</span>
            <span className="text-slate-700">
              1–6 UPS available · GREEN trim 18–45mm · Max Dia 1250mm · 10" Steel Core
            </span>
          </div>
        </div>
      </div>

      {/* Summary KPI Bar & Aggregated Portfolio Status */}
      {filteredReqs.length > 0 && (() => {
        const greenReqCount = filteredReqs.filter(r => r.ps01_feasibility?.status === 'GREEN').length;
        const yellowReqCount = filteredReqs.filter(r => r.ps01_feasibility?.status === 'YELLOW').length;
        const redReqCount = filteredReqs.filter(r => r.ps01_feasibility?.status === 'RED').length;
        const portfolioStatus: 'GREEN' | 'YELLOW' | 'MIXED' | 'RED' = 
          redReqCount > 0 ? 'RED' :
          yellowReqCount > 0 && greenReqCount > 0 ? 'MIXED' :
          yellowReqCount > 0 ? 'YELLOW' : 'GREEN';

        return (
          <div className="space-y-3">
            {/* Aggregate Portfolio Feasibility Badge & Clickable Filter Badges */}
            <div className={`rounded-xl p-3.5 border flex flex-wrap items-center justify-between gap-3 text-xs ${
              portfolioStatus === 'GREEN' 
                ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950'
                : portfolioStatus === 'MIXED'
                ? 'bg-amber-50/80 border-amber-300 text-amber-950'
                : portfolioStatus === 'YELLOW'
                ? 'bg-amber-50/80 border-amber-300 text-amber-950'
                : 'bg-rose-50 border-rose-300 text-rose-950'
            }`}>
              <div className="flex items-center space-x-2.5">
                <span className="font-bold uppercase tracking-wider text-[11px] text-slate-700">Portfolio Feasibility Status:</span>
                <span className={`px-2.5 py-1 rounded-md font-bold font-mono text-xs border ${
                  portfolioStatus === 'GREEN'
                    ? 'bg-emerald-200 border-emerald-400 text-emerald-950'
                    : portfolioStatus === 'MIXED'
                    ? 'bg-amber-200 border-amber-400 text-amber-950'
                    : portfolioStatus === 'YELLOW'
                    ? 'bg-amber-200 border-amber-400 text-amber-950'
                    : 'bg-rose-200 border-rose-400 text-rose-950'
                }`}>
                  {portfolioStatus === 'MIXED' ? 'MIXED (GREEN + YELLOW)' : portfolioStatus}
                </span>
                <span className="text-slate-600">
                  {portfolioStatus === 'GREEN' && 'All component jumbo plans meet strict nominal PS01 trim (150–280 mm).'}
                  {portfolioStatus === 'MIXED' && `Contains ${greenReqCount} standard (GREEN) and ${yellowReqCount} relaxed (YELLOW) component plans.`}
                  {portfolioStatus === 'YELLOW' && `All component plans utilize non-standard relaxed trim (281–500 mm).`}
                  {portfolioStatus === 'RED' && 'Portfolio contains unmanufacturable RED plans (<150 mm or >500 mm) and cannot be approved.'}
                </span>
              </div>

              {/* Clickable Quick Filter Badges */}
              <div className="flex items-center space-x-2 font-mono text-[11px]">
                <button
                  type="button"
                  onClick={() => setFeasibilityFilter(feasibilityFilter === 'ALL' ? 'ALL' : 'ALL')}
                  className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer border ${
                    feasibilityFilter === 'ALL'
                      ? 'bg-slate-900 text-white border-slate-900 shadow-xs ring-2 ring-slate-400'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                  title="Show All Plans"
                >
                  ALL: {filteredReqs.length}
                </button>
                <button
                  type="button"
                  onClick={() => setFeasibilityFilter(feasibilityFilter === 'GREEN' ? 'ALL' : 'GREEN')}
                  className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer border ${
                    feasibilityFilter === 'GREEN'
                      ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs ring-2 ring-emerald-400'
                      : 'bg-emerald-100 border-emerald-300 text-emerald-900 hover:bg-emerald-200'
                  }`}
                  title="Filter Green Plans Only (Click to toggle)"
                >
                  🟢 GREEN: {greenReqCount}
                </button>
                <button
                  type="button"
                  onClick={() => setFeasibilityFilter(feasibilityFilter === 'YELLOW' ? 'ALL' : 'YELLOW')}
                  className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer border ${
                    feasibilityFilter === 'YELLOW'
                      ? 'bg-amber-500 text-slate-950 border-amber-600 shadow-xs ring-2 ring-amber-400'
                      : 'bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-200'
                  }`}
                  title="Filter Yellow Plans Only (Click to toggle)"
                >
                  🟡 YELLOW: {yellowReqCount}
                </button>
                {redReqCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setFeasibilityFilter(feasibilityFilter === 'RED' ? 'ALL' : 'RED')}
                    className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer border ${
                      feasibilityFilter === 'RED'
                        ? 'bg-rose-600 text-white border-rose-700 shadow-xs ring-2 ring-rose-400'
                        : 'bg-rose-100 border-rose-300 text-rose-900 hover:bg-rose-200'
                    }`}
                    title="Filter Red Plans Only (Click to toggle)"
                  >
                    🔴 RED: {redReqCount}
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Customer Demand</span>
                <div className="text-2xl font-black text-slate-900 font-mono mt-1">
                  {totalFilmDemandKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-normal text-slate-500 font-sans">KG</span>
                </div>
                <span className="text-[11px] text-slate-500">{filmOrders.length} Open Orders</span>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Max Allowed (+10%)</span>
                <div className="text-2xl font-black text-slate-800 font-mono mt-1">
                  {filmOrders.reduce((sum, o) => sum + (o.remaining_qty * MSL_CUSTOMER_MAX_OVERALLOCATION_FACTOR), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-normal text-slate-500 font-sans">KG</span>
                </div>
                <span className="text-[11px] text-slate-500 font-bold">Sum of Individual +10% Ceilings</span>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Selected MSL Sourcing</span>
                <div className="text-2xl font-black text-purple-700 font-mono mt-1">
                  {selectedWeightKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-normal text-slate-500 font-sans">KG</span>
                </div>
                <span className="text-[11px] text-purple-600 font-bold">{selectedCount} of {filteredReqs.length} Plans Selected</span>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Physical Slit Trim</span>
                <div className="text-2xl font-black text-slate-900 font-mono mt-1">
                  {totalFilmDemandKg > 0 
                    ? `${Math.max(0, totalRequiredWeightKg - totalFilmDemandKg).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KG`
                    : '0.0 KG'}
                </div>
                <span className="text-[11px] text-slate-600 font-bold">
                  {totalFilmDemandKg > 0 
                    ? `${(((totalRequiredWeightKg - totalFilmDemandKg) / totalFilmDemandKg) * 100).toFixed(2)}% Physical Edge Trim`
                    : '0.00%'}
                </span>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Approved Jumbo Rolls</span>
                <div className="text-2xl font-black text-indigo-700 font-mono mt-1">
                  {totalRequiredRolls} <span className="text-xs font-normal text-slate-500 font-sans">Jumbo Rolls</span>
                </div>
                <span className="text-[11px] text-slate-600 font-bold font-mono">
                  {greenReqCount} GREEN · {yellowReqCount} YELLOW · {redReqCount} RED
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* PLANNER SELECTION & MSL WORKFLOW CONTROL BAR */}
      {filteredReqs.length > 0 && (() => {
        const greenReqCount = filteredReqs.filter(r => r.ps01_feasibility?.status === 'GREEN').length;
        const yellowReqCount = filteredReqs.filter(r => r.ps01_feasibility?.status === 'YELLOW').length;
        const redReqCount = filteredReqs.filter(r => r.ps01_feasibility?.status === 'RED').length;

        return (
          <div className="bg-slate-900 text-white rounded-xl p-4 shadow-sm border border-slate-800 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-purple-300">Planner Selection:</span>
                  <span className="bg-purple-950 px-3 py-1 rounded-full border border-purple-700 font-mono font-bold text-purple-200">
                    {selectedCount} of {filteredReqs.length} Plans Selected ({selectedWeightKg.toLocaleString()} KG)
                  </span>
                </div>
                <div className="h-4 w-px bg-slate-700 hidden sm:block" />
                <button
                  onClick={handleSelectAllGreen}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-md transition-colors font-semibold cursor-pointer flex items-center space-x-1"
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  <span>Select All Approved (GREEN)</span>
                </button>
                <button
                  onClick={handleDeselectAll}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-md transition-colors font-semibold cursor-pointer"
                >
                  Deselect All
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleDeleteAllForFilm}
                  className="px-3.5 py-2 bg-red-950/80 hover:bg-red-900 text-red-300 hover:text-white border border-red-800/80 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer"
                  title={`Cancel & Delete all ${filteredReqs.length} generated MSL plans for ${selectedFilm}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete All Plans ({filteredReqs.length})</span>
                </button>

                <button
                  onClick={handleSendSelectedToMSL}
                  disabled={selectedCount === 0 || isSendingToMsl}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center space-x-2 transition-all shadow-md cursor-pointer"
                >
                  <Send className={`w-4 h-4 ${isSendingToMsl ? 'animate-spin' : ''}`} />
                  <span>{isSendingToMsl ? 'Staging into MSL...' : `Send Selected Plans to MSL (${selectedCount})`}</span>
                </button>
              </div>
            </div>

            {/* Filter Buttons Row (All, Green, Yellow, Red) */}
            <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center space-x-1.5">
                <span className="text-slate-400 text-[11px] font-semibold flex items-center space-x-1 mr-1">
                  <Filter className="w-3.5 h-3.5 text-purple-400" />
                  <span>Filter View:</span>
                </span>
                <button
                  type="button"
                  onClick={() => setFeasibilityFilter('ALL')}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                    feasibilityFilter === 'ALL'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  <span>All Plans</span>
                  <span className="px-1.5 py-0.2 bg-black/30 rounded font-mono text-[10px]">{filteredReqs.length}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFeasibilityFilter('GREEN')}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                    feasibilityFilter === 'GREEN'
                      ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-400'
                      : 'bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900 border border-emerald-800'
                  }`}
                >
                  <span>🟢 Green Only</span>
                  <span className="px-1.5 py-0.2 bg-black/30 rounded font-mono text-[10px]">{greenReqCount}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFeasibilityFilter('YELLOW')}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                    feasibilityFilter === 'YELLOW'
                      ? 'bg-amber-500 text-slate-950 shadow-sm ring-2 ring-amber-300 font-black'
                      : 'bg-amber-950/60 text-amber-300 hover:bg-amber-900 border border-amber-800'
                  }`}
                >
                  <span>🟡 Yellow Only</span>
                  <span className="px-1.5 py-0.2 bg-black/30 rounded font-mono text-[10px]">{yellowReqCount}</span>
                </button>

                {redReqCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setFeasibilityFilter('RED')}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                      feasibilityFilter === 'RED'
                        ? 'bg-rose-600 text-white shadow-sm ring-2 ring-rose-400'
                        : 'bg-rose-950/60 text-rose-300 hover:bg-rose-900 border border-rose-800'
                    }`}
                  >
                    <span>🔴 Red Only</span>
                    <span className="px-1.5 py-0.2 bg-black/30 rounded font-mono text-[10px]">{redReqCount}</span>
                  </button>
                )}
              </div>

              {feasibilityFilter !== 'ALL' && (
                <div className="flex items-center space-x-2 text-[11px] text-purple-300">
                  <span>Filtered to <strong>{feasibilityFilter}</strong> plans only</span>
                  <button
                    type="button"
                    onClick={() => setFeasibilityFilter('ALL')}
                    className="underline hover:text-white cursor-pointer"
                  >
                    (Clear Filter)
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Success Notification Banner for MSL Sending */}
      {mslSentSuccess && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-4 flex items-center justify-between text-emerald-900">
          <div className="flex items-center space-x-3 text-xs font-medium">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <p className="font-bold text-sm text-emerald-950">
                {mslSentSuccess.count} Plan(s) Successfully Sent to MSL Planning Studio!
              </p>
              <p className="text-emerald-800 mt-0.5">
                Staged {mslSentSuccess.totalKg.toLocaleString()} KG of approved jumbo requirements into active MSL inventory at {mslSentSuccess.timestamp}.
              </p>
            </div>
          </div>
          <button
            onClick={onNavigateToStudio}
            className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg transition-colors flex items-center space-x-1.5 cursor-pointer shadow-xs"
          >
            <span>Proceed to MSL Studio</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Requirements List / Cards grouped by PS01 Mother Roll Deckle Runs */}
      <div className="space-y-6">
        {filteredReqs.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400 space-y-3">
            <Boxes className="w-10 h-10 mx-auto text-slate-300" />
            <p className="text-sm font-semibold text-slate-700">No Jumbo Requirements Generated for {selectedFilm}</p>
            <p className="text-xs max-w-md mx-auto text-slate-500">
              Click "Synthesize & Handshake" above to explore 1–6 UPS configurations and perform the automatic feasibility check with PS01.
            </p>
            <button
              onClick={handleGenerate}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer inline-flex items-center space-x-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Generate Now</span>
            </button>
          </div>
        ) : (
          (() => {
            const displayedReqs = filteredReqs.filter(r => {
              if (feasibilityFilter === 'ALL') return true;
              return r.ps01_feasibility?.status === feasibilityFilter;
            });

            if (displayedReqs.length === 0) {
              return (
                <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500 space-y-3 shadow-xs">
                  <Filter className="w-8 h-8 mx-auto text-purple-400" />
                  <p className="text-sm font-bold text-slate-800">
                    No {feasibilityFilter} MSL Plans Found for {selectedFilm}
                  </p>
                  <p className="text-xs text-slate-500">
                    There are {filteredReqs.length} total plans available across other categories.
                  </p>
                  <button
                    onClick={() => setFeasibilityFilter('ALL')}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg cursor-pointer inline-flex items-center space-x-1.5 shadow-xs"
                  >
                    <span>Show All {filteredReqs.length} Plans</span>
                  </button>
                </div>
              );
            }

            // Group requirements by PS01 mother deckle combination run
            interface DeckleRunGroup {
              deckleKey: string;
              runIndex: number;
              feasibility: NonNullable<JumboRequirement['ps01_feasibility']>;
              reqs: { req: JumboRequirement; originalIndex: number }[];
              totalDeckleKg: number;
            }

            const deckleGroups: DeckleRunGroup[] = [];
            const groupMap = new Map<string, DeckleRunGroup>();

            displayedReqs.forEach((req) => {
              const idx = filteredReqs.findIndex(fr => fr.id === req.id);
              const originalIdx = idx >= 0 ? idx : 0;
              const feasibility = req.ps01_feasibility || {
                status: 'GREEN' as const,
                is_feasible: true,
                ps01_deckle_mm: settings.ps01_deckle_width_mm ?? 10400,
                jumbo_width_mm: req.required_jumbo_width_mm,
                ps01_ups: req.required_jumbo_width_mm <= 2600 ? 4 : 3,
                ps01_cut_combination: [req.required_jumbo_width_mm, req.required_jumbo_width_mm, req.required_jumbo_width_mm],
                ps01_total_width_mm: req.required_jumbo_width_mm * 3,
                ps01_trim_mm: Math.max(0, (settings.ps01_deckle_width_mm ?? 10400) - (req.required_jumbo_width_mm * 3)),
                ps01_deckle_efficiency_percent: Number((((req.required_jumbo_width_mm * 3) / (settings.ps01_deckle_width_mm ?? 10400)) * 100).toFixed(2)),
                ps01_duplex_balanced: true,
                side_a_ups: 2,
                side_b_ups: 1,
                relaxation_type: 'NONE' as const,
                explanation: `PS01 Deckle Run ([${req.required_jumbo_width_mm}] mm pattern)`
              };

              // Group by physical mother pattern (not iterative ps01-run-N id)
              // so identical 3405×3 GREEN runs collapse into ONE upstream mother run.
              const cutsArr = (feasibility.ps01_cut_combination || [req.required_jumbo_width_mm]).slice().sort((a, b) => a - b);
              const cutsKey = cutsArr.join('-');
              const motherDeckle = feasibility.ps01_deckle_mm || settings.ps01_deckle_width_mm || 10400;
              const groupKey = [
                req.film || selectedFilm || '',
                motherDeckle,
                cutsKey,
                req.required_jumbo_length_m || 0,
              ].join('|');

              let group = groupMap.get(groupKey);
              if (!group) {
                group = {
                  deckleKey: groupKey,
                  runIndex: deckleGroups.length + 1,
                  feasibility,
                  reqs: [],
                  totalDeckleKg: 0,
                };
                groupMap.set(groupKey, group);
                deckleGroups.push(group);
              }

              group.reqs.push({ req, originalIndex: originalIdx });
              group.totalDeckleKg += req.total_weight_kg;
            });

            return (
              <div className="space-y-6">
                {deckleGroups.map((group, groupIdx) => {
                  const feas = group.feasibility;
                  const isGreen = feas.status === 'GREEN';
                  const isYellow = feas.status === 'YELLOW';
                  const isRed = feas.status === 'RED';
                  const cutCombination = feas.ps01_cut_combination || [feas.jumbo_width_mm];
                  const primaryReq = group.reqs[0]?.req;

                  // Check how many plans in this group are selected
                  const groupSelectedCount = group.reqs.filter(g => selectedReqIds.has(g.req.id)).length;
                  const allGroupSelected = group.reqs.length > 0 && groupSelectedCount === group.reqs.length;

                  // Group-level select/deselect handler
                  const handleToggleGroupSelect = () => {
                    const next = new Set(selectedReqIds);
                    if (allGroupSelected) {
                      group.reqs.forEach(g => next.delete(g.req.id));
                    } else {
                      group.reqs.forEach(g => {
                        if (g.req.ps01_feasibility?.status !== 'RED') {
                          next.add(g.req.id);
                        }
                      });
                    }
                    setSelectedReqIds(next);
                    setMslSentSuccess(null);
                  };

                  return (
                    <div 
                      key={group.deckleKey || groupIdx}
                      className="bg-white border-2 border-slate-300 rounded-2xl shadow-md overflow-hidden"
                    >
                      {/* 1. UPSTREAM PS01 MOTHER ROLL DECKLE HEADER (Rendered ONLY ONCE per Mother Run) */}
                      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-5 border-b border-slate-700">
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2.5">
                              <span className="px-3 py-1 bg-purple-600 text-white text-xs font-black rounded-md tracking-wider uppercase flex items-center space-x-1.5 shadow-xs">
                                <Layers className="w-3.5 h-3.5" />
                                <span>PS01 Upstream Mother Roll Run #{group.runIndex}</span>
                              </span>

                              <span className="text-sm font-bold text-slate-100">
                                Mother Deckle: <span className="font-mono text-purple-300">{(feas.ps01_deckle_mm || settings.ps01_deckle_width_mm || 10400).toLocaleString()} mm</span>
                              </span>

                              <span className="text-xs text-slate-400 font-mono">
                                ({feas.ps01_ups}-UPS PS01 Configuration)
                              </span>

                              {/* Feasibility Badge */}
                              {isGreen && (
                                <span className="px-2.5 py-0.5 text-xs font-bold bg-emerald-950 text-emerald-300 border border-emerald-600 rounded flex items-center space-x-1">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>STANDARD FEASIBLE (GREEN)</span>
                                </span>
                              )}
                              {isYellow && (
                                <span className="px-2.5 py-0.5 text-xs font-bold bg-amber-950 text-amber-300 border border-amber-600 rounded flex items-center space-x-1">
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                                  <span>RELAXED TRIM (YELLOW)</span>
                                </span>
                              )}
                              {isRed && (
                                <span className="px-2.5 py-0.5 text-xs font-bold bg-rose-950 text-rose-300 border border-rose-600 rounded flex items-center space-x-1">
                                  <XCircle className="w-3.5 h-3.5 text-rose-400" />
                                  <span>INFEASIBLE (RED)</span>
                                </span>
                              )}
                            </div>

                            {/* Cut Pattern & Upstream Handshake Details */}
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300 pt-1">
                              <div>
                                <span className="text-slate-400 font-semibold">PS01 Slit Combination: </span>
                                <span className="font-mono font-bold text-emerald-400">
                                  [{cutCombination.map(w => `${w} mm`).join(', ')}]
                                </span>
                                <span className="text-slate-400 font-mono"> = {feas.ps01_total_width_mm.toLocaleString()} mm</span>
                              </div>
                              <div className="h-3 w-px bg-slate-700 hidden sm:block" />
                              <div>
                                <span className="text-slate-400 font-semibold">PS01 Edge Trim: </span>
                                <span className="font-mono font-bold text-amber-300">{feas.ps01_trim_mm} mm</span>
                              </div>
                              <div className="h-3 w-px bg-slate-700 hidden sm:block" />
                              <div>
                                <span className="text-slate-400 font-semibold">Deckle Efficiency: </span>
                                <span className="font-mono font-bold text-purple-300">{feas.ps01_deckle_efficiency_percent}%</span>
                              </div>
                            </div>
                          </div>

                          {/* Upstream Factory Sheet & Group Selection Actions */}
                          <div className="flex flex-wrap items-center gap-2.5">
                            {primaryReq && (
                              <button
                                onClick={() => {
                                  const decklePlan = generatePS01PlanForDeckleGroup(
                                    group.reqs.map(g => g.req),
                                    group.runIndex,
                                    selectedFilm,
                                    currentUser?.name
                                  );
                                  setSelectedPlanForFactorySheet(decklePlan);
                                }}
                                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold text-xs flex items-center space-x-1.5 transition-colors cursor-pointer shadow-sm"
                                title={`Open official factory manufacturing sheet for PS01 Run #${group.runIndex}`}
                              >
                                <FileSpreadsheet className="w-4 h-4" />
                                <span>View PS01 Factory Sheet #{group.runIndex}</span>
                              </button>
                            )}

                            {!isRed && (
                              <button
                                onClick={handleToggleGroupSelect}
                                className={`px-3 py-2 rounded-lg font-bold text-xs flex items-center space-x-1.5 transition-colors cursor-pointer border ${
                                  allGroupSelected
                                    ? 'bg-purple-700 hover:bg-purple-600 text-white border-purple-500 shadow-xs'
                                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'
                                }`}
                              >
                                {allGroupSelected ? (
                                  <CheckSquare className="w-4 h-4 text-white" />
                                ) : (
                                  <Square className="w-4 h-4 text-slate-400" />
                                )}
                                <span>{allGroupSelected ? 'All Plans Selected' : `Select All ${group.reqs.length} Plans`}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 2. DOWNSTREAM METALLIZER SLITTER (MSL) PLANS PRODUCED FROM THIS MOTHER RUN */}
                      <div className="p-5 bg-slate-50/70 space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center space-x-1.5">
                              <ArrowRight className="w-4 h-4 text-purple-600" />
                              <span>Downstream Metallizer Slitter (MSL) Plans Fed by this Mother Roll:</span>
                            </span>
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-800 text-[11px] font-bold rounded-full font-mono">
                              {group.reqs.length} MSL Slit Plan{group.reqs.length > 1 ? 's' : ''}
                            </span>
                          </div>
                          <span className="text-xs font-mono font-bold text-slate-600">
                            Total Yield: {group.totalDeckleKg.toLocaleString()} KG
                          </span>
                        </div>

                        <div className="grid grid-cols-1 gap-3.5">
                          {group.reqs.map(({ req, originalIndex }) => {
                            const isReqSelected = selectedReqIds.has(req.id);
                            const isReqYellow = req.ps01_feasibility?.status === 'YELLOW';
                            const isReqRed = req.ps01_feasibility?.status === 'RED';
                            const isReqAcknowledged = acknowledgedYellowReqIds.has(req.id);

                            const jumboLen = req.required_jumbo_length_m || 20000;
                            const coveredLengths = (req.orders_covered || []).map(o => o.length_m).filter(Boolean);
                            const packLengthM = coveredLengths.length > 0
                              ? Math.max(...coveredLengths)
                              : Math.round(jumboLen / Math.max(1, req.package_multiple || 1));
                            const setsPerJumbo = Math.max(1, Math.round(jumboLen / packLengthM));
                            const totalPacks = (req.required_rolls_count || 1) * setsPerJumbo;

                            return (
                              <div
                                key={req.id || originalIndex}
                                className={`bg-white border rounded-xl p-4 shadow-xs transition-all ${
                                  isReqSelected 
                                    ? 'border-purple-500 ring-2 ring-purple-100' 
                                    : isReqRed
                                    ? 'border-rose-200 bg-rose-50/20'
                                    : 'border-slate-200 hover:border-purple-300'
                                }`}
                              >
                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                                  <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      {/* Individual MSL Plan Selection Checkbox */}
                                      <button
                                        onClick={() => handleToggleSelectReq(req)}
                                        disabled={isReqRed}
                                        className={`px-2.5 py-1 rounded-md border transition-all flex items-center space-x-1.5 text-xs font-bold cursor-pointer ${
                                          isReqRed 
                                            ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60' 
                                            : isReqSelected
                                            ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                                            : 'bg-white text-slate-700 border-slate-300 hover:border-purple-400'
                                        }`}
                                        title={isReqRed ? 'Infeasible plans cannot be selected' : isReqSelected ? 'Click to Deselect' : 'Click to Select for MSL'}
                                      >
                                        {isReqSelected ? (
                                          <CheckSquare className="w-3.5 h-3.5" />
                                        ) : isReqRed ? (
                                          <XCircle className="w-3.5 h-3.5 text-rose-500" />
                                        ) : (
                                          <Square className="w-3.5 h-3.5" />
                                        )}
                                        <span>{isReqSelected ? 'SELECTED' : isReqRed ? 'REJECTED' : 'SELECT'}</span>
                                      </button>

                                      <span className="px-2 py-0.5 text-xs font-bold rounded-md bg-purple-100 text-purple-800 font-mono">
                                        MSL PLAN #{originalIndex + 1}
                                      </span>
                                      <span className="font-bold text-slate-900 text-sm">
                                        Mount Jumbo: <span className="text-purple-700 font-mono font-black">{req.required_jumbo_width_mm} mm</span> ({req.film} - {req.thickness_micron}µm)
                                      </span>
                                      <span className="px-2 py-0.5 text-[11px] font-semibold bg-purple-50 text-purple-700 rounded border border-purple-200">
                                        {req.ups}-UPS MSL Pattern
                                      </span>
                                      <span className="text-xs font-mono text-purple-800 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded font-bold">
                                        <b>{totalPacks}</b> Packs ({packLengthM.toLocaleString()} m each)
                                      </span>
                                      <span className="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                                        <b>{req.required_rolls_count}</b> Jumbo Roll{req.required_rolls_count > 1 ? 's' : ''} ({req.total_weight_kg.toLocaleString()} kg)
                                      </span>
                                    </div>
                                  </div>

                                  {/* Right side quick specs & View MSL Sheet button */}
                                  <div className="flex flex-wrap items-center gap-3">
                                    <div className="flex items-center space-x-3 text-xs font-mono bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                                      <div>
                                        <span className="text-slate-400 text-[10px] block font-sans uppercase font-bold">Pack Length</span>
                                        <span className="font-bold text-slate-900">{packLengthM.toLocaleString()} m</span>
                                      </div>
                                      <div className="h-4 w-px bg-slate-200" />
                                      <div>
                                        <span className="text-slate-400 text-[10px] block font-sans uppercase font-bold">Total Packs</span>
                                        <span className="font-bold text-purple-700">{totalPacks} Packs</span>
                                      </div>
                                      <div className="h-4 w-px bg-slate-200" />
                                      <div>
                                        <span className="text-slate-400 text-[10px] block font-sans uppercase font-bold">Jumbo Roll</span>
                                        <span className="font-bold text-slate-800">{req.required_rolls_count} Roll{req.required_rolls_count > 1 ? 's' : ''} ({jumboLen.toLocaleString()} m)</span>
                                      </div>
                                      <div className="h-4 w-px bg-slate-200" />
                                      <div>
                                        <span className="text-slate-400 text-[10px] block font-sans uppercase font-bold">MSL Trim</span>
                                        <span className="font-bold text-purple-700">{req.expected_trim_mm} mm</span>
                                      </div>
                                      <div className="h-4 w-px bg-slate-200" />
                                      <div>
                                        <span className="text-slate-400 text-[10px] block font-sans uppercase font-bold">Diameter</span>
                                        <span className="font-bold text-slate-800">{req.calculated_diameter_mm} mm</span>
                                      </div>
                                    </div>

                                    <div className="flex items-center space-x-1.5">
                                      <button
                                        onClick={() => handleOpenMslSheet(req, originalIndex)}
                                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold text-xs flex items-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
                                        title={`View full MSL Slitter Production Sheet for Plan #${originalIndex + 1}`}
                                      >
                                        <FileSpreadsheet className="w-3.5 h-3.5" />
                                        <span>View MSL Sheet #{originalIndex + 1}</span>
                                      </button>

                                      <button
                                        onClick={() => handleDeleteSingleReq(req.id, originalIndex)}
                                        className="p-1.5 bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-700 rounded-lg border border-slate-200 hover:border-red-300 transition-colors cursor-pointer"
                                        title={`Cancel & Delete MSL Plan #${originalIndex + 1}`}
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>
                                </div>

                                {/* Yellow Trim Relaxation Acceptance for this MSL Plan if needed */}
                                {isReqYellow && (
                                  <div className="mt-2.5 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs space-y-1.5">
                                    <div className="flex items-center justify-between">
                                      <span className="text-amber-900 font-bold flex items-center space-x-1">
                                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                                        <span>Trim Relaxation Notice:</span>
                                      </span>
                                      <label className="flex items-center space-x-1.5 text-xs font-bold text-amber-950 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={isReqAcknowledged}
                                          onChange={() => handleToggleAcknowledgeYellow(req.id)}
                                          className="w-3.5 h-3.5 text-amber-600 rounded focus:ring-amber-500"
                                        />
                                        <span>Accept Non-Standard Trim</span>
                                      </label>
                                    </div>
                                    <p className="text-amber-800 text-[11px]">
                                      {req.relaxation_flag || req.ps01_feasibility?.explanation}
                                    </p>
                                  </div>
                                )}

                                {/* Covered Finished Sizes & Customer Orders Breakdown */}
                                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                  <div>
                                    <h5 className="font-bold text-slate-600 mb-1.5 uppercase text-[10px] tracking-wider">
                                      MSL Slit Knife Cuts:
                                    </h5>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {(req.finished_widths_covered || []).map((w, wIdx) => (
                                        <div key={wIdx} className="bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-md flex items-center space-x-1.5">
                                          <span className="text-slate-400 font-mono text-[10px]">Pos {wIdx + 1}:</span>
                                          <span className="font-mono font-bold text-slate-900">{w} mm</span>
                                        </div>
                                      ))}
                                      <div className="bg-purple-50 border border-purple-200 px-2.5 py-1 rounded-md flex items-center space-x-1 text-purple-800">
                                        <span className="text-[10px] font-semibold uppercase">Trim:</span>
                                        <span className="font-mono font-bold">{req.expected_trim_mm} mm</span>
                                      </div>
                                    </div>
                                  </div>

                                  <div>
                                    <h5 className="font-bold text-slate-600 mb-1.5 uppercase text-[10px] tracking-wider">
                                      Customer Orders Covered:
                                    </h5>
                                    <div className="space-y-1 max-h-20 overflow-y-auto pr-1">
                                      {(req.orders_covered || []).map((o, oIdx) => (
                                        <div key={oIdx} className="flex items-center justify-between text-slate-600 bg-slate-50 px-2 py-0.5 rounded text-[11px]">
                                          <span className="truncate max-w-[220px]">
                                            <b className="text-slate-900 font-mono">SO#{o.sales_order}</b> ({o.customer}) - {o.width_mm}mm
                                          </span>
                                          <span className="font-mono font-bold text-purple-700 shrink-0">
                                            {(o.weight_kg || 0).toLocaleString()} kg
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()
        )}
      </div>

      {/* Order-by-Order Forensic Reconciliation Table */}
      {filmOrders.length > 0 && filteredReqs.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
                <span>Order-by-Order Allocation & +10% Ceiling Forensic Reconciliation</span>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800 rounded">
                  Sequential Allocation Engine
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Every individual customer order is strictly capped at its individual balance × 1.10 (+10% maximum ceiling).
              </p>
            </div>
            <span className="text-xs font-mono text-slate-600 bg-slate-100 px-2.5 py-1 rounded">
              {filmOrders.length} Orders Tracked
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <th className="py-2.5 px-3 font-bold">Sales Order</th>
                  <th className="py-2.5 px-3 font-bold">Customer</th>
                  <th className="py-2.5 px-3 font-bold">Finished Width</th>
                  <th className="py-2.5 px-3 font-bold">LENGTH (m)</th>
                  <th className="py-2.5 px-3 font-bold text-right">Original Balance</th>
                  <th className="py-2.5 px-3 font-bold text-right">+10% Max Allowed</th>
                  <th className="py-2.5 px-3 font-bold text-right">Allocated KG</th>
                  <th className="py-2.5 px-3 font-bold text-right">Remaining KG</th>
                  <th className="py-2.5 px-3 font-bold text-right">Overage %</th>
                  <th className="py-2.5 px-3 font-bold text-center">Fulfillment</th>
                  <th className="py-2.5 px-3 font-bold text-center">Status</th>
                  <th className="py-2.5 px-3 font-bold">MSL PLAN(S)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {filmOrders.map(ord => {
                  // Calculate total allocated weight across all approved requirements for this specific order line
                  const totalAllocatedForOrder = filteredReqs.reduce((sum, req) => {
                    const matches = (req.orders_covered || []).filter(o => 
                      (o.order_id && o.order_id === ord.id) ||
                      (!o.order_id && o.sales_order === ord.sales_order && Number(o.item_number) === Number(ord.item_number) && Number(o.width_mm) === Number(ord.width_mm))
                    );
                    return sum + matches.reduce((s, m) => s + (m.weight_kg || 0), 0);
                  }, 0);

                  const maxAllowedKg = Number((ord.remaining_qty * MSL_CUSTOMER_MAX_OVERALLOCATION_FACTOR).toFixed(2));
                  const remainingKg = Math.max(0, Number((ord.remaining_qty - totalAllocatedForOrder).toFixed(2)));
                  const overagePct = ord.remaining_qty > 0 && totalAllocatedForOrder > ord.remaining_qty
                    ? Number((((totalAllocatedForOrder - ord.remaining_qty) / ord.remaining_qty) * 100).toFixed(2))
                    : 0;
                  const fulfillmentPct = ord.remaining_qty > 0 
                    ? Number(((totalAllocatedForOrder / ord.remaining_qty) * 100).toFixed(1))
                    : 100;
                  const isExceeded = totalAllocatedForOrder > maxAllowedKg + 0.01;
                  const isCompleted = remainingKg <= 0.01 || totalAllocatedForOrder >= ord.remaining_qty;

                  // 1. Identify all physical MSL plans that cover this exact Sales Order + Item
                  const matchedPhysicalPlans = (activePhysicalPlans || []).filter(p => {
                    const isFilmMatch = p.film === selectedFilm || compatibleFilmsForSelection.includes(p.film) || p.film.includes(selectedFilm);
                    if (!isFilmMatch) return false;

                    return (p.orders_covered || []).some(o => {
                      const isIdMatch = o.order_id && o.order_id === ord.id;
                      const isAttrMatch = (
                        String(o.sales_order).trim() === String(ord.sales_order).trim() &&
                        Number(o.item_number) === Number(ord.item_number) &&
                        Number(o.width_mm) === Number(ord.width_mm)
                      );
                      const weight = o.planned_weight_kg ?? o.weight_kg ?? 0;
                      return (isIdMatch || isAttrMatch) && weight > 0;
                    });
                  });

                  // Deduplicate physical plans by plan_number
                  const distinctPhysicalPlans = matchedPhysicalPlans.filter((p, idx, arr) => 
                    arr.findIndex(x => x.plan_number === p.plan_number) === idx
                  );

                  // 2. Identify requirement-level plans from filteredReqs that cover this exact Sales Order + Item
                  const matchedReqPlans: { planNumber: string; req: JumboRequirement; originalIndex: number }[] = [];
                  filteredReqs.forEach((req, originalIndex) => {
                    const isMatch = (req.orders_covered || []).some(o => {
                      const isIdMatch = o.order_id && o.order_id === ord.id;
                      const isAttrMatch = (
                        String(o.sales_order).trim() === String(ord.sales_order).trim() &&
                        Number(o.item_number) === Number(ord.item_number) &&
                        Number(o.width_mm) === Number(ord.width_mm)
                      );
                      const weight = o.weight_kg ?? 0;
                      return (isIdMatch || isAttrMatch) && weight > 0;
                    });
                    if (isMatch) {
                      matchedReqPlans.push({
                        planNumber: `MSL PLAN #${originalIndex + 1}`,
                        req,
                        originalIndex
                      });
                    }
                  });

                  const hasPhysical = distinctPhysicalPlans.length > 0;
                  const hasReq = matchedReqPlans.length > 0;

                  return (
                    <tr key={ord.id} className="hover:bg-slate-50/60">
                      <td className="py-2 px-3 font-bold text-slate-900">
                        {ord.sales_order} <span className="text-slate-400 font-normal">#{ord.item_number}</span>
                      </td>
                      <td className="py-2 px-3 font-sans text-slate-700 max-w-[180px] truncate" title={ord.customer}>
                        {ord.customer}
                      </td>
                      <td className="py-2 px-3 font-bold text-purple-700">
                        {ord.width_mm} mm
                      </td>
                      <td className="py-2 px-3 font-semibold text-slate-700">
                        {Number(ord.length_m) > 0 ? `${Number(ord.length_m).toLocaleString()} m` : '-'}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-800">
                        {ord.remaining_qty.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-slate-900">
                        {maxAllowedKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-emerald-700">
                        {totalAllocatedForOrder.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg
                      </td>
                      <td className="py-2 px-3 text-right text-slate-600">
                        {remainingKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg
                      </td>
                      <td className="py-2 px-3 text-right font-bold">
                        <span className={overagePct > 3 ? 'text-rose-600' : overagePct > 0 ? 'text-purple-700' : 'text-slate-400'}>
                          {overagePct > 0 ? `+${overagePct.toFixed(2)}%` : '0.00%'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          fulfillmentPct >= 100 ? 'bg-emerald-100 text-emerald-800' :
                          fulfillmentPct >= 50 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {fulfillmentPct}%
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        {isExceeded ? (
                          <span className="px-2 py-0.5 bg-rose-100 text-rose-800 text-[10px] font-bold rounded">
                            BREACH (&gt;+10%)
                          </span>
                        ) : isCompleted ? (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded">
                            COMPLETED
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded">
                            PARTIAL
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        {hasPhysical ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {distinctPhysicalPlans.map(plan => (
                              <button
                                key={plan.id || plan.plan_number}
                                onClick={() => setSelectedPhysicalMslPlan(plan)}
                                className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-purple-50 text-purple-700 hover:bg-purple-100 hover:text-purple-900 border border-purple-200 hover:border-purple-300 transition-colors cursor-pointer inline-flex items-center space-x-1 shadow-2xs"
                                title={`Open MSL Plan ${plan.plan_number}`}
                              >
                                <span>{plan.plan_number}</span>
                                {(plan.is_dynamic_continuous_run || plan.created_by?.includes('Dynamic')) && (
                                  <span className="text-[8px] bg-indigo-100 text-indigo-800 font-bold px-1 rounded uppercase">
                                    DYN
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        ) : hasReq ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {matchedReqPlans.map(item => (
                              <button
                                key={item.planNumber}
                                onClick={() => handleOpenMslSheet(item.req, item.originalIndex)}
                                className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-purple-50 text-purple-700 hover:bg-purple-100 hover:text-purple-900 border border-purple-200 hover:border-purple-300 transition-colors cursor-pointer shadow-2xs"
                                title={`Open ${item.planNumber}`}
                              >
                                {item.planNumber}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                            NOT PLANNED
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {ps01ManufacturingModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-5 border border-slate-300">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div>
                <span className="px-2.5 py-0.5 text-xs font-bold bg-indigo-100 text-indigo-800 rounded">
                  UPSTREAM PS01 SLITTER MANUFACTURING PLAN
                </span>
                <h2 className="text-lg font-black text-slate-900 mt-1">
                  Primary Slitter 1 (PS01) Master Deckle Plan for {ps01ManufacturingModal.film}
                </h2>
                <p className="text-xs text-slate-500">
                  Produced directly by the FROZEN PS01 Master Optimizer from the Mutually Feasible Jumbo Requirements
                </p>
              </div>
              <button
                onClick={() => setPs01ManufacturingModal({ isOpen: false, plans: [], film: '', logs: [] })}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
              >
                Close
              </button>
            </div>

            {ps01ManufacturingModal.plans.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                No PS01 manufacturing plans were generated.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs text-purple-900 flex items-center justify-between">
                  <span className="font-semibold">
                    Generated <b>{ps01ManufacturingModal.plans.length}</b> separate PS01 Manufacturing Plan(s). Each jumbo plan has its own isolated Factory Sheet.
                  </span>
                  <span className="font-mono text-purple-700 font-bold">
                    Total Planned: {ps01ManufacturingModal.plans.reduce((s, p) => s + (p.planned_quantity_kg || 0), 0).toLocaleString()} kg
                  </span>
                </div>

                {ps01ManufacturingModal.plans.map((p, pIdx) => (
                  <div key={p.id || pIdx} className="bg-slate-900 text-slate-100 rounded-xl p-5 border border-slate-800 space-y-4 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="px-2 py-0.5 bg-purple-600 text-white text-[11px] font-mono font-bold rounded">
                            JUMBO PLAN #{pIdx + 1}
                          </span>
                          <span className="font-mono text-purple-300 font-bold text-sm">{p.plan_number}</span>
                          <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold rounded">
                            PS01 FACTORY READY
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-white mt-1">
                          Mother Roll Deckle: {(p.deckle_mm || settings.ps01_deckle_width_mm || 10400).toLocaleString()} mm · Jumbo Width: <span className="text-purple-300 font-mono font-black">{p.items?.[0]?.width_mm ?? p.deckle_mm} mm</span> ({p.ups}-UPS Pattern)
                        </h3>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <span className="bg-slate-800 px-2.5 py-1 rounded font-mono">
                          Trim: <b>{p.trim_mm} mm</b> ({(p.trim_weight_kg ?? 0).toFixed(2)} kg)
                        </span>
                        <span className="bg-purple-950 text-purple-300 border border-purple-800 px-2.5 py-1 rounded font-mono">
                          Planned: <b>{(p.planned_quantity_kg ?? 0).toLocaleString()} kg</b>
                        </span>
                        <button
                          onClick={() => setSelectedPlanForFactorySheet(p)}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all shadow-md cursor-pointer"
                          title={`Open dedicated Factory Sheet ${pIdx + 1} with master deckle, knife coordinates, and duplex arm layouts`}
                        >
                          <Eye className="w-4 h-4" />
                          <span>View Factory Sheet #{pIdx + 1}</span>
                        </button>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                        Pattern Slitting & Size Allocation:
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                        {consolidatePlanItems(p.items || []).map((item) => (
                          <div key={item.key} className="bg-slate-800/80 p-3 rounded-lg border border-slate-700 text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <div className="font-mono text-white text-sm font-bold">
                                Slit Size: {item.width_mm} mm
                              </div>
                              <span className={`px-2 py-0.5 font-bold rounded font-mono text-xs ${
                                item.is_future_replacement 
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' 
                                  : 'bg-amber-400/20 text-amber-300'
                              }`}>
                                {item.is_future_replacement ? 'FUTURE SHIFT' : `${item.ups} UPS`}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              Length: {(item.length_m ?? 0).toLocaleString()} m · Core: {item.core ? `${item.core}"` : '6"'}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">
                              {item.customer} · Deckle: {item.is_future_replacement ? '-' : `${item.deckle_mm} mm`}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Complete Full Authoritative Factory / Slitter Sheet Modal */}
      {selectedPlanForFactorySheet && (
        <PlanDetailViewer
          plan={selectedPlanForFactorySheet}
          currentUser={defaultPlannerUser}
          onClose={() => setSelectedPlanForFactorySheet(null)}
          onUpdateStatus={(planId, newStatus) => {
            // Update plan status if requested
            if (ps01ManufacturingModal.plans.length > 0) {
              const updatedPlans = ps01ManufacturingModal.plans.map(p => 
                p.id === planId ? { ...p, status: newStatus } : p
              );
              setPs01ManufacturingModal(prev => ({ ...prev, plans: updatedPlans }));
            }
          }}
        />
      )}

      {/* Complete Full Authoritative Physical Metallizer Slitter Sheet Modal */}
      {selectedPhysicalMslPlan && (
        <MetallizerPlanDetailViewer
          plan={selectedPhysicalMslPlan}
          currentUser={defaultPlannerUser}
          onClose={() => setSelectedPhysicalMslPlan(null)}
        />
      )}

      {/* Delete Confirmation Modal (Reliable in iFrame) */}
      {deleteConfirmModal && deleteConfirmModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center space-x-3 text-red-600">
              <div className="p-2.5 bg-red-50 rounded-xl border border-red-200">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">{deleteConfirmModal.title}</h3>
                <p className="text-xs text-slate-500 font-mono">Irreversible Action</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {deleteConfirmModal.message}
            </p>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmModal(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteConfirmModal.onConfirm}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold shadow-sm cursor-pointer transition-colors flex items-center space-x-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deleteConfirmModal.actionLabel}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
