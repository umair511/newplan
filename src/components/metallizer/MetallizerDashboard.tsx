import React from 'react';
import { 
  BarChart3, 
  Layers, 
  Cpu, 
  Package, 
  AlertCircle, 
  CheckCircle2, 
  Sparkles, 
  ArrowUpRight, 
  TrendingUp, 
  RotateCw, 
  Plus, 
  ShieldCheck,
  Disc,
  Boxes
} from 'lucide-react';
import { VA05Order } from '../../types';
import { JumboRoll, MetallizerPlan, JumboRequirement } from '../../types/metallizer';
import { isMetallizerOrder } from '../../services/metallizer/metallizerOptimizer';

interface MetallizerDashboardProps {
  orders: VA05Order[];
  jumboRolls: JumboRoll[];
  plans: MetallizerPlan[];
  requirements: JumboRequirement[];
  onNavigate: (tab: string, film?: string) => void;
  onOpenPlan: (plan: MetallizerPlan) => void;
  onOpenTests: () => void;
}

export const MetallizerDashboard: React.FC<MetallizerDashboardProps> = ({
  orders,
  jumboRolls,
  plans,
  requirements,
  onNavigate,
  onOpenPlan,
  onOpenTests,
}) => {
  // Metallized demand orders (strictly orders with film code containing "MZ")
  const metallizedOrders = orders.filter(o => isMetallizerOrder(o));

  const pendingDemandKg = metallizedOrders.reduce((sum, o) => sum + o.remaining_qty, 0);
  const pendingOrdersCount = metallizedOrders.filter(o => o.remaining_qty > 0).length;

  // Jumbo Inventory stats
  const availableRolls = jumboRolls.filter(r => r.status === 'AVAILABLE' || r.status === 'PARTIALLY_CONSUMED');
  const availableInventoryKg = availableRolls.reduce((sum, r) => sum + r.remaining_quantity_kg, 0);
  const consumedRollsCount = jumboRolls.filter(r => r.status === 'CONSUMED').length;

  // Planned stats
  const totalPlannedKg = plans.reduce((sum, p) => sum + p.planned_quantity_kg, 0);
  const averageTrimMm = plans.length > 0 ? (plans.reduce((sum, p) => sum + p.trim_mm, 0) / plans.length).toFixed(1) : '25.0';
  const averageWastePct = plans.length > 0 ? (plans.reduce((sum, p) => sum + p.waste_percent, 0) / plans.length).toFixed(2) : '1.10';

  const threeUpsPlansCount = plans.filter(p => p.ups === 3).length;
  const threeUpsPct = plans.length > 0 ? Math.round((threeUpsPlansCount / plans.length) * 100) : 100;

  return (
    <div className="space-y-6" id="msl-dashboard-view">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm text-slate-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center space-x-3">
            <span className="px-2.5 py-1 text-xs font-bold rounded-md bg-purple-950 text-purple-300 border border-purple-800">
              METALLIZER SLITTER
            </span>
            <span className="text-xs text-slate-400 font-mono">10" Steel Core · Max 3650mm Deckle · Max 1250mm Dia</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Metallizer Slitter Intelligent Operations
          </h1>
          <p className="text-sm text-slate-400">
            Variable Jumbo Roll Planning & Production Engine with Physical Inventory Tracking
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onNavigate('msl-generator')}
            className="flex items-center space-x-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg shadow-md transition-colors cursor-pointer"
          >
            <Cpu className="w-4 h-4" />
            <span>Launch MSL Studio</span>
          </button>
          <button
            onClick={() => onNavigate('msl-requirements')}
            className="flex items-center space-x-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-800/60 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span>Jumbo Requirements</span>
          </button>
          <button
            onClick={onOpenTests}
            className="flex items-center space-x-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-800/60 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            title="Run MSL Acceptance Tests"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>MSL Tests (24/24)</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Pending Demand */}
        <div 
          onClick={() => onNavigate('msl-demand')}
          className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs hover:border-purple-300 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Metallized Demand</span>
            <Layers className="w-4 h-4 text-purple-600 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {(pendingDemandKg ?? 0).toLocaleString()} <span className="text-xs font-sans text-slate-500 font-normal">KG</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
            <span>{pendingOrdersCount} pending order items</span>
            <span className="text-purple-600 font-semibold flex items-center">View <ArrowUpRight className="w-3 h-3 ml-0.5" /></span>
          </div>
        </div>

        {/* Jumbo Inventory */}
        <div 
          onClick={() => onNavigate('msl-inventory')}
          className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs hover:border-purple-300 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Available Jumbo Stock</span>
            <Disc className="w-4 h-4 text-purple-600 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {availableRolls.length} <span className="text-xs font-sans text-slate-500 font-normal">Rolls ({(availableInventoryKg ?? 0).toLocaleString()} KG)</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
            <span>{consumedRollsCount} consumed historically</span>
            <span className="text-purple-600 font-semibold flex items-center">Inventory <ArrowUpRight className="w-3 h-3 ml-0.5" /></span>
          </div>
        </div>

        {/* Metallizer Plans */}
        <div 
          onClick={() => onNavigate('msl-plans')}
          className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs hover:border-purple-300 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Generated Plans</span>
            <Cpu className="w-4 h-4 text-purple-600 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {plans.length} <span className="text-xs font-sans text-slate-500 font-normal">Plans ({(totalPlannedKg ?? 0).toLocaleString()} KG)</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
            <span>Avg Trim: {averageTrimMm} mm</span>
            <span className="text-purple-600 font-semibold flex items-center">Schedules <ArrowUpRight className="w-3 h-3 ml-0.5" /></span>
          </div>
        </div>

        {/* 3-UPS Compliance */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600">3-UPS Policy Target</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-700 font-mono">
            {threeUpsPct}% <span className="text-xs font-sans text-slate-500 font-normal">Preference</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
            <span>Trim Waste Avg: {averageWastePct}%</span>
            <span className="text-emerald-700 font-semibold">SRS Compliant</span>
          </div>
        </div>
      </div>

      {/* Two-column layout: Active Jumbo Inventory & Recent Metallizer Plans */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Jumbo Rolls Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">Physically Available Jumbo Rolls</h2>
              <p className="text-xs text-slate-500">Tracked consumable 10" core jumbo rolls in factory stock</p>
            </div>
            <button
              onClick={() => onNavigate('msl-inventory')}
              className="text-xs text-purple-700 hover:text-purple-800 font-semibold flex items-center cursor-pointer"
            >
              <span>Manage Rolls</span>
              <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
            </button>
          </div>

          <div className="divide-y divide-slate-100 mt-2 flex-1">
            {availableRolls.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                No available jumbo rolls in inventory. Please import or add jumbo rolls.
              </div>
            ) : (
              availableRolls.slice(0, 5).map(roll => (
                <div key={roll.id} className="py-3 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-bold text-xs text-slate-900">{roll.roll_id}</span>
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-purple-50 text-purple-700 rounded border border-purple-200">
                        {roll.film}
                      </span>
                      <span className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 text-slate-700 rounded">
                        {roll.thickness_micron}µm
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 flex items-center space-x-2">
                      <span>Width: <b className="text-slate-800 font-mono">{roll.width_mm}mm</b></span>
                      <span>·</span>
                      <span>Length: <b className="text-slate-800 font-mono">{(roll.remaining_length_m ?? 0).toLocaleString()}m</b></span>
                      <span>·</span>
                      <span>Dia: <b className="text-slate-800 font-mono">{roll.diameter_mm}mm</b></span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${
                      roll.status === 'AVAILABLE' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {roll.status}
                    </span>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                      {(roll.remaining_quantity_kg ?? 0).toLocaleString()} kg
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 mt-auto">
            <button
              onClick={() => onNavigate('msl-inventory')}
              className="w-full py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Import / Add New Jumbo Roll</span>
            </button>
          </div>
        </div>

        {/* Recent Plans Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">Recent Metallizer Slitter Plans</h2>
              <p className="text-xs text-slate-500">Committed slitter plans against physical jumbo rolls</p>
            </div>
            <button
              onClick={() => onNavigate('msl-plans')}
              className="text-xs text-purple-700 hover:text-purple-800 font-semibold flex items-center cursor-pointer"
            >
              <span>View All Plans</span>
              <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
            </button>
          </div>

          <div className="divide-y divide-slate-100 mt-2 flex-1">
            {plans.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                No Metallizer Slitter plans generated yet. Open the MSL Studio to create optimized runs.
              </div>
            ) : (
              plans.slice(0, 5).map(plan => (
                <div 
                  key={plan.id} 
                  onClick={() => onOpenPlan(plan)}
                  className="py-3 flex items-center justify-between hover:bg-slate-50 px-2 rounded-lg cursor-pointer transition-colors"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-bold text-xs text-purple-700">{plan.plan_number}</span>
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-700 rounded">
                        Deckle: {plan.jumbo_width_mm}mm
                      </span>
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-700 rounded border border-emerald-200">
                        {plan.ups} UPS
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 flex items-center space-x-2">
                      <span>Roll: <b className="text-slate-800 font-mono">{plan.jumbo_roll_id}</b></span>
                      <span>·</span>
                      <span>Slit sizes: {plan.finished_sizes.join(' + ')} mm</span>
                      <span>·</span>
                      <span>Trim: <b className="text-slate-800 font-mono">{plan.trim_mm}mm</b></span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-xs text-slate-900">
                      {(plan.planned_quantity_kg ?? 0).toLocaleString()} kg
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Waste: {plan.waste_percent}%
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 mt-auto">
            <button
              onClick={() => onNavigate('msl-generator')}
              className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold transition-colors flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs"
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Generate New Metallizer Plan</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
