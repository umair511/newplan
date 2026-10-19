import React, { useState, useMemo } from 'react';
import { VA05Order, SlitterPlan } from '../types';
import { calculateOrderFulfillmentSummary } from '../services/orderSummary';
import { isPS01Order } from '../services/optimizer/deckleOptimizer';
import { 
  PackageOpen, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Search, 
  Download
} from 'lucide-react';

interface RemainingOrdersTableProps {
  film: string;
  originalOrders: VA05Order[];
  remainingOrders: VA05Order[];
  plans: SlitterPlan[];
}

export const RemainingOrdersTable: React.FC<RemainingOrdersTableProps> = ({
  film,
  originalOrders,
  remainingOrders,
  plans,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'UNPLANNED_ONLY' | 'PARTIAL_ONLY' | 'COMPLETED_ONLY'>('ALL');
  const [sortBy, setSortBy] = useState<'REMAINING_DESC' | 'REMAINING_ASC' | 'WIDTH' | 'CUSTOMER' | 'PLANNED_DESC'>('REMAINING_DESC');

  // Map each order's initial demand and planned amount in this run using isolated calculation service
  const summaryResult = useMemo(() => {
    return calculateOrderFulfillmentSummary(
      film,
      originalOrders.filter(isPS01Order),
      plans,
      remainingOrders.filter(isPS01Order)
    );
  }, [film, originalOrders, remainingOrders, plans]);

  const orderBreakdowns = summaryResult.orderBreakdowns;
  const totals = summaryResult.totals;

  // Overall Statistics from calculated totals
  const totalFilmOrders = totals.totalOrders;
  const completedOrders = totals.completedOrders;
  const partialOrders = totals.partialOrders;
  const unplannedOrders = totals.unplannedOrders;
  
  const totalInitialKg = totals.totalInitialKg;
  const totalPlannedInRunKg = totals.totalPlannedInRunKg;
  const totalRemainingKg = totals.totalRemainingKg;

  // Filter & Search
  const filteredOrders = useMemo(() => {
    return orderBreakdowns
      .filter(item => {
        // Status tab filter
        if (statusFilter === 'UNPLANNED_ONLY' && item.status !== 'UNPLANNED') return false;
        if (statusFilter === 'PARTIAL_ONLY' && item.status !== 'PARTIAL') return false;
        if (statusFilter === 'COMPLETED_ONLY' && item.status !== 'COMPLETED') return false;

        // Search text filter
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase();
          const matchSO = item.salesOrder.toLowerCase().includes(q);
          const matchCust = item.customer.toLowerCase().includes(q);
          const matchRef = item.customerRef.toLowerCase().includes(q);
          const matchWidth = String(item.width_mm).includes(q);
          const matchLength = String(item.length_m).includes(q);
          return matchSO || matchCust || matchRef || matchWidth || matchLength;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'REMAINING_DESC') return b.remainingKg - a.remainingKg;
        if (sortBy === 'REMAINING_ASC') return a.remainingKg - b.remainingKg;
        if (sortBy === 'PLANNED_DESC') return b.plannedInRunKg - a.plannedInRunKg;
        if (sortBy === 'WIDTH') return b.width_mm - a.width_mm;
        if (sortBy === 'CUSTOMER') return a.customer.localeCompare(b.customer);
        return 0;
      });
  }, [orderBreakdowns, statusFilter, searchTerm, sortBy]);

  // Export CSV
  const handleExportCSV = () => {
    const headers = [
      'Sales Order',
      'Item',
      'Customer',
      'Customer Ref',
      'Film',
      'Width (mm)',
      'Length (m)',
      'Core',
      'TS',
      'Original Qty (kg)',
      'Planned in Run (kg)',
      'Remaining Unplanned (kg)',
      'Status',
      'Plans Included',
    ];

    const rows = filteredOrders.map(o => [
      o.salesOrder,
      o.itemNumber,
      `"${o.customer.replace(/"/g, '""')}"`,
      `"${o.customerRef.replace(/"/g, '""')}"`,
      film,
      o.width_mm,
      o.length_m,
      o.core,
      o.treatment_side,
      o.initialKg.toFixed(2),
      o.plannedInRunKg.toFixed(2),
      o.remainingKg.toFixed(2),
      o.status,
      `"${o.matchingPlanNumbers.join(', ')}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Remaining_Unplanned_Orders_${film}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-white border border-slate-200/80 rounded-xl shadow-xs overflow-hidden space-y-4 p-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              Film {film} — Post-Plan Order Balance
            </h3>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-200">
              {(totalRemainingKg ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg Unplanned
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time fulfillment tracking showing open orders after deducting planned cutting schedules.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleExportCSV}
            className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center space-x-1.5 border border-slate-200 shadow-xs cursor-pointer"
            title="Download CSV of Unplanned Orders"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Metric Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
        <div className="bg-slate-50/70 border border-slate-200/70 rounded-lg p-3">
          <div className="text-slate-500 font-medium text-[11px]">Total Orders</div>
          <div className="text-base font-bold text-slate-900 mt-0.5 font-mono">{totalFilmOrders}</div>
          <div className="text-[10px] text-slate-400 font-mono mt-0.5">{(totalInitialKg ?? 0).toLocaleString()} kg Total</div>
        </div>

        <div className="bg-slate-50/70 border border-slate-200/70 rounded-lg p-3">
          <div className="text-slate-600 font-medium text-[11px] flex items-center space-x-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Fully Planned</span>
          </div>
          <div className="text-base font-bold text-slate-900 mt-0.5 font-mono">{completedOrders}</div>
          <div className="text-[10px] text-emerald-600 font-mono mt-0.5">100% Fulfilled</div>
        </div>

        <div className="bg-slate-50/70 border border-slate-200/70 rounded-lg p-3">
          <div className="text-slate-600 font-medium text-[11px] flex items-center space-x-1">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span>Partially Planned</span>
          </div>
          <div className="text-base font-bold text-slate-900 mt-0.5 font-mono">{partialOrders}</div>
          <div className="text-[10px] text-amber-600 font-mono mt-0.5">In Progress</div>
        </div>

        <div className="bg-slate-50/70 border border-slate-200/70 rounded-lg p-3">
          <div className="text-slate-600 font-medium text-[11px] flex items-center space-x-1">
            <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
            <span>Unplanned</span>
          </div>
          <div className="text-base font-bold text-slate-900 mt-0.5 font-mono">{unplannedOrders}</div>
          <div className="text-[10px] text-rose-500 font-mono mt-0.5">0% Planned</div>
        </div>

        <div className="bg-slate-900 text-white rounded-lg p-3 border border-slate-800">
          <div className="text-slate-400 font-medium text-[11px]">Unplanned Demand</div>
          <div className="text-base font-bold text-white mt-0.5 font-mono">
            {(totalRemainingKg ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
          </div>
          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
            Planned: {(totalPlannedInRunKg ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pt-2">
        {/* Status Filter Tabs */}
        <div className="flex items-center bg-slate-100/80 p-1 rounded-lg border border-slate-200/80 text-xs">
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1 rounded-md transition-all cursor-pointer font-medium ${
              statusFilter === 'ALL' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All ({totalFilmOrders})
          </button>
          <button
            onClick={() => setStatusFilter('UNPLANNED_ONLY')}
            className={`px-3 py-1 rounded-md transition-all cursor-pointer font-medium ${
              statusFilter === 'UNPLANNED_ONLY' ? 'bg-white text-rose-700 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Unplanned ({unplannedOrders})
          </button>
          <button
            onClick={() => setStatusFilter('PARTIAL_ONLY')}
            className={`px-3 py-1 rounded-md transition-all cursor-pointer font-medium ${
              statusFilter === 'PARTIAL_ONLY' ? 'bg-white text-amber-700 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Partial ({partialOrders})
          </button>
          <button
            onClick={() => setStatusFilter('COMPLETED_ONLY')}
            className={`px-3 py-1 rounded-md transition-all cursor-pointer font-medium ${
              statusFilter === 'COMPLETED_ONLY' ? 'bg-white text-emerald-700 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Completed ({completedOrders})
          </button>
        </div>

        {/* Search & Sort Controls */}
        <div className="flex items-center space-x-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-60">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search order, customer, width..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50/70 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900 focus:bg-white transition-all placeholder:text-slate-400"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-2.5 py-1.5 text-xs bg-slate-50/70 border border-slate-200 rounded-lg text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer"
          >
            <option value="REMAINING_DESC">Highest Remaining (kg)</option>
            <option value="REMAINING_ASC">Lowest Remaining (kg)</option>
            <option value="PLANNED_DESC">Highest Planned (kg)</option>
            <option value="WIDTH">Width (Desc)</option>
            <option value="CUSTOMER">Customer (A-Z)</option>
          </select>
        </div>
      </div>

      {/* Orders Table */}
      <div className="overflow-x-auto border border-slate-200/80 rounded-lg">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-slate-50/90 text-slate-600 font-semibold text-[11px] border-b border-slate-200/80">
            <tr>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3">SO# / Item</th>
              <th className="py-2.5 px-3">Customer</th>
              <th className="py-2.5 px-2">Customer Ref</th>
              <th className="py-2.5 px-2 text-right">Width</th>
              <th className="py-2.5 px-2 text-right">Length</th>
              <th className="py-2.5 px-2 text-center">Core / TS</th>
              <th className="py-2.5 px-3 text-right">Initial Qty</th>
              <th className="py-2.5 px-3 text-right">Planned (kg)</th>
              <th className="py-2.5 px-3 text-right font-bold text-slate-900">
                Remaining Unplanned
              </th>
              <th className="py-2.5 px-3 text-left">Fulfillment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs font-mono">
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-8 text-center text-slate-400 font-sans">
                  No orders match the selected filters.
                </td>
              </tr>
            ) : (
              filteredOrders.map((item) => {
                const isCompleted = item.status === 'COMPLETED';
                const isPartial = item.status === 'PARTIAL';

                return (
                  <tr
                    key={item.id}
                    className="hover:bg-slate-50/70 transition-colors font-sans"
                  >
                    {/* Status */}
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium font-mono ${
                        isCompleted ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                        isPartial ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                        'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}>
                        {isCompleted ? 'Completed' : isPartial ? 'Partial' : 'Unplanned'}
                      </span>
                    </td>

                    {/* Sales Order */}
                    <td className="py-2 px-3 font-mono font-medium text-slate-900">
                      {item.salesOrder} <span className="text-[10px] text-slate-400">#{item.itemNumber}</span>
                    </td>

                    {/* Customer */}
                    <td className="py-2 px-3 font-medium text-slate-900 truncate max-w-[180px]" title={item.customer}>
                      {item.customer}
                    </td>

                    {/* Customer Ref */}
                    <td className="py-2 px-2 text-slate-500 text-[11px] truncate max-w-[120px]" title={item.customerRef}>
                      {item.customerRef}
                    </td>

                    {/* Width */}
                    <td className="py-2 px-2 text-right font-mono font-semibold text-slate-900">
                      {item.width_mm} mm
                    </td>

                    {/* Length */}
                    <td className="py-2 px-2 text-right font-mono text-slate-600">
                      {(item.length_m ?? 0).toLocaleString()} m
                    </td>

                    {/* Core / TS */}
                    <td className="py-2 px-2 text-center font-mono text-slate-500 text-[11px]">
                      {item.core}" / {item.treatment_side}
                    </td>

                    {/* Initial Available Qty */}
                    <td className="py-2 px-3 text-right font-mono text-slate-600">
                      {(item.initialKg ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>

                    {/* Planned in this Run */}
                    <td className="py-2 px-3 text-right font-mono font-medium text-slate-900">
                      {item.plannedInRunKg > 0 ? (item.plannedInRunKg ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                    </td>

                    {/* Remaining Unplanned */}
                    <td className={`py-2 px-3 text-right font-mono font-bold ${
                      isCompleted ? 'text-emerald-600' :
                      isPartial ? 'text-amber-700' :
                      'text-slate-900'
                    }`}>
                      {item.remainingKg > 0 ? (
                        <span>{(item.remainingKg ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg</span>
                      ) : (
                        <span className="text-emerald-600 font-normal">0.00 kg</span>
                      )}
                    </td>

                    {/* Progress Bar & Plans */}
                    <td className="py-2 px-3">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-mono">
                          <span className="text-slate-400">{item.completionPct}%</span>
                          {item.matchingPlanNumbers.length > 0 && (
                            <span className="text-slate-600 font-medium">
                              {item.matchingPlanNumbers.join(', ')}
                            </span>
                          )}
                        </div>
                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              isCompleted ? 'bg-emerald-500' : isPartial ? 'bg-amber-500' : 'bg-slate-300'
                            }`}
                            style={{ width: `${item.completionPct}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot className="bg-slate-50/80 text-slate-700 font-semibold text-xs border-t border-slate-200/80">
            <tr>
              <td colSpan={7} className="py-2.5 px-3 text-right uppercase tracking-wider text-[11px] text-slate-500">
                Totals ({filteredOrders.length} Orders):
              </td>
              <td className="py-2.5 px-3 text-right font-mono">
                {filteredOrders.reduce((sum, o) => sum + o.initialKg, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg
              </td>
              <td className="py-2.5 px-3 text-right font-mono text-slate-900">
                {filteredOrders.reduce((sum, o) => sum + o.plannedInRunKg, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg
              </td>
              <td className="py-2.5 px-3 text-right font-mono text-slate-900 font-bold">
                {filteredOrders.reduce((sum, o) => sum + o.remainingKg, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg
              </td>
              <td className="py-2.5 px-3 text-slate-500 font-normal text-[11px]">
                {filteredOrders.filter(o => o.status === 'COMPLETED').length} done · {filteredOrders.filter(o => o.status === 'PARTIAL').length} partial · {filteredOrders.filter(o => o.status === 'UNPLANNED').length} open
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
