import React, { useState } from 'react';
import { VA05Order, SlitterPlan, PlanningRun } from '../types';
import { BarChart3, TrendingUp, Layers, CheckCircle2, Scissors, Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { isPS01Order } from '../services/optimizer/deckleOptimizer';

interface ReportsViewProps {
  orders: VA05Order[];
  plans: SlitterPlan[];
  planningRuns: PlanningRun[];
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  orders,
  plans,
  planningRuns,
}) => {
  const [activeReport, setActiveReport] = useState<'FILM_DEMAND' | 'RUN_EFFICIENCY' | 'ORDER_BALANCES' | 'TRIM_ANALYSIS'>('FILM_DEMAND');

  const psOrders = orders.filter(isPS01Order);
  const distinctFilms = Array.from(new Set(psOrders.map(o => o.film))).sort();

  // Film-wise aggregation (PS01 only: width >= 355 mm, non-MZ)
  const filmReports = distinctFilms.map(film => {
    const filmOrders = psOrders.filter(o => o.film === film);
    const openOrders = filmOrders.filter(o => o.remaining_qty > 0);
    const completedOrders = filmOrders.filter(o => o.status === 'COMPLETED');
    const remainingKg = openOrders.reduce((sum, o) => sum + o.remaining_qty, 0);
    const originalKg = filmOrders.reduce((sum, o) => sum + o.balance_qty, 0);
    const producedKg = filmOrders.reduce((sum, o) => sum + o.produced_qty, 0);

    return {
      film,
      totalOrders: filmOrders.length,
      openOrders: openOrders.length,
      completedOrders: completedOrders.length,
      originalKg,
      producedKg,
      remainingKg,
      fulfillmentRate: originalKg > 0 ? (producedKg / originalKg) * 100 : 0,
    };
  });

  const exportCurrentReport = () => {
    let exportData: any[] = [];
    let sheetName = 'Report';

    if (activeReport === 'FILM_DEMAND') {
      sheetName = 'Film Demand';
      exportData = filmReports.map(f => ({
        'Film Grade': f.film,
        'Total Orders': f.totalOrders,
        'Open Orders': f.openOrders,
        'Completed Orders': f.completedOrders,
        'Original Demand (kg)': f.originalKg,
        'Produced (kg)': f.producedKg,
        'Remaining Demand (kg)': f.remainingKg,
        'Fulfillment %': `${f.fulfillmentRate.toFixed(1)}%`,
      }));
    } else if (activeReport === 'ORDER_BALANCES') {
      sheetName = 'Order Balances';
      exportData = psOrders.map(o => ({
        'SO#': o.sales_order,
        'Item': o.item_number,
        'Customer': o.customer,
        'Film': o.film,
        'Width (mm)': o.width_mm,
        'Length (m)': o.length_m,
        'Original Qty (kg)': o.balance_qty,
        'Produced Qty (kg)': o.produced_qty,
        'Remaining Qty (kg)': o.remaining_qty,
        'Status': o.status,
      }));
    } else if (activeReport === 'RUN_EFFICIENCY') {
      sheetName = 'Planning Run Efficiency';
      exportData = planningRuns.map(r => ({
        'Run Number': r.run_number,
        'Film': r.film,
        'Target Qty (kg)': r.target_quantity_kg,
        'Planned Qty (kg)': r.planned_quantity_kg,
        'Remaining Backlog (kg)': r.remaining_quantity_kg,
        'Plans Count': r.plans_count,
        'Closed Orders': r.orders_closed_count,
        'Partial Orders': r.orders_partial_count,
        'Status': r.status,
        'Stop Reason': r.stop_reason,
      }));
    } else {
      sheetName = 'Trim Analysis';
      exportData = plans.map(p => ({
        'Plan Number': p.plan_number,
        'Film': p.film,
        'Total Deckle (mm)': p.deckle_mm,
        'Used Slit Width (mm)': p.total_slit_width_mm,
        'Trim (mm)': p.trim_mm,
        'Waste %': `${p.waste_percent}%`,
        'Active UPS': p.ups,
        'Total Output (kg)': p.planned_quantity_kg,
      }));
    }

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `Slitter_Report_${sheetName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <BarChart3 className="w-5 h-5 text-emerald-600" />
            <span>Production Planning & Demand Reports</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Operational analytics based on SRS Section 88 requirements.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={exportCurrentReport}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg shadow-xs transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Report (.xlsx)</span>
          </button>
        </div>
      </div>

      {/* Report Sub-Tabs */}
      <div className="flex space-x-2 border-b border-slate-200 pb-2 text-xs font-semibold">
        <button
          onClick={() => setActiveReport('FILM_DEMAND')}
          className={`px-4 py-2 rounded-lg transition-all ${
            activeReport === 'FILM_DEMAND'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Film-wise Pending Demand
        </button>
        <button
          onClick={() => setActiveReport('RUN_EFFICIENCY')}
          className={`px-4 py-2 rounded-lg transition-all ${
            activeReport === 'RUN_EFFICIENCY'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Planning Run Efficiency
        </button>
        <button
          onClick={() => setActiveReport('ORDER_BALANCES')}
          className={`px-4 py-2 rounded-lg transition-all ${
            activeReport === 'ORDER_BALANCES'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Order Balances
        </button>
        <button
          onClick={() => setActiveReport('TRIM_ANALYSIS')}
          className={`px-4 py-2 rounded-lg transition-all ${
            activeReport === 'TRIM_ANALYSIS'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Trim & Waste Metrics
        </button>
      </div>

      {/* Report Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
        {activeReport === 'FILM_DEMAND' && (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Film Grade</th>
                  <th className="py-2.5 px-3 text-center">Total Orders</th>
                  <th className="py-2.5 px-3 text-center">Open Orders</th>
                  <th className="py-2.5 px-3 text-center">Completed</th>
                  <th className="py-2.5 px-3 text-right">Original Demand (kg)</th>
                  <th className="py-2.5 px-3 text-right">Produced (kg)</th>
                  <th className="py-2.5 px-3 text-right">Remaining Demand (kg)</th>
                  <th className="py-2.5 px-3 text-right">Fulfillment %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {filmReports.map(f => (
                  <tr key={f.film} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-bold text-slate-900 font-sans">{f.film}</td>
                    <td className="py-2.5 px-3 text-center text-slate-700">{f.totalOrders}</td>
                    <td className="py-2.5 px-3 text-center text-amber-800 font-bold">{f.openOrders}</td>
                    <td className="py-2.5 px-3 text-center text-emerald-800 font-bold">{f.completedOrders}</td>
                    <td className="py-2.5 px-3 text-right text-slate-600">{(f.originalKg ?? 0).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-700 font-semibold">{(f.producedKg ?? 0).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right text-slate-900 font-bold">{(f.remainingKg ?? 0).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right font-sans font-bold text-slate-800">
                      {f.fulfillmentRate.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeReport === 'ORDER_BALANCES' && (
          <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[500px]">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-700 font-bold sticky top-0 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">SO# / Item</th>
                  <th className="py-2.5 px-3">Customer</th>
                  <th className="py-2.5 px-3">Film</th>
                  <th className="py-2.5 px-3 text-right">Width (mm)</th>
                  <th className="py-2.5 px-3 text-right">Length (m)</th>
                  <th className="py-2.5 px-3 text-right">Original Qty (kg)</th>
                  <th className="py-2.5 px-3 text-right">Produced (kg)</th>
                  <th className="py-2.5 px-3 text-right">Remaining (kg)</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {psOrders.map(o => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-bold text-slate-900">{o.sales_order} #{o.item_number}</td>
                    <td className="py-2 px-3 font-sans font-medium text-slate-800 truncate max-w-[200px]">{o.customer}</td>
                    <td className="py-2 px-3 font-sans">{o.film}</td>
                    <td className="py-2 px-3 text-right font-bold text-slate-900">{o.width_mm}</td>
                    <td className="py-2 px-3 text-right text-slate-600">{o.length_m}</td>
                    <td className="py-2 px-3 text-right text-slate-500">{(o.balance_qty ?? 0).toLocaleString()}</td>
                    <td className="py-2 px-3 text-right text-emerald-700 font-semibold">{(o.produced_qty ?? 0).toLocaleString()}</td>
                    <td className="py-2 px-3 text-right font-bold text-slate-900">{(o.remaining_qty ?? 0).toLocaleString()}</td>
                    <td className="py-2 px-3 font-sans">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        o.status === 'COMPLETED' ? 'bg-slate-100 text-slate-700' :
                        o.status === 'PARTIALLY_FULFILLED' ? 'bg-blue-100 text-blue-800' :
                        'bg-amber-100 text-amber-800'
                      }`}>
                        {o.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeReport === 'RUN_EFFICIENCY' && (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Run Number</th>
                  <th className="py-2.5 px-3">Film</th>
                  <th className="py-2.5 px-3 text-right">Target (kg)</th>
                  <th className="py-2.5 px-3 text-right">Planned (kg)</th>
                  <th className="py-2.5 px-3 text-right">Remaining (kg)</th>
                  <th className="py-2.5 px-3 text-center">Plans</th>
                  <th className="py-2.5 px-3 text-center">Closed Orders</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Stop Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {planningRuns.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center font-sans text-slate-400">
                      No planning runs recorded yet.
                    </td>
                  </tr>
                ) : (
                  planningRuns.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-bold text-slate-900">{r.run_number}</td>
                      <td className="py-2.5 px-3 font-sans font-semibold text-slate-800">{r.film}</td>
                      <td className="py-2.5 px-3 text-right text-slate-600">{(r.target_quantity_kg ?? 0).toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-emerald-800">{(r.planned_quantity_kg ?? 0).toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right text-slate-500">{(r.remaining_quantity_kg ?? 0).toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-center font-bold text-slate-900">{r.plans_count}</td>
                      <td className="py-2.5 px-3 text-center font-bold text-emerald-700">{r.orders_closed_count}</td>
                      <td className="py-2.5 px-3 font-sans font-bold text-[10px] text-slate-700">{r.status}</td>
                      <td className="py-2.5 px-3 font-sans text-[11px] text-slate-500 max-w-[240px] truncate">{r.stop_reason}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeReport === 'TRIM_ANALYSIS' && (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Plan Number</th>
                  <th className="py-2.5 px-3">Film</th>
                  <th className="py-2.5 px-3 text-right">Deckle (mm)</th>
                  <th className="py-2.5 px-3 text-right">Slit Width (mm)</th>
                  <th className="py-2.5 px-3 text-right">Trim (mm)</th>
                  <th className="py-2.5 px-3 text-right">Waste %</th>
                  <th className="py-2.5 px-3 text-center">UPS</th>
                  <th className="py-2.5 px-3 text-right">Output (kg)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {plans.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center font-sans text-slate-400">
                      No plan trim data available yet.
                    </td>
                  </tr>
                ) : (
                  plans.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-bold text-slate-900">{p.plan_number}</td>
                      <td className="py-2.5 px-3 font-sans">{p.film}</td>
                      <td className="py-2.5 px-3 text-right text-slate-600">{p.deckle_mm}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900">{p.total_slit_width_mm}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-emerald-800">{p.trim_mm}</td>
                      <td className="py-2.5 px-3 text-right text-amber-800 font-semibold">{p.waste_percent}%</td>
                      <td className="py-2.5 px-3 text-center font-bold text-slate-900">{p.ups}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-emerald-900">{(p.planned_quantity_kg ?? 0).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
