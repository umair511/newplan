import React, { useState, useEffect, useRef } from 'react';
import { Lock, Trash2, AlertTriangle } from 'lucide-react';
import { OrderInput, CalculatedItem, StuffingConfig, PackingMode } from '../../types/stuffing';
import { calculateOrderMetrics } from '../../services/stuffing/stuffingCalculator';
import { lookupFilmSpecs } from '../../services/stuffing/filmDensities';

interface OrderRowProps {
  order: OrderInput;
  index: number;
  config: StuffingConfig;
  planMetric?: CalculatedItem;
  onUpdate: (index: number, field: keyof OrderInput, value: any) => void;
  onDelete: (index: number) => void;
  onOpenFilmSpecs?: (filmCode: string) => void;
}

export const OrderTableRow = React.memo<OrderRowProps>(({
  order,
  index,
  config,
  planMetric,
  onUpdate,
  onDelete,
  onOpenFilmSpecs,
}) => {
  // Local states for text/number inputs to ensure instant 60fps typing without waiting for parent state
  const [localItem, setLocalItem] = useState(order.item ? String(order.item) : String((index + 1) * 10));
  const [localFilm, setLocalFilm] = useState(order.film || '');
  const [localSize, setLocalSize] = useState(order.size && order.size > 0 ? String(order.size) : '');
  const [localLength, setLocalLength] = useState(order.length && order.length > 0 ? String(order.length) : '');
  const [localQty, setLocalQty] = useState(order.qty && order.qty > 0 ? String(order.qty) : '');
  const [localDia, setLocalDia] = useState(order.dia && order.dia > 0 ? String(order.dia) : '');

  const timersRef = useRef<{ [key: string]: ReturnType<typeof setTimeout> }>({});

  const debounceUpdate = (field: keyof OrderInput, value: any, delay: number = 200) => {
    if (timersRef.current[field]) {
      clearTimeout(timersRef.current[field]);
    }
    timersRef.current[field] = setTimeout(() => {
      onUpdate(index, field, value);
      delete timersRef.current[field];
    }, delay);
  };

  const flushUpdate = (field: keyof OrderInput, value: any) => {
    if (timersRef.current[field]) {
      clearTimeout(timersRef.current[field]);
      delete timersRef.current[field];
    }
    onUpdate(index, field, value);
  };

  useEffect(() => {
    return () => {
      // Clear timers on unmount
      Object.values(timersRef.current).forEach(clearTimeout);
    };
  }, []);

  // Keep local states synced with incoming props if they change externally (e.g. sample load / clear / duplicate)
  useEffect(() => {
    setLocalItem(order.item ? String(order.item) : String((index + 1) * 10));
  }, [order.item, index]);

  useEffect(() => {
    setLocalFilm(order.film || '');
  }, [order.film]);

  useEffect(() => {
    setLocalSize(order.size && order.size > 0 ? String(order.size) : '');
  }, [order.size]);

  useEffect(() => {
    setLocalLength(order.length && order.length > 0 ? String(order.length) : '');
  }, [order.length]);

  useEffect(() => {
    setLocalQty(order.qty && order.qty > 0 ? String(order.qty) : '');
  }, [order.qty]);

  useEffect(() => {
    setLocalDia(order.dia && order.dia > 0 ? String(order.dia) : '');
  }, [order.dia]);

  const metric: CalculatedItem = planMetric || calculateOrderMetrics(order, index + 1, config);
  const filmSpecs = lookupFilmSpecs(order.film);
  const allows3 = metric.cradle_ply === 765 && config.container_type !== '20ft';
  const allows8 = metric.cradle_ply === 550 && config.container_type !== '20ft';

  return (
    <tr className={`transition-colors border-b border-slate-200 dark:border-slate-800 ${metric.is_dropped ? 'bg-rose-50/40 hover:bg-rose-50/70 dark:bg-rose-950/30 dark:hover:bg-rose-950/50' : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/60'}`}>
      {/* Item Number */}
      <td className="py-2 px-3 text-center font-mono font-bold text-slate-900 dark:text-slate-100">
        <input
          type="number"
          value={localItem}
          onChange={(e) => {
            const val = e.target.value;
            setLocalItem(val);
            debounceUpdate('item', parseInt(val) || 10, 200);
          }}
          onBlur={() => {
            flushUpdate('item', parseInt(localItem) || 10);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') flushUpdate('item', parseInt(localItem) || 10);
          }}
          className="w-12 text-center py-1 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded font-mono font-bold text-xs text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
        />
      </td>

      {/* Film Grade */}
      <td className="py-2 px-3">
        <div className="flex flex-col">
          <input
            type="text"
            value={localFilm}
            onChange={(e) => {
              const val = e.target.value.toUpperCase();
              setLocalFilm(val);
              debounceUpdate('film', val, 200);
            }}
            onBlur={() => {
              flushUpdate('film', localFilm.toUpperCase());
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') flushUpdate('film', localFilm.toUpperCase());
            }}
            placeholder="e.g. TH21-25"
            className={`w-full px-2 py-1 bg-white dark:bg-slate-800 border rounded font-mono font-bold text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:ring-1 ${
              localFilm && !filmSpecs
                ? 'border-rose-400 dark:border-rose-500 focus:ring-rose-500 focus:border-rose-500 bg-rose-50/40 dark:bg-rose-950/40'
                : 'border-slate-300 dark:border-slate-600 focus:ring-blue-600 focus:border-blue-600'
            }`}
          />
          {filmSpecs ? (
            <span className="text-[10px] text-slate-700 dark:text-slate-300 font-semibold mt-0.5">
              {filmSpecs.thickness}&mu; | {filmSpecs.density} g/cm&sup3;
            </span>
          ) : localFilm ? (
            <div className="flex items-center justify-between text-[10px] text-rose-700 dark:text-rose-400 font-bold mt-0.5">
              <span className="flex items-center gap-0.5">
                <AlertTriangle className="w-3 h-3 text-rose-600 dark:text-rose-400 shrink-0" />
                Not in Master DB
              </span>
              {onOpenFilmSpecs && (
                <button
                  type="button"
                  onClick={() => onOpenFilmSpecs(localFilm)}
                  className="text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 underline font-bold ml-1 cursor-pointer"
                >
                  + Add Spec
                </button>
              )}
            </div>
          ) : (
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
              Enter Film Code
            </span>
          )}
        </div>
      </td>

      {/* Size (mm) */}
      <td className="py-2 px-3">
        <input
          type="number"
          value={localSize}
          onChange={(e) => {
            const val = e.target.value;
            setLocalSize(val);
            const num = parseFloat(val);
            debounceUpdate('size', isNaN(num) ? 0 : num, 250);
          }}
          onBlur={() => {
            const num = parseFloat(localSize);
            flushUpdate('size', isNaN(num) ? 0 : num);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const num = parseFloat(localSize);
              flushUpdate('size', isNaN(num) ? 0 : num);
            }
          }}
          className="w-full px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded font-mono font-bold text-xs text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
        />
      </td>

      {/* Length (m) */}
      <td className="py-2 px-3">
        <input
          type="number"
          value={localLength}
          onChange={(e) => {
            const val = e.target.value;
            setLocalLength(val);
            const num = parseFloat(val);
            debounceUpdate('length', isNaN(num) ? 0 : num, 250);
          }}
          onBlur={() => {
            const num = parseFloat(localLength);
            flushUpdate('length', isNaN(num) ? 0 : num);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const num = parseFloat(localLength);
              flushUpdate('length', isNaN(num) ? 0 : num);
            }
          }}
          className="w-full px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded font-mono font-bold text-xs text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
        />
      </td>

      {/* Core */}
      <td className="py-2 px-3">
        <select
          value={order.core || 6}
          onChange={(e) => onUpdate(index, 'core', parseInt(e.target.value))}
          className="w-full px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded font-mono font-bold text-xs text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
        >
          <option value={3} className="bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">3&quot; (76mm)</option>
          <option value={6} className="bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">6&quot; (152mm)</option>
        </select>
      </td>

      {/* Dia (mm) */}
      <td className="py-2 px-3">
        <div className="flex flex-col">
          <input
            type="number"
            value={localDia !== '' ? localDia : metric.dia}
            onChange={(e) => {
              const val = e.target.value;
              setLocalDia(val);
              const num = parseFloat(val);
              debounceUpdate('dia', isNaN(num) ? 0 : num, 250);
            }}
            onBlur={() => {
              const num = parseFloat(localDia);
              flushUpdate('dia', isNaN(num) ? 0 : num);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const num = parseFloat(localDia);
                flushUpdate('dia', isNaN(num) ? 0 : num);
              }
            }}
            placeholder={`${metric.dia}`}
            title="Roll Diameter (mm). Auto-calculated based on Length, Thickness & Core. Enter 0 or clear to revert to Auto."
            className="w-full px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded font-mono font-bold text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
          />
          <span className="text-[10px] text-slate-700 dark:text-slate-300 font-semibold mt-0.5">
            {order.dia && order.dia > 0 ? 'Custom' : 'Auto'}
          </span>
        </div>
      </td>

      {/* Order Qty (kg) */}
      <td className="py-2 px-3 bg-blue-50/60 dark:bg-blue-950/40">
        <input
          type="number"
          value={localQty}
          onChange={(e) => {
            const val = e.target.value;
            setLocalQty(val);
            const num = parseFloat(val);
            debounceUpdate('qty', isNaN(num) ? 0 : num, 250);
          }}
          onBlur={() => {
            const num = parseFloat(localQty);
            flushUpdate('qty', isNaN(num) ? 0 : num);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const num = parseFloat(localQty);
              flushUpdate('qty', isNaN(num) ? 0 : num);
            }
          }}
          className="w-full px-2.5 py-1 bg-white dark:bg-slate-800 border-2 border-blue-400 dark:border-blue-500 rounded font-mono font-bold text-xs text-blue-950 dark:text-blue-200 focus:ring-2 focus:ring-blue-700"
        />
      </td>

      {/* Packing Mode (HPP / VPP / AUTO) */}
      <td className="py-2 px-3">
        <select
          value={order.packing_mode || 'AUTO'}
          onChange={(e) => onUpdate(index, 'packing_mode', e.target.value as PackingMode)}
          className={`w-full px-2 py-1 rounded font-bold text-[11px] border ${
            metric.packing_mode === 'VPP' 
              ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700' 
              : 'bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-300 border-blue-300 dark:border-blue-700'
          }`}
        >
          <option value="AUTO" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">
            Auto ({metric.packing_mode === 'VPP' ? (order.size <= 120 ? 'VPP (1+1)' : 'VPP') : metric.packing_mode})
          </option>
          <option value="HPP" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">HPP (Cradle)</option>
          <option value="VPP" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">VPP (Eye-to-Sky)</option>
        </select>
      </td>

      {/* Calculated Per Reel Wt */}
      <td className="py-2 px-3 font-mono text-slate-900 dark:text-slate-100 font-bold">
        {metric.per_reel_wt.toFixed(2)} kg
      </td>

      {/* Calculated Planned Reels & Manual Total Reel Count Stepper */}
      <td className="py-2 px-3 font-mono min-w-[170px]">
        <div className="flex flex-col gap-1.5">
          {/* Manual Total Reel Count Control */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <div
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-bold ${
                order.custom_planned_reels !== undefined
                  ? 'bg-indigo-50 dark:bg-indigo-950/70 border-indigo-400 dark:border-indigo-600 text-indigo-950 dark:text-indigo-200 shadow-2xs'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200'
              }`}
            >
              <span className="text-[10px] text-slate-600 dark:text-slate-400 font-semibold">Planned:</span>
              <span
                className={`font-mono font-bold text-xs ${
                  metric.is_dropped
                    ? 'text-rose-700 dark:text-rose-400'
                    : order.custom_planned_reels !== undefined
                    ? 'text-indigo-900 dark:text-indigo-200'
                    : 'text-slate-900 dark:text-slate-100'
                }`}
              >
                {metric.planned_reels} reels
              </span>
              {order.custom_planned_reels !== undefined && (
                <span title="Manual total reel count override active" className="text-[10px] text-indigo-600 dark:text-indigo-400">
                  🔒
                </span>
              )}

              {/* Stepper Buttons [−] [+] */}
              <div className="inline-flex items-center ml-1 border border-slate-300 dark:border-slate-600 rounded overflow-hidden divide-x divide-slate-300 dark:divide-slate-600 bg-white dark:bg-slate-700 shadow-2xs">
                <button
                  type="button"
                  onClick={() => {
                    const current = order.custom_planned_reels !== undefined
                      ? order.custom_planned_reels
                      : (metric.planned_reels > 0 ? metric.planned_reels : 1);
                    const next = Math.max(1, current - 1);
                    onUpdate(index, 'custom_planned_reels', next);
                  }}
                  disabled={(order.custom_planned_reels !== undefined ? order.custom_planned_reels : metric.planned_reels) <= 1}
                  className="px-1.5 py-0.5 text-xs font-bold text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Decrease total planned reels for this row by 1"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const current = order.custom_planned_reels !== undefined
                      ? order.custom_planned_reels
                      : (metric.planned_reels > 0 ? metric.planned_reels : 1);
                    const next = current + 1;
                    onUpdate(index, 'custom_planned_reels', next);
                  }}
                  className="px-1.5 py-0.5 text-xs font-bold text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                  title="Increase total planned reels for this row by 1"
                >
                  +
                </button>
              </div>
            </div>

            {/* Reset to Auto button if manually overridden */}
            {order.custom_planned_reels !== undefined && (
              <button
                type="button"
                onClick={() => onUpdate(index, 'custom_planned_reels', undefined)}
                className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline px-1 py-0.5 rounded hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors"
                title="Reset total planned reels to automatic calculation"
              >
                ↺ Auto
              </button>
            )}
          </div>

          {/* Interactive Reels/Pallet Pill & Smart Hybrid Breakdown */}
          {metric.is_dropped && (
            <div className="flex flex-col gap-0.5 mt-0.5">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 dark:text-rose-400 bg-rose-100 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800 px-1.5 py-0.5 rounded w-fit">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                DROPPED / NOT PALLETIZABLE
              </span>
              <span className="text-[9.5px] text-rose-600 dark:text-rose-400 font-medium leading-tight max-w-[180px]" title={metric.dropped_reason}>
                {metric.dropped_reason || 'Outside ±10% tolerance window.'}
              </span>
            </div>
          )}

          {metric.packing_mode === 'VPP' ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-emerald-800 dark:text-emerald-400 font-semibold mt-0.5">
                {metric.reels_per_pallet} / pal ({metric.vpp_layers || 1} tiers){order.size <= 120 ? ' • 1+1' : ''}
              </span>
              {!metric.is_dropped && (
                <span className="text-[10px] text-emerald-800 dark:text-emerald-400 font-bold font-mono" title={metric.reels_per_pallet_reason}>
                  {metric.pallets_summary || `${metric.total_pallets} pal (VPP)`}
                </span>
              )}
            </div>
          ) : metric.cradle_ply === 550 ? (
            <div className="flex flex-col gap-0.5 mt-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    let next: number | undefined = undefined;
                    if (order.custom_reels_per_pallet === undefined) {
                      next = metric.reels_per_pallet === 6 && allows8 ? 8 : 6;
                    } else if (order.custom_reels_per_pallet === 6) {
                      next = allows8 ? 8 : undefined;
                    } else if (order.custom_reels_per_pallet === 8) {
                      next = metric.reels_per_pallet === 6 ? 6 : undefined;
                    } else {
                      next = undefined;
                    }
                    onUpdate(index, 'custom_reels_per_pallet', next);
                  }}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors flex items-center gap-1 ${
                    order.custom_reels_per_pallet === undefined
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900/60'
                      : 'bg-emerald-600 dark:bg-emerald-700 text-white border-emerald-700 hover:bg-emerald-700'
                  }`}
                  title={`550 Ply: Click to cycle: Auto (${metric.reels_per_pallet}/pal) ${allows8 ? '↔ Force 8' : ''} ↔ Force 6 ↔ Auto`}
                >
                  <span>
                    {order.custom_reels_per_pallet === undefined 
                      ? (metric.reels_per_pallet > 0 ? `⚡ Auto: ${metric.reels_per_pallet} / pal` : '⚡ Auto') 
                      : `🔒 ${order.custom_reels_per_pallet} / pal (550mm ply)`}
                  </span>
                  <span className="text-[9px] opacity-75">
                    {order.custom_reels_per_pallet === undefined 
                      ? (metric.reels_per_pallet === 6 && allows8 ? '→ 8' : '→ 6') 
                      : order.custom_reels_per_pallet === 6 
                      ? (allows8 && metric.reels_per_pallet !== 6 ? '→ 8' : '→ Auto') 
                      : order.custom_reels_per_pallet === 8 
                      ? (metric.reels_per_pallet === 6 ? '→ 6' : '→ Auto')
                      : '→ Auto'}
                  </span>
                </button>
              </div>
              {!metric.is_dropped && (
                <span className="text-[10px] text-emerald-800 dark:text-emerald-400 font-bold font-mono" title={metric.reels_per_pallet_reason}>
                  {metric.pallets_summary || `${metric.total_pallets} pal (550mm ply)`}
                </span>
              )}
            </div>
          ) : metric.cradle_ply === 600 ? (
            <div className="flex flex-col gap-0.5 mt-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const next = order.custom_reels_per_pallet === undefined ? 6 : undefined;
                    onUpdate(index, 'custom_reels_per_pallet', next);
                  }}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors flex items-center gap-1 ${
                    order.custom_reels_per_pallet === undefined
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900/60'
                      : 'bg-emerald-600 dark:bg-emerald-700 text-white border-emerald-700 hover:bg-emerald-700'
                  }`}
                  title="600 Ply: Standard 6 reels/pallet"
                >
                  <span>
                    {order.custom_reels_per_pallet === undefined 
                      ? (metric.reels_per_pallet > 0 ? `⚡ Auto: ${metric.reels_per_pallet} / pal` : '⚡ Auto') 
                      : `🔒 6 / pal (600mm ply)`}
                  </span>
                  <span className="text-[9px] opacity-75">
                    {order.custom_reels_per_pallet === undefined ? '→ 6' : '→ Auto'}
                  </span>
                </button>
              </div>
              {!metric.is_dropped && (
                <span className="text-[10px] text-emerald-800 dark:text-emerald-400 font-bold font-mono" title={metric.reels_per_pallet_reason}>
                  {metric.pallets_summary || `${metric.total_pallets} pal (600mm ply)`}
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5 mt-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    let next: number | undefined = undefined;
                    if (order.custom_reels_per_pallet === undefined) {
                      next = metric.reels_per_pallet === 2 && allows3 ? 3 : 2;
                    } else if (order.custom_reels_per_pallet === 2) {
                      next = allows3 ? 3 : undefined;
                    } else if (order.custom_reels_per_pallet === 3) {
                      next = metric.reels_per_pallet === 2 ? 2 : undefined;
                    } else {
                      next = undefined;
                    }
                    onUpdate(index, 'custom_reels_per_pallet', next);
                  }}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors flex items-center gap-1 ${
                    order.custom_reels_per_pallet === undefined
                      ? metric.reels_per_pallet === 3
                        ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-300 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/60'
                        : 'bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-300 border-blue-300 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/60'
                      : order.custom_reels_per_pallet === 3
                      ? 'bg-amber-500 dark:bg-amber-600 text-white border-amber-600 hover:bg-amber-600'
                      : 'bg-blue-600 dark:bg-blue-700 text-white border-blue-700 hover:bg-blue-700'
                  }`}
                  title="Click to cycle: Auto Optimizer ↔ Force 2 Reels/Pal ↔ Force 3 Reels/Pal"
                >
                  <span>
                    {order.custom_reels_per_pallet === undefined 
                      ? (metric.reels_per_pallet > 0 ? `⚡ Auto: ${metric.reels_per_pallet} / pal` : '⚡ Auto') 
                      : `🔒 ${order.custom_reels_per_pallet} / pal (${metric.cradle_ply}mm ply)`}
                  </span>
                  <span className="text-[9px] opacity-75">
                    {order.custom_reels_per_pallet === undefined 
                      ? (metric.reels_per_pallet === 2 && allows3 ? '→ 3' : '→ 2') 
                      : order.custom_reels_per_pallet === 2 
                      ? (allows3 && metric.reels_per_pallet !== 2 ? '→ 3' : '→ Auto') 
                      : order.custom_reels_per_pallet === 3
                      ? (metric.reels_per_pallet === 2 ? '→ 2' : '→ Auto')
                      : '→ Auto'}
                  </span>
                </button>
              </div>
              {!metric.is_dropped && (
                <span className="text-[10px] text-slate-700 dark:text-slate-300 font-bold font-mono" title={metric.reels_per_pallet_reason}>
                  {metric.pallets_summary || `${metric.total_pallets} pal`}
                </span>
              )}
            </div>
          )}
        </div>
      </td>

      {/* Pallet Dims */}
      <td className="py-2 px-3 font-mono text-[11px]">
        <span className="font-bold text-slate-900 dark:text-slate-100">{metric.pallet_dims_str}</span>
        <span className="block text-[10px] text-slate-600 dark:text-slate-400 font-medium">
          {metric.packing_mode === 'VPP' 
            ? `${metric.pallet_length}*${metric.pallet_width} (${metric.vpp_grid_desc || ''})` 
            : `Ply: ${metric.cradle_ply}mm`}
        </span>
      </td>

      {/* Total Pallets */}
      <td className="py-2 px-3 font-mono font-bold text-indigo-800 dark:text-indigo-400">
        {metric.total_pallets} pal
      </td>

      {/* Excess / Less & Tolerance */}
      <td className="py-2 px-3 font-mono text-xs">
        {order.qty > 0 ? (
          metric.planned_weight > 0 ? (
            (() => {
              const devKg = metric.excess_less;
              const devPct = Number(((devKg / order.qty) * 100).toFixed(1));
              const inTolerance = metric.planned_weight >= (order.qty * 0.90) && metric.planned_weight <= (order.qty * 1.10);
              return (
                <div className="flex flex-col">
                  <span className={`font-bold ${devKg >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                    {devKg > 0 ? `+${devKg.toFixed(0)}` : devKg.toFixed(0)} kg
                  </span>
                  <span className={`text-[10px] font-semibold px-1 py-0.2 rounded w-fit mt-0.5 ${
                    inTolerance 
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700' 
                      : 'bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700'
                  }`}>
                    {devPct >= 0 ? `+${devPct}%` : `${devPct}%`} {inTolerance ? '✓' : '⚠️'}
                  </span>
                </div>
              );
            })()
          ) : (
            <div className="flex flex-col">
              <span className="font-bold text-rose-700 dark:text-rose-400 font-mono">
                {metric.excess_less.toFixed(0)} kg
              </span>
              <span className="text-[10px] font-bold px-1 py-0.2 rounded w-fit mt-0.5 bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700">
                -100% (DROPPED)
              </span>
            </div>
          )
        ) : (
          <span className="text-slate-500 dark:text-slate-400">-</span>
        )}
      </td>

      {/* Delete action */}
      <td className="py-2 px-3 text-center">
        <button
          onClick={() => onDelete(index)}
          className="p-1.5 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
          title="Delete line"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </td>
    </tr>
  );
});
