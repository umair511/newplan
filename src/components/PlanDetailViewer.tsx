import React, { useState } from 'react';
import { SlitterPlan, UserProfile, PlanStatus } from '../types';
import { exportSinglePlanToExcel, downloadExcelBuffer, consolidatePlanItems } from '../services/excelExporter';
import { 
  Download, 
  Printer, 
  CheckCircle2, 
  X, 
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Layers,
  Info
} from 'lucide-react';

interface PlanDetailViewerProps {
  plan: SlitterPlan;
  currentUser: UserProfile;
  onClose: () => void;
  onUpdateStatus: (planId: string, newStatus: PlanStatus, notes?: string) => void;
}

export const PlanDetailViewer: React.FC<PlanDetailViewerProps> = ({
  plan,
  currentUser,
  onClose,
  onUpdateStatus,
}) => {
  const [approvalNotes, setApprovalNotes] = useState('');
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'SCHEDULE' | 'SEGMENTS'>('SCHEDULE');

  const handleDownloadExcel = () => {
    const buffer = exportSinglePlanToExcel(plan);
    downloadExcelBuffer(buffer, `Slitter_Plan_${plan.plan_number}.xlsx`);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleApprove = () => {
    onUpdateStatus(plan.id, 'APPROVED', approvalNotes);
    setShowApprovalModal(false);
  };

  // Calculate Initial Active Totals & Consolidated Rows
  const consolidatedRows = consolidatePlanItems(plan.items || []);
  const initialActiveRows = consolidatedRows.filter(it => !it.is_future_replacement);
  const initialActiveUps = initialActiveRows.reduce((sum, it) => sum + (it.ups || 0), 0);
  const initialActiveSlitWidth = initialActiveRows.reduce((sum, it) => sum + (it.deckle_mm || 0), 0);
  const initialActiveReels = initialActiveRows.reduce((sum, it) => sum + (it.reels || 0), 0);
  const initialActiveWeightPerPack = Number(initialActiveRows.reduce((sum, it) => sum + (it.weight_per_pack_kg || 0), 0).toFixed(2));
  const initialActiveWeightKg = Number(initialActiveRows.reduce((sum, it) => sum + (it.total_weight_kg || 0), 0).toFixed(2));

  const displayPlanNumber = (plan.plan_number || '').replace(/\bPS01\b/g, 'PS').replace(/^PS01-/g, 'PS-');
  const displayMachineName = (plan.machine_name || (plan.machine_id === 'MSL' ? 'METALLIZER SLITTER (MSL)' : 'PRIMARY SLITTER 1 (PS)')).replace(/\bPS01\b/g, 'PS');

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-7xl w-full max-h-[96vh] flex flex-col overflow-hidden border border-slate-300">
        {/* Modal Top Control Bar */}
        <div className="bg-slate-900 text-white px-6 py-3.5 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title="Close Sheet"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-base font-bold font-mono tracking-tight text-white">{displayPlanNumber}</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  plan.status === 'APPROVED' ? 'bg-emerald-500 text-slate-950' :
                  plan.status === 'IN_PRODUCTION' ? 'bg-blue-500 text-white' :
                  plan.status === 'COMPLETED' ? 'bg-slate-600 text-white' :
                  'bg-amber-400 text-slate-950'
                }`}>
                  {plan.status}
                </span>
                {plan.trim_rule_mode && plan.trim_rule_mode !== 'NORMAL' && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    {plan.trim_rule_mode === 'RELAXED_50MM' ? 'Yellow Zone Relaxed Trim (281–500mm)' : 'Custom Override Trim'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">Authoritative Primary Slitter Cutting Schedule (Doc Ref: {plan.doc_ref})</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <div className="bg-slate-800 p-0.5 rounded-lg flex border border-slate-700 mr-2">
              <button
                onClick={() => setActiveTab('SCHEDULE')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                  activeTab === 'SCHEDULE' ? 'bg-slate-700 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Cutting Schedule
              </button>
              {plan.changes && plan.changes.length > 0 && (
                <button
                  onClick={() => setActiveTab('SEGMENTS')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all flex items-center space-x-1 ${
                    activeTab === 'SEGMENTS' ? 'bg-amber-500 text-slate-950 shadow-xs font-bold' : 'text-amber-300 hover:text-white'
                  }`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Shifts ({plan.changes.length})</span>
                </button>
              )}
            </div>

            <button
              onClick={handleDownloadExcel}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors border border-slate-700"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Excel</span>
            </button>

            <button
              onClick={handlePrint}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors border border-slate-700"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>

            {plan.status === 'DRAFT' && currentUser?.role !== 'VIEWER' && (
              <button
                onClick={() => setShowApprovalModal(true)}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-colors shadow-xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Approve Plan</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Factory Sheet Content */}
        <div className="p-6 overflow-y-auto space-y-6 print:p-0 print:overflow-visible">
          {/* Authoritative Primary Slitter Schedule Header Grid */}
          <div className="border-2 border-slate-800 text-xs text-slate-900 bg-white">
            {/* Top Row Banner */}
            <div className="grid grid-cols-12 border-b-2 border-slate-800 font-mono">
              <div className="col-span-5 bg-amber-200/80 p-2 font-bold text-sm border-r border-slate-800 flex items-center justify-between">
                <span>{displayPlanNumber}</span>
                <span className="text-xs font-semibold px-2 py-0.5 bg-slate-900 text-white rounded">
                  {displayMachineName}
                </span>
              </div>
              <div className="col-span-3 p-2 bg-slate-50 border-r border-slate-800">
                <div className="flex justify-between">
                  <span className="font-semibold text-slate-600">Trim (mm):</span>
                  <strong className={`font-bold ${plan.trim_mm >= 150 && plan.trim_mm <= 280 ? 'text-emerald-800' : plan.trim_mm >= 281 && plan.trim_mm <= 500 ? 'text-amber-700' : 'text-rose-700'}`}>{plan.trim_mm} mm</strong>
                </div>
                <div className="flex justify-between">
                  <span className="font-semibold text-slate-600">Trim Wt (kg):</span>
                  <strong className="text-slate-900">{(plan.trim_weight_kg ?? 0).toFixed(2)}</strong>
                </div>
              </div>
              <div className="col-span-2 p-2 bg-slate-50 border-r border-slate-800">
                <div className="flex justify-between">
                  <span className="text-slate-600">Thickness:</span>
                  <strong>{plan.thickness_micron}µ</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Density:</span>
                  <strong>{plan.density}</strong>
                </div>
              </div>
              <div className="col-span-2 p-2 bg-slate-100 font-mono text-[11px]">
                <div>Doc: <strong>{plan.doc_ref}</strong></div>
                <div>Rev: <strong>{plan.rev_no}</strong></div>
              </div>
            </div>

            {/* Technical Specifications Sub-Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 border-b border-slate-800 p-2.5 gap-2 bg-slate-50/50 text-[11px]">
              <div>
                <span className="text-slate-500 block">FILM GRADE:</span>
                <strong className="text-slate-900 font-bold text-xs">{plan.film}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">LENGTH (m):</span>
                <strong className="text-slate-900 font-mono font-bold text-xs">
                  {plan.duplex_layout?.is_dual_length 
                    ? `Side A: ${plan.duplex_layout.side_a_length_m}m | Side B: ${plan.duplex_layout.side_b_length_m}m`
                    : (plan.length_m ?? 0).toLocaleString()}
                </strong>
              </div>
              <div>
                <span className="text-slate-500 block">REPETITIONS:</span>
                <strong className="text-slate-900 font-mono font-bold text-xs">{plan.repetitions} Packs</strong>
              </div>
              <div>
                <span className="text-slate-500 block">TOTAL DECKLE:</span>
                <strong className="text-slate-900 font-mono font-bold text-xs">{plan.deckle_mm} mm</strong>
              </div>
              <div>
                <span className="text-slate-500 block">UTILIZED WEB:</span>
                <strong className="text-emerald-800 font-mono font-bold text-xs">{plan.total_slit_width_mm} mm</strong>
              </div>
              <div>
                <span className="text-slate-500 block">WASTE PERCENT:</span>
                <strong className="text-amber-800 font-mono font-bold text-xs">{plan.waste_percent}%</strong>
              </div>
              <div>
                <span className="text-slate-500 block">PLANNED MR LENGTH:</span>
                <strong className="text-slate-900 font-mono font-bold text-xs">{(plan.planned_mr_length_m ?? 0).toLocaleString()} m</strong>
              </div>
              <div>
                <span className="text-slate-500 block">MILL ROLL WT:</span>
                <strong className="text-slate-900 font-mono font-bold text-xs">{(plan.mill_roll_weight_kg ?? 0).toLocaleString()} kg</strong>
              </div>
              <div>
                <span className="text-slate-500 block">ALLOWED TRIM:</span>
                <strong className="text-slate-900 font-mono font-bold text-xs">{plan.allowed_trim_mm} mm</strong>
              </div>
              <div>
                <span className="text-slate-500 block">DUPLEX 8+8 ARMS:</span>
                <strong className="text-indigo-900 font-mono font-bold text-xs">
                  A: {plan.duplex_layout?.side_a_ups || Math.ceil(initialActiveUps / 2)} | B: {plan.duplex_layout?.side_b_ups || Math.floor(initialActiveUps / 2)} (Tot: {initialActiveUps}/16)
                </strong>
              </div>
              <div>
                <span className="text-slate-500 block">REJ MATERIAL:</span>
                <strong className="text-rose-800 font-mono font-bold text-xs">{plan.rejection_material}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">ISSUE DATE:</span>
                <strong className="text-slate-900 font-mono text-xs">{plan.issue_date}</strong>
              </div>
            </div>

            {/* View Mode 1: Consolidated Cutting Schedule Table */}
            {activeTab === 'SCHEDULE' && (
              <div className="overflow-x-auto print:overflow-visible">
                <table className="w-full text-left text-xs border-collapse font-mono table-auto">
                  <thead>
                    {/* Super Headers */}
                    <tr className="bg-slate-200 text-slate-900 font-bold border-b border-slate-800">
                      <th colSpan={8} className="py-1.5 px-3 border-r-2 border-slate-800 text-center tracking-wider bg-slate-200">
                        DEMAND / SALES ORDER ALLOCATION (CONSOLIDATED)
                      </th>
                      <th colSpan={6} className="py-1.5 px-3 text-center tracking-wider bg-amber-100">
                        SLITTER DECKLE & PATTERN EXECUTION
                      </th>
                    </tr>
                    {/* Column Headers */}
                    <tr className="bg-slate-100 text-slate-800 font-bold border-b border-slate-800 text-[11px]">
                      <th className="py-2 px-2 border-r border-slate-300 whitespace-nowrap">SO#</th>
                      <th className="py-2 px-2 border-r border-slate-300 text-center whitespace-nowrap">Item</th>
                      <th className="py-2 px-3 border-r border-slate-300 min-w-[180px]">Customer</th>
                      <th className="py-2 px-2 border-r border-slate-300 text-right whitespace-nowrap">Length</th>
                      <th className="py-2 px-1 border-r border-slate-300 text-center whitespace-nowrap">Core</th>
                      <th className="py-2 px-1 border-r border-slate-300 text-center whitespace-nowrap">TS</th>
                      <th className="py-2 px-2 border-r border-slate-300 text-right whitespace-nowrap">Width</th>
                      <th className="py-2 px-2 border-r-2 border-slate-800 text-right whitespace-nowrap">Weight (kg)</th>

                      <th className="py-2 px-2 border-r border-slate-300 text-right bg-amber-50 whitespace-nowrap">Size (mm)</th>
                      <th className="py-2 px-2 border-r border-slate-300 text-center bg-amber-50 min-w-[88px]" title="Simultaneous physical slitting positions (0 for pending dynamic replacements)">UPS</th>
                      <th className="py-2 px-2 border-r border-slate-300 text-right bg-amber-50 whitespace-nowrap">Deckle (mm)</th>
                      <th className="py-2 px-2 border-r border-slate-300 text-right bg-amber-50 whitespace-nowrap">Reels</th>
                      <th className="py-2 px-2 border-r border-slate-300 text-right bg-amber-50 whitespace-nowrap">Wt/Pack (kg)</th>
                      <th className="py-2 px-2 text-right bg-amber-50 font-bold whitespace-nowrap">Tot.Wt (kg)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300 text-[11px]">
                    {consolidatedRows.map((item) => {
                      const isFuture = item.is_future_replacement;
                      const displayUps = item.ups;
                      const displayDeckle = item.deckle_mm;

                      return (
                        <tr 
                          key={item.key} 
                          className={isFuture ? "bg-amber-50/70 text-amber-950 font-medium" : "hover:bg-amber-50/40"}
                        >
                          <td className="py-2 px-2 border-r border-slate-300 font-bold text-slate-900 whitespace-nowrap">
                            {item.sales_order}
                          </td>
                          <td className="py-2 px-2 border-r border-slate-300 text-center text-slate-700 whitespace-nowrap">
                            {item.item_number}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-300 font-sans font-medium text-slate-900 align-top min-w-[180px] max-w-[280px]">
                            <div className="flex flex-col gap-1 items-start">
                              <span className="break-words whitespace-normal leading-snug" title={item.customer}>
                                {item.customer}
                              </span>
                              {isFuture && (
                                <span className="inline-flex px-1.5 py-0.5 bg-amber-200 text-amber-900 text-[9px] font-bold rounded uppercase tracking-tight border border-amber-300 whitespace-nowrap shrink-0">
                                  Future Shift{item.start_pack ? ` (Pack ${item.start_pack}+)` : ''}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-2 border-r border-slate-300 text-right text-slate-700 whitespace-nowrap">
                            {item.length_m}
                          </td>
                          <td className="py-2 px-1 border-r border-slate-300 text-center text-slate-800 whitespace-nowrap">
                            {item.core}"
                          </td>
                          <td className="py-2 px-1 border-r border-slate-300 text-center text-slate-800 whitespace-nowrap">
                            {item.treatment_side}
                          </td>
                          <td className="py-2 px-2 border-r border-slate-300 text-right font-bold text-slate-900 whitespace-nowrap">
                            {item.width_mm}
                          </td>
                          <td className="py-2 px-2 border-r-2 border-slate-800 text-right text-slate-800 whitespace-nowrap">
                            {(item.total_weight_kg ?? 0).toFixed(2)}
                          </td>

                          {/* Right Slitting — Size (mm) ALWAYS the slit width number, never "-" */}
                          <td className="py-2 px-2 border-r border-slate-300 text-right font-bold text-slate-900 bg-amber-50/40 whitespace-nowrap">
                            {item.width_mm}
                          </td>
                          <td className="py-2 px-2 border-r border-slate-300 text-center font-bold bg-amber-50/40 align-middle min-w-[88px]">
                            {isFuture ? (
                              <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] leading-tight font-black bg-amber-200 text-amber-900 uppercase border border-amber-400 whitespace-nowrap shadow-2xs">
                                FUTURE SHIFT
                              </span>
                            ) : displayUps > 0 ? (
                              <span className="text-slate-900 font-mono text-xs">{displayUps}</span>
                            ) : (
                              <span className="text-slate-400 font-mono font-normal">-</span>
                            )}
                          </td>
                          <td className="py-2 px-2 border-r border-slate-300 text-right font-bold text-slate-900 bg-amber-50/40 whitespace-nowrap">
                            {/* Size (mm) column is always width; Deckle: number when active UPS, "-" only for true FUTURE SHIFT */}
                            {isFuture ? (
                              <span className="text-slate-400 font-mono font-normal">-</span>
                            ) : displayDeckle > 0 ? (
                              displayDeckle
                            ) : (
                              <span className="text-slate-400 font-mono font-normal">-</span>
                            )}
                          </td>
                          <td className="py-2 px-2 border-r border-slate-300 text-right text-slate-800 bg-amber-50/40 whitespace-nowrap">
                            {item.reels}
                          </td>
                          <td className="py-2 px-2 border-r border-slate-300 text-right text-slate-800 bg-amber-50/40 whitespace-nowrap">
                            {isFuture ? (
                              <span className="text-slate-400 font-mono">-</span>
                            ) : (
                              displayUps > 0 ? (item.weight_per_pack_kg > 0 ? item.weight_per_pack_kg.toFixed(2) : ((item.total_weight_kg ?? 0) / (plan.repetitions || 1)).toFixed(2)) : '-'
                            )}
                          </td>
                          <td className="py-2 px-2 text-right font-bold text-emerald-900 bg-amber-100/50 whitespace-nowrap">
                            {(item.total_weight_kg ?? 0).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    {/* Totals Row matching authoritative template */}
                    <tr className="bg-slate-900 text-white font-bold text-xs border-t-2 border-slate-800">
                      <td colSpan={6} className="py-2.5 px-3 text-right uppercase tracking-wider">
                        TOTAL ALLOCATED WEIGHT:
                      </td>
                      <td className="py-2.5 px-2 text-right font-bold text-slate-300">
                        -
                      </td>
                      <td className="py-2.5 px-2 border-r-2 border-slate-800 text-right text-emerald-300">
                        {(plan.order_weight_kg ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg
                      </td>
                      <td className="py-2.5 px-2 text-right uppercase bg-slate-800">
                        INITIAL TOTALS:
                      </td>
                      <td className="py-2.5 px-1 text-center bg-slate-800 font-bold text-amber-300 whitespace-nowrap">
                        {initialActiveUps} UPS
                      </td>
                      <td className="py-2.5 px-2 text-right bg-slate-800 font-bold text-white whitespace-nowrap">
                        {initialActiveSlitWidth} mm
                      </td>
                      <td className="py-2.5 px-2 text-right bg-slate-800 text-slate-300">
                        {initialActiveReels}
                      </td>
                      <td className="py-2.5 px-2 text-right bg-slate-800 text-slate-300">
                        {initialActiveWeightPerPack.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-2 text-right bg-emerald-900 text-white font-bold text-sm whitespace-nowrap">
                        {initialActiveWeightKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* View Mode 2: Multi-Pack Dynamic Replacement & Shift Visualizer */}
            {activeTab === 'SEGMENTS' && (
              <div className="p-4 space-y-4 bg-slate-50">
                <div className="flex items-center space-x-2 text-xs font-bold text-slate-900">
                  <Layers className="w-4 h-4 text-amber-600" />
                  <span>Dynamic Knife Replacement Schedule (Continuous Slitter Run)</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Phase 1: Initial Setup */}
                  <div className="bg-white p-4 rounded-xl border border-slate-300 shadow-xs space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                      <span className="text-xs font-bold text-slate-900">Phase 1: Initial Setup (Pack 1)</span>
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-900 rounded text-[10px] font-bold">
                        {initialActiveUps} Active Arms
                      </span>
                    </div>
                    <div className="space-y-1.5 text-xs font-mono">
                      {consolidatedRows.filter(it => !it.is_future_replacement).map(it => (
                        <div key={`p1-${it.key}`} className="flex justify-between p-1.5 bg-slate-50 rounded border border-slate-200">
                          <span><strong>{it.width_mm} mm</strong> ({it.customer.slice(0, 20)})</span>
                          <span className="font-bold text-emerald-800">{it.ups} UPS</span>
                        </div>
                      ))}
                      {consolidatedRows.filter(it => it.is_future_replacement).map(it => (
                        <div key={`p1-pend-${it.key}`} className="flex justify-between p-1.5 bg-amber-50/60 rounded border border-dashed border-amber-300 text-amber-900">
                          <span>{it.width_mm} mm ({it.customer.slice(0, 20)} - {it.replacement_instruction || (it.start_pack ? `Starts Pack ${it.start_pack}` : 'Pending')})</span>
                          <span className="font-bold text-amber-700">FUTURE SHIFT</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Phase 2: Post-Shift Setup */}
                  <div className="bg-white p-4 rounded-xl border border-slate-300 shadow-xs space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                      <span className="text-xs font-bold text-slate-900">Phase 2: Post-Shift Active Setup</span>
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-900 rounded text-[10px] font-bold">
                        After Shift Execution
                      </span>
                    </div>
                    <div className="space-y-1.5 text-xs font-mono">
                      {/* Continuing companion active orders */}
                      {consolidatedRows.filter(it => !it.is_future_replacement).map(it => (
                        <div key={`p2-cont-${it.key}`} className="flex justify-between p-1.5 bg-emerald-50/60 rounded border border-emerald-200 text-emerald-950">
                          <span><strong>{it.width_mm} mm</strong> ({it.customer.slice(0, 20)})</span>
                          <span className="font-bold text-emerald-700">Continuing Active</span>
                        </div>
                      ))}
                      {/* Future replacement orders that activate */}
                      {consolidatedRows.filter(it => it.is_future_replacement).map(it => (
                        <div key={`p2-shift-${it.key}`} className="flex justify-between p-1.5 bg-amber-50 rounded border border-amber-300 text-amber-950">
                          <span><strong>{it.width_mm} mm</strong> ({it.customer.slice(0, 20)})</span>
                          <span className="font-bold text-amber-800">
                            {it.start_pack ? `Active (Pack ${it.start_pack}+)` : 'Active Post-Shift'}
                          </span>
                        </div>
                      ))}
                      {plan.changes && plan.changes.map(chg => (
                        <div key={chg.id} className="p-2 bg-amber-50/80 border border-amber-300 rounded text-xs space-y-1 mt-2">
                          <div className="font-bold text-amber-950 flex items-center space-x-1">
                            <ArrowRight className="w-3 h-3 text-amber-600" />
                            <span>{chg.instruction}</span>
                          </div>
                          <div className="text-[10px] text-slate-600">
                            Arm/Pos: {chg.position} · {chg.old_order_ref} → {chg.new_order_ref}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Dynamic Size Changes / Operator Change Instructions (SRS Section 33) */}
            <div className="p-3 bg-amber-100/90 border-t-2 border-slate-800 text-xs font-mono text-amber-950 font-bold flex items-center justify-between">
              <div>
                <span className="underline uppercase tracking-wide">Operator Instructions:</span>
                {plan.changes && plan.changes.length > 0 ? (
                  <span className="ml-2 font-black text-slate-900 text-sm">
                    {plan.changes.map(c => c.instruction).join(' | ')}
                  </span>
                ) : (
                  <span className="ml-2 font-normal text-slate-700">
                    Standard slitting execution. No in-run knife shift.
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-600">Primary Slitter Floor Document</span>
            </div>

            {/* Production Tracking Fields (Blank for floor recording as mandated in Section 23/72) */}
            <div className="grid grid-cols-2 sm:grid-cols-6 border-t-2 border-slate-800 divide-x divide-slate-800 bg-slate-50 text-[11px] p-2 text-center">
              <div>
                <div className="font-semibold text-slate-500">Starting Time</div>
                <div className="h-6 mt-1 border-b border-dashed border-slate-300 font-mono font-bold text-slate-700"></div>
              </div>
              <div>
                <div className="font-semibold text-slate-500">Completion Time</div>
                <div className="h-6 mt-1 border-b border-dashed border-slate-300 font-mono font-bold text-slate-700"></div>
              </div>
              <div>
                <div className="font-semibold text-slate-500">Duration (hrs)</div>
                <div className="h-6 mt-1 border-b border-dashed border-slate-300 font-mono font-bold text-slate-700"></div>
              </div>
              <div>
                <div className="font-semibold text-slate-500">Repetitions Done</div>
                <div className="h-6 mt-1 border-b border-dashed border-slate-300 font-mono font-bold text-slate-700"></div>
              </div>
              <div>
                <div className="font-semibold text-slate-500">Rejection (kg)</div>
                <div className="h-6 mt-1 border-b border-dashed border-slate-300 font-mono font-bold text-slate-700"></div>
              </div>
              <div>
                <div className="font-semibold text-slate-500">Consumed Length (m)</div>
                <div className="h-6 mt-1 border-b border-dashed border-slate-300 font-mono font-bold text-slate-700"></div>
              </div>
            </div>
          </div>
        </div>

        {/* Approval Dialog Modal */}
        {showApprovalModal && (
          <div className="fixed inset-0 z-60 bg-slate-950/70 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-150">
              <div className="flex items-center space-x-2 text-slate-900">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h4 className="font-bold text-base">Approve Slitter Plan [{displayPlanNumber}]</h4>
              </div>
              <p className="text-xs text-slate-600">
                Approving this plan locks its knife positions and allocates production capacity on Primary Slitter.
              </p>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Approval Notes (Optional):</label>
                <textarea
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  placeholder="e.g., Verified deckle efficiency 98.2% and core 6' specifications..."
                  className="w-full p-2.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  rows={3}
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  onClick={() => setShowApprovalModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApprove}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg shadow-sm"
                >
                  Confirm Approval
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
