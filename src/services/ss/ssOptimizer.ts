import { resolveFilmDensity, findFilmsMissingDensity } from '../stuffing/filmDensities';
import { VA05Order } from '../../types';
import { 
  SSJumboRoll, 
  SSMachineSettings, 
  SSPlan, 
  SSJumboRequirement,
  SSPlanOrderAllocation,
  JumboRoll,
  MetallizerMachineSettings,
  MetallizerPlan,
  JumboRequirement,
  MetallizerPlanOrderAllocation
} from '../../types/ss';
import { calculateJumboDiameter, calculateJumboWeight, DEFAULT_SS_SETTINGS } from './ssMasterData';
import { evaluatePS01Feasibility, evaluatePS01CombinationFeasibility, PS01FeasibilityEvaluation } from './ssPs01FeasibilityAdapter';
import {
  FilmCompatibilityRule,
  DEFAULT_FILM_COMPATIBILITY_RULES,
  areFilmsCompatible,
  getCompatibleFilmsFor,
  getCompatibleGroupForFilm,
  getAllCompatibleGroups
} from './ssFilmCompatibilityMaster';
import { getStoredSSJumboRequirements } from './ssStorage';

/**
 * Factory-approved customer allocation tolerance ceiling (+10% maximum).
 * Hard rule: Allocated Weight <= Demand * 1.10 per individual customer order line.
 */
export const SS_CUSTOMER_MAX_OVERALLOCATION_FACTOR = 1.10;

export interface SSCandidatePattern {
  jumbo_roll: SSJumboRoll;
  ups: number;
  slit_widths: number[];
  orders: {
    order: VA05Order;
    ups: number;
    width_mm: number;
    length_m: number;
    reels: number;
    weight_kg: number;
    is_closed: boolean;
  }[];
  total_slit_width_mm: number;
  trim_mm: number;
  package_length_m: number;
  package_multiple: number;
  total_planned_weight_kg: number;
  trim_weight_kg: number;
  waste_percent: number;
  score: number;
}

export type MetallizerCandidatePattern = SSCandidatePattern;

export interface SSOptimizationStrategyEvaluation {
  strategy: 'COMBINED' | 'SEPARATE';
  film_group: string;
  films_included: string[];
  requirements: SSJumboRequirement[];
  total_rolls: number;
  unique_jumbo_widths: number[];
  total_planned_kg: number;
  total_trim_kg: number;
  average_waste_percent: number;
  ps01_3ups_count: number;
  ps01_4ups_count: number;
  max_jumbo_length_m: number;
  is_fully_feasible: boolean;
  score: number;
  reason: string;
}

export type OptimizationStrategyEvaluation = SSOptimizationStrategyEvaluation;

/**
 * SECONDARY SLITTER (SS) FILM IDENTIFICATION
 * MZ film-code orders are EXCLUDED from SS demand/planning selection.
 * Non-MZ film codes from the shared SAP VA05 order backlog are INCLUDED in SS.
 */
export function isSSFilm(filmCode: string | undefined | null): boolean {
  if (!filmCode || typeof filmCode !== 'string') return false;
  const trimmed = filmCode.trim();
  if (trimmed.length === 0) return false;
  return !trimmed.toUpperCase().includes('MZ');
}

export const isMetallizedFilm = isSSFilm;

function binarySearchLower(arr: number[], target: number, low: number, high: number): number {
  let l = low;
  let r = high;
  let ans = high + 1;
  while (l <= r) {
    const mid = (l + r) >> 1;
    if (arr[mid] >= target) {
      ans = mid;
      r = mid - 1;
    } else {
      l = mid + 1;
    }
  }
  return ans;
}

function binarySearchUpper(arr: number[], target: number, low: number, high: number): number {
  let l = low;
  let r = high;
  let ans = low - 1;
  while (l <= r) {
    const mid = (l + r) >> 1;
    if (arr[mid] <= target) {
      ans = mid;
      l = mid + 1;
    } else {
      r = mid - 1;
    }
  }
  return ans;
}

/**
 * SECONDARY SLITTER (SS) DEFAULT DEMAND CLASSIFICATION
 * Default SS demand includes non-MZ orders with width < 355 mm.
 * Also includes SS-routed film/length pairs even when width ≥ 355 mm:
 *   MATTPL12 @ 3000 m, TNBPL10 @ 3600 m → Secondary Slitter only (not PS01).
 */
function isSSRoutedByFilmLength(order: {
  film?: string | null;
  length_m?: number | null;
}): boolean {
  if (!order?.film) return false;
  const film = String(order.film).trim().toUpperCase();
  const len = Number(order.length_m);
  if (!Number.isFinite(len) || len <= 0) return false;
  if (film === 'MATTPL12' && Math.abs(len - 3000) < 0.5) return true;
  if (film === 'TNBPL10' && Math.abs(len - 3600) < 0.5) return true;
  return false;
}

export function isSSOrder(order: VA05Order | undefined | null): boolean {
  if (!order) return false;
  if (!isSSFilm(order.film)) return false;
  if (Number(order.width_mm) < 355) return true;
  return isSSRoutedByFilmLength(order);
}

export const isMetallizerOrder = isSSOrder;

export function generateSSWidthCombinations(
  uniqueWidths: number[],
  maxUps: number = 20,
  maxTotalWidth: number = 1730,
  minTrim: number = 15
): { widths: number[]; ups: number; sumWidth: number }[] {
  const sortedWidths = uniqueWidths.slice().sort((a, b) => a - b);
  const combinations: { widths: number[]; ups: number; sumWidth: number }[] = [];
  const maxSsUps = Math.min(20, maxUps);

  function explore(currentWidths: number[], startIndex: number, currentSum: number) {
    if (currentWidths.length > 0) {
      if (currentSum + minTrim <= maxTotalWidth) {
        combinations.push({
          widths: currentWidths.slice(),
          ups: currentWidths.length,
          sumWidth: currentSum,
        });
      }
    }
    if (currentWidths.length >= maxSsUps) return;

    for (let i = startIndex; i < sortedWidths.length; i++) {
      const w = sortedWidths[i];
      if (currentSum + w + minTrim > maxTotalWidth) break;
      currentWidths.push(w);
      explore(currentWidths, i, currentSum + w);
      currentWidths.pop();
    }
  }

  explore([], 0, 0);
  return combinations;
}

export const generateMSLWidthCombinations = generateSSWidthCombinations;

/**
 * Phase-1 safe speedup: build only physically legal length assignments.
 * Equivalent feasible set to full Cartesian + post-filters:
 *  - pure same-length packs
 *  - dual-length only when L2 === 2*L1, shaft-balanced, each side ≤ maxPerShaft
 * No valid pattern is excluded; invalid Cartesian paths are never generated.
 */
function buildLegalLengthAssignments(
  possibleCutLengths: number[][],
  maxPerShaft: number
): number[][] {
  const n = possibleCutLengths.length;
  if (n === 0) return [];

  const results: number[][] = [];
  const allLengths = new Set<number>();
  for (const arr of possibleCutLengths) {
    for (const L of arr) allLengths.add(L);
  }

  // 1) Pure same-length: every cut position must accept L
  for (const L of allLengths) {
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (!possibleCutLengths[i].includes(L)) {
        ok = false;
        break;
      }
    }
    if (ok) results.push(Array(n).fill(L));
  }

  // 2) Dual-length 1:2 only (shaft-balanced). Caller dedupes with width-aware key.
  for (const L of allLengths) {
    const L2 = L * 2;
    if (!allLengths.has(L2)) continue;

    const explore = (idx: number, current: number[], countL: number, countL2: number) => {
      if (idx === n) {
        if (countL === 0 || countL2 === 0) return;
        if (countL > maxPerShaft || countL2 > maxPerShaft) return;
        if (Math.abs(countL - countL2) > 1) return;
        results.push(current.slice());
        return;
      }
      const allowed = possibleCutLengths[idx];
      if (allowed.includes(L)) {
        current.push(L);
        explore(idx + 1, current, countL + 1, countL2);
        current.pop();
      }
      if (allowed.includes(L2)) {
        current.push(L2);
        explore(idx + 1, current, countL, countL2 + 1);
        current.pop();
      }
    };
    explore(0, [], 0, 0);
  }

  return results;
}

function optimizeDemandPool(
  groupOrders: VA05Order[],
  rawSettings: SSMachineSettings,
  groupLabel: string,
  startReqCounter: number = 1
): { requirements: SSJumboRequirement[]; score: number; evaluation: SSOptimizationStrategyEvaluation } {
  const settings = { ...DEFAULT_SS_SETTINGS, ...rawSettings };
  const motherDeckle = Number(settings.ps01_deckle_width_mm) > 0
    ? Number(settings.ps01_deckle_width_mm)
    : 10400;
  if (groupOrders.length === 0) {
    return {
      requirements: [],
      score: 0,
      evaluation: {
        strategy: 'SEPARATE',
        film_group: groupLabel,
        films_included: [],
        requirements: [],
        total_rolls: 0,
        unique_jumbo_widths: [],
        total_planned_kg: 0,
        total_trim_kg: 0,
        average_waste_percent: 0,
        ps01_3ups_count: 0,
        ps01_4ups_count: 0,
        max_jumbo_length_m: 0,
        is_fully_feasible: true,
        score: 0,
        reason: 'No open orders',
      },
    };
  }

  const filmsInGroup = Array.from(new Set(groupOrders.map(o => o.film)));
  const thickness = groupOrders[0].thickness_micron || settings.thickness_micron_default;
  const filmCodesForDensity = Array.from(new Set(groupOrders.map(o => o.film).filter(Boolean)));
  const missingDens = filmCodesForDensity.filter(f => {
    if (resolveFilmDensity(f) != null) return false;
    return !groupOrders.some(o => o.film === f && Number(o.density) > 0);
  });
  if (missingDens.length > 0) {
    throw new Error(
      `Density not saved in Film Specs Master Database for: ${missingDens.join(', ')}. ` +
      `Open Master Backlog → Film Specs Master DB and add density before SS planning.`
    );
  }
  const density =
    resolveFilmDensity(filmCodesForDensity[0] || '') ||
    Number(groupOrders.find(o => Number(o.density) > 0)?.density) ||
    0;
  if (!(density > 0)) {
    throw new Error(`Density not saved for film(s): ${filmCodesForDensity.join(', ')}.`);
  }
  const maxSsUps = Math.min(20, settings.max_planning_ups || 20);

  // Phase-1: memoize pure weight formula (identical inputs → identical kg)
  const weightMemo = new Map<string, number>();
  const weightKg = (widthMm: number, lengthM: number, t = thickness, d = density): number => {
    const key = `${widthMm}|${t}|${d}|${lengthM}`;
    let v = weightMemo.get(key);
    if (v === undefined) {
      v = calculateJumboWeight(widthMm, t, d, lengthM);
      weightMemo.set(key, v);
    }
    return v;
  };

  interface LengthFamily {
    familyId: string;
    lengths: number[];
    baseLengthM: number;
    packLengthM: number;
    validMultiples: { multiple: number; length_m: number; diameter_mm: number }[];
  }

  function computeLengthFamilies(
    lengths: number[],
    filmThickness: number,
    maxDiameterMm: number,
    configuredMultiples: number[]
  ): LengthFamily[] {
    const sorted = Array.from(new Set(lengths)).sort((a, b) => a - b);
    const visited = new Set<number>();
    const families: LengthFamily[] = [];

    function gcd(a: number, b: number): number {
      while (b) { const t = b; b = a % b; a = t; }
      return a;
    }
    function lcm(a: number, b: number): number {
      return (a * b) / gcd(a, b);
    }

    for (const len of sorted) {
      if (visited.has(len)) continue;
      const famLens: number[] = [len];
      visited.add(len);

      for (const other of sorted) {
        if (!visited.has(other)) {
          const isDivisible = famLens.some(
            l => other === l * 2 || l === other * 2 || other === l * 3 || l === other * 3 || other === l * 4 || l === other * 4 || (l % other === 0) || (other % l === 0)
          );
          let hasCommonMultiple = false;
          if (!isDivisible) {
            for (const l of famLens) {
              const m = lcm(l, other);
              if (calculateJumboDiameter(filmThickness, m) <= maxDiameterMm) {
                hasCommonMultiple = true;
                break;
              }
            }
          }
          if (isDivisible || hasCommonMultiple) {
            famLens.push(other);
            visited.add(other);
          }
        }
      }
      famLens.sort((a, b) => a - b);

      const multLengthsSet = new Set<number>();
      for (const l of famLens) {
        let k = 1;
        while (true) {
          const jLen = l * k;
          const dia = calculateJumboDiameter(filmThickness, jLen);
          if (dia > maxDiameterMm) break;
          multLengthsSet.add(jLen);
          k++;
          if (k > 50) break;
        }
      }

      const validMultiples = Array.from(multLengthsSet).map(jLen => ({
        multiple: Math.round(jLen / famLens[0]),
        length_m: jLen,
        diameter_mm: calculateJumboDiameter(filmThickness, jLen),
      })).sort((a, b) => b.length_m - a.length_m);

      families.push({
        familyId: famLens.join('_'),
        lengths: famLens,
        baseLengthM: famLens[0],
        packLengthM: famLens[famLens.length - 1],
        validMultiples,
      });
    }

    return families;
  }

  const lengthFamilies = computeLengthFamilies(
    groupOrders.map(o => o.length_m || 19500),
    thickness,
    settings.max_jumbo_diameter_mm,
    settings.package_multiples
  );

  interface OrderTracker {
    order: VA05Order;
    pkgLength: number;
    lengthMultiple: number;
    slotIdx: number;
    initialBalanceKg: number;
    maxAllowedKg: number;
    allocatedKg: number;
    remainingKg: number;
    allocatedReels: number;
    status: 'PENDING' | 'PARTIALLY_FULFILLED' | 'COMPLETED';
  }

  interface DemandSlot {
    film: string;
    width_mm: number;
    length_m: number;
    familyId: string;
    key: string;
  }
  const demandSlots: DemandSlot[] = [];
  const slotMap = new Map<string, number>();

  for (const o of groupOrders) {
    const len = o.length_m || 19500;
    const fam = lengthFamilies.find(f => f.lengths.includes(len)) || lengthFamilies[0];
    const key = `${o.film}__${o.width_mm}__${len}`;
    if (!slotMap.has(key)) {
      slotMap.set(key, demandSlots.length);
      demandSlots.push({ film: o.film, width_mm: o.width_mm, length_m: len, familyId: fam.familyId, key });
    }
  }
  const numDemandSlots = demandSlots.length;

  const orderTrackers: OrderTracker[] = groupOrders.map(o => {
    const len = o.length_m || 19500;
    const fam = lengthFamilies.find(f => f.lengths.includes(len)) || lengthFamilies[0];
    const mult = Math.max(1, Math.round(len / fam.baseLengthM));
    const slotIdx = slotMap.get(`${o.film}__${o.width_mm}__${len}`)!;
    return {
      order: o,
      pkgLength: len,
      lengthMultiple: mult,
      slotIdx,
      initialBalanceKg: o.remaining_qty,
      maxAllowedKg: Number((o.remaining_qty * SS_CUSTOMER_MAX_OVERALLOCATION_FACTOR).toFixed(2)),
      allocatedKg: 0,
      remainingKg: o.remaining_qty,
      allocatedReels: 0,
      status: 'PENDING',
    };
  });

  interface MS1CutDef {
    slotIdx: number;
    film: string;
    width_mm: number;
    length_m: number;
    reelsPerJumbo: number;
    singleReelWeightKg: number;
  }

  interface MS1JumboCandidate {
    id: string;
    film: string;
    familyId: string;
    combo: { widths: number[]; ups: number; sumWidth: number };
    jumboWidth: number;
    mslTrim: number;
    packageMultiple: number;
    jumboLengthM: number;
    jumboDiameterMm: number;
    singleJumboWeightKg: number;
    cutsList: MS1CutDef[];
    cuts: number[];
    activeIndices: number[];
  }

  function generateCandidatePool(activeTrackers: OrderTracker[]): MS1JumboCandidate[] {
    const activeFilms = Array.from(new Set(activeTrackers.map(t => t.order.film)));
    if (activeFilms.length === 0) return [];

    // Factory Edge Trim Policy: GREEN 11–35 mm, YELLOW 36–45 mm
    // Dynamic candidate trims from settings (CUSTOM window supported for all films)
    const _ctMin = Number.isFinite(Number(settings.min_trim_mm)) ? Number(settings.min_trim_mm) : 11;
    const _ctHard = Number.isFinite(Number(settings.hard_max_trim_mm))
      ? Number(settings.hard_max_trim_mm)
      : (Number.isFinite(Number(settings.max_trim_mm)) ? Number(settings.max_trim_mm) : 45);
    const candidateTrims: number[] = [];
    {
      const lo = Math.min(_ctMin, _ctHard);
      const hi = Math.max(_ctMin, _ctHard);
      candidateTrims.push(lo);
      for (let t = Math.ceil(lo / 5) * 5; t < hi; t += 5) {
        if (t > lo) candidateTrims.push(t);
      }
      if (hi !== lo) candidateTrims.push(hi);
    }
    // MATTPL12 / TNBPL10: jumbo mother width FIXED at 1705 mm (factory rule).
    // Slit patterns must fit 1705 with SS trim only. Pattern can vary; mother width does not.
    // PS01 pack UPS is variable (3–16): e.g. 10400→6×1705 (trim 170), 8700→5×1705 (trim 175).
    // All other films keep variable-width synthesis up to machine max (1730).
    const FIXED_1700_FILMS = new Set(['MATTPL12', 'TNBPL10']);
    const FIXED_JUMBO_WIDTH_MM = 1705;
    const pool: MS1JumboCandidate[] = [];
    const seen = new Map<string, MS1JumboCandidate>();

    for (const filmCode of activeFilms) {
      const filmKey = String(filmCode).trim().toUpperCase();
      const forceFixed1700 = FIXED_1700_FILMS.has(filmKey);

      for (const fam of lengthFamilies) {
        const filmFamTrackers = activeTrackers.filter(
          t => t.order.film === filmCode && fam.lengths.includes(t.pkgLength)
        );
        if (filmFamTrackers.length === 0) continue;

        let filmWidths = Array.from(new Set(filmFamTrackers.map(t => t.order.width_mm))).sort((a, b) => a - b);
        // Optional slit window: empty/unset = no size limit (all widths eligible)
        const minSlit = Number(settings.min_slit_width_mm);
        const maxSlit = Number(settings.max_slit_width_mm);
        if (Number.isFinite(minSlit) && minSlit > 0) {
          filmWidths = filmWidths.filter(w => w >= minSlit);
        }
        if (Number.isFinite(maxSlit) && maxSlit > 0) {
          filmWidths = filmWidths.filter(w => w <= maxSlit);
        }
        if (filmWidths.length === 0) continue;

        const hardMaxTrim = Number.isFinite(Number(settings.hard_max_trim_mm))
          ? Number(settings.hard_max_trim_mm)
          : (Number.isFinite(Number(settings.max_trim_mm)) ? Number(settings.max_trim_mm) : 45);
        const minTrimMm = Number.isFinite(Number(settings.min_trim_mm)) ? Number(settings.min_trim_mm) : 11;
        const minJumboMm = 355;
        const maxJumboMm = forceFixed1700 ? FIXED_JUMBO_WIDTH_MM : (settings.max_jumbo_width_mm || 1730);

        let uniqueCombos = generateSSWidthCombinations(
          filmWidths,
          maxSsUps,
          maxJumboMm,
          minTrimMm
        );
        // PS01-feasible near-max (not raw machine 1730):
        // pure-pack needs 150 ≤ motherDeckle − jumbo×ups ≤ 500.
        // Prefer 6-UPS band: jumbo ≤ floor((deckle−150)/6) e.g. 1708 on 10400.
        const ps01MinTrimFloor = 150;
        const ps01TargetUps = 6;
        const ps01FeasibleMaxJumbo = Math.min(
          maxJumboMm,
          Math.floor((motherDeckle - ps01MinTrimFloor) / ps01TargetUps)
        ); // ~1708 on 10400 — still near machine max, PS01 GREEN-capable

        if (!forceFixed1700) {
          for (const w of filmWidths) {
            // Max strips that keep derived jumbo (sum+trim) ≤ ps01FeasibleMaxJumbo
            const maxFit = Math.floor((ps01FeasibleMaxJumbo - minTrimMm) / w);
            if (maxFit < 1 || maxFit > maxSsUps) continue;
            for (const fit of [maxFit, maxFit - 1]) {
              if (fit < 1) continue;
              const sumW = fit * w;
              if (sumW + minTrimMm > maxJumboMm) continue;
              const exists = uniqueCombos.some(
                c => c.ups === fit && c.sumWidth === sumW && c.widths.every(x => x === w)
              );
              if (!exists) {
                uniqueCombos.push({
                  widths: Array(fit).fill(w),
                  ups: fit,
                  sumWidth: sumW,
                });
              }
            }
          }
        }

        for (const combo of uniqueCombos) {
          // Geometry prune
          if (forceFixed1700) {
            // Must land exactly on 1705 mm with SS trim in [minTrim, hardMax]
            if (combo.sumWidth + minTrimMm > FIXED_JUMBO_WIDTH_MM) continue;
            if (combo.sumWidth + hardMaxTrim < FIXED_JUMBO_WIDTH_MM) continue;
          } else {
            if (combo.sumWidth + minTrimMm > maxJumboMm) continue;
            if (combo.sumWidth + hardMaxTrim < minJumboMm) continue;
            // Soft mono: prefer PS01-feasible near-max; only drop deeply under-filled
            // (still keep maxFit and maxFit-1 so plans always remain possible)
            const monoWidth =
              combo.widths.length > 0 && combo.widths.every(w => w === combo.widths[0]);
            if (monoWidth && combo.widths.length >= 1) {
              const w0 = combo.widths[0];
              const bestFit = Math.floor((ps01FeasibleMaxJumbo - minTrimMm) / w0);
              // Drop only if 2+ strips short of PS01-feasible best fill
              if (bestFit >= 2 && combo.widths.length <= bestFit - 2) continue;
            }
          }

          const possibleCutLengths: number[][] = combo.widths.map(w => {
            const validLengths = fam.lengths.filter(L => slotMap.has(`${filmCode}__${w}__${L}`));
            return validLengths.length > 0 ? validLengths : [fam.packLengthM];
          });

          const maxPerShaft = Math.ceil(maxSsUps / 2);
          const lengthAssignments = buildLegalLengthAssignments(possibleCutLengths, maxPerShaft);

          // Width-aware dedupe (same key as legacy Cartesian path)
          const uniqueAssignments: number[][] = [];
          const seenAssign = new Set<string>();
          for (const assign of lengthAssignments) {
            const key = combo.widths.map((w, idx) => `${w}:${assign[idx]}`).sort().join('|');
            if (!seenAssign.has(key)) {
              seenAssign.add(key);
              uniqueAssignments.push(assign);
            }
          }

          // Fixed-1705: single derived trim = 1705 − sumWidth (must be in SS trim window)
          // Normal films: scan candidateTrims as before
          const trimsToTry: number[] = forceFixed1700
            ? (() => {
                const tr = FIXED_JUMBO_WIDTH_MM - combo.sumWidth;
                return tr >= minTrimMm && tr <= hardMaxTrim ? [tr] : [];
              })()
            : candidateTrims;

          for (const assign of uniqueAssignments) {
            for (const testTrim of trimsToTry) {
              const derivedJumbo = forceFixed1700
                ? FIXED_JUMBO_WIDTH_MM
                : combo.sumWidth + testTrim;
              if (!forceFixed1700) {
                if (derivedJumbo < minJumboMm || derivedJumbo > maxJumboMm) continue;
              }

              // All valid multiples kept for full order fulfillment.
              // Search prefers longest (max-dia) first via runSearchPass(false),
              // then allowTailMultiples for residual — do not drop shorter lengths.
              for (const vm of fam.validMultiples) {
                if (assign.some(cutL => vm.length_m % cutL !== 0)) continue;
                const cuts = new Array<number>(numDemandSlots).fill(0);
                const activeIndicesSet = new Set<number>();
                const cutsList: MS1CutDef[] = [];

                for (let ci = 0; ci < combo.widths.length; ci++) {
                  const cutW = combo.widths[ci];
                  const cutL = assign[ci];
                  const sIdx = slotMap.get(`${filmCode}__${cutW}__${cutL}`);
                  const reelsPerJumbo = Math.max(1, Math.round(vm.length_m / cutL));
                  const singleReelWeightKg = weightKg(cutW, cutL);

                  if (sIdx !== undefined) {
                    cuts[sIdx]++;
                    activeIndicesSet.add(sIdx);
                    cutsList.push({
                      slotIdx: sIdx,
                      film: filmCode,
                      width_mm: cutW,
                      length_m: cutL,
                      reelsPerJumbo,
                      singleReelWeightKg,
                    });
                  }
                }

                const activeIndices = Array.from(activeIndicesSet);
                const cutsKey = cuts.join(',');
                const key = `${filmCode}|${fam.familyId}|${derivedJumbo}|${cutsKey}|${vm.multiple}|${vm.length_m}`;
                const existing = seen.get(key);
                if (existing) {
                  if (testTrim < existing.mslTrim) {
                    existing.mslTrim = testTrim;
                    existing.combo = combo;
                    existing.cutsList = cutsList;
                  }
                  continue;
                }

                const singleWeight = weightKg(derivedJumbo, vm.length_m);
                const cand: MS1JumboCandidate = {
                  id: `cand-${filmCode}-${key}`,
                  film: filmCode,
                  familyId: fam.familyId,
                  combo,
                  jumboWidth: derivedJumbo,
                  mslTrim: testTrim,
                  packageMultiple: vm.multiple,
                  jumboLengthM: vm.length_m,
                  jumboDiameterMm: vm.diameter_mm,
                  singleJumboWeightKg: singleWeight,
                  cutsList,
                  cuts,
                  activeIndices,
                };
                seen.set(key, cand);
                pool.push(cand);
              }
            }
          }
        }
      }
    }

    return pool;
  }

  interface WinningSetResult {
    candidates: MS1JumboCandidate[];
    ps01Ups: number;
    jumboWidths: number[];
    totalWeb: number;
    ps01Trim: number;
    status: 'GREEN' | 'YELLOW';
    repeatCycles: number;
    totalPlannedKg: number;
    totalTrimKg: number;
    score: number;
  }

  const finalRequirements: SSJumboRequirement[] = [];
  let reqCounter = startReqCounter;
  let iteration = 0;
  const maxIterations = 100;

  const masterCandidatePool = generateCandidatePool(orderTrackers);
  // Phase-2: live pool shrinks as slots close — never re-scan full master each iteration
  let liveCandidates = masterCandidatePool;

  while (iteration < maxIterations) {
    iteration++;
    const activeTrackers = orderTrackers.filter(t => t.remainingKg > 0.01);
    if (activeTrackers.length === 0) break;

    // STRICT priority (PS-style): while any starred order has residual, only accept
    // candidates that cover at least one priority slot. Priority fulfillment dominates
    // even if non-priority residual is left unplanned in this phase.
    const prioritySlotSet = new Set(
      activeTrackers.filter(t => !!t.order.priority).map(t => t.slotIdx)
    );
    const strictPriorityMode = prioritySlotSet.size > 0;

    const activeSlotsSet = new Set(activeTrackers.map(t => t.slotIdx));
    liveCandidates = liveCandidates.filter(c => c.activeIndices.every(s => activeSlotsSet.has(s)));
    const candidatePool = liveCandidates;
    if (candidatePool.length === 0) break;

    let bestWinningSet: WinningSetResult | null = null;
    let bestSetScore = -Infinity;

    const runSearchPass = (allowTailMultiples: boolean, searchPool: MS1JumboCandidate[] = candidatePool) => {
      if (!searchPool.length) return;
      const allJumboLengths = Array.from(new Set(searchPool.map(c => c.jumboLengthM))).sort((a, b) => b - a);
      const maxOverallLength = allJumboLengths.length > 0 ? allJumboLengths[0] : 0;

      for (const jumboLen of allJumboLengths) {
        const isTail = maxOverallLength > 4000 && jumboLen <= 4000;
        if (isTail && !allowTailMultiples) continue;
        if (!isTail && allowTailMultiples) continue;

        const candidatesForMult = searchPool.filter(c => c.jumboLengthM === jumboLen);
        if (candidatesForMult.length === 0) continue;

        const capacity = new Array<number>(numDemandSlots).fill(0);
        const weightPerCut = new Array<number>(numDemandSlots).fill(0);

        for (const tr of activeTrackers) {
          if (tr.remainingKg <= 0.01) continue;
          const s = tr.slotIdx;
          const spareKg = tr.maxAllowedKg - tr.allocatedKg;
          const weightPerReel = weightKg(tr.order.width_mm, tr.pkgLength);
          const reelsPerCut = Math.max(1, Math.round(jumboLen / tr.pkgLength));
          const weightForCut = weightPerReel * reelsPerCut;
          const cutsAllowed = Math.floor((spareKg + 0.01) / weightForCut);
          capacity[s] += Math.max(0, cutsAllowed);
          if (weightPerCut[s] === 0) weightPerCut[s] = weightForCut;
        }

          const viableCandidates = candidatesForMult.filter(c => {
            const cCuts = c.cuts;
            for (let a = 0; a < c.activeIndices.length; a++) {
              const s = c.activeIndices[a];
              if (capacity[s] < cCuts[s]) return false;
            }
            // Strict priority: pattern must touch at least one starred order slot
            if (strictPriorityMode && !c.activeIndices.some(s => prioritySlotSet.has(s))) {
              return false;
            }
            return true;
          });
          if (viableCandidates.length === 0) continue;

          const candidatesByWidth = new Map<number, MS1JumboCandidate[]>();
          for (const c of viableCandidates) {
            let list = candidatesByWidth.get(c.jumboWidth);
            if (!list) {
              list = [];
              candidatesByWidth.set(c.jumboWidth, list);
            }
            list.push(c);
          }

          for (const [width, list] of candidatesByWidth.entries()) {
            list.sort((a, b) => {
              let yieldA = 0;
              let yieldB = 0;
              for (let ai = 0; ai < a.activeIndices.length; ai++) {
                const s = a.activeIndices[ai];
                yieldA += a.cuts[s] * weightPerCut[s];
              }
              for (let bi = 0; bi < b.activeIndices.length; bi++) {
                const s = b.activeIndices[bi];
                yieldB += b.cuts[s] * weightPerCut[s];
              }
              return (b.packageMultiple - a.packageMultiple) || (b.jumboDiameterMm - a.jumboDiameterMm) || (yieldB - yieldA) || (a.mslTrim - b.mslTrim);
            });
            if (list.length > 15) {
              candidatesByWidth.set(width, list.slice(0, 15));
            }
          }

          let widthEntriesList = Array.from(candidatesByWidth.entries());
          if (widthEntriesList.length > 96) {
            widthEntriesList.sort((a, b) => {
              let yieldA = 0;
              let yieldB = 0;
              const cA = a[1][0];
              const cB = b[1][0];
              if (cA) {
                for (let ai = 0; ai < cA.activeIndices.length; ai++) {
                  yieldA += cA.cuts[cA.activeIndices[ai]] * weightPerCut[cA.activeIndices[ai]];
                }
              }
              if (cB) {
                for (let bi = 0; bi < cB.activeIndices.length; bi++) {
                  yieldB += cB.cuts[cB.activeIndices[bi]] * weightPerCut[cB.activeIndices[bi]];
                }
              }
              return yieldB - yieldA;
            });
            const topWidthsSet = new Set(widthEntriesList.slice(0, 96).map(e => e[0]));
            for (const w of Array.from(candidatesByWidth.keys())) {
              if (!topWidthsSet.has(w)) {
                candidatesByWidth.delete(w);
              }
            }
          }

          const uniqueWidths = Array.from(candidatesByWidth.keys()).sort((a, b) => a - b);
          const numUniqueWidths = uniqueWidths.length;

          const evaluateCandidateCoverage = (cands: MS1JumboCandidate[], upsCount: number, maxCycles: number) => {
            let closedCount = 0;
            const coveredSlots = new Set<number>();
            for (const c of cands) {
              c.activeIndices.forEach(idx => coveredSlots.add(idx));
            }

            for (const s of coveredSlots) {
              let totalCuts = 0;
              for (const c of cands) {
                totalCuts += (c.cuts[s] || 0);
              }
              const plannedWeight = totalCuts * maxCycles * weightPerCut[s];
              const matchingTrackers = activeTrackers.filter(t => t.slotIdx === s);
              for (const tr of matchingTrackers) {
                if (tr.remainingKg <= plannedWeight * SS_CUSTOMER_MAX_OVERALLOCATION_FACTOR) {
                  closedCount++;
                }
              }
            }

            return { closedCount, coveredSlotsCount: coveredSlots.size };
          };

          const isCandidateSetJustified = (
            candsWithCounts: { cand: MS1JumboCandidate; count: number }[]
          ): boolean => {
            let totalRealDemandSatisfied = 0;
            let totalCycleProduction = 0;
            let anyUnallocatedOrder = false;
            let totalPriorAllocated = 0;
            let totalOriginalDemand = 0;

            const coveredSlots = new Set<number>();
            for (const { cand } of candsWithCounts) {
              cand.activeIndices.forEach(idx => coveredSlots.add(idx));
            }

            coveredSlots.forEach(s => {
              let cutsInSingleCycle = 0;
              for (const { cand, count } of candsWithCounts) {
                cutsInSingleCycle += (cand.cuts[s] || 0) * count;
              }
              const singleCycleWeightForSlot = cutsInSingleCycle * weightPerCut[s];
              totalCycleProduction += singleCycleWeightForSlot;

              const matchingTrackers = activeTrackers.filter(t => t.slotIdx === s);
              let remWeightToDistribute = singleCycleWeightForSlot;

              for (const tr of matchingTrackers) {
                totalPriorAllocated += tr.allocatedKg;
                totalOriginalDemand += tr.order.remaining_qty;

                if (tr.allocatedKg <= 0.01) {
                  anyUnallocatedOrder = true;
                }

                if (remWeightToDistribute > 0) {
                  const realRem = Math.max(0, tr.order.remaining_qty - tr.allocatedKg);
                  const realFromThis = Math.min(remWeightToDistribute, realRem);
                  totalRealDemandSatisfied += realFromThis;
                  remWeightToDistribute -= realFromThis;
                }
              }
            });

            if (anyUnallocatedOrder) return true;

            const priorFulfillmentRatio = totalOriginalDemand > 0 ? (totalPriorAllocated / totalOriginalDemand) : 0;
            const totalOverproduction = Math.max(0, totalCycleProduction - totalRealDemandSatisfied);

            if (priorFulfillmentRatio >= 0.95 && totalRealDemandSatisfied < totalOverproduction) {
              return false;
            }

            return true;
          };

          const searchPurePacks = (minTrimAllowed: number, maxTrimAllowed: number) => {
            for (const cand of viableCandidates) {
              for (let ups = 3; ups <= 16; ups++) {
                const totalWeb = cand.jumboWidth * ups;
                const trim = motherDeckle - totalWeb;
                if (trim >= minTrimAllowed && trim <= maxTrimAllowed && trim >= 150 && trim <= 500) {
                  const status: 'GREEN' | 'YELLOW' = (trim >= 150 && trim <= 280) ? 'GREEN' : 'YELLOW';
                  let maxCycles = Infinity;
                  let canForm = true;
                  let cyclePlannedKgPerRun = 0;

                  for (let a = 0; a < cand.activeIndices.length; a++) {
                    const s = cand.activeIndices[a];
                    const needed = cand.cuts[s] * ups;
                    if (needed === 0) continue;
                    const cap = capacity[s];
                    if (cap < needed) {
                      canForm = false;
                      break;
                    }
                    const cycles = Math.floor(cap / needed);
                    if (cycles < maxCycles) maxCycles = cycles;
                    cyclePlannedKgPerRun += weightPerCut[s] * needed;
                  }

                  if (canForm && maxCycles >= 1) {
                    if (!isCandidateSetJustified([{ cand, count: ups }])) {
                      continue;
                    }
                    const repeatCycles = maxCycles;
                    const cyclePlannedKg = cyclePlannedKgPerRun * repeatCycles;
                    const mslTrimKg = ((cand.mslTrim / cand.jumboWidth) * cand.singleJumboWeightKg * ups) * repeatCycles;
                    const ps01TrimKgBase = weightKg(trim, cand.jumboLengthM);
                    const totalTrimKg = mslTrimKg + (ps01TrimKgBase * repeatCycles);

                    const { closedCount, coveredSlotsCount } = evaluateCandidateCoverage([cand], ups, repeatCycles);

                    let score = status === 'GREEN' ? 1000000 : 50000;
                    score += cyclePlannedKg * 25;
                    score += (16 - ups) * 5000; // Prefer lower UPS within 6..16
                    // Prefer 6-UPS on 10400; on smaller deckles prefer the UPS that actually fits (e.g. 5×1705 on 8700)
                    if (ups === 6 && motherDeckle >= 10400) score += 45000;
                    else if (motherDeckle < 10400 && cand.jumboWidth >= 1700) {
                      const idealUps = Math.round((motherDeckle - 186) / cand.jumboWidth);
                      if (ups === idealUps) score += 45000;
                    }
                    // Prefer PS01-feasible near-max (~1708 on 10400), not impossible 1730
                    const feasMax = Math.min(settings.max_jumbo_width_mm || 1730, Math.floor((motherDeckle - 150) / 6));
                    const widthRatio = cand.jumboWidth / Math.max(1, feasMax);
                    score += Math.min(1, widthRatio) * Math.min(1, widthRatio) * 280000;
                    if (cand.jumboWidth >= feasMax - 20) score += 200000;
                    else if (cand.jumboWidth >= feasMax - 80) score += 80000;
                    score += Math.max(0, (500 - trim) * 50);
                    score += cand.packageMultiple * 50000;
                    // Maximize practical jumbo diameter towards 1000 mm physical ceiling
                    score += (Math.min(1000, cand.jumboDiameterMm) / 1000) * 120000;
                    score += repeatCycles * 3000;

                    // Edge trim: prefer GREEN; strong bias to 11mm (factory); YELLOW last
                    if (cand.mslTrim >= 11 && cand.mslTrim <= 35) {
                      score += 50000;
                      if (cand.mslTrim === 11) score += 40000;
                      else if (cand.mslTrim <= 20) score += 20000;
                      else score += Math.max(0, (35 - cand.mslTrim) * 500);
                    } else if (cand.mslTrim >= 36 && cand.mslTrim <= 45) {
                      score -= 80000;
                    }

                    // Order closure and multi-order coverage incentives
                    score += closedCount * 25000;
                    score += coveredSlotsCount * 8000;

                    // STRICT priority domination: starred order kg/closure always wins search
                    let prioKg = 0;
                    let prioClosed = 0;
                    for (let ai = 0; ai < cand.activeIndices.length; ai++) {
                      const s = cand.activeIndices[ai];
                      if (!prioritySlotSet.has(s)) continue;
                      const matching = activeTrackers.filter(tr => tr.slotIdx === s && tr.order.priority);
                      for (const tr of matching) {
                        const cutKg = (cand.cuts[s] || 0) * ups * repeatCycles * weightPerCut[s];
                        const take = Math.min(tr.remainingKg, cutKg);
                        prioKg += take;
                        if (tr.remainingKg - cutKg <= 0.01) prioClosed++;
                      }
                    }
                    score += prioKg * 500000;
                    score += prioClosed * 5000000;

                    // Multi-length absorption and stranding prevention
                    const strandedCount = activeTrackers.filter(t => cand.jumboLengthM % t.pkgLength !== 0).length;
                    score -= strandedCount * 25000;

                    // Operational penalties for small/narrow jumbos reflecting factory undesirability
                    {
                      const maxJwLocal = settings.max_jumbo_width_mm || 1730;
                      if (cand.jumboLengthM <= 2500) score -= 200000;
                      else if (cand.jumboLengthM <= 4000) score -= 80000;
                      if (cand.jumboWidth < 1000) score -= 120000;
                      else if (cand.jumboWidth < 1200) score -= 40000;
                      else if (cand.jumboWidth < maxJwLocal * 0.75) score -= 20000;
                    }

                    const wastePct = totalTrimKg > 0 ? (totalTrimKg / (cyclePlannedKg + totalTrimKg)) * 100 : 0;
                    score -= wastePct * 100;

                    if (score > bestSetScore) {
                      bestSetScore = score;
                      bestWinningSet = {
                        candidates: Array(ups).fill(cand),
                        ps01Ups: ups,
                        jumboWidths: Array(ups).fill(cand.jumboWidth),
                        totalWeb,
                        ps01Trim: trim,
                        status,
                        repeatCycles,
                        totalPlannedKg: cyclePlannedKg,
                        totalTrimKg,
                        score,
                      };
                    }
                  }
                }
              }
            }
          };

          const evaluateCombination = (
            candsWithCounts: { cand: MS1JumboCandidate; count: number; width: number }[],
            ups: number,
            totalWeb: number,
            ps01Trim: number,
            status: 'GREEN' | 'YELLOW'
          ) => {
            const numDistinctWidths = new Set(candsWithCounts.map(c => c.width)).size;
            const baseStatusScore = status === 'GREEN' ? 1000000 : 40000;
            // Factory setup penalty: 25,000 per extra distinct jumbo width beyond 1 (prefers fewer setups when fulfillment is equal/better)
            const setupPenalty = (numDistinctWidths - 1) * 25000;
            const ps01TrimKgBase = weightKg(ps01Trim, candsWithCounts[0].cand.jumboLengthM);

            let maxCycles = Infinity;
            let canForm = true;
            let cyclePlannedKgPerRun = 0;

            const allIndices = new Set<number>();
            candsWithCounts.forEach(c => c.cand.activeIndices.forEach(idx => allIndices.add(idx)));

            for (const s of allIndices) {
              let needed = 0;
              for (const c of candsWithCounts) {
                needed += (c.cand.cuts[s] || 0) * c.count;
              }
              if (needed === 0) continue;
              const cap = capacity[s];
              if (cap < needed) {
                canForm = false;
                break;
              }
              const cycles = Math.floor(cap / needed);
              if (cycles < maxCycles) maxCycles = cycles;
              cyclePlannedKgPerRun += weightPerCut[s] * needed;
            }

            if (!canForm || maxCycles < 1) return;

            if (!isCandidateSetJustified(candsWithCounts.map(c => ({ cand: c.cand, count: c.count })))) {
              return;
            }

            const repeatCycles = maxCycles;
            const cyclePlannedKg = cyclePlannedKgPerRun * repeatCycles;
            let mslTrimKg = 0;
            for (const c of candsWithCounts) {
              mslTrimKg += ((c.cand.mslTrim / c.cand.jumboWidth) * c.cand.singleJumboWeightKg * c.count);
            }
            mslTrimKg *= repeatCycles;
            const totalTrimKg = mslTrimKg + (ps01TrimKgBase * repeatCycles);

            const avgWidth = totalWeb / ups;
            const candsOnly = candsWithCounts.map(c => c.cand);
            const { closedCount, coveredSlotsCount } = evaluateCandidateCoverage(candsOnly, ups, repeatCycles);

            let score = baseStatusScore;
            score += cyclePlannedKg * 25;
            score += (16 - ups) * 5000; // Prefer minimum UPS positions (6 > 7 > ... > 16)
            // Prefer 6-UPS on 10400; on smaller deckles prefer the UPS that actually fits (e.g. 5×1705 on 8700)
            {
              const primaryCand = candsWithCounts[0]?.cand;
              if (ups === 6 && motherDeckle >= 10400) score += 45000;
              else if (primaryCand && motherDeckle < 10400 && primaryCand.jumboWidth >= 1700) {
                const idealUps = Math.round((motherDeckle - 186) / primaryCand.jumboWidth);
                if (ups === idealUps) score += 45000;
              }
            }
            {
              const feasMax = Math.min(settings.max_jumbo_width_mm || 1730, Math.floor((motherDeckle - 150) / 6));
              const widthRatio = avgWidth / Math.max(1, feasMax);
              score += Math.min(1, widthRatio) * Math.min(1, widthRatio) * 280000;
              if (avgWidth >= feasMax - 20) score += 200000;
              else if (avgWidth >= feasMax - 80) score += 80000;
            }
            score += Math.max(0, (500 - ps01Trim) * 50);
            score += candsWithCounts[0].cand.packageMultiple * 50000;
            // Maximize practical jumbo diameter towards 1000 mm physical ceiling
            score += (Math.min(1000, candsWithCounts[0].cand.jumboDiameterMm) / 1000) * 120000;
            score += repeatCycles * 2000;

            // Edge trim: prefer GREEN; strong bias to 11mm; YELLOW last
            const allTrimsGreen = candsWithCounts.every(c => c.cand.mslTrim >= 11 && c.cand.mslTrim <= 35);
            const anyTrimYellow = candsWithCounts.some(c => c.cand.mslTrim >= 36 && c.cand.mslTrim <= 45);
            if (allTrimsGreen) {
              score += 50000;
              const avgTrim = candsWithCounts.reduce((s, c) => s + c.cand.mslTrim, 0) / candsWithCounts.length;
              if (avgTrim <= 11.5) score += 40000;
              else if (avgTrim <= 20) score += 20000;
              else score += Math.max(0, (35 - avgTrim) * 500);
            } else if (anyTrimYellow) {
              score -= 80000;
            }

            // Order closure and multi-order coverage incentives
            score += closedCount * 25000;
            score += coveredSlotsCount * 8000;

            // STRICT priority domination (mixed packs)
            let prioKgM = 0;
            let prioClosedM = 0;
            for (const { cand: cM, count: cntM } of candsWithCounts) {
              for (let ai = 0; ai < cM.activeIndices.length; ai++) {
                const s = cM.activeIndices[ai];
                if (!prioritySlotSet.has(s)) continue;
                const matching = activeTrackers.filter(tr => tr.slotIdx === s && tr.order.priority);
                for (const tr of matching) {
                  const cutKg = (cM.cuts[s] || 0) * cntM * repeatCycles * weightPerCut[s];
                  prioKgM += Math.min(tr.remainingKg, cutKg);
                  if (tr.remainingKg - cutKg <= 0.01) prioClosedM++;
                }
              }
            }
            score += prioKgM * 500000;
            score += prioClosedM * 5000000;

            // Multi-length absorption and stranding prevention
            const strandedCount = activeTrackers.filter(t => candsWithCounts[0].cand.jumboLengthM % t.pkgLength !== 0).length;
            score -= strandedCount * 25000;

            // Operational penalties for small/narrow jumbos reflecting factory undesirability
            {
              const maxJw = settings.max_jumbo_width_mm || 1730;
              if (candsWithCounts[0].cand.jumboLengthM <= 2500) score -= 200000;
              else if (candsWithCounts[0].cand.jumboLengthM <= 4000) score -= 80000;
              if (candsWithCounts.some(c => c.cand.jumboWidth < 1000)) score -= 120000;
              else if (candsWithCounts.some(c => c.cand.jumboWidth < 1200)) score -= 40000;
              else if (candsWithCounts.some(c => c.cand.jumboWidth < maxJw * 0.75)) score -= 20000;
            }

            const wastePct = totalTrimKg > 0 ? (totalTrimKg / (cyclePlannedKg + totalTrimKg)) * 100 : 0;
            score -= wastePct * 100;
            score -= setupPenalty;

            if (score > bestSetScore) {
              bestSetScore = score;
              const comboCands: MS1JumboCandidate[] = [];
              const comboWidths: number[] = [];
              for (const c of candsWithCounts) {
                for (let x = 0; x < c.count; x++) {
                  comboCands.push(c.cand);
                  comboWidths.push(c.width);
                }
              }

              bestWinningSet = {
                candidates: comboCands,
                ps01Ups: ups,
                jumboWidths: comboWidths,
                totalWeb,
                ps01Trim,
                status,
                repeatCycles,
                totalPlannedKg: cyclePlannedKg,
                totalTrimKg,
                score,
              };
            }
          };

          const searchMixedCombinations = (minTrimAllowed: number, maxTrimAllowed: number) => {
            if (numUniqueWidths < 2) return;

            // 1. Search 2-width combinations (count1 of w1 + count2 of w2 = total UPS 6..16)
            for (let i = 0; i < numUniqueWidths; i++) {
              const w1 = uniqueWidths[i];
              const list1 = candidatesByWidth.get(w1)!;

              for (let j = i + 1; j < numUniqueWidths; j++) {
                const w2 = uniqueWidths[j];
                const list2 = candidatesByWidth.get(w2)!;

                for (let ups = 6; ups <= 16; ups++) {
                  for (let c1 = 1; c1 < ups; c1++) {
                    const c2 = ups - c1;
                    const totalWeb = c1 * w1 + c2 * w2;
                    const ps01Trim = motherDeckle - totalWeb;
                    if (ps01Trim < minTrimAllowed || ps01Trim > maxTrimAllowed || ps01Trim < 150 || ps01Trim > 500) continue;

                    const status: 'GREEN' | 'YELLOW' = (ps01Trim >= 150 && ps01Trim <= 280) ? 'GREEN' : 'YELLOW';

                    for (let idx1 = 0; idx1 < Math.min(6, list1.length); idx1++) {
                      const cand1 = list1[idx1];
                      for (let idx2 = 0; idx2 < Math.min(6, list2.length); idx2++) {
                        const cand2 = list2[idx2];
                        evaluateCombination([
                          { cand: cand1, count: c1, width: w1 },
                          { cand: cand2, count: c2, width: w2 }
                        ], ups, totalWeb, ps01Trim, status);
                      }
                    }
                  }
                }
              }
            }

            // 2. Search 3-width combinations (count1 of w1 + count2 of w2 + count3 of w3 = total UPS 6..10)
            if (numUniqueWidths >= 3) {
              const max3Widths = Math.min(24, numUniqueWidths);
              for (let i = 0; i < max3Widths; i++) {
                const w1 = uniqueWidths[i];
                const list1 = candidatesByWidth.get(w1)!;

                for (let j = i + 1; j < max3Widths; j++) {
                  const w2 = uniqueWidths[j];
                  const list2 = candidatesByWidth.get(w2)!;

                  for (let k = j + 1; k < max3Widths; k++) {
                    const w3 = uniqueWidths[k];
                    const list3 = candidatesByWidth.get(w3)!;

                    for (let ups = 6; ups <= 10; ups++) {
                      for (let c1 = 1; c1 <= ups - 2; c1++) {
                        for (let c2 = 1; c2 <= ups - c1 - 1; c2++) {
                          const c3 = ups - c1 - c2;
                          const totalWeb = c1 * w1 + c2 * w2 + c3 * w3;
                          const ps01Trim = motherDeckle - totalWeb;
                          if (ps01Trim < minTrimAllowed || ps01Trim > maxTrimAllowed || ps01Trim < 150 || ps01Trim > 500) continue;

                          const status: 'GREEN' | 'YELLOW' = (ps01Trim >= 150 && ps01Trim <= 280) ? 'GREEN' : 'YELLOW';

                          const cand1 = list1[0];
                          const cand2 = list2[0];
                          const cand3 = list3[0];
                          if (cand1 && cand2 && cand3) {
                            evaluateCombination([
                              { cand: cand1, count: c1, width: w1 },
                              { cand: cand2, count: c2, width: w2 },
                              { cand: cand3, count: c3, width: w3 }
                            ], ups, totalWeb, ps01Trim, status);
                          }
                        }
                      }
                    }
                  }
                }
              }
            }

            // 3. Search 4-width combinations (count1 of w1 + count2 of w2 + count3 of w3 + count4 of w4 = total UPS 6..8)
            if (numUniqueWidths >= 4) {
              const max4Widths = Math.min(16, numUniqueWidths);
              for (let i = 0; i < max4Widths; i++) {
                const w1 = uniqueWidths[i];
                const list1 = candidatesByWidth.get(w1)!;

                for (let j = i + 1; j < max4Widths; j++) {
                  const w2 = uniqueWidths[j];
                  const list2 = candidatesByWidth.get(w2)!;

                  for (let k = j + 1; k < max4Widths; k++) {
                    const w3 = uniqueWidths[k];
                    const list3 = candidatesByWidth.get(w3)!;

                    for (let m = k + 1; m < max4Widths; m++) {
                      const w4 = uniqueWidths[m];
                      const list4 = candidatesByWidth.get(w4)!;

                      for (let ups = 6; ups <= 8; ups++) {
                        for (let c1 = 1; c1 <= ups - 3; c1++) {
                          for (let c2 = 1; c2 <= ups - c1 - 2; c2++) {
                            for (let c3 = 1; c3 <= ups - c1 - c2 - 1; c3++) {
                              const c4 = ups - c1 - c2 - c3;
                              const totalWeb = c1 * w1 + c2 * w2 + c3 * w3 + c4 * w4;
                              const ps01Trim = motherDeckle - totalWeb;
                              if (ps01Trim < minTrimAllowed || ps01Trim > maxTrimAllowed || ps01Trim < 150 || ps01Trim > 500) continue;

                              const status: 'GREEN' | 'YELLOW' = (ps01Trim >= 150 && ps01Trim <= 280) ? 'GREEN' : 'YELLOW';

                              const cand1 = list1[0];
                              const cand2 = list2[0];
                              const cand3 = list3[0];
                              const cand4 = list4[0];
                              if (cand1 && cand2 && cand3 && cand4) {
                                evaluateCombination([
                                  { cand: cand1, count: c1, width: w1 },
                                  { cand: cand2, count: c2, width: w2 },
                                  { cand: cand3, count: c3, width: w3 },
                                  { cand: cand4, count: c4, width: w4 }
                                ], ups, totalWeb, ps01Trim, status);
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          };

          searchPurePacks(150, 280);
          searchMixedCombinations(150, 280);

          if (!bestWinningSet || bestWinningSet.status !== 'GREEN') {
            searchPurePacks(281, 500);
            searchMixedCombinations(281, 500);
          }
        }
    };

    // Best possible first = PS01-feasible near-max band (6-UPS on mother deckle),
    // then wider GREEN, YELLOW, full pool so plans always form when demand exists.
    const ps01FeasMax = Math.min(
      settings.max_jumbo_width_mm || 1730,
      Math.floor((motherDeckle - 150) / 6)
    ); // ~1708 on 10400
    const ps01FeasMin = Math.ceil((motherDeckle - 500) / 6); // ~1650 on 10400
    const nearMaxPool = candidatePool.filter(
      c => c.jumboWidth >= ps01FeasMin && c.jumboWidth <= ps01FeasMax + 5
    );
    const _ssTrimMin = Number.isFinite(Number(settings.min_trim_mm)) ? Number(settings.min_trim_mm) : 11;
    const _ssGreenMax = Number.isFinite(Number(settings.max_trim_mm)) ? Number(settings.max_trim_mm) : 35;
    const _ssHardMax = Number.isFinite(Number(settings.hard_max_trim_mm))
      ? Number(settings.hard_max_trim_mm)
      : Math.max(_ssGreenMax, 45);
    const nearMaxGreen = nearMaxPool.filter(c => c.mslTrim >= _ssTrimMin && c.mslTrim <= _ssGreenMax);
    const greenSidePool = candidatePool.filter(c => c.mslTrim >= _ssTrimMin && c.mslTrim <= _ssGreenMax);
    const yellowSidePool = candidatePool.filter(c => c.mslTrim > _ssGreenMax && c.mslTrim <= _ssHardMax);

    if (nearMaxGreen.length) {
      runSearchPass(false, nearMaxGreen);
      if (!bestWinningSet) runSearchPass(true, nearMaxGreen);
    }
    if (!bestWinningSet && nearMaxPool.length) {
      runSearchPass(false, nearMaxPool);
      if (!bestWinningSet) runSearchPass(true, nearMaxPool);
    }
    // Also try 7-UPS PS01 band (smaller jumbos that still pack well)
    if (!bestWinningSet) {
      const band7Max = Math.floor((motherDeckle - 150) / 7);
      const band7Min = Math.ceil((motherDeckle - 500) / 7);
      const band7 = candidatePool.filter(
        c => c.jumboWidth >= band7Min && c.jumboWidth <= band7Max + 5 && c.mslTrim >= _ssTrimMin && c.mslTrim <= _ssGreenMax
      );
      if (band7.length) {
        runSearchPass(false, band7);
        if (!bestWinningSet) runSearchPass(true, band7);
      }
    }
    if (!bestWinningSet) {
      runSearchPass(false, greenSidePool.length ? greenSidePool : candidatePool);
    }
    if (!bestWinningSet) {
      runSearchPass(true, greenSidePool.length ? greenSidePool : candidatePool);
    }
    if (!bestWinningSet && yellowSidePool.length) {
      runSearchPass(false, yellowSidePool);
    }
    if (!bestWinningSet && yellowSidePool.length) {
      runSearchPass(true, yellowSidePool);
    }
    if (!bestWinningSet) {
      runSearchPass(false, candidatePool);
    }
    if (!bestWinningSet) {
      runSearchPass(true, candidatePool);
    }

    if (!bestWinningSet) break;

    const winning = bestWinningSet;
    const distinctCandidates = Array.from(new Set(winning.candidates));
    let totalAllocatedInIter = 0;

    for (const cand of distinctCandidates) {
      const occurrencesInSet = winning.candidates.filter(c => c.id === cand.id).length;
      const totalRollsForCand = occurrencesInSet * winning.repeatCycles;
      const jumboLen = cand.jumboLengthM;

      const ordersCoveredMap = new Map<string, {
        order_id: string;
        sales_order: string;
        item_number: number;
        customer: string;
        width_mm: number;
        length_m: number;
        required_reels: number;
        weight_kg: number;
      }>();

      const filmKeyCand = String(cand.film || '').trim().toUpperCase();
      const isFixed1700Film =
        (filmKeyCand === 'MATTPL12' || filmKeyCand === 'TNBPL10') && cand.jumboWidth === 1705;

      let effectiveRolls = 0;

      if (isFixed1700Film) {
        // ═══════════════════════════════════════════════════════════════════
        // PS-STYLE pack/roll simulation for fixed 1705 mm (MATTPL12 / TNBPL10)
        // ───────────────────────────────────────────────────────────────────
        // Same rules as Primary Slitter (deckleOptimizer):
        //  • Run pack-by-pack (one jumbo roll = N packs of package length)
        //  • Each position has a current order; add reel weight only if
        //    allocatedKg + reel <= maxAllowedKg (demand × 1.10)
        //  • When a position cannot take another reel → try size-change to
        //    nearest remaining order that keeps trim in GREEN/YELLOW
        //  • If any position cannot be filled → STOP (no bulk over-allocation)
        //  • orders_covered / required_rolls_count reflect ONLY what was run
        // ═══════════════════════════════════════════════════════════════════
        const FIXED_W = 1705;
        const greenMin = 11;
        const greenMax = 35;
        const hardMax = settings.hard_max_trim_mm || 45;
        const positionWidths = cand.combo.widths.slice();
        const reelsPerJumbo = Math.max(
          1,
          Math.round(jumboLen / Math.max(1, cand.packageMultiple > 0
            ? jumboLen / cand.packageMultiple
            : (orderTrackers[0]?.pkgLength || 3600)))
        );
        // Prefer true package length from pattern
        const pkgLenGuess =
          orderTrackers.find(t => positionWidths.includes(t.order.width_mm))?.pkgLength || 3600;
        const packsPerJumbo = Math.max(1, Math.round(jumboLen / pkgLenGuess));

        // Seed each position with best same-width tracker
        type PosState = { width: number; tracker: OrderTracker | null };
        const positions: PosState[] = positionWidths.map(w => {
          const tr =
            orderTrackers
              .filter(
                t =>
                  t.order.film === cand.film &&
                  t.order.width_mm === w &&
                  t.allocatedKg < t.maxAllowedKg - 0.05
              )
              .sort(
                (a, b) =>
                  (b.order.priority ? 1 : 0) - (a.order.priority ? 1 : 0) ||
                  b.remainingKg - a.remainingKg
              )[0] || null;
          return { width: w, tracker: tr };
        });

        const findReplacement = (
          posIdx: number,
          currentWidths: number[]
        ): { tracker: OrderTracker; width: number } | null => {
          const sumOthers = currentWidths.reduce((s, w, i) => s + (i === posIdx ? 0 : w), 0);
          let best: { tracker: OrderTracker; width: number; score: number } | null = null;
          for (const tr of orderTrackers) {
            if (tr.order.film !== cand.film) continue;
            if (tr.allocatedKg >= tr.maxAllowedKg - 0.05) continue;
            const nw = tr.order.width_mm;
            const trim = FIXED_W - (sumOthers + nw);
            if (trim < greenMin || trim > hardMax) continue;
            const wpr = weightKg(nw, tr.pkgLength);
            const need = wpr * packsPerJumbo; // one full jumbo worth for canFit check on roll boundary
            // At least one pack must fit
            if (tr.allocatedKg + wpr > tr.maxAllowedKg + 0.05) continue;
            let score = 0;
            if (trim >= greenMin && trim <= greenMax) score += 100000;
            else score += 5000;
            score -= Math.abs(nw - currentWidths[posIdx]) * 80;
            if (tr.order.priority) score += 8000;
            score += Math.min(tr.maxAllowedKg - tr.allocatedKg, 800);
            if (!best || score > best.score) best = { tracker: tr, width: nw, score };
          }
          return best ? { tracker: best.tracker, width: best.width } : null;
        };

        const maxRolls = Math.max(totalRollsForCand, 1) + 50; // safety ceiling
        let rollsRun = 0;

        for (let roll = 0; roll < maxRolls; roll++) {
          // Ensure every position has a tracker that can take at least one pack
          let canRunThisRoll = true;
          const widthsNow = positions.map(p => p.width);

          for (let pi = 0; pi < positions.length; pi++) {
            const pos = positions[pi];
            const wpr = pos.tracker
              ? weightKg(pos.width, pos.tracker.pkgLength)
              : 0;
            const canContinue =
              pos.tracker &&
              pos.tracker.allocatedKg + wpr <= pos.tracker.maxAllowedKg + 0.05;

            if (!canContinue) {
              const rep = findReplacement(pi, widthsNow);
              if (!rep) {
                canRunThisRoll = false;
                break;
              }
              positions[pi] = { width: rep.width, tracker: rep.tracker };
              widthsNow[pi] = rep.width;
            }
          }

          if (!canRunThisRoll) break;

          // Run packsPerJumbo packs on this jumbo (or fewer if order hits ceiling mid-jumbo)
          let packsRunThisJumbo = 0;
          for (let p = 0; p < packsPerJumbo; p++) {
            // Pre-check / replace before pack
            let packOk = true;
            const widthsPack = positions.map(x => x.width);
            for (let pi = 0; pi < positions.length; pi++) {
              const pos = positions[pi];
              const wpr = pos.tracker
                ? weightKg(pos.width, pos.tracker.pkgLength)
                : Infinity;
              if (!pos.tracker || pos.tracker.allocatedKg + wpr > pos.tracker.maxAllowedKg + 0.05) {
                const rep = findReplacement(pi, widthsPack);
                if (!rep) {
                  packOk = false;
                  break;
                }
                positions[pi] = { width: rep.width, tracker: rep.tracker };
                widthsPack[pi] = rep.width;
              }
            }
            if (!packOk) break;

            // Commit one pack to every position
            for (let pi = 0; pi < positions.length; pi++) {
              const pos = positions[pi];
              const tr = pos.tracker!;
              const wpr = weightKg(pos.width, tr.pkgLength);
              tr.allocatedKg = Number((tr.allocatedKg + wpr).toFixed(2));
              tr.remainingKg = Math.max(
                0,
                Number((tr.order.remaining_qty - tr.allocatedKg).toFixed(2))
              );
              tr.allocatedReels += 1;
              tr.status =
                tr.allocatedKg >= tr.maxAllowedKg - 0.05 || tr.remainingKg <= 0.01
                  ? 'COMPLETED'
                  : 'PARTIALLY_FULFILLED';
              totalAllocatedInIter += wpr;

              const existingCov = ordersCoveredMap.get(tr.order.id);
              if (existingCov) {
                existingCov.required_reels += 1;
                existingCov.weight_kg = Number((existingCov.weight_kg + wpr).toFixed(2));
                // width may have changed via size-change — keep dominant width
              } else {
                ordersCoveredMap.set(tr.order.id, {
                  order_id: tr.order.id,
                  sales_order: tr.order.sales_order,
                  item_number: tr.order.item_number,
                  customer: tr.order.customer,
                  width_mm: pos.width,
                  length_m: tr.pkgLength,
                  required_reels: 1,
                  weight_kg: Number(wpr.toFixed(2)),
                });
              }
            }
            packsRunThisJumbo++;
          }

          if (packsRunThisJumbo <= 0) break;
          rollsRun++;
        }

        effectiveRolls = Math.max(1, rollsRun);
        // Pattern widths: use final position widths (after size-changes) if stable,
        // else original combo — sheet uses finished_widths_covered from combo
      } else {
        // ── Legacy bulk path for non-fixed-1705 films (unchanged) ─────────
        const slotCutsNeeded = new Map<number, number>();
        for (const cut of cand.cutsList) {
          slotCutsNeeded.set(cut.slotIdx, (slotCutsNeeded.get(cut.slotIdx) || 0) + 1);
        }

        for (const [slotIdx, cutsPerJumbo] of slotCutsNeeded.entries()) {
          const slotDef = demandSlots[slotIdx];
          if (!slotDef) continue;
          let totalKnifeRunsToDistribute = cutsPerJumbo * totalRollsForCand;
          const matching = orderTrackers
            .filter(t => t.slotIdx === slotIdx && t.remainingKg > 0.01)
            .sort((a, b) => (b.order.priority ? 1 : 0) - (a.order.priority ? 1 : 0) || b.remainingKg - a.remainingKg);

          for (const tr of matching) {
            if (totalKnifeRunsToDistribute <= 0) break;
            const spareKg = tr.maxAllowedKg - tr.allocatedKg;
            const weightPerReel = weightKg(slotDef.width_mm, tr.pkgLength);
            const reelsPerJumboRun = Math.max(1, Math.round(jumboLen / tr.pkgLength));
            const maxJumboRunsAllowed = Math.floor((spareKg + 0.01) / (weightPerReel * reelsPerJumboRun));

            if (maxJumboRunsAllowed >= 1) {
              const runsForThis = Math.min(totalKnifeRunsToDistribute, maxJumboRunsAllowed);
              const reelsForThis = runsForThis * reelsPerJumboRun;
              const weightForThis = Number((reelsForThis * weightPerReel).toFixed(2));

              tr.allocatedKg = Number((tr.allocatedKg + weightForThis).toFixed(2));
              tr.remainingKg = Math.max(0, Number((tr.order.remaining_qty - tr.allocatedKg).toFixed(2)));
              tr.allocatedReels += reelsForThis;
              tr.status = tr.remainingKg <= 0.01 ? 'COMPLETED' : 'PARTIALLY_FULFILLED';
              totalKnifeRunsToDistribute -= runsForThis;
              totalAllocatedInIter += weightForThis;

              const existingCov = ordersCoveredMap.get(tr.order.id);
              if (existingCov) {
                existingCov.required_reels += reelsForThis;
                existingCov.weight_kg = Number((existingCov.weight_kg + weightForThis).toFixed(2));
              } else {
                ordersCoveredMap.set(tr.order.id, {
                  order_id: tr.order.id,
                  sales_order: tr.order.sales_order,
                  item_number: tr.order.item_number,
                  customer: tr.order.customer,
                  width_mm: tr.order.width_mm,
                  length_m: tr.pkgLength,
                  required_reels: reelsForThis,
                  weight_kg: weightForThis,
                });
              }
            }
          }
        }

        effectiveRolls = totalRollsForCand;
      }

      const totalWeightKg = Number((cand.singleJumboWeightKg * effectiveRolls).toFixed(2));
      const actualTrim = cand.mslTrim;
      const uniqueInDeckle = new Set(winning.jumboWidths).size;
      const deckleTypeDesc = uniqueInDeckle === 1 ? 'Uniform' : uniqueInDeckle === 2 ? '2-Width Mixed' : uniqueInDeckle === 3 ? '3-Width Mixed' : '4-Width Mixed';

      finalRequirements.push({
        id: `req-ss-${reqCounter++}`,
        film: cand.film || groupLabel,
        thickness_micron: thickness,
        required_jumbo_width_mm: cand.jumboWidth,
        required_jumbo_length_m: cand.jumboLengthM,
        calculated_diameter_mm: cand.jumboDiameterMm,
        core: settings.core,
        required_rolls_count: effectiveRolls,
        ups: cand.combo.ups,
        finished_widths_covered: cand.combo.widths,
        expected_trim_mm: actualTrim,
        trim_width_mm: actualTrim,
        orders_covered: Array.from(ordersCoveredMap.values()),
        package_multiple: cand.packageMultiple,
        total_weight_kg: totalWeightKg,
        efficiency_percent: Number(((cand.combo.sumWidth / cand.jumboWidth) * 100).toFixed(1)),
        planning_mode: filmsInGroup.length > 1 ? 'COMBINED' : 'SINGLE',
        compatible_group_key: groupLabel,
        // Surgical (MATTPL12 / TNBPL10 only): force single logical Mother Run so UI
        // collapses all SS slit patterns under one Upstream Mother Roll card (PS-style).
        // All other films keep per-iteration run index.
        ps01_run_index: isFixed1700Film ? 1 : iteration,
        ps01_parent_deckle_id: isFixed1700Film
          ? `ps01-run-ss-fixed-1705-${filmKeyCand}`
          : `ps01-run-ss-${iteration}`,
        msl_pattern_summary: {
          total_cuts: cand.combo.ups,
          cuts: Array.from(ordersCoveredMap.values()).map(cov => ({
            order_id: cov.order_id,
            sales_order: cov.sales_order,
            film: cand.film || groupLabel,
            width_mm: cov.width_mm,
            length_m: cov.length_m,
            allocated_weight_kg: cov.weight_kg,
          })),
        },
        ps01_feasibility: {
          status: winning.status,
          is_feasible: true,
          ps01_deckle_mm: motherDeckle,
          jumbo_width_mm: cand.jumboWidth,
          ps01_ups: winning.ps01Ups,
          ps01_cut_combination: winning.jumboWidths,
          ps01_total_width_mm: winning.totalWeb,
          ps01_trim_mm: winning.ps01Trim,
          ps01_deckle_efficiency_percent: Number(((winning.totalWeb / motherDeckle) * 100).toFixed(2)),
          ps01_duplex_balanced: true,
          side_a_ups: Math.ceil(winning.ps01Ups / 2),
          side_b_ups: Math.floor(winning.ps01Ups / 2),
          relaxation_type: winning.status === 'GREEN' ? 'NONE' : 'PS01_TRIM_RELAXED',
          relaxation_flag: winning.status === 'YELLOW' ? `NON-STANDARD PS01 TRIM: Upstream trim relaxed to ${winning.ps01Trim} mm for ${deckleTypeDesc} pattern` : undefined,
          explanation: `${winning.ps01Ups}-UPS ${deckleTypeDesc} jumbo manufacturing pattern on PS01 ([${winning.jumboWidths.join(', ')}] mm = ${winning.totalWeb} mm, PS01 Trim: ${winning.ps01Trim}mm)`,
        },
        is_mutually_feasible: true,
        relaxation_flag: winning.status === 'YELLOW' ? `NON-STANDARD PS01 TRIM: Upstream trim relaxed to ${winning.ps01Trim} mm` : undefined,
        notes: `${deckleTypeDesc} [${winning.jumboWidths.join(', ')}] mm deckle on PS01 (Trim: ${winning.ps01Trim}mm)`,
        created_at: new Date().toISOString(),
      });
    }

    if (totalAllocatedInIter <= 0) break;
  }

  const totalRolls = finalRequirements.reduce((sum, r) => sum + r.required_rolls_count, 0);
  const uniqueJumboWidths = Array.from(new Set(finalRequirements.map(r => r.required_jumbo_width_mm)));
  const totalPlannedKg = finalRequirements.reduce((sum, r) => sum + r.total_weight_kg, 0);
  const totalTrimKg = finalRequirements.reduce((sum, r) => {
    const trimFraction = (r.expected_trim_mm || 0) / r.required_jumbo_width_mm;
    return sum + (r.total_weight_kg * trimFraction);
  }, 0);
  const avgWaste = totalPlannedKg > 0 ? (totalTrimKg / totalPlannedKg) * 100 : 0;
  const greenCount = finalRequirements.filter(r => r.ps01_feasibility?.status === 'GREEN').length;
  const yellowCount = finalRequirements.filter(r => r.ps01_feasibility?.status === 'YELLOW').length;
  const redCount = finalRequirements.filter(r => r.ps01_feasibility?.status === 'RED').length;
  const totalDemandKg = groupOrders.reduce((sum, o) => sum + o.remaining_qty, 0);
  const orderFulfillment = totalDemandKg > 0 ? Math.min(100, (totalPlannedKg / totalDemandKg) * 100) : 0;
  const maxJumboLen = Math.max(...finalRequirements.map(r => r.required_jumbo_length_m), 0);

  let totalScore = 0;
  totalScore += orderFulfillment * 2000;
  totalScore -= redCount * 10000000;
  totalScore += greenCount * 15000;
  totalScore += yellowCount * 5000;
  totalScore -= totalRolls * 500;
  totalScore -= uniqueJumboWidths.length * 300;
  totalScore -= avgWaste * 50;

  return {
    requirements: finalRequirements,
    score: totalScore,
    evaluation: {
      strategy: filmsInGroup.length > 1 ? 'COMBINED' : 'SEPARATE',
      film_group: groupLabel,
      films_included: filmsInGroup,
      requirements: finalRequirements,
      total_rolls: totalRolls,
      unique_jumbo_widths: uniqueJumboWidths,
      total_planned_kg: totalPlannedKg,
      total_trim_kg: totalTrimKg,
      average_waste_percent: avgWaste,
      ps01_3ups_count: 0,
      ps01_4ups_count: 0,
      max_jumbo_length_m: maxJumboLen,
      is_fully_feasible: finalRequirements.every(r => r.ps01_feasibility?.is_feasible && r.ps01_feasibility.status !== 'RED'),
      score: totalScore,
      reason: `${finalRequirements.length} plan(s), ${totalRolls} roll(s), all PS01 patterns feasible (6–16 UPS)`,
    },
  };
}

export function generateSSJumboRollRequirements(
  orders: VA05Order[],
  settings: SSMachineSettings,
  selectedFilm?: string,
  options?: {
    compatibilityRules?: FilmCompatibilityRule[];
    forceStrategy?: 'AUTO' | 'COMBINED' | 'SEPARATE';
    onProgress?: (progressPercent: number, stageDescription: string) => void;
  }
): SSJumboRequirement[] {
  const rules = options?.compatibilityRules || DEFAULT_FILM_COMPATIBILITY_RULES;
  const forceStrategy = options?.forceStrategy || 'AUTO';
  const onProgress = options?.onProgress;

  onProgress?.(10, 'Filtering secondary slitter orders & analyzing film compatibility...');

  let pending = orders.filter(o => isSSOrder(o) && o.remaining_qty > 0.01);
  if (pending.length === 0) {
    onProgress?.(100, 'No pending secondary slitter orders found');
    return [];
  }

  let targetFilms: string[] = [];
  if (selectedFilm && selectedFilm !== 'ALL') {
    targetFilms = getCompatibleFilmsFor(selectedFilm, rules);
    pending = pending.filter(o => targetFilms.includes(o.film));
  }
  if (pending.length === 0) {
    onProgress?.(100, 'No matching pending orders for target film');
    return [];
  }

  const allFilmsInPending = Array.from(new Set(pending.map(o => o.film)));
  const compatibleGroups = getAllCompatibleGroups(allFilmsInPending, rules);

  const finalRequirements: SSJumboRequirement[] = [];
  let globalReqCounter = 1;

  const totalGroups = compatibleGroups.length;
  for (let gIdx = 0; gIdx < totalGroups; gIdx++) {
    const group = compatibleGroups[gIdx];
    const baseProgress = 20 + Math.floor((gIdx / totalGroups) * 70);
    onProgress?.(baseProgress, `Synthesizing ${group.group_name} patterns & evaluating PS01 deckles...`);

    const groupOrders = pending.filter(o => group.films.includes(o.film));
    if (groupOrders.length === 0) continue;

    if (group.films.length <= 1 || !group.is_combined_eligible || forceStrategy === 'SEPARATE') {
      const result = optimizeDemandPool(groupOrders, settings, group.group_name, globalReqCounter);
      finalRequirements.push(...result.requirements);
      globalReqCounter += result.requirements.length;
      continue;
    }

    let optionATotalScore = 0;
    const optionAReqs: SSJumboRequirement[] = [];
    let optionAReqCount = globalReqCounter;

    for (const singleFilm of group.films) {
      const singleFilmOrders = groupOrders.filter(o => o.film === singleFilm);
      if (singleFilmOrders.length === 0) continue;
      const singleRes = optimizeDemandPool(singleFilmOrders, settings, singleFilm, optionAReqCount);
      optionAReqs.push(...singleRes.requirements);
      optionATotalScore += singleRes.score;
      optionAReqCount += singleRes.requirements.length;
    }

    const optionBRes = optimizeDemandPool(groupOrders, settings, group.group_name, globalReqCounter);
    const optionBTotalScore = optionBRes.score;
    const optionBReqs = optionBRes.requirements;

    let selectCombined = false;
    if (forceStrategy === 'COMBINED') {
      selectCombined = true;
    } else {
      const optAFulfilledKg = optionAReqs.reduce((sum, r) => sum + r.total_weight_kg, 0);
      const optBFulfilledKg = optionBReqs.reduce((sum, r) => sum + r.total_weight_kg, 0);

      if (group.preference === 'PREFER_COMBINED' && optionBRes.evaluation.is_fully_feasible && optionBReqs.length > 0) {
        if (optBFulfilledKg >= optAFulfilledKg * 0.95 || optionBTotalScore >= optionATotalScore) {
          selectCombined = true;
        }
      } else if (optionBTotalScore > optionATotalScore) {
        selectCombined = true;
      }
    }

    if (selectCombined && optionBReqs.length > 0) {
      finalRequirements.push(...optionBReqs);
      globalReqCounter += optionBReqs.length;
    } else {
      finalRequirements.push(...optionAReqs);
      globalReqCounter += optionAReqs.length;
    }
  }

  return finalRequirements;
}

export const generateJumboRollRequirements = generateSSJumboRollRequirements;

function findSSCandidatePatterns(
  roll: SSJumboRoll,
  activeOrders: VA05Order[],
  settings: SSMachineSettings,
  rules: FilmCompatibilityRule[] = DEFAULT_FILM_COMPATIBILITY_RULES
): SSCandidatePattern[] {
  const matchingOrders = activeOrders.filter(o =>
    isSSOrder(o) &&
    o.remaining_qty > 0.01 &&
    areFilmsCompatible(o.film, roll.film, rules) &&
    (o.thickness_micron === roll.thickness_micron || !o.thickness_micron)
  );

  if (matchingOrders.length === 0 || roll.remaining_length_m <= 0) return [];

  const candidates: SSCandidatePattern[] = [];
  const maxUps = Math.min(20, settings.max_planning_ups || 20);

  for (const ord of matchingOrders) {
    for (let ups = 1; ups <= maxUps; ups++) {
      const totalWidth = ord.width_mm * ups;
      const trim = roll.width_mm - totalWidth;

      if (trim >= settings.min_trim_mm && trim <= roll.width_mm * 0.15) {
        const pkgLength = ord.length_m || 19500;
        if (roll.remaining_length_m < pkgLength) continue;
        const multiple = Math.floor(roll.remaining_length_m / pkgLength);
        if (multiple < 1) continue;

        const totalReels = ups * multiple;
        const totalWeight = calculateJumboWeight(ord.width_mm, roll.thickness_micron, roll.density, pkgLength) * totalReels;
        if (totalWeight > ord.remaining_qty * SS_CUSTOMER_MAX_OVERALLOCATION_FACTOR) continue;

        const totalRollWeight = calculateJumboWeight(roll.width_mm, roll.thickness_micron, roll.density, pkgLength * multiple);
        const trimWeight = totalRollWeight - totalWeight;
        const wastePct = (trimWeight / totalRollWeight) * 100;

        let score = 500 + ups * 100;
        if (trim >= settings.min_trim_mm && trim <= settings.max_trim_mm) score += 500;
        else score -= Math.abs(trim - 25) * 10;
        if (ord.priority) score += 2000;
        score += totalWeight / 10;
        score -= wastePct * 50;

        candidates.push({
          jumbo_roll: roll,
          ups,
          slit_widths: Array(ups).fill(ord.width_mm),
          orders: [{
            order: ord,
            ups,
            width_mm: ord.width_mm,
            length_m: pkgLength,
            reels: totalReels,
            weight_kg: totalWeight,
            is_closed: ord.remaining_qty <= totalWeight * SS_CUSTOMER_MAX_OVERALLOCATION_FACTOR,
          }],
          total_slit_width_mm: totalWidth,
          trim_mm: trim,
          package_length_m: pkgLength,
          package_multiple: multiple,
          total_planned_weight_kg: totalWeight,
          trim_weight_kg: trimWeight,
          waste_percent: wastePct,
          score,
        });
      }
    }
  }

  if (matchingOrders.length >= 2) {
    for (let i = 0; i < matchingOrders.length; i++) {
      for (let j = 0; j < matchingOrders.length; j++) {
        if (i === j) continue;
        const o1 = matchingOrders[i];
        const o2 = matchingOrders[j];

        const len1 = o1.length_m || 19500;
        const len2 = o2.length_m || 19500;

        const isCompatibleLength = (len1 === len2) || (len1 * 2 === len2) || (len1 === len2 * 2);
        if (!isCompatibleLength) continue;

        const lcmLen = Math.max(len1, len2);
        if (roll.remaining_length_m < lcmLen) continue;
        const multiple = Math.floor(roll.remaining_length_m / lcmLen);
        if (multiple < 1) continue;

        for (let u1 = 1; u1 <= maxUps - 1; u1++) {
          for (let u2 = 1; u2 <= maxUps - u1; u2++) {
            const totalUps = u1 + u2;
            if (totalUps > maxUps) continue;

            const totalWidth = o1.width_mm * u1 + o2.width_mm * u2;
            const trim = roll.width_mm - totalWidth;

            if (trim >= settings.min_trim_mm && trim <= roll.width_mm * 0.15) {
              const o1Reels = u1 * multiple * Math.floor(lcmLen / len1);
              const o2Reels = u2 * multiple * Math.floor(lcmLen / len2);
              const order1Weight = calculateJumboWeight(o1.width_mm, roll.thickness_micron, roll.density, len1) * o1Reels;
              const order2Weight = calculateJumboWeight(o2.width_mm, roll.thickness_micron, roll.density, len2) * o2Reels;

              if (order1Weight > o1.remaining_qty * SS_CUSTOMER_MAX_OVERALLOCATION_FACTOR || order2Weight > o2.remaining_qty * SS_CUSTOMER_MAX_OVERALLOCATION_FACTOR) continue;

              const totalWeight = order1Weight + order2Weight;
              const totalRollWeight = calculateJumboWeight(roll.width_mm, roll.thickness_micron, roll.density, lcmLen * multiple);
              const trimWeight = totalRollWeight - totalWeight;
              const wastePct = (trimWeight / totalRollWeight) * 100;

              let score = 800 + totalUps * 100;
              if (o1.width_mm !== o2.width_mm) score += 500;
              if (len1 !== len2) score += 600;
              if (trim >= settings.min_trim_mm && trim <= settings.max_trim_mm) score += 500;
              else score -= Math.abs(trim - 25) * 10;
              if (o1.priority || o2.priority) score += 2000;
              score += totalWeight / 10;
              score -= wastePct * 50;

              const widthsArray: number[] = [];
              for (let k = 0; k < u1; k++) widthsArray.push(o1.width_mm);
              for (let k = 0; k < u2; k++) widthsArray.push(o2.width_mm);

              candidates.push({
                jumbo_roll: roll,
                ups: totalUps,
                slit_widths: widthsArray,
                orders: [
                  {
                    order: o1,
                    ups: u1,
                    width_mm: o1.width_mm,
                    length_m: len1,
                    reels: o1Reels,
                    weight_kg: order1Weight,
                    is_closed: o1.remaining_qty <= order1Weight * SS_CUSTOMER_MAX_OVERALLOCATION_FACTOR,
                  },
                  {
                    order: o2,
                    ups: u2,
                    width_mm: o2.width_mm,
                    length_m: len2,
                    reels: o2Reels,
                    weight_kg: order2Weight,
                    is_closed: o2.remaining_qty <= order2Weight * SS_CUSTOMER_MAX_OVERALLOCATION_FACTOR,
                  }
                ],
                total_slit_width_mm: totalWidth,
                trim_mm: trim,
                package_length_m: lcmLen,
                package_multiple: multiple,
                total_planned_weight_kg: totalWeight,
                trim_weight_kg: trimWeight,
                waste_percent: wastePct,
                score,
              });
            }
          }
        }
      }
    }
  }

  if (matchingOrders.length >= 3) {
    for (let i = 0; i < matchingOrders.length; i++) {
      for (let j = i + 1; j < matchingOrders.length; j++) {
        for (let k = j + 1; k < matchingOrders.length; k++) {
          const o1 = matchingOrders[i];
          const o2 = matchingOrders[j];
          const o3 = matchingOrders[k];

          const len1 = o1.length_m || 19500;
          const len2 = o2.length_m || 19500;
          const len3 = o3.length_m || 19500;

          const minLen = Math.min(len1, len2, len3);
          const isCompatible = [len1, len2, len3].every(l => l === minLen || l === minLen * 2);
          if (!isCompatible) continue;

          const lcmLen = Math.max(len1, len2, len3);
          if (roll.remaining_length_m < lcmLen) continue;
          const multiple = Math.floor(roll.remaining_length_m / lcmLen);
          if (multiple < 1) continue;

          const totalWidth = o1.width_mm + o2.width_mm + o3.width_mm;
          const trim = roll.width_mm - totalWidth;

          if (trim >= settings.min_trim_mm && trim <= roll.width_mm * 0.15) {
            const r1 = multiple * Math.floor(lcmLen / len1);
            const r2 = multiple * Math.floor(lcmLen / len2);
            const r3 = multiple * Math.floor(lcmLen / len3);
            const w1 = calculateJumboWeight(o1.width_mm, roll.thickness_micron, roll.density, len1) * r1;
            const w2 = calculateJumboWeight(o2.width_mm, roll.thickness_micron, roll.density, len2) * r2;
            const w3 = calculateJumboWeight(o3.width_mm, roll.thickness_micron, roll.density, len3) * r3;

            if (w1 > o1.remaining_qty * SS_CUSTOMER_MAX_OVERALLOCATION_FACTOR || w2 > o2.remaining_qty * SS_CUSTOMER_MAX_OVERALLOCATION_FACTOR || w3 > o3.remaining_qty * SS_CUSTOMER_MAX_OVERALLOCATION_FACTOR) continue;

            const totalWeight = w1 + w2 + w3;
            const totalRollWeight = calculateJumboWeight(roll.width_mm, roll.thickness_micron, roll.density, lcmLen * multiple);
            const trimWeight = totalRollWeight - totalWeight;
            const wastePct = (trimWeight / totalRollWeight) * 100;

            let score = 1200;
            const distinctWidths = new Set([o1.width_mm, o2.width_mm, o3.width_mm]).size;
            score += distinctWidths * 300;
            if (trim >= settings.min_trim_mm && trim <= settings.max_trim_mm) score += 500;
            else score -= Math.abs(trim - 25) * 10;
            if (o1.priority || o2.priority || o3.priority) score += 2000;
            score += totalWeight / 10;
            score -= wastePct * 50;

            candidates.push({
              jumbo_roll: roll,
              ups: 3,
              slit_widths: [o1.width_mm, o2.width_mm, o3.width_mm],
              orders: [
                { order: o1, ups: 1, width_mm: o1.width_mm, length_m: len1, reels: r1, weight_kg: w1, is_closed: o1.remaining_qty <= w1 * SS_CUSTOMER_MAX_OVERALLOCATION_FACTOR },
                { order: o2, ups: 1, width_mm: o2.width_mm, length_m: len2, reels: r2, weight_kg: w2, is_closed: o2.remaining_qty <= w2 * SS_CUSTOMER_MAX_OVERALLOCATION_FACTOR },
                { order: o3, ups: 1, width_mm: o3.width_mm, length_m: len3, reels: r3, weight_kg: w3, is_closed: o3.remaining_qty <= w3 * SS_CUSTOMER_MAX_OVERALLOCATION_FACTOR },
              ],
              total_slit_width_mm: totalWidth,
              trim_mm: trim,
              package_length_m: lcmLen,
              package_multiple: multiple,
              total_planned_weight_kg: totalWeight,
              trim_weight_kg: trimWeight,
              waste_percent: wastePct,
              score,
            });
          }
        }
      }
    }
  }

  return candidates;
}

export function generateSSPlans(
  orders: VA05Order[],
  availableJumboRolls: SSJumboRoll[],
  rawSettings: SSMachineSettings,
  selectedFilm?: string,
  rules: FilmCompatibilityRule[] = DEFAULT_FILM_COMPATIBILITY_RULES,
  providedRequirements?: SSJumboRequirement[]
): { plans: SSPlan[]; remainingOrders: VA05Order[]; updatedRolls: SSJumboRoll[] } {
  const settings = { ...DEFAULT_SS_SETTINGS, ...rawSettings };
  const motherDeckle = Number(settings.ps01_deckle_width_mm) > 0
    ? Number(settings.ps01_deckle_width_mm)
    : 10400;
  let usableRolls = availableJumboRolls.filter(r => 
    isSSFilm(r.film) &&
    (r.status === 'AVAILABLE' || r.status === 'PARTIALLY_CONSUMED') && 
    r.remaining_length_m > 0 &&
    r.width_mm <= settings.max_jumbo_width_mm &&
    r.diameter_mm <= settings.max_jumbo_diameter_mm
  );

  if (selectedFilm && selectedFilm !== 'ALL') {
    const compatibleFilms = getCompatibleFilmsFor(selectedFilm, rules);
    usableRolls = usableRolls.filter(r => compatibleFilms.includes(r.film));
  }

  if (usableRolls.length === 0) {
    return { plans: [], remainingOrders: orders, updatedRolls: availableJumboRolls };
  }

  const activeOrders = orders.map(o => ({ ...o }));
  const rollsPool = usableRolls.map(r => ({ ...r }));
  const generatedPlans: SSPlan[] = [];
  let planCounter = 1;

  // Retrieve Stage 1 requirements if available
  let knownRequirements: SSJumboRequirement[] = providedRequirements || [];
  if (knownRequirements.length === 0) {
    try {
      knownRequirements = getStoredSSJumboRequirements();
    } catch {
      knownRequirements = [];
    }
  }

  // 1. Group rolls by synthesized Stage 1 requirement identity
  const rollsByReqId = new Map<string, { req: SSJumboRequirement; rolls: SSJumboRoll[] }>();
  const unlinkedRolls: SSJumboRoll[] = [];

  for (const roll of rollsPool) {
    let req: SSJumboRequirement | undefined = roll.requirement;
    const reqId = roll.source_requirement_id || (req ? req.id : null) || 
      (roll.id.includes('req-ss-') ? roll.id.match(/req-ss-\d+/)?.[0] : null);

    if (!req && reqId && knownRequirements.length > 0) {
      req = knownRequirements.find(r => r.id === reqId);
    }

    if (!req && knownRequirements.length > 0) {
      // Try matching by physical setup identity
      req = knownRequirements.find(r => 
        r.film === roll.film &&
        r.required_jumbo_width_mm === roll.width_mm &&
        r.required_jumbo_length_m === roll.length_m &&
        r.thickness_micron === roll.thickness_micron
      );
    }

    if (req) {
      if (!rollsByReqId.has(req.id)) {
        rollsByReqId.set(req.id, { req, rolls: [] });
      }
      rollsByReqId.get(req.id)!.rolls.push(roll);
    } else {
      unlinkedRolls.push(roll);
    }
  }

  // 2. Batch identical synthesized rolls into grouped Stage-2 SS Plans
  for (const [reqId, { req, rolls }] of rollsByReqId.entries()) {
    const availableRollsInReq = rolls.filter(r => r.status !== 'CONSUMED' && r.remaining_length_m > 0);
    if (availableRollsInReq.length === 0) continue;

    const rollCount = availableRollsInReq.length;
    const firstRoll = availableRollsInReq[0];

    const planId = `plan-ss-${Date.now()}-${planCounter}`;
    const planNumber = `SS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(planCounter).padStart(3, '0')}`;
    planCounter++;

    // Scale order allocations if rollCount < req.required_rolls_count (e.g. partial stock)
    const rollRatio = rollCount / (req.required_rolls_count || rollCount);
    let planTotalPlannedWeightKg = 0;

    const orderAllocations: SSPlanOrderAllocation[] = (req.orders_covered || []).map(cov => {
      const liveOrd = activeOrders.find(o => 
        o.id === cov.order_id || 
        `${o.sales_order}-${o.item_number}` === `${cov.sales_order}-${cov.item_number}`
      );
      const remBefore = liveOrd ? liveOrd.remaining_qty : 0;
      const plannedWeight = Number((cov.weight_kg * rollRatio).toFixed(2));
      const plannedReels = Math.round(cov.required_reels * rollRatio);
      const remAfter = liveOrd ? Math.max(0, Number((remBefore - plannedWeight).toFixed(2))) : 0;

      if (liveOrd) {
        liveOrd.remaining_qty = remAfter;
        liveOrd.produced_qty = Number((liveOrd.produced_qty + plannedWeight).toFixed(2));
        liveOrd.status = remAfter <= 0.01 ? 'COMPLETED' : 'PARTIALLY_FULFILLED';
      }

      planTotalPlannedWeightKg += plannedWeight;

      const orderUps = (req.finished_widths_covered || []).filter(w => w === cov.width_mm).length || 1;

      return {
        order_id: cov.order_id || liveOrd?.id || '',
        sales_order: cov.sales_order,
        item_number: cov.item_number,
        customer: cov.customer,
        width_mm: cov.width_mm,
        length_m: cov.length_m,
        ups: orderUps,
        planned_reels: plannedReels,
        weight_per_reel_kg: plannedReels > 0 ? Number((plannedWeight / plannedReels).toFixed(2)) : 0,
        planned_weight_kg: plannedWeight,
        weight_kg: plannedWeight,
        remaining_before_kg: remBefore,
        remaining_after_kg: remAfter,
        is_closed: remAfter <= 0.01,
      };
    });

    const totalRollsWeightKg = availableRollsInReq.reduce((s, r) => s + r.remaining_quantity_kg, 0);
    const trimWeightKg = Math.max(0, Number((totalRollsWeightKg - planTotalPlannedWeightKg).toFixed(2)));
    const wastePercent = totalRollsWeightKg > 0 ? Number(((trimWeightKg / totalRollsWeightKg) * 100).toFixed(2)) : 0;
    const totalSlitWidth = (req.finished_widths_covered || []).reduce((a, b) => a + b, 0);
    const trimMm = req.expected_trim_mm !== undefined ? req.expected_trim_mm : Math.max(0, req.required_jumbo_width_mm - totalSlitWidth);
    const packageMultiple = req.package_multiple || 1;
    const packageLengthM = Math.round(req.required_jumbo_length_m / Math.max(1, packageMultiple));

    const newPlan: SSPlan = {
      id: planId,
      plan_number: planNumber,
      film: req.film,
      jumbo_roll_id: rollCount === 1 ? firstRoll.roll_id : `${firstRoll.roll_id} (${rollCount} Rolls Batched)`,
      jumbo_roll_db_id: firstRoll.id,
      jumbo_width_mm: req.required_jumbo_width_mm,
      jumbo_length_m: req.required_jumbo_length_m,
      thickness_micron: req.thickness_micron,
      diameter_mm: req.calculated_diameter_mm,
      core: req.core || settings.core,
      ups: req.ups,
      finished_sizes: req.finished_widths_covered,
      total_slit_width_mm: totalSlitWidth,
      trim_mm: trimMm,
      package_length_m: packageLengthM,
      package_multiple: packageMultiple,
      orders_covered: orderAllocations,
      planned_quantity_kg: Number(planTotalPlannedWeightKg.toFixed(2)),
      trim_weight_kg: trimWeightKg,
      waste_percent: wastePercent,
      consumed_length_m: req.required_jumbo_length_m,
      remaining_roll_length_m: 0,
      roll_status_after: 'CONSUMED',
      status: 'APPROVED',
      created_by: 'Planner Engine',
      created_at: new Date().toISOString(),
      repeat_count: rollCount,
      jumbo_rolls_count: rollCount,
      jumbo_roll_ids: availableRollsInReq.map(r => r.roll_id),
      source_requirement_id: req.id,
    };

    generatedPlans.push(newPlan);

    // Mark all batched physical rolls as consumed
    for (const roll of availableRollsInReq) {
      roll.remaining_length_m = 0;
      roll.remaining_quantity_kg = 0;
      roll.status = 'CONSUMED';
      roll.consumed_by_plan = planNumber;
      roll.updated_at = new Date().toISOString();
    }
  }

  // 3. Fallback: process unlinked legacy inventory rolls via greedy search
  for (const roll of unlinkedRolls) {
    let rollLoopCount = 0;
    const maxRollLoops = 50;

    while (roll.remaining_length_m > 0 && roll.status !== 'CONSUMED' && rollLoopCount < maxRollLoops) {
      rollLoopCount++;

      const matchingOrders = activeOrders.filter(o => 
        isSSOrder(o) &&
        o.remaining_qty > 0.01 && 
        areFilmsCompatible(o.film, roll.film, rules) && 
        (o.thickness_micron === roll.thickness_micron || !o.thickness_micron)
      );

      if (matchingOrders.length === 0) break;

      const candidates = findSSCandidatePatterns(roll, activeOrders, settings, rules);
      if (candidates.length === 0) break;

      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];

      const planId = `plan-ss-${Date.now()}-${planCounter}`;
      const planNumber = `SS-${new Date().toISOString().slice(0,10).replace(/-/g, '')}-${String(planCounter).padStart(3, '0')}`;
      planCounter++;

      const consumedLength = best.package_length_m * best.package_multiple;
      const newRemainingLength = Math.max(0, roll.remaining_length_m - consumedLength);
      const rollStatusAfter = newRemainingLength <= 0 ? 'CONSUMED' : 'PARTIALLY_CONSUMED';

      const orderAllocations: SSPlanOrderAllocation[] = best.orders.map(item => {
        const liveOrd = activeOrders.find(o => o.id === item.order.id)!;
        const remBefore = liveOrd.remaining_qty;
        const remAfter = Math.max(0, Number((remBefore - item.weight_kg).toFixed(2)));
        
        liveOrd.remaining_qty = remAfter;
        liveOrd.produced_qty = Number((liveOrd.produced_qty + item.weight_kg).toFixed(2));
        liveOrd.status = remAfter <= 0.01 ? 'COMPLETED' : 'PARTIALLY_FULFILLED';

        return {
          order_id: item.order.id,
          sales_order: item.order.sales_order,
          item_number: item.order.item_number,
          customer: item.order.customer,
          width_mm: item.width_mm,
          length_m: item.length_m,
          ups: item.ups,
          planned_reels: item.reels,
          weight_per_reel_kg: Number((item.weight_kg / item.reels).toFixed(2)),
          planned_weight_kg: Number(item.weight_kg.toFixed(2)),
          weight_kg: Number(item.weight_kg.toFixed(2)),
          remaining_before_kg: remBefore,
          remaining_after_kg: remAfter,
          is_closed: remAfter <= 0.01,
        };
      });

      const newPlan: SSPlan = {
        id: planId,
        plan_number: planNumber,
        film: roll.film,
        jumbo_roll_id: roll.roll_id,
        jumbo_roll_db_id: roll.id,
        jumbo_width_mm: roll.width_mm,
        jumbo_length_m: roll.length_m,
        thickness_micron: roll.thickness_micron,
        diameter_mm: roll.diameter_mm,
        core: roll.core || settings.core,
        ups: best.ups,
        finished_sizes: best.slit_widths,
        total_slit_width_mm: best.total_slit_width_mm,
        trim_mm: best.trim_mm,
        package_length_m: best.package_length_m,
        package_multiple: best.package_multiple,
        orders_covered: orderAllocations,
        planned_quantity_kg: Number(best.total_planned_weight_kg.toFixed(2)),
        trim_weight_kg: Number(best.trim_weight_kg.toFixed(2)),
        waste_percent: Number(best.waste_percent.toFixed(2)),
        consumed_length_m: consumedLength,
        remaining_roll_length_m: newRemainingLength,
        roll_status_after: rollStatusAfter,
        status: 'APPROVED',
        created_by: 'Planner Engine',
        created_at: new Date().toISOString(),
        repeat_count: 1,
        jumbo_rolls_count: 1,
        jumbo_roll_ids: [roll.roll_id],
      };

      generatedPlans.push(newPlan);

      roll.remaining_length_m = newRemainingLength;
      roll.remaining_quantity_kg = calculateJumboWeight(roll.width_mm, roll.thickness_micron, roll.density, newRemainingLength);
      roll.status = rollStatusAfter;
      roll.consumed_by_plan = planNumber;
      roll.updated_at = new Date().toISOString();
    }
  }

  const finalRolls = availableJumboRolls.map(r => {
    const updated = rollsPool.find(p => p.id === r.id);
    return updated || r;
  });

  return {
    plans: generatedPlans,
    remainingOrders: activeOrders,
    updatedRolls: finalRolls,
  };
}

export const generateMetallizerPlans = generateSSPlans;
