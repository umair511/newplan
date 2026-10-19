import React, { useState } from 'react';
import { 
  Disc, 
  Search, 
  Filter, 
  ArrowRight, 
  CheckCircle2, 
  Calendar, 
  Cpu, 
  Layers,
  FileText
} from 'lucide-react';
import { JumboRoll, MetallizerPlan } from '../../types/metallizer';

interface RollConsumptionViewProps {
  jumboRolls: JumboRoll[];
  plans: MetallizerPlan[];
  onOpenPlan: (plan: MetallizerPlan) => void;
}

export const RollConsumptionView: React.FC<RollConsumptionViewProps> = ({
  jumboRolls,
  plans,
  onOpenPlan,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter consumed or partially consumed rolls
  const consumedRolls = jumboRolls.filter(r => r.status === 'CONSUMED' || r.status === 'PARTIALLY_CONSUMED');

  const filteredRolls = consumedRolls.filter(r => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        r.roll_id.toLowerCase().includes(q) ||
        r.film.toLowerCase().includes(q) ||
        (r.consumed_by_plan && r.consumed_by_plan.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="space-y-6" id="msl-consumption-view">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 text-xs font-bold rounded bg-purple-100 text-purple-800">
              AUDIT & TRACEABILITY
            </span>
            <span className="text-xs text-slate-500 font-mono">Sections 16 & 17 Specification</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-1">Jumbo Roll Physical Consumption Log</h1>
          <p className="text-xs text-slate-500">
            Full audit log tracking physical roll consumption by plan number with remaining length verification
          </p>
        </div>

        <div className="text-xs text-slate-600 flex items-center space-x-2">
          <span>Total Consumed Rolls: <b className="text-purple-800 font-mono">{consumedRolls.length}</b></span>
        </div>
      </div>

      {/* Search */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Roll ID, Film Grade, Plan #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Consumption Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600 border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-3 px-3">Roll Identifier</th>
                <th className="py-3 px-3">Film Grade</th>
                <th className="py-3 px-3 text-right">Width (mm)</th>
                <th className="py-3 px-3 text-right">Original Length</th>
                <th className="py-3 px-3 text-right">Remaining Length</th>
                <th className="py-3 px-3 text-right">Thickness</th>
                <th className="py-3 px-3 text-right">Diameter</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-3">Consumed By Plan</th>
                <th className="py-3 px-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRolls.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    No roll consumption history found yet. Execute plans in MSL Studio to view consumption records.
                  </td>
                </tr>
              ) : (
                filteredRolls.map(roll => {
                  const matchingPlan = plans.find(p => p.plan_number === roll.consumed_by_plan || p.jumbo_roll_id === roll.roll_id);
                  return (
                    <tr key={roll.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-3 font-mono font-bold text-slate-900">
                        {roll.roll_id}
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 font-bold rounded bg-purple-50 text-purple-700 border border-purple-200">
                          {roll.film}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                        {roll.width_mm} mm
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-700">
                        {(roll.length_m ?? 0).toLocaleString()} m
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-purple-700">
                        {(roll.remaining_length_m ?? 0).toLocaleString()} m
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-700">
                        {roll.thickness_micron} µm
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-700">
                        {roll.diameter_mm} mm
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={`inline-block px-2.5 py-0.5 text-[10px] font-bold rounded-full ${
                          roll.status === 'CONSUMED' ? 'bg-slate-200 text-slate-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {roll.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-purple-900">
                        {roll.consumed_by_plan || '—'}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {matchingPlan ? (
                          <button
                            onClick={() => onOpenPlan(matchingPlan)}
                            className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded text-xs font-semibold cursor-pointer inline-flex items-center space-x-1"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>View Plan</span>
                          </button>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
