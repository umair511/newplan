import React, { useState, useMemo } from 'react';
import { VA05Order, SlitterPlan } from '../types';
import { FILM_MASTERS } from '../services/masterData';
import { isPS01Order } from '../services/optimizer/deckleOptimizer';
import { 
  Layers, 
  ArrowRight, 
  Star, 
  Search, 
  Filter, 
  FileSpreadsheet, 
  Scissors, 
  TrendingUp, 
  ListOrdered 
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface PS01FilmDemandProps {
  orders: VA05Order[];
  plans: SlitterPlan[];
  onPlanFilm: (film: string) => void;
  onNavigate: (tab: string, filterFilm?: string) => void;
}

export const PS01FilmDemand: React.FC<PS01FilmDemandProps> = ({
  orders,
  plans,
  onPlanFilm,
  onNavigate,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'DEMAND_DESC' | 'ORDERS_DESC' | 'CODE_ASC' | 'THICKNESS_ASC'>('DEMAND_DESC');

  // Filter strictly to valid PS01 orders: excludes MZ family and width < 355 mm
  const ps01Orders = useMemo(() => orders.filter(isPS01Order), [orders]);

  const distinctFilms = useMemo(() => {
    return Array.from(new Set(ps01Orders.map(o => o.film))).sort();
  }, [ps01Orders]);

  const filmList = useMemo(() => {
    return distinctFilms.map(filmCode => {
      const master = FILM_MASTERS.find(f => f.code === filmCode);
      const filmOrders = ps01Orders.filter(o => o.film === filmCode);
      const openOrders = filmOrders.filter(o => o.remaining_qty > 0);
      const completedOrders = filmOrders.filter(o => o.status === 'COMPLETED');
      const remainingKg = openOrders.reduce((sum, o) => sum + o.remaining_qty, 0);
      const originalKg = filmOrders.reduce((sum, o) => sum + (o.balance_qty || o.ordered_qty), 0);
      const priorityOrders = openOrders.filter(o => o.priority).length;
      const uniqueCustomers = Array.from(new Set(filmOrders.map(o => o.customer)));
      const filmPlans = plans.filter(p => p.film === filmCode);

      const thickness = master?.thickness_micron || filmOrders[0]?.thickness_micron || 20;
      const density = master?.density || filmOrders[0]?.density || 0.91;
      const category = master?.category || 'TRANSPARENT';
      const name = master?.name || `${filmCode} BOPP Film`;

      return {
        code: filmCode,
        name,
        category,
        thickness,
        density,
        totalOrders: filmOrders.length,
        openOrders: openOrders.length,
        completedOrders: completedOrders.length,
        remainingKg: Math.round(remainingKg * 100) / 100,
        originalKg: Math.round(originalKg * 100) / 100,
        priorityOrders,
        customerCount: uniqueCustomers.length,
        customers: uniqueCustomers,
        plansCount: filmPlans.length,
        fulfillmentRate: originalKg > 0 ? ((originalKg - remainingKg) / originalKg) * 100 : 0,
      };
    });
  }, [ps01Orders, distinctFilms, plans]);

  // Available categories among PS01 films
  const availableCategories = useMemo(() => {
    const cats = new Set(filmList.map(f => f.category));
    return ['ALL', ...Array.from(cats).sort()];
  }, [filmList]);

  // Filtered and sorted films
  const filteredFilms = useMemo(() => {
    return filmList
      .filter(f => {
        if (categoryFilter !== 'ALL' && f.category !== categoryFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return (
            f.code.toLowerCase().includes(q) ||
            f.name.toLowerCase().includes(q) ||
            f.customers.some(c => c.toLowerCase().includes(q))
          );
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'DEMAND_DESC') return b.remainingKg - a.remainingKg;
        if (sortBy === 'ORDERS_DESC') return b.openOrders - a.openOrders;
        if (sortBy === 'CODE_ASC') return a.code.localeCompare(b.code);
        if (sortBy === 'THICKNESS_ASC') return a.thickness - b.thickness;
        return 0;
      });
  }, [filmList, categoryFilter, searchQuery, sortBy]);

  // Overall PS01 KPIs
  const totalRemainingKg = useMemo(() => {
    return filmList.reduce((sum, f) => sum + f.remainingKg, 0);
  }, [filmList]);

  const totalOpenOrders = useMemo(() => {
    return filmList.reduce((sum, f) => sum + f.openOrders, 0);
  }, [filmList]);

  const totalPriorityCount = useMemo(() => {
    return filmList.reduce((sum, f) => sum + f.priorityOrders, 0);
  }, [filmList]);

  const handleExportExcel = () => {
    const exportRows = filteredFilms.map(f => ({
      'Film Code': f.code,
      'Description': f.name,
      'Category': f.category,
      'Thickness (µ)': f.thickness,
      'Density': f.density,
      'Pending Demand (kg)': f.remainingKg,
      'Original Demand (kg)': f.originalKg,
      'Open Orders': f.openOrders,
      'Total Orders': f.totalOrders,
      'Priority Orders': f.priorityOrders,
      'Active Plans': f.plansCount,
      'Accounts Count': f.customerCount,
      'Key Accounts': f.customers.slice(0, 5).join(', '),
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PS01 Film Demand');
    XLSX.writeFile(wb, `PS01_Film_Demand_Breakdown_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 text-xs font-bold rounded bg-emerald-100 text-emerald-800 flex items-center space-x-1">
              <Scissors className="w-3 h-3" />
              <span>PRIMARY SLITTER (PS01)</span>
            </span>
            <span className="text-xs text-slate-500 font-mono">10,400mm Deckle · Min Slit 355 mm</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-1">PS01 Film Demand Breakdown</h1>
          <p className="text-xs text-slate-500">
            Pending sales order demand organized strictly by PS01-eligible film grades (Non-MZ &amp; slit width &ge; 355 mm)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onNavigate('ps-demand')}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <ListOrdered className="w-3.5 h-3.5 text-slate-500" />
            <span>Orders Backlog</span>
          </button>
          <button
            onClick={handleExportExcel}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Export Excel</span>
          </button>
        </div>
      </div>

      {/* KPI Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-medium uppercase tracking-wider">
            <span>PS01 Pending Demand</span>
            <Layers className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1 font-mono">
            {totalRemainingKg.toLocaleString()} <span className="text-xs font-normal text-slate-400">kg</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">{totalOpenOrders} open orders across PS01</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-medium uppercase tracking-wider">
            <span>Eligible Film Grades</span>
            <Layers className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1 font-mono">
            {filmList.length} <span className="text-xs font-normal text-slate-400">grades</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">Non-MZ films &ge; 355 mm</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-medium uppercase tracking-wider">
            <span>Priority Demand</span>
            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
          </div>
          <div className="text-xl font-bold text-amber-600 mt-1 font-mono">
            {totalPriorityCount} <span className="text-xs font-normal text-slate-400">starred</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">Accelerated slitting priority</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-medium uppercase tracking-wider">
            <span>Active PS01 Plans</span>
            <Scissors className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1 font-mono">
            {plans.length} <span className="text-xs font-normal text-slate-400">schedules</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">Slitter cutting runs generated</p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search PS01 films by code, name, or customer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs text-slate-900 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50"
          />
        </div>

        {/* Category & Sorting Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Category Filter Pills */}
          <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
            {availableCategories.slice(0, 4).map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-2.5 py-1 rounded-md font-medium text-[11px] transition-all cursor-pointer ${
                  categoryFilter === cat
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {cat === 'ALL' ? 'All' : cat}
              </button>
            ))}
          </div>

          {/* Sort Select */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-2.5 py-1.5 text-xs font-semibold text-slate-800 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white cursor-pointer"
          >
            <option value="DEMAND_DESC">Sort: Highest Demand</option>
            <option value="ORDERS_DESC">Sort: Most Orders</option>
            <option value="CODE_ASC">Sort: Film Code (A-Z)</option>
            <option value="THICKNESS_ASC">Sort: Thickness (µ)</option>
          </select>
        </div>
      </div>

      {/* Grid of Film Demand Cards */}
      {filteredFilms.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl p-12 text-center text-slate-400 space-y-2">
          <Layers className="w-10 h-10 mx-auto text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">No PS01 film demand found matching your filter</p>
          <p className="text-xs text-slate-400">All non-MZ film orders with slit width &ge; 355 mm will appear here automatically.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredFilms.map((film) => (
            <div
              key={film.code}
              className="bg-white border border-slate-200/90 hover:border-emerald-500 rounded-xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group"
            >
              <div>
                {/* Header Info */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-lg font-bold text-slate-900 font-mono tracking-tight group-hover:text-emerald-950 transition-colors">
                        {film.code}
                      </span>
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-100 text-slate-700 uppercase font-mono border border-slate-200">
                        {film.thickness}µ
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{film.name}</p>
                  </div>

                  {film.priorityOrders > 0 ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 flex items-center space-x-1">
                      <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                      <span>{film.priorityOrders} Prio</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono text-slate-400 bg-slate-50">
                      Standard
                    </span>
                  )}
                </div>

                {/* Demand Stats Box */}
                <div className="mt-4 bg-slate-50 border border-slate-200/80 rounded-lg p-3.5 space-y-2.5">
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-500">Pending Quantity:</span>
                    <span className="text-base font-bold text-slate-900 font-mono">
                      {film.remainingKg.toLocaleString()} <span className="text-xs font-normal text-slate-400">kg</span>
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-slate-200/80 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-emerald-600 h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, Math.max(film.remainingKg > 0 ? 8 : 0, film.fulfillmentRate))}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-slate-600">
                    <div>Open Orders: <strong className="font-mono text-slate-900">{film.openOrders} / {film.totalOrders}</strong></div>
                    <div>Accounts: <strong className="font-mono text-slate-900">{film.customerCount}</strong></div>
                    <div>Completed: <strong className="font-mono text-emerald-700">{film.completedOrders}</strong></div>
                    <div>Generated Plans: <strong className="font-mono text-slate-900">{film.plansCount}</strong></div>
                  </div>
                </div>

                {/* Key Accounts Sample */}
                <div className="mt-3 text-[11px] text-slate-500 truncate">
                  <span className="text-slate-400 font-medium">Key Accounts: </span>
                  <span className="text-slate-700 font-medium">
                    {film.customers.slice(0, 3).join(', ')}{film.customers.length > 3 ? '...' : ''}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-5 pt-3.5 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-400 font-mono">
                  10,400mm PS01
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => onNavigate('ps-demand')}
                    className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors cursor-pointer"
                    title={`View ${film.code} individual order line items`}
                  >
                    Orders
                  </button>
                  <button
                    onClick={() => onPlanFilm(film.code)}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors flex items-center space-x-1.5 cursor-pointer"
                  >
                    <span>Plan Film</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
