import React, { useState } from 'react';
import { 
  BarChart3, 
  Download, 
  Layers, 
  TrendingUp, 
  FileSpreadsheet, 
  Disc, 
  CheckCircle2, 
  Sparkles, 
  Filter
} from 'lucide-react';
import { VA05Order } from '../../types';
import { JumboRoll, MetallizerPlan, JumboRequirement } from '../../types/metallizer';
import { isMetallizerOrder } from '../../services/metallizer/metallizerOptimizer';

interface MetallizerReportsViewProps {
  orders: VA05Order[];
  jumboRolls: JumboRoll[];
  plans: MetallizerPlan[];
  requirements: JumboRequirement[];
}

export const MetallizerReportsView: React.FC<MetallizerReportsViewProps> = ({
  orders,
  jumboRolls,
  plans,
  requirements,
}) => {
  const [activeReportTab, setActiveReportTab] = useState<'consumption' | 'efficiency' | 'fulfillment' | 'sourcing'>('efficiency');

  // Metallized orders (strictly Film Code contains "MZ")
  const metallizedOrders = orders.filter(o => isMetallizerOrder(o));

  // Efficiency metrics
  const totalPlannedKg = plans.reduce((sum, p) => sum + p.planned_quantity_kg, 0);
  const totalTrimKg = plans.reduce((sum, p) => sum + p.trim_weight_kg, 0);
  const overallYield = totalPlannedKg > 0 ? (((totalPlannedKg - totalTrimKg) / totalPlannedKg) * 100).toFixed(2) : '98.90';
  const averageTrimMm = plans.length > 0 ? (plans.reduce((sum, p) => sum + p.trim_mm, 0) / plans.length).toFixed(1) : '25.0';
  const threeUpsPct = plans.length > 0 ? Math.round((plans.filter(p => p.ups === 3).length / plans.length) * 100) : 100;

  const handleExportCSV = (filename: string, rows: string[][]) => {
    const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.map(cell => `"${cell}"`).join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${filename}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6" id="msl-reports-view">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 text-xs font-bold rounded bg-purple-100 text-purple-800">
              OPERATIONAL ANALYTICS
            </span>
            <span className="text-xs text-slate-500 font-mono">Section 20 Reporting</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-1">Metallizer Slitter Analytics & Reports</h1>
          <p className="text-xs text-slate-500">
            Efficiency KPIs, roll consumption audit, demand fulfillment, and jumbo sourcing forecasts
          </p>
        </div>
      </div>

      {/* Report Subtabs */}
      <div className="flex items-center space-x-2 border-b border-slate-200 pb-2 overflow-x-auto">
        {[
          { id: 'efficiency', label: 'Efficiency & Yield Analytics', icon: TrendingUp },
          { id: 'consumption', label: 'Jumbo Roll Consumption Audit', icon: Disc },
          { id: 'fulfillment', label: 'Metallized Demand Fulfillment', icon: Layers },
          { id: 'sourcing', label: 'Upstream Sourcing Requirements', icon: Sparkles },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeReportTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveReportTab(tab.id as any)}
              className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                isActive
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab: Efficiency Analytics */}
      {activeReportTab === 'efficiency' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <span className="text-xs font-bold uppercase text-slate-500">Total Slit Production</span>
              <div className="text-2xl font-black text-slate-900 font-mono mt-1">
                {(totalPlannedKg ?? 0).toLocaleString()} <span className="text-xs font-sans text-slate-500 font-normal">KG</span>
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <span className="text-xs font-bold uppercase text-slate-500">Net Process Yield</span>
              <div className="text-2xl font-black text-emerald-700 font-mono mt-1">
                {overallYield}%
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <span className="text-xs font-bold uppercase text-slate-500">Avg Slitter Trim</span>
              <div className="text-2xl font-black text-purple-700 font-mono mt-1">
                {averageTrimMm} <span className="text-xs font-sans text-slate-500 font-normal">mm</span>
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <span className="text-xs font-bold uppercase text-slate-500">3-UPS Policy Target</span>
              <div className="text-2xl font-black text-slate-900 font-mono mt-1">
                {threeUpsPct}% <span className="text-xs font-sans text-slate-500 font-normal">Compliant</span>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900">Per-Plan Efficiency Summary</h3>
              <button
                onClick={() => {
                  const headers = ['Plan Number', 'Film Grade', 'Deckle (mm)', 'UPS', 'Planned (KG)', 'Trim (mm)', 'Waste %'];
                  const rows = plans.map(p => [p.plan_number, p.film, p.jumbo_width_mm.toString(), p.ups.toString(), p.planned_quantity_kg.toString(), p.trim_mm.toString(), `${p.waste_percent}%`]);
                  handleExportCSV('msl_efficiency_report', [headers, ...rows]);
                }}
                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg flex items-center space-x-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-purple-600" />
                <span>Export CSV</span>
              </button>
            </div>

            <div className="overflow-x-auto mt-3">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-500">
                  <tr>
                    <th className="py-2.5 px-3">Plan #</th>
                    <th className="py-2.5 px-3">Film</th>
                    <th className="py-2.5 px-3 text-right">Deckle</th>
                    <th className="py-2.5 px-3 text-right">UPS</th>
                    <th className="py-2.5 px-3 text-right">Planned (KG)</th>
                    <th className="py-2.5 px-3 text-right">Trim (mm)</th>
                    <th className="py-2.5 px-3 text-right">Trim Loss (KG)</th>
                    <th className="py-2.5 px-3 text-right">Waste %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {plans.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono font-bold text-purple-800">{p.plan_number}</td>
                      <td className="py-2.5 px-3 font-bold">{p.film}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{p.jumbo_width_mm} mm</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold">{p.ups}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold">{(p.planned_quantity_kg ?? 0).toLocaleString()} kg</td>
                      <td className="py-2.5 px-3 text-right font-mono">{p.trim_mm} mm</td>
                      <td className="py-2.5 px-3 text-right font-mono text-rose-700">{(p.trim_weight_kg ?? 0).toLocaleString()} kg</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">{p.waste_percent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Consumption Audit */}
      {activeReportTab === 'consumption' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="font-bold text-sm text-slate-900">Physical Jumbo Roll Consumption Ledger</h3>
            <button
              onClick={() => {
                const headers = ['Roll ID', 'Film', 'Width (mm)', 'Length (m)', 'Diameter (mm)', 'Status', 'Consumed By Plan'];
                const rows = jumboRolls.map(r => [r.roll_id, r.film, r.width_mm.toString(), r.length_m.toString(), r.diameter_mm.toString(), r.status, r.consumed_by_plan || '']);
                handleExportCSV('msl_consumption_ledger', [headers, ...rows]);
              }}
              className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg flex items-center space-x-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-purple-600" />
              <span>Export CSV</span>
            </button>
          </div>

          <div className="overflow-x-auto mt-3">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-500">
                <tr>
                  <th className="py-2.5 px-3">Roll ID</th>
                  <th className="py-2.5 px-3">Film</th>
                  <th className="py-2.5 px-3 text-right">Width</th>
                  <th className="py-2.5 px-3 text-right">Total Length</th>
                  <th className="py-2.5 px-3 text-right">Remaining</th>
                  <th className="py-2.5 px-3 text-right">Diameter</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 font-mono">Consuming Plan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jumboRolls.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{r.roll_id}</td>
                    <td className="py-2.5 px-3 font-bold">{r.film}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{r.width_mm} mm</td>
                    <td className="py-2.5 px-3 text-right font-mono">{(r.length_m ?? 0).toLocaleString()} m</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-purple-700">{(r.remaining_length_m ?? 0).toLocaleString()} m</td>
                    <td className="py-2.5 px-3 text-right font-mono">{r.diameter_mm} mm</td>
                    <td className="py-2.5 px-3 text-center">
                      <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                        r.status === 'AVAILABLE' ? 'bg-emerald-100 text-emerald-800' : r.status === 'CONSUMED' ? 'bg-slate-200 text-slate-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-purple-900">{r.consumed_by_plan || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Demand Fulfillment */}
      {activeReportTab === 'fulfillment' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="font-bold text-sm text-slate-900">Metallized Orders Backlog Fulfillment Status</h3>
            <button
              onClick={() => {
                const headers = ['Sales Order', 'Item', 'Customer', 'Film', 'Width (mm)', 'Balance (KG)', 'Remaining (KG)', 'Fulfilled %'];
                const rows = metallizedOrders.map(o => [
                  o.sales_order,
                  o.item_number.toString(),
                  o.customer,
                  o.film,
                  o.width_mm.toString(),
                  o.balance_qty.toString(),
                  o.remaining_qty.toString(),
                  `${Math.round(((o.balance_qty - o.remaining_qty) / o.balance_qty) * 100)}%`
                ]);
                handleExportCSV('msl_fulfillment_report', [headers, ...rows]);
              }}
              className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg flex items-center space-x-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-purple-600" />
              <span>Export CSV</span>
            </button>
          </div>

          <div className="overflow-x-auto mt-3">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-500">
                <tr>
                  <th className="py-2.5 px-3">SO #</th>
                  <th className="py-2.5 px-4">Customer</th>
                  <th className="py-2.5 px-3">Film</th>
                  <th className="py-2.5 px-3 text-right">Width</th>
                  <th className="py-2.5 px-3 text-right">Balance</th>
                  <th className="py-2.5 px-3 text-right">Remaining</th>
                  <th className="py-2.5 px-3 text-right">Fulfilled %</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {metallizedOrders.map(o => {
                  const pct = Math.round(((o.balance_qty - o.remaining_qty) / (o.balance_qty || 1)) * 100);
                  return (
                    <tr key={o.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{o.sales_order}-{o.item_number}</td>
                      <td className="py-2.5 px-4 font-medium text-slate-800">{o.customer}</td>
                      <td className="py-2.5 px-3 font-bold">{o.film}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold">{o.width_mm} mm</td>
                      <td className="py-2.5 px-3 text-right font-mono">{(o.balance_qty ?? 0).toLocaleString()} kg</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-purple-700">{(o.remaining_qty ?? 0).toLocaleString()} kg</td>
                      <td className="py-2.5 px-3 text-right font-mono">{pct}%</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                          o.remaining_qty === 0 ? 'bg-emerald-100 text-emerald-800' : o.remaining_qty < o.balance_qty ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {o.remaining_qty === 0 ? 'FULFILLED' : o.remaining_qty < o.balance_qty ? 'PARTIAL' : 'PENDING'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Upstream Sourcing */}
      {activeReportTab === 'sourcing' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="font-bold text-sm text-slate-900">Upstream Jumbo Roll Procurement Specifications</h3>
            <button
              onClick={() => {
                const headers = ['Film', 'Width (mm)', 'Length (m)', 'Thickness (µm)', 'Calculated Dia (mm)', 'Core', 'Rolls Required', 'Total (KG)', 'Expected Trim (mm)'];
                const rows = requirements.map(r => [
                  r.film,
                  r.required_jumbo_width_mm.toString(),
                  r.required_jumbo_length_m.toString(),
                  r.thickness_micron.toString(),
                  r.calculated_diameter_mm.toString(),
                  r.core,
                  r.required_rolls_count.toString(),
                  r.total_weight_kg.toString(),
                  r.expected_trim_mm.toString()
                ]);
                handleExportCSV('msl_upstream_procurement', [headers, ...rows]);
              }}
              className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg flex items-center space-x-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-purple-600" />
              <span>Export CSV</span>
            </button>
          </div>

          <div className="overflow-x-auto mt-3">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-500">
                <tr>
                  <th className="py-2.5 px-3">Film Grade</th>
                  <th className="py-2.5 px-3 text-right">Required Width</th>
                  <th className="py-2.5 px-3 text-right">Required Length</th>
                  <th className="py-2.5 px-3 text-right">Micron</th>
                  <th className="py-2.5 px-3 text-right">Diameter</th>
                  <th className="py-2.5 px-3">Core</th>
                  <th className="py-2.5 px-3 text-right">Rolls Needed</th>
                  <th className="py-2.5 px-3 text-right">Total Mass (KG)</th>
                  <th className="py-2.5 px-3 text-right">Expected Trim</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requirements.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-bold text-purple-800">{r.film}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">{r.required_jumbo_width_mm} mm</td>
                    <td className="py-2.5 px-3 text-right font-mono">{(r.required_jumbo_length_m ?? 0).toLocaleString()} m</td>
                    <td className="py-2.5 px-3 text-right font-mono">{r.thickness_micron} µm</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-purple-700">{r.calculated_diameter_mm} mm</td>
                    <td className="py-2.5 px-3">{r.core}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">{r.required_rolls_count}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold">{(r.total_weight_kg ?? 0).toLocaleString()} kg</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">{r.expected_trim_mm} mm</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
