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
  ShieldCheck
} from 'lucide-react';
import { SSPlan } from '../../types/ss';
import { exportSSPlansToExcelStyled, downloadExcelBuffer } from '../../services/excelExporter';
import { UserProfile, PlanStatus } from '../../types';

interface SSPlanDetailViewerProps {
  plan: SSPlan;
  currentUser: UserProfile;
  onClose: () => void;
  onUpdateStatus?: (planId: string, status: PlanStatus) => void;
}

export const SSPlanDetailViewer: React.FC<SSPlanDetailViewerProps> = ({
  plan,
  currentUser,
  onClose,
  onUpdateStatus,
}) => {
  const handlePrint = () => {
    window.print();
  };

  const handleDownloadExcel = async () => {
    const buf = await exportSSPlansToExcelStyled([plan]);
    downloadExcelBuffer(buf, `SS_Plan_${plan.plan_number || plan.id}.xlsx`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto print:p-0 print:bg-white">
      <div className="bg-white border border-slate-300 rounded-2xl max-w-4xl w-full shadow-2xl overflow-hidden flex flex-col my-auto print:border-none print:shadow-none print:max-w-full">
        {/* Modal Top Bar (hidden on print) */}
        <div className="bg-slate-900 text-white px-6 py-3.5 flex items-center justify-between print:hidden">
          <div className="flex items-center space-x-3">
            <span className="px-2 py-0.5 text-xs font-bold rounded bg-purple-600 text-white font-mono">
              SECONDARY SLITTER PLAN
            </span>
            <span className="text-sm font-bold tracking-tight">{plan.plan_number}</span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleDownloadExcel}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center space-x-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Plan</span>
            </button>
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
                G-PAK BOPP FILM DIVISION · SECONDARY SLITTER OPERATIONS
              </div>
              <h1 className="text-2xl font-black tracking-tight text-slate-950 mt-1">
                SECONDARY SLITTER PRODUCTION SCHEDULE
              </h1>
              <p className="text-xs text-slate-600 font-mono">
                Document Ref: APS/QR/SS/01 · Machine: SECONDARY SLITTER
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
                  {(() => {
                    const consolidated = (plan.orders_covered || []).reduce((acc, o) => {
                      const key = `${o.sales_order}__${o.item_number}__${o.customer}__${o.width_mm}__${o.length_m}`;
                      const existing = acc.find(item => item.key === key);
                      if (!existing) {
                        acc.push({
                          ...o,
                          key,
                        });
                      } else {
                        existing.ups += o.ups;
                        existing.planned_reels += o.planned_reels;
                        existing.planned_weight_kg = Number(((existing.planned_weight_kg || 0) + (o.planned_weight_kg || 0)).toFixed(2));
                        existing.remaining_after_kg = Math.min(existing.remaining_after_kg, o.remaining_after_kg);
                        existing.is_closed = existing.is_closed || o.is_closed;
                      }
                      return acc;
                    }, [] as Array<typeof plan.orders_covered[0] & { key: string }>);

                    return consolidated.map((o) => (
                      <tr key={o.key}>
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{o.sales_order}-{o.item_number}</td>
                        <td className="py-2.5 px-4 font-medium text-slate-800">{o.customer}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold">{o.width_mm} mm</td>
                        <td className="py-2.5 px-3 text-right font-mono">{(o.length_m ?? 0).toLocaleString()} m</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold">{o.ups}</td>
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
                    ));
                  })()}
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
