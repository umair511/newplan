import React, { useState } from 'react';
import { 
  Layers, 
  Search, 
  Filter, 
  Star, 
  Sparkles, 
  Cpu, 
  CheckCircle, 
  AlertCircle,
  FileSpreadsheet,
  ArrowRight
} from 'lucide-react';
import { VA05Order } from '../../types';
import { isMetallizerOrder } from '../../services/metallizer/metallizerOptimizer';

interface MetallizerDemandProps {
  orders: VA05Order[];
  onPlanFilm: (film: string) => void;
  onGenerateRequirements: (film?: string) => void;
  onTogglePriority: (orderId: string) => void;
}

export const MetallizerDemand: React.FC<MetallizerDemandProps> = ({
  orders,
  onPlanFilm,
  onGenerateRequirements,
  onTogglePriority,
}) => {
  const [selectedFilm, setSelectedFilm] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Filter metallized orders (strictly Film Code contains "MZ")
  const metallizedOrders = orders.filter(o => isMetallizerOrder(o));

  const availableFilms = Array.from(new Set(metallizedOrders.map(o => o.film))).sort();

  const filteredOrders = metallizedOrders.filter(o => {
    if (selectedFilm !== 'ALL' && o.film !== selectedFilm) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        o.sales_order.toLowerCase().includes(q) ||
        o.customer.toLowerCase().includes(q) ||
        o.material.toLowerCase().includes(q) ||
        o.width_mm.toString().includes(q)
      );
    }
    return true;
  });

  const totalDemandKg = filteredOrders.reduce((sum, o) => sum + o.remaining_qty, 0);

  return (
    <div className="space-y-6" id="msl-demand-view">
      {/* Header and Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 text-xs font-bold rounded bg-purple-100 text-purple-800">
              METALLIZED DEMAND
            </span>
            <span className="text-xs text-slate-500 font-mono">Downstream Finished Slit Requirements</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-1">Metallized-Film Orders Backlog</h1>
          <p className="text-xs text-slate-500">
            Orders requiring Metallizer Slitter conversion (MZ18, MZ20, TH21 Series)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onGenerateRequirements(selectedFilm !== 'ALL' ? selectedFilm : undefined)}
            className="flex items-center space-x-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>Generate Jumbo Requirements</span>
          </button>
          <button
            onClick={() => onPlanFilm(selectedFilm !== 'ALL' ? selectedFilm : 'TH21-18')}
            className="flex items-center space-x-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            <Cpu className="w-4 h-4 text-purple-400" />
            <span>Launch Planning Studio</span>
          </button>
        </div>
      </div>

      {/* Filter and Film Pills */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Search bar */}
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by SO, customer, width..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          <div className="text-xs text-slate-600 flex items-center space-x-2">
            <span>Showing: <b className="text-slate-900">{filteredOrders.length}</b> orders</span>
            <span>·</span>
            <span>Total Demand: <b className="text-purple-700 font-mono">{(totalDemandKg ?? 0).toLocaleString()} KG</b></span>
          </div>
        </div>

        {/* Film Grade Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
          <span className="text-xs font-semibold text-slate-500 mr-1 flex items-center">
            <Filter className="w-3.5 h-3.5 mr-1" /> Film Grade:
          </span>
          <button
            onClick={() => setSelectedFilm('ALL')}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              selectedFilm === 'ALL'
                ? 'bg-purple-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All Grades ({metallizedOrders.length})
          </button>
          {availableFilms.map(film => {
            const count = metallizedOrders.filter(o => o.film === film && o.remaining_qty > 0).length;
            return (
              <button
                key={film}
                onClick={() => setSelectedFilm(film)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  selectedFilm === film
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {film} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600 border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-3 px-3 w-8">Prio</th>
                <th className="py-3 px-3">SO # / Item</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-3">Grade</th>
                <th className="py-3 px-3 text-right">Width (mm)</th>
                <th className="py-3 px-3 text-right">Length (m)</th>
                <th className="py-3 px-3 text-right">Thickness</th>
                <th className="py-3 px-3 text-right">Balance</th>
                <th className="py-3 px-3 text-right">Remaining</th>
                <th className="py-3 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    No metallized film orders found matching the filter.
                  </td>
                </tr>
              ) : (
                filteredOrders.map(order => (
                  <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-3">
                      <button
                        onClick={() => onTogglePriority(order.id)}
                        className={`cursor-pointer ${order.priority ? 'text-amber-500' : 'text-slate-300 hover:text-slate-400'}`}
                        title="Priority: starred orders plan first (strict) — non-priority may wait or lose capacity"
                      >
                        <Star className={`w-4 h-4 ${order.priority ? 'fill-amber-500' : ''}`} />
                      </button>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                      {order.sales_order}-{order.item_number}
                    </td>
                    <td className="py-2.5 px-4 text-slate-900 font-medium truncate max-w-xs">
                      {order.customer}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 font-bold rounded bg-purple-50 text-purple-700 border border-purple-200">
                        {order.film}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                      {order.width_mm} mm
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                      {(order.length_m ?? 0).toLocaleString()} m
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                      {order.thickness_micron} µm
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                      {(order.balance_qty ?? 0).toLocaleString()} kg
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-purple-700">
                      {(order.remaining_qty ?? 0).toLocaleString()} kg
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                        order.remaining_qty === 0
                          ? 'bg-emerald-100 text-emerald-800'
                          : order.remaining_qty < order.balance_qty
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {order.remaining_qty === 0 ? 'FULFILLED' : order.remaining_qty < order.balance_qty ? 'PARTIAL' : 'PENDING'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
