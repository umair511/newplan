import React from 'react';
import { 
  X, 
  Printer, 
  Download, 
  CheckCircle2, 
  Disc, 
  Layers, 
  FileText, 
  Calendar,
  User,
  ShieldCheck,
  Scissors,
  ArrowRight,
  Clock,
  Activity,
  Repeat,
} from 'lucide-react';
import { MetallizerPlan } from '../../types/metallizer';
import { UserProfile, PlanStatus } from '../../types';

interface MetallizerPlanDetailViewerProps {
  plan: MetallizerPlan;
  currentUser: UserProfile;
  onClose: () => void;
  onUpdateStatus?: (planId: string, status: PlanStatus) => void;
}

export const MetallizerPlanDetailViewer: React.FC<MetallizerPlanDetailViewerProps> = ({
  plan,
  currentUser,
  onClose,
  onUpdateStatus,
}) => {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto print:p-0 print:bg-white">
      <div className="bg-white border border-slate-300 rounded-2xl max-w-4xl w-full shadow-2xl overflow-hidden flex flex-col my-auto print:border-none print:shadow-none print:max-w-full">
        {/* Modal Top Bar (hidden on print) */}
        <div className="bg-slate-900 text-white px-6 py-3.5 flex items-center justify-between print:hidden">
          <div className="flex items-center space-x-3">
            <span className="px-2 py-0.5 text-xs font-bold rounded bg-purple-600 text-white font-mono">
              METALLIZER SLITTER PLAN
            </span>
            <span className="text-sm font-bold tracking-tight">{plan.plan_number}</span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center space-x-1.5"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Sheet</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Industrial Planning Sheet Document */}
        <div className="p-6 sm:p-8 space-y-6 text-slate-900 bg-white">
          {/* Header Box */}
          <div className="border-b-2 border-slate-900 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-slate-500">
                G-PAK BOPP FILM DIVISION · METALLIZER SLITTER OPERATIONS
              </div>
              <h1 className="text-2xl font-black tracking-tight text-slate-950 mt-1">
                METALLIZER SLITTER PRODUCTION SCHEDULE
              </h1>
              <p className="text-xs text-slate-600 font-mono">
                Document Ref: APS/QR/MSL/01 · Machine: METALLIZER SLITTER
              </p>
            </div>

            <div className="text-right border border-slate-300 rounded-lg p-3 bg-slate-50">
              <div className="text-[10px] uppercase font-bold text-slate-500">Total Actual Deckle</div>
              <div className="text-2xl font-black font-mono text-purple-900">
                {plan.jumbo_width_mm} mm
              </div>
              <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                (NOT Fixed 10,400mm)
              </div>
            </div>
          </div>

          {/* Dynamic Continuous Slitter Campaign Banner */}
          {(plan.is_dynamic_continuous_run || plan.created_by?.includes('Dynamic')) && (
            <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 text-white rounded-xl p-4 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border border-purple-500/30">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-purple-700/60 rounded-lg">
                  <Repeat className="w-5 h-5 text-purple-200 animate-spin-slow" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-purple-300">Continuous Slitter Campaign</span>
                    <span className="px-2 py-0.5 text-[10px] font-black bg-emerald-400 text-slate-950 rounded-full">ACTIVE DYNAMIC CHAIN</span>
                  </div>
                  <div className="text-base font-black font-mono tracking-tight mt-0.5 text-white">
                    Master Campaign ID: {plan.continuous_run_id || 'RUN-DYNAMIC'}
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-4 text-xs font-mono">
                <div className="text-right">
                  <span className="text-[10px] text-purple-300 block uppercase font-sans font-bold">Continuous Campaign</span>
                  <span className="text-base font-black text-white">{(plan.continuous_run_meters || plan.jumbo_length_m || 0).toLocaleString()} m</span>
                </div>
                <div className="h-8 w-px bg-purple-700/60" />
                <div className="text-right">
                  <span className="text-[10px] text-purple-300 block uppercase font-sans font-bold">Package Doffs</span>
                  <span className="text-base font-black text-emerald-400">{plan.doff_events?.length || plan.transitions?.length || 0} Doffs</span>
                </div>
              </div>
            </div>
          )}

          {/* Residual Fulfillment Sweep Banner */}
          {(plan.is_residual_sweep || plan.created_by?.includes('Residual Sweep')) && (
            <div className="bg-gradient-to-r from-teal-950 via-emerald-950 to-slate-900 text-white rounded-xl p-4 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border border-teal-500/30">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-teal-700/60 rounded-lg">
                  <Layers className="w-5 h-5 text-teal-200" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-teal-300">Pass 2 Residual Sweep</span>
                    <span className="px-2 py-0.5 text-[10px] font-black bg-teal-400 text-slate-950 rounded-full">MULTI-PACKAGE JUMBO CONSOLIDATION</span>
                  </div>
                  <div className="text-base font-black font-mono tracking-tight mt-0.5 text-white">
                    {plan.package_multiple || 1} Standard Package Set{(plan.package_multiple || 1) > 1 ? 's' : ''} · Zero Speculative Material
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-4 text-xs font-mono">
                <div className="text-right">
                  <span className="text-[10px] text-teal-300 block uppercase font-sans font-bold">Planned Weight</span>
                  <span className="text-base font-black text-white">{(plan.planned_quantity_kg || 0).toLocaleString()} kg</span>
                </div>
                <div className="h-8 w-px bg-teal-700/60" />
                <div className="text-right">
                  <span className="text-[10px] text-teal-300 block uppercase font-sans font-bold">Total Slit Width</span>
                  <span className="text-base font-black text-teal-300">{plan.total_slit_width_mm} mm</span>
                </div>
              </div>
            </div>
          )}

          {/* Key Parameters 4-Box Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/70">
              <span className="text-[10px] font-bold uppercase text-slate-500 block">Plan Number</span>
              <span className="font-mono font-bold text-sm text-slate-900">{plan.plan_number}</span>
            </div>
            <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/70">
              <span className="text-[10px] font-bold uppercase text-slate-500 block">Film Grade & Micron</span>
              <span className="font-bold text-sm text-purple-900">{plan.film} ({plan.thickness_micron}µm)</span>
            </div>
            <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/70">
              <span className="text-[10px] font-bold uppercase text-slate-500 block">Mother Jumbo Roll ID</span>
              <span className="font-mono font-bold text-sm text-slate-900">{plan.jumbo_roll_id}</span>
            </div>
            <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/70">
              <span className="text-[10px] font-bold uppercase text-slate-500 block">Core Specification</span>
              <span className="font-bold text-sm text-slate-900">{plan.core}</span>
            </div>
          </div>

          {/* Physical Roll Dimensions Box */}
          <div className="bg-purple-50/40 border border-purple-200 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs">
            <div>
              <span className="text-[10px] font-bold uppercase text-purple-800 block">Mount Jumbo Deckle</span>
              <span className="font-mono font-black text-base text-slate-900">{plan.jumbo_width_mm} mm</span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase text-purple-800 block">Jumbo Length (m)</span>
              <span className="font-mono font-black text-base text-slate-900">{(plan.jumbo_length_m ?? 0).toLocaleString()} m</span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase text-purple-800 block">Calculated Diameter</span>
              <span className="font-mono font-black text-base text-purple-900">{plan.diameter_mm} mm</span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase text-purple-800 block">Slit Combination</span>
              <span className="font-mono font-black text-base text-emerald-700">{plan.ups} UPS Pattern</span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase text-purple-800 block">Total Jumbo Sets (Packs)</span>
              <span className="font-mono font-black text-base text-indigo-700">
                {plan.package_multiple || 1} Pack{(plan.package_multiple || 1) > 1 ? 's' : ''} ({((plan.package_multiple || 1) * plan.ups)} Reels)
              </span>
            </div>
          </div>

          {/* Slitter Knives Visual Representation */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Physical Knife Slit Layout & Trim Distribution
            </h3>
            <div className="border border-slate-300 rounded-xl p-4 bg-slate-50">
              <div className="flex items-center space-x-2 mb-3">
                {plan.finished_sizes.map((sz, i) => (
                  <div key={i} className="flex-1 bg-white border-2 border-purple-600 rounded-lg p-2.5 text-center shadow-xs">
                    <div className="text-[10px] font-bold text-slate-500 uppercase">Arm {i + 1}</div>
                    <div className="text-base font-black font-mono text-slate-900 mt-0.5">{sz} mm</div>
                  </div>
                ))}
                <div className="bg-rose-50 border-2 border-rose-300 rounded-lg p-2.5 text-center px-4">
                  <div className="text-[10px] font-bold text-rose-700 uppercase">Side Trim</div>
                  <div className="text-base font-black font-mono text-rose-900 mt-0.5">{plan.trim_mm} mm</div>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-600 pt-2 border-t border-slate-200">
                <span>Sum of Finished Slit Widths: <b className="text-slate-900 font-mono">{plan.total_slit_width_mm} mm</b></span>
                <span>+</span>
                <span>Side Trim: <b className="text-rose-700 font-mono">{plan.trim_mm} mm</b></span>
                <span>=</span>
                <span>Total Jumbo Roll Deckle: <b className="text-purple-900 font-mono">{plan.jumbo_width_mm} mm</b></span>
              </div>
            </div>
          </div>

          {/* Dynamic Arm Schedule Gantt Timeline */}
          {plan.arm_schedules && plan.arm_schedules.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-purple-600" />
                  <span>Continuous Slitter Arm Schedule (Dynamic Customer-Job Chaining)</span>
                </h3>
                <span className="text-[11px] text-purple-700 font-mono font-bold">
                  {plan.arm_schedules.length} Active Intervals
                </span>
              </div>
              <div className="border border-slate-300 rounded-xl p-4 bg-slate-50 space-y-3 shadow-xs">
                {Array.from(new Set(plan.arm_schedules.map(s => s.arm_index))).sort((a, b) => a - b).map(armIdx => {
                  const intervals = plan.arm_schedules!.filter(s => s.arm_index === armIdx);
                  const totalRunLen = plan.continuous_run_meters || plan.jumbo_length_m || intervals.reduce((max, i) => Math.max(max, i.end_length_m), 0) || 1;
                  const shaft = intervals[0]?.shaft || 'FRONT';

                  return (
                    <div key={armIdx} className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-slate-800 font-mono flex items-center space-x-2">
                          <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 text-[10px] font-bold">
                            ARM {armIdx}
                          </span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${shaft === 'FRONT' ? 'bg-amber-100 text-amber-900' : 'bg-teal-100 text-teal-900'}`}>
                            {shaft} SHAFT
                          </span>
                        </span>
                        <span className="text-slate-500 font-mono text-[10px]">
                          {intervals.length} Sequence Block{intervals.length > 1 ? 's' : ''}
                        </span>
                      </div>

                      <div className="flex w-full h-11 bg-slate-200/90 rounded-lg overflow-hidden border border-slate-300 p-0.5 gap-1">
                        {intervals.map((intv, iIdx) => {
                          const spanLen = intv.length_m || (intv.end_length_m - intv.start_length_m);
                          const widthPct = Math.max(8, (spanLen / totalRunLen) * 100);
                          const bgClasses = [
                            'bg-purple-700 hover:bg-purple-600',
                            'bg-indigo-700 hover:bg-indigo-600',
                            'bg-blue-700 hover:bg-blue-600',
                            'bg-slate-800 hover:bg-slate-700',
                          ];
                          const colorBg = bgClasses[iIdx % bgClasses.length];

                          return (
                            <div
                              key={iIdx}
                              style={{ width: `${widthPct}%` }}
                              className={`${colorBg} text-white h-full rounded flex flex-col justify-center px-2 overflow-hidden shadow-xs cursor-default transition-all`}
                              title={`Arm ${armIdx}: ${intv.customer} (${intv.sales_order}-${intv.item_number})\nWidth: ${intv.width_mm}mm | Interval: ${intv.start_length_m.toLocaleString()}m -> ${intv.end_length_m.toLocaleString()}m (${spanLen.toLocaleString()}m)\nReels: ${intv.reels} | Weight: ${intv.weight_kg}kg`}
                            >
                              <div className="text-[10px] font-black truncate leading-tight flex items-center justify-between">
                                <span>{intv.width_mm} mm</span>
                                <span className="text-[9px] opacity-80 font-normal">{intv.customer}</span>
                              </div>
                              <div className="text-[9px] opacity-90 truncate font-mono mt-0.5">
                                SO {intv.sales_order} · {(spanLen / 1000).toFixed(1)}k m
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Dynamic Doff Transitions & Knife Handoffs */}
          {((plan.doff_events && plan.doff_events.length > 0) || (plan.transitions && plan.transitions.length > 0)) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center space-x-2">
                  <Scissors className="w-4 h-4 text-purple-600" />
                  <span>Dynamic Doff Transitions & Knife Reassignments</span>
                </h3>
                <span className="text-[11px] text-slate-500 font-medium">
                  {plan.doff_events?.length || plan.transitions?.length || 0} Doff Boundary{(plan.doff_events?.length || plan.transitions?.length || 0) > 1 ? 'ies' : 'y'}
                </span>
              </div>

              <div className="space-y-2">
                {(plan.doff_events || []).map((doff, dIdx) => {
                  const netDelta = doff.reassigned_arms?.reduce((s, a) => s + a.delta_mm, 0) || 0;
                  const shiftedShaft = doff.reassigned_arms?.length > 0 ? doff.reassigned_arms[0].shaft : 'NONE';

                  return (
                    <div key={dIdx} className="border border-slate-300 rounded-xl p-3.5 bg-slate-50/90 shadow-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                        <div className="flex items-center space-x-2">
                          <span className="px-2 py-0.5 text-[10px] font-black rounded bg-slate-900 text-white font-mono">
                            DOFF #{doff.package_boundary || (dIdx + 1)}
                          </span>
                          <span className="text-xs font-mono font-bold text-purple-900">
                            at {doff.at_length_m.toLocaleString()} m
                          </span>
                          <span className={`px-2 py-0.5 text-[10px] font-black rounded-full ${
                            doff.transition_type === '0-ARM' ? 'bg-emerald-100 text-emerald-800' :
                            doff.transition_type === '1-ARM' ? 'bg-blue-100 text-blue-800' :
                            'bg-purple-100 text-purple-800'
                          }`}>
                            {doff.transition_type} ({shiftedShaft} SHAFT)
                          </span>
                        </div>
                        <div className="flex items-center space-x-3 text-xs">
                          <span className="text-slate-600 font-medium flex items-center space-x-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span>Downtime: <b className="text-slate-900 font-mono">{doff.estimated_downtime_minutes} min</b></span>
                          </span>
                          <span className="text-slate-600 font-medium">
                            Δ Net: <b className="text-slate-900 font-mono">{netDelta > 0 ? `+${netDelta}` : netDelta} mm</b>
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2.5 text-xs">
                        <div>
                          <span className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
                            Dynamically Reassigned Knife Arm(s)
                          </span>
                          {doff.reassigned_arms && doff.reassigned_arms.length > 0 ? (
                            <div className="space-y-1">
                              {doff.reassigned_arms.map((arm, aIdx) => (
                                <div key={aIdx} className="bg-white border border-blue-200 rounded p-1.5 flex items-center justify-between text-slate-800 shadow-2xs">
                                  <div className="flex items-center space-x-1.5 font-mono">
                                    <span className="font-bold text-blue-700">Arm {arm.arm_index} ({arm.shaft}):</span>
                                    <span>{arm.from_width_mm} mm</span>
                                    <ArrowRight className="w-3 h-3 text-slate-400" />
                                    <span className="font-bold text-purple-900">{arm.to_width_mm} mm</span>
                                  </div>
                                  <span className="text-[10px] font-mono text-slate-500">
                                    Δ {arm.delta_mm > 0 ? `+${arm.delta_mm}` : arm.delta_mm} mm
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">None (Identical Setup Continuation)</span>
                          )}
                        </div>

                        <div>
                          <span className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
                            Uninterrupted Running Arms (Active Orders Continued)
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {doff.continuous_arms && doff.continuous_arms.map((arm, aIdx) => (
                              <span key={aIdx} className="bg-emerald-50 border border-emerald-300 text-emerald-900 px-2 py-1 rounded text-[11px] font-mono flex items-center space-x-1">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                <span>Arm {arm.arm_index}: {arm.width_mm} mm</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Package Segments Breakdown for Segmented Runs */}
          {plan.segments && plan.segments.length > 1 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center space-x-2">
                <Layers className="w-4 h-4 text-purple-600" />
                <span>Package Segments Breakdown ({plan.segments.length} Package Sets)</span>
              </h3>
              <div className="border border-slate-300 rounded-xl overflow-hidden shadow-xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-600">
                    <tr>
                      <th className="py-2 px-3">Seg #</th>
                      <th className="py-2 px-3">Range (m)</th>
                      <th className="py-2 px-3">Length (m)</th>
                      <th className="py-2 px-3">Slit Cuts (mm)</th>
                      <th className="py-2 px-3 text-right">Slit Sum</th>
                      <th className="py-2 px-3 text-right">Side Trim</th>
                      <th className="py-2 px-3 text-right">Waste %</th>
                      <th className="py-2 px-3 text-center">Duplex Shafts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {plan.segments.map((seg, sIdx) => (
                      <tr key={sIdx}>
                        <td className="py-2 px-3 font-mono font-bold text-slate-900">PS{seg.segment_index}</td>
                        <td className="py-2 px-3 font-mono text-slate-600">{seg.start_length_m.toLocaleString()} - {seg.end_length_m.toLocaleString()} m</td>
                        <td className="py-2 px-3 font-mono font-bold text-slate-900">{seg.length_m.toLocaleString()} m</td>
                        <td className="py-2 px-3 font-mono text-purple-900">[{seg.cuts.join(', ')}] mm</td>
                        <td className="py-2 px-3 text-right font-mono font-bold">{seg.total_slit_width_mm} mm</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-rose-700">{seg.trim_mm} mm</td>
                        <td className="py-2 px-3 text-right font-mono">{seg.waste_percent}%</td>
                        <td className="py-2 px-3 text-center font-mono text-[10px]">
                          F: {seg.shaft_distribution?.front_ups ?? 0} | R: {seg.shaft_distribution?.rear_ups ?? 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Order Allocation Table */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Allocated Customer Orders Breakdown
            </h3>
            <div className="border border-slate-300 rounded-xl overflow-hidden shadow-xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3">SO # / Item</th>
                    <th className="py-2.5 px-4">Customer Name</th>
                    <th className="py-2.5 px-3 text-right">Width (mm)</th>
                    <th className="py-2.5 px-3 text-right">Length (m)</th>
                    <th className="py-2.5 px-3 text-right">UPS</th>
                    <th className="py-2.5 px-3 text-right">Reels</th>
                    <th className="py-2.5 px-3 text-right">Planned (KG)</th>
                    <th className="py-2.5 px-3 text-right">Remaining (KG)</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {plan.orders_covered.map((o, idx) => {
                    const isFutureShift = !!(
                      (plan.segments && plan.segments.length > 1 && !plan.segments[0].orders_covered.some(so => so.sales_order === o.sales_order && so.item_number === o.item_number)) ||
                      (plan.arm_schedules && plan.arm_schedules.length > 0 && plan.arm_schedules.filter(s => s.sales_order === o.sales_order && s.item_number === o.item_number).length > 0 && plan.arm_schedules.filter(s => s.sales_order === o.sales_order && s.item_number === o.item_number).every(i => i.start_length_m > 0))
                    );

                    return (
                      <tr key={idx} className={isFutureShift ? "bg-amber-50/60" : undefined}>
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{o.sales_order}-{o.item_number}</td>
                        <td className="py-2.5 px-4 font-medium text-slate-800">
                          <div className="flex items-center space-x-1.5">
                            <span>{o.customer}</span>
                            {isFutureShift && (
                              <span className="px-1.5 py-0.5 bg-amber-200 text-amber-900 text-[9px] font-bold rounded uppercase tracking-tight border border-amber-300 whitespace-nowrap">
                                Future Shift
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold">{o.width_mm} mm</td>
                        <td className="py-2.5 px-3 text-right font-mono">{(o.length_m ?? 0).toLocaleString()} m</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold">
                          {isFutureShift ? (
                            <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-200 text-amber-900 uppercase border border-amber-400 whitespace-nowrap shadow-2xs">
                              FUTURE SHIFT
                            </span>
                          ) : (
                            o.ups
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">{o.planned_reels}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-purple-800">{(o.planned_weight_kg ?? 0).toLocaleString()} kg</td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600">{(o.remaining_after_kg ?? 0).toLocaleString()} kg</td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                            o.is_closed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {o.is_closed ? 'FULFILLED' : 'PARTIAL'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mass Balance & Production Yield Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-200 pt-4 text-xs">
            <div className="space-y-1">
              <span className="text-slate-500 font-bold uppercase text-[10px]">Net Planned Production Mass</span>
              <div className="text-xl font-black font-mono text-slate-900">
                {(plan.planned_quantity_kg ?? 0).toLocaleString()} <span className="text-xs font-normal text-slate-500">KG</span>
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-slate-500 font-bold uppercase text-[10px]">Side Trim Scrap Mass</span>
              <div className="text-xl font-black font-mono text-rose-700">
                {(plan.trim_weight_kg ?? 0).toLocaleString()} <span className="text-xs font-normal text-slate-500">KG ({plan.waste_percent}%)</span>
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-slate-500 font-bold uppercase text-[10px]">Mother Roll Status After Plan</span>
              <div className="text-xl font-black font-mono text-purple-900">
                {plan.roll_status_after} ({(plan.remaining_roll_length_m ?? 0).toLocaleString()} m rem)
              </div>
            </div>
          </div>

          {/* Signatures and Approvals */}
          <div className="grid grid-cols-2 gap-8 pt-8 border-t border-slate-300 text-xs">
            <div>
              <div className="text-slate-500 text-[10px] uppercase font-bold">Planned By</div>
              <div className="font-bold text-slate-900 mt-1">{plan.created_by || currentUser.name}</div>
              <div className="text-[11px] text-slate-400 font-mono mt-0.5">Date: {new Date(plan.created_at).toLocaleString()}</div>
            </div>
            <div className="text-right">
              <div className="text-slate-500 text-[10px] uppercase font-bold">Production Approval</div>
              <div className="font-bold text-emerald-800 mt-1">{plan.approved_by || 'Verified by Lead Slitter Planner'}</div>
              <div className="text-[11px] text-slate-400 font-mono mt-0.5">Status: {plan.status}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
