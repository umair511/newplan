import React from 'react';
import { VA05Order, SlitterPlan, PlanningRun } from '../types';
import { 
  Layers, 
  CheckCircle2, 
  TrendingUp, 
  Play, 
  UploadCloud, 
  ArrowRight,
  Scissors,
  FileText
} from 'lucide-react';
import { isPS01Order } from '../services/optimizer/deckleOptimizer';

interface DashboardProps {
  orders: VA05Order[];
  plans: SlitterPlan[];
  planningRuns: PlanningRun[];
  onNavigate: (tab: string, filterFilm?: string) => void;
  onOpenPlan: (plan: SlitterPlan) => void;
  onOpenTests: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  orders,
  plans,
  planningRuns,
  onNavigate,
  onOpenPlan,
}) => {
  // Metric Calculations (Strictly PS01-eligible orders: non-MZ and slit width >= 355 mm)
  const ps01Orders = orders.filter(isPS01Order);
  const pendingOrders = ps01Orders.filter(o => o.remaining_qty > 0);
  const pendingQtyKg = pendingOrders.reduce((sum, o) => sum + o.remaining_qty, 0);
  const totalOriginalKg = ps01Orders.reduce((sum, o) => sum + (o.balance_qty || o.ordered_qty), 0);
  const totalProducedKg = ps01Orders.reduce((sum, o) => sum + o.produced_qty, 0);

  const distinctFilms = Array.from(new Set(ps01Orders.map(o => o.film))).sort();
  
  const draftPlans = plans.filter(p => p.status === 'DRAFT');
  const approvedPlans = plans.filter(p => p.status === 'APPROVED');
  const inProdPlans = plans.filter(p => p.status === 'IN_PRODUCTION');
  const completedPlans = plans.filter(p => p.status === 'COMPLETED');

  // Film-wise Breakdown (PS01-eligible films only)
  const filmSummaries = distinctFilms.map(film => {
    const filmOrders = ps01Orders.filter(o => o.film === film);
    const openOrders = filmOrders.filter(o => o.remaining_qty > 0);
    const remKg = openOrders.reduce((sum, o) => sum + o.remaining_qty, 0);
    const priorityCount = openOrders.filter(o => o.priority).length;
    const filmPlans = plans.filter(p => p.film === film);

    return {
      film,
      totalOrders: filmOrders.length,
      openOrders: openOrders.length,
      remainingKg: remKg,
      priorityCount,
      plansCount: filmPlans.length,
    };
  }).sort((a, b) => b.remainingKg - a.remainingKg);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-base font-bold text-slate-900 tracking-tight">Primary Slitter (PS01) Overview</h1>
            <span className="text-[10px] font-mono px-2 py-0.5 font-medium rounded-md bg-slate-100 text-slate-600 border border-slate-200">
              10,400mm Deckle
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Deterministic deckle optimization, pending sales order demand, and cutting schedules.
          </p>
        </div>

        <div className="flex items-center space-x-2 w-full md:w-auto">
          <button
            onClick={() => onNavigate('orders')}
            className="flex-1 md:flex-initial flex items-center justify-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <UploadCloud className="w-3.5 h-3.5 text-slate-500" />
            <span>Master Orders</span>
          </button>
          <button
            onClick={() => onNavigate('generator', 'TNO20')}
            className="flex-1 md:flex-initial flex items-center justify-center space-x-1.5 px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-xs transition-all cursor-pointer"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Plan TNO20</span>
          </button>
        </div>
      </div>

      {/* Main KPI Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div
          onClick={() => onNavigate('ps-films')}
          className="bg-white border border-slate-200/80 hover:border-emerald-500 hover:shadow-md rounded-xl p-4 shadow-xs cursor-pointer transition-all group"
          title="Click to view PS01 Film Demand Breakdown"
        >
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-medium uppercase tracking-wider group-hover:text-emerald-700 transition-colors">
            <span className="flex items-center space-x-1">
              <span>Pending Demand</span>
              <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-600" />
            </span>
            <Layers className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 transition-colors" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1 font-mono group-hover:text-emerald-950 transition-colors">
            {pendingQtyKg.toLocaleString()} <span className="text-xs font-normal text-slate-400">kg</span>
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <p className="text-[11px] text-slate-500">{pendingOrders.length} open items (PS01)</p>
            <span className="text-[10px] text-emerald-700 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">View Demand &rarr;</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-medium uppercase tracking-wider">
            <span>Fulfillment Rate</span>
            <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1 font-mono">
            {totalOriginalKg > 0 ? ((totalProducedKg / totalOriginalKg) * 100).toFixed(1) : '0'}%
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">{totalProducedKg.toLocaleString()} kg done</p>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-medium uppercase tracking-wider">
            <span>Film Grades</span>
            <Layers className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1 font-mono">
            {distinctFilms.length} <span className="text-xs font-normal text-slate-400">active</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {distinctFilms.slice(0, 2).join(', ')}{distinctFilms.length > 2 ? ', etc.' : ''}
          </p>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-medium uppercase tracking-wider">
            <span>Planning Runs</span>
            <Play className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1 font-mono">
            {planningRuns.length}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">{plans.length} total schedules</p>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-medium uppercase tracking-wider">
            <span>Plans Status</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-base font-bold text-slate-900 mt-1 font-mono flex items-center space-x-1.5">
            <span className="text-emerald-700 font-semibold">{approvedPlans.length} Appr</span>
            <span className="text-slate-300">/</span>
            <span className="text-slate-600 font-semibold">{draftPlans.length} Draft</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">{inProdPlans.length} in prod · {completedPlans.length} done</p>
        </div>
      </div>

      {/* Film-wise Demand Summary */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 tracking-tight">Film Demand Breakdown</h2>
            <p className="text-xs text-slate-500">Organized pending customer orders available for slitter planning (PS01 Eligible)</p>
          </div>
          <button
            onClick={() => onNavigate('ps-films')}
            className="text-xs font-semibold text-slate-700 hover:text-slate-900 flex items-center space-x-1 cursor-pointer"
            title="View complete PS01 film demand breakdown"
          >
            <span>All PS01 Films</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filmSummaries.slice(0, 6).map((item) => (
            <div
              key={item.film}
              className="border border-slate-200/80 hover:border-slate-300 rounded-lg p-4 bg-white shadow-xs transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-base text-slate-900 font-mono tracking-tight">{item.film}</span>
                  {item.priorityCount > 0 ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                      {item.priorityCount} Priority
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono text-slate-400 bg-slate-50">
                      Standard
                    </span>
                  )}
                </div>
                <div className="mt-3 space-y-1.5 bg-slate-50/70 p-3 rounded-lg border border-slate-100">
                  <div className="flex justify-between text-xs text-slate-600">
                    <span className="text-slate-500">Pending Quantity:</span>
                    <span className="font-bold text-slate-900 font-mono">{item.remainingKg.toLocaleString()} kg</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-600">
                    <span className="text-slate-500">Open Orders:</span>
                    <span className="font-medium text-slate-800 font-mono">{item.openOrders} / {item.totalOrders}</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-600">
                    <span className="text-slate-500">Generated Plans:</span>
                    <span className="font-medium text-slate-800 font-mono">{item.plansCount}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11px] font-mono text-slate-400">10,400mm PS01</span>
                <button
                  onClick={() => onNavigate('generator', item.film)}
                  className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors flex items-center space-x-1 cursor-pointer"
                >
                  <span>Plan Film</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Section: Recent Generated Primary Slitter Plans */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 tracking-tight">Generated Primary Slitter Plans</h2>
            <p className="text-xs text-slate-500">Authoritative standard cutting schedules (Doc Ref: QR/PL/01)</p>
          </div>
          <button
            onClick={() => onNavigate('plans')}
            className="text-xs font-semibold text-slate-700 hover:text-slate-900 flex items-center space-x-1 cursor-pointer"
          >
            <span>View All Plans</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {plans.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-slate-200 rounded-lg">
            <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs font-semibold text-slate-700">No planning runs generated yet</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-0.5">
              Go to the Planning Studio to generate deterministic slitting plans against pending Planning Sheet demand.
            </p>
            <button
              onClick={() => onNavigate('generator', 'TNO20')}
              className="mt-3 px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer"
            >
              Start First Plan (TNO20)
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200/80 rounded-lg">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50/90 text-slate-600 font-semibold text-[11px] border-b border-slate-200/80">
                <tr>
                  <th className="py-2.5 px-3">Plan No.</th>
                  <th className="py-2.5 px-3">Film</th>
                  <th className="py-2.5 px-3">UPS</th>
                  <th className="py-2.5 px-3">Slit Width</th>
                  <th className="py-2.5 px-3">Trim</th>
                  <th className="py-2.5 px-3">Planned Qty</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {plans.slice(0, 8).map((plan) => (
                  <tr key={plan.id} className="hover:bg-slate-50/70 transition-colors font-sans">
                    <td className="py-2 px-3 font-mono font-medium text-slate-900">{plan.plan_number}</td>
                    <td className="py-2 px-3 font-semibold text-slate-800">{plan.film}</td>
                    <td className="py-2 px-3 text-slate-600 font-mono">{plan.ups} Arms</td>
                    <td className="py-2 px-3 font-mono text-slate-800">{plan.total_slit_width_mm} mm</td>
                    <td className="py-2 px-3 font-mono text-emerald-700 font-medium">{plan.trim_mm} mm</td>
                    <td className="py-2 px-3 font-semibold font-mono text-slate-900">{plan.planned_quantity_kg.toLocaleString()} kg</td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
                        plan.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                        plan.status === 'IN_PRODUCTION' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                        plan.status === 'COMPLETED' ? 'bg-slate-100 text-slate-700 border border-slate-200' :
                        'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}>
                        {plan.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => onOpenPlan(plan)}
                        className="px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 rounded border border-slate-200 shadow-xs transition-colors cursor-pointer"
                      >
                        View Sheet
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
