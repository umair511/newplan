import React, { useState } from 'react';
import { 
  FileText, 
  Search, 
  Filter, 
  Eye, 
  Download, 
  CheckCircle2, 
  Cpu, 
  Calendar,
  Layers,
  ArrowRight,
  Trash2,
  Sparkles,
  Scissors,
  Activity
} from 'lucide-react';
import { MetallizerPlan } from '../../types/metallizer';
import { exportMSLPlansToExcelStyled, downloadExcelBuffer } from '../../services/excelExporter';

interface MetallizerPlansListProps {
  plans: MetallizerPlan[];
  onOpenPlan: (plan: MetallizerPlan) => void;
  onNewPlan: () => void;
  onDeletePlan?: (planId: string) => void;
  onDeleteAllPlans?: () => void;
}

export const MetallizerPlansList: React.FC<MetallizerPlansListProps> = ({
  plans,
  onOpenPlan,
  onNewPlan,
  onDeletePlan,
  onDeleteAllPlans,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filmFilter, setFilmFilter] = useState('ALL');
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    actionLabel: string;
    onConfirm: () => void;
  } | null>(null);

  const availableFilms = Array.from(new Set(plans.map(p => p.film))).sort();

  const filteredPlans = plans.filter(p => {
    if (filmFilter !== 'ALL' && p.film !== filmFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        p.plan_number.toLowerCase().includes(q) ||
        p.jumbo_roll_id.toLowerCase().includes(q) ||
        p.film.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleDownloadAll = async () => {
    const list = filteredPlans.length > 0 ? filteredPlans : plans;
    if (list.length === 0) return;
    const buf = await exportMSLPlansToExcelStyled(list);
    downloadExcelBuffer(buf, `All_MSL_Plans_${list.length}plans.xlsx`);
  };


  const totalPlannedKg = filteredPlans.reduce((sum, p) => sum + p.planned_quantity_kg, 0);
  const dynamicCount = plans.filter(p => p.is_dynamic_continuous_run || p.created_by?.includes('Dynamic')).length;
  const residualCount = plans.filter(p => p.is_residual_sweep || p.created_by?.includes('Residual')).length;
  const segmentedCount = plans.filter(p => p.is_segmented && (p.segments?.length || 0) > 1).length;
  const transitionsCount = plans.reduce((sum, p) => sum + (p.transitions?.length || p.doff_events?.length || 0), 0);

  const handleDeleteSingle = (plan: MetallizerPlan) => {
    if (!onDeletePlan) return;
    setDeleteConfirmModal({
      isOpen: true,
      title: 'Delete Metallizer Plan',
      message: `Are you sure you want to delete plan ${plan.plan_number}? This action cannot be undone.`,
      actionLabel: 'Delete Plan',
      onConfirm: () => {
        onDeletePlan(plan.id);
        setDeleteConfirmModal(null);
      }
    });
  };

  return (
    <div className="space-y-6" id="msl-plans-list-view">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 text-xs font-bold rounded bg-purple-100 text-purple-800">
              METALLIZER SCHEDULES
            </span>
            <span className="text-xs text-slate-500 font-mono">Actual Jumbo Deckle Plans</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-1">Generated Metallizer Slitter Plans</h1>
          <p className="text-xs text-slate-500">
            Production schedules executed against consumable physical jumbo rolls
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {plans.length > 0 && (
            <button
              onClick={handleDownloadAll}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-all flex items-center space-x-1.5 border border-emerald-700"
              title="Download ALL MSL plans in one Excel — factory sample format, one sheet per plan"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download All Plans (.xlsx)</span>
            </button>
          )}
          {onDeleteAllPlans && plans.length > 0 && (
            <button
              onClick={() => {
                setDeleteConfirmModal({
                  isOpen: true,
                  title: 'Delete All Metallizer Plans',
                  message: `Are you sure you want to delete all ${plans.length} committed Metallizer slitter plans?`,
                  actionLabel: `Delete All (${plans.length})`,
                  onConfirm: () => {
                    onDeleteAllPlans();
                    setDeleteConfirmModal(null);
                  }
                });
              }}
              className="flex items-center space-x-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-600" />
              <span>Delete All ({plans.length})</span>
            </button>
          )}
          <button
            onClick={onNewPlan}
            className="flex items-center space-x-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <Cpu className="w-4 h-4" />
            <span>New Metallizer Run</span>
          </button>
        </div>
      </div>

      {/* Two-Pass Hybrid Intelligence Summary Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-slate-500 block">Total MSL Plans</span>
          <div className="text-xl font-black font-mono text-purple-900 mt-0.5">{plans.length}</div>
          <span className="text-[10px] text-slate-400">Physical setups</span>
        </div>
        <div className="bg-purple-50/50 border border-purple-200 rounded-xl p-3.5 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-purple-700 block flex items-center space-x-1">
            <Sparkles className="w-3 h-3 text-purple-600 inline mr-1" />
            <span>Dynamic Continuous</span>
          </span>
          <div className="text-xl font-black font-mono text-purple-900 mt-0.5">{dynamicCount}</div>
          <span className="text-[10px] text-purple-600 font-medium">Pass 1 chained runs</span>
        </div>
        <div className="bg-teal-50/50 border border-teal-200 rounded-xl p-3.5 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-teal-700 block flex items-center space-x-1">
            <Layers className="w-3 h-3 text-teal-600 inline mr-1" />
            <span>Residual Sweep</span>
          </span>
          <div className="text-xl font-black font-mono text-teal-900 mt-0.5">{residualCount}</div>
          <span className="text-[10px] text-teal-600 font-medium">Pass 2 sweeps</span>
        </div>
        <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-3.5 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-blue-700 block flex items-center space-x-1">
            <Scissors className="w-3 h-3 text-blue-600 inline mr-1" />
            <span>Doff Transitions</span>
          </span>
          <div className="text-xl font-black font-mono text-blue-900 mt-0.5">{transitionsCount}</div>
          <span className="text-[10px] text-blue-600 font-medium">Arm shifts & continuations</span>
        </div>
        <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-3.5 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-amber-700 block">Consolidated Jumbos</span>
          <div className="text-xl font-black font-mono text-amber-900 mt-0.5">{segmentedCount}</div>
          <span className="text-[10px] text-amber-600 font-medium">Multi-pack jumbos</span>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Plan #, Roll ID, Grade..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold text-slate-500">Showing {filteredPlans.length} plans</span>
          <span>·</span>
          <span className="text-xs font-bold text-purple-700 font-mono">{(totalPlannedKg ?? 0).toLocaleString()} KG total</span>
        </div>
      </div>

      {/* Plans Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600 border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-3 px-3">Plan Number</th>
                <th className="py-3 px-3">Film Grade</th>
                <th className="py-3 px-3">Mother Jumbo Roll</th>
                <th className="py-3 px-3 text-right">Actual Deckle</th>
                <th className="py-3 px-3 text-right">UPS</th>
                <th className="py-3 px-3">Slit Sizes</th>
                <th className="py-3 px-3 text-right">Trim</th>
                <th className="py-3 px-3 text-right">Planned (KG)</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPlans.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    No Metallizer Slitter plans generated yet. Click "New Metallizer Run" to create one.
                  </td>
                </tr>
              ) : (
                filteredPlans.map(plan => (
                  <tr key={plan.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-mono font-bold text-purple-800 text-xs">
                        {plan.plan_number}
                      </div>
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        {(plan.is_dynamic_continuous_run || plan.created_by?.includes('Dynamic')) && (
                          <span className="px-1.5 py-0.5 text-[9px] font-black rounded bg-gradient-to-r from-purple-700 to-indigo-700 text-white leading-none">
                            DYNAMIC RUN
                          </span>
                        )}
                        {(plan.is_residual_sweep || plan.created_by?.includes('Residual')) && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-teal-100 text-teal-800 border border-teal-300 leading-none">
                            RESIDUAL SWEEP
                          </span>
                        )}
                        {plan.doff_events && plan.doff_events.length > 0 && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-blue-100 text-blue-800 leading-none">
                            {plan.doff_events[0].transition_type} Shift
                          </span>
                        )}
                        {plan.transitions && plan.transitions.length > 0 && (!plan.doff_events || plan.doff_events.length === 0) && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-blue-100 text-blue-800 leading-none">
                            {plan.transitions[0].shifted_arms.length}-Arm Shift
                          </span>
                        )}
                        {plan.segments && plan.segments.length > 1 && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-100 text-amber-800 border border-amber-300 leading-none">
                            {plan.segments.length} Packs
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 font-bold rounded bg-purple-50 text-purple-700 border border-purple-200">
                        {plan.film}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-900 font-bold">
                      {plan.jumbo_roll_id}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-black text-slate-900">
                      {plan.jumbo_width_mm} mm
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold">
                      <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {plan.ups} UPS
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-700">
                      {plan.finished_sizes.join(' + ')} mm
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-700">
                      {plan.trim_mm} mm ({plan.waste_percent}%)
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                      {(plan.planned_quantity_kg ?? 0).toLocaleString()} kg
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800">
                        {plan.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center justify-center space-x-1.5">
                        <button
                          onClick={() => onOpenPlan(plan)}
                          className="px-3 py-1 bg-slate-100 hover:bg-purple-600 hover:text-white text-slate-700 rounded text-xs font-semibold transition-colors cursor-pointer inline-flex items-center space-x-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Sheet</span>
                        </button>
                        {onDeletePlan && (
                          <button
                            onClick={() => handleDeleteSingle(plan)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                            title={`Delete plan ${plan.plan_number}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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
