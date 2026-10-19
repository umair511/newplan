import { 
  VA05Order, 
  PlanningRules, 
  SlitterPlan, 
  PlanItem, 
  PlanChange, 
  PlanSegment, 
  PlanningRun,
  TrimRuleMode 
} from '../../types';
import { calculateSingleReelWeight, calculateWeightHighPrecision, calculateTrimWeight, calculateMillRollWeight } from '../weightCalculator';
import { DEFAULT_PLANNING_RULES, FILM_MASTERS } from '../masterData';
import { resolveFilmDensity, findFilmsMissingDensity } from '../stuffing/filmDensities';
import { generateSsFixedDecklePlans as generateSsFixedDecklePlansFromFrozen } from './deckleOptimizerSsFixed';

export const CUSTOMER_MAX_OVERALLOCATION_FACTOR = 1.10;

/**
 * Maximum allowed single-arm width change (knife shift delta) in SS Fixed-1705 mode.
 * Strictly blocks large jumps like 457mm -> 610mm (153mm). Max jump allowed is 50mm.
 */
export const SS_FIXED_1705_MAX_KNIFE_SHIFT_MM = 50;

export function isPS01Film(filmCode: string | undefined | null): boolean {
  if (!filmCode || typeof filmCode !== 'string') return false;
  const clean = filmCode.trim().toUpperCase();
  if (clean.length === 0) return false;
  if (clean.startsWith('MZ') || clean.includes('MZ')) return false;
  const master = FILM_MASTERS.find(m => m.code.toUpperCase() === clean);
  if (master && master.category === 'METALLIZED') return false;
  return true;
}

export function isSSRoutedByFilmLength(order: { film?: string | null; length_m?: number | null } | undefined | null): boolean {
  if (!order?.film) return false;
  const film = String(order.film).trim().toUpperCase();
  const len = Number(order.length_m);
  if (!Number.isFinite(len) || len <= 0) return false;
  if (film === 'MATTPL12' && Math.abs(len - 3000) < 0.5) return true;
  if (film === 'TNBPL10' && Math.abs(len - 3600) < 0.5) return true;
  return false;
}

export function isPS01Order(order: VA05Order | undefined | null): boolean {
  if (!order) return false;
  if (!isPS01Film(order.film)) return false;
  if (Number(order.width_mm) < 355) return false;
  if (isSSRoutedByFilmLength(order)) return false;
  return true;
}

export interface OptimizationInput {
  film: string;
  films?: string[];
  orders: VA05Order[];
  rules?: PlanningRules;
  target_quantity_kg?: number;
  planning_mode: 'TARGET_QUANTITY' | 'ALL_REMAINING';
  priority_order_ids?: string[];
  run_number?: string;
  created_by?: string;
  trim_rule_mode?: TrimRuleMode;
  custom_min_trim_mm?: number;
  custom_max_trim_mm?: number;
  trim_override_reason?: string;
  ss_fixed_deckle_mode?: boolean;
}

let _ssFixedDeckleMode = false;

function orderPassesPsEngineGate(order: VA05Order | undefined | null): boolean {
  if (!order) return false;
  if (_ssFixedDeckleMode) {
    const film = String(order.film || '').trim().toUpperCase();
    if (film !== 'TNBPL10' && film !== 'MATTPL12') return false;
    return Number(order.remaining_qty) > 0.01 || Number(order.balance_qty) > 0.01;
  }
  return isPS01Order(order);
}

function minIndividualSlitWidthMm(): number {
  return _ssFixedDeckleMode ? 50 : 355;
}

function nominalTrimTargetMm(): number {
  return _ssFixedDeckleMode ? 23 : 186;
}

export interface OptimizationStepLog {
  step: number;
  message: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  data?: any;
}

export interface OptimizationResult {
  run: PlanningRun;
  plans: SlitterPlan[];
  remaining_orders: VA05Order[];
  logs: OptimizationStepLog[];
  status: 'COMPLETED' | 'PARTIALLY_PLANNED' | 'NO_FEASIBLE_MATCH';
  stop_reason: string;
  suggest_trim_relaxation?: boolean;
}

export interface DecklePatternItem {
  orderId: string;
  salesOrder: string;
  itemNumber: number;
  customer: string;
  film?: string;
  width: number;
  length: number;
  ups: number;
  positions: number[];
  position_label: string;
  station?: 'SIDE_A' | 'SIDE_B';
  core: number;
  treatment_side: string;
}

export interface MultiPackSimulationResult {
  initialCombination: DecklePatternItem[];
  selected_length: number;
  is_mixed: boolean;
  is_dual_core?: boolean;
  is_dual_length?: boolean;
  side_a_ups?: number;
  side_b_ups?: number;
  side_a_core?: number;
  side_b_core?: number;
  side_a_length_m?: number;
  side_b_length_m?: number;
  balance_delta?: number;
  totalPacks: number;
  planItems: PlanItem[];
  planChanges: PlanChange[];
  planSegments: PlanSegment[];
  totalPlannedWeightKg: number;
  totalOrderWeightKg: number;
  totalReels: number;
  ordersClosedCount: number;
  priorityOrdersClosed: number;
  totalSlitWidth_mm: number;
  trim_mm: number;
  totalUps: number;
  simulatedOrdersState: Map<string, { remaining_qty: number; produced_qty: number; status: string }>;
  score: number;
  effectiveShiftCount?: number;
  maxBoundaryShiftPeak?: number;
  lookaheadCampaignKg?: number;
  lookaheadTotalPlans?: number;
  lookaheadTotalChanges?: number;
  lookaheadMaxPeakInCampaign?: number;
}

export function formatPositionLabel(positions: number[]): string {
  if (positions.length === 0) return '-';
  if (positions.length === 1) return `${positions[0]}`;
  const sorted = [...positions].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1] !== sorted[i] + 1) return sorted.join(', ');
  }
  return `${sorted[0]}–${sorted[sorted.length - 1]}`;
}

export function calculateEffectiveShiftsAtBoundary(boundaryChanges: { old_width_mm: number; new_width_mm: number }[]): number {
  const realChanges = boundaryChanges.filter(c => Number(c.old_width_mm) !== Number(c.new_width_mm));
  if (realChanges.length <= 1) return realChanges.length;
  let incCount = 0;
  let decCount = 0;
  for (const c of realChanges) {
    const diff = Number(c.new_width_mm) - Number(c.old_width_mm);
    if (diff > 0) incCount++;
    else if (diff < 0) decCount++;
  }
  const compensatingPairs = Math.min(incCount, decCount);
  return compensatingPairs + (realChanges.length - compensatingPairs * 2);
}

export function calculatePlanShiftMetrics(changes: PlanChange[]): { totalEffective: number; maxBoundaryPeak: number } {
  if (!changes || changes.length === 0) return { totalEffective: 0, maxBoundaryPeak: 0 };
  const byBoundary = new Map<number, PlanChange[]>();
  for (const c of changes) {
    const ap = Number(c.after_pack || 0);
    if (ap <= 0) continue;
    let list = byBoundary.get(ap);
    if (!list) { list = []; byBoundary.set(ap, list); }
    list.push(c);
  }
  let totalEffective = 0;
  let maxBoundaryPeak = 0;
  byBoundary.forEach(list => {
    const eff = calculateEffectiveShiftsAtBoundary(list);
    totalEffective += eff;
    if (eff > maxBoundaryPeak) maxBoundaryPeak = eff;
  });
  return { totalEffective, maxBoundaryPeak };
}

export interface DuplexStationAssignment {
  success: boolean;
  items: DecklePatternItem[];
  sideAUps: number;
  sideBUps: number;
  isDualCore: boolean;
  isDualLength: boolean;
  sideACore?: number;
  sideBCore?: number;
  sideALength?: number;
  sideBLength?: number;
}

export function isPlanLengthCompatible(lengths: (number | undefined | null)[]): boolean {
  const validLengths = lengths.filter((l): l is number => typeof l === 'number' && l > 0);
  const distinct = Array.from(new Set(validLengths));
  if (distinct.length <= 1) return true;
  if (distinct.length === 2) {
    const sorted = distinct.sort((a, b) => a - b);
    return Math.abs(sorted[1] - 2 * sorted[0]) < 0.001;
  }
  return false;
}

function shouldElevateDualLength(
  activeOrders: VA05Order[],
  activeLengths: number[],
  prioritySet: Set<string>,
  minTrim: number,
  maxTrim: number,
  deckleWidth: number,
  minUps: number,
  maxUps: number
): boolean {
  if (activeLengths.length < 2) return false;
  for (let i = 0; i < activeLengths.length; i++) {
    for (let j = i + 1; j < activeLengths.length; j++) {
      const a = activeLengths[i];
      const b = activeLengths[j];
      if (!isPlanLengthCompatible([a, b])) continue;
      const [shortLen, longLen] = a < b ? [a, b] : [b, a];
      const shortOrders = activeOrders.filter(o => o.length_m === shortLen && o.remaining_qty > 0.05);
      const longOrders = activeOrders.filter(o => o.length_m === longLen && o.remaining_qty > 0.05);
      const shortHasPrio = shortOrders.some(o => prioritySet.has(o.id) || !!o.priority);
      const longHasPrio = longOrders.some(o => prioritySet.has(o.id) || !!o.priority);
      const shortCombos = shortOrders.length > 0 ? findInitialSameLengthDeckles(shortOrders, minTrim, maxTrim, minUps, maxUps, deckleWidth, shortLen) : [];
      const longCombos = longOrders.length > 0 ? findInitialSameLengthDeckles(longOrders, minTrim, maxTrim, minUps, maxUps, deckleWidth, longLen) : [];
      if ((shortOrders.length > 0 && shortCombos.length === 0) || (longOrders.length > 0 && longCombos.length === 0) || shortHasPrio || longHasPrio) {
        return true;
      }
    }
  }
  return false;
}

export function assignDuplexStations(items: DecklePatternItem[]): DuplexStationAssignment {
  const totalUps = items.reduce((sum, it) => sum + it.ups, 0);
  if (totalUps < 2 || totalUps > 16) {
    return { success: false, items, sideAUps: 0, sideBUps: 0, isDualCore: false, isDualLength: false };
  }

  const hasPreAssigned = items.some(it => it.station === 'SIDE_A') && items.some(it => it.station === 'SIDE_B');
  if (hasPreAssigned) {
    const sideAItems = items.filter(it => it.station === 'SIDE_A');
    const sideBItems = items.filter(it => it.station === 'SIDE_B');
    const sideAUps = sideAItems.reduce((sum, it) => sum + it.ups, 0);
    const sideBUps = sideBItems.reduce((sum, it) => sum + it.ups, 0);
    if (sideAUps <= 8 && sideBUps <= 8 && Math.abs(sideAUps - sideBUps) <= 1) {
      let currentPos = 1;
      const finalItems: DecklePatternItem[] = [];
      sideAItems.forEach(it => {
        const positions: number[] = [];
        for (let u = 0; u < it.ups; u++) positions.push(currentPos++);
        finalItems.push({ ...it, station: 'SIDE_A', positions, position_label: formatPositionLabel(positions) });
      });
      sideBItems.forEach(it => {
        const positions: number[] = [];
        for (let u = 0; u < it.ups; u++) positions.push(currentPos++);
        finalItems.push({ ...it, station: 'SIDE_B', positions, position_label: formatPositionLabel(positions) });
      });
      const coresA = Array.from(new Set(sideAItems.map(it => it.core)));
      const coresB = Array.from(new Set(sideBItems.map(it => it.core)));
      const lensA = Array.from(new Set(sideAItems.map(it => it.length)));
      const lensB = Array.from(new Set(sideBItems.map(it => it.length)));
      if (lensA.length > 1 || lensB.length > 1 || !isPlanLengthCompatible([...lensA, ...lensB])) {
        return { success: false, items, sideAUps: 0, sideBUps: 0, isDualCore: false, isDualLength: false };
      }
      return {
        success: true, items: finalItems, sideAUps, sideBUps,
        isDualCore: coresA.length === 1 && coresB.length === 1 && coresA[0] !== coresB[0],
        isDualLength: lensA.length === 1 && lensB.length === 1 && lensA[0] !== lensB[0],
        sideACore: coresA[0], sideBCore: coresB[0], sideALength: lensA[0], sideBLength: lensB[0],
      };
    }
  }

  const targetSideAUps = Math.ceil(totalUps / 2);
  const targetSideBUps = Math.floor(totalUps / 2);
  if (targetSideAUps > 8 || targetSideBUps > 8) {
    return { success: false, items, sideAUps: 0, sideBUps: 0, isDualCore: false, isDualLength: false };
  }

  const unrolledUnits: { item: DecklePatternItem; index: number }[] = [];
  items.forEach((it, idx) => { for (let u = 0; u < it.ups; u++) unrolledUnits.push({ item: it, index: idx }); });

  const distinctCores = Array.from(new Set(items.map(it => it.core)));
  const distinctLengths = Array.from(new Set(items.map(it => it.length)));
  if (!isPlanLengthCompatible(distinctLengths)) {
    return { success: false, items, sideAUps: 0, sideBUps: 0, isDualCore: false, isDualLength: false };
  }

  if (distinctCores.length === 2) {
    const [coreA, coreB] = distinctCores;
    const unitsA = unrolledUnits.filter(u => u.item.core === coreA);
    const unitsB = unrolledUnits.filter(u => u.item.core === coreB);
    if (unitsA.length > 8 || unitsB.length > 8 || Math.abs(unitsA.length - unitsB.length) > 1) {
      return { success: false, items, sideAUps: 0, sideBUps: 0, isDualCore: false, isDualLength: false };
    }
    const lensA = Array.from(new Set(unitsA.map(u => u.item.length)));
    const lensB = Array.from(new Set(unitsB.map(u => u.item.length)));
    if (lensA.length > 1 || lensB.length > 1 || !isPlanLengthCompatible([...lensA, ...lensB])) {
      return { success: false, items, sideAUps: 0, sideBUps: 0, isDualCore: false, isDualLength: false };
    }
    let currentPos = 1;
    const remappedItems: DecklePatternItem[] = [];
    items.filter(it => it.core === coreA).forEach(it => {
      const positions: number[] = [];
      for (let u = 0; u < it.ups; u++) positions.push(currentPos++);
      remappedItems.push({ ...it, station: 'SIDE_A', positions, position_label: formatPositionLabel(positions) });
    });
    items.filter(it => it.core === coreB).forEach(it => {
      const positions: number[] = [];
      for (let u = 0; u < it.ups; u++) positions.push(currentPos++);
      remappedItems.push({ ...it, station: 'SIDE_B', positions, position_label: formatPositionLabel(positions) });
    });
    return {
      success: true, items: remappedItems, sideAUps: unitsA.length, sideBUps: unitsB.length,
      isDualCore: true, isDualLength: lensA[0] !== lensB[0],
      sideACore: coreA, sideBCore: coreB, sideALength: lensA[0], sideBLength: lensB[0],
    };
  }

  if (distinctLengths.length === 2) {
    const [lenA, lenB] = distinctLengths;
    const unitsA = unrolledUnits.filter(u => u.item.length === lenA);
    const unitsB = unrolledUnits.filter(u => u.item.length === lenB);
    if (unitsA.length > 8 || unitsB.length > 8 || Math.abs(unitsA.length - unitsB.length) > 1 || distinctCores.length > 2) {
      return { success: false, items, sideAUps: 0, sideBUps: 0, isDualCore: false, isDualLength: false };
    }
    const coresA = Array.from(new Set(unitsA.map(u => u.item.core)));
    const coresB = Array.from(new Set(unitsB.map(u => u.item.core)));
    if (coresA.length > 1 || coresB.length > 1) {
      return { success: false, items, sideAUps: 0, sideBUps: 0, isDualCore: false, isDualLength: false };
    }
    let currentPos = 1;
    const remappedItems: DecklePatternItem[] = [];
    items.filter(it => it.length === lenA).forEach(it => {
      const positions: number[] = [];
      for (let u = 0; u < it.ups; u++) positions.push(currentPos++);
      remappedItems.push({ ...it, station: 'SIDE_A', positions, position_label: formatPositionLabel(positions) });
    });
    items.filter(it => it.length === lenB).forEach(it => {
      const positions: number[] = [];
      for (let u = 0; u < it.ups; u++) positions.push(currentPos++);
      remappedItems.push({ ...it, station: 'SIDE_B', positions, position_label: formatPositionLabel(positions) });
    });
    return {
      success: true, items: remappedItems, sideAUps: unitsA.length, sideBUps: unitsB.length,
      isDualCore: distinctCores.length === 2, isDualLength: true,
      sideACore: coresA[0], sideBCore: coresB[0], sideALength: lenA, sideBLength: lenB,
    };
  }

  if (distinctCores.length >= 2 || distinctLengths.length > 2) {
    return { success: false, items, sideAUps: 0, sideBUps: 0, isDualCore: false, isDualLength: false };
  }

  let assignedA = 0;
  let currentPos = 1;
  const remappedItems: DecklePatternItem[] = [];
  items.forEach(it => {
    const itemUps = it.ups;
    if (assignedA + itemUps <= targetSideAUps) {
      const positions: number[] = [];
      for (let u = 0; u < itemUps; u++) positions.push(currentPos++);
      assignedA += itemUps;
      remappedItems.push({ ...it, station: 'SIDE_A', positions, position_label: formatPositionLabel(positions) });
    } else if (assignedA >= targetSideAUps) {
      const positions: number[] = [];
      for (let u = 0; u < itemUps; u++) positions.push(currentPos++);
      remappedItems.push({ ...it, station: 'SIDE_B', positions, position_label: formatPositionLabel(positions) });
    } else {
      const upsForA = targetSideAUps - assignedA;
      const upsForB = itemUps - upsForA;
      const posA: number[] = [];
      for (let u = 0; u < upsForA; u++) posA.push(currentPos++);
      assignedA += upsForA;
      remappedItems.push({ ...it, ups: upsForA, station: 'SIDE_A', positions: posA, position_label: formatPositionLabel(posA) });
      const posB: number[] = [];
      for (let u = 0; u < upsForB; u++) posB.push(currentPos++);
      remappedItems.push({ ...it, ups: upsForB, station: 'SIDE_B', positions: posB, position_label: formatPositionLabel(posB) });
    }
  });

  return {
    success: true, items: remappedItems, sideAUps: targetSideAUps, sideBUps: targetSideBUps,
    isDualCore: false, isDualLength: false,
    sideACore: items[0]?.core, sideBCore: items[0]?.core,
    sideALength: items[0]?.length, sideBLength: items[0]?.length,
  };
}

export function generateValidWidthCombinations(
  distinctWidthsDesc: number[],
  minSlitWidth: number,
  maxSlitWidth: number,
  minUps: number = 3,
  maxUps: number = 16,
  maxTotalPatterns: number = 3500,
  minIndividualWidth: number = 355,
  deckleWidth: number = 10400
): { widthCombo: number[]; totalWidth: number }[] {
  const validWidthsDesc = distinctWidthsDesc.filter(w => w >= minIndividualWidth);
  if (validWidthsDesc.length === 0) return [];

  const maxWidth = validWidthsDesc[0];
  const minWidth = validWidthsDesc[validWidthsDesc.length - 1];
  const nominalSlitTotal = deckleWidth - nominalTrimTargetMm();
  const bucketMap = new Map<string, { widthCombo: number[]; totalWidth: number; score: number }[]>();
  const maxPerBucket = Math.max(55, Math.ceil(maxTotalPatterns / 24));
  let currentComboRef: number[] = [];

  function getBucketKey(ups: number, totalWidth: number): string {
    const trim = deckleWidth - totalWidth;
    const nom = nominalTrimTargetMm();
    const distinctCount = new Set(currentComboRef).size >= 3 ? 'div' : 'std';
    const trimBin = Math.abs(trim - nom) <= 6 ? 0 : trim > nom ? 2 : 1;
    return `${ups}-${trimBin}-${distinctCount}`;
  }

  function bnbSearch(startIndex: number, currentCombo: number[], currentWidth: number, currentUps: number) {
    if (currentUps > maxUps || currentWidth > maxSlitWidth) return;
    if (currentUps >= minUps && currentWidth >= minSlitWidth && currentWidth <= maxSlitWidth) {
      currentComboRef = currentCombo;
      const bucketKey = getBucketKey(currentUps, currentWidth);
      let bucket = bucketMap.get(bucketKey);
      if (!bucket) { bucket = []; bucketMap.set(bucketKey, bucket); }
      const score = Math.abs(currentWidth - nominalSlitTotal);
      if (bucket.length < maxPerBucket) {
        bucket.push({ widthCombo: [...currentCombo], totalWidth: currentWidth, score });
      } else {
        let worstIdx = 0;
        let worstScore = bucket[0].score;
        for (let i = 1; i < bucket.length; i++) {
          if (bucket[i].score > worstScore) { worstScore = bucket[i].score; worstIdx = i; }
        }
        if (score < worstScore) {
          bucket[worstIdx] = { widthCombo: [...currentCombo], totalWidth: currentWidth, score };
        }
      }
    }
    if (currentUps >= maxUps) return;
    if (currentWidth + maxWidth * (maxUps - currentUps) < minSlitWidth) return;
    if (currentWidth + minWidth > maxSlitWidth) return;

    for (let i = startIndex; i < validWidthsDesc.length; i++) {
      const w = validWidthsDesc[i];
      if (currentWidth + w <= maxSlitWidth) {
        currentCombo.push(w);
        bnbSearch(i, currentCombo, currentWidth + w, currentUps + 1);
        currentCombo.pop();
      }
    }
  }

  bnbSearch(0, [], 0, 0);
  const allPatterns: { widthCombo: number[]; totalWidth: number; score: number }[] = [];
  bucketMap.forEach(bucket => allPatterns.push(...bucket));

  return allPatterns
    .sort((a, b) => a.score - b.score || a.widthCombo.length - b.widthCombo.length)
    .slice(0, maxTotalPatterns)
    .map(p => ({ widthCombo: p.widthCombo, totalWidth: p.totalWidth }));
}

export function findInitialSameLengthDeckles(
  eligibleOrders: VA05Order[],
  minTrim: number,
  maxTrim: number,
  minUps: number,
  maxUps: number,
  deckleWidth: number,
  targetLength: number,
  maxCandidatePool: number = 3500
): DecklePatternItem[][] {
  let lengthOrders = eligibleOrders
    .filter(o => {
      if (o.remaining_qty <= 0.01 || o.length_m !== targetLength || !orderPassesPsEngineGate(o)) return false;
      const singleReelKg = calculateSingleReelWeight(o.width_mm, o.thickness_micron || 20, o.density || resolveFilmDensity(o.film) || 0.91, o.length_m);
      return singleReelKg <= o.remaining_qty * CUSTOMER_MAX_OVERALLOCATION_FACTOR + 0.0001;
    })
    .sort((a, b) => b.width_mm - a.width_mm);

  if (lengthOrders.length === 0) return [];

  let poolLimit = maxCandidatePool;
  if (_ssFixedDeckleMode) {
    poolLimit = Math.min(maxCandidatePool, 600);
    const kgByWidth = new Map<number, number>();
    for (const o of lengthOrders) kgByWidth.set(o.width_mm, (kgByWidth.get(o.width_mm) || 0) + Number(o.remaining_qty || 0));
    const topSet = new Set(Array.from(kgByWidth.entries()).sort((a, b) => b[1] - a[1]).slice(0, 28).map(([w]) => w));
    lengthOrders = lengthOrders.filter(o => topSet.has(o.width_mm));
  }

  const distinctWidths = Array.from(new Set(lengthOrders.map(o => o.width_mm))).sort((a, b) => b - a);
  const minSlitWidth = deckleWidth - maxTrim;
  const maxSlitWidth = deckleWidth - minTrim;

  const validPatterns = generateValidWidthCombinations(
    distinctWidths, minSlitWidth, maxSlitWidth, minUps, maxUps, poolLimit, minIndividualSlitWidthMm(), deckleWidth
  );

  const concreteCombinations: DecklePatternItem[][] = [];

  validPatterns.forEach(pat => {
    const widthCounts = new Map<number, number>();
    pat.widthCombo.forEach(w => widthCounts.set(w, (widthCounts.get(w) || 0) + 1));

    // Variant 1: Smallest balance first
    let pos1 = 1;
    const itemsClosure: DecklePatternItem[] = [];
    let possible1 = true;
    for (const [w, neededUps] of Array.from(widthCounts.entries())) {
      const matchingOrders = lengthOrders
        .filter(o => o.width_mm === w)
        .sort((a, b) => ((b.priority ? 1 : 0) - (a.priority ? 1 : 0)) || (a.remaining_qty - b.remaining_qty));
      if (matchingOrders.length === 0) { possible1 = false; break; }
      let assignedUps = 0;
      for (const ord of matchingOrders) {
        if (assignedUps >= neededUps) break;
        const reelW = calculateSingleReelWeight(w, ord.thickness_micron || 20, ord.density || resolveFilmDensity(ord.film) || 0, ord.length_m) || 1;
        const actualUps = Math.min(neededUps - assignedUps, Math.max(1, Math.floor(ord.remaining_qty / reelW) || 1));
        const positions: number[] = [];
        for (let u = 0; u < actualUps; u++) positions.push(pos1++);
        itemsClosure.push({
          orderId: ord.id, salesOrder: ord.sales_order, itemNumber: ord.item_number, customer: ord.customer,
          film: ord.film, width: ord.width_mm, length: ord.length_m, ups: actualUps,
          positions, position_label: formatPositionLabel(positions), core: ord.core, treatment_side: ord.treatment_side,
        });
        assignedUps += actualUps;
      }
      if (assignedUps < neededUps) {
        const fallbackOrd = matchingOrders[0];
        const diff = neededUps - assignedUps;
        const positions: number[] = [];
        for (let u = 0; u < diff; u++) positions.push(pos1++);
        itemsClosure.push({
          orderId: fallbackOrd.id, salesOrder: fallbackOrd.sales_order, itemNumber: fallbackOrd.item_number, customer: fallbackOrd.customer,
          film: fallbackOrd.film, width: fallbackOrd.width_mm, length: fallbackOrd.length_m, ups: diff,
          positions, position_label: formatPositionLabel(positions), core: fallbackOrd.core, treatment_side: fallbackOrd.treatment_side,
        });
      }
    }
    if (possible1 && itemsClosure.length > 0) concreteCombinations.push(itemsClosure);

    // Variant 2: Largest Volume first
    let pos2 = 1;
    const itemsVolume: DecklePatternItem[] = [];
    let possible2 = true;
    for (const [w, neededUps] of Array.from(widthCounts.entries())) {
      const matchingOrders = lengthOrders
        .filter(o => o.width_mm === w)
        .sort((a, b) => ((b.priority ? 1 : 0) - (a.priority ? 1 : 0)) || (b.remaining_qty - a.remaining_qty));
      if (matchingOrders.length === 0) { possible2 = false; break; }
      const primaryOrd = matchingOrders[0];
      const positions: number[] = [];
      for (let u = 0; u < neededUps; u++) positions.push(pos2++);
      itemsVolume.push({
        orderId: primaryOrd.id, salesOrder: primaryOrd.sales_order, itemNumber: primaryOrd.item_number, customer: primaryOrd.customer,
        film: primaryOrd.film, width: primaryOrd.width_mm, length: primaryOrd.length_m, ups: neededUps,
        positions, position_label: formatPositionLabel(positions), core: primaryOrd.core, treatment_side: primaryOrd.treatment_side,
      });
    }
    if (possible2 && itemsVolume.length > 0) concreteCombinations.push(itemsVolume);

    // Variant 3: Pack-Life Synchronized Allocation
    let targetSyncPacks = 0;
    const packEstimates: number[] = [];
    for (const [w, neededUps] of Array.from(widthCounts.entries())) {
      const topOrd = lengthOrders.find(o => o.width_mm === w);
      if (topOrd) {
        const reelW = calculateSingleReelWeight(w, topOrd.thickness_micron || 20, topOrd.density || resolveFilmDensity(topOrd.film) || 0, topOrd.length_m) || 1;
        packEstimates.push(Math.max(1, Math.round(topOrd.remaining_qty / (reelW * neededUps))));
      }
    }
    if (packEstimates.length > 0) {
      packEstimates.sort((a, b) => a - b);
      targetSyncPacks = packEstimates[Math.floor(packEstimates.length / 2)];
    }
    if (targetSyncPacks >= 2) {
      let pos4 = 1;
      const itemsSync: DecklePatternItem[] = [];
      let possible4 = true;
      for (const [w, neededUps] of Array.from(widthCounts.entries())) {
        const matchingOrders = lengthOrders
          .filter(o => o.width_mm === w)
          .sort((a, b) => {
            const reelW_a = calculateSingleReelWeight(w, a.thickness_micron || 20, a.density || resolveFilmDensity(a.film) || 0, a.length_m) || 1;
            const reelW_b = calculateSingleReelWeight(w, b.thickness_micron || 20, b.density || resolveFilmDensity(b.film) || 0, b.length_m) || 1;
            const diffA = Math.abs(a.remaining_qty / (reelW_a * neededUps) - targetSyncPacks);
            const diffB = Math.abs(b.remaining_qty / (reelW_b * neededUps) - targetSyncPacks);
            return Math.abs(diffA - diffB) > 0.25 ? diffA - diffB : b.remaining_qty - a.remaining_qty;
          });
        if (matchingOrders.length === 0) { possible4 = false; break; }
        const chosenOrd = matchingOrders[0];
        const positions: number[] = [];
        for (let u = 0; u < neededUps; u++) positions.push(pos4++);
        itemsSync.push({
          orderId: chosenOrd.id, salesOrder: chosenOrd.sales_order, itemNumber: chosenOrd.item_number, customer: chosenOrd.customer,
          film: chosenOrd.film, width: chosenOrd.width_mm, length: chosenOrd.length_m, ups: neededUps,
          positions, position_label: formatPositionLabel(positions), core: chosenOrd.core, treatment_side: chosenOrd.treatment_side,
        });
      }
      if (possible4 && itemsSync.length > 0) concreteCombinations.push(itemsSync);
    }

    // Variant 5: Proportional Starting UPS (Capped at <= 50mm in SS 1705 mode)
    const maxBlendDiff = _ssFixedDeckleMode ? SS_FIXED_1705_MAX_KNIFE_SHIFT_MM : 120;
    for (const [wDominant, domUps] of Array.from(widthCounts.entries())) {
      if (domUps < 2) continue;
      const ordDom = lengthOrders.find(o => o.width_mm === wDominant);
      if (!ordDom) continue;
      const closeAltOrders = lengthOrders.filter(
        o => o.width_mm !== wDominant && Math.abs(o.width_mm - wDominant) <= maxBlendDiff && o.core === ordDom.core && !widthCounts.has(o.width_mm)
      );
      for (const ordAlt of closeAltOrders) {
        const totalPairKg = ordDom.remaining_qty + ordAlt.remaining_qty;
        if (totalPairKg <= 0) continue;
        let altUps = Math.round(domUps * (ordAlt.remaining_qty / totalPairKg));
        if (altUps < 1) altUps = 1;
        if (altUps >= domUps) altUps = domUps - 1;
        const newDomUps = domUps - altUps;
        const newTotalSlit = pat.totalWidth - altUps * wDominant + altUps * ordAlt.width_mm;
        if (newTotalSlit < minSlitWidth || newTotalSlit > maxSlitWidth) continue;

        let pos5 = 1;
        const itemsBlended: DecklePatternItem[] = [];
        let possible5 = true;
        for (const [w, neededUps] of Array.from(widthCounts.entries())) {
          if (w === wDominant) {
            const posDom: number[] = [];
            for (let u = 0; u < newDomUps; u++) posDom.push(pos5++);
            itemsBlended.push({
              orderId: ordDom.id, salesOrder: ordDom.sales_order, itemNumber: ordDom.item_number, customer: ordDom.customer,
              film: ordDom.film, width: ordDom.width_mm, length: ordDom.length_m, ups: newDomUps,
              positions: posDom, position_label: formatPositionLabel(posDom), core: ordDom.core, treatment_side: ordDom.treatment_side,
            });
            const posAlt: number[] = [];
            for (let u = 0; u < altUps; u++) posAlt.push(pos5++);
            itemsBlended.push({
              orderId: ordAlt.id, salesOrder: ordAlt.sales_order, itemNumber: ordAlt.item_number, customer: ordAlt.customer,
              film: ordAlt.film, width: ordAlt.width_mm, length: ordAlt.length_m, ups: altUps,
              positions: posAlt, position_label: formatPositionLabel(posAlt), core: ordAlt.core, treatment_side: ordAlt.treatment_side,
            });
          } else {
            const matchOrd = lengthOrders.find(o => o.width_mm === w);
            if (!matchOrd) { possible5 = false; break; }
            const positions: number[] = [];
            for (let u = 0; u < neededUps; u++) positions.push(pos5++);
            itemsBlended.push({
              orderId: matchOrd.id, salesOrder: matchOrd.sales_order, itemNumber: matchOrd.item_number, customer: matchOrd.customer,
              film: matchOrd.film, width: matchOrd.width_mm, length: matchOrd.length_m, ups: neededUps,
              positions, position_label: formatPositionLabel(positions), core: matchOrd.core, treatment_side: matchOrd.treatment_side,
            });
          }
        }
        if (possible5 && itemsBlended.length > 0) concreteCombinations.push(itemsBlended);
      }
    }
  });

  return concreteCombinations.slice(0, maxCandidatePool * 5);
}

export function findDuplexDualLengthDeckles(
  eligibleOrders: VA05Order[],
  minTrim: number,
  maxTrim: number,
  deckleWidth: number,
  lengthA: number,
  lengthB: number
): DecklePatternItem[][] {
  if (!isPlanLengthCompatible([lengthA, lengthB])) return [];
  const ordersA = eligibleOrders
    .filter(o => {
      if (o.remaining_qty <= 0.01 || o.length_m !== lengthA || !orderPassesPsEngineGate(o)) return false;
      const singleReelKg = calculateSingleReelWeight(o.width_mm, o.thickness_micron || 20, o.density || resolveFilmDensity(o.film) || 0.91, o.length_m);
      return singleReelKg <= o.remaining_qty * CUSTOMER_MAX_OVERALLOCATION_FACTOR + 0.0001;
    })
    .sort((a, b) => b.width_mm - a.width_mm);
  const ordersB = eligibleOrders
    .filter(o => {
      if (o.remaining_qty <= 0.01 || o.length_m !== lengthB || !orderPassesPsEngineGate(o)) return false;
      const singleReelKg = calculateSingleReelWeight(o.width_mm, o.thickness_micron || 20, o.density || resolveFilmDensity(o.film) || 0.91, o.length_m);
      return singleReelKg <= o.remaining_qty * CUSTOMER_MAX_OVERALLOCATION_FACTOR + 0.0001;
    })
    .sort((a, b) => b.width_mm - a.width_mm);

  if (ordersA.length === 0 || ordersB.length === 0) return [];
  const widthsA = Array.from(new Set(ordersA.map(o => o.width_mm))).sort((a, b) => b - a);
  const widthsB = Array.from(new Set(ordersB.map(o => o.width_mm))).sort((a, b) => b - a);
  const minSlitWidth = deckleWidth - maxTrim;
  const maxSlitWidth = deckleWidth - minTrim;

  const bucketsA = new Map<number, { widths: number[]; totalWidth: number; ups: number }[]>();
  function searchA(startIndex: number, current: number[], currentW: number, ups: number) {
    if (ups >= 2 && ups <= 8 && currentW <= maxSlitWidth) {
      let b = bucketsA.get(ups);
      if (!b) { b = []; bucketsA.set(ups, b); }
      if (b.length < 140) b.push({ widths: [...current], totalWidth: currentW, ups });
    }
    if (ups >= 8) return;
    for (let i = startIndex; i < widthsA.length; i++) {
      if (currentW + widthsA[i] <= maxSlitWidth) {
        current.push(widthsA[i]);
        searchA(i, current, currentW + widthsA[i], ups + 1);
        current.pop();
      }
    }
  }
  searchA(0, [], 0, 0);
  const combosA = Array.from(bucketsA.values()).flat();

  const bucketsB = new Map<number, { widths: number[]; totalWidth: number; ups: number }[]>();
  function searchB(startIndex: number, current: number[], currentW: number, ups: number) {
    if (ups >= 2 && ups <= 8 && currentW <= maxSlitWidth) {
      let b = bucketsB.get(ups);
      if (!b) { b = []; bucketsB.set(ups, b); }
      if (b.length < 140) b.push({ widths: [...current], totalWidth: currentW, ups });
    }
    if (ups >= 8) return;
    for (let i = startIndex; i < widthsB.length; i++) {
      if (currentW + widthsB[i] <= maxSlitWidth) {
        current.push(widthsB[i]);
        searchB(i, current, currentW + widthsB[i], ups + 1);
        current.pop();
      }
    }
  }
  searchB(0, [], 0, 0);
  const combosB = Array.from(bucketsB.values()).flat();

  const balancedDeckles: DecklePatternItem[][] = [];
  for (const cA of combosA) {
    for (const cB of combosB) {
      if (balancedDeckles.length >= 1200) break;
      if (Math.abs(cA.ups - cB.ups) > 1) continue;
      const combinedWidth = cA.totalWidth + cB.totalWidth;
      if (combinedWidth >= minSlitWidth && combinedWidth <= maxSlitWidth) {
        let pos = 1;
        const mappedItemsA: DecklePatternItem[] = [];
        const widthMapA = new Map<number, number>();
        cA.widths.forEach(w => widthMapA.set(w, (widthMapA.get(w) || 0) + 1));
        let validA = true;
        for (const [w, neededUps] of Array.from(widthMapA.entries())) {
          const matchOrd = ordersA.find(o => o.width_mm === w);
          if (!matchOrd) { validA = false; break; }
          const positions: number[] = [];
          for (let u = 0; u < neededUps; u++) positions.push(pos++);
          mappedItemsA.push({
            orderId: matchOrd.id, salesOrder: matchOrd.sales_order, itemNumber: matchOrd.item_number, customer: matchOrd.customer,
            film: matchOrd.film, width: matchOrd.width_mm, length: matchOrd.length_m, ups: neededUps,
            positions, position_label: formatPositionLabel(positions), station: 'SIDE_A', core: matchOrd.core, treatment_side: matchOrd.treatment_side,
          });
        }
        if (!validA) continue;
        const mappedItemsB: DecklePatternItem[] = [];
        const widthMapB = new Map<number, number>();
        cB.widths.forEach(w => widthMapB.set(w, (widthMapB.get(w) || 0) + 1));
        let validB = true;
        for (const [w, neededUps] of Array.from(widthMapB.entries())) {
          const matchOrd = ordersB.find(o => o.width_mm === w);
          if (!matchOrd) { validB = false; break; }
          const positions: number[] = [];
          for (let u = 0; u < neededUps; u++) positions.push(pos++);
          mappedItemsB.push({
            orderId: matchOrd.id, salesOrder: matchOrd.sales_order, itemNumber: matchOrd.item_number, customer: matchOrd.customer,
            film: matchOrd.film, width: matchOrd.width_mm, length: matchOrd.length_m, ups: neededUps,
            positions, position_label: formatPositionLabel(positions), station: 'SIDE_B', core: matchOrd.core, treatment_side: matchOrd.treatment_side,
          });
        }
        if (validB) balancedDeckles.push([...mappedItemsA, ...mappedItemsB]);
      }
    }
  }
  return balancedDeckles;
}

export function findDuplexDualCoreDeckles(
  eligibleOrders: VA05Order[],
  minTrim: number,
  maxTrim: number,
  deckleWidth: number,
  targetLength?: number
): DecklePatternItem[][] {
  const activeOrders = eligibleOrders.filter(o => o.remaining_qty > 0.01 && orderPassesPsEngineGate(o) && (!targetLength || o.length_m === targetLength));
  const ordersCore3 = activeOrders.filter(o => o.core === 3).sort((a, b) => b.width_mm - a.width_mm);
  const ordersCore6 = activeOrders.filter(o => o.core === 6).sort((a, b) => b.width_mm - a.width_mm);
  if (ordersCore3.length === 0 || ordersCore6.length === 0) return [];

  const widths3 = Array.from(new Set(ordersCore3.map(o => o.width_mm))).sort((a, b) => b - a);
  const widths6 = Array.from(new Set(ordersCore6.map(o => o.width_mm))).sort((a, b) => b - a);
  const minSlitWidth = deckleWidth - maxTrim;
  const maxSlitWidth = deckleWidth - minTrim;

  const buckets3 = new Map<number, { widths: number[]; totalWidth: number; ups: number }[]>();
  function search3(startIndex: number, current: number[], currentW: number, ups: number) {
    if (ups >= 2 && ups <= 8 && currentW <= maxSlitWidth) {
      let b = buckets3.get(ups);
      if (!b) { b = []; buckets3.set(ups, b); }
      if (b.length < 140) b.push({ widths: [...current], totalWidth: currentW, ups });
    }
    if (ups >= 8) return;
    for (let i = startIndex; i < widths3.length; i++) {
      if (currentW + widths3[i] <= maxSlitWidth) {
        current.push(widths3[i]);
        search3(i, current, currentW + widths3[i], ups + 1);
        current.pop();
      }
    }
  }
  search3(0, [], 0, 0);
  const combos3 = Array.from(buckets3.values()).flat();

  const buckets6 = new Map<number, { widths: number[]; totalWidth: number; ups: number }[]>();
  function search6(startIndex: number, current: number[], currentW: number, ups: number) {
    if (ups >= 2 && ups <= 8 && currentW <= maxSlitWidth) {
      let b = buckets6.get(ups);
      if (!b) { b = []; buckets6.set(ups, b); }
      if (b.length < 140) b.push({ widths: [...current], totalWidth: currentW, ups });
    }
    if (ups >= 8) return;
    for (let i = startIndex; i < widths6.length; i++) {
      if (currentW + widths6[i] <= maxSlitWidth) {
        current.push(widths6[i]);
        search6(i, current, currentW + widths6[i], ups + 1);
        current.pop();
      }
    }
  }
  search6(0, [], 0, 0);
  const combos6 = Array.from(buckets6.values()).flat();

  const balancedDeckles: DecklePatternItem[][] = [];
  for (const c3 of combos3) {
    for (const c6 of combos6) {
      if (balancedDeckles.length >= 1200) break;
      if (Math.abs(c3.ups - c6.ups) > 1) continue;
      const combinedWidth = c3.totalWidth + c6.totalWidth;
      if (combinedWidth >= minSlitWidth && combinedWidth <= maxSlitWidth) {
        let pos = 1;
        const mappedItemsA: DecklePatternItem[] = [];
        const widthMapA = new Map<number, number>();
        c3.widths.forEach(w => widthMapA.set(w, (widthMapA.get(w) || 0) + 1));
        let validA = true;
        for (const [w, neededUps] of Array.from(widthMapA.entries())) {
          const matchOrd = ordersCore3.find(o => o.width_mm === w);
          if (!matchOrd) { validA = false; break; }
          const positions: number[] = [];
          for (let u = 0; u < neededUps; u++) positions.push(pos++);
          mappedItemsA.push({
            orderId: matchOrd.id, salesOrder: matchOrd.sales_order, itemNumber: matchOrd.item_number, customer: matchOrd.customer,
            film: matchOrd.film, width: matchOrd.width_mm, length: matchOrd.length_m, ups: neededUps,
            positions, position_label: formatPositionLabel(positions), station: 'SIDE_A', core: 3, treatment_side: matchOrd.treatment_side,
          });
        }
        if (!validA) continue;
        const mappedItemsB: DecklePatternItem[] = [];
        const widthMapB = new Map<number, number>();
        c6.widths.forEach(w => widthMapB.set(w, (widthMapB.get(w) || 0) + 1));
        let validB = true;
        for (const [w, neededUps] of Array.from(widthMapB.entries())) {
          const matchOrd = ordersCore6.find(o => o.width_mm === w);
          if (!matchOrd) { validB = false; break; }
          const positions: number[] = [];
          for (let u = 0; u < neededUps; u++) positions.push(pos++);
          mappedItemsB.push({
            orderId: matchOrd.id, salesOrder: matchOrd.sales_order, itemNumber: matchOrd.item_number, customer: matchOrd.customer,
            film: matchOrd.film, width: matchOrd.width_mm, length: matchOrd.length_m, ups: neededUps,
            positions, position_label: formatPositionLabel(positions), station: 'SIDE_B', core: 6, treatment_side: matchOrd.treatment_side,
          });
        }
        if (validB) balancedDeckles.push([...mappedItemsA, ...mappedItemsB]);
      }
    }
  }
  return balancedDeckles;
}

export function findInitialMixedLengthDeckles(
  eligibleOrders: VA05Order[],
  minTrim: number,
  maxTrim: number,
  minUps: number,
  maxUps: number,
  deckleWidth: number
): DecklePatternItem[][] {
  const activeOrders = eligibleOrders
    .filter(o => o.remaining_qty > 0.01 && orderPassesPsEngineGate(o))
    .sort((a, b) => b.width_mm - a.width_mm);
  if (activeOrders.length === 0) return [];

  const minSlitWidth = deckleWidth - maxTrim;
  const maxSlitWidth = deckleWidth - minTrim;
  const validPatterns: DecklePatternItem[][] = [];

  function search(index: number, currentCombo: VA05Order[], currentWidth: number, currentUps: number) {
    if (validPatterns.length >= 500 || currentUps > maxUps || currentWidth > maxSlitWidth) return;
    if (currentUps >= minUps && currentWidth >= minSlitWidth && currentWidth <= maxSlitWidth) {
      const comboLengths = currentCombo.map(ord => ord.length_m);
      const comboCores = currentCombo.map(ord => ord.core);
      if (isPlanLengthCompatible(comboLengths)) {
        const distinctLens = Array.from(new Set(comboLengths.filter((l): l is number => typeof l === 'number' && l > 0)));
        const distinctCores = Array.from(new Set(comboCores));
        if (distinctCores.length <= 2) {
          let balanced = true;
          if (distinctLens.length === 2) {
            const c0 = comboLengths.filter(l => l === distinctLens[0]).length;
            const c1 = comboLengths.filter(l => l === distinctLens[1]).length;
            if (Math.abs(c0 - c1) > 1) balanced = false;
          }
          if (distinctCores.length === 2) {
            const c0 = comboCores.filter(c => c === distinctCores[0]).length;
            const c1 = comboCores.filter(c => c === distinctCores[1]).length;
            if (Math.abs(c0 - c1) > 1) balanced = false;
          }
          if (balanced) {
            let pos = 1;
            validPatterns.push(currentCombo.map(ord => ({
              orderId: ord.id, salesOrder: ord.sales_order, itemNumber: ord.item_number, customer: ord.customer,
              width: ord.width_mm, length: ord.length_m, ups: 1, positions: [pos], position_label: `${pos++}`,
              core: ord.core, treatment_side: ord.treatment_side,
            })));
          }
        }
      }
    }
    if (currentUps >= maxUps) return;
    for (let i = index; i < activeOrders.length; i++) {
      const ord = activeOrders[i];
      if (currentWidth + ord.width_mm <= maxSlitWidth && isPlanLengthCompatible([...currentCombo.map(o => o.length_m), ord.length_m])) {
        currentCombo.push(ord);
        search(i, currentCombo, currentWidth + ord.width_mm, currentUps + 1);
        currentCombo.pop();
      }
    }
  }
  search(0, [], 0, 0);
  return validPatterns;
}

export function simulateMultiPackExecution(
  initialSetup: DecklePatternItem[],
  availableOrders: VA05Order[],
  filmThickness: number,
  filmDensity: number,
  deckleWidth: number,
  minTrim: number,
  maxTrim: number,
  minUps: number,
  maxUps: number,
  priorityOrderIds: Set<string>,
  targetLength: number,
  isMixed: boolean,
  targetRemainingKg?: number,
  maxAllowedForPlanKg?: number,
  targetKg?: number,
  cumulativePlannedSoFarKg: number = 0,
  forcedMaxPacksCap?: number
): MultiPackSimulationResult | null {
  const duplexAssign = assignDuplexStations(initialSetup);
  const setupLens = Array.from(new Set(initialSetup.map(it => it.length).filter((l): l is number => typeof l === 'number' && l > 0)));
  const setupCores = Array.from(new Set(initialSetup.map(it => it.core).filter(c => c != null)));
  if ((setupLens.length === 2 || setupCores.length === 2) && !duplexAssign.success) return null;

  const currentSetup = duplexAssign.success ? duplexAssign.items : initialSetup;
  if (!isPlanLengthCompatible(currentSetup.map(it => it.length))) return null;

  const allSetupLengths = [
    targetLength || 0,
    ...currentSetup.map(it => it.length || 0),
    duplexAssign.sideALength || 0,
    duplexAssign.sideBLength || 0,
  ].filter((l): l is number => typeof l === 'number' && l > 0);
  const masterPackLength = allSetupLengths.length > 0 ? Math.max(...allSetupLengths) : (targetLength || 19500);

  function getArmLengthMultiplier(armLength: number): number {
    if (masterPackLength > 0 && armLength > 0 && masterPackLength > armLength) {
      const ratio = Math.round(masterPackLength / armLength);
      if (ratio === 2 && Math.abs(masterPackLength - 2 * armLength) < 0.001) return 2;
    }
    return 1;
  }

  const totalSlitInitial = currentSetup.reduce((sum, it) => sum + it.width * it.ups, 0);
  const trimInitial = deckleWidth - totalSlitInitial;
  if (trimInitial < minTrim || trimInitial > maxTrim) return null;

  interface ArmState {
    position: number;
    orderId: string;
    salesOrder: string;
    itemNumber: number;
    customer: string;
    width_mm: number;
    length_m: number;
    station: 'SIDE_A' | 'SIDE_B';
    core: number;
    treatment_side: string;
    startPack: number;
  }

  const simOrderMap = new Map<string, VA05Order>();
  const orderBaseDemandMap = new Map<string, number>();
  const orderMaxAllowedMap = new Map<string, number>();
  const historicalProducedMap = new Map<string, number>();

  availableOrders.forEach(o => {
    const baseResidualDemand = Number(o.remaining_qty);
    const historicalProduced = Number(o.produced_qty || 0);
    const originalDemand = Math.max(Number(o.balance_qty || 0), baseResidualDemand + historicalProduced);
    const globalMaxAllowed = Math.round(originalDemand * CUSTOMER_MAX_OVERALLOCATION_FACTOR * 100) / 100;
    const planMaxAllowed = Math.max(0, Math.round((globalMaxAllowed - historicalProduced) * 100) / 100);

    orderBaseDemandMap.set(o.id, baseResidualDemand);
    orderMaxAllowedMap.set(o.id, planMaxAllowed);
    historicalProducedMap.set(o.id, historicalProduced);
    simOrderMap.set(o.id, { ...o, remaining_qty: baseResidualDemand, produced_qty: 0 });
  });

  function selectBestReplacementCandidate({
    posToReplace,
    oldArm,
    currentArms,
    positionHistoryMap,
  }: {
    posToReplace: number;
    oldArm: ArmState;
    currentArms: ArmState[];
    positionHistoryMap: Map<number, number[]>;
  }): VA05Order | null {
    const otherArms = currentArms.filter(a => a.position !== posToReplace);
    const otherArmsWidth = otherArms.reduce((sum, a) => sum + a.width_mm, 0);
    const otherArmsWidthCount = new Map<number, number>();
    otherArms.forEach(a => otherArmsWidthCount.set(a.width_mm, (otherArmsWidthCount.get(a.width_mm) || 0) + 1));

    const eligibleCandidates: VA05Order[] = [];
    for (const o of simOrderMap.values()) {
      if (o.remaining_qty <= 0.05 || o.width_mm < minIndividualSlitWidthMm()) continue;
      // HARD CAP FOR SS FIXED 1705 MODE: Max 50mm knife shift allowed on any arm!
      if (_ssFixedDeckleMode && Math.abs(o.width_mm - oldArm.width_mm) > SS_FIXED_1705_MAX_KNIFE_SHIFT_MM) continue;
      if (duplexAssign.isDualLength && o.length_m !== oldArm.length_m) continue;
      if (!duplexAssign.isDualLength && o.length_m !== targetLength) continue;
      if (duplexAssign.isDualCore && o.core !== oldArm.core) continue;

      const sameStationOtherArms = otherArms.filter(a => a.station === oldArm.station);
      if (sameStationOtherArms.some(a => a.length_m !== o.length_m)) continue;
      if (!isPlanLengthCompatible([...otherArms.map(a => a.length_m), o.length_m])) continue;

      const candMultiplier = getArmLengthMultiplier(o.length_m);
      const candReelW = calculateSingleReelWeight(o.width_mm, filmThickness, filmDensity, o.length_m);
      const candArmWeight = candReelW * candMultiplier;
      const candBaseDemand = orderBaseDemandMap.get(o.id) || o.remaining_qty;
      const candHist = historicalProducedMap.get(o.id) || 0;
      const rawCandMax = orderMaxAllowedMap.get(o.id) ?? (candBaseDemand * CUSTOMER_MAX_OVERALLOCATION_FACTOR);
      const candMaxCap = candHist === 0 ? Math.max(rawCandMax, candArmWeight * 1.00) : rawCandMax;

      const alreadyAssignedArms = otherArms.filter(a => a.orderId === o.id).length;
      if (o.produced_qty + (alreadyAssignedArms + 1) * candArmWeight > candMaxCap + 0.05) continue;

      const newTrim = deckleWidth - (otherArmsWidth + o.width_mm);
      if (newTrim < minTrim || newTrim > maxTrim) continue;
      eligibleCandidates.push(o);
    }

    if (eligibleCandidates.length === 0) return null;
    if (eligibleCandidates.length === 1) return eligibleCandidates[0];

    const currentArmWidth = oldArm.width_mm;
    const canPreserveCurrentWidth = eligibleCandidates.some(c => c.width_mm === currentArmWidth);
    const recentArmWidths = (positionHistoryMap.get(posToReplace) || [currentArmWidth]).slice(-3);

    const candidatePackStats = new Map<string, { expectedRunPacks: number; totalReelsPossible: number }>();
    let hasMultiPackCandidate = false;

    eligibleCandidates.forEach(cand => {
      const candMultiplier = getArmLengthMultiplier(cand.length_m);
      const candReelW = calculateSingleReelWeight(cand.width_mm, filmThickness, filmDensity, cand.length_m);
      const candArmWeight = candReelW * candMultiplier;
      const candBaseDemand = orderBaseDemandMap.get(cand.id) || cand.remaining_qty;
      const candHist = historicalProducedMap.get(cand.id) || 0;
      const rawCandMax = orderMaxAllowedMap.get(cand.id) ?? (candBaseDemand * CUSTOMER_MAX_OVERALLOCATION_FACTOR);
      const candMaxCap = candHist === 0 ? Math.max(rawCandMax, candArmWeight * 1.00) : rawCandMax;
      const totalArmsOnCand = otherArms.filter(a => a.orderId === cand.id).length + 1;

      const remainingCapKg = Math.max(0, candMaxCap - cand.produced_qty);
      const totalReelsPossible = Math.floor((remainingCapKg + 0.05) / candReelW);
      const packsCanRun = Math.max(1, Math.floor(totalReelsPossible / (totalArmsOnCand * candMultiplier)));
      const expectedRunPacks = Math.min(3, packsCanRun);

      candidatePackStats.set(cand.id, { expectedRunPacks, totalReelsPossible });
      if (expectedRunPacks >= 2 || cand.width_mm === currentArmWidth) hasMultiPackCandidate = true;
    });

    const evaluations = eligibleCandidates.map(cand => {
      const { expectedRunPacks, totalReelsPossible } = candidatePackStats.get(cand.id)!;
      const newTrim = deckleWidth - (otherArmsWidth + cand.width_mm);
      const trimQuality = -Math.abs(newTrim - (minTrim + maxTrim) / 2);
      const isPriority = priorityOrderIds.has(cand.id) || !!cand.priority;
      const isSameWidthPreserved = cand.width_mm === currentArmWidth;
      const isAvoidableSizeEviction = canPreserveCurrentWidth && !isSameWidthPreserved;
      const isCrossArmRelocation = !isSameWidthPreserved && (otherArmsWidthCount.get(cand.width_mm) || 0) > 0 && totalReelsPossible <= 3;
      const avoidableOscillationOrChurn =
        (!isSameWidthPreserved && recentArmWidths.includes(cand.width_mm) && expectedRunPacks === 1) ||
        (!isSameWidthPreserved && expectedRunPacks === 1 && hasMultiPackCandidate);
      const totalLookaheadChanges = (isSameWidthPreserved ? 0 : 1) + (expectedRunPacks < 3 ? 1 : 0);
      const widthJumpDelta = Math.abs(cand.width_mm - currentArmWidth);

      return {
        candidate: cand, isSameWidthPreserved, isAvoidableSizeEviction, isCrossArmRelocation,
        avoidableOscillationOrChurn, expectedRunPacks, isPriority, totalLookaheadChanges,
        remainingDemandKg: cand.remaining_qty, trimQuality, widthJumpDelta,
      };
    });

    evaluations.sort((a, b) => {
      if (a.isSameWidthPreserved !== b.isSameWidthPreserved) return a.isSameWidthPreserved ? -1 : 1;
      if (a.isAvoidableSizeEviction !== b.isAvoidableSizeEviction) return a.isAvoidableSizeEviction ? 1 : -1;
      if (a.isCrossArmRelocation !== b.isCrossArmRelocation) return a.isCrossArmRelocation ? 1 : -1;
      if (a.avoidableOscillationOrChurn !== b.avoidableOscillationOrChurn) return a.avoidableOscillationOrChurn ? 1 : -1;
      // In SS 1705 mode, prefer smaller width jump delta
      if (_ssFixedDeckleMode && Math.abs(a.widthJumpDelta - b.widthJumpDelta) > 10) {
        return a.widthJumpDelta - b.widthJumpDelta;
      }
      if (a.expectedRunPacks !== b.expectedRunPacks) return b.expectedRunPacks - a.expectedRunPacks;
      if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
      if (a.totalLookaheadChanges !== b.totalLookaheadChanges) return a.totalLookaheadChanges - b.totalLookaheadChanges;
      if (Math.abs(b.remainingDemandKg - a.remainingDemandKg) > 10) return b.remainingDemandKg - a.remainingDemandKg;
      if (Math.abs(b.trimQuality - a.trimQuality) > 1) return b.trimQuality - a.trimQuality;
      return b.candidate.width_mm - a.candidate.width_mm;
    });

    return evaluations[0].candidate;
  }

  function tryCompensatingMultiArmReplacement(
    positionsToReplace: number[],
    currentArms: ArmState[],
    nextStartPack: number
  ): { updatedArms: ArmState[]; jointChanges: PlanChange[] } | null {
    if (positionsToReplace.length < 2 || positionsToReplace.length > 4) return null;

    const replaceSet = new Set(positionsToReplace);
    const keptArms = currentArms.filter(a => !replaceSet.has(a.position));
    const replacingArms = positionsToReplace.map(pos => currentArms.find(a => a.position === pos)!);
    const keptWidth = keptArms.reduce((sum, a) => sum + a.width_mm, 0);

    const minCombinedWidth = (deckleWidth - maxTrim) - keptWidth;
    const maxCombinedWidth = (deckleWidth - minTrim) - keptWidth;
    if (maxCombinedWidth < minIndividualSlitWidthMm() * positionsToReplace.length) return null;

    const basePool = Array.from(simOrderMap.values())
      .filter(o => o.remaining_qty > 0.05 && o.width_mm >= minIndividualSlitWidthMm())
      .sort((a, b) => b.remaining_qty - a.remaining_qty)
      .slice(0, 22);
    if (basePool.length === 0) return null;

    const maxAdditionalArmsMap = new Map<string, number>();
    for (const o of basePool) {
      const mult = getArmLengthMultiplier(o.length_m);
      const reelW = calculateSingleReelWeight(o.width_mm, filmThickness, filmDensity, o.length_m);
      const armW = reelW * mult;
      const baseD = orderBaseDemandMap.get(o.id) || o.remaining_qty;
      const hist = historicalProducedMap.get(o.id) || 0;
      const rawMax = orderMaxAllowedMap.get(o.id) ?? (baseD * CUSTOMER_MAX_OVERALLOCATION_FACTOR);
      const cap = hist === 0 ? Math.max(rawMax, armW * 1.00) : rawMax;
      const alreadyKept = keptArms.filter(a => a.orderId === o.id).length;
      const remCap = Math.max(0, cap - o.produced_qty - alreadyKept * armW);
      const maxAdd = Math.max(0, Math.floor((remCap + 0.05) / armW));
      if (maxAdd > 0) maxAdditionalArmsMap.set(o.id, maxAdd);
    }

    const filteredPool = basePool.filter(o => (maxAdditionalArmsMap.get(o.id) || 0) > 0);
    if (filteredPool.length === 0) return null;

    let bestAssignedOrders: VA05Order[] | null = null;
    let bestComboScore = -Infinity;
    let nodesVisited = 0;
    const usedCounts = new Map<string, number>();
    const nomTrim = nominalTrimTargetMm();

    function dfs(slotIdx: number, currentSelected: VA05Order[], sumWidth: number) {
      if (nodesVisited >= 1200) return;
      nodesVisited++;

      if (slotIdx === positionsToReplace.length) {
        if (sumWidth >= minCombinedWidth && sumWidth <= maxCombinedWidth) {
          if (!isPlanLengthCompatible([...keptArms.map(a => a.length_m), ...currentSelected.map(o => o.length_m)])) return;
          const proposedBoundaryChanges = replacingArms.map((oldA, idx) => ({
            old_width_mm: oldA.width_mm,
            new_width_mm: currentSelected[idx].width_mm,
          }));
          const effectiveShifts = calculateEffectiveShiftsAtBoundary(proposedBoundaryChanges);
          if (effectiveShifts > 2) return;

          const trimDev = Math.abs(deckleWidth - (keptWidth + sumWidth) - nomTrim);
          const totalRemKg = currentSelected.reduce((s, o) => s + o.remaining_qty, 0);
          const score = -effectiveShifts * 150000 + totalRemKg * 15 - trimDev * 100;
          if (score > bestComboScore) {
            bestComboScore = score;
            bestAssignedOrders = [...currentSelected];
          }
        }
        return;
      }

      const targetOldArm = replacingArms[slotIdx];
      const sameStationKept = keptArms.filter(a => a.station === targetOldArm.station);

      for (const cand of filteredPool) {
        const used = usedCounts.get(cand.id) || 0;
        if (used >= (maxAdditionalArmsMap.get(cand.id) || 0)) continue;
        // HARD CAP FOR SS FIXED 1705 MODE: Max 50mm knife shift allowed on any arm!
        if (_ssFixedDeckleMode && Math.abs(cand.width_mm - targetOldArm.width_mm) > SS_FIXED_1705_MAX_KNIFE_SHIFT_MM) continue;
        if (duplexAssign.isDualLength && cand.length_m !== targetOldArm.length_m) continue;
        if (!duplexAssign.isDualLength && cand.length_m !== targetLength) continue;
        if (duplexAssign.isDualCore && cand.core !== targetOldArm.core) continue;
        if (sameStationKept.some(a => a.length_m !== cand.length_m)) continue;

        let stationConflict = false;
        for (let prev = 0; prev < slotIdx; prev++) {
          if (replacingArms[prev].station === targetOldArm.station) {
            if (currentSelected[prev].length_m !== cand.length_m || currentSelected[prev].core !== cand.core) {
              stationConflict = true;
              break;
            }
          }
        }
        if (stationConflict) continue;

        usedCounts.set(cand.id, used + 1);
        currentSelected.push(cand);
        dfs(slotIdx + 1, currentSelected, sumWidth + cand.width_mm);
        currentSelected.pop();
        usedCounts.set(cand.id, used);
      }
    }

    dfs(0, [], 0);
    if (!bestAssignedOrders) return null;

    const finalOrders = bestAssignedOrders as VA05Order[];
    const updatedArms = currentArms.map(a => ({ ...a }));
    const jointChanges: PlanChange[] = [];

    for (let i = 0; i < positionsToReplace.length; i++) {
      const pos = positionsToReplace[i];
      const armIdx = updatedArms.findIndex(a => a.position === pos);
      const oldArm = updatedArms[armIdx];
      const cand = finalOrders[i];

      updatedArms[armIdx] = {
        position: pos, orderId: cand.id, salesOrder: cand.sales_order, itemNumber: cand.item_number,
        customer: cand.customer, width_mm: cand.width_mm, length_m: cand.length_m, station: oldArm.station,
        core: cand.core, treatment_side: cand.treatment_side, startPack: nextStartPack,
      };
      positionHistoryMap.get(pos)?.push(cand.width_mm);

      if (cand.width_mm !== oldArm.width_mm) {
        jointChanges.push({
          id: `change-sim-${accumulatedChanges.length + jointChanges.length + 1}`,
          plan_id: '', segment_id: `seg-pack-${nextStartPack}`, position: pos,
          old_width_mm: oldArm.width_mm, new_width_mm: cand.width_mm, after_pack: nextStartPack - 1,
          reason: 'ORDER_COMPLETED',
          instruction: `AFTER PACK ${nextStartPack - 1}: CHANGE SIZE ${oldArm.width_mm}MM → ${cand.width_mm}MM`,
          old_order_ref: `SO# ${oldArm.salesOrder} / Item ${oldArm.itemNumber} (${oldArm.customer})`,
          new_order_ref: `SO# ${cand.sales_order} / Item ${cand.item_number} (${cand.customer})`,
          created_at: new Date().toISOString(),
        });
      }
    }
    return { updatedArms, jointChanges };
  }

  const packSnapshots: {
    pack: number;
    arms: ArmState[];
    changes: PlanChange[];
    packWeight: number;
    packReels: number;
    history: { pack: number; position: number; orderId: string; width_mm: number; length_m: number; weightKg: number; isClosed: boolean }[];
    ordersState: Map<string, { remaining_qty: number; produced_qty: number; status: string }>;
  }[] = [];

  let activeArms: ArmState[] = [];
  const positionHistoryMap = new Map<number, number[]>();
  currentSetup.forEach(item => {
    item.positions.forEach(pos => {
      activeArms.push({
        position: pos, orderId: item.orderId, salesOrder: item.salesOrder, itemNumber: item.itemNumber,
        customer: item.customer, width_mm: item.width, length_m: item.length,
        station: item.station || (pos <= (duplexAssign.sideAUps || 8) ? 'SIDE_A' : 'SIDE_B'),
        core: item.core, treatment_side: item.treatment_side, startPack: 1,
      });
      positionHistoryMap.set(pos, [item.width]);
    });
  });
  activeArms.sort((a, b) => a.position - b.position);

  const accumulatedChanges: PlanChange[] = [];
  const accumulatedHistory: { pack: number; position: number; orderId: string; width_mm: number; length_m: number; weightKg: number; isClosed: boolean }[] = [];

  let packNum = 1;
  while (true) {
    if (forcedMaxPacksCap !== undefined && packNum > forcedMaxPacksCap) break;
    if (packNum > 220) break;

    const armCountPerOrder = new Map<string, number>();
    activeArms.forEach(arm => armCountPerOrder.set(arm.orderId, (armCountPerOrder.get(arm.orderId) || 0) + 1));

    const armsNeedingReplacement: number[] = [];
    const excessArmsToReplacePerOrder = new Map<string, number>();

    armCountPerOrder.forEach((armCount, orderId) => {
      const ord = simOrderMap.get(orderId)!;
      const sampleArm = activeArms.find(a => a.orderId === orderId)!;
      const reelWeight = calculateSingleReelWeight(sampleArm.width_mm, filmThickness, filmDensity, sampleArm.length_m);
      const armWeightPerPack = reelWeight * getArmLengthMultiplier(sampleArm.length_m);
      const baseDemand = orderBaseDemandMap.get(orderId) || ord.remaining_qty;
      const hist = historicalProducedMap.get(orderId) || 0;
      const rawPlanMax = orderMaxAllowedMap.get(orderId) ?? (baseDemand * CUSTOMER_MAX_OVERALLOCATION_FACTOR);
      const maxCap = hist === 0 ? Math.max(rawPlanMax, armWeightPerPack * 1.00) : rawPlanMax;
      const allowedArmsInPack = Math.max(0, Math.floor((maxCap - ord.produced_qty + 0.05) / armWeightPerPack));
      if (armCount > allowedArmsInPack) {
        excessArmsToReplacePerOrder.set(orderId, armCount - allowedArmsInPack);
      }
    });

    if (excessArmsToReplacePerOrder.size > 0) {
      if (packNum === 1) return null;
      excessArmsToReplacePerOrder.forEach((excessCount, orderId) => {
        const matchingArms = activeArms.filter(a => a.orderId === orderId);
        for (let i = 0; i < excessCount && i < matchingArms.length; i++) {
          armsNeedingReplacement.push(matchingArms[matchingArms.length - 1 - i].position);
        }
      });
    }

    if (armsNeedingReplacement.length > 0) {
      let allReplaced = true;
      const tempArms = activeArms.map(a => ({ ...a }));
      const pendingChangesPre: PlanChange[] = [];

      for (const posToReplace of armsNeedingReplacement) {
        const armIdx = tempArms.findIndex(a => a.position === posToReplace);
        const oldArm = tempArms[armIdx];
        const cand = selectBestReplacementCandidate({ posToReplace, oldArm, currentArms: tempArms, positionHistoryMap });
        if (cand) {
          tempArms[armIdx] = {
            position: posToReplace, orderId: cand.id, salesOrder: cand.sales_order, itemNumber: cand.item_number,
            customer: cand.customer, width_mm: cand.width_mm, length_m: cand.length_m, station: oldArm.station,
            core: cand.core, treatment_side: cand.treatment_side, startPack: packNum,
          };
          positionHistoryMap.get(posToReplace)?.push(cand.width_mm);
          if (cand.width_mm !== oldArm.width_mm) {
            pendingChangesPre.push({
              id: `change-sim-${accumulatedChanges.length + pendingChangesPre.length + 1}`,
              plan_id: '', segment_id: `seg-pack-${packNum}`, position: posToReplace,
              old_width_mm: oldArm.width_mm, new_width_mm: cand.width_mm, after_pack: packNum - 1,
              reason: 'ORDER_COMPLETED',
              instruction: `AFTER PACK ${packNum - 1}: CHANGE SIZE ${oldArm.width_mm}MM → ${cand.width_mm}MM`,
              old_order_ref: `SO# ${oldArm.salesOrder} / Item ${oldArm.itemNumber} (${oldArm.customer})`,
              new_order_ref: `SO# ${cand.sales_order} / Item ${cand.item_number} (${cand.customer})`,
              created_at: new Date().toISOString(),
            });
          }
        } else {
          allReplaced = false;
          break;
        }
      }

      if (!allReplaced && armsNeedingReplacement.length >= 2 && armsNeedingReplacement.length <= 4) {
        const compRes = tryCompensatingMultiArmReplacement(armsNeedingReplacement, activeArms, packNum);
        if (compRes) {
          allReplaced = true;
          tempArms.splice(0, tempArms.length, ...compRes.updatedArms);
          pendingChangesPre.splice(0, pendingChangesPre.length, ...compRes.jointChanges);
        }
      }

      if (allReplaced) {
        const boundaryEffectiveShifts = calculateEffectiveShiftsAtBoundary(pendingChangesPre);
        const { totalEffective } = calculatePlanShiftMetrics([...accumulatedChanges, ...pendingChangesPre]);
        const maxAllowedEffectiveForPack = Math.floor(packNum / 3) + 1;
        if (boundaryEffectiveShifts >= 3 || totalEffective > maxAllowedEffectiveForPack) {
          break;
        }
        activeArms = tempArms;
        accumulatedChanges.push(...pendingChangesPre);
      } else {
        break;
      }
    }

    let packWeight = 0;
    let packReels = 0;
    const completedPositionsThisPack: number[] = [];

    for (const arm of activeArms) {
      const ord = simOrderMap.get(arm.orderId)!;
      const reelWeight = calculateWeightHighPrecision(arm.width_mm, filmThickness, filmDensity, arm.length_m);
      const multiplier = getArmLengthMultiplier(arm.length_m);
      const armWeightThisPack = reelWeight * multiplier;

      const baseDemand = orderBaseDemandMap.get(arm.orderId) || ord.remaining_qty;
      const armHist = historicalProducedMap.get(arm.orderId) || 0;
      const rawPlanMax = orderMaxAllowedMap.get(arm.orderId) ?? (baseDemand * CUSTOMER_MAX_OVERALLOCATION_FACTOR);
      const maxCap = armHist === 0 ? Math.max(rawPlanMax, armWeightThisPack * 1.00) : rawPlanMax;
      
      ord.produced_qty = Math.round((ord.produced_qty + armWeightThisPack) * 100) / 100;
      ord.remaining_qty = Math.max(0, Math.round((ord.remaining_qty - armWeightThisPack) * 100) / 100);
      ord.status = ord.remaining_qty <= 0.05 ? 'COMPLETED' : 'PARTIALLY_FULFILLED';

      const isNowClosed = (ord.produced_qty + armWeightThisPack > maxCap + 0.05) || ord.remaining_qty <= 0.05;
      if (isNowClosed) completedPositionsThisPack.push(arm.position);

      for (let r = 0; r < multiplier; r++) {
        accumulatedHistory.push({
          pack: packNum, position: arm.position, orderId: arm.orderId,
          width_mm: arm.width_mm, length_m: arm.length_m, weightKg: reelWeight, isClosed: isNowClosed,
        });
      }
      packWeight += armWeightThisPack;
      packReels += multiplier;
    }

    const stateClone = new Map<string, { remaining_qty: number; produced_qty: number; status: string }>();
    simOrderMap.forEach((v, k) => {
      const hist = historicalProducedMap.get(k) || 0;
      stateClone.set(k, { remaining_qty: v.remaining_qty, produced_qty: Math.round((hist + v.produced_qty) * 100) / 100, status: v.status });
    });

    packSnapshots.push({
      pack: packNum, arms: activeArms.map(a => ({ ...a })), changes: accumulatedChanges.map(c => ({ ...c })),
      packWeight, packReels, history: accumulatedHistory.map(h => ({ ...h })), ordersState: stateClone,
    });

    if (completedPositionsThisPack.length === 0) {
      packNum++;
      continue;
    }

    let allCompletedPositionsReplaced = true;
    const tempArms = activeArms.map(a => ({ ...a }));
    const pendingChangesPost: PlanChange[] = [];

    for (const completedPos of completedPositionsThisPack) {
      const armIdx = tempArms.findIndex(a => a.position === completedPos);
      const oldArm = tempArms[armIdx];
      const cand = selectBestReplacementCandidate({ posToReplace: completedPos, oldArm, currentArms: tempArms, positionHistoryMap });
      if (cand) {
        tempArms[armIdx] = {
          position: completedPos, orderId: cand.id, salesOrder: cand.sales_order, itemNumber: cand.item_number,
          customer: cand.customer, width_mm: cand.width_mm, length_m: cand.length_m, station: oldArm.station,
          core: cand.core, treatment_side: cand.treatment_side, startPack: packNum + 1,
        };
        positionHistoryMap.get(completedPos)?.push(cand.width_mm);
        if (cand.width_mm !== oldArm.width_mm) {
          pendingChangesPost.push({
            id: `change-sim-${accumulatedChanges.length + pendingChangesPost.length + 1}`,
            plan_id: '', segment_id: `seg-pack-${packNum + 1}`, position: completedPos,
            old_width_mm: oldArm.width_mm, new_width_mm: cand.width_mm, after_pack: packNum,
            reason: 'ORDER_COMPLETED',
            instruction: `AFTER PACK ${packNum}: CHANGE SIZE ${oldArm.width_mm}MM → ${cand.width_mm}MM`,
            old_order_ref: `SO# ${oldArm.salesOrder} / Item ${oldArm.itemNumber} (${oldArm.customer})`,
            new_order_ref: `SO# ${cand.sales_order} / Item ${cand.item_number} (${cand.customer})`,
            created_at: new Date().toISOString(),
          });
        }
      } else {
        allCompletedPositionsReplaced = false;
        break;
      }
    }

    if (!allCompletedPositionsReplaced && completedPositionsThisPack.length >= 2 && completedPositionsThisPack.length <= 4) {
      const compRes = tryCompensatingMultiArmReplacement(completedPositionsThisPack, activeArms, packNum + 1);
      if (compRes) {
        allCompletedPositionsReplaced = true;
        tempArms.splice(0, tempArms.length, ...compRes.updatedArms);
        pendingChangesPost.splice(0, pendingChangesPost.length, ...compRes.jointChanges);
      }
    }

    if (allCompletedPositionsReplaced) {
      const boundaryEffectiveShifts = calculateEffectiveShiftsAtBoundary(pendingChangesPost);
      const { totalEffective } = calculatePlanShiftMetrics([...accumulatedChanges, ...pendingChangesPost]);
      const maxAllowedEffectiveForNextPack = Math.floor((packNum + 1) / 3) + 1;
      if (boundaryEffectiveShifts >= 3 || totalEffective > maxAllowedEffectiveForNextPack) {
        break;
      }
      activeArms = tempArms;
      accumulatedChanges.push(...pendingChangesPost);
    } else {
      break;
    }

    packNum++;
  }

  if (packSnapshots.length === 0) return null;

  const naturalMaxPacks = packSnapshots.length;
  let bestEvaluatedPackResult: { packCount: number; weightKg: number; score: number } | null = null;
  const nomTrim = nominalTrimTargetMm();

  for (let p = naturalMaxPacks; p >= 1; p--) {
    let candidateWeight = 0;
    for (let i = 0; i < p; i++) candidateWeight += packSnapshots[i].packWeight;
    if (maxAllowedForPlanKg !== undefined && candidateWeight > maxAllowedForPlanKg + 0.0001) continue;

    const snap = packSnapshots[p - 1];
    const changesUpToP = snap.changes.filter(c => Number(c.after_pack) < p);
    const { totalEffective, maxBoundaryPeak } = calculatePlanShiftMetrics(changesUpToP);

    let closedCount = 0;
    let prioClosedCount = 0;
    snap.ordersState.forEach((val, ordId) => {
      if (val.status === 'COMPLETED') {
        closedCount++;
        if (priorityOrderIds.has(ordId)) prioClosedCount++;
      }
    });

    const totalWithThisPlan = cumulativePlannedSoFarKg + candidateWeight;
    let targetProximityBonus = 0;
    if (targetKg) {
      const targetMax = targetKg * CUSTOMER_MAX_OVERALLOCATION_FACTOR;
      targetProximityBonus = totalWithThisPlan <= targetMax ? 500000 - Math.abs(targetKg - totalWithThisPlan) * 10 : -10000000;
    }

    const duplexBonus = (duplexAssign.success && Math.abs(duplexAssign.sideAUps - duplexAssign.sideBUps) <= 1) ? 20000 : 0;
    const mixedPenalty = isMixed ? -200000 : 0;

    const shiftPenalty =
      totalEffective === 0
        ? 0
        : (totalEffective * totalEffective * 45000) / Math.max(1, Math.sqrt(p)) + (maxBoundaryPeak >= 2 ? maxBoundaryPeak * 35000 : 0);

    const candScore =
      mixedPenalty + targetProximityBonus + duplexBonus - shiftPenalty +
      candidateWeight * 220 + p * 4000 + prioClosedCount * 8000 + closedCount * 2500 - Math.abs(trimInitial - nomTrim) * 10;

    if (!bestEvaluatedPackResult || candScore > bestEvaluatedPackResult.score) {
      bestEvaluatedPackResult = {
        packCount: p,
        weightKg: Math.round((candidateWeight + Number.EPSILON) * 100) / 100,
        score: candScore,
      };
    }
  }

  if (!bestEvaluatedPackResult) return null;

  const selectedTotalPacks = bestEvaluatedPackResult.packCount;
  const finalSnapshot = packSnapshots[selectedTotalPacks - 1];
  const finalHistory = accumulatedHistory.filter(h => h.pack <= selectedTotalPacks);
  const finalChanges = accumulatedChanges.filter(c => c.after_pack < selectedTotalPacks);
  const { totalEffective: finalEffectiveShifts, maxBoundaryPeak: finalPeak } = calculatePlanShiftMetrics(finalChanges);

  interface ParentGroupInfo {
    orderId: string;
    orderRef: VA05Order;
    pack1Positions: number[];
    width_mm: number;
    station: 'SIDE_A' | 'SIDE_B';
    initialUps: number;
  }

  const parentGroupsMap = new Map<string, ParentGroupInfo>();
  packSnapshots[0].arms.forEach(arm => {
    if (!parentGroupsMap.has(arm.orderId)) {
      const ord = availableOrders.find(o => o.id === arm.orderId) || simOrderMap.get(arm.orderId)!;
      parentGroupsMap.set(arm.orderId, {
        orderId: arm.orderId, orderRef: ord, pack1Positions: [arm.position],
        width_mm: arm.width_mm, station: arm.station, initialUps: 1,
      });
    } else {
      const g = parentGroupsMap.get(arm.orderId)!;
      g.pack1Positions.push(arm.position);
      g.pack1Positions.sort((a, b) => a - b);
      g.initialUps = g.pack1Positions.length;
    }
  });

  const parentGroups = Array.from(parentGroupsMap.values()).sort((a, b) => (b.width_mm - a.width_mm) || (a.pack1Positions[0] - b.pack1Positions[0]));
  const consolidatedPlanItems: PlanItem[] = [];

  parentGroups.forEach(parent => {
    const parentOrderRef = parent.orderRef;
    const parentAssignedPositions = parent.pack1Positions;
    const parentHistoryEntries = finalHistory.filter(h => h.orderId === parent.orderId && parentAssignedPositions.includes(h.position));
    const parentReels = parentHistoryEntries.length;
    const parentTotalWeight = Math.round((parentHistoryEntries.reduce((sum, h) => sum + h.weightKg, 0) + Number.EPSILON) * 100) / 100;
    const parentSingleReelWeight = calculateSingleReelWeight(parentOrderRef.width_mm, filmThickness, filmDensity, parentOrderRef.length_m);
    const parentMultiplier = getArmLengthMultiplier(parentOrderRef.length_m);
    const parentStartPack = parentHistoryEntries.length > 0 ? Math.min(...parentHistoryEntries.map(h => h.pack)) : 1;
    const parentEndPack = parentHistoryEntries.length > 0 ? Math.max(...parentHistoryEntries.map(h => h.pack)) : selectedTotalPacks;

    consolidatedPlanItems.push({
      id: `item-order-${parent.orderId}`, plan_id: '', segment_id: 'seg-1',
      position: parentAssignedPositions[0] || 1, positions: parentAssignedPositions, position_label: formatPositionLabel(parentAssignedPositions),
      station: parent.station, sales_order: parentOrderRef.sales_order, item_number: parentOrderRef.item_number,
      customer: parentOrderRef.customer, film: parentOrderRef.film, width_mm: parentOrderRef.width_mm, length_m: parentOrderRef.length_m,
      core: parentOrderRef.core, treatment_side: parentOrderRef.treatment_side, reels: parentReels,
      ups: parent.initialUps, initial_ups: parent.initialUps, active_packs: parentEndPack - parentStartPack + 1,
      start_pack: parentStartPack, deckle_mm: parentOrderRef.width_mm * parent.initialUps,
      weight_per_pack_kg: parentSingleReelWeight * parent.initialUps * parentMultiplier, total_weight_kg: parentTotalWeight,
      is_closed: (finalSnapshot.ordersState.get(parent.orderId)?.remaining_qty || 0) <= 0.05, is_future_replacement: false,
    });

    const replacementHistory = finalHistory.filter(h => parentAssignedPositions.includes(h.position) && h.orderId !== parent.orderId);
    const repGroups = Array.from(new Set(replacementHistory.map(h => h.orderId)))
      .map(repId => {
        const repOrderRef = availableOrders.find(o => o.id === repId) || simOrderMap.get(repId)!;
        const repEntries = replacementHistory.filter(h => h.orderId === repId);
        return { repId, repOrderRef, repEntries, repStartPack: Math.min(...repEntries.map(h => h.pack)) };
      })
      .filter(g => g.repOrderRef && g.repEntries.length > 0)
      .sort((a, b) => a.repStartPack - b.repStartPack || a.repId.localeCompare(b.repId));

    let lastActiveWidthMm = Number(parentOrderRef.width_mm || 0);
    for (const g of repGroups) {
      const { repId, repOrderRef, repEntries, repStartPack } = g;
      const repPositions = Array.from(new Set(repEntries.map(h => h.position))).sort((a, b) => a - b);
      const repEndPack = Math.max(...repEntries.map(h => h.pack));
      const repTotalWeight = Math.round((repEntries.reduce((sum, h) => sum + h.weightKg, 0) + Number.EPSILON) * 100) / 100;
      const repWidth = Number(repOrderRef.width_mm || 0);
      const matchChange = finalChanges.find(c => repPositions.includes(c.position) && (c.new_order_ref.includes(repOrderRef.sales_order) || c.new_width_mm === repOrderRef.width_mm));
      const isSizeChange = repWidth > 0 && lastActiveWidthMm > 0 && repWidth !== lastActiveWidthMm;
      if (isSizeChange || (lastActiveWidthMm <= 0 && repWidth > 0)) lastActiveWidthMm = repWidth;

      consolidatedPlanItems.push({
        id: `item-order-${repId}-rep-${parent.orderId}`, plan_id: '', segment_id: 'seg-1',
        position: repPositions[0] || 1, positions: repPositions, position_label: formatPositionLabel(repPositions),
        station: parent.station, sales_order: repOrderRef.sales_order, item_number: repOrderRef.item_number,
        customer: repOrderRef.customer, film: repOrderRef.film, width_mm: repOrderRef.width_mm, length_m: repOrderRef.length_m,
        core: repOrderRef.core, treatment_side: repOrderRef.treatment_side, reels: repEntries.length,
        ups: 0, initial_ups: 0, active_packs: repEndPack - repStartPack + 1, start_pack: repStartPack,
        deckle_mm: 0, weight_per_pack_kg: 0, total_weight_kg: repTotalWeight,
        is_closed: (finalSnapshot.ordersState.get(repId)?.remaining_qty || 0) <= 0.05,
        is_future_replacement: isSizeChange, replacement_instruction: isSizeChange ? matchChange?.instruction : undefined,
      });
    }
  });

  const allResultingPlanLengths = [...consolidatedPlanItems.map(it => it.length_m), ...finalHistory.map(h => h.length_m)].filter((l): l is number => typeof l === 'number' && l > 0);
  if (!isPlanLengthCompatible(allResultingPlanLengths)) return null;

  const sideAItems = consolidatedPlanItems.filter(it => it.station === 'SIDE_A');
  const sideBItems = consolidatedPlanItems.filter(it => it.station === 'SIDE_B');
  const distinctSideALengths = Array.from(new Set(sideAItems.map(it => it.length_m).filter((l): l is number => typeof l === 'number' && l > 0)));
  const distinctSideBLengths = Array.from(new Set(sideBItems.map(it => it.length_m).filter((l): l is number => typeof l === 'number' && l > 0)));
  const distinctSideACores = Array.from(new Set(sideAItems.map(it => it.core).filter(c => c != null)));
  const distinctSideBCores = Array.from(new Set(sideBItems.map(it => it.core).filter(c => c != null)));
  if (distinctSideALengths.length > 1 || distinctSideBLengths.length > 1 || distinctSideACores.length > 1 || distinctSideBCores.length > 1) return null;

  const sideAUpsFinal = sideAItems.reduce((s, it) => s + (it.ups || 1), 0);
  const sideBUpsFinal = sideBItems.reduce((s, it) => s + (it.ups || 1), 0);
  const isDualLenFinal = distinctSideALengths.length === 1 && distinctSideBLengths.length === 1 && distinctSideALengths[0] !== distinctSideBLengths[0];
  const isDualCoreFinal = distinctSideACores.length === 1 && distinctSideBCores.length === 1 && distinctSideACores[0] !== distinctSideBCores[0];
  if ((isDualLenFinal || isDualCoreFinal) && (Math.abs(sideAUpsFinal - sideBUpsFinal) > 1 || !duplexAssign.success)) return null;

  let totalClosed = 0;
  let totalPrioClosed = 0;
  finalSnapshot.ordersState.forEach((val, ordId) => {
    if (val.status === 'COMPLETED') {
      totalClosed++;
      if (priorityOrderIds.has(ordId)) totalPrioClosed++;
    }
  });

  return {
    initialCombination: currentSetup,
    selected_length: masterPackLength,
    is_mixed: isMixed,
    is_dual_core: duplexAssign.isDualCore || isDualCoreFinal,
    is_dual_length: duplexAssign.isDualLength || isDualLenFinal,
    side_a_ups: duplexAssign.sideAUps || sideAUpsFinal,
    side_b_ups: duplexAssign.sideBUps || sideBUpsFinal,
    side_a_core: duplexAssign.sideACore ?? distinctSideACores[0],
    side_b_core: duplexAssign.sideBCore ?? distinctSideBCores[0],
    side_a_length_m: duplexAssign.sideALength ?? distinctSideALengths[0],
    side_b_length_m: duplexAssign.sideBLength ?? distinctSideBLengths[0],
    balance_delta: Math.abs((duplexAssign.sideAUps || sideAUpsFinal) - (duplexAssign.sideBUps || sideBUpsFinal)),
    totalPacks: selectedTotalPacks,
    planItems: consolidatedPlanItems,
    planChanges: finalChanges,
    planSegments: [{
      id: 'seg-1', plan_id: '', segment_number: 1, name: `Initial Layout (Packs 1–${selectedTotalPacks})`,
      start_pack: 1, end_pack: selectedTotalPacks, repetitions: selectedTotalPacks,
      total_slit_width_mm: totalSlitInitial, trim_mm: trimInitial,
      ups: currentSetup.reduce((sum, item) => sum + item.ups, 0), items: consolidatedPlanItems, changes: finalChanges,
    }],
    totalPlannedWeightKg: bestEvaluatedPackResult.weightKg,
    totalOrderWeightKg: bestEvaluatedPackResult.weightKg,
    totalReels: finalHistory.length,
    ordersClosedCount: totalClosed,
    priorityOrdersClosed: totalPrioClosed,
    totalSlitWidth_mm: totalSlitInitial,
    trim_mm: trimInitial,
    totalUps: currentSetup.reduce((sum, item) => sum + item.ups, 0),
    simulatedOrdersState: finalSnapshot.ordersState,
    score: bestEvaluatedPackResult.score,
    effectiveShiftCount: finalEffectiveShifts,
    maxBoundaryShiftPeak: finalPeak,
  };
}

function simulateMultiCutCandidatesForSetup(
  comb: DecklePatternItem[],
  activeOrders: VA05Order[],
  filmThickness: number,
  filmDensity: number,
  deckleWidth: number,
  activeMinTrim: number,
  activeMaxTrim: number,
  minUps: number,
  maxUps: number,
  prioritySet: Set<string>,
  len: number,
  isMixed: boolean,
  remainingTargetForRun: number,
  maxAllowedForThisPlan: number,
  targetKg: number,
  cumulativePlannedKg: number,
  targetMaxKg: number
): MultiPackSimulationResult[] {
  const results: MultiPackSimulationResult[] = [];
  const fullSim = simulateMultiPackExecution(
    comb, activeOrders, filmThickness, filmDensity, deckleWidth,
    activeMinTrim, activeMaxTrim, minUps, maxUps, prioritySet,
    len, isMixed, remainingTargetForRun, maxAllowedForThisPlan, targetKg, cumulativePlannedKg
  );
  if (!fullSim || cumulativePlannedKg + fullSim.totalPlannedWeightKg > targetMaxKg + 0.0001) {
    return results;
  }
  results.push(fullSim);

  const cutBoundaries = Array.from(
    new Set(
      fullSim.planChanges
        .map(c => Number(c.after_pack || 0))
        .filter(ap => ap >= 1 && ap < fullSim.totalPacks)
    )
  ).sort((a, b) => a - b);

  for (const cutPack of cutBoundaries.slice(0, 3)) {
    const cutSim = simulateMultiPackExecution(
      comb, activeOrders, filmThickness, filmDensity, deckleWidth,
      activeMinTrim, activeMaxTrim, minUps, maxUps, prioritySet,
      len, isMixed, remainingTargetForRun, maxAllowedForThisPlan, targetKg, cumulativePlannedKg, cutPack
    );
    if (cutSim && cumulativePlannedKg + cutSim.totalPlannedWeightKg <= targetMaxKg + 0.0001) {
      results.push(cutSim);
    }
  }

  return results;
}

export function normalizeTreatmentGroup(ts: string | undefined | null): 'OUTSIDE' | 'INSIDE' | 'BOTH SIDE' | 'NONE' {
  if (!ts) return 'OUTSIDE';
  const clean = ts.trim().toUpperCase();
  if (clean === 'OS' || clean === 'OUTSIDE' || clean === 'OUT' || clean === 'O/S') return 'OUTSIDE';
  if (clean === 'IS' || clean === 'INSIDE' || clean === 'IN' || clean === 'I/S') return 'INSIDE';
  if (clean === 'BOTH' || clean === 'BOTH SIDE' || clean === 'BOTHSIDE' || clean === 'BS' || clean === 'B/S') return 'BOTH SIDE';
  if (clean === 'NONE' || clean === 'NT' || clean === 'NO' || clean === 'UN' || clean === 'UNTREATED') return 'NONE';
  return 'OUTSIDE';
}

export function isPlanDominant(candidate: MultiPackSimulationResult, incumbent: MultiPackSimulationResult): boolean {
  const candEffectiveKg = candidate.lookaheadCampaignKg !== undefined ? candidate.lookaheadCampaignKg : candidate.totalPlannedWeightKg;
  const incEffectiveKg = incumbent.lookaheadCampaignKg !== undefined ? incumbent.lookaheadCampaignKg : incumbent.totalPlannedWeightKg;

  if (Math.abs(candEffectiveKg - incEffectiveKg) > 25) return candEffectiveKg > incEffectiveKg;

  if (
    candidate.lookaheadTotalPlans !== undefined &&
    incumbent.lookaheadTotalPlans !== undefined &&
    candidate.lookaheadTotalChanges !== undefined &&
    incumbent.lookaheadTotalChanges !== undefined
  ) {
    const candPeak = candidate.lookaheadMaxPeakInCampaign ?? (candidate.maxBoundaryShiftPeak || 0);
    const incPeak = incumbent.lookaheadMaxPeakInCampaign ?? (incumbent.maxBoundaryShiftPeak || 0);
    const candBurden = candidate.lookaheadTotalPlans * 2.2 + candidate.lookaheadTotalChanges * 1.5 + (candPeak >= 2 ? candPeak * 1.2 : 0);
    const incBurden = incumbent.lookaheadTotalPlans * 2.2 + incumbent.lookaheadTotalChanges * 1.5 + (incPeak >= 2 ? incPeak * 1.2 : 0);
    if (Math.abs(candBurden - incBurden) > 0.1) return candBurden < incBurden;
  }

  const candEffShifts = candidate.effectiveShiftCount ?? candidate.planChanges.length;
  const incEffShifts = incumbent.effectiveShiftCount ?? incumbent.planChanges.length;
  if (candEffShifts !== incEffShifts) return candEffShifts < incEffShifts;

  if (Math.abs(candidate.totalPlannedWeightKg - incumbent.totalPlannedWeightKg) > 25) {
    return candidate.totalPlannedWeightKg > incumbent.totalPlannedWeightKg;
  }
  if (candidate.totalSlitWidth_mm !== incumbent.totalSlitWidth_mm) {
    return candidate.totalSlitWidth_mm > incumbent.totalSlitWidth_mm;
  }
  if (candidate.ordersClosedCount !== incumbent.ordersClosedCount) {
    return candidate.ordersClosedCount > incumbent.ordersClosedCount;
  }
  return candidate.totalPacks > incumbent.totalPacks;
}

function projectFutureLookaheadCampaign(
  residualOrders: VA05Order[],
  filmThickness: number,
  filmDensity: number,
  deckleWidth: number,
  minTrim: number,
  maxTrim: number,
  minUps: number,
  maxUps: number,
  prioritySet: Set<string>,
  targetMaxAllowedKg: number,
  depth: number = 2
): { futureKg: number; futurePlans: number; futureChanges: number; maxPeak: number } {
  if (depth <= 0 || residualOrders.length === 0 || targetMaxAllowedKg < 100) {
    return { futureKg: 0, futurePlans: 0, futureChanges: 0, maxPeak: 0 };
  }

  const activeLengths = Array.from(new Set(residualOrders.map(o => o.length_m))).sort((a, b) => b - a);
  let bestFutureKg = 0;
  let bestSimForDepth: MultiPackSimulationResult | null = null;

  for (const len of activeLengths) {
    const ordersThisLen = residualOrders.filter(o => o.length_m === len && o.remaining_qty > 0.05);
    if (ordersThisLen.length === 0) continue;

    const candidateCombinations = findInitialSameLengthDeckles(ordersThisLen, minTrim, maxTrim, minUps, maxUps, deckleWidth, len, 60);
    for (let i = 0; i < Math.min(6, candidateCombinations.length); i++) {
      const variants = simulateMultiCutCandidatesForSetup(
        candidateCombinations[i], ordersThisLen, filmThickness, filmDensity,
        deckleWidth, minTrim, maxTrim, minUps, maxUps, prioritySet, len, false,
        targetMaxAllowedKg, targetMaxAllowedKg, targetMaxAllowedKg, 0, targetMaxAllowedKg
      );
      for (const sim of variants) {
        if (sim && sim.totalPlannedWeightKg > 0) {
          const simEff = sim.effectiveShiftCount ?? sim.planChanges.length;
          const bestEff = bestSimForDepth ? (bestSimForDepth.effectiveShiftCount ?? bestSimForDepth.planChanges.length) : Infinity;
          if (!bestSimForDepth || sim.totalPlannedWeightKg > bestFutureKg + 25 || (Math.abs(sim.totalPlannedWeightKg - bestFutureKg) <= 25 && simEff < bestEff)) {
            bestFutureKg = sim.totalPlannedWeightKg;
            bestSimForDepth = sim;
          }
        }
      }
    }
  }

  if (!bestSimForDepth || bestFutureKg <= 0) {
    return { futureKg: 0, futurePlans: 0, futureChanges: 0, maxPeak: 0 };
  }

  const immediateChanges = bestSimForDepth.effectiveShiftCount ?? bestSimForDepth.planChanges.length;
  const immediatePeak = bestSimForDepth.maxBoundaryShiftPeak ?? 0;

  if (depth > 1) {
    const nextResidual = residualOrders.map(o => {
      const s = bestSimForDepth!.simulatedOrdersState.get(o.id);
      return {
        ...o,
        remaining_qty: s ? s.remaining_qty : o.remaining_qty,
        produced_qty: (o.produced_qty || 0) + (s ? s.produced_qty : 0),
      };
    }).filter(o => o.remaining_qty > 0.05);

    const downstream = projectFutureLookaheadCampaign(
      nextResidual, filmThickness, filmDensity, deckleWidth, minTrim, maxTrim,
      minUps, maxUps, prioritySet, Math.max(0, targetMaxAllowedKg - bestFutureKg), depth - 1
    );
    return {
      futureKg: bestFutureKg + downstream.futureKg,
      futurePlans: 1 + downstream.futurePlans,
      futureChanges: immediateChanges + downstream.futureChanges,
      maxPeak: Math.max(immediatePeak, downstream.maxPeak),
    };
  }

  return { futureKg: bestFutureKg, futurePlans: 1, futureChanges: immediateChanges, maxPeak: immediatePeak };
}

function executeSingleTreatmentGroupOptimization(
  input: OptimizationInput,
  startingPlanIndex = 1,
  runNumberOverride?: string
): OptimizationResult {
  const prevSsMode = _ssFixedDeckleMode;
  _ssFixedDeckleMode = !!input.ss_fixed_deckle_mode;

  const rules = input.rules || DEFAULT_PLANNING_RULES;
  const logs: OptimizationStepLog[] = [];
  let logStep = 1;
  function addLog(message: string, type: OptimizationStepLog['type'] = 'INFO', data?: any) {
    logs.push({ step: logStep++, message, type, data });
  }

  const trimRuleMode: TrimRuleMode = input.trim_rule_mode || 'NORMAL';
  let activeMinTrim = rules.min_trim_mm || 150;
  let activeMaxTrim = rules.max_trim_mm || 280;

  if (_ssFixedDeckleMode) {
    if (trimRuleMode === 'MANUAL_OVERRIDE' || trimRuleMode === 'RELAXED_50MM') {
      activeMinTrim = input.custom_min_trim_mm !== undefined ? input.custom_min_trim_mm : 11;
      activeMaxTrim = input.custom_max_trim_mm !== undefined ? input.custom_max_trim_mm : 45;
    } else {
      activeMinTrim = rules.min_trim_mm || 11;
      activeMaxTrim = rules.max_trim_mm || 35;
    }
  } else if (trimRuleMode === 'RELAXED_50MM') {
    activeMinTrim = 150;
    activeMaxTrim = 500;
  } else if (trimRuleMode === 'MANUAL_OVERRIDE') {
    activeMinTrim = input.custom_min_trim_mm !== undefined ? input.custom_min_trim_mm : 150;
    activeMaxTrim = input.custom_max_trim_mm !== undefined ? input.custom_max_trim_mm : 500;
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const activeFilms: string[] = (input.films && input.films.length > 0) ? Array.from(new Set(input.films)) : [input.film];
  const filmDisplay = activeFilms.join(' + ');
  const filmRunKey = activeFilms.map(f => f.replace(/[^a-zA-Z0-9]/g, '')).join('_');
  const runNumber = runNumberOverride || input.run_number || `RUN-${filmRunKey}-${dateStr}-${Math.floor(100 + Math.random() * 900)}`;

  const filmMasters = activeFilms.map(f => FILM_MASTERS.find(m => m.code === f));
  const filmThickness = activeFilms.map((f, i) => input.orders.find(o => o.film === f)?.thickness_micron || filmMasters[i]?.thickness_micron || 20)[0];
  const missingDensityFilms = findFilmsMissingDensity(activeFilms);
  if (missingDensityFilms.length > 0) {
    _ssFixedDeckleMode = prevSsMode;
    throw new Error(`Density not saved in Film Specs Master Database for: ${missingDensityFilms.join(', ')}.`);
  }
  const filmDensity = resolveFilmDensity(activeFilms[0]) || input.orders.find(o => activeFilms.includes(o.film) && o.density && o.density > 0)?.density || 0;
  if (!(filmDensity > 0)) {
    _ssFixedDeckleMode = prevSsMode;
    throw new Error(`Density not saved for film(s): ${activeFilms.join(', ')}.`);
  }

  const currentOrders: VA05Order[] = input.orders
    .filter(o => {
      if (!activeFilms.includes(o.film) || o.width_mm < minIndividualSlitWidthMm()) return false;
      const singleReelKg = calculateSingleReelWeight(o.width_mm, filmThickness, filmDensity, o.length_m);
      const activeDemand = Math.max(Number(o.remaining_qty || 0), Number(o.balance_qty || 0));
      const orderCeiling = activeDemand * (CUSTOMER_MAX_OVERALLOCATION_FACTOR + 0.0001);
      return singleReelKg <= orderCeiling;
    })
    .map(o => ({ ...o, remaining_qty: Number(o.remaining_qty), produced_qty: Number(o.produced_qty || 0) }));

  const prioritySet = new Set<string>(input.priority_order_ids || []);
  currentOrders.forEach(o => { if (o.priority) prioritySet.add(o.id); });

  const totalDemandKg = currentOrders.reduce((sum, o) => sum + o.remaining_qty, 0);
  const targetKg = input.target_quantity_kg !== undefined && input.target_quantity_kg > 0 ? input.target_quantity_kg : totalDemandKg;
  const isExplicitTargetMode = input.planning_mode === 'TARGET_QUANTITY' && input.target_quantity_kg !== undefined && input.target_quantity_kg > 0 && input.target_quantity_kg < totalDemandKg * 0.999;
  const targetMaxKg = targetKg * CUSTOMER_MAX_OVERALLOCATION_FACTOR;

  const generatedPlans: SlitterPlan[] = [];
  let cumulativePlannedKg = 0;
  let planIndex = startingPlanIndex;
  let status: OptimizationResult['status'] = 'COMPLETED';
  let stopReason = 'Planning completed: target output or eligible order closure achieved.';
  let suggestRelaxation = false;

  const MAX_PLANS_PER_RUN = _ssFixedDeckleMode ? 15 : 25;
  const planningCeilingKg = isExplicitTargetMode ? targetKg : targetMaxKg;

  while (cumulativePlannedKg < planningCeilingKg && generatedPlans.length < MAX_PLANS_PER_RUN) {
    if (isExplicitTargetMode && cumulativePlannedKg >= targetKg && cumulativePlannedKg <= targetMaxKg) {
      stopReason = `Target quantity achieved within +10% maximum tolerance (${cumulativePlannedKg.toFixed(2)} kg / ${targetKg.toLocaleString()} kg).`;
      addLog(stopReason, 'SUCCESS');
      break;
    }

    const activeOrders = currentOrders.filter(o => o.remaining_qty > 0.05);
    if (activeOrders.length === 0) {
      stopReason = 'All pending orders for this film grade have been fully planned and completed.';
      addLog(stopReason, 'SUCCESS');
      break;
    }

    const remainingTargetForRun = targetKg - cumulativePlannedKg;
    const maxAllowedForThisPlan = Math.max(0, targetMaxKg - cumulativePlannedKg);
    if (cumulativePlannedKg > 0 && maxAllowedForThisPlan < 100) {
      stopReason = `Stopping plan creation: Adding another physical plan would breach the +10% maximum limit of ${targetMaxKg.toFixed(2)} kg.`;
      addLog(stopReason, 'INFO');
      break;
    }

    const activeLengths = Array.from(new Set(activeOrders.map(o => o.length_m))).sort((lenA, lenB) => {
      const ordersA = activeOrders.filter(o => o.length_m === lenA);
      const ordersB = activeOrders.filter(o => o.length_m === lenB);
      const prioDiff = ordersB.filter(o => prioritySet.has(o.id) || o.priority).length - ordersA.filter(o => prioritySet.has(o.id) || o.priority).length;
      if (prioDiff !== 0) return prioDiff;
      return ordersB.reduce((sum, o) => sum + o.remaining_qty, 0) - ordersA.reduce((sum, o) => sum + o.remaining_qty, 0);
    });

    let bestSimulatedPlan: MultiPackSimulationResult | null = null;
    const elevateDual = shouldElevateDualLength(activeOrders, activeLengths, prioritySet, activeMinTrim, activeMaxTrim, rules.deckle_width_mm, rules.min_ups, rules.max_ups);
    const allTierCandidates: MultiPackSimulationResult[] = [];

    for (const len of activeLengths) {
      const candidateCombinations = findInitialSameLengthDeckles(activeOrders, activeMinTrim, activeMaxTrim, rules.min_ups, rules.max_ups, rules.deckle_width_mm, len);
      for (const comb of candidateCombinations) {
        const cutVariants = simulateMultiCutCandidatesForSetup(
          comb, activeOrders, filmThickness, filmDensity, rules.deckle_width_mm,
          activeMinTrim, activeMaxTrim, rules.min_ups, rules.max_ups, prioritySet,
          len, false, remainingTargetForRun, maxAllowedForThisPlan, targetKg, cumulativePlannedKg, targetMaxKg
        );
        allTierCandidates.push(...cutVariants);
      }
    }

    if (activeLengths.length >= 2) {
      for (let i = 0; i < activeLengths.length; i++) {
        for (let j = i + 1; j < activeLengths.length; j++) {
          const len1 = activeLengths[i];
          const len2 = activeLengths[j];
          if (!isPlanLengthCompatible([len1, len2])) continue;
          const dualLenDeckles = findDuplexDualLengthDeckles(activeOrders, activeMinTrim, activeMaxTrim, rules.deckle_width_mm, len1, len2);
          for (const comb of dualLenDeckles) {
            const cutVariants = simulateMultiCutCandidatesForSetup(
              comb, activeOrders, filmThickness, filmDensity, rules.deckle_width_mm,
              activeMinTrim, activeMaxTrim, rules.min_ups, rules.max_ups, prioritySet,
              Math.max(len1, len2), false, remainingTargetForRun, maxAllowedForThisPlan, targetKg, cumulativePlannedKg, targetMaxKg
            );
            for (const v of cutVariants) {
              if (elevateDual) v.score += 500000;
              allTierCandidates.push(v);
            }
          }
        }
      }
    }

    if (allTierCandidates.length > 0) {
      const topByScore = [...allTierCandidates].sort((a, b) => b.score - a.score).slice(0, 8);
      const topByZeroShifts = [...allTierCandidates]
        .filter(c => (c.effectiveShiftCount ?? c.planChanges.length) === 0)
        .sort((a, b) => b.totalPlannedWeightKg - a.totalPlannedWeightKg)
        .slice(0, 6);
      const topByLowShifts = [...allTierCandidates]
        .sort((a, b) => (a.effectiveShiftCount ?? a.planChanges.length) - (b.effectiveShiftCount ?? b.planChanges.length) || b.totalPlannedWeightKg - a.totalPlannedWeightKg)
        .slice(0, 6);
      const topByWeight = [...allTierCandidates].sort((a, b) => b.totalPlannedWeightKg - a.totalPlannedWeightKg).slice(0, 4);

      const poolMap = new Map<string, MultiPackSimulationResult>();
      [...topByScore, ...topByZeroShifts, ...topByLowShifts, ...topByWeight].forEach(c => {
        const key = `${c.totalPacks}_${c.planChanges.length}_${c.totalPlannedWeightKg.toFixed(1)}_${c.initialCombination.map(it => `${it.width}x${it.ups}`).join(',')}`;
        if (!poolMap.has(key)) poolMap.set(key, c);
      });

      const candidatesToEvaluate = Array.from(poolMap.values()).slice(0, 20);
      const lookaheadCache = new Map<string, { futureKg: number; futurePlans: number; futureChanges: number; maxPeak: number }>();

      for (const cand of candidatesToEvaluate) {
        const residualOrders: VA05Order[] = activeOrders.map(o => {
          const simState = cand.simulatedOrdersState.get(o.id);
          return {
            ...o,
            remaining_qty: simState ? simState.remaining_qty : o.remaining_qty,
            produced_qty: (o.produced_qty || 0) + (simState ? simState.produced_qty : 0),
          };
        }).filter(o => o.remaining_qty > 0.05);

        const remainingTargetAfterCand = Math.max(0, targetMaxKg - (cumulativePlannedKg + cand.totalPlannedWeightKg));
        const cacheKey = residualOrders.map(o => `${o.id}_${o.remaining_qty.toFixed(1)}`).join('|');
        let downstream = lookaheadCache.get(cacheKey);
        if (downstream === undefined) {
          downstream = projectFutureLookaheadCampaign(
            residualOrders, filmThickness, filmDensity, rules.deckle_width_mm,
            activeMinTrim, activeMaxTrim, rules.min_ups, rules.max_ups, prioritySet, remainingTargetAfterCand, 2
          );
          lookaheadCache.set(cacheKey, downstream);
        }

        const selfEffShifts = cand.effectiveShiftCount ?? cand.planChanges.length;
        const selfPeak = cand.maxBoundaryShiftPeak ?? 0;
        cand.lookaheadCampaignKg = cand.totalPlannedWeightKg + downstream.futureKg;
        cand.lookaheadTotalPlans = 1 + downstream.futurePlans;
        cand.lookaheadTotalChanges = selfEffShifts + downstream.futureChanges;
        cand.lookaheadMaxPeakInCampaign = Math.max(selfPeak, downstream.maxPeak);
      }

      candidatesToEvaluate.sort((a, b) => {
        const aC = a.lookaheadCampaignKg ?? a.totalPlannedWeightKg;
        const bC = b.lookaheadCampaignKg ?? b.totalPlannedWeightKg;
        if (Math.abs(bC - aC) > 25) return bC - aC;

        const aPeak = a.lookaheadMaxPeakInCampaign ?? 0;
        const bPeak = b.lookaheadMaxPeakInCampaign ?? 0;
        const aBurden = (a.lookaheadTotalPlans ?? 1) * 2.2 + (a.lookaheadTotalChanges ?? a.planChanges.length) * 1.5 + (aPeak >= 2 ? aPeak * 1.2 : 0);
        const bBurden = (b.lookaheadTotalPlans ?? 1) * 2.2 + (b.lookaheadTotalChanges ?? b.planChanges.length) * 1.5 + (bPeak >= 2 ? bPeak * 1.2 : 0);
        if (Math.abs(aBurden - bBurden) > 0.1) return aBurden - bBurden;
        return b.score - a.score;
      });

      bestSimulatedPlan = candidatesToEvaluate[0];
      for (let i = 1; i < candidatesToEvaluate.length; i++) {
        if (isPlanDominant(candidatesToEvaluate[i], bestSimulatedPlan)) {
          bestSimulatedPlan = candidatesToEvaluate[i];
        }
      }
    }

    if (!bestSimulatedPlan) {
      const tier3Candidates: MultiPackSimulationResult[] = [];
      for (const len of activeLengths) {
        const dualCoreDeckles = findDuplexDualCoreDeckles(activeOrders, activeMinTrim, activeMaxTrim, rules.deckle_width_mm, len);
        for (const comb of dualCoreDeckles) {
          const simDualCore = simulateMultiPackExecution(
            comb, activeOrders, filmThickness, filmDensity, rules.deckle_width_mm,
            activeMinTrim, activeMaxTrim, rules.min_ups, rules.max_ups, prioritySet,
            len, false, remainingTargetForRun, maxAllowedForThisPlan, targetKg, cumulativePlannedKg
          );
          if (simDualCore && cumulativePlannedKg + simDualCore.totalPlannedWeightKg <= targetMaxKg + 0.0001) {
            tier3Candidates.push(simDualCore);
          }
        }
      }
      if (tier3Candidates.length > 0) {
        tier3Candidates.sort((a, b) => b.totalPlannedWeightKg - a.totalPlannedWeightKg || b.score - a.score);
        bestSimulatedPlan = tier3Candidates[0];
      }
    }

    if (!bestSimulatedPlan) {
      const mixedCombinations = findInitialMixedLengthDeckles(activeOrders, activeMinTrim, activeMaxTrim, rules.min_ups, rules.max_ups, rules.deckle_width_mm);
      const tier4Candidates: MultiPackSimulationResult[] = [];
      for (const comb of mixedCombinations) {
        const simMixed = simulateMultiPackExecution(
          comb, activeOrders, filmThickness, filmDensity, rules.deckle_width_mm,
          activeMinTrim, activeMaxTrim, rules.min_ups, rules.max_ups, prioritySet,
          comb[0]?.length || 19500, true, remainingTargetForRun, maxAllowedForThisPlan, targetKg, cumulativePlannedKg
        );
        if (simMixed && cumulativePlannedKg + simMixed.totalPlannedWeightKg <= targetMaxKg + 0.0001) {
          tier4Candidates.push(simMixed);
        }
      }
      if (tier4Candidates.length > 0) {
        tier4Candidates.sort((a, b) => b.totalPlannedWeightKg - a.totalPlannedWeightKg || b.score - a.score);
        bestSimulatedPlan = tier4Candidates[0];
      }
    }

    if (!bestSimulatedPlan) {
      if (cumulativePlannedKg > 0) {
        stopReason = `Planning finished for this session. Total Planned: ${cumulativePlannedKg.toFixed(2)} kg.`;
        addLog(stopReason, 'SUCCESS');
        status = 'COMPLETED';
        break;
      }
      if (trimRuleMode === 'NORMAL' && generatedPlans.length === 0) suggestRelaxation = true;
      stopReason = `No feasible planning combination could be formed within trim bounds (${activeMinTrim}–${activeMaxTrim}mm).`;
      addLog(stopReason, 'WARNING');
      status = 'NO_FEASIBLE_MATCH';
      break;
    }

    const chosenPlan = bestSimulatedPlan;
    chosenPlan.simulatedOrdersState.forEach((val, ordId) => {
      const actualOrder = currentOrders.find(o => o.id === ordId);
      if (actualOrder) {
        actualOrder.remaining_qty = val.remaining_qty;
        actualOrder.produced_qty = val.produced_qty;
        actualOrder.status = val.status as any;
      }
    });

    const planNumber = `PS1-${dateStr}-${String(planIndex).padStart(3, '0')}`;
    const planId = `plan-${planNumber}-${Date.now()}-${planIndex}`;
    const plannedMrLength = chosenPlan.totalPacks * chosenPlan.selected_length;

    const finalPlanItems: PlanItem[] = chosenPlan.planItems.map((item, idx) => ({
      ...item,
      id: `item-${planId}-${idx + 1}`,
      plan_id: planId,
      segment_id: `seg-${planId}-1`,
    }));

    const finalPlanChanges: PlanChange[] = chosenPlan.planChanges
      .filter(chg => Number(chg.after_pack) > 0)
      .map((chg, idx) => ({
        ...chg,
        id: `change-${planId}-${idx + 1}`,
        plan_id: planId,
      }));

    const finalPlanSegments: PlanSegment[] = [{
      id: `seg-${planId}-1`, plan_id: planId, segment_number: 1,
      name: `Initial Layout (Packs 1–${chosenPlan.totalPacks})`,
      start_pack: 1, end_pack: chosenPlan.totalPacks, repetitions: chosenPlan.totalPacks,
      total_slit_width_mm: chosenPlan.totalSlitWidth_mm, trim_mm: chosenPlan.trim_mm,
      ups: chosenPlan.totalUps, items: finalPlanItems, changes: finalPlanChanges,
    }];

    const trimWeight = calculateTrimWeight(chosenPlan.trim_mm, filmThickness, filmDensity, plannedMrLength);
    const millRollWeight = calculateMillRollWeight(rules.deckle_width_mm, filmThickness, filmDensity, plannedMrLength);
    const wastePercent = Math.round((chosenPlan.trim_mm / rules.deckle_width_mm) * 10000) / 100;
    const weightPerPack = chosenPlan.totalPlannedWeightKg / Math.max(1, chosenPlan.totalPacks);

    generatedPlans.push({
      id: planId, planning_run_id: runNumber, plan_number: planNumber,
      machine_id: 'PS01', machine_name: 'PRIMARY SLITTER 1',
      film: filmDisplay, films: activeFilms, thickness_micron: filmThickness, density: filmDensity,
      deckle_mm: rules.deckle_width_mm, total_slit_width_mm: chosenPlan.totalSlitWidth_mm,
      trim_mm: chosenPlan.trim_mm, allowed_trim_mm: activeMaxTrim || 280,
      remaining_web_mm: Math.max(0, chosenPlan.trim_mm - (rules.min_trim_mm || 150)),
      ups: chosenPlan.totalUps, max_ups_capacity: rules.max_ups,
      repetitions: chosenPlan.totalPacks, length_m: chosenPlan.selected_length,
      planned_mr_length_m: plannedMrLength, mill_roll_weight_kg: millRollWeight,
      trim_weight_kg: trimWeight, waste_percent: wastePercent,
      planned_quantity_kg: chosenPlan.totalPlannedWeightKg, order_weight_kg: chosenPlan.totalPlannedWeightKg,
      total_reels: chosenPlan.totalReels, weight_per_pack_total_kg: weightPerPack,
      rejection_material: activeFilms.map(f => `R-${f}`).join(' / '),
      trim_rule_mode: trimRuleMode, min_trim_mm_used: activeMinTrim, max_trim_mm_used: activeMaxTrim,
      trim_override_reason: input.trim_override_reason, trim_override_by: input.created_by,
      duplex_layout: {
        side_a_ups: chosenPlan.side_a_ups || Math.ceil(chosenPlan.totalUps / 2),
        side_b_ups: chosenPlan.side_b_ups || Math.floor(chosenPlan.totalUps / 2),
        side_a_core: chosenPlan.side_a_core, side_b_core: chosenPlan.side_b_core,
        side_a_length_m: chosenPlan.side_a_length_m, side_b_length_m: chosenPlan.side_b_length_m,
        is_dual_core: chosenPlan.is_dual_core, is_dual_length: chosenPlan.is_dual_length,
        balance_delta: chosenPlan.balance_delta !== undefined ? chosenPlan.balance_delta : Math.abs((chosenPlan.side_a_ups || 0) - (chosenPlan.side_b_ups || 0)),
      },
      doc_ref: 'APS/QR/PL/01', rev_no: 0, issue_date: new Date().toLocaleDateString('en-GB'),
      items: finalPlanItems, changes: finalPlanChanges, segments: finalPlanSegments,
      status: 'DRAFT', created_at: new Date().toISOString(),
    });

    cumulativePlannedKg += chosenPlan.totalPlannedWeightKg;
    addLog(
      `Plan [${planNumber}] Generated [${chosenPlan.totalPacks} Packs · ${finalPlanChanges.length} Shifts (${chosenPlan.effectiveShiftCount ?? finalPlanChanges.length} Effective)]: ${plannedMrLength.toLocaleString()}m MR · ${chosenPlan.totalUps} UPS · Output: ${chosenPlan.totalPlannedWeightKg.toFixed(2)} kg`,
      'SUCCESS'
    );
    planIndex++;
  }

  const closedCount = currentOrders.filter(o => o.status === 'COMPLETED').length;
  const partialCount = currentOrders.filter(o => o.status === 'PARTIALLY_FULFILLED').length;
  const remainingCount = currentOrders.filter(o => o.remaining_qty > 0).length;
  const targetDeviationPercent = isExplicitTargetMode ? Math.round(((cumulativePlannedKg - targetKg) / targetKg) * 10000) / 100 : 0;

  const planningRun: PlanningRun = {
    id: `run-${runNumber}`, run_number: runNumber, film: filmDisplay, films: activeFilms,
    target_quantity_kg: targetKg, planned_quantity_kg: Math.round(cumulativePlannedKg * 100) / 100,
    remaining_quantity_kg: Math.max(0, Math.round((totalDemandKg - cumulativePlannedKg) * 100) / 100),
    target_min_kg: undefined, target_max_kg: isExplicitTargetMode ? targetMaxKg : undefined,
    target_deviation_percent: targetDeviationPercent, planning_mode: input.planning_mode,
    priority_so_items: Array.from(prioritySet), status, stop_reason: stopReason,
    rules_version: rules.version || '1.0', optimizer_version: '3.8.0-ps-main-ss-frozen-delegate',
    trim_rule_mode: trimRuleMode, min_trim_mm_used: activeMinTrim, max_trim_mm_used: activeMaxTrim,
    trim_override_reason: input.trim_override_reason, trim_override_by: input.created_by,
    created_by: input.created_by || 'M.USMAN (Planner)', created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(), plans_count: generatedPlans.length,
    orders_closed_count: closedCount, orders_partial_count: partialCount, orders_remaining_count: remainingCount,
  };

  _ssFixedDeckleMode = prevSsMode;
  return {
    run: planningRun,
    plans: generatedPlans,
    remaining_orders: currentOrders,
    logs,
    status,
    stop_reason: stopReason,
    suggest_trim_relaxation: suggestRelaxation,
  };
}

/**
 * SS module (TNBPL10 / MATTPL12 @ fixed 1705) — ALWAYS the frozen New-folder-(2)
 * high order-fill engine. Does NOT use 3.8.0 50mm-cap path (that reduced SS qty).
 */
export function generateSsFixedDecklePlans(input: OptimizationInput): OptimizationResult {
  return generateSsFixedDecklePlansFromFrozen(input);
}

export function generatePrimarySlitterPlans(input: OptimizationInput): OptimizationResult {
  const activeFilms: string[] = (input.films && input.films.length > 0) ? Array.from(new Set(input.films)) : [input.film];
  const filmMasters = activeFilms.map(f => FILM_MASTERS.find(m => m.code === f));
  const filmThickness = activeFilms.map((f, i) => input.orders.find(o => o.film === f)?.thickness_micron || filmMasters[i]?.thickness_micron || 20)[0];
  const missingDensityFilms = findFilmsMissingDensity(activeFilms);
  if (missingDensityFilms.length > 0) {
    throw new Error(`Density not saved in Film Specs Master Database for: ${missingDensityFilms.join(', ')}.`);
  }
  const filmDensity = resolveFilmDensity(activeFilms[0]) || input.orders.find(o => activeFilms.includes(o.film) && o.density && o.density > 0)?.density || 0;
  if (!(filmDensity > 0)) {
    throw new Error(`Density not saved for film(s): ${activeFilms.join(', ')}.`);
  }

  const eligibleOrders = input.orders.filter(o => {
    if (!activeFilms.includes(o.film) || !isPS01Order(o)) return false;
    if (Number(o.remaining_qty) <= 0.05 && o.status !== 'PENDING' && o.status !== 'PARTIALLY_FULFILLED') return false;
    const singleReelKg = calculateSingleReelWeight(o.width_mm, filmThickness, filmDensity, o.length_m);
    const activeDemand = Math.max(Number(o.remaining_qty || 0), Number(o.balance_qty || 0));
    const orderCeiling = activeDemand * (CUSTOMER_MAX_OVERALLOCATION_FACTOR + 0.0001);
    return singleReelKg <= orderCeiling;
  });

  const treatmentMap = new Map<'OUTSIDE' | 'INSIDE' | 'BOTH SIDE' | 'NONE', VA05Order[]>();
  for (const ord of eligibleOrders) {
    const grp = normalizeTreatmentGroup(ord.treatment_side);
    if (!treatmentMap.has(grp)) treatmentMap.set(grp, []);
    treatmentMap.get(grp)!.push(ord);
  }

  if (treatmentMap.size <= 1) {
    return executeSingleTreatmentGroupOptimization(input);
  }

  const groupOrder: ('OUTSIDE' | 'INSIDE' | 'BOTH SIDE' | 'NONE')[] = ['OUTSIDE', 'INSIDE', 'BOTH SIDE', 'NONE'];
  const presentGroups = groupOrder.filter(g => treatmentMap.has(g) && treatmentMap.get(g)!.length > 0);
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filmRunKey = activeFilms.map(f => f.replace(/[^a-zA-Z0-9]/g, '')).join('_');
  const runNumber = input.run_number || `RUN-${filmRunKey}-${dateStr}-${Math.floor(100 + Math.random() * 900)}`;

  const allGeneratedPlans: SlitterPlan[] = [];
  let cumulativePlannedKg = 0;
  let currentPlanIndex = 1;
  const allLogs: OptimizationStepLog[] = [];
  let logStep = 1;

  const updatedOrdersMap = new Map<string, VA05Order>();
  input.orders.forEach(o => updatedOrdersMap.set(o.id, { ...o, remaining_qty: Number(o.remaining_qty), produced_qty: Number(o.produced_qty || 0) }));

  const totalDemandKg = eligibleOrders.reduce((sum, o) => sum + Number(o.remaining_qty), 0);
  const targetKg = input.target_quantity_kg !== undefined && input.target_quantity_kg > 0 ? input.target_quantity_kg : totalDemandKg;
  const isExplicitTargetMode = input.planning_mode === 'TARGET_QUANTITY' && input.target_quantity_kg !== undefined && input.target_quantity_kg > 0 && input.target_quantity_kg < totalDemandKg * 0.999;
  const targetMaxKg = targetKg * CUSTOMER_MAX_OVERALLOCATION_FACTOR;

  for (const groupKey of presentGroups) {
    const groupOrders = treatmentMap.get(groupKey)!;
    const groupDemandKg = groupOrders.reduce((sum, o) => sum + Number(o.remaining_qty), 0);
    let groupTargetKg: number | undefined = undefined;
    if (isExplicitTargetMode) {
      const remainingTarget = Math.max(0, targetKg - cumulativePlannedKg);
      if (remainingTarget <= 0 || cumulativePlannedKg >= targetKg) break;
      groupTargetKg = Math.min(groupDemandKg, remainingTarget);
    }

    const groupResult = executeSingleTreatmentGroupOptimization(
      { ...input, orders: groupOrders, target_quantity_kg: groupTargetKg, run_number: runNumber },
      currentPlanIndex,
      runNumber
    );

    if (groupResult.plans.length > 0) {
      allGeneratedPlans.push(...groupResult.plans);
      currentPlanIndex += groupResult.plans.length;
      cumulativePlannedKg += groupResult.run.planned_quantity_kg;
    }
    groupResult.remaining_orders.forEach(upd => updatedOrdersMap.set(upd.id, upd));
    groupResult.logs.forEach(l => allLogs.push({ step: logStep++, message: `[${groupKey}] ${l.message}`, type: l.type, data: l.data }));
  }

  const allUpdatedOrders = Array.from(updatedOrdersMap.values());
  const closedCount = allUpdatedOrders.filter(o => activeFilms.includes(o.film) && o.status === 'COMPLETED').length;
  const partialCount = allUpdatedOrders.filter(o => activeFilms.includes(o.film) && o.status === 'PARTIALLY_FULFILLED').length;
  const remainingCount = allUpdatedOrders.filter(o => activeFilms.includes(o.film) && o.remaining_qty > 0).length;
  const targetDeviationPercent = isExplicitTargetMode && targetKg > 0 ? Math.round(((cumulativePlannedKg - targetKg) / targetKg) * 10000) / 100 : 0;

  const overallStatus: OptimizationResult['status'] = allGeneratedPlans.length > 0 ? 'COMPLETED' : 'NO_FEASIBLE_MATCH';
  const overallStopReason = allGeneratedPlans.length > 0
    ? `Completed separate planning across ${presentGroups.length} Treatment Side group(s) with ${allGeneratedPlans.length} plan(s).`
    : `No feasible plans found for the requested Treatment Side groups.`;

  const rules = input.rules || DEFAULT_PLANNING_RULES;
  const trimRuleMode = input.trim_rule_mode || 'NORMAL';
  let activeMinTrim = rules.min_trim_mm || 150;
  let activeMaxTrim = rules.max_trim_mm || 280;
  if (trimRuleMode === 'RELAXED_50MM') { activeMinTrim = 150; activeMaxTrim = 500; }
  else if (trimRuleMode === 'MANUAL_OVERRIDE') {
    activeMinTrim = input.custom_min_trim_mm !== undefined ? input.custom_min_trim_mm : 150;
    activeMaxTrim = input.custom_max_trim_mm !== undefined ? input.custom_max_trim_mm : 500;
  }

  return {
    run: {
      id: `run-${runNumber}`, run_number: runNumber, film: activeFilms.join(' + '), films: activeFilms,
      target_quantity_kg: targetKg, planned_quantity_kg: Math.round(cumulativePlannedKg * 100) / 100,
      remaining_quantity_kg: Math.max(0, Math.round((totalDemandKg - cumulativePlannedKg) * 100) / 100),
      target_min_kg: undefined, target_max_kg: isExplicitTargetMode ? targetMaxKg : undefined,
      target_deviation_percent: targetDeviationPercent, planning_mode: input.planning_mode,
      priority_so_items: Array.from(input.priority_order_ids || []), status: overallStatus, stop_reason: overallStopReason,
      rules_version: rules.version || '1.0', optimizer_version: '3.8.0-ps-main-ss-frozen-delegate',
      trim_rule_mode: trimRuleMode, min_trim_mm_used: activeMinTrim, max_trim_mm_used: activeMaxTrim,
      trim_override_reason: input.trim_override_reason, trim_override_by: input.created_by,
      created_by: input.created_by || 'M.USMAN (Planner)', created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(), plans_count: allGeneratedPlans.length,
      orders_closed_count: closedCount, orders_partial_count: partialCount, orders_remaining_count: remainingCount,
    },
    plans: allGeneratedPlans,
    remaining_orders: allUpdatedOrders,
    logs: allLogs,
    status: overallStatus,
    stop_reason: overallStopReason,
    suggest_trim_relaxation: allGeneratedPlans.length === 0,
  };
}
