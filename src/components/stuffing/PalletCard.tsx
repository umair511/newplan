import React from 'react';
import { PalletSlotInfo } from '../../types/stuffing';
import { formatCompactPalletSummary } from '../../utils/palletSummary';
import { Package, Eye, Layers } from 'lucide-react';

interface PalletCardProps {
  pallet: PalletSlotInfo;
  variant?: 'slot' | 'manifest';
  onClick?: () => void;
  className?: string;
}

export const PalletCard: React.FC<PalletCardProps> = ({
  pallet,
  variant = 'slot',
  onClick,
  className = '',
}) => {
  const isMixed = pallet.is_mixed;
  const isMixedFilm = pallet.mixed_type === 'mixed_film';
  const isMixedSize = pallet.mixed_type === 'mixed_size';
  const summaryLines = formatCompactPalletSummary(pallet);

  if (variant === 'slot') {
    if (isMixed) {
      return (
        <div
          onClick={onClick}
          className={`flex-1 min-w-[130px] max-w-[220px] bg-amber-950/60 hover:bg-amber-900/70 border-2 border-amber-400 p-2 rounded-lg text-center transition-all hover:scale-102 cursor-pointer shadow-md text-white flex flex-col justify-between ${className}`}
          title={`Click to view full pallet composition for Pallet #${pallet.pallet_number} (${pallet.total_reels} reels)`}
        >
          <div>
            {/* Badges */}
            <div className="flex items-center justify-center gap-1 flex-wrap mb-1">
              <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-500 text-white tracking-wider shadow-xs">
                MIXED PALLET
              </span>
              {isMixedFilm && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-purple-600 text-white tracking-wider shadow-xs">
                  MIXED FILM
                </span>
              )}
              {isMixedSize && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-indigo-600 text-white tracking-wider shadow-xs">
                  MIXED SIZE
                </span>
              )}
            </div>

            {/* Total Reels */}
            <div className="text-[11px] font-bold text-amber-200 font-mono">
              {pallet.total_reels} Reels
            </div>

            {/* Compact composition summary */}
            <div className="text-[10px] font-mono text-amber-100 font-medium leading-tight my-1 space-y-0.5 bg-amber-900/40 p-1 rounded border border-amber-600/40">
              {summaryLines.map((line, idx) => (
                <div key={idx} className="truncate" title={line}>
                  {line}
                </div>
              ))}
            </div>
          </div>

          <div className="text-[9px] text-amber-300/90 font-mono mt-1 pt-1 border-t border-amber-700/50 flex items-center justify-between">
            <span>Pallet #{pallet.pallet_number}</span>
            <span>{pallet.floor_dim || pallet.dims_str?.split('*')[0] || ''} mm</span>
          </div>
        </div>
      );
    }

    // Normal Homogeneous slot card
    return (
      <div
        onClick={onClick}
        className={`flex-1 min-w-[80px] bg-blue-600 hover:bg-blue-500 border border-blue-400 p-2 rounded text-center transition-all hover:scale-105 cursor-pointer shadow-xs ${className}`}
        title={`Pallet #${pallet.pallet_number}: Item ${pallet.primary_item} (${pallet.primary_film} ${pallet.items[0]?.size}mm) - ${pallet.total_reels} reels. Click for details.`}
      >
        <span className="block text-[10px] font-bold text-blue-100">
          Pallet #{pallet.pallet_number} • Item {pallet.primary_item}
        </span>
        <span className="block text-xs font-mono font-bold text-white">
          {pallet.floor_dim || pallet.dims_str?.split('*')[0] || ''} mm
        </span>
        <span className="block text-[9px] font-mono text-blue-200/90">
          {pallet.total_reels}r ({pallet.items[0]?.size || ''}mm)
        </span>
      </div>
    );
  }

  // Manifest variant (full pallet card)
  return (
    <div
      onClick={onClick}
      className={`p-4 rounded-xl border transition-all cursor-pointer shadow-sm hover:shadow-md ${
        isMixed
          ? 'bg-amber-50/50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700/60 hover:border-amber-400'
          : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-blue-400'
      } ${className}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-black text-slate-900 dark:text-white font-mono">
              Pallet #{pallet.pallet_number}
            </span>
            {isMixed ? (
              <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-500 text-white tracking-wider shadow-2xs">
                MIXED PALLET
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200 font-mono">
                HOMOGENEOUS
              </span>
            )}
            {isMixedFilm && (
              <span className="px-2 py-0.5 rounded text-[10px] font-black bg-purple-600 text-white tracking-wider shadow-2xs">
                MIXED FILM
              </span>
            )}
            {isMixedSize && (
              <span className="px-2 py-0.5 rounded text-[10px] font-black bg-indigo-600 text-white tracking-wider shadow-2xs">
                MIXED SIZE
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
            {pallet.row_index ? `Line ${pallet.row_index}` : ''}{pallet.bay_index ? ` • Bay ${pallet.bay_index}` : ''}
            {pallet.orientation === 'rotated' ? ' • Rotated 90°' : ' • Standard'}
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs font-black text-slate-800 dark:text-slate-200 font-mono">
            {pallet.total_reels} Reels
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
            {pallet.total_weight ? `${pallet.total_weight.toLocaleString()} kg` : ''}
          </div>
        </div>
      </div>

      {/* Composition summary section */}
      {isMixed ? (
        <div className="mt-2 bg-amber-100/60 dark:bg-amber-900/30 p-2.5 rounded-lg border border-amber-200 dark:border-amber-800 text-xs font-mono space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-900 dark:text-amber-300">
            Composition Summary:
          </div>
          {summaryLines.map((line, idx) => (
            <div key={idx} className="font-bold text-amber-950 dark:text-amber-100">
              {line}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-xs font-mono text-slate-600 dark:text-slate-300">
          <span className="font-bold text-slate-900 dark:text-white">
            {pallet.primary_film}
          </span> • {pallet.items[0]?.size} mm • {pallet.items[0]?.reels} reels
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between text-[11px] text-slate-400 font-mono">
        <span className="truncate max-w-[200px]" title={pallet.dims_str}>
          {pallet.dims_str}
        </span>
        <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-bold hover:underline">
          <Eye className="w-3.5 h-3.5" />
          <span>Details</span>
        </span>
      </div>
    </div>
  );
};
