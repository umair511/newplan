import React, { useState } from 'react';
import { SlitterPlan, PlanningRun, UserProfile, VA05Order } from '../types';
import { exportSinglePlanToExcel, exportCompleteRunToExcel, downloadExcelBuffer } from '../services/excelExporter';
import { 
  FileText, 
  Download, 
  Search, 
  Filter, 
  CheckCircle2, 
  Clock, 
  Play, 
  Eye, 
  Layers, 
  Sparkles,
  Scissors,
  Trash2
} from 'lucide-react';

interface PlanningRunsListProps {
  plans: SlitterPlan[];
  planningRuns: PlanningRun[];
  orders: VA05Order[];
  currentUser: UserProfile;
  onOpenPlan: (plan: SlitterPlan) => void;
  onNewPlanRun: () => void;
  onDeletePlan?: (planId: string) => void;
  onDeleteAllPlans?: () => void;
  onDeleteRun?: (runId: string) => void;
  onDeleteAllRuns?: () => void;
}

export const PlanningRunsList: React.FC<PlanningRunsListProps> = ({
  plans,
  planningRuns,
  orders,
  currentUser,
  onOpenPlan,
  onNewPlanRun,
  onDeletePlan,
  onDeleteAllPlans,
  onDeleteRun,
  onDeleteAllRuns,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'PLANS' | 'RUNS'>('PLANS');
  const [searchQuery, setSearchQuery] = useState('');
  const [filmFilter, setFilmFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    actionLabel: string;
    onConfirm: () => void;
  } | null>(null);

  const distinctFilms = Array.from(new Set(plans.map(p => p.film))).sort();

  const filteredPlans = plans.filter(p => {
    if (filmFilter !== 'ALL' && p.film !== filmFilter) return false;
    if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        p.plan_number.toLowerCase().includes(q) ||
        p.film.toLowerCase().includes(q) ||
        p.planning_run_id.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const filteredRuns = planningRuns.filter(r => {
    if (filmFilter !== 'ALL' && r.film !== filmFilter) return false;
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return r.run_number.toLowerCase().includes(q) || r.film.toLowerCase().includes(q);
    }
    return true;
  });

  const handleDownloadPlanExcel = (plan: SlitterPlan, e: React.MouseEvent) => {
    e.stopPropagation();
    const buffer = exportSinglePlanToExcel(plan);
    downloadExcelBuffer(buffer, `Plan_${plan.plan_number}.xlsx`);
  };

  const handleDownloadRunExcel = (run: PlanningRun, e: React.MouseEvent) => {
    e.stopPropagation();
    const runPlans = plans.filter(p => p.planning_run_id === run.run_number || p.planning_run_id === run.id);
    const buffer = exportCompleteRunToExcel(run, runPlans, orders);
    downloadExcelBuffer(buffer, `All_Plans_${run.run_number}_${runPlans.length}plans.xlsx`);
  };

  const handleDeleteSinglePlan = (plan: SlitterPlan, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDeletePlan) return;
    setDeleteConfirmModal({
      isOpen: true,
      title: 'Delete Primary Slitter Plan',
      message: `Are you sure you want to delete plan ${plan.plan_number}? This action cannot be undone.`,
      actionLabel: 'Delete Plan',
      onConfirm: () => {
        onDeletePlan(plan.id);
        setDeleteConfirmModal(null);
      }
    });
  };

  const handleDeleteSingleRun = (run: PlanningRun, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDeleteRun) return;
    setDeleteConfirmModal({
      isOpen: true,
      title: 'Delete Primary Planning Run',
      message: `Are you sure you want to delete run ${run.run_number}? This action cannot be undone.`,
      actionLabel: 'Delete Run',
      onConfirm: () => {
        onDeleteRun(run.id);
        setDeleteConfirmModal(null);
      }
    });
  };

  const handleDeleteAllCurrent = () => {
    if (activeSubTab === 'PLANS') {
      if (!onDeleteAllPlans) return;
      setDeleteConfirmModal({
        isOpen: true,
        title: 'Delete All Primary Slitter Plans',
        message: `Are you sure you want to delete all ${plans.length} primary slitter plans?`,
        actionLabel: `Delete All (${plans.length}) Plans`,
        onConfirm: () => {
          onDeleteAllPlans();
          setDeleteConfirmModal(null);
        }
      });
    } else {
      if (!onDeleteAllRuns) return;
      setDeleteConfirmModal({
        isOpen: true,
        title: 'Delete All Primary Planning Runs',
        message: `Are you sure you want to delete all ${planningRuns.length} planning runs?`,
        actionLabel: `Delete All (${planningRuns.length}) Runs`,
        onConfirm: () => {
          onDeleteAllRuns();
          setDeleteConfirmModal(null);
        }
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <FileText className="w-5 h-5 text-emerald-600" />
            <span>Primary Slitter Production Plans & Runs</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Review, approve, and download production-ready slitting cutting schedules (SRS Sections 38 & 39).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Sub Tab Switcher */}
          <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
            <button
              onClick={() => setActiveSubTab('PLANS')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-all ${
                activeSubTab === 'PLANS' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Plans ({plans.length})
            </button>
            <button
              onClick={() => setActiveSubTab('RUNS')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-all ${
                activeSubTab === 'RUNS' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Planning Runs ({planningRuns.length})
            </button>
          </div>

          {/* Delete All Button for current subtab */}
          {((activeSubTab === 'PLANS' && plans.length > 0 && onDeleteAllPlans) ||
            (activeSubTab === 'RUNS' && planningRuns.length > 0 && onDeleteAllRuns)) && (
            <button
              onClick={handleDeleteAllCurrent}
              className="flex items-center space-x-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-600" />
              <span>
                Delete All {activeSubTab === 'PLANS' ? `Plans (${plans.length})` : `Runs (${planningRuns.length})`}
              </span>
            </button>
          )}

          <button
            onClick={onNewPlanRun}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>New Plan Run</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Plan No, Run ID, or Film..."
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-50/50"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center space-x-1 bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200">
              <span className="text-slate-500 font-medium">Film:</span>
              <select
                value={filmFilter}
                onChange={(e) => setFilmFilter(e.target.value)}
                className="bg-transparent font-semibold text-slate-800 focus:outline-none cursor-pointer"
              >
                <option value="ALL">All Films</option>
                {distinctFilms.map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center space-x-1 bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200">
              <span className="text-slate-500 font-medium">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-transparent font-semibold text-slate-800 focus:outline-none cursor-pointer"
              >
                <option value="ALL">All Statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="APPROVED">Approved</option>
                <option value="IN_PRODUCTION">In Production</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </div>
          </div>
        </div>

        {/* Content Table (Plans or Runs) */}
        {activeSubTab === 'PLANS' ? (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Plan Number</th>
                  <th className="py-2.5 px-3">Film</th>
                  <th className="py-2.5 px-3 text-center">UPS</th>
                  <th className="py-2.5 px-3 text-right">Slit Width</th>
                  <th className="py-2.5 px-3 text-right">Trim (mm)</th>
                  <th className="py-2.5 px-3 text-right">Length (m)</th>
                  <th className="py-2.5 px-3 text-center">Reps</th>
                  <th className="py-2.5 px-3 text-right">Planned Qty</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {filteredPlans.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-10 text-center font-sans text-slate-400">
                      No slitter plans generated yet. Click "New Plan Run" to start.
                    </td>
                  </tr>
                ) : (
                  filteredPlans.map(plan => (
                    <tr
                      key={plan.id}
                      onClick={() => onOpenPlan(plan)}
                      className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-3 font-bold text-slate-900">{plan.plan_number}</td>
                      <td className="py-3 px-3 font-semibold text-slate-800">{plan.film}</td>
                      <td className="py-3 px-3 text-center text-slate-700">{plan.ups} / 16</td>
                      <td className="py-3 px-3 text-right font-bold text-slate-900">{plan.total_slit_width_mm} mm</td>
                      <td className="py-3 px-3 text-right font-bold text-emerald-700">{plan.trim_mm} mm</td>
                      <td className="py-3 px-3 text-right text-slate-600">{(plan.length_m ?? 0).toLocaleString()}</td>
                      <td className="py-3 px-3 text-center font-bold text-slate-800">{plan.repetitions}</td>
                      <td className="py-3 px-3 text-right font-bold text-emerald-900">
                        {(plan.planned_quantity_kg ?? 0).toLocaleString()} kg
                      </td>
                      <td className="py-3 px-3 font-sans">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          plan.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' :
                          plan.status === 'IN_PRODUCTION' ? 'bg-blue-100 text-blue-800' :
                          plan.status === 'COMPLETED' ? 'bg-slate-100 text-slate-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {plan.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-sans">
                        <div className="flex items-center justify-end space-x-1.5">
                          <button
                            onClick={(e) => handleDownloadPlanExcel(plan, e)}
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-600 transition-colors"
                            title="Download Excel"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onOpenPlan(plan)}
                            className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 rounded border border-slate-200 transition-colors flex items-center space-x-1"
                          >
                            <Eye className="w-3 h-3" />
                            <span>View</span>
                          </button>
                          {onDeletePlan && (
                            <button
                              onClick={(e) => handleDeleteSinglePlan(plan, e)}
                              className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                              title={`Delete Plan ${plan.plan_number}`}
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
        ) : (
          /* Planning Runs Table */
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Run Number</th>
                  <th className="py-2.5 px-3">Film</th>
                  <th className="py-2.5 px-3 text-right">Target (kg)</th>
                  <th className="py-2.5 px-3 text-right">Planned (kg)</th>
                  <th className="py-2.5 px-3 text-center">Plans</th>
                  <th className="py-2.5 px-3 text-center">Closed Orders</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Created By</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {filteredRuns.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-10 text-center font-sans text-slate-400">
                      No planning runs found.
                    </td>
                  </tr>
                ) : (
                  filteredRuns.map(run => (
                    <tr key={run.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-3 font-bold text-slate-900">{run.run_number}</td>
                      <td className="py-3 px-3 font-semibold text-slate-800">{run.film}</td>
                      <td className="py-3 px-3 text-right text-slate-600">{(run.target_quantity_kg ?? 0).toLocaleString()}</td>
                      <td className="py-3 px-3 text-right font-bold text-emerald-800">{(run.planned_quantity_kg ?? 0).toLocaleString()}</td>
                      <td className="py-3 px-3 text-center font-bold text-slate-800">{run.plans_count}</td>
                      <td className="py-3 px-3 text-center text-emerald-700 font-bold">{run.orders_closed_count}</td>
                      <td className="py-3 px-3 font-sans">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                          {run.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-sans text-slate-600">{run.created_by}</td>
                      <td className="py-3 px-3 text-right font-sans">
                        <div className="flex items-center justify-end space-x-1.5">
                          <button
                            onClick={(e) => handleDownloadRunExcel(run, e)}
                            className="px-2.5 py-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded transition-colors flex items-center space-x-1"
                          >
                            <Download className="w-3 h-3" />
                            <span>Download All (.xlsx)</span>
                          </button>
                          {onDeleteRun && (
                            <button
                              onClick={(e) => handleDeleteSingleRun(run, e)}
                              className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                              title={`Delete Run ${run.run_number}`}
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
        )}
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
