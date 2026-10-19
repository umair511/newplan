import React, { useState, useMemo, useEffect } from 'react';
import { 
  Box, 
  Truck, 
  FileSpreadsheet, 
  Download, 
  Plus, 
  Trash2, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Layers, 
  ArrowRight, 
  Sliders, 
  Sparkles, 
  UploadCloud, 
  Info, 
  Check, 
  Copy,
  ChevronDown,
  FileDown,
  Database,
  Grid,
  Zap,
  Building2,
  ListPlus,
  RotateCcw,
  PackageCheck,
  Ship,
  FileText,
  HelpCircle,
  Maximize2,
  FolderOpen,
  Search,
  Save,
  Tag,
  ShieldCheck,
  Lock,
  Unlock,
  Gauge,
  Package,
  Boxes
} from 'lucide-react';
import * as XLSX from 'xlsx';

import { 
  OrderInput, 
  FinalPlan, 
  ContainerPlan, 
  StuffingConfig,
  PackingMode,
  ContainerType,
  CalculatedItem,
  SavedStuffingPlan,
  PalletSlotInfo,
  VppSpaceFillFeasibilityReport
} from '../../types/stuffing';
import { 
  DEFAULT_STUFFING_CONFIG,
  CONFIG_20FT,
  DEFAULT_FACTORY_SEED_ORDERS,
  FACTORY_PROPACK_SAMPLE_ORDERS,
  DARU_TRADING_SAMPLE_ORDERS,
  GLOBAL_PACKAGING_SAMPLE_ORDERS,
  BAT_SUDAN_SAMPLE_ORDERS,
  PETPAK_SAMPLE_ORDERS,
  BLANK_SAMPLE_ORDER,
  generateStuffingPlan,
  calculateOrderMetrics,
  parseImportedOrders,
  expandOrdersForStuffingMaster,
  checkVppSpaceFillFeasibility
} from '../../services/stuffing/stuffingCalculator';
import { exportStuffingPlanToExcel } from '../../services/stuffing/stuffingExcelExport';
import { FILM_DENSITIES_DATABASE, lookupFilmSpecs } from '../../services/stuffing/filmDensities';
import { SavedPlansModal } from './SavedPlansModal';
import { OrderTableRow } from './OrderTableRow';
import { FilmSpecsManager } from './FilmSpecsManager';
import { PackagingAndMathRulesTab } from './PackagingAndMathRulesTab';
import { PalletCard } from './PalletCard';
import { PalletDetailsModal } from './PalletDetailsModal';
import { getSavedPlans } from '../../services/stuffing/savedPlansStorage';

export interface ContainerStuffingPlannerProps {
  initialSubTab?: 'orders' | 'rules' | 'config' | 'filmSpecs';
  initialActiveTab?: 'master' | 'summary' | 'visualizer';
  onOpenTests?: () => void;
}

const SEED_STORAGE_KEY = 'acsoe_custom_seed_state_v1';

function getInitialSeedState() {
  try {
    const raw = localStorage.getItem(SEED_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.orders) && parsed.orders.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Error loading custom seed state:', e);
  }
  return {
    orders: DEFAULT_FACTORY_SEED_ORDERS,
    clientName: 'PROPACK SAL',
    salesOrderNum: 'SO-4500806',
    poRefNum: 'PO 26-806',
  };
}

export const ContainerStuffingPlanner: React.FC<ContainerStuffingPlannerProps> = ({
  initialSubTab,
  initialActiveTab,
  onOpenTests,
}) => {
  const initialData = useMemo(() => getInitialSeedState(), []);

  // Main state
  const [orders, setOrders] = useState<OrderInput[]>(initialData.orders);
  const [tableKey, setTableKey] = useState<number>(0);
  const [clientName, setClientName] = useState<string>(initialData.clientName);
  const [salesOrderNum, setSalesOrderNum] = useState<string>(initialData.salesOrderNum);
  const [poRefNum, setPoRefNum] = useState<string>(initialData.poRefNum);
  const [activeTab, setActiveTab] = useState<'master' | 'summary' | 'visualizer'>(initialActiveTab || 'master');
  const [orderSectionTab, setOrderSectionTab] = useState<'orders' | 'rules' | 'config' | 'filmSpecs'>(initialSubTab || 'orders');

  useEffect(() => {
    if (initialSubTab) {
      setOrderSectionTab(initialSubTab);
    }
  }, [initialSubTab]);

  useEffect(() => {
    if (initialActiveTab) {
      setActiveTab(initialActiveTab);
    }
  }, [initialActiveTab]);
  const [prefillFilmCodeForManager, setPrefillFilmCodeForManager] = useState<string | undefined>(undefined);
  const [selectedContainerId, setSelectedContainerId] = useState<number>(0); // 0 = all containers
  const [config, setConfig] = useState<StuffingConfig>(() => ({
    ...DEFAULT_STUFFING_CONFIG,
    ...(initialData.container_max_weight ? { container_max_weight: initialData.container_max_weight } : {}),
  }));

  // Helper to create a clean blank item with empty film/size/length/qty for typing
  const createBlankOrder = (itemNum = 10, customer = '', defaultMode: PackingMode = 'AUTO'): OrderInput => ({
    item: itemNum,
    film: '',
    size: 0,
    length: 0,
    core: 6,
    dia: 0,
    qty: 0,
    customer: customer,
    packing_mode: defaultMode,
    container_type: config.container_type,
  });
  
  // Modals & UI helpers
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [isSavedPlansModalOpen, setIsSavedPlansModalOpen] = useState<boolean>(false);
  const [savedPlansCount, setSavedPlansCount] = useState<number>(() => getSavedPlans().length);
  const [importMode, setImportMode] = useState<'paste' | 'file'>('paste');
  const [pastedText, setPastedText] = useState<string>('');
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [selectedPallet, setSelectedPallet] = useState<PalletSlotInfo | null>(null);
  const [stuffingViewMode, setStuffingViewMode] = useState<'pallets' | 'grid'>('pallets');

  // VPP Residual Space-Fill Feasibility Check State
  const [spaceFillCheckReport, setSpaceFillCheckReport] = useState<VppSpaceFillFeasibilityReport | null>(null);
  const [isCheckingSpaceFill, setIsCheckingSpaceFill] = useState<boolean>(false);

  // Checks VPP Space-Fill feasibility without modifying stuffing plan
  const handleCheckSpaceFillPossibility = () => {
    setIsCheckingSpaceFill(true);
    setTimeout(() => {
      if (config.allow_vpp_space_fill_pallet && plan.vpp_space_fill_opportunity) {
        setSpaceFillCheckReport({
          status: 'FEASIBLE',
          opportunity: plan.vpp_space_fill_opportunity,
        });
      } else {
        let baseContainers = plan.containers;
        if (config.allow_vpp_space_fill_pallet) {
          const basePlan = generateStuffingPlan(orders, { ...config, allow_vpp_space_fill_pallet: false }, clientName);
          baseContainers = basePlan.containers;
        }
        const report = checkVppSpaceFillFeasibility(baseContainers, config);
        setSpaceFillCheckReport(report);
      }
      setIsCheckingSpaceFill(false);
    }, 150);
  };

  // Save current order and metadata as default seed
  const handleSaveCurrentAsSeed = () => {
    const seedState = {
      orders,
      clientName,
      salesOrderNum,
      poRefNum,
      container_type: config.container_type,
      container_max_weight: config.container_max_weight,
      default_packing_mode: config.default_packing_mode,
      saved_at: new Date().toISOString(),
    };
    localStorage.setItem(SEED_STORAGE_KEY, JSON.stringify(seedState));
    setUploadStatus(`Saved current order (${orders.length} items for "${clientName}") as the permanent Default Seed! It will automatically load on startup.`);
    setTimeout(() => setUploadStatus(null), 6000);
  };

  // Quick Global Mode & Container Switches
  const handleContainerTypeChange = (cType: ContainerType) => {
    if (cType === '20ft') {
      setConfig({
        ...CONFIG_20FT,
        default_packing_mode: config.default_packing_mode === 'HPP' ? 'HPP' : 'VPP',
      });
      setUploadStatus('Switched to 20ft Container Profile (2-row loading, max payload ~21,500 kg).');
    } else {
      setConfig({
        ...DEFAULT_STUFFING_CONFIG,
        default_packing_mode: config.default_packing_mode,
      });
      setUploadStatus('Switched to 40ft High Cube (HC) Profile (3-row loading, target payload ~25,000 - 26,000 kg).');
    }
    setTimeout(() => setUploadStatus(null), 4000);
  };

  const handleGlobalPackingModeChange = (mode: PackingMode) => {
    setConfig(prev => ({ ...prev, default_packing_mode: mode }));
    setUploadStatus(`Global default packing mode set to ${mode}.`);
    setTimeout(() => setUploadStatus(null), 3000);
  };

  // Generate Calculated Plan with zero latency
  const plan: FinalPlan = useMemo(() => {
    return generateStuffingPlan(orders, config, clientName);
  }, [orders, config, clientName]);

  // Selected container in Master view
  const activeContainer = useMemo(() => {
    return plan.containers.find(c => c.id === selectedContainerId) || plan.containers[0] || null;
  }, [plan, selectedContainerId]);

  // Trigger explicit stuffing generation with visual feedback
  const handleGenerateStuffing = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      setActiveTab('master');
      setSelectedContainerId(0); // Show all containers
      setUploadStatus(
        `Calculated Stuffing Plan: ${plan.containers.length} x ${config.container_type === '20ft' ? '20ft' : '40ft HC'} Containers, ${plan.totals.total_pallets} Pallets, ${plan.totals.total_planned_weight.toLocaleString()} kg for "${clientName}" (SO# ${salesOrderNum})`
      );
      setTimeout(() => setUploadStatus(null), 6000);
    }, 200);
  };

  // Load a plan from the Universal Plans Archive
  const handleSelectSavedPlan = (savedPlan: SavedStuffingPlan) => {
    const targetContainerType = savedPlan.container_type || '20ft';
    const targetPackingMode = savedPlan.packing_mode || 'VPP';

    const updatedOrders = savedPlan.orders.map(o => ({
      ...o,
      container_type: o.container_type || targetContainerType,
      packing_mode: o.packing_mode || targetPackingMode,
    }));
    setOrders(updatedOrders);
    setClientName(savedPlan.customer);
    setSalesOrderNum(savedPlan.sales_order);
    setPoRefNum(savedPlan.po_ref || '');

    const baseConfig = targetContainerType === '20ft' ? CONFIG_20FT : DEFAULT_STUFFING_CONFIG;
    setConfig({
      ...baseConfig,
      container_type: targetContainerType,
      default_packing_mode: targetPackingMode,
    });

    setSelectedContainerId(0);
    setTableKey(prev => prev + 1);
    setUploadStatus(`Loaded plan "${savedPlan.plan_name}" for ${savedPlan.customer} (SO# ${savedPlan.sales_order}) with ${savedPlan.orders.length} items.`);
    setTimeout(() => setUploadStatus(null), 5000);
  };

  // Initialize fresh blank template order
  const handleNewBlankPlan = () => {
    setOrders(BLANK_SAMPLE_ORDER);
    setClientName('NEW CUSTOMER');
    setSalesOrderNum('SO-450' + Math.floor(100 + Math.random() * 900));
    setPoRefNum('');
    setSelectedContainerId(0);
    setTableKey(prev => prev + 1);
    setUploadStatus('Loaded blank template with sample order items.');
    setTimeout(() => setUploadStatus(null), 4000);
  };

  // Clear entire form (all fields and reset table to 1 clean blank item)
  const handleClearEntireForm = () => {
    setOrders([createBlankOrder(10, '', config.default_packing_mode)]);
    setClientName('');
    setSalesOrderNum('');
    setPoRefNum('');
    setSelectedContainerId(0);
    setTableKey(prev => prev + 1);
    setUploadStatus('Form cleared: All customer details and item rows have been reset.');
    setTimeout(() => setUploadStatus(null), 4000);
  };

  // Handle adding a new order row
  const handleAddRow = () => {
    const newItemNum = (orders.length + 1) * 10;
    const newOrder = createBlankOrder(newItemNum, clientName, config.default_packing_mode);
    setOrders([...orders, newOrder]);
  };

  // Duplicate last row
  const handleDuplicateLastRow = () => {
    if (orders.length === 0) {
      handleAddRow();
      return;
    }
    const last = orders[orders.length - 1];
    const newItemNum = (orders.length + 1) * 10;
    const duplicated: OrderInput = {
      ...last,
      item: newItemNum,
    };
    setOrders([...orders, duplicated]);
  };

  // Clear all item rows in table (resets to 1 clean blank row)
  const handleClearAllRows = () => {
    setOrders([createBlankOrder(10, clientName, config.default_packing_mode)]);
    setTableKey(prev => prev + 1);
    setUploadStatus('Order table cleared. Ready for new items.');
    setTimeout(() => setUploadStatus(null), 4000);
  };

  // Handle row updates
  const handleUpdateRow = (index: number, field: keyof OrderInput, value: any) => {
    const updated = [...orders];
    updated[index] = {
      ...updated[index],
      [field]: value,
    };
    setOrders(updated);
  };

  // Handle row deletion
  const handleDeleteRow = (index: number) => {
    if (orders.length <= 1) {
      setUploadStatus('Cannot delete the last line: at least one order line is required.');
      setTimeout(() => setUploadStatus(null), 4000);
      return;
    }
    const updated = orders.filter((_, i) => i !== index);
    setOrders(updated);
  };

  // State & handlers for HPP Manual Reel-Per-Pallet Header Controls
  const [allow8For550Over1100, setAllow8For550Over1100] = useState(false);

  const is765Allow3Active = !!config.allow_3_reels_above_1100_size || orders.some((ord, idx) => {
    const m = plan.summary[idx];
    return m && m.cradle_ply === 765 && ord.size >= 1100 && ord.custom_reels_per_pallet === 3;
  });

  const is550Allow8Active = allow8For550Over1100 || orders.some((ord, idx) => {
    const m = plan.summary[idx];
    return m && m.cradle_ply === 550 && ord.size >= 1100 && ord.custom_reels_per_pallet === 8;
  });

  const handleToggle765Override = (allow3: boolean) => {
    setConfig(prev => ({ ...prev, allow_3_reels_above_1100_size: allow3 }));
    setOrders(prev => prev.map((ord, idx) => {
      const m = plan.summary[idx];
      if (m && m.cradle_ply === 765 && ord.size >= 1100) {
        return {
          ...ord,
          custom_reels_per_pallet: allow3 ? 3 : undefined,
        };
      }
      return ord;
    }));
  };

  const handleToggle550Override = (allow8: boolean) => {
    setAllow8For550Over1100(allow8);
    setOrders(prev => prev.map((ord, idx) => {
      const m = plan.summary[idx];
      if (m && m.cradle_ply === 550 && ord.size >= 1100) {
        return {
          ...ord,
          custom_reels_per_pallet: allow8 ? 8 : undefined,
        };
      }
      return ord;
    }));
  };

  // Handle Excel File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        // Locate best matching order sheet
        let targetSheetName = workbook.SheetNames.find(s => 
          s.toUpperCase().includes('ORDER') || 
          s.toUpperCase().includes('STUFFING') || 
          s.toUpperCase().includes('BACKLOG') || 
          s.toUpperCase().includes('1ST') ||
          s.toUpperCase().includes('VA05')
        ) || workbook.SheetNames[0];

        const worksheet = workbook.Sheets[targetSheetName];
        const json: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (!json || json.length === 0) {
          setUploadStatus('Error: Could not find order data in the selected Excel file.');
          setTimeout(() => setUploadStatus(null), 5000);
          return;
        }

        const parsed = parseImportedOrders(json);

        if (parsed.length > 0) {
          setOrders(parsed);
          setTableKey(prev => prev + 1);
          setUploadStatus(`Successfully imported ${parsed.length} items from "${file.name}"!`);
          setIsImportModalOpen(false);
          setTimeout(() => setUploadStatus(null), 5000);
        } else {
          setUploadStatus('Error: No valid items found in file. Please verify columns: Film, Size, Length, Core, Qty.');
          setTimeout(() => setUploadStatus(null), 5000);
        }
      } catch (err) {
        console.error(err);
        setUploadStatus('Error parsing Excel file. Please check file format.');
        setTimeout(() => setUploadStatus(null), 5000);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  // Handle Pasted Text Import
  const handlePastedTextImport = () => {
    if (!pastedText.trim()) {
      setUploadStatus('Please paste table data or JSON text first.');
      setTimeout(() => setUploadStatus(null), 4000);
      return;
    }

    const parsed = parseImportedOrders(pastedText);

    if (parsed.length > 0) {
      setOrders(parsed);
      setTableKey(prev => prev + 1);
      setPastedText('');
      setIsImportModalOpen(false);
      setUploadStatus(`Successfully parsed ${parsed.length} order items from pasted text!`);
      setTimeout(() => setUploadStatus(null), 5000);
    } else {
      setUploadStatus('Could not parse any order lines from pasted text. Please check format.');
      setTimeout(() => setUploadStatus(null), 5000);
    }
  };

  // Export Excel File
  const handleDownloadExcel = () => {
    exportStuffingPlanToExcel(plan, `Container_Stuffing_Plan_${clientName.replace(/\s+/g, '_')}_${config.container_type}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Customer Selection Control Center */}
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-3 bg-blue-900 dark:bg-blue-800 text-white rounded-xl shadow-xs">
              <Truck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                  Container Stuffing & Planning Module
                </h1>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-violet-50 dark:bg-violet-950/60 text-violet-800 dark:text-violet-300 font-semibold border border-violet-200 dark:border-violet-800">
                  HPP & VPP Dual Engine
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Enter or import your customer order quantities, select film specs & packing mode (HPP or VPP), and calculate multi-container stuffing layouts.
              </p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800 rounded-lg transition-colors shadow-2xs"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              Import Orders / Quantities
            </button>

            <button
              onClick={handleDownloadExcel}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 rounded-lg shadow-xs transition-colors"
            >
              <Download className="w-4 h-4" />
              Download Excel (.xlsx)
            </button>
          </div>
        </div>

        {/* Universal Plan Manager & Search Bar */}
        <div className="bg-slate-900 text-white p-4 rounded-xl shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <FolderOpen className="w-5 h-5 text-blue-400 shrink-0" />
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Universal Stuffing Plans System
                </span>
                <p className="text-[11px] text-slate-400">
                  Active Working Plan: <strong className="text-white font-mono">{clientName}</strong> (SO: <span className="text-blue-300 font-mono">{salesOrderNum}</span>)
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsSavedPlansModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-300 rounded-lg shadow-xs transition-colors"
                title="Search and load saved plans by Customer Name or Sales Order #"
              >
                <Search className="w-3.5 h-3.5 text-slate-900" />
                <span>Search / Load Plans</span>
                <span className="px-1.5 py-0.2 bg-slate-900 text-amber-300 rounded text-[10px] font-mono">
                  {savedPlansCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setIsSavedPlansModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-xs transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Current Plan</span>
              </button>

              <button
                type="button"
                onClick={handleSaveCurrentAsSeed}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-300 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/60 rounded-lg shadow-xs transition-colors"
                title="Save current order and customer data as the permanent default seed"
              >
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span>Save as Default Seed</span>
              </button>

              <button
                type="button"
                onClick={handleClearEntireForm}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-300 bg-rose-950/80 hover:bg-rose-900 border border-rose-700/60 rounded-lg shadow-xs transition-colors cursor-pointer"
                title="Clear entire form: resets customer name, sales order #, and item rows to blank"
              >
                <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
                <span>Clear Form</span>
              </button>

              <button
                type="button"
                onClick={handleNewBlankPlan}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors cursor-pointer"
                title="Load sample blank plan template"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Sample Template</span>
              </button>
            </div>
          </div>

          {/* Quick Active Order Metadata Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2 border-t border-slate-800 text-xs">
            <div>
              <label className="block text-[11px] font-bold text-slate-400 mb-1">
                Customer / Client Name:
              </label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. DARU TRADING, BAT Sudan, etc."
                className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 text-white font-semibold rounded-lg focus:ring-2 focus:ring-blue-500 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-400 mb-1">
                Sales Order # (SAP SO):
              </label>
              <input
                type="text"
                value={salesOrderNum}
                onChange={(e) => setSalesOrderNum(e.target.value)}
                placeholder="e.g. SO-4500891"
                className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 text-blue-300 font-bold rounded-lg focus:ring-2 focus:ring-blue-500 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-400 mb-1">
                Container Profile:
              </label>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => handleContainerTypeChange('20ft')}
                  className={`px-2 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                    config.container_type === '20ft'
                      ? 'bg-cyan-600 text-white border-cyan-500 shadow-2xs'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                  }`}
                >
                  20ft Dry
                </button>
                <button
                  type="button"
                  onClick={() => handleContainerTypeChange('40ft_HC')}
                  className={`px-2 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                    config.container_type === '40ft_HC'
                      ? 'bg-blue-600 text-white border-blue-500 shadow-2xs'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                  }`}
                >
                  40ft HC
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-bold text-slate-400">
                  Target Container Weight (kg):
                </label>
              </div>
              <div className="space-y-1">
                <input
                  type="number"
                  step="500"
                  min="5000"
                  max="35000"
                  value={config.container_max_weight || ''}
                  placeholder="26000"
                  onChange={(e) => {
                    const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
                    setConfig(prev => ({ ...prev, container_max_weight: isNaN(val) ? 0 : val }));
                  }}
                  onBlur={() => {
                    if (!config.container_max_weight || config.container_max_weight <= 0) {
                      setConfig(prev => ({
                        ...prev,
                        container_max_weight: config.container_type === '20ft' ? 21500 : 26000,
                      }));
                    }
                  }}
                  className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 text-emerald-300 font-bold rounded-lg focus:ring-2 focus:ring-blue-500 text-xs font-mono"
                />
                <div className="flex items-center gap-1">
                  {[21000, 22000, 24000, 26000].map(wt => (
                    <button
                      key={wt}
                      type="button"
                      onClick={() => setConfig(prev => ({ ...prev, container_max_weight: wt }))}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-all border ${
                        config.container_max_weight === wt
                          ? 'bg-emerald-600 text-white border-emerald-400 shadow-2xs'
                          : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-white hover:bg-slate-700'
                      }`}
                      title={`Set target container weight to ${wt.toLocaleString()} kg`}
                    >
                      {wt / 1000}k
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-400 mb-1">
                Default Packing Mode:
              </label>
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => handleGlobalPackingModeChange('AUTO')}
                  className={`px-1.5 py-1.5 text-[11px] font-bold rounded-lg border transition-all ${
                    config.default_packing_mode === 'AUTO'
                      ? 'bg-violet-600 text-white border-violet-500'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                  }`}
                >
                  Auto
                </button>
                <button
                  type="button"
                  onClick={() => handleGlobalPackingModeChange('HPP')}
                  className={`px-1.5 py-1.5 text-[11px] font-bold rounded-lg border transition-all ${
                    config.default_packing_mode === 'HPP'
                      ? 'bg-blue-600 text-white border-blue-500'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                  }`}
                >
                  HPP
                </button>
                <button
                  type="button"
                  onClick={() => handleGlobalPackingModeChange('VPP')}
                  className={`px-1.5 py-1.5 text-[11px] font-bold rounded-lg border transition-all ${
                    config.default_packing_mode === 'VPP'
                      ? 'bg-emerald-600 text-white border-emerald-500'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                  }`}
                >
                  VPP
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Status notification toast */}
        {uploadStatus && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-semibold">{uploadStatus}</span>
          </div>
        )}
      </div>


      {/* Interactive Order Quantities Input Table */}
      <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-xl shadow-xs border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center space-x-2">
              <ListPlus className="w-5 h-5 text-blue-900 dark:text-blue-400" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Customer Order Lines & Quantities ({orders.length} Items)
              </h2>
            </div>

            {/* HPP Manual Reel-Per-Pallet Header Controls for Applicable Rows */}
            <div className="flex flex-wrap items-center gap-2">
              {/* 765 Ply — Size >1100 mm */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                  765 Ply — Size &gt;1100 mm:
                </span>
                <div className="inline-flex rounded-md shadow-2xs" role="group">
                  <button
                    type="button"
                    onClick={() => handleToggle765Override(false)}
                    className={`px-2.5 py-1 text-xs font-bold rounded-l-md border transition-all flex items-center gap-1 cursor-pointer ${
                      !is765Allow3Active
                        ? 'bg-blue-600 text-white border-blue-500 shadow-2xs'
                        : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600'
                    }`}
                    title="Strict Default: Lock size > 1100 mm on 765 ply to max 2 reels per pallet for safety"
                  >
                    <Lock className="w-3 h-3" />
                    Default: 2 Reels
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggle765Override(true)}
                    className={`px-2.5 py-1 text-xs font-bold rounded-r-md border-t border-b border-r transition-all flex items-center gap-1 cursor-pointer ${
                      is765Allow3Active
                        ? 'bg-amber-600 text-white border-amber-500 shadow-2xs'
                        : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600'
                    }`}
                    title="User Permission Granted: Allow 3 reels per pallet for size > 1100 mm on 765 ply"
                  >
                    <Zap className="w-3 h-3 text-amber-300" />
                    Allow 3 Reels / Manual Override
                  </button>
                </div>
              </div>

              {/* 550 Ply — Size >1100 mm */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  550 Ply — Size &gt;1100 mm:
                </span>
                <div className="inline-flex rounded-md shadow-2xs" role="group">
                  <button
                    type="button"
                    onClick={() => handleToggle550Override(false)}
                    className={`px-2.5 py-1 text-xs font-bold rounded-l-md border transition-all flex items-center gap-1 cursor-pointer ${
                      !is550Allow8Active
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-2xs'
                        : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600'
                    }`}
                    title="Strict Default: Standard 6 reels per pallet for size > 1100 mm on 550 ply"
                  >
                    <Lock className="w-3 h-3" />
                    Default: 6 Reels
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggle550Override(true)}
                    className={`px-2.5 py-1 text-xs font-bold rounded-r-md border-t border-b border-r transition-all flex items-center gap-1 cursor-pointer ${
                      is550Allow8Active
                        ? 'bg-emerald-700 text-white border-emerald-600 shadow-2xs'
                        : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600'
                    }`}
                    title="Manual Override: Allow 8 reels per pallet for size > 1100 mm on 550 ply"
                  >
                    <Zap className="w-3 h-3 text-emerald-300" />
                    Allow 8 Reels / Manual Override
                  </button>
                </div>
              </div>
            </div>

            {/* Three Header Tabs next to existing header controls */}
            <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200 dark:border-slate-700 shadow-2xs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={orderSectionTab === 'orders'}
                onClick={() => setOrderSectionTab('orders')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                  orderSectionTab === 'orders'
                    ? 'bg-white dark:bg-slate-700 text-blue-900 dark:text-blue-300 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="View Customer Order Lines Table"
              >
                <ListPlus className="w-3.5 h-3.5" />
                <span>Order Lines ({orders.length})</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={orderSectionTab === 'rules'}
                onClick={() => setOrderSectionTab(orderSectionTab === 'rules' ? 'orders' : 'rules')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                  orderSectionTab === 'rules'
                    ? 'bg-blue-900 dark:bg-blue-700 text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="View Packaging & Math Rules Reference"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Packaging & Math Rules</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={orderSectionTab === 'config'}
                onClick={() => setOrderSectionTab(orderSectionTab === 'config' ? 'orders' : 'config')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                  orderSectionTab === 'config'
                    ? 'bg-blue-900 dark:bg-blue-700 text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="View Container Specs & Engine Limits"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Container Specs & Limits</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={orderSectionTab === 'filmSpecs'}
                onClick={() => {
                  setPrefillFilmCodeForManager(undefined);
                  setOrderSectionTab(orderSectionTab === 'filmSpecs' ? 'orders' : 'filmSpecs');
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                  orderSectionTab === 'filmSpecs'
                    ? 'bg-blue-900 dark:bg-blue-700 text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="View and Manage Film Specs Master Database"
              >
                <Database className="w-3.5 h-3.5" />
                <span>Film Specs Master Database</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {orderSectionTab !== 'orders' ? (
              <button
                type="button"
                onClick={() => setOrderSectionTab('orders')}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-blue-900 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 rounded-lg transition-colors cursor-pointer"
              >
                <ArrowRight className="w-3.5 h-3.5 rotate-180" />
                Return to Orders Table
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleAddRow}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-blue-900 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 rounded-lg transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Item
                </button>
                <button
                  type="button"
                  onClick={handleDuplicateLastRow}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Duplicate Last
                </button>
                <button
                  type="button"
                  onClick={handleClearAllRows}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-800 rounded-lg transition-colors cursor-pointer"
                  title="Clear all item rows in table and reset to 1 blank item"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear Table
                </button>
                <button
                  type="button"
                  onClick={handleClearEntireForm}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-rose-800 dark:text-rose-200 bg-rose-100 dark:bg-rose-900/50 hover:bg-rose-200 dark:hover:bg-rose-900/70 border border-rose-300 dark:border-rose-700 rounded-lg transition-colors cursor-pointer"
                  title="Clear entire form: reset customer name, sales order #, and item rows"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Clear Form
                </button>
              </>
            )}
          </div>
        </div>

        {/* TAB 1: Customer Order Lines & Quantities Table */}
        {orderSectionTab === 'orders' && (
          <>
            {/* Unknown / Missing Film Specs Alert Banner */}
            {plan.summary.some(s => s.is_film_code_missing && s.film) && (
              <div className="p-3.5 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fadeIn">
                <div className="flex items-center space-x-2.5 text-rose-900 dark:text-rose-200">
                  <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
                  <div>
                    <p className="text-xs font-bold">
                      Film Code Not Found in Master Database
                    </p>
                    <p className="text-[11px] text-rose-700 dark:text-rose-300">
                      One or more items contain film codes that are not in the master specs database. Dimensions, density, and reel weight cannot be calculated until added.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    const missing = plan.summary.find(s => s.is_film_code_missing && s.film);
                    if (missing) {
                      setPrefillFilmCodeForManager(missing.film);
                    }
                    setOrderSectionTab('filmSpecs');
                  }}
                  className="px-3.5 py-1.5 bg-rose-700 hover:bg-rose-800 text-white rounded-lg text-xs font-bold transition flex items-center space-x-1.5 shrink-0 shadow-xs cursor-pointer"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>Manage Film Specs Master</span>
                </button>
              </div>
            )}

            {/* Editable Orders Table */}
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold border-b border-slate-200 dark:border-slate-700 text-[11px]">
                    <th className="py-2.5 px-3 w-12 text-center">ITEM</th>
                    <th className="py-2.5 px-3 min-w-[130px]">FILM GRADE</th>
                    <th className="py-2.5 px-3 min-w-[100px]">SIZE (mm)</th>
                    <th className="py-2.5 px-3 min-w-[100px]">LENGTH (m)</th>
                    <th className="py-2.5 px-3 min-w-[80px]">CORE</th>
                    <th className="py-2.5 px-3 min-w-[90px]">DIA (mm)</th>
                    <th className="py-2.5 px-3 min-w-[130px] bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-200">ORDER QTY (kg)</th>
                    <th className="py-2.5 px-3 min-w-[110px]">PACKING MODE</th>
                    <th className="py-2.5 px-3 min-w-[100px]">REEL WT (kg)</th>
                    <th className="py-2.5 px-3 min-w-[180px]">PLANNED REELS</th>
                    <th className="py-2.5 px-3 min-w-[120px]">PALLET DIMS</th>
                    <th className="py-2.5 px-3 min-w-[90px]">TOTAL PALLET</th>
                    <th className="py-2.5 px-3 min-w-[100px]">EXCESS/LESS</th>
                    <th className="py-2.5 px-3 w-10 text-center">ACTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {orders.map((order, index) => (
                    <OrderTableRow
                      key={`row-${tableKey}-${index}`}
                      order={order}
                      index={index}
                      config={config}
                      planMetric={plan.summary[index]}
                      onUpdate={handleUpdateRow}
                      onDelete={handleDeleteRow}
                      onOpenFilmSpecs={(filmCode) => {
                        setPrefillFilmCodeForManager(filmCode);
                        setOrderSectionTab('filmSpecs');
                      }}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 dark:bg-slate-800 font-bold text-slate-900 dark:text-slate-100 border-t-2 border-slate-300 dark:border-slate-700 text-xs">
                    <td colSpan={6} className="py-3 px-3 text-right">
                      TOTAL ORDER QUANTITY:
                    </td>
                    <td className="py-3 px-3 font-mono text-blue-900 dark:text-blue-300 text-sm">
                      {orders.reduce((sum, o) => sum + (Number(o.qty) || 0), 0).toLocaleString()} kg
                    </td>
                    <td colSpan={2} className="py-3 px-3 text-right text-slate-700 dark:text-slate-300">
                      TOTAL PLANNED:
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-900 dark:text-slate-100 text-sm">
                      {plan.totals.total_planned_weight.toLocaleString()} kg
                    </td>
                    <td className="py-3 px-3 font-mono text-indigo-900 dark:text-indigo-300 text-sm">
                      {plan.totals.total_pallets} Pallets
                    </td>
                    <td colSpan={2} className="py-3 px-3 text-right">
                      <span className={`font-mono text-xs px-2 py-0.5 rounded ${
                        plan.totals.excess_less_total >= 0 
                          ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800' 
                          : 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                      }`}>
                        {plan.totals.excess_less_total >= 0 ? `+${plan.totals.excess_less_total.toLocaleString()}` : plan.totals.excess_less_total.toLocaleString()} kg
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Generate Stuffing Plan CTA Button */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
              <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                <Info className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0" />
                <span>
                  Engine automatically assigns orders into container bays adhering strictly to max weight (<strong>{config.container_max_weight.toLocaleString()} kg</strong>) and pallet limits (<strong>{config.container_type === '20ft' ? '10' : '28'} pallets</strong>).
                </span>
              </div>

              <button
                onClick={handleGenerateStuffing}
                disabled={isGenerating}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold text-white bg-blue-900 hover:bg-blue-950 dark:bg-blue-800 dark:hover:bg-blue-700 rounded-xl shadow-md transition-all hover:scale-[1.01] active:scale-[0.99]"
              >
                {isGenerating ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <Zap className="w-4 h-4 text-amber-300" />
                )}
                <span>Generate Container Stuffing Plan</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </>
        )}

        {/* TAB 2: Packaging & Math Rules (Read-Only) */}
        {orderSectionTab === 'rules' && (
          <div className="pt-2 animate-fadeIn">
            <PackagingAndMathRulesTab />
          </div>
        )}

        {/* TAB 3: Container Specs & Limits */}
        {orderSectionTab === 'config' && (
          <div className="space-y-4 pt-2 animate-fadeIn">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Sliders className="w-5 h-5 text-blue-900 dark:text-blue-400" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Container Physical Dimensions & Engine Configuration</h3>
              </div>
              <button
                onClick={() => {
                  if (config.container_type === '20ft') setConfig(CONFIG_20FT);
                  else setConfig(DEFAULT_STUFFING_CONFIG);
                }}
                className="text-xs text-blue-800 dark:text-blue-400 hover:text-blue-950 dark:hover:text-blue-300 font-bold flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset to Defaults
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-800 dark:text-slate-200">Target Container Weight (kg)</label>
                <input
                  type="number"
                  step="500"
                  min="5000"
                  max="35000"
                  value={config.container_max_weight || ''}
                  placeholder="26000"
                  onChange={(e) => {
                    const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
                    setConfig(prev => ({ ...prev, container_max_weight: isNaN(val) ? 0 : val }));
                  }}
                  onBlur={() => {
                    if (!config.container_max_weight || config.container_max_weight <= 0) {
                      setConfig(prev => ({
                        ...prev,
                        container_max_weight: config.container_type === '20ft' ? 21500 : 26000,
                      }));
                    }
                  }}
                  className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold text-slate-900 dark:text-slate-100"
                />
                <div className="flex items-center justify-between text-[10px] text-slate-600 dark:text-slate-400">
                  <span>Default: 26,000 kg</span>
                  <div className="flex items-center gap-1">
                    {[21000, 22000, 24000, 26000].map(wt => (
                      <button
                        key={wt}
                        type="button"
                        onClick={() => setConfig(prev => ({ ...prev, container_max_weight: wt }))}
                        className={`px-1.5 py-0.2 rounded font-mono font-semibold transition-all border ${
                          config.container_max_weight === wt
                            ? 'bg-blue-900 dark:bg-blue-700 text-white border-blue-900 dark:border-blue-700'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        {wt / 1000}k
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-800 dark:text-slate-200">Pallet Cap Override (Optional)</label>
                <input
                  type="number"
                  value={config.max_pallets_per_container >= 999 ? '' : config.max_pallets_per_container}
                  placeholder="No Limit (Auto Weight/Space)"
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setConfig({ ...config, max_pallets_per_container: isNaN(val) || val <= 0 ? 999 : val });
                  }}
                  className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold text-slate-900 dark:text-slate-100"
                />
                <span className="text-[10px] text-slate-600 dark:text-slate-400">Leave empty for unlimited pallets</span>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-800 dark:text-slate-200">Buffer Percentage (1.10 = 10%)</label>
                <input
                  type="number"
                  step="0.01"
                  value={config.buffer_percentage}
                  onChange={(e) => setConfig({ ...config, buffer_percentage: parseFloat(e.target.value) || 1.10 })}
                  className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-800 dark:text-slate-200">Pallet Clearance (mm in HPP)</label>
                <input
                  type="number"
                  value={config.pallet_clearance}
                  onChange={(e) => setConfig({ ...config, pallet_clearance: parseFloat(e.target.value) || 120 })}
                  className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-800 dark:text-slate-200">Max Slit Size for 3-Reel Stack (mm)</label>
                <input
                  type="number"
                  value={config.max_size_for_3_reels}
                  onChange={(e) => setConfig({ ...config, max_size_for_3_reels: parseFloat(e.target.value) || 1099 })}
                  className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold text-slate-900 dark:text-slate-100"
                />
                <span className="text-[10px] text-slate-600 dark:text-slate-400">Strict limit: sizes &ge; 1100 mm never get 3 reels</span>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-800 dark:text-slate-200">Dia Threshold for 2/3 Reels (mm)</label>
                <input
                  type="number"
                  value={config.dia_threshold_for_3_reels}
                  onChange={(e) => setConfig({ ...config, dia_threshold_for_3_reels: parseFloat(e.target.value) || 580 })}
                  className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold text-slate-900 dark:text-slate-100"
                />
                <span className="text-[10px] text-slate-600 dark:text-slate-400">Default: 580 mm (Dia &gt; 580 mm defaults to 2 reels to fill floor)</span>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-800 dark:text-slate-200">Dia &gt; 580mm 3-Reel Permission</label>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="allow3ReelsAbove580"
                    checked={config.allow_3_reels_above_580_dia || false}
                    onChange={(e) => setConfig({ ...config, allow_3_reels_above_580_dia: e.target.checked })}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600"
                  />
                  <label htmlFor="allow3ReelsAbove580" className="text-xs text-slate-700 dark:text-slate-300 font-semibold cursor-pointer">
                    {config.allow_3_reels_above_580_dia ? 'Granted (Pack 3 reels for Dia > 580mm)' : 'Default (Pack 2 reels to fill space)'}
                  </label>
                </div>
                <span className="text-[10px] text-slate-600 dark:text-slate-400">Enable when container weight is low and user grants permission</span>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-800 dark:text-slate-200">VPP Tare Allowance (mm)</label>
                <input
                  type="number"
                  value={config.vpp_tare_height}
                  onChange={(e) => setConfig({ ...config, vpp_tare_height: parseFloat(e.target.value) || 200 })}
                  className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: Film Specs Master Database */}
        {orderSectionTab === 'filmSpecs' && (
          <div className="pt-2 animate-fadeIn">
            <FilmSpecsManager
              prefillFilmCode={prefillFilmCodeForManager}
              onSpecsChanged={() => {
                setTableKey(prev => prev + 1);
              }}
            />
          </div>
        )}
      </div>

      {/* Main View Tabs Navigation */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
        <div className="flex space-x-2">
          <button
            onClick={() => setActiveTab('master')}
            className={`flex items-center space-x-2 py-3 px-4 text-xs font-bold border-b-2 transition-colors ${
              activeTab === 'master'
                ? 'border-blue-900 dark:border-blue-400 text-blue-900 dark:text-blue-300 bg-blue-50/50 dark:bg-blue-950/40'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Master Stuffing Plan (Export Table)</span>
          </button>

          <button
            onClick={() => setActiveTab('summary')}
            className={`flex items-center space-x-2 py-3 px-4 text-xs font-bold border-b-2 transition-colors ${
              activeTab === 'summary'
                ? 'border-blue-900 dark:border-blue-400 text-blue-900 dark:text-blue-300 bg-blue-50/50 dark:bg-blue-950/40'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Order Summary Sheet</span>
          </button>

          <button
            onClick={() => setActiveTab('visualizer')}
            className={`flex items-center space-x-2 py-3 px-4 text-xs font-bold border-b-2 transition-colors ${
              activeTab === 'visualizer'
                ? 'border-blue-900 dark:border-blue-400 text-blue-900 dark:text-blue-300 bg-blue-50/50 dark:bg-blue-950/40'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Grid className="w-4 h-4" />
            <span>Container Layout Visualizer (2D & 3D)</span>
          </button>
        </div>

        {/* Container View Filter Tabs (for master & visualizer view) */}
        {plan.containers.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 py-2">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-400 shrink-0">Containers ({plan.containers.length}):</span>
            <button
              type="button"
              onClick={() => setSelectedContainerId(0)}
              className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all ${
                selectedContainerId === 0
                  ? 'bg-blue-900 dark:bg-blue-700 text-white border-blue-900 dark:border-blue-700 shadow-xs'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750'
              }`}
            >
              All Containers ({plan.containers.length}) • {plan.totals.total_planned_weight.toLocaleString()} kg
            </button>
            {plan.containers.map((c) => {
              const sizesStr = Array.from(new Set(c.orders.map(o => `${o.size}mm`))).join(', ');
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedContainerId(c.id)}
                  className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all flex items-center gap-1.5 ${
                    selectedContainerId === c.id
                      ? 'bg-blue-900 dark:bg-blue-700 text-white border-blue-900 dark:border-blue-700 shadow-xs'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750'
                  }`}
                >
                  <Truck className="w-3.5 h-3.5" />
                  <span>{c.name} ({c.total_weight.toLocaleString()} kg)</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-normal ${
                    selectedContainerId === c.id ? 'bg-blue-800 dark:bg-blue-600 text-blue-100' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  }`}>
                    Sizes: {sizesStr}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Multi-Container Allocation Summary Banner */}
      {plan.containers.length > 1 && (
        <div className="bg-indigo-900/90 dark:bg-indigo-950 text-white p-3.5 rounded-xl border border-indigo-700/50 dark:border-indigo-800 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-300 shrink-0" />
              <span className="text-xs font-bold">Multi-Container Loading Distribution ({plan.containers.length} Containers Required):</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {plan.containers.map((c) => (
                <div key={c.id} className="bg-slate-900/80 px-2.5 py-1 rounded-lg border border-indigo-500/30 flex items-center gap-1.5 font-mono text-[11px]">
                  <span className="font-bold text-amber-300">Container #{c.id}:</span>
                  <span className="text-slate-300">{c.total_weight.toLocaleString()} kg ({c.loaded_pallets} pal) &rarr;</span>
                  <span className="text-cyan-300 font-bold">Sizes: {c.orders.map(o => `${o.size}mm (Item ${o.item})`).join(', ')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* VPP RESIDUAL SPACE-FILL PALLET EXCEPTION CONTROL (PERMANENT) */}
      {/* ========================================================= */}
      {(() => {
        const isApproved = !!(config.allow_vpp_space_fill_pallet && (plan.vpp_space_fill_opportunity?.approved || spaceFillCheckReport?.opportunity?.approved));
        const activeOpp = isApproved ? (plan.vpp_space_fill_opportunity || spaceFillCheckReport?.opportunity || null) : (spaceFillCheckReport?.opportunity || null);
        const reportStatus = isApproved ? 'FEASIBLE' : (spaceFillCheckReport?.status || null);

        // Container card styles based on status
        let cardBg = 'bg-slate-50/90 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800';
        let iconBg = 'bg-slate-700 dark:bg-slate-600 text-white';
        let badgeBg = 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300';
        let badgeText = 'Default OFF • Manual Check Available';

        if (isApproved) {
          cardBg = 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700';
          iconBg = 'bg-emerald-600 text-white shadow-xs';
          badgeBg = 'bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200';
          badgeText = '✓ Approved & Active';
        } else if (reportStatus === 'FEASIBLE') {
          cardBg = 'bg-amber-50/90 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700';
          iconBg = 'bg-amber-600 text-white shadow-xs';
          badgeBg = 'bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200';
          badgeText = 'Feasible — Planner Approval Required';
        } else if (reportStatus === 'ALREADY_OPTIMAL') {
          cardBg = 'bg-sky-50/90 dark:bg-sky-950/40 border-sky-300 dark:border-sky-800';
          iconBg = 'bg-sky-600 text-white shadow-xs';
          badgeBg = 'bg-sky-200 dark:bg-sky-900 text-sky-900 dark:text-sky-200';
          badgeText = 'Single Container Optimal';
        } else if (reportStatus === 'NOT_FEASIBLE') {
          cardBg = 'bg-slate-50/90 dark:bg-slate-900/60 border-slate-300 dark:border-slate-700';
          iconBg = 'bg-amber-600 text-white shadow-xs';
          badgeBg = 'bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200';
          badgeText = 'Not Feasible';
        }

        return (
          <div className={`p-4 rounded-xl border shadow-xs transition-all ${cardBg}`}>
            {/* Header & Main Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/80 dark:border-slate-800/80">
              <div className="flex items-start gap-2.5">
                <div className={`p-2 rounded-lg shrink-0 ${iconBg}`}>
                  {reportStatus === 'ALREADY_OPTIMAL' ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : reportStatus === 'NOT_FEASIBLE' ? (
                    <AlertTriangle className="w-5 h-5" />
                  ) : (
                    <Boxes className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      VPP Residual Space-Fill Pallet Exception
                    </h4>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${badgeBg}`}>
                      {badgeText}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    {isApproved && activeOpp
                      ? `Custom non-standard pallet (${activeOpp.proposedPallet.palletLength}×${activeOpp.proposedPallet.palletWidth} mm) active in Container #${activeOpp.targetContainerIndex + 1}.`
                      : reportStatus === 'FEASIBLE' && activeOpp
                      ? `Usable empty floor space detected in Container #${activeOpp.targetContainerIndex + 1}. Engine calculated an optimized custom pallet footprint.`
                      : reportStatus === 'ALREADY_OPTIMAL'
                      ? 'All orders fit inside a single container without residual spillover.'
                      : reportStatus === 'NOT_FEASIBLE'
                      ? 'Feasibility check complete: container physical envelope or operational rules cannot accept a custom pallet.'
                      : 'Check if residual spillover reels can be absorbed into container empty floor space using a non-standard custom pallet.'}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="shrink-0 flex items-center gap-2">
                {isApproved ? (
                  <>
                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      Space-Fill Pallet Active
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setConfig(prev => ({ ...prev, allow_vpp_space_fill_pallet: false }));
                        setSpaceFillCheckReport(null);
                      }}
                      className="px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 text-xs font-semibold rounded-lg shadow-2xs transition-all cursor-pointer"
                    >
                      Revert to Standard Plan
                    </button>
                  </>
                ) : reportStatus === 'FEASIBLE' && activeOpp ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setConfig(prev => ({ ...prev, allow_vpp_space_fill_pallet: true }))}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-2 transition-all cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Allow Space-Fill Pallet</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCheckSpaceFillPossibility}
                      disabled={isCheckingSpaceFill}
                      title="Re-check Possibility"
                      className="px-2.5 py-2 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 text-xs font-semibold rounded-lg shadow-2xs transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isCheckingSpaceFill ? 'animate-spin' : ''}`} />
                    </button>
                  </>
                ) : reportStatus === 'ALREADY_OPTIMAL' || reportStatus === 'NOT_FEASIBLE' ? (
                  <button
                    type="button"
                    onClick={handleCheckSpaceFillPossibility}
                    disabled={isCheckingSpaceFill}
                    className="px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 text-xs font-semibold rounded-lg shadow-2xs transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isCheckingSpaceFill ? 'animate-spin' : ''}`} />
                    <span>Re-check Possibility</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleCheckSpaceFillPossibility}
                    disabled={isCheckingSpaceFill}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isCheckingSpaceFill ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Search className="w-4 h-4" />
                    )}
                    <span>Check Space-Fill Possibility</span>
                  </button>
                )}
              </div>
            </div>

            {/* Outcome State: ALREADY_OPTIMAL */}
            {reportStatus === 'ALREADY_OPTIMAL' && !isApproved && (
              <div className="mt-3 p-3 bg-white/90 dark:bg-slate-900/90 rounded-lg border border-sky-200 dark:border-sky-800/80 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-sky-600 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    Single container optimal — no spillover.
                  </p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                    All planned reels fit into a single container ({config.container_type === '20ft' ? '20ft' : '40ft HC'}). No second container was opened, so no space-fill exception is necessary.
                  </p>
                </div>
              </div>
            )}

            {/* Outcome State: NOT_FEASIBLE */}
            {reportStatus === 'NOT_FEASIBLE' && !isApproved && (
              <div className="mt-3 p-3 bg-amber-50/90 dark:bg-amber-950/40 rounded-lg border border-amber-300 dark:border-amber-800 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                    Space-Fill Pallet Not Feasible
                  </p>
                  <p className="text-xs text-amber-800 dark:text-amber-300 mt-1 font-mono">
                    {spaceFillCheckReport?.reason || 'No feasible non-standard pallet fits within container physical envelope and weight limits.'}
                  </p>
                </div>
              </div>
            )}

            {/* Outcome State: FEASIBLE or APPROVED - Metric Grid (All Required Variables) */}
            {(isApproved || reportStatus === 'FEASIBLE') && activeOpp && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mt-3 text-xs">
                <div className="bg-white/90 dark:bg-slate-900/90 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800/80">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Spillover Reels</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                    {activeOpp.spilloverReels} reels
                  </span>
                  <span className="text-[10px] text-slate-500 block truncate">
                    {activeOpp.spilloverItem.film} ({activeOpp.spilloverItem.size} mm)
                  </span>
                </div>

                <div className="bg-white/90 dark:bg-slate-900/90 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800/80">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Available Free Space</span>
                  <span className="font-bold text-cyan-700 dark:text-cyan-400 text-sm">
                    {activeOpp.availableFreeSpace.length} × {activeOpp.availableFreeSpace.width} mm
                  </span>
                  <span className="text-[10px] text-slate-500 block truncate">
                    Cont #{activeOpp.targetContainerIndex + 1} (Row {activeOpp.proposedPallet.targetRow} Tail)
                  </span>
                </div>

                <div className="bg-white/90 dark:bg-slate-900/90 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800/80">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Proposed Dimensions</span>
                  <span className="font-bold text-indigo-700 dark:text-indigo-400 text-sm">
                    {activeOpp.proposedPallet.palletLength} × {activeOpp.proposedPallet.palletWidth} mm
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    Footprint: (A×D+50)×(B×D+50)
                  </span>
                </div>

                <div className="bg-white/90 dark:bg-slate-900/90 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800/80">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Reel Grid &amp; Layers</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                    {activeOpp.proposedPallet.gridA} × {activeOpp.proposedPallet.gridB} ({activeOpp.proposedPallet.reelsPerLayer}/layer)
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    {activeOpp.proposedPallet.layers} layer{activeOpp.proposedPallet.layers > 1 ? 's' : ''} vertically
                  </span>
                </div>

                <div className="bg-white/90 dark:bg-slate-900/90 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800/80">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Reels &amp; Final Height</span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-400 text-sm">
                    {activeOpp.proposedPallet.totalReelsAbsorbed} reels ({activeOpp.proposedPallet.palletWeight} kg)
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    Height: {activeOpp.proposedPallet.palletHeight} mm (≤ {activeOpp.availableFreeSpace.height} mm)
                  </span>
                </div>

                <div className="bg-white/90 dark:bg-slate-900/90 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800/80">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Container Impact</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="font-bold text-slate-700 dark:text-slate-300">
                      {activeOpp.containerCountBefore}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className={`font-black text-sm ${
                      activeOpp.eliminatesExtraContainer ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'
                    }`}>
                      {activeOpp.containerCountAfter} Cont.
                    </span>
                  </div>
                  <span className={`text-[10px] font-bold block truncate ${
                    activeOpp.eliminatesExtraContainer ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'
                  }`}>
                    {activeOpp.eliminatesExtraContainer ? 'Avoids 2nd Container!' : 'Absorbs residual reels'}
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ========================================================= */}
      {/* TAB 1: MASTER STUFFING PLAN (FACTORY & SAP EXPORT FORMAT) */}
      {/* ========================================================= */}
      {activeTab === 'master' && (
        <div className="space-y-8">
          {plan.containers.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-xl p-12 text-center border border-slate-200 dark:border-slate-800">
              <Truck className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
              <h3 className="text-base font-bold text-slate-700 dark:text-slate-300">No Orders in Stuffing Queue</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Please enter orders in the table above or load a sample customer preset.</p>
            </div>
          ) : (
            plan.containers
              .filter(c => selectedContainerId === 0 || c.id === selectedContainerId)
              .map((container) => {
                const is20ft = container.container_type === '20ft';
                const hasVpp = container.orders.some(o => o.packing_mode === 'VPP');

                return (
                  <div 
                    key={container.id} 
                    className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 overflow-hidden space-y-4 p-5"
                  >
                    {/* Container Banner Header */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-900 text-white p-4 rounded-xl shadow-xs border border-slate-800">
                      <div className="flex items-center space-x-3">
                        <div className="p-2 bg-blue-600 rounded-lg">
                          <Truck className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <h2 className="text-base font-bold tracking-wide">
                              {container.name.toUpperCase()}
                            </h2>
                            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                              {clientName}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              is20ft ? 'bg-cyan-500 text-slate-950' : 'bg-blue-500 text-white'
                            }`}>
                              {is20ft ? '20ft Dry' : '40ft High Cube'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Standard Export Configuration • {hasVpp ? 'VPP (Vertical Eye-to-Sky)' : 'HPP (Horizontal Cradle)'}
                          </p>
                        </div>
                      </div>

                      {/* Container Key Metrics */}
                      <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
                        <div className="bg-slate-800/90 px-3 py-1.5 rounded-lg border border-slate-700">
                          <span className="text-slate-400 block text-[10px]">PAYLOAD WEIGHT</span>
                          <span className="text-sm font-bold text-emerald-400">
                            {container.total_weight.toLocaleString()} kg
                          </span>
                          <span className="text-[10px] text-slate-400"> / {container.max_weight.toLocaleString()} kg ({container.weight_utilization_pct}%)</span>
                        </div>

                        <div className="bg-slate-800/90 px-3 py-1.5 rounded-lg border border-slate-700">
                          <span className="text-slate-400 block text-[10px]">CONTAINER SPACE FILL</span>
                          <span className="text-sm font-bold text-cyan-300">
                            {container.row_lengths.max_length.toLocaleString()} mm
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {' '}/ {is20ft ? '5,750' : '12,032'} mm ({container.space_utilization_pct || Number(((container.row_lengths.max_length / (is20ft ? 5750 : 12032)) * 100).toFixed(1))}%)
                          </span>
                        </div>

                        <div className="bg-slate-800/90 px-3 py-1.5 rounded-lg border border-slate-700">
                          <span className="text-slate-400 block text-[10px]">PALLETS &amp; MIX</span>
                          <span className="text-sm font-bold text-indigo-300">
                            {container.loaded_pallets} Pallets
                          </span>
                          <span className="text-[10px] text-slate-400 block">
                            {container.pallets_3_reels ? `${container.pallets_3_reels}x 3-reel ` : ''}
                            {container.pallets_2_reels ? `+ ${container.pallets_2_reels}x 2-reel` : ''}
                            {!container.pallets_3_reels && !container.pallets_2_reels ? `(${container.total_reels} reels)` : ''}
                          </span>
                        </div>

                        <div className="bg-slate-800/90 px-3 py-1.5 rounded-lg border border-slate-700">
                          <span className="text-slate-400 block text-[10px]">ROW LENGTHS</span>
                          <span className="text-xs font-bold text-amber-300">
                            {is20ft || hasVpp 
                              ? `R1: ${container.row_lengths.row1}mm | R2: ${container.row_lengths.row2}mm`
                              : `R1: ${container.row_lengths.row1}mm | R2: ${container.row_lengths.row2}mm | R3: ${container.row_lengths.row3 || 0}mm`
                            }
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Quick Items & Sizes In This Container Banner */}
                    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-blue-50/80 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg text-xs">
                      <span className="font-bold text-blue-950 dark:text-blue-200 flex items-center gap-1">
                        <Tag className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
                        Sizes in {container.name}:
                      </span>
                      {container.orders.map((o) => (
                        <span key={o.item} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 text-blue-900 dark:text-blue-200 border border-blue-300 dark:border-blue-700 font-mono text-[11px] font-bold shadow-2xs">
                          <span>Item {o.item}:</span>
                          <span className="text-indigo-700 dark:text-indigo-300 font-black">{o.size} mm</span>
                          <span className="text-slate-600 dark:text-slate-400 font-normal">({o.total_pallets} pal / {o.planned_weight.toLocaleString()} kg)</span>
                        </span>
                      ))}
                    </div>

                    {/* View Mode Selector: Physical Pallet Master Plan vs Cross-Bay Grid Matrix */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3 pt-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setStuffingViewMode('pallets')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                            stuffingViewMode === 'pallets'
                              ? 'bg-blue-900 dark:bg-blue-800 text-white shadow-xs'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                          }`}
                        >
                          <Package className="w-3.5 h-3.5 text-cyan-400" />
                          Physical Pallet Master Plan ({container.physical_pallets?.length || container.total_pallets} Pallets)
                        </button>
                        <button
                          onClick={() => setStuffingViewMode('grid')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                            stuffingViewMode === 'grid'
                              ? 'bg-blue-900 dark:bg-blue-800 text-white shadow-xs'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                          }`}
                        >
                          <Grid className="w-3.5 h-3.5 text-amber-400" />
                          Factory Cross-Bay Grid Matrix
                        </button>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono">
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {container.physical_pallets?.length || container.total_pallets} Physical Pallets
                        </span>
                        <span>•</span>
                        <span>{container.total_reels} Reels</span>
                        <span>•</span>
                        <span>{container.total_weight.toLocaleString()} kg</span>
                        <span>•</span>
                        <span className="text-[11px] text-blue-600 dark:text-blue-400 font-sans italic">Click pallet # to inspect 3D tier composition</span>
                      </div>
                    </div>

                    {/* VIEW 1: PHYSICAL PALLET MASTER PLAN (PHYSICAL-PALLET CENTRIC) */}
                    {stuffingViewMode === 'pallets' && (
                      <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xs">
                        <table className="w-full text-xs text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-900 text-slate-200 font-bold text-[10px] border-b border-slate-700 uppercase tracking-wider">
                              <th className="py-2.5 px-3 border-r border-slate-700 bg-slate-950 text-center w-28">PALLET #</th>
                              <th className="py-2.5 px-2.5 border-r border-slate-700 text-center">ITEM / SR NO</th>
                              <th className="py-2.5 px-2.5 border-r border-slate-700">FILM</th>
                              <th className="py-2.5 px-2.5 border-r border-slate-700 text-right">SIZE (mm)</th>
                              <th className="py-2.5 px-2.5 border-r border-slate-700 text-right">LENGTH (m)</th>
                              <th className="py-2.5 px-2 border-r border-slate-700 text-center">CORE</th>
                              <th className="py-2.5 px-2 border-r border-slate-700 text-center">ROLL DIA</th>
                              <th className="py-2.5 px-2.5 border-r border-slate-700 text-right">PER REEL WT (kg)</th>
                              <th className="py-2.5 px-2.5 border-r border-slate-700 text-center bg-indigo-950 text-indigo-200">REELS IN PALLET</th>
                              <th className="py-2.5 px-2.5 border-r border-slate-700 text-right bg-emerald-950 text-emerald-200">SUBTOTAL WT (kg)</th>
                              <th className="py-2.5 px-3 border-r border-slate-700">TIER POSITION</th>
                              <th className="py-2.5 px-2.5 border-r border-slate-700 bg-blue-950 text-blue-200 text-center">PALLET TOTAL REELS</th>
                              <th className="py-2.5 px-2.5 border-r border-slate-700 bg-emerald-950 text-emerald-200 text-right">PALLET TOTAL WT</th>
                              <th className="py-2.5 px-3 border-r border-slate-700 bg-slate-950 text-center">PALLET DIMENSIONS</th>
                              <th className="py-2.5 px-3 bg-indigo-950 text-indigo-200 text-center">CONTAINER ROW / BAY / POSITION</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 font-mono text-[11px]">
                            {(() => {
                              const physicalPallets: PalletSlotInfo[] = (container.physical_pallets && container.physical_pallets.length > 0)
                                ? container.physical_pallets
                                : (() => {
                                    const fallbackList: PalletSlotInfo[] = [];
                                    let pNum = 1;
                                    container.orders.forEach((o) => {
                                      for (let i = 0; i < o.total_pallets; i++) {
                                        fallbackList.push({
                                          pallet_number: pNum++,
                                          is_mixed: false,
                                          total_reels: o.reels_per_pallet,
                                          total_weight: Number(((o.reels_per_pallet || 0) * (o.per_reel_wt || 0)).toFixed(2)),
                                          dims_str: o.pallet_dims_str,
                                          primary_film: o.film,
                                          primary_item: o.item,
                                          position_desc: 'Container Bay',
                                          items: [{
                                            item: o.item,
                                            film: o.film,
                                            size: o.size,
                                            length: o.length,
                                            core: o.core,
                                            dia: o.dia,
                                            per_reel_wt: o.per_reel_wt,
                                            reels: o.reels_per_pallet,
                                            weight: Number(((o.reels_per_pallet || 0) * (o.per_reel_wt || 0)).toFixed(2)),
                                            tier_position: 'Full Pallet'
                                          }]
                                        });
                                      }
                                    });
                                    return fallbackList;
                                  })();

                              return physicalPallets.map((p, pIdx) => {
                                const palletItems = (p.items && p.items.length > 0) ? p.items : [{
                                  item: p.primary_item || 1,
                                  film: p.primary_film || '',
                                  size: 0,
                                  reels: p.total_reels,
                                  weight: p.total_weight,
                                  tier_position: 'Full Pallet'
                                }];
                                const numItems = palletItems.length;

                                return palletItems.map((item, idx) => {
                                  const isFirstItem = idx === 0;
                                  const isEvenPallet = pIdx % 2 === 0;

                                  return (
                                    <tr 
                                      key={`${p.pallet_number}-${idx}`}
                                      className={`hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition-colors ${
                                        isFirstItem && pIdx > 0 ? 'border-t-2 border-slate-300 dark:border-slate-700' : ''
                                      } ${isEvenPallet ? 'bg-slate-50/30 dark:bg-slate-800/20' : ''}`}
                                    >
                                      {/* Pallet # (spans all items in this physical pallet) */}
                                      {isFirstItem && (
                                        <td 
                                          rowSpan={numItems}
                                          onClick={() => setSelectedPallet(p)}
                                          className="py-2 px-3 border-r border-slate-200 dark:border-slate-800 text-center bg-slate-50 dark:bg-slate-800/60 align-middle cursor-pointer hover:bg-amber-100/50 dark:hover:bg-amber-950/30 transition-colors group"
                                          title="Click to view 3D pallet breakdown and details"
                                        >
                                          <div className="flex flex-col items-center gap-1">
                                            <span className="font-black text-slate-900 dark:text-white text-xs px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xs group-hover:border-amber-400">
                                              Pallet #{p.pallet_number}
                                            </span>
                                            {p.is_mixed ? (
                                              <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-amber-500 text-white uppercase tracking-wider">
                                                MIXED
                                              </span>
                                            ) : (
                                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                                SINGLE
                                              </span>
                                            )}
                                            {p.is_tc20 && (
                                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-600 text-white uppercase tracking-wider">
                                                TC20
                                              </span>
                                            )}
                                            {p.is_space_fill && (
                                              <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-emerald-600 text-white uppercase tracking-wider">
                                                SPACE-FILL
                                              </span>
                                            )}
                                          </div>
                                        </td>
                                      )}

                                      {/* Item / Order Details */}
                                      <td className="py-1.5 px-2.5 border-r border-slate-200 dark:border-slate-800 text-center font-bold text-slate-800 dark:text-slate-200">
                                        Item {item.item}
                                      </td>
                                      <td className="py-1.5 px-2.5 border-r border-slate-200 dark:border-slate-800 font-bold text-blue-900 dark:text-blue-300">
                                        {item.film}
                                      </td>
                                      <td className="py-1.5 px-2.5 border-r border-slate-200 dark:border-slate-800 text-right font-bold text-slate-900 dark:text-slate-100">
                                        {item.size} mm
                                      </td>
                                      <td className="py-1.5 px-2.5 border-r border-slate-200 dark:border-slate-800 text-right text-slate-700 dark:text-slate-300">
                                        {item.length ? item.length.toLocaleString() : '-'}
                                      </td>
                                      <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 text-center text-slate-600 dark:text-slate-400">
                                        {item.core ? `${item.core}"` : '-'}
                                      </td>
                                      <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 text-center text-slate-600 dark:text-slate-400">
                                        {item.dia || '-'}
                                      </td>
                                      <td className="py-1.5 px-2.5 border-r border-slate-200 dark:border-slate-800 text-right text-slate-700 dark:text-slate-300">
                                        {item.per_reel_wt ? item.per_reel_wt.toFixed(2) : '-'}
                                      </td>
                                      <td className="py-1.5 px-2.5 border-r border-slate-200 dark:border-slate-800 text-center font-black text-indigo-900 dark:text-indigo-200 bg-indigo-50/40 dark:bg-indigo-950/20">
                                        {item.reels}
                                      </td>
                                      <td className="py-1.5 px-2.5 border-r border-slate-200 dark:border-slate-800 text-right font-bold text-emerald-800 dark:text-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20">
                                        {item.weight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </td>
                                      <td className="py-1.5 px-3 border-r border-slate-200 dark:border-slate-800">
                                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                                          {item.tier_position || item.tier_desc || (idx === 0 ? 'Tier 1 (Bottom)' : 'Tier 2 (Top)')}
                                        </span>
                                      </td>

                                      {/* Pallet Summaries (spans all items in this physical pallet) */}
                                      {isFirstItem && (
                                        <>
                                          <td 
                                            rowSpan={numItems}
                                            className="py-1.5 px-2.5 border-r border-slate-200 dark:border-slate-800 text-center font-black text-slate-900 dark:text-white bg-blue-50/30 dark:bg-blue-950/20 align-middle text-xs"
                                          >
                                            {p.total_reels}
                                          </td>
                                          <td 
                                            rowSpan={numItems}
                                            className="py-1.5 px-2.5 border-r border-slate-200 dark:border-slate-800 text-right font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/20 align-middle"
                                          >
                                            {p.total_weight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg
                                          </td>
                                          <td 
                                            rowSpan={numItems}
                                            className="py-1.5 px-3 border-r border-slate-200 dark:border-slate-800 text-center font-mono text-[11px] text-slate-700 dark:text-slate-300 align-middle"
                                          >
                                            {p.dims_str}
                                          </td>
                                          <td 
                                            rowSpan={numItems}
                                            className="py-1.5 px-3 text-center font-bold text-blue-900 dark:text-blue-300 bg-indigo-50/30 dark:bg-indigo-950/20 align-middle"
                                          >
                                            <div className="flex flex-col items-center">
                                              <span>{p.position_desc || `Row ${p.row_index} / Bay ${p.bay_index}`}</span>
                                              {p.floor_dim && (
                                                <span className="text-[10px] text-slate-400 font-normal">
                                                  Dim: {p.floor_dim} mm
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                        </>
                                      )}
                                    </tr>
                                  );
                                });
                              });
                            })()}
                          </tbody>

                          {/* Master Plan Totals */}
                          <tfoot>
                            <tr className="bg-slate-900 text-white font-mono font-bold text-xs">
                              <td colSpan={8} className="py-2.5 px-3 text-right">
                                CONTAINER TOTAL ({container.physical_pallets?.length || container.total_pallets} Pallets):
                              </td>
                              <td className="py-2.5 px-2 text-center text-amber-300">
                                {container.total_reels}
                              </td>
                              <td className="py-2.5 px-2 text-right text-emerald-400">
                                {container.total_weight.toLocaleString()} kg
                              </td>
                              <td className="py-2.5 px-2"></td>
                              <td className="py-2.5 px-2 text-center text-amber-300">
                                {container.total_reels}
                              </td>
                              <td className="py-2.5 px-2 text-right text-emerald-400">
                                {container.total_weight.toLocaleString()} kg
                              </td>
                              <td className="py-2.5 px-2 text-center text-slate-400">
                                {container.physical_pallets?.length || container.total_pallets} Pallets Loaded
                              </td>
                              <td className="py-2.5 px-2 text-center text-cyan-300">
                                {container.row_lengths.max_length} mm / {is20ft ? 5750 : 12032} mm ({container.space_utilization_pct || Number(((container.row_lengths.max_length / (is20ft ? 5750 : 12032)) * 100).toFixed(1))}%)
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}

                    {/* VIEW 2: FACTORY CROSS-BAY GRID MATRIX (BAY STUFFING TABLE) */}
                    {stuffingViewMode === 'grid' && (
                      <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                        <table className="w-full text-xs text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-800 text-slate-200 font-bold text-[10px] border-b border-slate-700 uppercase tracking-wider">
                              {/* Order Info */}
                              <th className="py-2 px-2 border-r border-slate-700 text-center">ITEM</th>
                              <th className="py-2 px-2 border-r border-slate-700">FILM</th>
                              <th className="py-2 px-2 border-r border-slate-700">SIZE</th>
                              <th className="py-2 px-2 border-r border-slate-700">LENGTH</th>
                              <th className="py-2 px-2 border-r border-slate-700">CORE</th>
                              <th className="py-2 px-2 border-r border-slate-700">REEL WT</th>
                              <th className="py-2 px-2 border-r border-slate-700">PLANNED REELS</th>
                              <th className="py-2 px-2 border-r border-slate-700">PLANNED WT</th>
                              <th className="py-2 px-2 border-r border-slate-700">DIA</th>
                              <th className="py-2 px-2 border-r border-slate-700">DIMS (L*W*H)</th>
                              <th className="py-2 px-2 border-r border-slate-700">REELS/PAL</th>
                              <th className="py-2 px-2 border-r border-slate-700">TOTAL PAL</th>
                              <th className="py-2 px-2 border-r border-slate-700">MODE</th>
                              <th className="py-2 px-2 border-r border-slate-700">EXCESS/LESS</th>

                              {/* Stuffing Rows */}
                              <th className="py-2 px-2 border-r border-slate-700 bg-blue-950 text-blue-200 text-center">ROW 1</th>
                              <th className="py-2 px-2 border-r border-slate-700 bg-blue-950 text-blue-200 text-center">ROW 2</th>
                              {(!is20ft) && (
                                <th className="py-2 px-2 border-r border-slate-700 bg-blue-950 text-blue-200 text-center">ROW 3</th>
                              )}

                              {/* Pallet Details */}
                              <th className="py-2 px-2 border-r border-slate-700 bg-indigo-950 text-indigo-200">SIZE</th>
                              <th className="py-2 px-2 border-r border-slate-700 bg-indigo-950 text-indigo-200">TOTAL PAL</th>
                              <th className="py-2 px-2 border-r border-slate-700 bg-indigo-950 text-indigo-200">PALLET WIDTH</th>
                              <th className="py-2 px-2 bg-indigo-950 text-indigo-200">LOADED CTN</th>
                            </tr>
                          </thead>

                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 font-mono text-[11px]">
                            {(() => {
                              const expandedOrders = expandOrdersForStuffingMaster(container.orders);
                              const maxRows = Math.max(
                                expandedOrders.length,
                                container.stuffing_grid.length,
                                container.pallet_packing_details.length
                              );

                              const rowElements = [];

                              for (let r = 0; r < maxRows; r++) {
                                const order = expandedOrders[r];
                                const grid = container.stuffing_grid[r];
                                const pallet = container.pallet_packing_details[r];

                                rowElements.push(
                                  <tr key={r} className="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                                    {/* Order Section */}
                                    <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 text-center font-bold text-slate-700 dark:text-slate-300">
                                      {order?.item ?? ''}
                                    </td>
                                    <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 font-bold text-blue-900 dark:text-blue-300">
                                      {order?.film ?? ''}
                                    </td>
                                    <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                                      {order?.size ?? ''}
                                    </td>
                                    <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                                      {order?.length ?? ''}
                                    </td>
                                    <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                                      {order ? `${order.core}"` : ''}
                                    </td>
                                    <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                                      {order ? order.per_reel_wt.toFixed(2) : ''}
                                    </td>
                                    <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 font-bold text-slate-900 dark:text-slate-100">
                                      {order?.planned_reels ?? ''}
                                    </td>
                                    <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 font-bold text-emerald-800 dark:text-emerald-400">
                                      {order ? order.planned_weight.toLocaleString() : ''}
                                    </td>
                                    <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                                      {order?.dia ?? ''}
                                    </td>
                                    <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                                      {order?.pallet_dims_str ?? ''}
                                    </td>
                                    <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 text-center font-bold text-slate-900 dark:text-slate-100">
                                      {order?.reels_per_pallet ?? ''}
                                    </td>
                                    <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 text-center font-bold text-indigo-700 dark:text-indigo-300">
                                      {order?.total_pallets ?? ''}
                                    </td>
                                    <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 text-center">
                                      {order ? (
                                        <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                          order.packing_mode === 'VPP' 
                                            ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800' 
                                            : 'bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                                        }`}>
                                          {order.packing_mode === 'VPP' ? (order.size <= 120 ? 'VPP (1+1)' : 'VPP') : order.packing_mode}
                                        </span>
                                      ) : ''}
                                    </td>
                                    <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 text-right font-bold text-slate-700 dark:text-slate-300">
                                      {order ? (
                                        <span className={order.excess_less >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                                          {order.excess_less > 0 ? `+${order.excess_less.toFixed(0)}` : order.excess_less.toFixed(0)}
                                        </span>
                                      ) : ''}
                                    </td>

                                    {/* Stuffing Rows Grid */}
                                    <td 
                                      onClick={() => grid?.pallet1_info && setSelectedPallet(grid.pallet1_info)}
                                      className={`py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 text-center font-bold transition-colors ${
                                        grid?.pallet1_info?.is_mixed
                                          ? 'bg-amber-100/70 dark:bg-amber-950/50 text-amber-950 dark:text-amber-200 cursor-pointer hover:bg-amber-200/80'
                                          : 'bg-blue-50/40 dark:bg-blue-950/30 text-blue-950 dark:text-blue-200'
                                      }`}
                                    >
                                      {grid?.row1 ? (
                                        <div className="flex items-center justify-center gap-1">
                                          <span title={`Item ${grid.item1 || ''}: ${grid.dims1 || ''}`}>
                                            {grid.row1}
                                          </span>
                                          {grid.pallet1_info?.is_mixed && (
                                            <span className="px-1 py-0.5 rounded text-[8px] font-black bg-amber-500 text-white font-mono uppercase tracking-wider">
                                              MIXED
                                            </span>
                                          )}
                                        </div>
                                      ) : '-'}
                                    </td>
                                    <td 
                                      onClick={() => grid?.pallet2_info && setSelectedPallet(grid.pallet2_info)}
                                      className={`py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 text-center font-bold transition-colors ${
                                        grid?.pallet2_info?.is_mixed
                                          ? 'bg-amber-100/70 dark:bg-amber-950/50 text-amber-950 dark:text-amber-200 cursor-pointer hover:bg-amber-200/80'
                                          : 'bg-blue-50/40 dark:bg-blue-950/30 text-blue-950 dark:text-blue-200'
                                      }`}
                                    >
                                      {grid?.row2 ? (
                                        <div className="flex items-center justify-center gap-1">
                                          <span title={`Item ${grid.item2 || ''}: ${grid.dims2 || ''}`}>
                                            {grid.row2}
                                          </span>
                                          {grid.pallet2_info?.is_mixed && (
                                            <span className="px-1 py-0.5 rounded text-[8px] font-black bg-amber-500 text-white font-mono uppercase tracking-wider">
                                              MIXED
                                            </span>
                                          )}
                                        </div>
                                      ) : '-'}
                                    </td>
                                    {(!is20ft) && (
                                      <td 
                                        onClick={() => grid?.pallet3_info && setSelectedPallet(grid.pallet3_info)}
                                        className={`py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 text-center font-bold transition-colors ${
                                          grid?.pallet3_info?.is_mixed
                                            ? 'bg-amber-100/70 dark:bg-amber-950/50 text-amber-950 dark:text-amber-200 cursor-pointer hover:bg-amber-200/80'
                                            : 'bg-blue-50/40 dark:bg-blue-950/30 text-blue-950 dark:text-blue-200'
                                        }`}
                                      >
                                        {grid?.row3 ? (
                                          <div className="flex items-center justify-center gap-1">
                                            <span title={`Item ${grid.item3 || ''}: ${grid.dims3 || ''}`}>
                                              {grid.row3}
                                            </span>
                                            {grid.pallet3_info?.is_mixed && (
                                              <span className="px-1 py-0.5 rounded text-[8px] font-black bg-amber-500 text-white font-mono uppercase tracking-wider">
                                                MIXED
                                              </span>
                                            )}
                                          </div>
                                        ) : '-'}
                                      </td>
                                    )}

                                    {/* Pallet Packing Summary Columns */}
                                    <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 bg-indigo-50/30 dark:bg-indigo-950/20 text-slate-800 dark:text-slate-200">
                                      {pallet?.size ?? ''}
                                    </td>
                                    <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 bg-indigo-50/30 dark:bg-indigo-950/20 text-center font-bold text-indigo-900 dark:text-indigo-300">
                                      {pallet?.total_pallet ?? ''}
                                    </td>
                                    <td className="py-1.5 px-2 border-r border-slate-200 dark:border-slate-800 bg-indigo-50/30 dark:bg-indigo-950/20 text-center text-slate-800 dark:text-slate-200">
                                      {pallet?.pallet_width ?? ''}
                                    </td>
                                    <td className="py-1.5 px-2 bg-indigo-50/30 dark:bg-indigo-950/20 text-center font-bold text-emerald-800 dark:text-emerald-400">
                                      {pallet?.loaded_in_container ?? ''}
                                    </td>
                                  </tr>
                                );
                              }

                              return rowElements;
                            })()}
                          </tbody>

                          {/* Table Grand Totals */}
                          <tfoot>
                            <tr className="bg-slate-900 text-white font-mono font-bold text-xs">
                              <td colSpan={6} className="py-2.5 px-3 text-right">
                                CONTAINER TOTAL:
                              </td>
                              <td className="py-2.5 px-2 text-amber-300">
                                {container.total_reels}
                              </td>
                              <td className="py-2.5 px-2 text-emerald-400">
                                {container.total_weight.toLocaleString()} kg
                              </td>
                              <td colSpan={3}></td>
                              <td className="py-2.5 px-2 text-center text-indigo-300">
                                {container.total_pallets}
                              </td>
                              <td colSpan={2}></td>
                              <td className="py-2.5 px-2 bg-blue-950 text-center text-amber-300">
                                {container.row_lengths.row1}
                              </td>
                              <td className="py-2.5 px-2 bg-blue-950 text-center text-amber-300">
                                {container.row_lengths.row2}
                              </td>
                              {(!is20ft && !hasVpp) && (
                                <td className="py-2.5 px-2 bg-blue-950 text-center text-amber-300">
                                  {container.row_lengths.row3 || 0}
                                </td>
                              )}
                              <td className="py-2.5 px-2 bg-indigo-950 text-slate-300">
                                TOTAL
                              </td>
                              <td className="py-2.5 px-2 bg-indigo-950 text-center text-indigo-300">
                                {container.total_pallets}
                              </td>
                              <td className="py-2.5 px-2 bg-indigo-950"></td>
                              <td className="py-2.5 px-2 bg-indigo-950 text-center text-emerald-400">
                                {container.loaded_pallets}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 2: ORDER SUMMARY MATRIX SHEET */}
      {/* ========================================================= */}
      {activeTab === 'summary' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <Layers className="w-5 h-5 text-blue-900 dark:text-blue-400" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Order Summary & Multi-Container Allocation Matrix
              </h2>
            </div>
            <span className="text-xs font-mono font-bold text-slate-600 dark:text-slate-400">
              Customer: {clientName}
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold border-b border-slate-200 dark:border-slate-700 text-[11px]">
                  <th className="py-2.5 px-3 text-center">ITEM</th>
                  <th className="py-2.5 px-3">FORMULA CODE</th>
                  <th className="py-2.5 px-3">FILM GRADE</th>
                  <th className="py-2.5 px-3">SIZE (mm)</th>
                  <th className="py-2.5 px-3">LENGTH (m)</th>
                  <th className="py-2.5 px-3">CORE</th>
                  <th className="py-2.5 px-3">DIA</th>
                  <th className="py-2.5 px-3">ORDER QTY (kg)</th>
                  <th className="py-2.5 px-3">PER REEL WT</th>
                  <th className="py-2.5 px-3">REELS (+10%)</th>
                  {plan.containers.map((c) => (
                    <th key={c.id} className="py-2.5 px-3 bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-200 text-center font-bold">
                      {c.name} (kg)
                    </th>
                  ))}
                  <th className="py-2.5 px-3 text-right">EXCESS / LESS</th>
                  <th className="py-2.5 px-3 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-right">TOTAL PLANNED (kg)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 font-mono text-xs">
                {plan.summary.map((item) => (
                  <tr key={item.item} className="hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-800 dark:text-slate-200">
                    <td className="py-2 px-3 text-center font-bold text-slate-700 dark:text-slate-300">{item.item}</td>
                    <td className="py-2 px-3 font-semibold text-blue-900 dark:text-blue-300">{item.formula}</td>
                    <td className="py-2 px-3">{item.film}</td>
                    <td className="py-2 px-3">{item.size}</td>
                    <td className="py-2 px-3">{item.length}</td>
                    <td className="py-2 px-3">{item.core}&quot;</td>
                    <td className="py-2 px-3">{item.dia}</td>
                    <td className="py-2 px-3 font-bold text-slate-900 dark:text-slate-100">{item.order_qty.toLocaleString()}</td>
                    <td className="py-2 px-3">{item.per_reel_wt.toFixed(2)}</td>
                    <td className="py-2 px-3">{item.required_reels_buffer.toFixed(1)}</td>
                    {plan.containers.map((c) => {
                      const match = c.orders.find(o => o.item === item.item);
                      return (
                        <td key={c.id} className="py-2 px-3 text-center bg-blue-50/30 dark:bg-blue-950/30 font-bold text-blue-900 dark:text-blue-300">
                          {match ? match.planned_weight.toLocaleString() : '-'}
                        </td>
                      );
                    })}
                    <td className="py-2 px-3 text-right font-bold">
                      <span className={item.excess_less >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                        {item.excess_less > 0 ? `+${item.excess_less.toFixed(0)}` : item.excess_less.toFixed(0)} kg
                      </span>
                    </td>
                    <td className="py-2 px-3 bg-slate-100 dark:bg-slate-800/80 font-bold text-slate-900 dark:text-slate-100 text-right">
                      {item.planned_weight.toLocaleString()} kg
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-900 text-white font-mono font-bold text-xs">
                  <td colSpan={7} className="py-3 px-3 text-right">
                    GRAND TOTALS:
                  </td>
                  <td className="py-3 px-3 text-blue-300">
                    {plan.totals.total_order_qty.toLocaleString()} kg
                  </td>
                  <td colSpan={2}></td>
                  {plan.containers.map((c) => (
                    <td key={c.id} className="py-3 px-3 text-center text-amber-300 bg-slate-950">
                      {c.total_weight.toLocaleString()} kg
                    </td>
                  ))}
                  <td className="py-3 px-3 text-right text-emerald-400">
                    {plan.totals.excess_less_total >= 0 ? `+${plan.totals.excess_less_total.toLocaleString()}` : plan.totals.excess_less_total.toLocaleString()} kg
                  </td>
                  <td className="py-3 px-3 bg-slate-800 text-right text-emerald-300">
                    {plan.totals.total_planned_weight.toLocaleString()} kg
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 3: CONTAINER LAYOUT VISUALIZER (2D & 3D) */}
      {/* ========================================================= */}
      {activeTab === 'visualizer' && (
        <div className="space-y-6">
          {plan.containers.map((c) => {
            const is20ft = c.container_type === '20ft';
            const hasVpp = c.orders.some(o => o.packing_mode === 'VPP');
            const hasRow3 = Boolean(c.row_lengths.row3 && c.row_lengths.row3 > 0);

            return (
              <div key={c.id} className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="flex items-center space-x-3">
                    <Truck className="w-5 h-5 text-blue-900 dark:text-blue-400" />
                    <div>
                      {(() => {
                        const is3Lines = Boolean(c.row_lengths.row1 && c.row_lengths.row1 > 0 && c.row_lengths.row2 && c.row_lengths.row2 > 0 && c.row_lengths.row3 && c.row_lengths.row3 > 0);
                        const is850Pinwheel = Boolean(c.row_lengths.row1 && c.row_lengths.row1 > 0 && (!c.row_lengths.row2 || c.row_lengths.row2 === 0) && c.row_lengths.row3 && c.row_lengths.row3 > 0);
                        return (
                          <>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                {c.name} Container Floor Layout Visualizer
                              </h3>
                              <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                                is3Lines 
                                  ? 'bg-blue-100 dark:bg-blue-950/80 text-blue-900 dark:text-blue-300 border border-blue-200 dark:border-blue-800' 
                                  : is850Pinwheel
                                    ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                                    : hasVpp
                                      ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-900 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                                      : 'bg-cyan-100 dark:bg-cyan-950/80 text-cyan-900 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800'
                              }`}>
                                {is3Lines ? '3 Lines Layout (Rows 1, 2, 3)' : is850Pinwheel ? '2 Lines Pinwheel Layout (Rows 1 & 3)' : hasVpp ? '2 Lines Pinwheel Layout (Rows 1 & 2)' : '2 Lines Layout (Rows 1, 2)'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                              {is3Lines 
                                ? '3 Lines across 2,352 mm width (3 × 765 mm = 2,295 mm ≤ 2,352 mm internal width)' 
                                : is850Pinwheel
                                  ? '2 Lines Pinwheel Layout for HPP 850 Ply: Row 1 rotated 90° (widthwise) + Row 3 standard orientation (lengthwise), Center corridor open (Row 2 = 0 mm)'
                                  : hasVpp
                                    ? '2 Lines Pinwheel Layout for VPP: Row 1 rotated widthwise (pallet width along length) + Row 2 standard longitudinal (pallet length along length), Transverse width fit ≤ 2,200 mm'
                                    : is20ft 
                                      ? '2 Lines across 2,352 mm width in 20ft container (Row 1 + Row 2 = 2,200 mm width fit)' 
                                      : '2 Lines Layout (Wide Base Pallets, 2 × Width ≤ 2,352 mm)'}
                            </p>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 text-xs font-mono">
                    <span className="px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-lg font-bold">
                      {c.total_weight.toLocaleString()} kg / {c.max_weight.toLocaleString()} kg ({c.weight_utilization_pct}%)
                    </span>
                    <span className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-lg font-bold">
                      {c.loaded_pallets} Pallets
                    </span>
                  </div>
                </div>

                {/* 2D Floor Plan Diagram */}
                <div className="bg-slate-900 rounded-xl p-5 text-white overflow-x-auto space-y-3 border border-slate-800">
                  <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-2">
                    <span className="font-bold flex items-center gap-1">
                      <span>FRONT WALL (Cabin End)</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">
                      Internal Container Length: <strong className="text-slate-200">{is20ft ? '5,898 mm' : '12,032 mm'}</strong> • Usable Pallet Placement Length: <strong className="text-cyan-300">{is20ft ? '5,750 mm' : '12,032 mm'}</strong> • Loading: <strong className="text-amber-300">{hasRow3 ? '3 Parallel Lines' : '2 Parallel Lines'}</strong>
                    </span>
                    <span className="font-bold flex items-center gap-1">
                      <ArrowRight className="w-3.5 h-3.5" />
                      <span>CONTAINER DOOR END</span>
                    </span>
                  </div>

                  {/* Grid Rows */}
                  <div className="space-y-2 py-2">
                    {/* Row 1 */}
                    <div className="flex items-center gap-2">
                      <span className="w-24 text-[11px] font-bold text-slate-300 shrink-0">LINE 1 (R1):</span>
                      <div className="flex items-center gap-1.5 flex-1 min-h-[48px] bg-slate-800/80 p-1.5 rounded-lg border border-slate-700 overflow-x-auto">
                        {c.stuffing_grid.map((slot, idx) => slot.row1 ? (
                          slot.pallet1_info?.is_mixed ? (
                            <PalletCard
                              key={idx}
                              pallet={slot.pallet1_info}
                              variant="slot"
                              onClick={() => setSelectedPallet(slot.pallet1_info || null)}
                            />
                          ) : (
                            <div 
                              key={idx} 
                              onClick={() => slot.pallet1_info && setSelectedPallet(slot.pallet1_info)}
                              className="flex-1 min-w-[70px] bg-blue-600 hover:bg-blue-500 border border-blue-400 p-2 rounded text-center transition-transform hover:scale-105 cursor-pointer shadow-xs"
                              title={`Item ${slot.item1 || ''}: ${slot.dims1 || `${slot.row1}mm`}`}
                            >
                              <span className="block text-[10px] font-bold text-blue-100">Item {slot.item1 || (idx + 1) * 10}</span>
                              <span className="block text-xs font-mono font-bold text-white">{slot.row1} mm</span>
                            </div>
                          )
                        ) : null)}
                      </div>
                    </div>

                    {/* Row 2 */}
                    <div className="flex items-center gap-2">
                      <span className="w-24 text-[11px] font-bold text-slate-300 shrink-0">LINE 2 (R2):</span>
                      <div className="flex items-center gap-1.5 flex-1 min-h-[48px] bg-slate-800/80 p-1.5 rounded-lg border border-slate-700 overflow-x-auto">
                        {c.stuffing_grid.some(slot => slot.row2) ? (
                          c.stuffing_grid.map((slot, idx) => slot.row2 ? (
                            slot.pallet2_info?.is_mixed ? (
                              <PalletCard
                                key={idx}
                                pallet={slot.pallet2_info}
                                variant="slot"
                                onClick={() => setSelectedPallet(slot.pallet2_info || null)}
                              />
                            ) : (
                              <div 
                                key={idx} 
                                onClick={() => slot.pallet2_info && setSelectedPallet(slot.pallet2_info)}
                                className="flex-1 min-w-[70px] bg-cyan-600 hover:bg-cyan-500 border border-cyan-400 p-2 rounded text-center transition-transform hover:scale-105 cursor-pointer shadow-xs"
                                title={`Item ${slot.item2 || ''}: ${slot.dims2 || `${slot.row2}mm`}`}
                              >
                                <span className="block text-[10px] font-bold text-cyan-100">Item {slot.item2 || (idx + 1) * 10}</span>
                                <span className="block text-xs font-mono font-bold text-white">{slot.row2} mm</span>
                              </div>
                            )
                          ) : null)
                        ) : (
                          <div className="w-full flex items-center justify-center text-xs font-mono text-slate-400 italic py-2">
                            Center Clearance Corridor (Row 2 Open — 0 mm)
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Row 3 (if active) */}
                    {hasRow3 && (
                      <div className="flex items-center gap-2">
                        <span className="w-24 text-[11px] font-bold text-slate-300 shrink-0">LINE 3 (R3):</span>
                        <div className="flex items-center gap-1.5 flex-1 min-h-[48px] bg-slate-800/80 p-1.5 rounded-lg border border-slate-700 overflow-x-auto">
                          {c.stuffing_grid.map((slot, idx) => slot.row3 ? (
                            slot.pallet3_info?.is_mixed ? (
                              <PalletCard
                                key={idx}
                                pallet={slot.pallet3_info}
                                variant="slot"
                                onClick={() => setSelectedPallet(slot.pallet3_info || null)}
                              />
                            ) : (
                              <div 
                                key={idx} 
                                onClick={() => slot.pallet3_info && setSelectedPallet(slot.pallet3_info)}
                                className="flex-1 min-w-[70px] bg-indigo-600 hover:bg-indigo-500 border border-indigo-400 p-2 rounded text-center transition-transform hover:scale-105 cursor-pointer shadow-xs"
                                title={`Item ${slot.item3 || ''}: ${slot.dims3 || `${slot.row3}mm`}`}
                              >
                                <span className="block text-[10px] font-bold text-indigo-100">Item {slot.item3 || (idx + 1) * 10}</span>
                                <span className="block text-xs font-mono font-bold text-white">{slot.row3} mm</span>
                              </div>
                            )
                          ) : null)}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Summary Bar */}
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800 font-mono">
                    <span>
                      Cumulative Lengths: Line 1 = <strong>{c.row_lengths.row1} mm</strong> | Line 2 = <strong>{c.row_lengths.row2} mm</strong> {hasRow3 ? `| Line 3 = ${c.row_lengths.row3 || 0} mm` : ''}
                    </span>
                    <span className="text-emerald-400 font-bold">
                      Max Longitudinal Length: {c.row_lengths.max_length} mm / {is20ft ? '5,750 mm' : '12,032 mm'} (Fit OK)
                    </span>
                  </div>

                  {/* Physical Pallets Manifest */}
                  {c.physical_pallets && c.physical_pallets.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-700/80 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-amber-400" />
                          <h4 className="text-xs font-black uppercase tracking-wider text-slate-200">
                            Physical Pallets Manifest ({c.physical_pallets.length} Loaded)
                          </h4>
                          {c.physical_pallets.some(p => p.is_mixed) && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-500 text-white tracking-wider animate-pulse">
                              Contains Mixed Pallet(s)
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono">
                          Click any pallet card to inspect complete reel composition & tier layout
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
                        {c.physical_pallets.map((p) => (
                          <PalletCard
                            key={p.pallet_number}
                            pallet={p}
                            variant="manifest"
                            onClick={() => setSelectedPallet(p)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: IMPORT ORDERS & QUANTITIES */}
      {/* ========================================================= */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <UploadCloud className="w-5 h-5 text-indigo-700 dark:text-indigo-400" />
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Import Order Quantities
                </h3>
              </div>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            {/* Mode selection tabs */}
            <div className="grid grid-cols-2 gap-2 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-xl text-xs font-bold text-center">
              <button
                onClick={() => setImportMode('paste')}
                className={`py-2 rounded-lg transition-all cursor-pointer ${
                  importMode === 'paste' ? 'bg-white dark:bg-slate-700 text-indigo-900 dark:text-indigo-200 shadow-2xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Paste Table / Text
              </button>
              <button
                onClick={() => setImportMode('file')}
                className={`py-2 rounded-lg transition-all cursor-pointer ${
                  importMode === 'file' ? 'bg-white dark:bg-slate-700 text-indigo-900 dark:text-indigo-200 shadow-2xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Upload Excel (.xlsx/.csv)
              </button>
            </div>

            {/* Content: Mode 1: Paste */}
            {importMode === 'paste' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Copy and paste rows directly from your Excel spreadsheet, SAP report, or comma/tab separated text:
                </p>
                <textarea
                  rows={8}
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder={`Example (Tab or Comma separated):\nFilm\tSize\tLength\tCore\tDia\tOrder Qty\nTH21-25\t950\t15500\t6\t700\t6500\nTH21-25\t1050\t15500\t6\t700\t9500\nOC217-40\t620\t3200\t3\t421\t1350`}
                  className="w-full p-3 font-mono text-xs border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-700 dark:focus:ring-indigo-500 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400"
                />
                <button
                  onClick={handlePastedTextImport}
                  className="w-full py-2.5 bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  Parse and Load Pasted Quantities
                </button>
              </div>
            )}

            {/* Content: Mode 2: File Upload */}
            {importMode === 'file' && (
              <div className="space-y-4 text-center py-6 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <FileSpreadsheet className="w-12 h-12 text-slate-400 mx-auto" />
                <div>
                  <label className="cursor-pointer inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs hover:bg-indigo-800 transition-colors">
                    <UploadCloud className="w-4 h-4" />
                    <span>Choose Excel Workbook / CSV File</span>
                    <input
                      type="file"
                      accept=".xlsx, .xls, .csv"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-2">
                    Supports SAP export, DARU TRADING format, or any spreadsheet with Film, Size, Length, and Qty columns.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mixed Pallet Composition & Details Modal */}
      <PalletDetailsModal
        pallet={selectedPallet}
        onClose={() => setSelectedPallet(null)}
      />

      {/* Universal Saved Plans Search & Management Modal */}
      <SavedPlansModal
        isOpen={isSavedPlansModalOpen}
        onClose={() => {
          setIsSavedPlansModalOpen(false);
          setSavedPlansCount(getSavedPlans().length);
        }}
        onSelectPlan={handleSelectSavedPlan}
        currentOrders={orders}
        currentCustomer={clientName}
        currentContainerType={config.container_type}
        currentPackingMode={config.default_packing_mode}
        onSaveCurrentPlanSuccess={(newPlan) => {
          setSavedPlansCount(getSavedPlans().length);
          setUploadStatus(`Saved plan "${newPlan.plan_name}" for ${newPlan.customer}!`);
        }}
      />
    </div>
  );
};
