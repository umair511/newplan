import React from 'react';
import { PalletSlotInfo } from '../../types/stuffing';
import { Package, Layers, X, CheckCircle2, AlertCircle } from 'lucide-react';

interface PalletDetailsModalProps {
  pallet: PalletSlotInfo | null;
  onClose: () => void;
}

export const PalletDetailsModal: React.FC<PalletDetailsModalProps> = ({ pallet, onClose }) => {
  if (!pallet) return null;

  const isMixed = pallet.is_mixed;
  const isMixedFilm = pallet.mixed_type === 'mixed_film';
  const isMixedSize = pallet.mixed_type === 'mixed_size';

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl font-black text-slate-900 dark:text-white">
                Pallet #{pallet.pallet_number}
              </span>
              {isMixed ? (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black tracking-wide bg-amber-500 text-white shadow-xs">
                  MIXED PALLET
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold tracking-wide bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200">
                  HOMOGENEOUS
                </span>
              )}
              {isMixedFilm && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black tracking-wide bg-purple-600 text-white shadow-xs">
                  MIXED FILM
                </span>
              )}
              {isMixedSize && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black tracking-wide bg-indigo-600 text-white shadow-xs">
                  MIXED SIZE
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              Total: <strong>{pallet.total_reels} Reels</strong> • {pallet.total_weight ? `${pallet.total_weight.toLocaleString()} kg` : ''} 
              {pallet.dims_str ? ` • ${pallet.dims_str}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Location & Container Metadata */}
        <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800 font-mono">
          <div>
            <span className="text-slate-400 block text-[10px] uppercase font-bold">Stowage Location</span>
            <span className="font-bold text-slate-700 dark:text-slate-200">
              {pallet.row_index ? `Line ${pallet.row_index}` : 'Standard'} • {pallet.bay_index ? `Bay ${pallet.bay_index}` : ''}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px] uppercase font-bold">Orientation</span>
            <span className="font-bold text-slate-700 dark:text-slate-200">
              {pallet.orientation === 'rotated' ? 'Rotated 90° (Widthwise)' : 'Standard (Longitudinal)'}
            </span>
          </div>
          {pallet.tier_desc && (
            <div className="col-span-2 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Tier Arrangement</span>
              <span className="font-bold text-emerald-700 dark:text-emerald-400">
                {pallet.tier_desc}
              </span>
            </div>
          )}
        </div>

        {/* Full Pallet Composition List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
            <span className="flex items-center gap-1.5">
              <Package className="w-4 h-4 text-indigo-500" />
              <span>Full Pallet Composition ({pallet.items.length} Reel Groups)</span>
            </span>
            <span className="font-mono text-emerald-600 dark:text-emerald-400">
              {pallet.total_reels} Total Reels
            </span>
          </div>

          <div className="space-y-1.5">
            {pallet.items.map((item, idx) => (
              <div 
                key={idx}
                className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 text-xs transition-colors hover:border-indigo-400"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-black text-indigo-900 dark:text-indigo-300 font-mono">
                      {item.film}
                    </span>
                    <span className="text-slate-400 font-bold">•</span>
                    <span className="font-black text-slate-800 dark:text-slate-200 font-mono">
                      {item.size} mm
                    </span>
                    <span className="text-slate-400 font-bold">•</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                      {item.reels} reels
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                    Item #{item.item} • {item.weight ? `${item.weight.toLocaleString()} kg` : ''}
                    {item.tier_desc ? ` • Tier: ${item.tier_desc}` : ''}
                  </div>
                </div>

                <div className="text-right font-mono">
                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-600">
                    {item.size} × {item.reels}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-mono">
          <span>Physical Pallet ID: #{pallet.pallet_number}</span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 dark:bg-slate-700 text-white font-bold rounded-xl hover:bg-slate-700 dark:hover:bg-slate-600 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
