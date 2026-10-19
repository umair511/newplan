import React, { useState } from 'react';
import { VA05Order, SlitterPlan } from '../types';
import { FILM_MASTERS } from '../services/masterData';
import { isPS01Order } from '../services/optimizer/deckleOptimizer';
import { Layers, ArrowRight, Star, Sparkles } from 'lucide-react';

interface FilmsDashboardProps {
  orders: VA05Order[];
  plans: SlitterPlan[];
  onPlanFilm: (film: string) => void;
}

export const FilmsDashboard: React.FC<FilmsDashboardProps> = ({
  orders,
  plans,
  onPlanFilm,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  const psOrders = orders.filter(isPS01Order);
  const distinctFilms = Array.from(new Set(psOrders.map(o => o.film))).sort();

  const filmList = distinctFilms.map(filmCode => {
    const master = FILM_MASTERS.find(f => f.code === filmCode);
    const filmOrders = psOrders.filter(o => o.film === filmCode);
    const openOrders = filmOrders.filter(o => o.remaining_qty > 0);
    const completedOrders = filmOrders.filter(o => o.status === 'COMPLETED');
    const remainingKg = openOrders.reduce((sum, o) => sum + o.remaining_qty, 0);
    const originalKg = filmOrders.reduce((sum, o) => sum + o.balance_qty, 0);
    const priorityOrders = openOrders.filter(o => o.priority).length;
    const uniqueCustomers = Array.from(new Set(filmOrders.map(o => o.customer)));
    const filmPlans = plans.filter(p => p.film === filmCode);

    return {
      code: filmCode,
      name: master?.name || `${filmCode} BOPP Film`,
      category: master?.category || 'TRANSPARENT',
      thickness: master?.thickness_micron || 20,
      density: master?.density || 0.91,
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
  }).filter(f => {
    if (categoryFilter === 'ALL') return true;
    return f.category === categoryFilter;
  }).sort((a, b) => b.remainingKg - a.remainingKg);

  return (
    <div className="space-y-6">
      {/* Header & Category Filter */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-base font-bold text-slate-900 tracking-tight">Master Films Backlog</h1>
            <span className="text-[10px] font-mono px-2 py-0.5 font-medium rounded-md bg-slate-100 text-slate-600 border border-slate-200">
              {filmList.length} Active Grades
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Global demand and grade catalog across Primary Slitter, Metallizer, and Secondary Slitter.
          </p>
        </div>

        {/* Category Filter Pills */}
        <div className="flex items-center space-x-1 bg-slate-100/80 p-1 rounded-lg border border-slate-200/80 text-xs self-stretch sm:self-auto justify-between sm:justify-start">
          {['ALL', 'TRANSPARENT', 'METALLIZED', 'MATT'].map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1 rounded-md font-medium text-xs transition-all cursor-pointer ${
                categoryFilter === cat
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {cat === 'ALL' ? 'All' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Film Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filmList.map((film) => (
          <div
            key={film.code}
            className="bg-white border border-slate-200/80 hover:border-slate-300 rounded-xl p-5 shadow-xs transition-all flex flex-col justify-between group"
          >
            <div>
              {/* Header Info */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-lg font-bold text-slate-900 font-mono tracking-tight">{film.code}</span>
                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-slate-100 text-slate-600 uppercase font-mono">
                      {film.category}
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
              <div className="mt-4 bg-slate-50 border border-slate-100 rounded-lg p-3.5 space-y-2.5">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs text-slate-500">Remaining Demand</span>
                  <span className="text-base font-bold text-slate-900 font-mono">
                    {film.remainingKg.toLocaleString()} <span className="text-xs font-normal text-slate-400">kg</span>
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-200/70 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-slate-900 h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, Math.max(5, film.fulfillmentRate))}%` }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-slate-600">
                  <div>Open Orders: <strong className="font-mono text-slate-800">{film.openOrders}</strong></div>
                  <div>Customers: <strong className="font-mono text-slate-800">{film.customerCount}</strong></div>
                  <div>Completed: <strong className="font-mono text-emerald-600">{film.completedOrders}</strong></div>
                  <div>Plans: <strong className="font-mono text-slate-800">{film.plansCount}</strong></div>
                </div>
              </div>

              {/* Customers Sample */}
              <div className="mt-3 text-[11px] text-slate-500 truncate">
                <span className="text-slate-400 font-medium">Accounts: </span>
                <span className="text-slate-700">{film.customers.slice(0, 3).join(', ')}{film.customers.length > 3 ? '...' : ''}</span>
              </div>
            </div>

            {/* Action CTA */}
            <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-400 font-mono">{film.thickness}µ · ρ {film.density}</span>
              <button
                onClick={() => onPlanFilm(film.code)}
                className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors flex items-center space-x-1.5 cursor-pointer"
              >
                <span>Plan Film</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
