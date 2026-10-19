import React, { useState, useMemo } from 'react';
import { 
  Layers, 
  Search, 
  Filter, 
  Star, 
  Cpu, 
  CheckCircle, 
  AlertCircle,
  FileSpreadsheet,
  ArrowRight,
  ShieldCheck,
  Scissors
} from 'lucide-react';
import { VA05Order } from '../types';
import { isPS01Order, isPS01Film } from '../services/optimizer/deckleOptimizer';
import { FILM_MASTERS } from '../services/masterData';
import * as XLSX from 'xlsx';

interface PS01DemandProps {
  orders: VA05Order[];
  onPlanFilm: (film: string) => void;
  onTogglePriority: (orderId: string) => void;
}

export const PS01Demand: React.FC<PS01DemandProps> = ({
  orders,
  onPlanFilm,
  onTogglePriority,
}) => {
  const [selectedFilm, setSelectedFilm] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'COMPLETED'>('ALL');
  const [priorityOnly, setPriorityOnly] = useState<boolean>(false);

  // Filter strictly to valid PS01 orders: excludes MZ family and width < 355 mm
  const ps01Orders = useMemo(() => orders.filter(isPS01Order), [orders]);

  const availableFilms = useMemo(() => {
    return Array.from(new Set(ps01Orders.map(o => o.film))).sort();
  }, [ps01Orders]);

  const filteredOrders = useMemo(() => {
    return ps01Orders.filter(o => {
      if (selectedFilm !== 'ALL' && o.film !== selectedFilm) return false;
      if (statusFilter === 'OPEN' && o.remaining_qty <= 0) return false;
      if (statusFilter === 'COMPLETED' && o.status !== 'COMPLETED') return false;
      if (priorityOnly && !o.priority) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          o.sales_order.toLowerCase().includes(q) ||
          o.customer.toLowerCase().includes(q) ||
          o.material.toLowerCase().includes(q) ||
          o.width_mm.toString().includes(q) ||
          (o.customer_reference || '').toLowerCase().includes(q) ||
          (o.ship_to_city || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [ps01Orders, selectedFilm, statusFilter, priorityOnly, searchQuery]);

  const totalDemandKg = useMemo(() => {
    return filteredOrders.reduce((sum, o) => sum + o.remaining_qty, 0);
  }, [filteredOrders]);

  const totalOriginalKg = useMemo(() => {
    return filteredOrders.reduce((sum, o) => sum + (o.balance_qty || o.ordered_qty), 0);
  }, [filteredOrders]);

  const openOrdersCount = useMemo(() => {
    return filteredOrders.filter(o => o.remaining_qty > 0).length;
  }, [filteredOrders]);

  const priorityOrdersCount = useMemo(() => {
    return filteredOrders.filter(o => o.priority && o.remaining_qty > 0).length;
  }, [filteredOrders]);

  const getFilmThickness = (filmCode: string) => {
    const master = FILM_MASTERS.find(m => m.code === filmCode);
    if (master) return master.thickness_micron;
    const ord = ps01Orders.find(o => o.film === filmCode);
    return ord?.thickness_micron || 20;
  };

  const handleExportExcel = () => {
    const exportRows = filteredOrders.map(o => ({
      'Sales Order': o.sales_order,
      'Item': o.item_number,
      'Customer': o.customer,
      'Material': o.material,
      'Film': o.film,
      'Width (mm)': o.width_mm,
      'Length (m)': o.length_m,
      'Thickness (µ)': o.thickness_micron || getFilmThickness(o.film),
      'Core': o.core || 6,
      'Treatment Side': o.treatment_side,
      'Remaining Qty (kg)': o.remaining_qty,
      'Ordered Qty (kg)': o.ordered_qty,
      'Balance Qty (kg)': o.balance_qty,
      'Status': o.status,
      'Priority': o.priority ? 'YES' : 'NO',
      'PO Reference': o.customer_reference || '',
      'Delivery Date': o.delivery_date || '',
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PS01 Orders');
    XLSX.writeFile(wb, `PS01_Eligible_Orders_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-6" id="ps01-demand-view">
      {/* Header and Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 text-xs font-bold rounded bg-emerald-100 text-emerald-800 flex items-center space-x-1">
              <Scissors className="w-3 h-3" />
              <span>PRIMARY SLITTER (PS01) DEMAND</span>
            </span>
            <span className="text-xs text-slate-500 font-mono">10,400mm Deckle · Min Slit 355 mm</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-1">Primary Slitter (PS01) Orders Backlog</h1>
          <p className="text-xs text-slate-500">
            Filtered customer demand eligible for PS01 slitter planning (All non-MZ film grades with slit width &ge; 355 mm)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportExcel}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Export Excel</span>
          </button>
          <button
            onClick={() => onPlanFilm(selectedFilm !== 'ALL' ? selectedFilm : (availableFilms[0] || 'TNO20'))}
            className="flex items-center space-x-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <Cpu className="w-4 h-4" />
            <span>Launch Planning Studio</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">PS01 Pending Demand</span>
          <div className="text-xl font-bold text-slate-900 mt-1 font-mono">
            {totalDemandKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-normal text-slate-400">kg</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">{openOrdersCount} open order items</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Total PS01 Orders</span>
          <div className="text-xl font-bold text-slate-900 mt-1 font-mono">
            {filteredOrders.length} <span className="text-xs font-normal text-slate-400">orders</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">Widths &ge; 355 mm</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">PS01 Film Grades</span>
          <div className="text-xl font-bold text-slate-900 mt-1 font-mono">
            {availableFilms.length} <span className="text-xs font-normal text-slate-400">grades</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">MZ films excluded</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Priority Demand</span>
          <div className="text-xl font-bold text-amber-700 mt-1 font-mono">
            {priorityOrdersCount} <span className="text-xs font-normal text-slate-400">starred</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">High scheduling priority</p>
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
              placeholder="Search SO, customer, width..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Priority Only Toggle */}
            <button
              onClick={() => setPriorityOnly(!priorityOnly)}
              className={`flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                priorityOnly
                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Star className={`w-3.5 h-3.5 ${priorityOnly ? 'fill-amber-500 text-amber-600' : 'text-slate-400'}`} />
              <span>Priority Only</span>
            </button>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="OPEN">Open Orders Only</option>
              <option value="COMPLETED">Completed Only</option>
            </select>
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
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All PS01 Grades ({ps01Orders.length})
          </button>
          {availableFilms.map(film => {
            const count = ps01Orders.filter(o => o.film === film && o.remaining_qty > 0).length;
            return (
              <button
                key={film}
                onClick={() => setSelectedFilm(film)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  selectedFilm === film
                    ? 'bg-emerald-700 text-white shadow-xs'
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
                <th className="py-3 px-3 w-8 text-center">⭐</th>
                <th className="py-3 px-3">SO # / Item</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-3">Grade</th>
                <th className="py-3 px-3 text-right">Width (mm)</th>
                <th className="py-3 px-3 text-right">Length (m)</th>
                <th className="py-3 px-3 text-right">Thickness</th>
                <th className="py-3 px-3 text-right">Balance</th>
                <th className="py-3 px-3 text-right">Remaining</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-400">
                    No PS01 film orders found matching the filter criteria.
                  </td>
                </tr>
              ) : (
                filteredOrders.map(order => (
                  <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-3 text-center">
                      <button
                        onClick={() => onTogglePriority(order.id)}
                        className={`cursor-pointer ${order.priority ? 'text-amber-500' : 'text-slate-300 hover:text-slate-400'}`}
                        title="Toggle Priority"
                      >
                        <Star className={`w-4 h-4 ${order.priority ? 'fill-amber-500' : ''}`} />
                      </button>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                      {order.sales_order} <span className="text-[10px] text-slate-400 font-normal">#{order.item_number}</span>
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-900 max-w-[200px] truncate" title={order.customer}>
                      {order.customer}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-emerald-100 text-emerald-800">
                        {order.film}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                      {order.width_mm}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                      {order.length_m}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                      {order.thickness_micron || getFilmThickness(order.film)}µ
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                      {Number(order.balance_qty || order.ordered_qty).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">
                      {order.remaining_qty.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        order.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                        order.status === 'PARTIALLY_FULFILLED' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => onPlanFilm(order.film)}
                        className="px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 rounded border border-emerald-200 transition-colors cursor-pointer inline-flex items-center space-x-1"
                      >
                        <span>Plan</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
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
