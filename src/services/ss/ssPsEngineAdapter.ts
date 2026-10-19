/**
 * SS Module ↔ Primary Slitter (PS) Engine adapter
 * ---------------------------------------------------------------------------
 * For TNBPL10 / MATTPL12 the mother jumbo is FIXED at 1705 mm — same class of
 * problem as PS fixed deckle. This adapter runs the real PS engine
 * (deckleOptimizer.generateSsFixedDecklePlans) with:
 *   - deckle / max width = 1705 mm
 *   - GREEN trim = 11–35 mm
 *   - YELLOW / relaxed = 36–45 mm
 * and converts the resulting SlitterPlans into SSJumboRequirement[] so the
 * existing SS Jumbo Requirements UI / inventory handshake still works.
 */

import { VA05Order, SlitterPlan } from '../../types';
import {
  generateSsFixedDecklePlans,
  OptimizationInput,
  OptimizationResult,
} from '../optimizer/deckleOptimizer';
import { SSJumboRequirement, SSMachineSettings } from '../../types/ss';
import { calculateJumboDiameter } from './ssMasterData';

const SS_PS_ENGINE_FILMS = new Set(['TNBPL10', 'MATTPL12']);

export function isSsPsEngineFilm(film: string | undefined | null): boolean {
  if (!film) return false;
  return SS_PS_ENGINE_FILMS.has(String(film).trim().toUpperCase());
}

export type SsPsEngineTrimMode = 'GREEN' | 'YELLOW' | 'CUSTOM';

export interface GenerateSsViaPsEngineOptions {
  film: string;
  orders: VA05Order[];
  settings?: SSMachineSettings;
  /** GREEN = 11–35 (default). YELLOW = 11–45 relaxed. CUSTOM = user min/max. */
  trimMode?: SsPsEngineTrimMode;
  /** Custom trim min (mm). Used when trimMode=CUSTOM, or overrides preset floors. */
  customMinTrimMm?: number;
  /** Custom trim max (mm). Used when trimMode=CUSTOM, or overrides preset ceilings. */
  customMaxTrimMm?: number;
  createdBy?: string;
  priorityOrderIds?: string[];
}

export interface GenerateSsViaPsEngineResult {
  requirements: SSJumboRequirement[];
  plans: SlitterPlan[];
  remaining_orders: VA05Order[];
  logs: OptimizationResult['logs'];
  status: OptimizationResult['status'];
  stop_reason: string;
}

/**
 * Run PS engine on fixed 1705 mm for TNBPL10 / MATTPL12 and map to SS requirements.
 */
export function generateSsJumboRequirementsViaPsEngine(
  options: GenerateSsViaPsEngineOptions
): GenerateSsViaPsEngineResult {
  const film = String(options.film || '').trim().toUpperCase();
  if (!isSsPsEngineFilm(film)) {
    throw new Error(
      `PS Engine option is only available for TNBPL10 and MATTPL12 (got: ${options.film}).`
    );
  }

  const trimMode: SsPsEngineTrimMode = options.trimMode || 'GREEN';
  // Resolve active trim window (same idea as PS MANUAL_OVERRIDE / NORMAL / RELAXED)
  let activeMin = 11;
  let activeMax = 35;
  if (trimMode === 'YELLOW') {
    activeMin = 11;
    activeMax = 45;
  } else if (trimMode === 'CUSTOM') {
    activeMin = Number(options.customMinTrimMm);
    activeMax = Number(options.customMaxTrimMm);
    if (!Number.isFinite(activeMin) || activeMin < 0) activeMin = 11;
    if (!Number.isFinite(activeMax) || activeMax < activeMin) activeMax = Math.max(activeMin, 35);
  } else {
    // GREEN — allow optional override of bounds while keeping preset label
    if (options.customMinTrimMm != null && Number.isFinite(Number(options.customMinTrimMm))) {
      activeMin = Number(options.customMinTrimMm);
    }
    if (options.customMaxTrimMm != null && Number.isFinite(Number(options.customMaxTrimMm))) {
      activeMax = Number(options.customMaxTrimMm);
    }
  }
  activeMin = Math.max(0, Math.round(activeMin));
  activeMax = Math.max(activeMin, Math.round(activeMax));

  const filmOrders = (options.orders || []).filter(o => {
    const f = String(o.film || '').trim().toUpperCase();
    return f === film && Number(o.remaining_qty) > 0.01;
  });

  if (filmOrders.length === 0) {
    return {
      requirements: [],
      plans: [],
      remaining_orders: options.orders || [],
      logs: [
        {
          step: 1,
          message: `No open ${film} orders with remaining quantity.`,
          type: 'WARNING',
        },
      ],
      status: 'NO_FEASIBLE_MATCH',
      stop_reason: 'No open orders',
    };
  }

  const input: OptimizationInput = {
    film,
    films: [film],
    orders: filmOrders,
    planning_mode: 'ALL_REMAINING',
    created_by: options.createdBy || 'SS PS-Engine',
    priority_order_ids: options.priorityOrderIds,
    ss_fixed_deckle_mode: true,
    trim_rule_mode:
      trimMode === 'CUSTOM' || trimMode === 'YELLOW' ? 'MANUAL_OVERRIDE' : 'NORMAL',
    custom_min_trim_mm: activeMin,
    custom_max_trim_mm: activeMax,
    trim_override_reason:
      trimMode === 'CUSTOM'
        ? `SS fixed-1705 CUSTOM trim window ${activeMin}–${activeMax} mm`
        : trimMode === 'YELLOW'
          ? `SS fixed-1705 YELLOW trim window ${activeMin}–${activeMax} mm (relaxed)`
          : activeMin !== 11 || activeMax !== 35
            ? `SS fixed-1705 GREEN trim window ${activeMin}–${activeMax} mm`
            : undefined,
  };

  const result = generateSsFixedDecklePlans(input);
  let requirements = slitterPlansToSsJumboRequirements(
    result.plans,
    film,
    options.settings,
    activeMin,
    activeMax,
    filmOrders
  );
  // Hard cross-plan 1.10 ceiling + coherent rolls/packs/kg
  requirements = enforceCustomerCeilingAndCoherentMetrics(requirements, filmOrders);

  return {
    requirements,
    plans: result.plans,
    remaining_orders: result.remaining_orders,
    logs: result.logs,
    status: result.status,
    stop_reason: result.stop_reason,
  };
}

/**
 * Map each PS SlitterPlan → one SSJumboRequirement (fixed 1705 mother).
 * orders_covered / weights come from the PS plan items (already 1.10-capped).
 */
function slitterPlansToSsJumboRequirements(
  plans: SlitterPlan[],
  film: string,
  settings?: SSMachineSettings,
  trimMinMm: number = 11,
  trimMaxMm: number = 35,
  filmOrders: VA05Order[] = []
): SSJumboRequirement[] {
  const thicknessDefault = settings?.thickness_micron_default || 10;
  const core = settings?.core || '6" paper core';
  const out: SSJumboRequirement[] = [];
  let counter = 1;

  for (const plan of plans) {
    const items = plan.items || [];
    // Finished pattern widths in knife order (unique positions)
    const widthByPos = new Map<number, number>();
    for (const it of items) {
      const pos = it.position ?? 0;
      if (!widthByPos.has(pos) && it.width_mm > 0) {
        widthByPos.set(pos, it.width_mm);
      }
    }
    const finishedWidths =
      widthByPos.size > 0
        ? Array.from(widthByPos.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([, w]) => w)
        : Array.from(new Set(items.map(i => i.width_mm).filter(w => w > 0)));

    // Aggregate orders_covered from items (exact PS allocation)
    const orderMap = new Map<
      string,
      {
        order_id: string;
        sales_order: string | number;
        item_number: number;
        customer: string;
        width_mm: number;
        length_m: number;
        required_reels: number;
        weight_kg: number;
      }
    >();

    for (const it of items) {
      const so = String(it.sales_order || '').replace(/^SO#/i, '').trim();
      const itemNum = Number(it.item_number) || 0;
      const w = Number(it.width_mm) || 0;
      const key = `${so}__${itemNum}__${w}`;
      const existing = orderMap.get(key);
      const reels = Number(it.reels || 0);
      const kg = Number(it.total_weight_kg || 0);
      // Resolve ledger order id so forensic table can match ord.id
      const matchedOrd = filmOrders.find(
        o =>
          String(o.sales_order || '').replace(/^SO#/i, '').trim() === so &&
          Number(o.item_number) === itemNum &&
          (w <= 0 || Number(o.width_mm) === w)
      ) || filmOrders.find(
        o =>
          String(o.sales_order || '').replace(/^SO#/i, '').trim() === so &&
          Number(o.item_number) === itemNum
      );
      const realOrderId = matchedOrd?.id ? String(matchedOrd.id) : '';
      if (existing) {
        existing.required_reels += reels;
        existing.weight_kg = Number((existing.weight_kg + kg).toFixed(2));
        if (!existing.order_id && realOrderId) existing.order_id = realOrderId;
      } else {
        orderMap.set(key, {
          order_id: realOrderId,
          sales_order: so,
          item_number: itemNum,
          customer: it.customer || matchedOrd?.customer || '',
          width_mm: w,
          length_m: it.length_m || plan.length_m || matchedOrd?.length_m || 3600,
          required_reels: reels,
          weight_kg: Number(kg.toFixed(2)),
        });
      }
    }

    const packLengthM = plan.length_m || plan.planned_mr_length_m || 3600;
    // PS engine: repetitions = number of packs run on this deckle setup (authoritative)
    const packCount = Math.max(1, Number(plan.repetitions) || 1);
    // Fixed-1705 SS: jumbo length usually equals pack length → 1 pack per jumbo roll
    const requiredRolls = packCount;
    const thickness = plan.thickness_micron || thicknessDefault;
    const totalWeightKg = Number(
      (plan.planned_quantity_kg ||
        items.reduce((s, it) => s + Number(it.total_weight_kg || 0), 0)).toFixed(2)
    );
    const totalSlit = finishedWidths.reduce((a, b) => a + b, 0);
    const trimMm =
      plan.trim_mm !== undefined && plan.trim_mm !== null
        ? plan.trim_mm
        : Math.max(0, 1705 - totalSlit);
    const diameter = calculateJumboDiameter(thickness, packLengthM);

    // Status vs active planner window (custom or preset)
    const inWindow = trimMm >= trimMinMm && trimMm <= trimMaxMm;
    const trimStatus: 'GREEN' | 'YELLOW' | 'RED' = !inWindow
      ? 'RED'
      : trimMaxMm > 35 || trimMm > 35
        ? 'YELLOW'
        : 'GREEN';

    out.push({
      id: `req-ss-pseng-${Date.now()}-${counter++}`,
      film,
      thickness_micron: thickness,
      required_jumbo_width_mm: 1705,
      required_jumbo_length_m: packLengthM,
      calculated_diameter_mm: diameter,
      core,
      required_rolls_count: requiredRolls,
      ups: finishedWidths.length || plan.ups || 1,
      finished_widths_covered: finishedWidths,
      expected_trim_mm: trimMm,
      trim_width_mm: trimMm,
      orders_covered: Array.from(orderMap.values()) as any,
      package_multiple: 1,
      // Authoritative pack count from PS engine (dashboard must use this, not rolls×sets)
      ...( { ps_pack_count: packCount, source_ps_plan: plan } as any ),
      total_weight_kg: totalWeightKg,
      efficiency_percent: Number(((totalSlit / 1705) * 100).toFixed(1)),
      planning_mode: 'SINGLE',
      compatible_group_key: film,
      ps01_run_index: 1,
      ps01_parent_deckle_id: `ps01-run-ss-fixed-1705-${film}`,
      ps01_feasibility: {
        status: trimStatus,
        is_feasible: trimStatus !== 'RED',
        ps01_deckle_mm: 1705,
        jumbo_width_mm: 1705,
        ps01_ups: 1,
        ps01_cut_combination: [1705],
        ps01_total_width_mm: 1705,
        ps01_trim_mm: 0,
        ps01_deckle_efficiency_percent: 100,
        ps01_duplex_balanced: true,
        side_a_ups: 1,
        side_b_ups: 0,
        relaxation_type: trimStatus === 'YELLOW' ? 'PS01_TRIM_RELAXED' : 'NONE',
        explanation: `SS PS-Engine plan on fixed 1705 mm · ${finishedWidths.length}-UPS · trim ${trimMm} mm (${trimStatus}) · source plan ${plan.plan_number}`,
      },
      is_mutually_feasible: true,
      selected_for_msl: trimStatus !== 'RED',
      created_at: new Date().toISOString(),
      // Carry PS plan id for factory sheet
      ...( { source_ps_plan_id: plan.id, source_ps_plan_number: plan.plan_number } as any ),
    } as SSJumboRequirement);
  }

  return out;
}


/**
 * After PS engine mapping:
 * 1) Aggregate allocated kg per order across all requirements
 * 2) Cap each order at remaining_qty × 1.10 (never breach)
 * 3) Scale order lines proportionally when over
 * 4) Recompute total_weight_kg from orders_covered only
 * 5) Coherent packs/rolls: packs = max(required_reels) across widths in pattern;
 *    for fixed-1705 (1 pack ≈ 1 jumbo) rolls = packs
 */
const CEILING = 1.10;

function enforceCustomerCeilingAndCoherentMetrics(
  requirements: SSJumboRequirement[],
  filmOrders: VA05Order[]
): SSJumboRequirement[] {
  if (!requirements.length) return requirements;

  const orderCeiling = new Map<string, number>();
  const orderDemand = new Map<string, number>();
  for (const o of filmOrders) {
    const key = String(o.id || `${o.sales_order}__${o.item_number}`);
    const demand = Number(o.remaining_qty) || 0;
    orderDemand.set(key, demand);
    orderCeiling.set(key, Number((demand * CEILING).toFixed(2)));
    // Also key by SO+item for item-level match
    const soKey = `${o.sales_order}__${o.item_number}`;
    orderCeiling.set(soKey, Number((demand * CEILING).toFixed(2)));
    orderDemand.set(soKey, demand);
  }

  // Pass 1: total allocated per order key across all reqs
  const allocated = new Map<string, number>();
  for (const req of requirements) {
    for (const oc of req.orders_covered || []) {
      const k1 = String((oc as any).order_id || '');
      const k2 = `${(oc as any).sales_order}__${(oc as any).item_number}`;
      const kg = Number((oc as any).weight_kg) || 0;
      if (k1) allocated.set(k1, (allocated.get(k1) || 0) + kg);
      if (k2) allocated.set(k2, (allocated.get(k2) || 0) + kg);
    }
  }

  // Scale factors per key when over ceiling
  const scaleOf = (key: string, fallbackKey: string): number => {
    const ceil = orderCeiling.get(key) ?? orderCeiling.get(fallbackKey);
    if (ceil === undefined || ceil <= 0) return 1;
    const got = allocated.get(key) ?? allocated.get(fallbackKey) ?? 0;
    if (got <= ceil + 0.05) return 1;
    return ceil / got;
  };

  return requirements.map(req => {
    const covered = (req.orders_covered || []).map(oc => {
      const k1 = String((oc as any).order_id || '');
      const k2 = `${(oc as any).sales_order}__${(oc as any).item_number}`;
      const s = Math.min(scaleOf(k1, k2), scaleOf(k2, k1));
      const weight_kg = Number(((Number((oc as any).weight_kg) || 0) * s).toFixed(2));
      const required_reels = Math.max(0, Math.round((Number((oc as any).required_reels) || 0) * s));
      return { ...oc, weight_kg, required_reels };
    });

    const total_weight_kg = Number(
      covered.reduce((s, oc) => s + (Number((oc as any).weight_kg) || 0), 0).toFixed(2)
    );

    // Packs: PS plan repetitions are authoritative (sheet truth). Do not clamp down to
    // bottleneck reels — that caused card 77 vs sheet 433 mismatches.
    const psPacks =
      Number((req as any).source_ps_plan?.repetitions) ||
      Number((req as any).ps_pack_count) ||
      0;
    let bottleneckReels = 0;
    for (const oc of covered) {
      const r = Number((oc as any).required_reels) || 0;
      if (r > bottleneckReels) bottleneckReels = r;
    }
    const packCount = Math.max(1, psPacks || bottleneckReels || req.required_rolls_count || 1);

    return {
      ...req,
      orders_covered: covered as any,
      total_weight_kg,
      required_rolls_count: packCount,
      ...( { ps_pack_count: packCount } as any ),
    };
  });
}
