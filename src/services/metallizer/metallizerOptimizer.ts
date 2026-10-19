import { resolveFilmDensity, findFilmsMissingDensity } from '../stuffing/filmDensities';
import { VA05Order } from '../../types';
import { 
  JumboRoll, 
  MetallizerMachineSettings, 
  MetallizerPlan, 
  JumboRequirement,
  MetallizerPlanOrderAllocation,
  MetallizerPackageSegment,
  DoffKnifeTransition,
  DoffTransitionValidationResult,
  KnifeArmMovement,
  StationaryKnifeArm,
  MetallizerSegmentOrderAllocation,
  SegmentValidationResult,
  SegmentedJumboValidationOptions,
  SegmentedJumboValidationResult,
  ShaftDistributionResult,
  isSegmentedJumboRequirement,
  MasterWidthClusterCandidate,
  MasterWidthClusteringOptions,
  MasterWidthClusteringResult
} from '../../types/metallizer';
import { 
  calculateJumboDiameter, 
  calculateJumboWeight, 
  DEFAULT_METALLIZER_SETTINGS, 
  MSL_CUSTOMER_MAX_OVERALLOCATION_FACTOR,
  MSL_GREEN_MIN_TRIM_MM,
  MSL_GREEN_MAX_TRIM_MM
} from './metallizerMasterData';
import { evaluatePS01Feasibility, evaluatePS01CombinationFeasibility, PS01FeasibilityEvaluation } from './ps01FeasibilityAdapter';
import {
  FilmCompatibilityRule,
  DEFAULT_FILM_COMPATIBILITY_RULES,
  areFilmsCompatible,
  getCompatibleFilmsFor,
  getCompatibleGroupForFilm,
  getAllCompatibleGroups
} from './filmCompatibilityMaster';
import {
  runDynamicCampaignOptimization,
  DynamicContinuationOptions,
  DynamicRunResult,
} from './dynamicContinuationEngine';

export interface MetallizerCandidatePattern {
  jumbo_roll: JumboRoll;
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

export interface OptimizationStrategyEvaluation {
  strategy: 'COMBINED' | 'SEPARATE';
  film_group: string;
  films_included: string[];
  requirements: JumboRequirement[];
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

/**
 * HARD BUSINESS RULE — METALLIZED FILM IDENTIFICATION
 * A film order shall be treated as a METALLIZED FILM order ONLY when its Film Code contains "MZ".
 * Examples:
 * - MZ10S-18 -> Metallized Film
 * - MZ18 -> Metallized Film
 * - MZ20 -> Metallized Film
 * - MZ10S-20 -> Metallized Film
 * - MZ10MB-15 -> Metallized Film
 *
 * Any Film Code that does NOT contain "MZ" must NOT be treated as a Metallized Film order.
 * This classification is strictly enforced at the BACKEND / optimizer level.
 */
export function isMetallizedFilm(filmCode: string | undefined | null): boolean {
  if (!filmCode || typeof filmCode !== 'string') return false;
  return filmCode.toUpperCase().includes('MZ');
}

/**
 * Binary search lower bound: first index where arr[idx] >= target
 */
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

/**
 * Binary search upper bound: last index where arr[idx] <= target
 */
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
 * Check if a VA05 order is a metallized film order based strictly on whether its film code contains "MZ"
 */
export function isMetallizerOrder(order: VA05Order | undefined | null): boolean {
  if (!order) return false;
  return isMetallizedFilm(order.film);
}

/**
 * Generate candidate combinations of finished slit widths (1 to 6 UPS) from available orders.
 * MSL slitter has 6 UPS physically available (Arms 1-3 on Side A, Arms 4-6 on Side B).
 * All 1 to 6 UPS are available at all times wherever deckle is maximally adjusted.
 * Supports:
 * - Single width repeats (1-6 UPS)
 * - Mixed widths (e.g. 1120 + 1130 + 1140 mm)
 * - Mixed compatible lengths (e.g. 10,000 m + 20,000 m)
 */
export function generateMSLWidthCombinations(
  uniqueWidths: number[],
  maxUps: number = 6,
  maxTotalWidth: number = 3650,
  minTrim: number = 20
): { widths: number[]; ups: number; sumWidth: number }[] {
  const sortedWidths = uniqueWidths.slice().sort((a, b) => a - b);
  const combinations: { widths: number[]; ups: number; sumWidth: number }[] = [];
  const maxMslUps = Math.min(6, maxUps);

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
    if (currentWidths.length >= maxMslUps) return;

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

/**
 * Phase-1 safe speedup: only physically legal length assignments
 * (pure same-length + dual 1:2 shaft-balanced). Same feasible set as
 * full Cartesian + post-filters — no valid pattern excluded.
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

/**
 * Internal single-pool demand optimizer
 * Solves jumbo requirements for an arbitrary pool of orders (can be a single film or a combined compatible group).
 * - Allows a portfolio of different jumbo widths in the solution
 * - Evaluates multi-width & multi-length MSL patterns
 * - Performs PS01 feasibility handshake (3-UPS preferred, 4-UPS fallback, 5/6-UPS forbidden)
 * - Rejects RED candidates immediately (0 KG, 0 rolls)
 * - Strictly enforces individual +10% order ceiling (Allocated <= Balance * 1.10)
 * - Maximizes practical jumbo length (e.g. 20,000m, 39,000m)
 */
function optimizeDemandPool(
  groupOrders: VA05Order[],
  rawSettings: MetallizerMachineSettings,
  groupLabel: string,
  startReqCounter: number = 1
): { requirements: JumboRequirement[]; score: number; evaluation: OptimizationStrategyEvaluation } {
  const settings = { ...DEFAULT_METALLIZER_SETTINGS, ...rawSettings };
  // Default: 3-UPS only. 4-UPS search/fallback only when planner enables allow_4_ups.
  const allow4Ups = settings.allow_4_ups === true;
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
      `Open Master Backlog → Film Specs Master DB and add density before MSL planning.`
    );
  }
  const density =
    resolveFilmDensity(filmCodesForDensity[0] || '') ||
    Number(groupOrders.find(o => Number(o.density) > 0)?.density) ||
    0;
  if (!(density > 0)) {
    throw new Error(`Density not saved for film(s): ${filmCodesForDensity.join(', ')}.`);
  }
  const maxMslUps = Math.min(6, settings.max_planning_ups || 6);

  // Phase-1: memoize pure weight formula
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

  // Helper to group orders into length-compatible families (strictly 1:1 or 1:2 ratio)
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

    for (const len of sorted) {
      if (visited.has(len)) continue;
      const famLens: number[] = [len];
      visited.add(len);

      // Find compatible lengths (exact 1:2, 2:1, 1:3, 3:1, 1:4, 4:1 or integer multiple/divisor relationships)
      for (const other of sorted) {
        if (!visited.has(other)) {
          const isCompatible = famLens.some(
            l => other === l * 2 || l === other * 2 || other === l * 3 || l === other * 3 || other === l * 4 || l === other * 4 || (l % other === 0) || (other % l === 0)
          );
          if (isCompatible) {
            famLens.push(other);
            visited.add(other);
          }
        }
      }
      famLens.sort((a, b) => a - b);

      const baseLengthM = famLens[0];
      const packLengthM = famLens[famLens.length - 1]; // e.g. 18,700m for [9350, 18700], or 20,000m for [10000, 20000]

      const validMultiples: { multiple: number; length_m: number; diameter_mm: number }[] = [];
      const maxK = Math.max(...configuredMultiples, 6);
      for (let k = 1; k <= maxK; k++) {
        const jumboLen = packLengthM * k;
        const dia = calculateJumboDiameter(filmThickness, jumboLen);
        if (dia <= maxDiameterMm) {
          validMultiples.push({ multiple: k, length_m: jumboLen, diameter_mm: dia });
        }
      }
      if (validMultiples.length === 0) {
        validMultiples.push({
          multiple: 1,
          length_m: packLengthM,
          diameter_mm: calculateJumboDiameter(filmThickness, packLengthM),
        });
      }
      // Sort descending so the maximum possible jumbo length (near 1250mm diameter) is prioritized first
      validMultiples.sort((a, b) => b.length_m - a.length_m);

      families.push({
        familyId: famLens.join('_'),
        lengths: famLens,
        baseLengthM,
        packLengthM,
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

  // Initialize per-order allocation tracking with strict individual +10% ceiling
  interface OrderTracker {
    order: VA05Order;
    pkgLength: number;
    lengthMultiple: number;
    slotIdx: number;
    initialBalanceKg: number;
    maxAllowedKg: number; // strictly balance * MSL_CUSTOMER_MAX_OVERALLOCATION_FACTOR (1.10)
    allocatedKg: number;
    remainingKg: number;
    allocatedReels: number;
    status: 'PENDING' | 'PARTIALLY_FULFILLED' | 'COMPLETED';
  }

  // Create discrete demand slots per (film, width_mm, length_m) combination
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
      maxAllowedKg: Number((o.remaining_qty * MSL_CUSTOMER_MAX_OVERALLOCATION_FACTOR).toFixed(2)),
      allocatedKg: 0,
      remainingKg: o.remaining_qty,
      allocatedReels: 0,
      status: 'PENDING',
    };
  });

  // Candidate MSL Pattern structure
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

  // Side-effect free candidate generator: generates MS1 candidates independently per film & length family
  function generateCandidatePool(activeTrackers: OrderTracker[]): MS1JumboCandidate[] {
    const activeFilms = Array.from(new Set(activeTrackers.map(t => t.order.film)));
    if (activeFilms.length === 0) return [];

    // Plant-approved MSL GREEN trim operating window: 18–45 mm (Target: 25 mm)
    const mslGreenMinTrim = settings.green_min_trim_mm || 18;
    const mslGreenMaxTrim = settings.green_max_trim_mm || 45;
    const pool: MS1JumboCandidate[] = [];
    const seen = new Map<string, MS1JumboCandidate>();

    for (const filmCode of activeFilms) {
      for (const fam of lengthFamilies) {
        const filmFamTrackers = activeTrackers.filter(
          t => t.order.film === filmCode && fam.lengths.includes(t.pkgLength)
        );
        if (filmFamTrackers.length === 0) continue;

        const filmWidths = Array.from(new Set(filmFamTrackers.map(t => t.order.width_mm))).sort((a, b) => a - b);
        if (filmWidths.length === 0) continue;

        const uniqueCombos = generateMSLWidthCombinations(
          filmWidths,
          maxMslUps,
          settings.max_jumbo_width_mm,
          mslGreenMinTrim
        );

        const maxJumboMm = settings.max_jumbo_width_mm;

        for (const combo of uniqueCombos) {
          // Geometry prune: cannot fit within max jumbo with min GREEN trim
          if (combo.sumWidth + mslGreenMinTrim > maxJumboMm) continue;

          const possibleCutLengths: number[][] = combo.widths.map(w => {
            const validLengths = fam.lengths.filter(L => slotMap.has(`${filmCode}__${w}__${L}`));
            return validLengths.length > 0 ? validLengths : [fam.packLengthM];
          });

          // MSL duplex: max 3 per shaft (same as legacy post-filter)
          const lengthAssignments = buildLegalLengthAssignments(possibleCutLengths, 3);

          const uniqueAssignments: number[][] = [];
          const seenAssign = new Set<string>();
          for (const assign of lengthAssignments) {
            const key = combo.widths.map((w, idx) => `${w}:${assign[idx]}`).sort().join('|');
            if (!seenAssign.has(key)) {
              seenAssign.add(key);
              uniqueAssignments.push(assign);
            }
          }

          for (const assign of uniqueAssignments) {
            // Determine meaningful trim values for this specific width combination
            // Preserves full 18–45 mm physical operating window without trim jitter / proliferation
            const meaningfulTrims = new Set<number>();

            // 1. Check Canonical PS01 deckle alignment targets first (3-UPS and 4-UPS pure targets across 18–45 mm)
            // Canonical 3-UPS targets: 3420mm (trim 140mm), 3410mm (trim 170mm), 3400mm (trim 200mm), 3390mm (trim 230mm)
            // Canonical 4-UPS targets: 2565mm (trim 140mm), 2550mm (trim 200mm)
            const ps01Targets = [3420, 3410, 3400, 3390, 2565, 2550];
            for (const targetW of ps01Targets) {
              const t = targetW - combo.sumWidth;
              if (t >= mslGreenMinTrim && t <= mslGreenMaxTrim) {
                meaningfulTrims.add(t);
              }
            }

            // 2. Target preference trim (25 mm) or standard trims (20, 30 mm)
            // If an existing canonical target is already within 3mm of targetTrim, prefer the canonical target to eliminate jitter
            const targetTrim = 25;
            if (targetTrim >= mslGreenMinTrim && targetTrim <= mslGreenMaxTrim) {
              if (combo.sumWidth + targetTrim <= settings.max_jumbo_width_mm) {
                const nearCanonical = Array.from(meaningfulTrims).some(t => Math.abs(t - targetTrim) <= 3);
                if (!nearCanonical) {
                  meaningfulTrims.add(targetTrim);
                }
              }
            }

            for (const stdTrim of [20, 30]) {
              if (stdTrim >= mslGreenMinTrim && stdTrim <= mslGreenMaxTrim) {
                if (combo.sumWidth + stdTrim <= settings.max_jumbo_width_mm) {
                  const nearExisting = Array.from(meaningfulTrims).some(t => Math.abs(t - stdTrim) <= 3);
                  if (!nearExisting) {
                    meaningfulTrims.add(stdTrim);
                  }
                }
              }
            }
            const candidateTrims = Array.from(meaningfulTrims).sort((a, b) => a - b);

            for (const testTrim of candidateTrims) {
              const derivedJumbo = combo.sumWidth + testTrim;
              if (derivedJumbo < 1500 || derivedJumbo > settings.max_jumbo_width_mm) continue;

              for (const vm of fam.validMultiples) {
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

  // Evaluated Winning Portfolio Step
  interface WinningSetResult {
    candidates: MS1JumboCandidate[];
    ps01Ups: number;
    jumboWidths: number[];
    totalWeb: number;
    ps01Trim: number;
    status: 'GREEN' | 'YELLOW';
    repeatCycles: number;
    totalPlannedKg: number;
    realFulfilledKg: number;
    totalTrimKg: number;
    closedCount: number;
    score: number;
  }

  const finalRequirements: JumboRequirement[] = [];
  let reqCounter = startReqCounter;
  let iteration = 0;
  const maxIterations = 250;
  let activeCampaignJumboWidth: number | null = null;
  let activeCampaignSlitWidths: number[] = [];

  // Precompute full candidate pool across films independently to eliminate combinatorial cross-film explosion
  const masterCandidatePool = generateCandidatePool(orderTrackers);
  // Phase-2: live pool shrinks as slots close — avoid re-scanning full master each iteration
  let liveCandidates = masterCandidatePool;

  // Main optimization loop: searches global 3-UPS / 4-UPS portfolios iteratively until demand is satisfied
  while (iteration < maxIterations) {
    iteration++;
    // Continue optimization loop while genuine customer demand remains legally fulfillable (> 0.01 kg)
    const unclosedDrivers = orderTrackers.filter(t => t.remainingKg > 0.01);
    if (unclosedDrivers.length === 0) break;

    // Retain orders with spare capacity (< maxAllowedKg) so they remain eligible as companion cuts for unclosed orders
    const activeTrackers = orderTrackers.filter(t => t.allocatedKg < t.maxAllowedKg);
    if (activeTrackers.length === 0) break;
    const trackerBySlot: (typeof orderTrackers[0] | undefined)[] = new Array(numDemandSlots);
    for (let ti = 0; ti < activeTrackers.length; ti++) {
      const tr = activeTrackers[ti];
      if (!trackerBySlot[tr.slotIdx]) trackerBySlot[tr.slotIdx] = tr;
    }

    // STRICT priority (PS-style): while any starred order has residual demand, only
    // accept patterns that cover at least one priority slot. Priority fulfillment
    // dominates even if non-priority residual is left for later / lost.
    const prioritySlotSet = new Set(
      activeTrackers.filter(t => !!t.order.priority && t.remainingKg > 0.01).map(t => t.slotIdx)
    );
    let strictPriorityMode = prioritySlotSet.size > 0;

    const activeSlotsSet = new Set(activeTrackers.map(t => t.slotIdx));
    // Refilter from MASTER each iteration (do not permanently shrink).
    // Keep candidates that still touch at least one active slot — mixed patterns
    // remain available so companion widths can help close residual demand.
    liveCandidates = masterCandidatePool.filter(c =>
      c.activeIndices.some(s => activeSlotsSet.has(s))
    );
    const candidatePool = liveCandidates;
    if (candidatePool.length === 0) break;

    let bestWinningSet: WinningSetResult | null = null;

    // TRUE BEST 3-UPS WINNER SELECTION:
    // Primary criterion: Maximum REAL customer-fulfilled kg
    // Tie-breakers:
    // 2. More closed customer orders
    // 3. Better jumbo utilization / practical diameter
    // 3b. Campaign Setup Continuity (reusing active jumbo width saves full PS01 changeover)
    // 4. Lower unnecessary MSL plan/setup burden (fewer unique jumbo widths)
    // 5. Better trim (smaller PS01 trim)
    // 6. Existing heuristic score only as a final tie-breaker
    const isBetter3UpsCandidate = (cand: WinningSetResult, current: WinningSetResult | null): boolean => {
      if (!current) return true;

      // STRICT: priority kg / closed dominates all other criteria
      const prioCand = (cand as any).priorityKg ?? 0;
      const prioCur = (current as any).priorityKg ?? 0;
      if (strictPriorityMode) {
        if (Math.abs(prioCand - prioCur) > 0.01) return prioCand > prioCur;
        const pc = (cand as any).priorityClosed ?? 0;
        const pr = (current as any).priorityClosed ?? 0;
        if (pc !== pr) return pc > pr;
      }

      // Quality priority: GREEN beats YELLOW (stay in green PS01 zone when possible)
      if (cand.status === 'GREEN' && current.status !== 'GREEN') return true;
      if (current.status === 'GREEN' && cand.status !== 'GREEN') return false;

      const candKg = cand.realFulfilledKg ?? cand.totalPlannedKg;
      const currKg = current.realFulfilledKg ?? current.totalPlannedKg;
      const candDia = cand.candidates[0]?.jumboDiameterMm || 0;
      const currDia = current.candidates[0]?.jumboDiameterMm || 0;
      const candMult = cand.candidates[0]?.packageMultiple || 1;
      const currMult = current.candidates[0]?.packageMultiple || 1;

      // Near-max diameter FIRST (factory rule): larger package / OD wins unless kg is much worse (>25%)
      const maxKg = Math.max(candKg, currKg, 0.01);
      if (candMult !== currMult) {
        const kgRatio = candKg / maxKg;
        const otherRatio = currKg / maxKg;
        // Prefer higher multiple unless it delivers <75% of the other's fulfilled kg
        if (candMult > currMult && kgRatio >= 0.75 * otherRatio) return true;
        if (currMult > candMult && otherRatio >= 0.75 * kgRatio) return false;
      }
      if (Math.abs(candDia - currDia) > 20) {
        if (candDia > currDia && candKg >= 0.75 * currKg) return true;
        if (currDia > candDia && currKg >= 0.75 * candKg) return false;
      }

      // Then maximum REAL customer-fulfilled kg
      const kgDiff = candKg - currKg;
      if (Math.abs(kgDiff) > 0.01) {
        return kgDiff > 0;
      }

      // More closed customer orders
      if (cand.closedCount !== current.closedCount) {
        return cand.closedCount > current.closedCount;
      }

      // Diameter tie-break
      if (Math.abs(candDia - currDia) > 1) {
        return candDia > currDia;
      }

      // 3b. Campaign Setup Continuity (reusing active jumbo width saves full PS01 changeover)
      if (activeCampaignJumboWidth !== null) {
        const candMatchesActive = cand.jumboWidths.includes(activeCampaignJumboWidth);
        const currMatchesActive = current.jumboWidths.includes(activeCampaignJumboWidth);
        if (candMatchesActive !== currMatchesActive) {
          return candMatchesActive;
        }
      }

      // 4. Lower unnecessary MSL plan/setup burden (fewer unique jumbo widths)
      const candSetups = new Set(cand.jumboWidths).size;
      const currSetups = new Set(current.jumboWidths).size;
      if (candSetups !== currSetups) {
        return candSetups < currSetups;
      }

      // 5. Better trim (smaller PS01 trim)
      if (Math.abs(cand.ps01Trim - current.ps01Trim) > 1) {
        return cand.ps01Trim < current.ps01Trim;
      }

      // 6. Existing heuristic score as final tie-breaker
      return cand.score > current.score;
    };

    // TRUE BEST 4-UPS WINNER SELECTION:
    // Symmetrically selects candidate maximizing real customer-fulfilled kg
    const isBetter4UpsCandidate = (cand: WinningSetResult, current: WinningSetResult | null): boolean => {
      if (!current) return true;

      if (strictPriorityMode) {
        const prioCand = (cand as any).priorityKg ?? 0;
        const prioCur = (current as any).priorityKg ?? 0;
        if (Math.abs(prioCand - prioCur) > 0.01) return prioCand > prioCur;
        const pc = (cand as any).priorityClosed ?? 0;
        const pr = (current as any).priorityClosed ?? 0;
        if (pc !== pr) return pc > pr;
      }

      // Quality priority: GREEN beats YELLOW (stay in green PS01 zone when possible)
      if (cand.status === 'GREEN' && current.status !== 'GREEN') return true;
      if (current.status === 'GREEN' && cand.status !== 'GREEN') return false;

      const candKg = cand.realFulfilledKg ?? cand.totalPlannedKg;
      const currKg = current.realFulfilledKg ?? current.totalPlannedKg;
      const candDia = cand.candidates[0]?.jumboDiameterMm || 0;
      const currDia = current.candidates[0]?.jumboDiameterMm || 0;
      const candMult = cand.candidates[0]?.packageMultiple || 1;
      const currMult = current.candidates[0]?.packageMultiple || 1;

      // Near-max diameter FIRST (factory rule): larger package / OD wins unless kg is much worse (>25%)
      const maxKg = Math.max(candKg, currKg, 0.01);
      if (candMult !== currMult) {
        const kgRatio = candKg / maxKg;
        const otherRatio = currKg / maxKg;
        // Prefer higher multiple unless it delivers <75% of the other's fulfilled kg
        if (candMult > currMult && kgRatio >= 0.75 * otherRatio) return true;
        if (currMult > candMult && otherRatio >= 0.75 * kgRatio) return false;
      }
      if (Math.abs(candDia - currDia) > 20) {
        if (candDia > currDia && candKg >= 0.75 * currKg) return true;
        if (currDia > candDia && currKg >= 0.75 * candKg) return false;
      }

      // Then maximum REAL customer-fulfilled kg
      const kgDiff = candKg - currKg;
      if (Math.abs(kgDiff) > 0.01) {
        return kgDiff > 0;
      }

      // More closed customer orders
      if (cand.closedCount !== current.closedCount) {
        return cand.closedCount > current.closedCount;
      }

      // Diameter tie-break
      if (Math.abs(candDia - currDia) > 1) {
        return candDia > currDia;
      }

      // 3b. Campaign Setup Continuity (reusing active jumbo width saves full PS01 changeover)
      if (activeCampaignJumboWidth !== null) {
        const candMatchesActive = cand.jumboWidths.includes(activeCampaignJumboWidth);
        const currMatchesActive = current.jumboWidths.includes(activeCampaignJumboWidth);
        if (candMatchesActive !== currMatchesActive) {
          return candMatchesActive;
        }
      }

      // 4. Lower unnecessary MSL plan/setup burden
      const candSetups = new Set(cand.jumboWidths).size;
      const currSetups = new Set(current.jumboWidths).size;
      if (candSetups !== currSetups) {
        return candSetups < currSetups;
      }

      // 5. Better trim
      if (Math.abs(cand.ps01Trim - current.ps01Trim) > 1) {
        return cand.ps01Trim < current.ps01Trim;
      }

      // 6. Existing heuristic score as final tie-breaker
      return cand.score > current.score;
    };

    // Two-Phase Search Engine:
    // Phase 1: Strict Full-Length First (Multipliers >= 2x, ~1200-1250mm OD). Any odd 1x remainder is ejected back to the pool.
    // Phase 2: If no full-length pack can be formed across all active balance orders, allow a single tail set (1x remainder relaxation).
    const runSearchPass = (allowTailMultiples: boolean) => {
      for (const fam of lengthFamilies) {
        const maxMultipleInFam = Math.max(...fam.validMultiples.map(v => v.multiple));
        const maxDiaInFam = Math.max(...fam.validMultiples.map(v => v.diameter_mm));
        // Near-max diameter band: ≥88% of family max OD (or top multiple / top-1)
        const nearMaxMultiples = fam.validMultiples.filter(v => {
          if (maxMultipleInFam <= 1) return true;
          if (v.multiple >= maxMultipleInFam - 1) return true;
          if (v.diameter_mm >= maxDiaInFam * 0.88) return true;
          return false;
        });
        const multiplesToScan = allowTailMultiples
          ? fam.validMultiples
          : (nearMaxMultiples.length ? nearMaxMultiples : fam.validMultiples);

        for (const vm of multiplesToScan) {
          const isTail = maxMultipleInFam > 1 && vm.multiple === 1;
          if (isTail && !allowTailMultiples) continue;
          // Phase 1: skip non-near-max mid tiers entirely
          if (!allowTailMultiples && maxMultipleInFam > 1) {
            const isNearMax =
              vm.multiple >= maxMultipleInFam - 1 ||
              vm.diameter_mm >= maxDiaInFam * 0.88;
            if (!isNearMax) continue;
          }
          // Phase 2 (tail mode): prefer scanning mid/low only after near-max already failed outer pass
          if (allowTailMultiples && !isTail) {
            // still allow mid multiples in phase 2 only if they are the remaining option
            // (near-max already tried in phase 1)
          }

          let best3UpsWinningSet: WinningSetResult | null = null;
          let best4UpsWinningSet: WinningSetResult | null = null;

          const candidatesForMult = candidatePool.filter(
            c => c.familyId === fam.familyId && c.packageMultiple === vm.multiple && c.jumboLengthM === vm.length_m
          );
          if (candidatesForMult.length === 0) continue;

        // Precompute cuts capacity and weight per cut for active demand slots under this package multiple
        // Slot-level discrete reel capacity pooling:
        // Accumulate spare reels per slot across ALL active orders of this slot,
        // allowing companion orders of the same width & length to collectively absorb a multiple!
        const spareReelsPerSlot = new Array<number>(numDemandSlots).fill(0);
        for (const tr of activeTrackers) {
          const spareKg = tr.maxAllowedKg - tr.allocatedKg;
          if (spareKg <= 0.01) continue;
          const weightPerReel = weightKg(tr.order.width_mm, tr.pkgLength);
          spareReelsPerSlot[tr.slotIdx] += Math.floor((spareKg + 0.01) / weightPerReel);
        }

        const capacity = new Array<number>(numDemandSlots).fill(0);
        const weightPerCut = new Array<number>(numDemandSlots).fill(0);

        for (let s = 0; s < numDemandSlots; s++) {
          const slotDef = demandSlots[s];
          if (!slotDef) continue;
          const reelsPerCut = Math.max(1, Math.round(vm.length_m / slotDef.length_m));
          capacity[s] = Math.floor(spareReelsPerSlot[s] / reelsPerCut);
          const weightPerReel = weightKg(slotDef.width_mm, slotDef.length_m);
          weightPerCut[s] = weightPerReel * reelsPerCut;
        }

        // Filter to viable candidates whose required cuts do not exceed current remaining capacity
        const viableCandidates = candidatesForMult.filter(c => {
          const cCuts = c.cuts;
          for (let a = 0; a < c.activeIndices.length; a++) {
            const s = c.activeIndices[a];
            if (capacity[s] < cCuts[s]) return false;
          }
          return true;
        });
        if (viableCandidates.length === 0) continue;

        // Group viable candidates by width bucket for O(1) indexed lookup
        const candidatesByWidth = new Map<number, MS1JumboCandidate[]>();
      for (const c of viableCandidates) {
        let list = candidatesByWidth.get(c.jumboWidth);
        if (!list) {
          list = [];
          candidatesByWidth.set(c.jumboWidth, list);
        }
        list.push(c);
      }

      // Sort and prune candidates within each width bucket with multi-dimensional diversity retention
      // Retain high yield/volume, maximum diameter, closing patterns, priority orders, and diverse 1-6 UPS
      for (const [width, list] of candidatesByWidth.entries()) {
        const calculateYield = (cand: MS1JumboCandidate) => {
          let y = 0;
          for (let ai = 0; ai < cand.activeIndices.length; ai++) {
            const s = cand.activeIndices[ai];
            y += cand.cuts[s] * weightPerCut[s];
          }
          return y;
        };

        list.sort((a, b) => {
          const yieldA = calculateYield(a);
          const yieldB = calculateYield(b);
          return (b.packageMultiple - a.packageMultiple) || (b.jumboDiameterMm - a.jumboDiameterMm) || (yieldB - yieldA) || (a.mslTrim - b.mslTrim);
        });

        if (list.length > 32) {
          const retained = new Set<MS1JumboCandidate>();
          // 1. Top 8 by standard yield & multiple
          for (let i = 0; i < Math.min(8, list.length); i++) {
            retained.add(list[i]);
          }
          // 2. Diversity retention across UPS levels (1 to 6 UPS) - up to 2 per UPS level
          const upsCounts = new Map<number, number>();
          for (const cand of list) {
            const count = upsCounts.get(cand.combo.ups) || 0;
            if (count < 2) {
              upsCounts.set(cand.combo.ups, count + 1);
              retained.add(cand);
            }
          }
          // 3. Dedicated Duplex retention: reserve up to 4 distinct duplex candidates
          const duplexCands = list.filter(c => c.cutsList.length > 1 && new Set(c.cutsList.map(x => x.length_m)).size > 1);
          for (let i = 0; i < Math.min(4, duplexCands.length); i++) {
            retained.add(duplexCands[i]);
          }
          // 4. Top candidates with target trim (~25mm)
          const sortedByTrimTarget = list.slice().sort((a, b) => Math.abs(a.mslTrim - 25) - Math.abs(b.mslTrim - 25));
          for (let i = 0; i < Math.min(4, sortedByTrimTarget.length); i++) {
            retained.add(sortedByTrimTarget[i]);
          }
          // 5. Fill remaining slots up to 32 from original sorted list
          for (const cand of list) {
            if (retained.size >= 32) break;
            retained.add(cand);
          }
          candidatesByWidth.set(width, Array.from(retained));
        }
      }

      // ORDER-AWARE CANDIDATE RETENTION:
      // Guarantee that EVERY active customer order has width representation in candidatesByWidth
      // 3-UPS priority: protect best wide candidate (> 2600mm) first; only fall back to narrow (<= 2600mm) if no wide candidate exists
      const protectedWidths = new Set<number>();
      for (const tr of activeTrackers) {
        if (tr.remainingKg <= 0.01) continue;
        const s = tr.slotIdx;
        let bestWideScore = -Infinity;
        let bestWideW: number | null = null;
        let bestNarrowScore = -Infinity;
        let bestNarrowW: number | null = null;

        for (const [w, cList] of candidatesByWidth.entries()) {
          for (const cand of cList) {
            if (cand.cuts[s] > 0) {
              const score = cand.packageMultiple * 10000 + cand.jumboDiameterMm - Math.abs(cand.mslTrim - 25) * 10;
              if (w > 2600) {
                if (score > bestWideScore) {
                  bestWideScore = score;
                  bestWideW = w;
                }
              } else {
                if (score > bestNarrowScore) {
                  bestNarrowScore = score;
                  bestNarrowW = w;
                }
              }
            }
          }
        }
        if (bestWideW !== null) {
          protectedWidths.add(bestWideW);
        } else if (bestNarrowW !== null) {
          protectedWidths.add(bestNarrowW);
        }
      }

      // Bound candidate width buckets with guaranteed order representation
      // and tiered retention across 3-UPS (> 2600mm) and 4-UPS (<= 2600mm) candidates
      let widthEntriesList = Array.from(candidatesByWidth.entries());
      if (widthEntriesList.length > 128) {
        const calculateEntryYield = (entry: [number, MS1JumboCandidate[]]) => {
          let y = 0;
          const cand = entry[1][0];
          if (cand) {
            for (let ai = 0; ai < cand.activeIndices.length; ai++) {
              y += cand.cuts[cand.activeIndices[ai]] * weightPerCut[cand.activeIndices[ai]];
            }
          }
          return y;
        };

        const narrowEntries = widthEntriesList.filter(e => e[0] <= 2600);
        const wideEntries = widthEntriesList.filter(e => e[0] > 2600);

        narrowEntries.sort((a, b) => {
          const isProtA = protectedWidths.has(a[0]) ? 1 : 0;
          const isProtB = protectedWidths.has(b[0]) ? 1 : 0;
          if (isProtA !== isProtB) return isProtB - isProtA;
          return calculateEntryYield(b) - calculateEntryYield(a);
        });

        wideEntries.sort((a, b) => {
          const isProtA = protectedWidths.has(a[0]) ? 1 : 0;
          const isProtB = protectedWidths.has(b[0]) ? 1 : 0;
          if (isProtA !== isProtB) return isProtB - isProtA;
          return calculateEntryYield(b) - calculateEntryYield(a);
        });

        const topNarrow = new Set(narrowEntries.slice(0, 64).map(e => e[0]));
        const topWide = new Set(wideEntries.slice(0, 80).map(e => e[0]));

        for (const w of Array.from(candidatesByWidth.keys())) {
          if (!topNarrow.has(w) && !topWide.has(w) && !protectedWidths.has(w)) {
            candidatesByWidth.delete(w);
          }
        }
      }

      const uniqueWidths = Array.from(candidatesByWidth.keys()).sort((a, b) => a - b);
      const numUniqueWidths = uniqueWidths.length;

      // 1. PRIORITY #1: PURE SINGLE-CANDIDATE 3-UPS & 4-UPS PACKS (High Volume Pure Runs with 0 Surplus)
      const searchPurePacks = (minTrimAllowed: number, maxTrimAllowed: number) => {
        // Floor at plant RED boundary: PS01 trim may never go below 150 mm
        minTrimAllowed = Math.max(150, minTrimAllowed);
        maxTrimAllowed = Math.min(500, maxTrimAllowed);
        for (const cand of viableCandidates) {
          // Check 3-UPS Pure Pack (3 x candidate)
          const totalWeb3 = cand.jumboWidth * 3;
          const trim3 = motherDeckle - totalWeb3;
          if (trim3 >= minTrimAllowed && trim3 <= maxTrimAllowed && trim3 >= 150 && trim3 <= 500) {
            const status3: 'GREEN' | 'YELLOW' = (trim3 >= 150 && trim3 <= 280) ? 'GREEN' : 'YELLOW';
            let maxCycles3 = Infinity;
            let canForm3 = true;
            let cyclePlannedKgPerRun3 = 0;

            for (let a = 0; a < cand.activeIndices.length; a++) {
              const s = cand.activeIndices[a];
              const needed = cand.cuts[s] * 3;
              if (needed === 0) continue;
              const cap = capacity[s];
              if (cap < needed) {
                canForm3 = false;
                break;
              }
              const cycles = Math.floor(cap / needed);
              if (cycles < maxCycles3) maxCycles3 = cycles;
              cyclePlannedKgPerRun3 += weightPerCut[s] * needed;
            }

            // Candidate set must contain at least one unfinished driver (> 0.01 kg)
            let hasUnfinishedDriver3 = false;
            for (let a = 0; a < cand.activeIndices.length; a++) {
              const tr = trackerBySlot[cand.activeIndices[a]];
              if (tr && tr.remainingKg > 0.01) {
                hasUnfinishedDriver3 = true;
                break;
              }
            }
            if (!hasUnfinishedDriver3) canForm3 = false;

            if (canForm3 && maxCycles3 >= 1) {
              const repeatCycles = maxCycles3;
              const cyclePlannedKg = cyclePlannedKgPerRun3 * repeatCycles;
              const mslTrimKg = ((cand.mslTrim / cand.jumboWidth) * cand.singleJumboWeightKg * 3) * repeatCycles;
              const ps01TrimKgBase = weightKg(trim3, cand.jumboLengthM);
              const totalTrimKg = mslTrimKg + (ps01TrimKgBase * repeatCycles);

              let score = status3 === 'GREEN' ? 1000000 : 50000;
              score += cyclePlannedKg * 26;
              score += 150000; // Bonus for 3-UPS pure pack (0 setup changes, max throughput)
              if (repeatCycles >= 3) score += 75000; // High-volume sustained pure pack bonus
              if (new Set(cand.combo.widths).size === 1) score += 75000; // Single-width repeat bonus (zero knife shift)
              if (cand.jumboDiameterMm < 900) score -= 350000; // penalize small-OD jumbos
              else if (cand.jumboDiameterMm < 1050) score -= 120000;
              score += Math.max(0, (500 - trim3) * 50); // Trim tightness bonus
              score += cand.packageMultiple * 200000;
              score += (cand.jumboDiameterMm / 1250) * 400000; // Hard near-max diameter (~1250mm) bias
              score += repeatCycles * 3000;
              const wastePct = totalTrimKg > 0 ? (totalTrimKg / (cyclePlannedKg + totalTrimKg)) * 100 : 0;
              score -= wastePct * 100;

              // Order closure bonus: reward patterns that cleanly close companion orders (remainingKg <= 0.01)
              let closedCount3 = 0;
              let realFulfilledKg3 = 0;
              let priorityKg3 = 0;
              let priorityClosed3 = 0;
              for (let a = 0; a < cand.activeIndices.length; a++) {
                const s = cand.activeIndices[a];
                const tr = trackerBySlot[s];
                if (tr) {
                  const cutKg = cand.cuts[s] * 3 * repeatCycles * weightPerCut[s];
                  realFulfilledKg3 += Math.min(tr.remainingKg, cutKg);
                  if (tr.remainingKg - cutKg <= 0.01) {
                    closedCount3++;
                  }
                  if (tr.order.priority && prioritySlotSet.has(s)) {
                    priorityKg3 += Math.min(tr.remainingKg, cutKg);
                    if (tr.remainingKg - cutKg <= 0.01) priorityClosed3++;
                  }
                }
              }
              // Skip patterns that ignore starred residual while priority mode is on
              if (strictPriorityMode && priorityKg3 < 0.01) continue;
              score += closedCount3 * 35000;
              score += priorityKg3 * 500000;
              score += priorityClosed3 * 5000000;

              // Campaign Setup Continuity Bonus: reusing active jumbo width saves full PS01 changeover (+120,000)
              if (activeCampaignJumboWidth !== null && cand.jumboWidth === activeCampaignJumboWidth) {
                score += 120000;
              }
              // MSL Knife Setup Preservation (+80,000 identical, +40,000 1-shift)
              if (activeCampaignSlitWidths.length > 0) {
                const matchCount = cand.combo.widths.filter(w => activeCampaignSlitWidths.includes(w)).length;
                if (matchCount === cand.combo.widths.length) score += 80000;
                else if (matchCount >= cand.combo.widths.length - 1) score += 40000;
              }

              const pure3Set: WinningSetResult = {
                candidates: [cand, cand, cand],
                ps01Ups: 3,
                jumboWidths: [cand.jumboWidth, cand.jumboWidth, cand.jumboWidth],
                totalWeb: totalWeb3,
                ps01Trim: trim3,
                status: status3,
                repeatCycles,
                totalPlannedKg: cyclePlannedKg,
                realFulfilledKg: realFulfilledKg3,
                totalTrimKg,
                closedCount: closedCount3,
                score,
                priorityKg: priorityKg3,
                priorityClosed: priorityClosed3,
              } as WinningSetResult;
              if (isBetter3UpsCandidate(pure3Set, best3UpsWinningSet)) {
                best3UpsWinningSet = pure3Set;
              }
            }
          }

          // Check 4-UPS Pure Pack — only when planner enabled allow_4_ups
          if (allow4Ups) {
          const totalWeb4 = cand.jumboWidth * 4;
          const trim4 = motherDeckle - totalWeb4;
          if (trim4 >= minTrimAllowed && trim4 <= maxTrimAllowed && trim4 >= 150 && trim4 <= 500) {
            const status4: 'GREEN' | 'YELLOW' = (trim4 >= 150 && trim4 <= 280) ? 'GREEN' : 'YELLOW';
            let maxCycles4 = Infinity;
            let canForm4 = true;
            let cyclePlannedKgPerRun4 = 0;

            for (let a = 0; a < cand.activeIndices.length; a++) {
              const s = cand.activeIndices[a];
              const needed = cand.cuts[s] * 4;
              if (needed === 0) continue;
              const cap = capacity[s];
              if (cap < needed) {
                canForm4 = false;
                break;
              }
              const cycles = Math.floor(cap / needed);
              if (cycles < maxCycles4) maxCycles4 = cycles;
              cyclePlannedKgPerRun4 += weightPerCut[s] * needed;
            }

            // Candidate set must contain at least one unfinished driver (> 0.01 kg)
            let hasUnfinishedDriver4 = false;
            for (let a = 0; a < cand.activeIndices.length; a++) {
              const tr = trackerBySlot[cand.activeIndices[a]];
              if (tr && tr.remainingKg > 0.01) {
                hasUnfinishedDriver4 = true;
                break;
              }
            }
            if (!hasUnfinishedDriver4) canForm4 = false;

            if (canForm4 && maxCycles4 >= 1) {
              const repeatCycles = maxCycles4;
              const cyclePlannedKg = cyclePlannedKgPerRun4 * repeatCycles;
              const mslTrimKg = ((cand.mslTrim / cand.jumboWidth) * cand.singleJumboWeightKg) * 4 * repeatCycles;
              const ps01TrimKgBase = weightKg(trim4, cand.jumboLengthM);
              const totalTrimKg = mslTrimKg + (ps01TrimKgBase * repeatCycles);

              let score = status4 === 'GREEN' ? 500000 : 25000;
              score += cyclePlannedKg * 22;
              score += 40000; // 4-UPS pure pack bonus
              if (repeatCycles >= 3) score += 50000; // High-volume sustained pure pack bonus
              if (new Set(cand.combo.widths).size === 1) score += 50000; // Single-width repeat bonus (zero knife shift)
              score += Math.max(0, (500 - trim4) * 50); // Trim tightness bonus
              score += cand.packageMultiple * 200000;
              score += (cand.jumboDiameterMm / 1250) * 400000; // Hard near-max diameter (~1250mm) bias
              score += repeatCycles * 3000;
              const wastePct = totalTrimKg > 0 ? (totalTrimKg / (cyclePlannedKg + totalTrimKg)) * 100 : 0;
              score -= wastePct * 100;

              // Order closure bonus: reward patterns that cleanly close companion orders (remainingKg <= 0.01)
              let closedCount4 = 0;
              let realFulfilledKg4 = 0;
              let priorityKg4 = 0;
              let priorityClosed4 = 0;
              for (let a = 0; a < cand.activeIndices.length; a++) {
                const s = cand.activeIndices[a];
                const tr = trackerBySlot[s];
                if (tr) {
                  const cutKg = cand.cuts[s] * 4 * repeatCycles * weightPerCut[s];
                  realFulfilledKg4 += Math.min(tr.remainingKg, cutKg);
                  if (tr.remainingKg - cutKg <= 0.01) {
                    closedCount4++;
                  }
                  if (tr.order.priority && prioritySlotSet.has(s)) {
                    priorityKg4 += Math.min(tr.remainingKg, cutKg);
                    if (tr.remainingKg - cutKg <= 0.01) priorityClosed4++;
                  }
                }
              }
              if (strictPriorityMode && priorityKg4 < 0.01) continue;
              score += closedCount4 * 20000;
              score += priorityKg4 * 500000;
              score += priorityClosed4 * 5000000;

              // Campaign Setup Continuity Bonus for 4-UPS
              if (activeCampaignJumboWidth !== null && cand.jumboWidth === activeCampaignJumboWidth) {
                score += 120000;
              }
              if (activeCampaignSlitWidths.length > 0) {
                const matchCount = cand.combo.widths.filter(w => activeCampaignSlitWidths.includes(w)).length;
                if (matchCount === cand.combo.widths.length) score += 80000;
                else if (matchCount >= cand.combo.widths.length - 1) score += 40000;
              }

              const pure4Set: WinningSetResult = {
                candidates: [cand, cand, cand, cand],
                ps01Ups: 4,
                jumboWidths: [cand.jumboWidth, cand.jumboWidth, cand.jumboWidth, cand.jumboWidth],
                totalWeb: totalWeb4,
                ps01Trim: trim4,
                status: status4,
                repeatCycles,
                totalPlannedKg: cyclePlannedKg,
                realFulfilledKg: realFulfilledKg4,
                totalTrimKg,
                closedCount: closedCount4,
                score,
                priorityKg: priorityKg4,
                priorityClosed: priorityClosed4,
              } as WinningSetResult;
              if (isBetter4UpsCandidate(pure4Set, best4UpsWinningSet)) {
                best4UpsWinningSet = pure4Set;
              }
            }
          }
          } // end allow4Ups pure 4-UPS
        }
      };

      // 2. PRIORITY #2: MULTI-ORDER SYNCHRONIZED TRIPLETS SEARCH
      const searchTriplets = (minTrimAllowed: number, maxTrimAllowed: number) => {
        minTrimAllowed = Math.max(150, minTrimAllowed);
        maxTrimAllowed = Math.min(500, maxTrimAllowed);

        for (let i = 0; i < numUniqueWidths; i++) {
          const w1 = uniqueWidths[i];
          const list1 = candidatesByWidth.get(w1)!;

          for (let j = i; j < numUniqueWidths; j++) {
            const w2 = uniqueWidths[j];
            const list2 = candidatesByWidth.get(w2)!;

            const minW3 = Math.max(w2, motherDeckle - w1 - w2 - maxTrimAllowed);
            const maxW3 = Math.min(settings.max_jumbo_width_mm, motherDeckle - w1 - w2 - minTrimAllowed);
            if (minW3 > maxW3) continue;

            const startK = binarySearchLower(uniqueWidths, minW3, j, numUniqueWidths - 1);
            const endK = binarySearchUpper(uniqueWidths, maxW3, j, numUniqueWidths - 1);
            if (startK > endK) continue;

            for (let k = startK; k <= endK; k++) {
              const w3 = uniqueWidths[k];
              const totalWeb = w1 + w2 + w3;
              const ps01Trim = motherDeckle - totalWeb;
              if (ps01Trim < 150 || ps01Trim > 500) continue;

              const status: 'GREEN' | 'YELLOW' = (ps01Trim >= 150 && ps01Trim <= 280) ? 'GREEN' : 'YELLOW';
              const baseStatusScore = status === 'GREEN' ? 1000000 : 40000;
              const uniqueWidthsCount = (w1 === w2 && w2 === w3) ? 1 : (w1 === w2 || w2 === w3 || w1 === w3) ? 2 : 3;
              const setupPenalty = (uniqueWidthsCount - 1) * 300;
              const ps01TrimKgBase = weightKg(ps01Trim, list1[0].jumboLengthM);

              const list3 = candidatesByWidth.get(w3)!;

              for (let idx1 = 0; idx1 < list1.length; idx1++) {
                const c1 = list1[idx1];
                const cuts1 = c1.cuts;
                const start2 = (w1 === w2) ? idx1 : 0;

                for (let idx2 = start2; idx2 < list2.length; idx2++) {
                  const c2 = list2[idx2];
                  const cuts2 = c2.cuts;
                  const start3 = (w2 === w3) ? idx2 : 0;

                  // Pair capacity feasibility filter
                  let pairPossible = true;
                  for (let a = 0; a < c1.activeIndices.length; a++) {
                    const s = c1.activeIndices[a];
                    if (cuts1[s] + cuts2[s] > capacity[s]) {
                      pairPossible = false;
                      break;
                    }
                  }
                  if (!pairPossible) continue;
                  for (let a = 0; a < c2.activeIndices.length; a++) {
                    const s = c2.activeIndices[a];
                    if (cuts1[s] + cuts2[s] > capacity[s]) {
                      pairPossible = false;
                      break;
                    }
                  }
                  if (!pairPossible) continue;

                  for (let idx3 = start3; idx3 < list3.length; idx3++) {
                    const c3 = list3[idx3];
                    const cuts3 = c3.cuts;

                    let maxAllowedCycles = Infinity;
                    let canSatisfyAllCuts = true;

                    // Direct check over candidate slots
                    for (let a = 0; a < c1.activeIndices.length; a++) {
                      const w = c1.activeIndices[a];
                      const needed = cuts1[w] + cuts2[w] + cuts3[w];
                      const cap = capacity[w];
                      if (cap < needed) {
                        canSatisfyAllCuts = false;
                        break;
                      }
                      const cycles = Math.floor(cap / needed);
                      if (cycles < maxAllowedCycles) maxAllowedCycles = cycles;
                    }
                    if (!canSatisfyAllCuts) continue;

                    for (let a = 0; a < c2.activeIndices.length; a++) {
                      const w = c2.activeIndices[a];
                      if (cuts1[w] > 0) continue; // Already checked
                      const needed = cuts2[w] + cuts3[w];
                      const cap = capacity[w];
                      if (cap < needed) {
                        canSatisfyAllCuts = false;
                        break;
                      }
                      const cycles = Math.floor(cap / needed);
                      if (cycles < maxAllowedCycles) maxAllowedCycles = cycles;
                    }
                    if (!canSatisfyAllCuts) continue;

                    for (let a = 0; a < c3.activeIndices.length; a++) {
                      const w = c3.activeIndices[a];
                      if (cuts1[w] > 0 || cuts2[w] > 0) continue; // Already checked
                      const needed = cuts3[w];
                      const cap = capacity[w];
                      if (cap < needed) {
                        canSatisfyAllCuts = false;
                        break;
                      }
                      const cycles = Math.floor(cap / needed);
                      if (cycles < maxAllowedCycles) maxAllowedCycles = cycles;
                    }
                    if (!canSatisfyAllCuts || maxAllowedCycles < 1) continue;

                    // Candidate triplet must contain at least one unfinished driver (> 0.01 kg)
                    let hasUnfinishedDriverTrip = false;
                    for (let a = 0; a < c1.activeIndices.length; a++) {
                      const tr = trackerBySlot[c1.activeIndices[a]];
                      if (tr && tr.remainingKg > 0.01) {
                        hasUnfinishedDriverTrip = true; break;
                      }
                    }
                    if (!hasUnfinishedDriverTrip) {
                      for (let a = 0; a < c2.activeIndices.length; a++) {
                        const tr = trackerBySlot[c2.activeIndices[a]];
                        if (tr && tr.remainingKg > 0.01) {
                          hasUnfinishedDriverTrip = true; break;
                        }
                      }
                    }
                    if (!hasUnfinishedDriverTrip) {
                      for (let a = 0; a < c3.activeIndices.length; a++) {
                        const tr = trackerBySlot[c3.activeIndices[a]];
                        if (tr && tr.remainingKg > 0.01) {
                          hasUnfinishedDriverTrip = true; break;
                        }
                      }
                    }
                    if (!hasUnfinishedDriverTrip) continue; // Reject standalone triplet tail run

                    // Compute cyclePlannedKgPerRun once
                    let cyclePlannedKgPerRun = 0;
                    for (let a = 0; a < c1.activeIndices.length; a++) {
                      const w = c1.activeIndices[a];
                      cyclePlannedKgPerRun += weightPerCut[w] * (cuts1[w] + cuts2[w] + cuts3[w]);
                    }
                    for (let a = 0; a < c2.activeIndices.length; a++) {
                      const w = c2.activeIndices[a];
                      if (cuts1[w] === 0) cyclePlannedKgPerRun += weightPerCut[w] * (cuts2[w] + cuts3[w]);
                    }
                    for (let a = 0; a < c3.activeIndices.length; a++) {
                      const w = c3.activeIndices[a];
                      if (cuts1[w] === 0 && cuts2[w] === 0) cyclePlannedKgPerRun += weightPerCut[w] * cuts3[w];
                    }

                    const repeatCycles = maxAllowedCycles;
                    const cyclePlannedKg = cyclePlannedKgPerRun * repeatCycles;

                    const mslTrimKg = ((c1.mslTrim / c1.jumboWidth) * c1.singleJumboWeightKg +
                      (c2.mslTrim / c2.jumboWidth) * c2.singleJumboWeightKg +
                      (c3.mslTrim / c3.jumboWidth) * c3.singleJumboWeightKg) * repeatCycles;
                    const ps01TrimKg = ps01TrimKgBase * repeatCycles;
                    const totalTrimKg = mslTrimKg + ps01TrimKg;

                    let score = 0;
                    score += baseStatusScore;
                    score += cyclePlannedKg * 25;
                    score += 100000; // 3-UPS operational preference bonus
                    score += Math.max(0, (500 - ps01Trim) * 50); // Trim tightness bonus
                    score += c1.packageMultiple * 50000;
                    score += (c1.jumboDiameterMm / 1250) * 100000; // Target diameter (~1250mm) bonus
                    score += repeatCycles * 2500;
                    const wastePct = totalTrimKg > 0 ? (totalTrimKg / (cyclePlannedKg + totalTrimKg)) * 100 : 0;
                    score -= wastePct * 100;
                    score -= setupPenalty;

                    // Duplex companion order satisfaction bonus
                    const duplexCount = [c1, c2, c3].filter(c => new Set(c.cutsList.map(x => x.length_m)).size > 1).length;
                    score += duplexCount * 10000;

                    // Order closure bonus: reward patterns that cleanly close companion orders (remainingKg <= 0.01)
                    let closedCountTrip = 0;
                    let realFulfilledKgTrip = 0;
                    for (let a = 0; a < c1.activeIndices.length; a++) {
                      const s = c1.activeIndices[a];
                      const tr = trackerBySlot[s];
                      if (tr) {
                        const cutKg = (cuts1[s] + cuts2[s] + cuts3[s]) * repeatCycles * weightPerCut[s];
                        realFulfilledKgTrip += Math.min(tr.remainingKg, cutKg);
                        if (tr.remainingKg - cutKg <= 0.01) {
                          closedCountTrip++;
                        }
                      }
                    }
                    score += closedCountTrip * 25000;

                    // Campaign Setup Continuity Bonus for Triplet 3-UPS
                    if (activeCampaignJumboWidth !== null && [w1, w2, w3].includes(activeCampaignJumboWidth)) {
                      score += 120000;
                    }
                    if (activeCampaignSlitWidths.length > 0) {
                      const matchCount = c1.combo.widths.filter(w => activeCampaignSlitWidths.includes(w)).length;
                      if (matchCount === c1.combo.widths.length) score += 80000;
                      else if (matchCount >= c1.combo.widths.length - 1) score += 40000;
                    }

                    const triplet3Set: WinningSetResult = {
                      candidates: [c1, c2, c3],
                      ps01Ups: 3,
                      jumboWidths: [w1, w2, w3],
                      totalWeb,
                      ps01Trim,
                      status,
                      repeatCycles,
                      totalPlannedKg: cyclePlannedKg,
                      realFulfilledKg: realFulfilledKgTrip,
                      totalTrimKg,
                      closedCount: closedCountTrip,
                      score,
                    };
                    if (isBetter3UpsCandidate(triplet3Set, best3UpsWinningSet)) {
                      best3UpsWinningSet = triplet3Set;
                    }
                  }
                }
              }
            }
          }
        }
      };

      // 3. 4-UPS MEET-IN-THE-MIDDLE PAIR SEARCH (First-Class 4-Roll Pack Generation)
      const search4UpsPairs = (minTrimAllowed: number, maxTrimAllowed: number) => {
        minTrimAllowed = Math.max(150, minTrimAllowed);
        maxTrimAllowed = Math.min(500, maxTrimAllowed);

        if (uniqueWidths.length === 0 || uniqueWidths[0] * 4 > motherDeckle - 150) return;

        interface CandidatePair {
          c1: MS1JumboCandidate;
          c2: MS1JumboCandidate;
          w1: number;
          w2: number;
          pairSum: number;
          combinedCuts: number[];
          activeIndices: number[];
          kgPerRun: number;
          mslTrimKgPerRun: number;
        }

        const minW = uniqueWidths[0];
        const maxW = uniqueWidths[numUniqueWidths - 1];
        const minPossiblePairSum = Math.max(minW * 2, 9900 - maxW * 2);
        const maxPossiblePairSum = Math.min(maxW * 2, 10280 - minW * 2);

        // Build valid pairs (c1, c2) with w1 <= w2
        const pairsBySum = new Map<number, CandidatePair[]>();

        for (let i = 0; i < numUniqueWidths; i++) {
          const w1 = uniqueWidths[i];
          const list1 = candidatesByWidth.get(w1)!;

          for (let j = i; j < numUniqueWidths; j++) {
            const w2 = uniqueWidths[j];
            const pairSum = w1 + w2;
            if (pairSum < minPossiblePairSum || pairSum > maxPossiblePairSum) continue;

            const existingList = pairsBySum.get(pairSum);
            if (existingList && existingList.length >= 10) continue;

            const list2 = candidatesByWidth.get(w2)!;

            for (let idx1 = 0; idx1 < list1.length; idx1++) {
              const c1 = list1[idx1];
              const cuts1 = c1.cuts;
              const start2 = (w1 === w2) ? idx1 : 0;

              for (let idx2 = start2; idx2 < list2.length; idx2++) {
                const curList = pairsBySum.get(pairSum);
                if (curList && curList.length >= 10) break;

                const c2 = list2[idx2];
                const cuts2 = c2.cuts;

                // Zero-allocation feasibility check
                let pairFeasible = true;
                for (let a = 0; a < c1.activeIndices.length; a++) {
                  const s = c1.activeIndices[a];
                  if (cuts1[s] + cuts2[s] > capacity[s]) {
                    pairFeasible = false;
                    break;
                  }
                }
                if (pairFeasible) {
                  for (let a = 0; a < c2.activeIndices.length; a++) {
                    const s = c2.activeIndices[a];
                    if (cuts1[s] > 0) continue; // Already checked
                    if (cuts2[s] > capacity[s]) {
                      pairFeasible = false;
                      break;
                    }
                  }
                }
                if (!pairFeasible) continue;

                // Feasible: construct combined cuts and active indices
                const combinedCuts = new Array<number>(numDemandSlots).fill(0);
                const activeIndices: number[] = [];
                let kgPerRun = 0;

                for (let a = 0; a < c1.activeIndices.length; a++) {
                  const s = c1.activeIndices[a];
                  const needed = cuts1[s] + cuts2[s];
                  combinedCuts[s] = needed;
                  activeIndices.push(s);
                  kgPerRun += weightPerCut[s] * needed;
                }
                for (let a = 0; a < c2.activeIndices.length; a++) {
                  const s = c2.activeIndices[a];
                  if (cuts1[s] > 0) continue;
                  const needed = cuts2[s];
                  combinedCuts[s] = needed;
                  activeIndices.push(s);
                  kgPerRun += weightPerCut[s] * needed;
                }

                const mslTrimKgPerRun = (c1.mslTrim / c1.jumboWidth) * c1.singleJumboWeightKg +
                  (c2.mslTrim / c2.jumboWidth) * c2.singleJumboWeightKg;

                const pair: CandidatePair = {
                  c1,
                  c2,
                  w1,
                  w2,
                  pairSum,
                  combinedCuts,
                  activeIndices,
                  kgPerRun,
                  mslTrimKgPerRun,
                };

                let list = pairsBySum.get(pairSum);
                if (!list) {
                  list = [];
                  pairsBySum.set(pairSum, list);
                }
                list.push(pair);
              }
            }
          }
        }

        // Sort unique pair sums
        const uniquePairSums = Array.from(pairsBySum.keys()).sort((a, b) => a - b);
        const numPairSums = uniquePairSums.length;

        for (let pAIdx = 0; pAIdx < numPairSums; pAIdx++) {
          const sumA = uniquePairSums[pAIdx];
          const pairsA = pairsBySum.get(sumA)!;

          const minSumB = Math.max(sumA, motherDeckle - sumA - maxTrimAllowed);
          const maxSumB = motherDeckle - sumA - minTrimAllowed;
          if (minSumB > maxSumB) continue;

          const startB = binarySearchLower(uniquePairSums, minSumB, pAIdx, numPairSums - 1);
          const endB = binarySearchUpper(uniquePairSums, maxSumB, pAIdx, numPairSums - 1);
          if (startB > endB) continue;

          for (let pBIdx = startB; pBIdx <= endB; pBIdx++) {
            const sumB = uniquePairSums[pBIdx];
            const pairsB = pairsBySum.get(sumB)!;

            const totalWeb = sumA + sumB;
            const ps01Trim = motherDeckle - totalWeb;
            if (ps01Trim < 150 || ps01Trim > 500) continue;

            const status: 'GREEN' | 'YELLOW' = (ps01Trim >= 150 && ps01Trim <= 280) ? 'GREEN' : 'YELLOW';
            const baseStatusScore = status === 'GREEN' ? 1000000 : 50000;
            const ps01TrimKgBase = weightKg(ps01Trim, pairsA[0].c1.jumboLengthM);

            for (let idxA = 0; idxA < pairsA.length; idxA++) {
              const pairA = pairsA[idxA];
              const startPairB = (sumA === sumB) ? idxA : 0;

              for (let idxB = startPairB; idxB < pairsB.length; idxB++) {
                const pairB = pairsB[idxB];

                // Canonical ordering: pairA.w2 <= pairB.w1 if sumA === sumB
                if (sumA === sumB && pairA.w2 > pairB.w1) continue;

                let maxAllowedCycles = Infinity;
                let canSatisfyAllCuts = true;

                // Zero-allocation combination check over active indices
                for (let a = 0; a < pairA.activeIndices.length; a++) {
                  const s = pairA.activeIndices[a];
                  const needed = pairA.combinedCuts[s] + pairB.combinedCuts[s];
                  const cap = capacity[s];
                  if (cap < needed) {
                    canSatisfyAllCuts = false;
                    break;
                  }
                  const cycles = Math.floor(cap / needed);
                  if (cycles < maxAllowedCycles) maxAllowedCycles = cycles;
                }
                if (!canSatisfyAllCuts) continue;

                for (let b = 0; b < pairB.activeIndices.length; b++) {
                  const s = pairB.activeIndices[b];
                  if (pairA.combinedCuts[s] > 0) continue; // Already checked
                  const needed = pairB.combinedCuts[s];
                  const cap = capacity[s];
                  if (cap < needed) {
                    canSatisfyAllCuts = false;
                    break;
                  }
                  const cycles = Math.floor(cap / needed);
                  if (cycles < maxAllowedCycles) maxAllowedCycles = cycles;
                }

                if (!canSatisfyAllCuts || maxAllowedCycles < 1) continue;

                // Candidate quad must contain at least one unfinished driver (> 0.01 kg)
                let hasUnfinishedDriverPair = false;
                for (let a = 0; a < pairA.activeIndices.length; a++) {
                  const tr = trackerBySlot[pairA.activeIndices[a]];
                  if (tr && tr.remainingKg > 0.01) {
                    hasUnfinishedDriverPair = true; break;
                  }
                }
                if (!hasUnfinishedDriverPair) {
                  for (let b = 0; b < pairB.activeIndices.length; b++) {
                    const tr = trackerBySlot[pairB.activeIndices[b]];
                    if (tr && tr.remainingKg > 0.01) {
                      hasUnfinishedDriverPair = true; break;
                    }
                  }
                }
                if (!hasUnfinishedDriverPair) continue; // Reject standalone quad tail run

                const repeatCycles = maxAllowedCycles;
                const cyclePlannedKgPerRun = pairA.kgPerRun + pairB.kgPerRun;
                const cyclePlannedKg = cyclePlannedKgPerRun * repeatCycles;

                const totalTrimKg = (pairA.mslTrimKgPerRun + pairB.mslTrimKgPerRun + ps01TrimKgBase) * repeatCycles;

                let score = baseStatusScore;
                score += cyclePlannedKg * 22;
                score += 40000; // 4-UPS base
                score += Math.max(0, (500 - ps01Trim) * 50); // Trim tightness bonus
                score += pairA.c1.packageMultiple * 50000;
                score += (pairA.c1.jumboDiameterMm / 1250) * 100000; // Target diameter (~1250mm) bonus
                score += repeatCycles * 2500;
                const wastePct = totalTrimKg > 0 ? (totalTrimKg / (cyclePlannedKg + totalTrimKg)) * 100 : 0;
                score -= wastePct * 100;
                const uniqueJumboCount = new Set([pairA.w1, pairA.w2, pairB.w1, pairB.w2]).size;
                score -= (uniqueJumboCount - 1) * 300; // Setup penalty for multiple jumbo sizes

                // Duplex companion order satisfaction bonus
                const duplexCount = [pairA.c1, pairA.c2, pairB.c1, pairB.c2].filter(c => new Set(c.cutsList.map(x => x.length_m)).size > 1).length;
                score += duplexCount * 8000;

                // Order closure bonus: reward patterns that cleanly close companion orders (remainingKg <= 0.01)
                let closedCount4Pair = 0;
                let realFulfilledKg4Pair = 0;
                for (let a = 0; a < pairA.activeIndices.length; a++) {
                  const s = pairA.activeIndices[a];
                  const tr = trackerBySlot[s];
                  if (tr) {
                    const cutKg = (pairA.combinedCuts[s] + pairB.combinedCuts[s]) * repeatCycles * weightPerCut[s];
                    realFulfilledKg4Pair += Math.min(tr.remainingKg, cutKg);
                    if (tr.remainingKg - cutKg <= 0.01) {
                      closedCount4Pair++;
                    }
                  }
                }
                for (let b = 0; b < pairB.activeIndices.length; b++) {
                  const s = pairB.activeIndices[b];
                  if (pairA.combinedCuts[s] > 0) continue; // Already evaluated
                  const tr = trackerBySlot[s];
                  if (tr) {
                    const cutKg = pairB.combinedCuts[s] * repeatCycles * weightPerCut[s];
                    realFulfilledKg4Pair += Math.min(tr.remainingKg, cutKg);
                    if (tr.remainingKg - cutKg <= 0.01) {
                      closedCount4Pair++;
                    }
                  }
                }
                score += closedCount4Pair * 15000;

                const pair4Set: WinningSetResult = {
                  candidates: [pairA.c1, pairA.c2, pairB.c1, pairB.c2],
                  ps01Ups: 4,
                  jumboWidths: [pairA.w1, pairA.w2, pairB.w1, pairB.w2],
                  totalWeb,
                  ps01Trim,
                  status,
                  repeatCycles,
                  totalPlannedKg: cyclePlannedKg,
                  realFulfilledKg: realFulfilledKg4Pair,
                  totalTrimKg,
                  closedCount: closedCount4Pair,
                  score,
                };
                if (isBetter4UpsCandidate(pair4Set, best4UpsWinningSet)) {
                  best4UpsWinningSet = pair4Set;
                }
              }
            }
          }
        }
      };

      // 1. PRIMARY: GREEN search — 3-UPS always; 4-UPS only if allow_4_ups
      searchPurePacks(150, 280);
      searchTriplets(150, 280);
      if (allow4Ups) search4UpsPairs(150, 280);

      // 2. YELLOW fallback only if no GREEN pack formed
      const hasGreen3Ups = best3UpsWinningSet && best3UpsWinningSet.status === 'GREEN';
      const hasGreen4Ups = allow4Ups && best4UpsWinningSet && best4UpsWinningSet.status === 'GREEN';

      if (!hasGreen3Ups && !hasGreen4Ups) {
        searchPurePacks(281, 500);
        searchTriplets(281, 500);
        if (allow4Ups) search4UpsPairs(281, 500);
      }

      // DECISION: default 3-UPS only. When allow_4_ups: 3-UPS first, 4-UPS fallback (previous logic).
      if (!allow4Ups) {
        bestWinningSet = best3UpsWinningSet;
      } else if (!best3UpsWinningSet && !best4UpsWinningSet) {
        bestWinningSet = null;
      } else if (!best3UpsWinningSet) {
        bestWinningSet = best4UpsWinningSet;
      } else if (!best4UpsWinningSet) {
        bestWinningSet = best3UpsWinningSet;
      } else {
        if (best3UpsWinningSet.status === 'GREEN' && best4UpsWinningSet.status !== 'GREEN') {
          bestWinningSet = best3UpsWinningSet;
        } else if (best4UpsWinningSet.status === 'GREEN' && best3UpsWinningSet.status !== 'GREEN') {
          bestWinningSet = best4UpsWinningSet;
        } else {
          bestWinningSet = best3UpsWinningSet;
        }
      }

        // LONGEST-PRACTICAL-LENGTH FIRST:
        // Once the longest practical legal length produces a valid customer-backed winning set,
        // commit it immediately. Do not allow shorter lengths to overwrite it based purely on cycle count.
        if (bestWinningSet) {
          return;
        }
      }
    }
  };

    // Phase 1: Search for Full-Length Multiplier packs (2x, 3x, or max diameter) first
    runSearchPass(false);

    // Phase 2: If NO full-length pack can be formed across any active balance orders, allow single tail pack (1x remainder)
    if (!bestWinningSet) {
      runSearchPass(true);
    }

    // If priority-strict search found nothing, relax priority so remaining demand can still pack (GREEN first)
    if (!bestWinningSet && strictPriorityMode) {
      strictPriorityMode = false;
      prioritySlotSet.clear();
      runSearchPass(false);
      if (!bestWinningSet) {
        runSearchPass(true);
      }
    }

    // ALL PACKS ARE FULLY DEMAND-BACKED:
    // If no 3-UPS or 4-UPS combination can be formed from remaining active orders,
    // we strictly terminate with zero surplus rather than creating phantom/unallocated rolls.
    if (!bestWinningSet) break;

    // ALLOCATE DEMAND AND DEDUCT FROM ORDER TRACKERS FOR THE WINNING SET
    const winning = bestWinningSet;
    // HARD RULE: never emit plans with PS01 edge trim in RED zone (<150 or >500)
    if (winning.ps01Trim < 150 || winning.ps01Trim > 500) break;
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

      const slotCutsNeeded = new Map<number, number>();
      for (const cut of cand.cutsList) {
        slotCutsNeeded.set(cut.slotIdx, (slotCutsNeeded.get(cut.slotIdx) || 0) + 1);
      }

      for (const [slotIdx, cutsPerJumbo] of slotCutsNeeded.entries()) {
        const slotDef = demandSlots[slotIdx];
        if (!slotDef) continue;
        const reelsPerJumboRun = Math.max(1, Math.round(jumboLen / slotDef.length_m));
        let totalReelsToDistribute = cutsPerJumbo * totalRollsForCand * reelsPerJumboRun;

        const matching = orderTrackers
          .filter(t => t.slotIdx === slotIdx && (t.maxAllowedKg - t.allocatedKg) >= 1.0)
          .sort((a, b) => {
            const pDiff = (b.order.priority ? 1 : 0) - (a.order.priority ? 1 : 0);
            if (pDiff !== 0) return pDiff;
            const remDiff = b.remainingKg - a.remainingKg;
            if (Math.abs(remDiff) > 0.01) return remDiff;
            return (b.maxAllowedKg - b.allocatedKg) - (a.maxAllowedKg - a.allocatedKg);
          });

        for (const tr of matching) {
          if (totalReelsToDistribute <= 0) break;
          const spareKg = tr.maxAllowedKg - tr.allocatedKg;
          const weightPerReel = weightKg(slotDef.width_mm, tr.pkgLength);
          const maxReelsAllowed = Math.floor((spareKg + 0.01) / weightPerReel);

          if (maxReelsAllowed >= 1) {
            const reelsForThis = Math.min(totalReelsToDistribute, maxReelsAllowed);
            const weightForThis = Number((reelsForThis * weightPerReel).toFixed(2));

            tr.allocatedKg = Number((tr.allocatedKg + weightForThis).toFixed(2));
            tr.remainingKg = Math.max(0, Number((tr.order.remaining_qty - tr.allocatedKg).toFixed(2)));
            tr.allocatedReels += reelsForThis;
            tr.status = tr.remainingKg <= 0.01 ? 'COMPLETED' : 'PARTIALLY_FULFILLED';
            totalReelsToDistribute -= reelsForThis;
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

      const totalWeightKg = Number((cand.singleJumboWeightKg * totalRollsForCand).toFixed(2));
      const actualTrim = cand.mslTrim;
      const uniqueInDeckle = new Set(winning.jumboWidths).size;
      const deckleTypeDesc = uniqueInDeckle === 1 ? 'Uniform' : uniqueInDeckle === 2 ? '2-Width Mixed' : '3-Width Mixed';

      finalRequirements.push({
        id: `req-msl-${reqCounter++}`,
        film: cand.film || groupLabel,
        thickness_micron: thickness,
        required_jumbo_width_mm: cand.jumboWidth,
        required_jumbo_length_m: cand.jumboLengthM,
        calculated_diameter_mm: cand.jumboDiameterMm,
        core: settings.core,
        required_rolls_count: totalRollsForCand,
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
        ps01_run_index: iteration,
        ps01_parent_deckle_id: `ps01-run-${iteration}`,
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

    // Phase 4: Maintain campaign continuity state across consecutive iterations
    if (winning.jumboWidths && winning.jumboWidths.length > 0) {
      activeCampaignJumboWidth = winning.jumboWidths[0];
    }
    if (winning.candidates && winning.candidates.length > 0 && winning.candidates[0].combo) {
      activeCampaignSlitWidths = winning.candidates[0].combo.widths;
    }

    if (totalAllocatedInIter <= 0) continue;
  }


  // HARD RULE: drop any requirement whose PS01 edge trim fell below 150 mm (RED zone forbidden)
  for (let i = finalRequirements.length - 1; i >= 0; i--) {
    const trim = finalRequirements[i].ps01_feasibility?.ps01_trim_mm;
    if (typeof trim === 'number' && (trim < 150 || trim > 500)) {
      finalRequirements.splice(i, 1);
    }
  }

  // Consolidate same-size jumbo packs: identical film + width + length + slit pattern + trim
  // → one requirement with summed rolls (single PS mother pack story, not repeated 3405 lines)
  {
    const merged: JumboRequirement[] = [];
    const byKey = new Map<string, JumboRequirement>();
    for (const req of finalRequirements) {
      const pattern = (req.finished_widths_covered || []).slice().sort((a, b) => a - b).join('x');
      // Same physical pack identity — do not split on parent-run id or tiny trim jitter
      const key = [
        req.film,
        req.required_jumbo_width_mm,
        req.required_jumbo_length_m,
        pattern,
        req.ups,
        req.package_multiple || 1,
      ].join('|');
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...req, orders_covered: [...(req.orders_covered || [])] });
        continue;
      }
      existing.required_rolls_count =
        (existing.required_rolls_count || 0) + (req.required_rolls_count || 0);
      existing.total_weight_kg = Number(
        ((existing.total_weight_kg || 0) + (req.total_weight_kg || 0)).toFixed(2)
      );
      // Merge orders_covered by order_id
      const covMap = new Map<string, (typeof existing.orders_covered)[0]>();
      for (const oc of existing.orders_covered || []) {
        covMap.set(String(oc.order_id || `${oc.sales_order}_${oc.item_number}`), { ...oc });
      }
      for (const oc of req.orders_covered || []) {
        const id = String(oc.order_id || `${oc.sales_order}_${oc.item_number}`);
        const prev = covMap.get(id);
        if (prev) {
          prev.required_reels = (prev.required_reels || 0) + (oc.required_reels || 0);
          prev.weight_kg = Number(((prev.weight_kg || 0) + (oc.weight_kg || 0)).toFixed(2));
        } else {
          covMap.set(id, { ...oc });
        }
      }
      existing.orders_covered = Array.from(covMap.values());
      // Keep first parent deckle id so PS treats as one campaign family
      if (!existing.ps01_parent_deckle_id && req.ps01_parent_deckle_id) {
        existing.ps01_parent_deckle_id = req.ps01_parent_deckle_id;
      }
    }
    for (const v of byKey.values()) merged.push(v);
    finalRequirements.length = 0;
    finalRequirements.push(...merged);
  }

  // Summary Metrics Calculation
  const totalRolls = finalRequirements.reduce((sum, r) => sum + r.required_rolls_count, 0);
  const uniqueJumboWidths = Array.from(new Set(finalRequirements.map(r => r.required_jumbo_width_mm)));
  const totalPlannedKg = finalRequirements.reduce((sum, r) => sum + r.total_weight_kg, 0);
  const totalTrimKg = finalRequirements.reduce((sum, r) => {
    const trimFraction = (r.expected_trim_mm || 0) / r.required_jumbo_width_mm;
    return sum + (r.total_weight_kg * trimFraction);
  }, 0);
  const avgWaste = totalPlannedKg > 0 ? (totalTrimKg / totalPlannedKg) * 100 : 0;
  const ps01_3ups = finalRequirements.filter(r => r.ps01_feasibility?.ps01_ups === 3).length;
  const ps01_4ups = finalRequirements.filter(r => r.ps01_feasibility?.ps01_ups === 4).length;
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
  totalScore += ps01_3ups * 10000;
  totalScore += ps01_4ups * 4000;
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
      ps01_3ups_count: ps01_3ups,
      ps01_4ups_count: ps01_4ups,
      max_jumbo_length_m: maxJumboLen,
      is_fully_feasible: finalRequirements.every(r => r.ps01_feasibility?.is_feasible && r.ps01_feasibility.status !== 'RED'),
      score: totalScore,
      reason: `${finalRequirements.length} plan(s), ${totalRolls} roll(s), ${ps01_3ups} 3-UPS patterns`,
    },
  };
}

/**
 * Generate Upstream Jumbo Roll Requirements from Metallized Orders
 * 
 * IMPLEMENTS COMPATIBLE FILM GROUP PLANNING (Sections 1-25):
 * 1. Determines film compatibility group (e.g. MZ10S-18 ↔ MZ18, MZ10S-20 ↔ MZ20).
 * 2. Compares Option A (Separate Planning) vs Option B (Combined Planning).
 * 3. Prefers Combined Planning when feasible and objectively better under locked priority hierarchy.
 * 4. Allows a PORTFOLIO OF DIFFERENT JUMBO WIDTHS in the final plan.
 * 5. Strictly enforces per-order +10% ceiling (Allocated <= Balance * 1.10).
 * 6. Discards RED candidates immediately (0 KG, 0 rolls).
 */
export function generateJumboRollRequirements(
  orders: VA05Order[],
  settings: MetallizerMachineSettings,
  selectedFilm?: string,
  options?: {
    compatibilityRules?: FilmCompatibilityRule[];
    forceStrategy?: 'AUTO' | 'COMBINED' | 'SEPARATE';
    onProgress?: (progressPercent: number, stageDescription: string) => void;
    enableCampaignOptimization?: boolean;
    enableSegmentationContinuation?: boolean;
    enableMasterWidthClustering?: boolean;
    enableDynamicContinuation?: boolean;
    dynamicContinuationOptions?: DynamicContinuationOptions;
    maxJumboLengthM?: number;
    maxJumboDiameterMm?: number;
  }
): JumboRequirement[] {
  const rules = options?.compatibilityRules || DEFAULT_FILM_COMPATIBILITY_RULES;
  const forceStrategy = options?.forceStrategy || 'AUTO';
  const onProgress = options?.onProgress;

  onProgress?.(10, 'Filtering metallizer orders & analyzing film compatibility...');

  // HARD RULE: Include only MZ orders in Metallizer Slitter demand/planning
  let pending = orders.filter(o => isMetallizerOrder(o) && o.remaining_qty > 0.01);
  if (pending.length === 0) {
    onProgress?.(100, 'No pending metallizer orders found');
    return [];
  }

  // Determine target films
  let targetFilms: string[] = [];
  if (selectedFilm && selectedFilm !== 'ALL') {
    // If selectedFilm belongs to a compatible group, include the whole group
    targetFilms = getCompatibleFilmsFor(selectedFilm, rules);
    pending = pending.filter(o => targetFilms.includes(o.film));
  }
  if (pending.length === 0) {
    onProgress?.(100, 'No matching pending orders for target film');
    return [];
  }

  // Group pending orders into compatible film groups
  const allFilmsInPending = Array.from(new Set(pending.map(o => o.film)));
  const compatibleGroups = getAllCompatibleGroups(allFilmsInPending, rules);

  const finalRequirements: JumboRequirement[] = [];
  let globalReqCounter = 1;

  const totalGroups = compatibleGroups.length;
  for (let gIdx = 0; gIdx < totalGroups; gIdx++) {
    const group = compatibleGroups[gIdx];
    const baseProgress = 20 + Math.floor((gIdx / totalGroups) * 70);
    onProgress?.(baseProgress, `Synthesizing ${group.group_name} patterns & evaluating PS01 deckles...`);

    const groupOrders = pending.filter(o => group.films.includes(o.film));
    if (groupOrders.length === 0) continue;

    // If group has only 1 film or cannot be combined, optimize directly
    if (group.films.length <= 1 || !group.is_combined_eligible || forceStrategy === 'SEPARATE') {
      const result = optimizeDemandPool(groupOrders, settings, group.group_name, globalReqCounter);
      finalRequirements.push(...result.requirements);
      globalReqCounter += result.requirements.length;
      continue;
    }

    // MULTI-FILM COMPATIBLE GROUP: Evaluate Option A (Separate) vs Option B (Combined)
    // Option A: Separate Planning
    let optionATotalScore = 0;
    const optionAReqs: JumboRequirement[] = [];
    let optionAReqCount = globalReqCounter;

    for (const singleFilm of group.films) {
      const singleFilmOrders = groupOrders.filter(o => o.film === singleFilm);
      if (singleFilmOrders.length === 0) continue;
      const singleRes = optimizeDemandPool(singleFilmOrders, settings, singleFilm, optionAReqCount);
      optionAReqs.push(...singleRes.requirements);
      optionATotalScore += singleRes.score;
      optionAReqCount += singleRes.requirements.length;
    }

    // Option B: Combined Planning
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

/**
 * Phase 6: Post-Optimization Setup Consolidation Pass
 * 1. Merges exact cut matches within the same film group and multiple.
 * 2. Unifies near-width jumbos (<= 4mm difference) to eliminate PS01 and MSL setup jitter.
 * Preserves strict physical feasibility, MSL trim within [18, 45] mm, and customer slit widths.
 */
function consolidateRequirements(requirements: JumboRequirement[]): JumboRequirement[] {
  const result: JumboRequirement[] = [];
  const mergedIds = new Set<string>();

  // Pass 1: Exact cut merges
  for (let i = 0; i < requirements.length; i++) {
    const r1 = requirements[i];
    if (mergedIds.has(r1.id)) continue;

    for (let j = i + 1; j < requirements.length; j++) {
      const r2 = requirements[j];
      if (mergedIds.has(r2.id)) continue;

      // Same physical jumbo identity may merge across iterative parent-run IDs
      // (engine used to emit one ps01-run-N per loop pass → many 3405×3 rows).
      // Different widths / lengths / cut patterns still stay separate.
      if (r1.film === r2.film &&
          r1.package_multiple === r2.package_multiple &&
          r1.required_jumbo_length_m === r2.required_jumbo_length_m &&
          Number(r1.required_jumbo_width_mm) === Number(r2.required_jumbo_width_mm) &&
          Number(r1.ups || 0) === Number(r2.ups || 0)) {
        
        const cuts1 = (r1.msl_pattern_summary?.cuts || []).map(c => c.width_mm).sort((a, b) => a - b);
        const cuts2 = (r2.msl_pattern_summary?.cuts || []).map(c => c.width_mm).sort((a, b) => a - b);
        // Also accept finished_widths_covered when msl_pattern_summary cuts empty
        const fw1 = (r1.finished_widths_covered || []).slice().sort((a, b) => a - b);
        const fw2 = (r2.finished_widths_covered || []).slice().sort((a, b) => a - b);
        const cutsMatch =
          (cuts1.length > 0 && cuts1.length === cuts2.length && cuts1.every((w, idx) => w === cuts2[idx])) ||
          (cuts1.length === 0 && fw1.length > 0 && fw1.length === fw2.length && fw1.every((w, idx) => w === fw2[idx]));
        
        if (cutsMatch) {
          // Same film + jumbo width + length + UPS + slit pattern → one pack line
          // (trim already validated when each requirement was emitted)
          const chosenWidth = Math.min(r1.required_jumbo_width_mm, r2.required_jumbo_width_mm);
          r1.required_rolls_count = (r1.required_rolls_count || 0) + (r2.required_rolls_count || 0);
          r1.total_weight_kg = Number(((r1.total_weight_kg || 0) + (r2.total_weight_kg || 0)).toFixed(2));
          r1.required_jumbo_width_mm = chosenWidth;
          if (r2.expected_trim_mm != null) {
            r1.expected_trim_mm = Math.min(r1.expected_trim_mm ?? r2.expected_trim_mm, r2.expected_trim_mm);
          }
          r1.ps01_parent_deckle_id = r1.ps01_parent_deckle_id || r2.ps01_parent_deckle_id || `ps01-merged-${r1.id}`;
          r1.ps01_run_index = Math.min(Number(r1.ps01_run_index || 9999), Number(r2.ps01_run_index || 9999));

            for (const o2 of r2.orders_covered) {

              const existing = r1.orders_covered.find(o1 => o1.order_id === o2.order_id);
              if (existing) {
                existing.required_reels += o2.required_reels;
                existing.weight_kg += o2.weight_kg;
              } else {
                r1.orders_covered.push({ ...o2 });
              }
            }

            mergedIds.add(r2.id);
        }
      }
    }
    result.push(r1);
  }

  // Pass 2: Near-width jumbo alignment (<= 4mm difference within same film, multiple, and same parent deckle)
  for (let i = 0; i < result.length; i++) {
    const r1 = result[i];
    for (let j = i + 1; j < result.length; j++) {
      const r2 = result[j];
      const d1 = r1.ps01_parent_deckle_id;
      const d2 = r2.ps01_parent_deckle_id;
      const sameDeckle = (d1 && d2) ? d1 === d2 : (!d1 && !d2);
      if (!sameDeckle) continue;

      if (r1.film === r2.film &&
          r1.package_multiple === r2.package_multiple &&
          r1.required_jumbo_length_m === r2.required_jumbo_length_m) {
        
        const w1 = r1.required_jumbo_width_mm;
        const w2 = r2.required_jumbo_width_mm;
        const diff = Math.abs(w1 - w2);
        if (diff > 0 && diff <= 4) {
          const sum1 = w1 - (r1.expected_trim_mm || 0);
          const sum2 = w2 - (r2.expected_trim_mm || 0);
          
          const targetW = r1.required_rolls_count >= r2.required_rolls_count ? w1 : w2;
          const t1 = targetW - sum1;
          const t2 = targetW - sum2;

          if (t1 >= 18 && t1 <= 45 && t2 >= 18 && t2 <= 45) {
            r1.required_jumbo_width_mm = targetW;
            r1.expected_trim_mm = t1;
            r2.required_jumbo_width_mm = targetW;
            r2.expected_trim_mm = t2;
          }
        }
      }
    }
  }

  return result;
}

  const baseConsolidated = consolidateRequirements(finalRequirements);

  // Heavy post-passes default OFF for synthesize latency; enable explicitly for campaign mode
  const shouldOptimize = options?.enableCampaignOptimization ?? true;
  if (!shouldOptimize) {
    return baseConsolidated.filter(r => {
      const trim = r.ps01_feasibility?.ps01_trim_mm;
      return typeof trim !== 'number' || (trim >= 150 && trim <= 500);
    });
  }

  // Phase 5: Campaign Optimizer Segmentation & Continuation Pass
  const shouldSegment = options?.enableSegmentationContinuation ?? true;
  const segmented = shouldSegment
    ? applyCampaignSegmentationAndContinuation(baseConsolidated, {
        rules,
        orders: pending,
        maxJumboLengthM: options?.maxJumboLengthM,
        maxJumboDiameterMm: options?.maxJumboDiameterMm,
      })
    : baseConsolidated;

  // Phase 5: Campaign Optimizer Dynamic Trim-Bounded Master-Width Clustering
  const shouldCluster = options?.enableMasterWidthClustering ?? true;
  const clustered = shouldCluster
    ? applyCampaignMasterWidthClustering(segmented, { rules })
    : segmented;

  // Phase 6/7: Final Setup Consolidation
  return consolidateRequirements(clustered).filter(r => {
    const trim = r.ps01_feasibility?.ps01_trim_mm;
    return typeof trim !== 'number' || (trim >= 150 && trim <= 500);
  });
}

/**
 * Computes the sum of customer slit widths (Sj) for a candidate pattern or requirement.
 * CRITICAL RULE: Customer requested slit widths are strictly preserved and never altered.
 */
export function getPatternSlitSum(p: MasterWidthClusterCandidate | JumboRequirement): number {
  if (p.finished_widths_covered && p.finished_widths_covered.length > 0) {
    return p.finished_widths_covered.reduce((a, b) => a + b, 0);
  }
  if ((p as any).slit_widths && (p as any).slit_widths.length > 0) {
    return (p as any).slit_widths.reduce((a, b) => a + b, 0);
  }
  if ((p as any).total_slit_width_mm && (p as any).total_slit_width_mm > 0) {
    return (p as any).total_slit_width_mm;
  }
  if ((p as any).msl_pattern_summary?.cuts && (p as any).msl_pattern_summary.cuts.length > 0) {
    return (p as any).msl_pattern_summary.cuts.reduce((a: number, c: any) => a + c.width_mm, 0);
  }
  if ((p as any).segments && (p as any).segments.length > 0) {
    const firstSeg = (p as any).segments[0];
    if (firstSeg.cuts && firstSeg.cuts.length > 0) {
      return firstSeg.cuts.reduce((a: number, b: number) => a + b, 0);
    }
    if (firstSeg.total_slit_width_mm > 0) {
      return firstSeg.total_slit_width_mm;
    }
  }
  const w = (p as JumboRequirement).required_jumbo_width_mm ?? (p as any).jumbo_width_mm ?? 0;
  const trim = (p as JumboRequirement).expected_trim_mm ?? (p as any).trim_width_mm ?? (p as any).trim_mm ?? 0;
  return w - trim;
}

/**
 * Phase 2: Dynamic Trim-Bounded Master-Width Clustering in CURRENT MSL01 Engine.
 * 
 * =========================================================================
 * CORE RULE
 * =========================================================================
 * For every candidate cluster of slit patterns:
 *   Sj = sum of all customer slit widths in pattern j
 *   Each pattern must satisfy:
 *     18 <= Wmaster - Sj <= 45
 *   Therefore:
 *     Sj + 18 <= Wmaster <= Sj + 45
 *   For a cluster:
 *     OmegaMin = max(Sj + 18)
 *     OmegaMax = min(Sj + 45)
 *   Cluster is valid ONLY when:
 *     OmegaMin <= OmegaMax
 *   Otherwise reject the cluster.
 *   Select a safe canonical Wmaster from the legal intersection.
 *   Customer slit widths MUST remain exactly unchanged.
 * 
 * =========================================================================
 * PS01 VALIDATION
 * =========================================================================
 * After selecting Wmaster, independently validate:
 * - PS01 deckle = 10,400 mm
 * - PS01 GREEN trim = [150, 280] mm
 * - All companion jumbos
 * - Actual PS01 feasibility
 * 
 * Do not accept a cluster merely because MSL trim is legal.
 * A cluster is accepted only when BOTH MSL feasibility AND PS01 feasibility are valid.
 * 
 * =========================================================================
 * SAFETY CONSTRAINTS
 * =========================================================================
 * Never cluster:
 * - Different film/substrate campaigns
 * - Incompatible thickness
 * - Incompatible package length / multiple
 * - Patterns with no common legal MSL trim interval
 * - Patterns that cannot be placed through PS01
 */
export function evaluateMasterWidthClustering(
  patterns: (MasterWidthClusterCandidate | JumboRequirement)[],
  options?: MasterWidthClusteringOptions
): MasterWidthClusteringResult {
  const minMslTrim = options?.msl_min_trim_mm ?? 18;
  const maxMslTrim = options?.msl_max_trim_mm ?? 45;
  const minPs01Trim = options?.ps01_min_green_trim_mm ?? 150;
  const maxPs01Trim = options?.ps01_max_green_trim_mm ?? 280;
  const deckleMm = options?.deckle_width_mm ?? 10400;

  const emptyResult = (reason: string, oMin: number = 0, oMax: number = 0): MasterWidthClusteringResult => ({
    is_valid: false,
    status: 'REJECTED',
    reject_reason: reason,
    omega_min: oMin,
    omega_max: oMax,
    pattern_trims: [],
    msl_feasibility: { is_valid: false, reason },
    ps01_feasibility: {
      is_valid: false,
      status: 'RED',
      ps01_deckle_mm: deckleMm,
      ps01_trim_mm: 0,
      ps01_cut_combination: [],
      ps01_ups: 0,
      explanation: reason,
    },
  });

  if (!patterns || patterns.length === 0) {
    return emptyResult('Empty pattern set');
  }

  // Safety Rule 1: Reject duplicate physical jumbos/patterns
  const patternIds = patterns.map(p => (p as any).id).filter(Boolean);
  if (new Set(patternIds).size !== patternIds.length) {
    return emptyResult('Cannot cluster duplicate physical jumbos/patterns');
  }

  // Safety Rule 2: Validate campaign film compatibility (never cluster different film/substrate campaigns)
  const first = patterns[0];
  for (let i = 1; i < patterns.length; i++) {
    const p = patterns[i];
    if (first.film && p.film && first.film !== p.film) {
      return emptyResult(`Incompatible film campaigns: ${first.film} vs ${p.film}`);
    }
    // Safety Rule 3: Incompatible thickness
    if (first.thickness_micron && p.thickness_micron && first.thickness_micron !== p.thickness_micron) {
      return emptyResult(`Incompatible thickness: ${first.thickness_micron}µ vs ${p.thickness_micron}µ`);
    }
    // Safety Rule 4: Incompatible package length / multiple
    if (first.package_multiple && p.package_multiple && first.package_multiple !== p.package_multiple) {
      return emptyResult(`Incompatible package multiple: ${first.package_multiple}x vs ${p.package_multiple}x`);
    }
    if ((first as any).package_length_m && (p as any).package_length_m && (first as any).package_length_m !== (p as any).package_length_m) {
      return emptyResult(`Incompatible package length: ${(first as any).package_length_m}m vs ${(p as any).package_length_m}m`);
    }
    if (first.required_jumbo_length_m && p.required_jumbo_length_m && first.required_jumbo_length_m !== p.required_jumbo_length_m) {
      return emptyResult(`Incompatible jumbo length: ${first.required_jumbo_length_m}m vs ${p.required_jumbo_length_m}m`);
    }
  }

  // Compute customer slit sums (Sj) for each pattern
  const slitSums = patterns.map(p => getPatternSlitSum(p));
  if (slitSums.some(s => s <= 0)) {
    return emptyResult('Invalid customer slit sum <= 0');
  }

  const omegaMin = Math.max(...slitSums.map(s => s + minMslTrim));
  const omegaMax = Math.min(...slitSums.map(s => s + maxMslTrim));

  // Core Rule: Cluster is valid ONLY when OmegaMin <= OmegaMax
  if (omegaMin > omegaMax) {
    return emptyResult(
      `Trim intersection is empty: OmegaMin (${omegaMin} mm) > OmegaMax (${omegaMax} mm)`,
      omegaMin,
      omegaMax
    );
  }

  // Enforce machine hard limit on master width (3650 mm)
  if (omegaMin > 3650) {
    return emptyResult(
      `OmegaMin (${omegaMin} mm) exceeds MSL maximum limit of 3650 mm`,
      omegaMin,
      omegaMax
    );
  }
  const effectiveOmegaMax = Math.min(omegaMax, 3650);
  if (omegaMin > effectiveOmegaMax) {
    return emptyResult(
      `Legal intersection [${omegaMin}, ${omegaMax}] exceeds MSL maximum limit of 3650 mm`,
      omegaMin,
      omegaMax
    );
  }

  // Deterministic Canonical Wmaster Selection:
  // 1. If preferred Wmaster specified and within [omegaMin, effectiveOmegaMax], prioritize it
  // 2. Prioritize existing pattern widths within [omegaMin, effectiveOmegaMax] (higher roll count / larger first)
  // 3. Search all integer widths in [omegaMin, effectiveOmegaMax]
  const existingWidths = patterns
    .map(p => (p as JumboRequirement).required_jumbo_width_mm ?? (p as any).jumbo_width_mm ?? 0)
    .filter(w => w >= omegaMin && w <= effectiveOmegaMax);

  const candidateWidths: number[] = [];
  if (options?.preferredWmaster && options.preferredWmaster >= omegaMin && options.preferredWmaster <= effectiveOmegaMax) {
    candidateWidths.push(options.preferredWmaster);
  }
  const distinctExisting = Array.from(new Set(existingWidths)).sort((a, b) => {
    // Sort existing widths: prefer width with higher roll count
    const rollsA = patterns.filter(p => ((p as any).required_jumbo_width_mm ?? (p as any).jumbo_width_mm) === a)
      .reduce((sum, p) => sum + ((p as any).required_rolls_count || 1), 0);
    const rollsB = patterns.filter(p => ((p as any).required_jumbo_width_mm ?? (p as any).jumbo_width_mm) === b)
      .reduce((sum, p) => sum + ((p as any).required_rolls_count || 1), 0);
    if (rollsB !== rollsA) return rollsB - rollsA;
    return b - a; // Deterministic tie-break
  });
  for (const w of distinctExisting) {
    if (!candidateWidths.includes(w)) candidateWidths.push(w);
  }
  // Fill remaining integer widths
  for (let w = effectiveOmegaMax; w >= omegaMin; w--) {
    if (!candidateWidths.includes(w)) candidateWidths.push(w);
  }

  // Extract and filter companion pool:
  // Companion jumbos MUST be of the same film and thickness, width in (0, 3650].
  // Supports both object array and raw number array.
  let companionWidths: number[] = [];
  if (options?.companionPool && options.companionPool.length > 0) {
    const rawItems = options.companionPool;
    const filteredWidths: number[] = [];
    for (const item of rawItems) {
      if (typeof item === 'number') {
        if (item > 0 && item <= 3650) filteredWidths.push(item);
      } else if (item && typeof item === 'object') {
        // Enforce physical compatibility: must match film and thickness
        const matchFilm = !first.film || !item.film || first.film === item.film;
        const matchThick = !first.thickness_micron || !item.thickness_micron || first.thickness_micron === item.thickness_micron;
        if (matchFilm && matchThick) {
          const w = (item as any).required_jumbo_width_mm ?? (item as any).jumbo_width_mm ?? 0;
          if (w > 0 && w <= 3650) filteredWidths.push(w);
        }
      }
    }
    companionWidths = Array.from(new Set(filteredWidths)).sort((a, b) => a - b);
  }

  // PS01 Feasibility Validation
  for (const candidateW of candidateWidths) {
    // 1. Check if patterns share a common PS01 cut combination
    const sharedDeckleId = patterns.length > 1 && patterns.every(p => 
      p.ps01_parent_deckle_id && p.ps01_parent_deckle_id === first.ps01_parent_deckle_id
    );
    const firstCombo = (first as any).ps01_cut_combination || first.ps01_feasibility?.ps01_cut_combination;
    if (sharedDeckleId && firstCombo && firstCombo.length >= 3 && firstCombo.length <= 4) {
      const updatedCombination = [...firstCombo];
      const usedIndices = new Set<number>();
      let allReplaced = true;
      for (const p of patterns) {
        const oldW = (p as any).required_jumbo_width_mm ?? (p as any).jumbo_width_mm ?? 0;
        let foundIdx = -1;
        for (let k = 0; k < updatedCombination.length; k++) {
          if (!usedIndices.has(k) && updatedCombination[k] === oldW) {
            foundIdx = k;
            break;
          }
        }
        if (foundIdx !== -1) {
          usedIndices.add(foundIdx);
          updatedCombination[foundIdx] = candidateW;
        } else {
          allReplaced = false;
          break;
        }
      }
      if (allReplaced) {
        const totalWeb = updatedCombination.reduce((a, b) => a + b, 0);
        const ps01Trim = deckleMm - totalWeb;
        const sideAUps = Math.ceil(updatedCombination.length / 2);
        const sideBUps = Math.floor(updatedCombination.length / 2);
        const isDuplexBalanced = Math.abs(sideAUps - sideBUps) <= 1;

        if (ps01Trim >= minPs01Trim && ps01Trim <= maxPs01Trim && isDuplexBalanced) {
          return buildAcceptedClusterResult(candidateW, updatedCombination, ps01Trim, 'shared parent deckle');
        }
      }
      // If sharedDeckleId is true, these patterns belong to the EXACT SAME mother roll on PS01.
      // If that mother roll cannot accommodate candidateW within plant trim limits, candidateW is physically
      // impossible for this shared mother roll. We MUST continue to next candidateW and never fall through.
      continue;
    }

    // 2. Check if any pattern already has a verified GREEN combination with candidateW
    const verifiedGreenPattern = patterns.find(p => {
      const w = (p as any).required_jumbo_width_mm ?? (p as any).jumbo_width_mm ?? 0;
      const combo = (p as any).ps01_cut_combination || p.ps01_feasibility?.ps01_cut_combination;
      if (w === candidateW && combo && combo.length >= 3 && combo.length <= 4) {
        const totalWeb = combo.reduce((a, b) => a + b, 0);
        const trim = deckleMm - totalWeb;
        return trim >= minPs01Trim && trim <= maxPs01Trim;
      }
      return false;
    });

    const verifiedCombo = (verifiedGreenPattern as any)?.ps01_cut_combination || verifiedGreenPattern?.ps01_feasibility?.ps01_cut_combination;
    if (verifiedGreenPattern && verifiedCombo) {
      // Check that other patterns in this candidate cluster can legally accommodate candidateW in their parent deckles:
      let otherDecklesFeasible = true;
      for (const p of patterns) {
        if (p === verifiedGreenPattern) continue;
        const pDeckle = (p as any).ps01_parent_deckle_id;
        const pCombo = (p as any).ps01_cut_combination || (p as any).ps01_feasibility?.ps01_cut_combination;
        if (pDeckle && pCombo && pCombo.length >= 3 && pCombo.length <= 4) {
          const oldW = (p as any).required_jumbo_width_mm ?? (p as any).jumbo_width_mm ?? 0;
          const idx = pCombo.indexOf(oldW);
          if (idx !== -1) {
            const testCombo = [...pCombo];
            testCombo[idx] = candidateW;
            const web = testCombo.reduce((a, b) => a + b, 0);
            const trim = deckleMm - web;
            if (trim < minPs01Trim || trim > maxPs01Trim) {
              otherDecklesFeasible = false;
              break;
            }
          }
        }
      }

      if (otherDecklesFeasible) {
        const totalWeb = verifiedCombo.reduce((a, b) => a + b, 0);
        const ps01Trim = deckleMm - totalWeb;
        return buildAcceptedClusterResult(candidateW, verifiedCombo, ps01Trim, 'verified pattern deckle');
      }
    }

    // 3. Pure 3-UPS on PS01
    const pure3Trim = deckleMm - (3 * candidateW);
    if (pure3Trim >= minPs01Trim && pure3Trim <= maxPs01Trim) {
      return buildAcceptedClusterResult(candidateW, [candidateW, candidateW, candidateW], pure3Trim, 'pure 3-UPS');
    }

    // 4. Pure 4-UPS on PS01
    const pure4Trim = deckleMm - (4 * candidateW);
    if (pure4Trim >= minPs01Trim && pure4Trim <= maxPs01Trim) {
      return buildAcceptedClusterResult(candidateW, [candidateW, candidateW, candidateW, candidateW], pure4Trim, 'pure 4-UPS');
    }

    // 5. Check companion combinations (fast two-pointer search on sorted unique widths)
    if (companionWidths.length > 0) {
      // Include candidateW itself in the searchable companion set to support [candidateW, candidateW, wA] etc.
      const pool = companionWidths.includes(candidateW)
        ? companionWidths
        : [...companionWidths, candidateW].sort((a, b) => a - b);

      // Check 3-UPS mixed combinations: candidateW + wA + wB
      const targetMin3 = deckleMm - maxPs01Trim - candidateW;
      const targetMax3 = deckleMm - minPs01Trim - candidateW;

      let found3Ups: number[] | null = null;
      for (let a = 0; a < pool.length; a++) {
        const wA = pool[a];
        for (let b = a; b < pool.length; b++) {
          const sum = wA + pool[b];
          if (sum >= targetMin3 && sum <= targetMax3) {
            found3Ups = [candidateW, wA, pool[b]];
            break;
          }
        }
        if (found3Ups) break;
      }
      if (found3Ups) {
        const ps01Trim = deckleMm - (found3Ups.reduce((x, y) => x + y, 0));
        return buildAcceptedClusterResult(candidateW, found3Ups, ps01Trim, '3-UPS companion combination');
      }

      // Check 4-UPS mixed combinations: candidateW + wA + wB + wC
      const targetMin4 = deckleMm - maxPs01Trim - candidateW;
      const targetMax4 = deckleMm - minPs01Trim - candidateW;

      let found4Ups: number[] | null = null;
      for (let a = 0; a < pool.length; a++) {
        const wA = pool[a];
        for (let b = a; b < pool.length; b++) {
          const wB = pool[b];
          const remMin = targetMin4 - wA - wB;
          const remMax = targetMax4 - wA - wB;
          if (remMax < pool[b]) continue; // No c >= b can fit
          for (let c = b; c < pool.length; c++) {
            const wC = pool[c];
            if (wC >= remMin && wC <= remMax) {
              found4Ups = [candidateW, wA, wB, wC];
              break;
            }
          }
          if (found4Ups) break;
        }
        if (found4Ups) break;
      }
      if (found4Ups) {
        const ps01Trim = deckleMm - (found4Ups.reduce((x, y) => x + y, 0));
        return buildAcceptedClusterResult(candidateW, found4Ups, ps01Trim, '4-UPS companion combination');
      }
    }
  }

  // If no candidate Wmaster satisfies PS01 GREEN trim:
  const rejectMsg = `PS01 feasibility failed: No legal Wmaster in [${omegaMin}, ${effectiveOmegaMax}] satisfies PS01 GREEN trim [${minPs01Trim}, ${maxPs01Trim}] mm`;
  return {
    is_valid: false,
    status: 'REJECTED',
    reject_reason: rejectMsg,
    omega_min: omegaMin,
    omega_max: effectiveOmegaMax,
    pattern_trims: patterns.map((p, idx) => {
      const s = slitSums[idx];
      const origW = (p as any).required_jumbo_width_mm ?? (p as any).jumbo_width_mm ?? 0;
      return {
        id: (p as any).id,
        sum_cuts: s,
        original_width: origW,
        canonical_width: origW,
        trim_mm: origW - s,
        is_msl_valid: (origW - s) >= minMslTrim && (origW - s) <= maxMslTrim,
      };
    }),
    msl_feasibility: {
      is_valid: true,
      reason: `MSL dynamic trim interval [${omegaMin}, ${effectiveOmegaMax}] mm is non-empty`,
    },
    ps01_feasibility: {
      is_valid: false,
      status: 'RED',
      ps01_deckle_mm: deckleMm,
      ps01_trim_mm: 0,
      ps01_cut_combination: [],
      ps01_ups: 0,
      explanation: rejectMsg,
    },
  };

  function buildAcceptedClusterResult(
    canonicalW: number,
    cutCombination: number[],
    ps01Trim: number,
    source: string
  ): MasterWidthClusteringResult {
    return {
      is_valid: true,
      status: 'ACCEPTED',
      omega_min: omegaMin,
      omega_max: effectiveOmegaMax,
      canonical_master_width_mm: canonicalW,
      pattern_trims: patterns.map((p, idx) => {
        const s = slitSums[idx];
        const origW = (p as any).required_jumbo_width_mm ?? (p as any).jumbo_width_mm ?? 0;
        const trim = canonicalW - s;
        return {
          id: (p as any).id,
          sum_cuts: s,
          original_width: origW,
          canonical_width: canonicalW,
          trim_mm: trim,
          is_msl_valid: trim >= minMslTrim && trim <= maxMslTrim,
        };
      }),
      msl_feasibility: {
        is_valid: true,
        reason: `All pattern trims within plant-approved [${minMslTrim}, ${maxMslTrim}] mm at canonical Wmaster = ${canonicalW} mm`,
      },
      ps01_feasibility: {
        is_valid: true,
        status: 'GREEN',
        ps01_deckle_mm: deckleMm,
        ps01_trim_mm: ps01Trim,
        ps01_cut_combination: cutCombination,
        ps01_ups: cutCombination.length,
        explanation: `PS01 GREEN trim = ${ps01Trim} mm ([${cutCombination.join(', ')}] mm via ${source})`,
      },
    };
  }
}

/**
 * Applies an accepted master-width clustering result to a list of JumboRequirements.
 * CRITICAL INVARIANT: Customer requested slit widths (and allocations) remain 100% UNCHANGED.
 * Unifies the manufactured jumbo master width, updates expected trim, recalculates roll mass,
 * and synchronizes verified PS01 feasibility metadata.
 */
export function applyMasterWidthClustering(
  requirements: JumboRequirement[],
  clusterResult: MasterWidthClusteringResult,
  clusterId?: string
): JumboRequirement[] {
  if (!clusterResult.is_valid || !clusterResult.canonical_master_width_mm) {
    return requirements;
  }
  const canonicalW = clusterResult.canonical_master_width_mm;
  const cId = clusterId || `cluster-w${canonicalW}-${Date.now()}`;

  return requirements.map(r => {
    const s = getPatternSlitSum(r);
    const newTrim = canonicalW - s;
    const density = (r as any).density || 0.91;
    const rollsCount = r.required_rolls_count || 1;
    const singleRollWeight = calculateJumboWeight(canonicalW, r.thickness_micron, density, r.required_jumbo_length_m);
    const totalWeight = Number((singleRollWeight * rollsCount).toFixed(2));
    const efficiency = Number(((s / canonicalW) * 100).toFixed(2));

    const origCombo = r.ps01_cut_combination || r.ps01_feasibility?.ps01_cut_combination;
    const isPure = (origCombo && origCombo.length > 0 && origCombo.every(w => w === origCombo[0])) ||
                   (clusterResult.ps01_feasibility.ps01_cut_combination && clusterResult.ps01_feasibility.ps01_cut_combination.every(w => w === clusterResult.ps01_feasibility.ps01_cut_combination[0]));

    let resolvedCutCombo = clusterResult.ps01_feasibility.ps01_cut_combination;
    if (isPure) {
      const ups = origCombo?.length || clusterResult.ps01_feasibility.ps01_ups || (canonicalW <= 2600 ? 4 : 3);
      resolvedCutCombo = Array(ups).fill(canonicalW);
    }
    const resolvedTotalWeb = resolvedCutCombo && resolvedCutCombo.length > 0 ? resolvedCutCombo.reduce((a, b) => a + b, 0) : clusterResult.ps01_feasibility.ps01_deckle_mm;
    const resolvedDeckle = clusterResult.ps01_feasibility.ps01_deckle_mm || 10400;
    const resolvedTrim = resolvedDeckle - resolvedTotalWeb;
    const resolvedUps = resolvedCutCombo ? resolvedCutCombo.length : clusterResult.ps01_feasibility.ps01_ups;
    const deckleEff = Number((((resolvedDeckle - resolvedTrim) / resolvedDeckle) * 100).toFixed(2));

    // HARD RULE: PS01 edge trim must be >= 150 mm (RED below 150 is forbidden)
    if (resolvedTrim < 150 || resolvedTrim > 500) {
      return r; // keep original requirement; do not apply illegal clustered width
    }
    const ps01Status: 'GREEN' | 'YELLOW' = (resolvedTrim >= 150 && resolvedTrim <= 280) ? 'GREEN' : 'YELLOW';

    return {
      ...r,
      is_master_width_clustered: true,
      master_width_cluster_id: cId,
      canonical_master_width_mm: canonicalW,
      master_width_mm: canonicalW,
      required_jumbo_width_mm: canonicalW,
      expected_trim_mm: newTrim,
      trim_width_mm: newTrim,
      total_weight_kg: totalWeight,
      efficiency_percent: efficiency,
      ps01_cut_combination: resolvedCutCombo,
      ps01_feasibility: {
        status: ps01Status,
        is_feasible: true,
        ps01_deckle_mm: resolvedDeckle,
        jumbo_width_mm: canonicalW,
        ps01_ups: resolvedUps,
        ps01_cut_combination: resolvedCutCombo,
        ps01_total_width_mm: resolvedTotalWeb,
        ps01_trim_mm: resolvedTrim,
        ps01_deckle_efficiency_percent: deckleEff,
        ps01_duplex_balanced: true,
        side_a_ups: Math.ceil(resolvedUps / 2),
        side_b_ups: Math.floor(resolvedUps / 2),
        relaxation_type: ps01Status === 'GREEN' ? 'NONE' : 'PS01_TRIM_RELAXED',
        explanation: isPure ? `${resolvedUps}-UPS pure jumbo manufacturing pattern on PS01 ([${resolvedCutCombo.join(', ')}] mm)` : clusterResult.ps01_feasibility.explanation,
      },
    };
  });
}

/**
 * Generate MSL Candidate Slit Patterns for a given physical jumbo roll and available orders.
 * Supports:
 * - 1 to 6 UPS (MSL capacity)
 * - Single width repeats
 * - Multi-width combinations (e.g. 1120 + 1130 + 1140 mm)
 * - Multi-length combinations (e.g. 10,000 m + 20,000 m where 1x and 2x are concurrently slit)
 * - Compatible film cross-allocation if films are in the same compatibility group
 */
function findMSLCandidatePatterns(
  roll: JumboRoll,
  activeOrders: VA05Order[],
  settings: MetallizerMachineSettings,
  rules: FilmCompatibilityRule[] = DEFAULT_FILM_COMPATIBILITY_RULES
): MetallizerCandidatePattern[] {
  const matchingOrders = activeOrders.filter(o =>
    isMetallizerOrder(o) &&
    o.remaining_qty > 0.01 &&
    areFilmsCompatible(o.film, roll.film, rules) &&
    (o.thickness_micron === roll.thickness_micron || !o.thickness_micron)
  );

  if (matchingOrders.length === 0 || roll.remaining_length_m <= 0) return [];

  const candidates: MetallizerCandidatePattern[] = [];
  const maxUps = Math.min(6, settings.max_planning_ups || 6);

  // Generalized Multi-Order Combinatorial Search supporting full 1 to 6 UPS
  // Explores all valid combinations of orders and cut repetitions summing to 1..maxUps
  const mslMinTrim = settings.green_min_trim_mm || 18;
  const mslMaxTrim = settings.green_max_trim_mm || 45;

  // Group matching orders by length compatibility families to evaluate valid combinations
  interface OrderCutChoice {
    order: VA05Order;
    ups: number;
  }

  // Recursive search over subsets of matchingOrders with assigned cut quantities
  function searchCombinations(
    orderIndex: number,
    currentTotalUps: number,
    currentTotalWidth: number,
    currentChoices: OrderCutChoice[],
    currentDistinctLengths: Set<number>
  ) {
    if (currentChoices.length > 0 && currentTotalUps >= 1 && currentTotalUps <= maxUps) {
      const trim = roll.width_mm - currentTotalWidth;

      if (trim >= mslMinTrim && trim <= Math.min(mslMaxTrim, roll.width_mm * 0.15)) {
        // Physical Duplex Shaft Balance Verification:
        // Arms distributed across Shaft A and Shaft B: |Shaft A - Shaft B| <= 1, max 3 per shaft
        const shaftRollsA = Math.ceil(currentTotalUps / 2);
        const shaftRollsB = Math.floor(currentTotalUps / 2);
        if (shaftRollsA <= 3 && shaftRollsB <= 3 && Math.abs(shaftRollsA - shaftRollsB) <= 1) {
          // Length compatibility & LCM package length calculation
          const distinctLens = Array.from(currentDistinctLengths);
          let isCompatible = true;
          if (distinctLens.length === 2) {
            const minL = Math.min(distinctLens[0], distinctLens[1]);
            const maxL = Math.max(distinctLens[0], distinctLens[1]);
            if (maxL !== minL * 2) {
              isCompatible = false;
            } else {
              // Physical Duplex Shaft Balance Verification for Dual Length:
              // Shaft A must take all cuts of one length, Shaft B all cuts of the other length.
              const countA = currentChoices.filter(c => c.order.length_m === minL).reduce((s, c) => s + c.ups, 0);
              const countB = currentChoices.filter(c => c.order.length_m === maxL).reduce((s, c) => s + c.ups, 0);
              if (countA > 3 || countB > 3 || Math.abs(countA - countB) > 1) {
                isCompatible = false;
              }
            }
          } else if (distinctLens.length > 2) {
            isCompatible = false;
          }

          if (isCompatible) {
            const lcmLen = Math.max(...distinctLens);
            if (roll.remaining_length_m >= lcmLen) {
              const multiple = Math.floor(roll.remaining_length_m / lcmLen);
              if (multiple >= 1) {
                // Check each order's total weight against individual +3% ceiling
                let validCeiling = true;
                let totalWeight = 0;
                let hasPriority = false;
                const orderPlanItems: {
                  order: VA05Order;
                  ups: number;
                  width_mm: number;
                  length_m: number;
                  reels: number;
                  weight_kg: number;
                  is_closed: boolean;
                }[] = [];
                const slitWidths: number[] = [];

                for (const choice of currentChoices) {
                  const ordLen = choice.order.length_m || 19500;
                  const reelsPerRun = Math.floor(lcmLen / ordLen);
                  const totalReels = choice.ups * multiple * reelsPerRun;
                  const ordWeight = calculateJumboWeight(choice.order.width_mm, roll.thickness_micron, roll.density, ordLen) * totalReels;

                  if (ordWeight > choice.order.remaining_qty * MSL_CUSTOMER_MAX_OVERALLOCATION_FACTOR) {
                    validCeiling = false;
                    break;
                  }

                  totalWeight += ordWeight;
                  if (choice.order.priority) hasPriority = true;

                  for (let u = 0; u < choice.ups; u++) {
                    slitWidths.push(choice.order.width_mm);
                  }

                  orderPlanItems.push({
                    order: choice.order,
                    ups: choice.ups,
                    width_mm: choice.order.width_mm,
                    length_m: ordLen,
                    reels: totalReels,
                    weight_kg: ordWeight,
                    is_closed: choice.order.remaining_qty <= ordWeight + 0.01,
                  });
                }

                if (validCeiling) {
                  const totalRollWeight = calculateJumboWeight(roll.width_mm, roll.thickness_micron, roll.density, lcmLen * multiple);
                  const trimWeight = totalRollWeight - totalWeight;
                  const wastePct = totalRollWeight > 0 ? (trimWeight / totalRollWeight) * 100 : 0;

                  // Scoring hierarchy:
                  // Base score scales with UPS and distinct order coverage
                  let score = 500 + currentTotalUps * 150 + currentChoices.length * 200;
                  // Multi-width and multi-length bonuses
                  const uniqueWidths = new Set(currentChoices.map(c => c.order.width_mm)).size;
                  if (uniqueWidths > 1) score += (uniqueWidths - 1) * 300;
                  if (distinctLens.length > 1) score += 600;
                  // Trim tightness bias (target 25mm preferred trim)
                  if (trim >= mslMinTrim && trim <= mslMaxTrim) score += 500;
                  score -= Math.abs(trim - 25) * 5;
                  // Priority order bonus
                  if (hasPriority) score += 2000;
                  // Volume and waste
                  score += totalWeight / 10;
                  score -= wastePct * 50;

                  candidates.push({
                    jumbo_roll: roll,
                    ups: currentTotalUps,
                    slit_widths: slitWidths,
                    orders: orderPlanItems,
                    total_slit_width_mm: currentTotalWidth,
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
    }

    if (currentTotalUps >= maxUps || orderIndex >= matchingOrders.length) return;

    for (let i = orderIndex; i < matchingOrders.length; i++) {
      const ord = matchingOrders[i];
      const ordLen = ord.length_m || 19500;

      // Check length compatibility before recursing
      if (currentDistinctLengths.size > 0 && !currentDistinctLengths.has(ordLen)) {
        if (currentDistinctLengths.size >= 2) continue; // Max 2 distinct lengths allowed
        const existingLen = Array.from(currentDistinctLengths)[0];
        const isRatio1to2 = (existingLen === ordLen * 2) || (ordLen === existingLen * 2);
        if (!isRatio1to2) continue;
      }

      // Max UPS for this order cannot exceed remaining slitter capacity
      const maxUpsForOrd = maxUps - currentTotalUps;
      for (let ups = 1; ups <= maxUpsForOrd; ups++) {
        const addedWidth = ord.width_mm * ups;
        if (currentTotalWidth + addedWidth + mslMinTrim > roll.width_mm) break;

        currentChoices.push({ order: ord, ups });
        const nextDistinctLengths = new Set(currentDistinctLengths);
        nextDistinctLengths.add(ordLen);

        searchCombinations(
          i + 1,
          currentTotalUps + ups,
          currentTotalWidth + addedWidth,
          currentChoices,
          nextDistinctLengths
        );

        currentChoices.pop();
      }
    }
  }

  searchCombinations(0, 0, 0, [], new Set<number>());

  return candidates;
}

/**
 * Phase 3: Package-Boundary Segmented Jumbo Representation
 * =========================================================================
 * Factory Functions, Invariant Validation, and Aggregation Mechanics
 * =========================================================================
 */

/**
 * Automatically derives or balances duplex shaft distribution for a list of cuts.
 * Enforces front_ups <= 3, rear_ups <= 3, |front - rear| <= 1.
 */
export function deriveDuplexShaftDistribution(
  cuts: number[],
  orderLengths?: number[]
): ShaftDistributionResult {
  const n = cuts.length;
  if (n === 0) {
    return { front_cuts: [], rear_cuts: [], front_ups: 0, rear_ups: 0, is_balanced: true };
  }

  // Dual-length slitting: if lengths provided and 2 distinct lengths exist
  if (orderLengths && orderLengths.length === n) {
    const uniqueLens = Array.from(new Set(orderLengths));
    if (uniqueLens.length === 2) {
      const minL = Math.min(uniqueLens[0], uniqueLens[1]);
      const maxL = Math.max(uniqueLens[0], uniqueLens[1]);
      const frontCuts = cuts.filter((_, idx) => orderLengths[idx] === minL);
      const rearCuts = cuts.filter((_, idx) => orderLengths[idx] === maxL);
      const isBalanced = frontCuts.length <= 3 && rearCuts.length <= 3 && Math.abs(frontCuts.length - rearCuts.length) <= 1;
      return {
        front_cuts: frontCuts,
        rear_cuts: rearCuts,
        front_ups: frontCuts.length,
        rear_ups: rearCuts.length,
        is_balanced: isBalanced,
      };
    }
  }

  // Standard duplex split: Math.ceil(n / 2) Front, Math.floor(n / 2) Rear
  const frontCount = Math.ceil(n / 2);
  const frontCuts = cuts.slice(0, frontCount);
  const rearCuts = cuts.slice(frontCount);
  const isBalanced = frontCuts.length <= 3 && rearCuts.length <= 3 && Math.abs(frontCuts.length - rearCuts.length) <= 1;

  return {
    front_cuts: frontCuts,
    rear_cuts: rearCuts,
    front_ups: frontCuts.length,
    rear_ups: rearCuts.length,
    is_balanced: isBalanced,
  };
}

/**
 * Validates physical manufacturing invariants of a single MetallizerPackageSegment.
 */
export function validatePackageSegmentInvariants(
  segment: MetallizerPackageSegment,
  masterWidthMm: number,
  options?: SegmentedJumboValidationOptions
): SegmentValidationResult {
  const errors: string[] = [];
  const minTrim = options?.min_trim_mm ?? MSL_GREEN_MIN_TRIM_MM; // 18
  const maxTrim = options?.max_trim_mm ?? MSL_GREEN_MAX_TRIM_MM; // 45
  const minCut = options?.min_cut_width_mm ?? 400;
  const maxTotalCuts = options?.max_total_cuts ?? 5;
  const maxShaftCuts = options?.max_shaft_cuts ?? 3;
  const maxImbalance = options?.max_duplex_imbalance ?? 1;

  const cuts = segment.cuts || [];
  const ups = cuts.length;
  const slitSum = cuts.reduce((a, b) => a + b, 0);
  const calculatedTrim = masterWidthMm - slitSum;

  // 1. Min cut width >= 400 mm
  let isMinCutValid = true;
  for (const cut of cuts) {
    if (cut < minCut) {
      isMinCutValid = false;
      errors.push(`Cut width violation in segment ${segment.segment_index}: Cut ${cut} mm is below minimum allowable width ${minCut} mm`);
    }
  }

  // 2. Max cuts (UPS) <= 5
  const isMaxCutsValid = ups >= 1 && ups <= maxTotalCuts;
  if (!isMaxCutsValid) {
    errors.push(`UPS violation in segment ${segment.segment_index}: Total cuts ${ups} outside allowable range [1, ${maxTotalCuts}]`);
  }

  // 3. Trim evaluation in [18, 45] mm
  const isTrimValid = calculatedTrim >= minTrim && calculatedTrim <= maxTrim;
  if (!isTrimValid) {
    errors.push(`Trim violation in segment ${segment.segment_index}: MSL edge trim ${calculatedTrim} mm is outside plant window [${minTrim}, ${maxTrim}] mm`);
  }

  // 4. Duplex shaft constraints
  let frontUps = 0;
  let rearUps = 0;
  let isShaftCutsValid = true;
  let isDuplexBalanced = true;

  if (segment.shaft_distribution) {
    const { front_ups, rear_ups, front_cuts, rear_cuts } = segment.shaft_distribution;
    frontUps = front_ups ?? (front_cuts ? front_cuts.length : 0);
    rearUps = rear_ups ?? (rear_cuts ? rear_cuts.length : 0);

    if (frontUps > maxShaftCuts) {
      isShaftCutsValid = false;
      errors.push(`Duplex capacity violation in segment ${segment.segment_index}: Front shaft has ${frontUps} cuts (maximum allowed is ${maxShaftCuts})`);
    }
    if (rearUps > maxShaftCuts) {
      isShaftCutsValid = false;
      errors.push(`Duplex capacity violation in segment ${segment.segment_index}: Rear shaft has ${rearUps} cuts (maximum allowed is ${maxShaftCuts})`);
    }
    const imbalance = Math.abs(frontUps - rearUps);
    if (imbalance > maxImbalance) {
      isDuplexBalanced = false;
      errors.push(`Duplex balance violation in segment ${segment.segment_index}: Shaft distribution Front=${frontUps}, Rear=${rearUps} exceeds balance tolerance ${maxImbalance}`);
    }
    if (front_cuts && front_cuts.length !== frontUps) {
      errors.push(`Shaft consistency violation in segment ${segment.segment_index}: Front cuts array length ${front_cuts.length} !== declared front_ups ${frontUps}`);
    }
    if (rear_cuts && rear_cuts.length !== rearUps) {
      errors.push(`Shaft consistency violation in segment ${segment.segment_index}: Rear cuts array length ${rear_cuts.length} !== declared rear_ups ${rearUps}`);
    }
    if (frontUps + rearUps !== ups) {
      errors.push(`Shaft consistency violation in segment ${segment.segment_index}: Sum of shaft cuts (${frontUps + rearUps}) !== total cuts (${ups})`);
    }
  } else {
    const derived = deriveDuplexShaftDistribution(cuts);
    frontUps = derived.front_ups;
    rearUps = derived.rear_ups;
    isShaftCutsValid = frontUps <= maxShaftCuts && rearUps <= maxShaftCuts;
    isDuplexBalanced = derived.is_balanced;
    if (!isShaftCutsValid) {
      errors.push(`Duplex capacity violation in segment ${segment.segment_index}: ${ups} cuts cannot fit on duplex shafts (max ${maxShaftCuts} per shaft)`);
    }
    if (!isDuplexBalanced) {
      errors.push(`Duplex balance violation in segment ${segment.segment_index}: Cannot balance ${ups} cuts across duplex shafts`);
    }
  }

  // 5. Shaft-length homogeneity: all reels wound on the same shaft share identical length
  let isShaftLengthHomogeneous = true;
  if (segment.orders_covered && segment.orders_covered.length > 0) {
    const distinctLengths = Array.from(new Set(segment.orders_covered.map(o => o.length_m).filter(Boolean)));
    if (distinctLengths.length > 2) {
      isShaftLengthHomogeneous = false;
      errors.push(`Shaft-length homogeneity violation in segment ${segment.segment_index}: More than 2 distinct lengths (${distinctLengths.join(', ')} m) present`);
    } else if (distinctLengths.length === 2) {
      const minL = Math.min(distinctLengths[0], distinctLengths[1]);
      const maxL = Math.max(distinctLengths[0], distinctLengths[1]);
      if (maxL !== minL * 2) {
        isShaftLengthHomogeneous = false;
        errors.push(`Dual-length ratio breach in segment ${segment.segment_index}: Lengths ${minL}m and ${maxL}m are not in exact 1:2 ratio`);
      }
    }
    for (const ord of segment.orders_covered) {
      if (ord.length_m && segment.length_m && distinctLengths.length <= 1) {
        const isMultiple = segment.length_m % ord.length_m === 0 || ord.length_m % segment.length_m === 0;
        if (!isMultiple) {
          isShaftLengthHomogeneous = false;
          errors.push(`Shaft-length homogeneity violation in segment ${segment.segment_index}: Order ${ord.sales_order || ord.order_id} has length ${ord.length_m} m differing from segment length ${segment.length_m} m`);
        }
      }
    }
    if (segment.shaft_distribution) {
      const { front_ups, rear_ups } = segment.shaft_distribution;
      if (segment.orders_covered.length === segment.cuts.length) {
        let frontOrders: typeof segment.orders_covered = [];
        let rearOrders: typeof segment.orders_covered = [];

        if (distinctLengths.length === 2) {
          const minL = Math.min(distinctLengths[0], distinctLengths[1]);
          const maxL = Math.max(distinctLengths[0], distinctLengths[1]);
          frontOrders = segment.orders_covered.filter(o => o.length_m === minL);
          rearOrders = segment.orders_covered.filter(o => o.length_m === maxL);
        } else {
          frontOrders = segment.orders_covered.slice(0, front_ups);
          rearOrders = segment.orders_covered.slice(front_ups, front_ups + rear_ups);
        }

        const frontLens = Array.from(new Set(frontOrders.map(o => o.length_m).filter(Boolean)));
        const rearLens = Array.from(new Set(rearOrders.map(o => o.length_m).filter(Boolean)));
        if (frontLens.length > 1) {
          isShaftLengthHomogeneous = false;
          errors.push(`Shaft-length homogeneity violation in segment ${segment.segment_index}: Front shaft has heterogeneous reel lengths: [${frontLens.join(', ')}] m`);
        }
        if (rearLens.length > 1) {
          isShaftLengthHomogeneous = false;
          errors.push(`Shaft-length homogeneity violation in segment ${segment.segment_index}: Rear shaft has heterogeneous reel lengths: [${rearLens.join(', ')}] m`);
        }
      }
    }
  }

  // 6. Zero speculative cuts: no PLANNEX BUFFER, empty customer, or unallocated material
  for (const ord of segment.orders_covered || []) {
    const cust = (ord.customer || '').toUpperCase();
    const so = (ord.sales_order || '').toUpperCase();
    if (cust.includes('BUFFER') || so.includes('BUFFER') || cust.includes('SPECULATIVE') || so.includes('SPECULATIVE') || !ord.customer) {
      errors.push(`Speculative material violation in segment ${segment.segment_index}: Dummy or buffer order detected (${ord.customer || 'Unallocated'})`);
    }
  }
  if (segment.orders_covered && segment.cuts && segment.orders_covered.length < segment.cuts.length) {
    errors.push(`Unbacked cut violation in segment ${segment.segment_index}: Segment has ${segment.cuts.length} cuts but only ${segment.orders_covered.length} customer order allocations`);
  }

  const isValid = isTrimValid && isMinCutValid && isMaxCutsValid && isShaftCutsValid && isDuplexBalanced && isShaftLengthHomogeneous && errors.length === 0;

  return {
    is_valid: isValid,
    isValid,
    errors,
    violations: errors,
    segment_index: segment.segment_index,
    trim_mm: calculatedTrim,
    total_slit_width_mm: slitSum,
    ups,
    front_ups: frontUps,
    rear_ups: rearUps,
    is_trim_valid: isTrimValid,
    is_min_cut_valid: isMinCutValid,
    is_max_cuts_valid: isMaxCutsValid,
    is_shaft_cuts_valid: isShaftCutsValid,
    is_duplex_balanced: isDuplexBalanced,
    is_shaft_length_homogeneous: isShaftLengthHomogeneous,
  };
}

/**
 * Alias for validatePackageSegmentInvariants
 */
export const validateSegmentInvariants = validatePackageSegmentInvariants;

/**
 * Validates end-to-end multi-segment physical unity, contiguity, and customer headroom on a JumboRequirement or MetallizerPlan.
 */
export function validateSegmentedJumboInvariants(
  jumbo: JumboRequirement | MetallizerPlan,
  options?: SegmentedJumboValidationOptions
): SegmentedJumboValidationResult {
  const errors: string[] = [];
  const segments = jumbo.segments || [];
  const masterWidth = (jumbo as JumboRequirement).required_jumbo_width_mm ?? (jumbo as MetallizerPlan).jumbo_width_mm ?? 0;
  const totalLength = (jumbo as JumboRequirement).required_jumbo_length_m ?? (jumbo as MetallizerPlan).jumbo_length_m ?? 0;

  if (!jumbo.is_segmented || !Array.isArray(segments) || segments.length === 0) {
    return {
      is_valid: false,
      isValid: false,
      errors: ['Jumbo is not marked as segmented or has empty segments array'],
      violations: ['Jumbo is not marked as segmented or has empty segments array'],
      jumbo_id: (jumbo as any).id || (jumbo as any).plan_number,
      segments_count: 0,
      segment_results: [],
      is_continuity_valid: false,
      is_headroom_valid: true,
    };
  }

  // 1. Physical unity invariant: required_rolls_count must be 1 for JumboRequirement
  if ((jumbo as JumboRequirement).required_rolls_count !== undefined && (jumbo as JumboRequirement).required_rolls_count !== 1) {
    errors.push(`Physical unity violation: Segmented jumbo must represent exactly 1 physical roll (found required_rolls_count=${(jumbo as JumboRequirement).required_rolls_count})`);
  }

  // 2. Validate each segment independently
  const segmentResults: SegmentValidationResult[] = [];
  for (const seg of segments) {
    const res = validatePackageSegmentInvariants(seg, masterWidth, options);
    segmentResults.push(res);
    if (!res.isValid) {
      errors.push(...res.errors);
    }
  }

  // 3. Length Contiguity & Total Length Sum
  let isContinuityValid = true;
  if (segments[0].start_length_m !== 0) {
    isContinuityValid = false;
    errors.push(`Contiguity violation: First segment starts at ${segments[0].start_length_m} m instead of 0 m`);
  }

  let accumulatedLength = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.segment_index !== i + 1) {
      errors.push(`Segment indexing violation: Expected index ${i + 1}, got ${seg.segment_index}`);
    }
    if (seg.length_m <= 0) {
      isContinuityValid = false;
      errors.push(`Segment length violation: Segment ${seg.segment_index} has length <= 0 (${seg.length_m} m)`);
    }
    if (seg.end_length_m !== seg.start_length_m + seg.length_m) {
      isContinuityValid = false;
      errors.push(`Contiguity violation: Segment ${seg.segment_index} length mismatch: ${seg.end_length_m} != ${seg.start_length_m} + ${seg.length_m}`);
    }
    if (i > 0) {
      const prev = segments[i - 1];
      if (seg.start_length_m !== prev.end_length_m) {
        isContinuityValid = false;
        errors.push(`Contiguity gap/overlap: Segment ${seg.segment_index} starts at ${seg.start_length_m} m but previous ends at ${prev.end_length_m} m`);
      }
    }
    accumulatedLength += seg.length_m;
  }

  if (totalLength > 0 && accumulatedLength !== totalLength) {
    isContinuityValid = false;
    errors.push(`Length sum violation: Total segment length ${accumulatedLength} m does not match jumbo total length ${totalLength} m`);
  }

  // 4. Customer Allocation Headroom Ceiling (Demand * 1.10)
  let isHeadroomValid = true;
  const demandMap = options?.orderDemandMap || new Map<string, number>();
  if (options?.orders && options.orders.length > 0) {
    for (const ord of options.orders) {
      const key = ord.id || `${ord.sales_order}-${ord.item_number}`;
      demandMap.set(key, ord.remaining_qty ?? ord.order_qty_kg ?? 0);
      demandMap.set(ord.id, ord.remaining_qty ?? ord.order_qty_kg ?? 0);
      demandMap.set(`${ord.sales_order}/${ord.item_number}`, ord.remaining_qty ?? ord.order_qty_kg ?? 0);
    }
  }

  if (demandMap.size > 0) {
    const allocMap = new Map<string, number>();
    for (const seg of segments) {
      for (const ord of seg.orders_covered || []) {
        const key = ord.order_id || `${ord.sales_order}-${ord.item_number}`;
        const weight = ord.weight_kg ?? (ord as any).planned_weight_kg ?? 0;
        allocMap.set(key, (allocMap.get(key) || 0) + weight);
      }
    }

    const ceilingFactor = options?.max_overallocation_factor ?? MSL_CUSTOMER_MAX_OVERALLOCATION_FACTOR; // 1.10
    const checkedKeys = new Set<string>();
    for (const [id, allocKg] of allocMap.entries()) {
      if (checkedKeys.has(id)) continue;
      checkedKeys.add(id);
      const demand = demandMap.get(id);
      if (demand !== undefined && demand > 0) {
        const ceiling = Number((demand * ceilingFactor).toFixed(2));
        if (allocKg > ceiling + 0.05) {
          isHeadroomValid = false;
          errors.push(`Customer headroom breach: Order ${id} allocated ${allocKg.toFixed(2)} kg exceeds ceiling ${ceiling} kg (demand: ${demand} kg)`);
        }
      }
    }
  }

  // 5. Doff Knife Transitions Validation
  if (jumbo.transitions && Array.isArray(jumbo.transitions)) {
    const minTrim = options?.min_trim_mm ?? MSL_GREEN_MIN_TRIM_MM;
    const maxTrim = options?.max_trim_mm ?? MSL_GREEN_MAX_TRIM_MM;
    for (const trans of jumbo.transitions) {
      if (trans.shifted_arms.length > 2) {
        errors.push(`Transition ${trans.transition_index} violation: ${trans.shifted_arms.length} shifted knife arms (> 2 strictly rejected)`);
      } else if (trans.shifted_arms.length === 2) {
        const s1 = trans.shifted_arms[0].shaft;
        const s2 = trans.shifted_arms[1].shaft;
        if (s1 && s2 && s1 !== s2) {
          errors.push(`Transition ${trans.transition_index} violation: Cross-shaft 2-arm shift rejected (Front and Rear). Only same-shaft 2-arm shifts are permitted.`);
        }
      }
      if (trans.trim_before_mm < minTrim || trans.trim_before_mm > maxTrim) {
        errors.push(`Transition ${trans.transition_index} violation: trim_before_mm ${trans.trim_before_mm} mm outside [${minTrim}, ${maxTrim}] mm`);
      }
      if (trans.trim_after_mm < minTrim || trans.trim_after_mm > maxTrim) {
        errors.push(`Transition ${trans.transition_index} violation: trim_after_mm ${trans.trim_after_mm} mm outside [${minTrim}, ${maxTrim}] mm`);
      }
    }
  }

  const isValid = segmentResults.every(r => r.isValid) && isContinuityValid && isHeadroomValid && errors.length === 0;

  return {
    is_valid: isValid,
    isValid,
    errors,
    violations: errors,
    jumbo_id: (jumbo as any).id || (jumbo as any).plan_number,
    segments_count: segments.length,
    segment_results: segmentResults,
    is_continuity_valid: isContinuityValid,
    is_headroom_valid: isHeadroomValid,
  };
}

/**
 * Phase 4: 1-Arm / Same-Shaft 2-Arm Doff Transition Engine
 * =========================================================================
 * Generic Knife Transition Validation, Arm Movement Mapping & Invariant Verification
 * =========================================================================
 */

export interface DoffTransitionOptions {
  transition_index?: number;
  min_trim_mm?: number;
  max_trim_mm?: number;
  min_cut_width_mm?: number;
  max_total_cuts?: number;
  max_shaft_cuts?: number;
  orderDemandMap?: Map<string, number>;
  orders?: VA05Order[];
  max_overallocation_factor?: number;
}

/**
 * Generic transition engine that evaluates physical feasibility of a package-boundary doff knife transition.
 * 
 * Invariant Verification:
 * 1. Identifies unchanged (stationary) knife arms
 * 2. Identifies changed (shifted) knife arms
 * 3. Maps changed arms to duplex shafts (FRONT or REAR)
 * 4. Calculates width deltas per arm and net width delta
 * 5. Validates Segment A MSL trim in [18, 45] mm
 * 6. Validates Segment B MSL trim in [18, 45] mm
 * 7. Validates minimum cut width >= 400 mm
 * 8. Validates total cut count <= 5
 * 9. Validates shaft arm capacity <= 3 and duplex balance |Front - Rear| <= 1
 * 10. Validates shaft-length homogeneity
 * 11. Validates customer allocation headroom <= Demand * 1.10
 * 12. Validates zero speculative / dummy material
 * 13. Validates master-width compatibility
 *
 * Mechanical Rules:
 * - 0-arm shift: Permitted (continuation of identical knife setup, 0 min downtime)
 * - 1-arm shift: Permitted if all physical/customer rules pass (5 min downtime)
 * - 2-arm shift: Permitted ONLY IF both shifted arms belong to the SAME duplex shaft (8 min downtime)
 * - Cross-shaft 2-arm shift (1 on Front, 1 on Rear): Strictly REJECTED (destroys both shafts' setups)
 * - > 2 arm shifts: Strictly REJECTED
 * - Width delta alone is NEVER used as legality test.
 */
export function evaluateDoffKnifeTransition(
  segmentA: MetallizerPackageSegment,
  segmentB: MetallizerPackageSegment,
  masterWidthMm: number,
  options?: DoffTransitionOptions
): DoffTransitionValidationResult {
  const errors: string[] = [];
  const minTrim = options?.min_trim_mm ?? MSL_GREEN_MIN_TRIM_MM; // 18
  const maxTrim = options?.max_trim_mm ?? MSL_GREEN_MAX_TRIM_MM; // 45
  const minCut = options?.min_cut_width_mm ?? 400;
  const maxTotalCuts = options?.max_total_cuts ?? 5;
  const maxShaftCuts = options?.max_shaft_cuts ?? 3;

  const cutsA = segmentA.cuts || [];
  const cutsB = segmentB.cuts || [];
  const sumA = cutsA.reduce((a, b) => a + b, 0);
  const sumB = cutsB.reduce((a, b) => a + b, 0);
  const trimA = masterWidthMm - sumA;
  const trimB = masterWidthMm - sumB;
  const netWidthDeltaMm = sumB - sumA;

  // 1. Validate Segment A MSL trim
  if (trimA < minTrim || trimA > maxTrim) {
    errors.push(`Segment A trim violation: Trim ${trimA} mm outside plant window [${minTrim}, ${maxTrim}] mm`);
  }

  // 2. Validate Segment B MSL trim
  if (trimB < minTrim || trimB > maxTrim) {
    errors.push(`Segment B trim violation: Trim ${trimB} mm outside plant window [${minTrim}, ${maxTrim}] mm`);
  }

  // 3. Validate Minimum Cut Width (>= 400 mm) on both segments
  for (const c of cutsA) {
    if (c < minCut) {
      errors.push(`Segment A cut width violation: Cut ${c} mm below minimum ${minCut} mm`);
    }
  }
  for (const c of cutsB) {
    if (c < minCut) {
      errors.push(`Segment B cut width violation: Cut ${c} mm below minimum ${minCut} mm`);
    }
  }

  // 4. Validate Total Cut Count (<= 5) on both segments
  if (cutsA.length < 1 || cutsA.length > maxTotalCuts) {
    errors.push(`Segment A cut count violation: ${cutsA.length} cuts outside [1, ${maxTotalCuts}]`);
  }
  if (cutsB.length < 1 || cutsB.length > maxTotalCuts) {
    errors.push(`Segment B cut count violation: ${cutsB.length} cuts outside [1, ${maxTotalCuts}]`);
  }

  // 5. Shaft Distribution & Duplex Balance for both segments
  const shaftDistA = segmentA.shaft_distribution || deriveDuplexShaftDistribution(cutsA);
  const shaftDistB = segmentB.shaft_distribution || deriveDuplexShaftDistribution(cutsB);

  const isBalancedA = Math.abs(shaftDistA.front_ups - shaftDistA.rear_ups) <= 1;
  const isBalancedB = Math.abs(shaftDistB.front_ups - shaftDistB.rear_ups) <= 1;

  if (shaftDistA.front_ups > maxShaftCuts || shaftDistA.rear_ups > maxShaftCuts || !isBalancedA) {
    errors.push(`Segment A duplex shaft violation: Front ${shaftDistA.front_ups}, Rear ${shaftDistA.rear_ups} unbalanced or exceeds ${maxShaftCuts}`);
  }
  if (shaftDistB.front_ups > maxShaftCuts || shaftDistB.rear_ups > maxShaftCuts || !isBalancedB) {
    errors.push(`Segment B duplex shaft violation: Front ${shaftDistB.front_ups}, Rear ${shaftDistB.rear_ups} unbalanced or exceeds ${maxShaftCuts}`);
  }

  // 6. Zero Speculative Material on Segment B
  for (const ord of segmentB.orders_covered || []) {
    const cust = (ord.customer || '').toUpperCase();
    const so = (ord.sales_order || '').toUpperCase();
    if (cust.includes('BUFFER') || so.includes('BUFFER') || cust.includes('SPECULATIVE') || so.includes('SPECULATIVE') || !ord.customer) {
      errors.push(`Speculative cut violation in Segment B: Dummy/buffer order detected (${ord.customer || 'Unallocated'})`);
    }
  }
  if (segmentB.orders_covered && segmentB.orders_covered.length < cutsB.length) {
    errors.push(`Unbacked cut violation in Segment B: ${cutsB.length} cuts but only ${segmentB.orders_covered.length} customer order allocations`);
  }

  // 7. Customer Headroom Ceiling for Segment B orders
  const demandMap = options?.orderDemandMap || new Map<string, number>();
  if (options?.orders && options.orders.length > 0) {
    for (const ord of options.orders) {
      const key = ord.id || `${ord.sales_order}-${ord.item_number}`;
      demandMap.set(key, ord.remaining_qty ?? ord.ordered_qty ?? 0);
      demandMap.set(ord.id, ord.remaining_qty ?? ord.ordered_qty ?? 0);
      demandMap.set(`${ord.sales_order}/${ord.item_number}`, ord.remaining_qty ?? ord.ordered_qty ?? 0);
    }
  }
  if (demandMap.size > 0 && segmentB.orders_covered) {
    const ceilingFactor = options?.max_overallocation_factor ?? MSL_CUSTOMER_MAX_OVERALLOCATION_FACTOR;
    for (const ord of segmentB.orders_covered) {
      const id = ord.order_id || `${ord.sales_order}-${ord.item_number}`;
      const demand = demandMap.get(id);
      const allocated = ord.weight_kg ?? (ord as any).planned_weight_kg ?? 0;
      if (demand !== undefined && demand > 0) {
        const ceiling = Number((demand * ceilingFactor).toFixed(2));
        if (allocated > ceiling + 0.05) {
          errors.push(`Customer headroom breach in Segment B: Order ${id} allocated ${allocated.toFixed(2)} kg exceeds ceiling ${ceiling} kg (demand: ${demand} kg)`);
        }
      }
    }
  }

  // 8. Knife Arm Matching across shafts
  interface InternalArm {
    index: number;
    width: number;
    shaft: 'FRONT' | 'REAR';
    order?: any;
  }

  const getArms = (seg: MetallizerPackageSegment, dist: { front_cuts: number[]; rear_cuts: number[] }): { front: InternalArm[]; rear: InternalArm[] } => {
    const front: InternalArm[] = [];
    const rear: InternalArm[] = [];
    const orders = seg.orders_covered || [];
    let armIdx = 1;

    for (let i = 0; i < dist.front_cuts.length; i++) {
      front.push({
        index: armIdx++,
        width: dist.front_cuts[i],
        shaft: 'FRONT',
        order: orders[i],
      });
    }
    for (let j = 0; j < dist.rear_cuts.length; j++) {
      rear.push({
        index: armIdx++,
        width: dist.rear_cuts[j],
        shaft: 'REAR',
        order: orders[dist.front_cuts.length + j],
      });
    }
    return { front, rear };
  };

  const armsA = getArms(segmentA, shaftDistA);
  const armsB = getArms(segmentB, shaftDistB);

  // Match arms on a given shaft to minimize movements
  const matchShaftArms = (
    listA: InternalArm[],
    listB: InternalArm[],
    shaftName: 'FRONT' | 'REAR'
  ): { stationary: StationaryKnifeArm[]; shifted: KnifeArmMovement[] } => {
    const stat: StationaryKnifeArm[] = [];
    const shft: KnifeArmMovement[] = [];

    const nA = listA.length;
    const nB = listB.length;

    if (nA === 0 && nB === 0) return { stationary: stat, shifted: shft };

    // Find best permutation of listB to match listA
    const perms: number[][] = [];
    const used = new Array<boolean>(nB).fill(false);
    const current: number[] = [];

    const generatePerms = () => {
      if (current.length === nB) {
        perms.push([...current]);
        return;
      }
      for (let i = 0; i < nB; i++) {
        if (!used[i]) {
          used[i] = true;
          current.push(i);
          generatePerms();
          current.pop();
          used[i] = false;
        }
      }
    };
    generatePerms();

    let bestScore = -1;
    let bestDeltaSum = Infinity;
    let bestPerm: number[] = perms[0] || [];

    for (const p of perms) {
      let stationaryCount = 0;
      let deltaSum = 0;
      const matchLen = Math.min(nA, nB);
      for (let i = 0; i < matchLen; i++) {
        const aWidth = listA[i].width;
        const bWidth = listB[p[i]].width;
        if (aWidth === bWidth) {
          stationaryCount++;
        } else {
          deltaSum += Math.abs(bWidth - aWidth);
        }
      }
      if (stationaryCount > bestScore || (stationaryCount === bestScore && deltaSum < bestDeltaSum)) {
        bestScore = stationaryCount;
        bestDeltaSum = deltaSum;
        bestPerm = p;
      }
    }

    const matchedLen = Math.min(nA, nB);
    for (let i = 0; i < matchedLen; i++) {
      const armA = listA[i];
      const armB = listB[bestPerm[i]];
      if (armA.width === armB.width) {
        stat.push({
          arm_index: armA.index,
          shaft: shaftName,
          width_mm: armA.width,
          order_id: armA.order?.order_id,
          sales_order: armA.order?.sales_order,
          customer: armA.order?.customer,
        });
      } else {
        shft.push({
          arm_index: armA.index,
          shaft: shaftName,
          from_width_mm: armA.width,
          to_width_mm: armB.width,
          delta_mm: armB.width - armA.width,
          order_id_from: armA.order?.order_id,
          order_id_to: armB.order?.order_id,
          sales_order_from: armA.order?.sales_order,
          sales_order_to: armB.order?.sales_order,
          customer_from: armA.order?.customer,
          customer_to: armB.order?.customer,
        });
      }
    }

    // Surplus in A (removed / parked arms)
    for (let i = matchedLen; i < nA; i++) {
      const armA = listA[i];
      shft.push({
        arm_index: armA.index,
        shaft: shaftName,
        from_width_mm: armA.width,
        to_width_mm: 0,
        delta_mm: -armA.width,
        order_id_from: armA.order?.order_id,
        sales_order_from: armA.order?.sales_order,
        customer_from: armA.order?.customer,
      });
    }

    // Surplus in B (added arms)
    for (let j = matchedLen; j < nB; j++) {
      const armB = listB[bestPerm[j]];
      shft.push({
        arm_index: armB.index,
        shaft: shaftName,
        from_width_mm: 0,
        to_width_mm: armB.width,
        delta_mm: armB.width,
        order_id_to: armB.order?.order_id,
        sales_order_to: armB.order?.sales_order,
        customer_to: armB.order?.customer,
      });
    }

    return { stationary: stat, shifted: shft };
  };

  const frontResult = matchShaftArms(armsA.front, armsB.front, 'FRONT');
  const rearResult = matchShaftArms(armsA.rear, armsB.rear, 'REAR');

  const allStationary = [...frontResult.stationary, ...rearResult.stationary];
  const allShifted = [...frontResult.shifted, ...rearResult.shifted];

  const shiftCount = allShifted.length;
  let isSameShaft = false;
  let shiftedShaft: 'FRONT' | 'REAR' | 'BOTH' | 'NONE' = 'NONE';
  let is1ArmTransition = false;
  let is2ArmSameShaftTransition = false;

  if (shiftCount === 0) {
    isSameShaft = true;
    shiftedShaft = 'NONE';
  } else if (shiftCount === 1) {
    isSameShaft = true;
    shiftedShaft = allShifted[0].shaft ?? 'FRONT';
    is1ArmTransition = true;
  } else if (shiftCount === 2) {
    const shaft1 = allShifted[0].shaft;
    const shaft2 = allShifted[1].shaft;
    if (shaft1 === shaft2 && shaft1 !== undefined) {
      isSameShaft = true;
      shiftedShaft = shaft1;
      is2ArmSameShaftTransition = true;
    } else {
      isSameShaft = false;
      shiftedShaft = 'BOTH';
      errors.push(`Cross-shaft 2-arm transition rejected: Shifted knife arms belong to different duplex shafts (Front: ${allShifted.find(a => a.shaft === 'FRONT')?.delta_mm} mm, Rear: ${allShifted.find(a => a.shaft === 'REAR')?.delta_mm} mm). Only same-shaft 2-arm shifts are permitted.`);
    }
  } else {
    // shiftCount > 2
    isSameShaft = false;
    shiftedShaft = 'BOTH';
    errors.push(`Exceeds maximum allowable arm shifts: ${shiftCount} shifted knife arms detected (> 2 shifts strictly rejected)`);
  }

  const isValid = errors.length === 0;
  const rejectReason = errors.length > 0 ? errors[0] : undefined;

  let transition: DoffKnifeTransition | undefined = undefined;
  if (isValid) {
    transition = {
      transition_index: options?.transition_index ?? 1,
      at_length_m: segmentA.end_length_m ?? segmentA.length_m,
      from_segment_index: segmentA.segment_index,
      to_segment_index: segmentB.segment_index,
      stationary_arms: allStationary,
      shifted_arms: allShifted,
      cuts_before: [...cutsA],
      cuts_after: [...cutsB],
      trim_before_mm: trimA,
      trim_after_mm: trimB,
      net_width_delta_mm: netWidthDeltaMm,
      duplex_balanced: isBalancedA && isBalancedB,
      estimated_downtime_minutes: shiftCount === 0 ? 0 : shiftCount === 1 ? 5 : 8,
      notes: shiftCount === 0 
        ? 'Identical setup continuation (0 arm shifts, 0 min downtime)'
        : shiftCount === 1 
          ? `1-Arm knife shift on ${shiftedShaft} shaft (${allShifted[0].from_width_mm} -> ${allShifted[0].to_width_mm} mm, delta ${allShifted[0].delta_mm} mm, 5 min downtime)`
          : `Same-shaft 2-Arm knife shift on ${shiftedShaft} shaft (8 min downtime, opposite shaft preserved)`,
    };
  }

  return {
    is_valid: isValid,
    isValid,
    reject_reason: rejectReason,
    errors,
    violations: errors,
    transition,
    stationary_arms: allStationary,
    shifted_arms: allShifted,
    stationary_arms_count: allStationary.length,
    shifted_arms_count: allShifted.length,
    shifted_shaft: shiftedShaft,
    is_same_shaft: isSameShaft,
    is_1arm_transition: is1ArmTransition,
    is_2arm_same_shaft_transition: is2ArmSameShaftTransition,
    net_width_delta_mm: netWidthDeltaMm,
    trim_before_mm: trimA,
    trim_after_mm: trimB,
  };
}

/**
 * Fast pattern-level transition feasibility check between two candidate slit cut arrays.
 * Useful during campaign candidate exploration before full order allocation.
 */
export function evaluateSlitPatternTransition(
  cutsA: number[],
  cutsB: number[],
  masterWidthMm: number,
  options?: { minTrim?: number; maxTrim?: number }
): DoffTransitionValidationResult {
  const dummySegA: MetallizerPackageSegment = {
    segment_index: 1,
    start_length_m: 0,
    end_length_m: 20000,
    length_m: 20000,
    cuts: [...cutsA],
    finished_widths_covered: [...cutsA],
    total_slit_width_mm: cutsA.reduce((a, b) => a + b, 0),
    trim_mm: masterWidthMm - cutsA.reduce((a, b) => a + b, 0),
    ups: cutsA.length,
    orders_covered: cutsA.map(w => ({ sales_order: 'TEST', item_number: 10, customer: 'GENERIC', width_mm: w, length_m: 20000, ups: 1, planned_reels: 1, weight_per_reel_kg: 100, planned_weight_kg: 100, remaining_before_kg: 100, remaining_after_kg: 0, is_closed: true })),
    shaft_distribution: deriveDuplexShaftDistribution(cutsA),
  };

  const dummySegB: MetallizerPackageSegment = {
    segment_index: 2,
    start_length_m: 20000,
    end_length_m: 40000,
    length_m: 20000,
    cuts: [...cutsB],
    finished_widths_covered: [...cutsB],
    total_slit_width_mm: cutsB.reduce((a, b) => a + b, 0),
    trim_mm: masterWidthMm - cutsB.reduce((a, b) => a + b, 0),
    ups: cutsB.length,
    orders_covered: cutsB.map(w => ({ sales_order: 'TEST', item_number: 20, customer: 'GENERIC', width_mm: w, length_m: 20000, ups: 1, planned_reels: 1, weight_per_reel_kg: 100, planned_weight_kg: 100, remaining_before_kg: 100, remaining_after_kg: 0, is_closed: true })),
    shaft_distribution: deriveDuplexShaftDistribution(cutsB),
  };

  return evaluateDoffKnifeTransition(dummySegA, dummySegB, masterWidthMm, {
    min_trim_mm: options?.minTrim,
    max_trim_mm: options?.maxTrim,
  });
}

/**
 * Factory function to construct a verified DoffKnifeTransition between two adjacent segments.
 */
export function createDoffKnifeTransition(
  segmentA: MetallizerPackageSegment,
  segmentB: MetallizerPackageSegment,
  transitionIndex: number,
  masterWidthMm: number,
  options?: DoffTransitionOptions
): DoffKnifeTransition {
  const result = evaluateDoffKnifeTransition(segmentA, segmentB, masterWidthMm, {
    ...options,
    transition_index: transitionIndex,
  });
  if (!result.isValid || !result.transition) {
    throw new Error(`Cannot create DoffKnifeTransition: ${result.reject_reason || 'Invariants violated'}`);
  }
  return result.transition;
}

/**
 * Aggregates order allocations across all segments into unified MetallizerPlanOrderAllocation objects.
 */
export function aggregateSegmentOrderAllocations(
  segments: MetallizerPackageSegment[]
): MetallizerPlanOrderAllocation[] {
  const aggregatedMap = new Map<string, MetallizerPlanOrderAllocation>();

  for (const seg of segments) {
    for (const alloc of seg.orders_covered || []) {
      const orderKey = alloc.order_id || `${alloc.sales_order}/${alloc.item_number}`;
      const allocWeight = alloc.weight_kg ?? (alloc as any).planned_weight_kg ?? 0;
      const allocReels = (alloc as any).planned_reels ?? (alloc as any).required_reels ?? 1;

      const existing = aggregatedMap.get(orderKey);
      if (existing) {
        existing.planned_reels += allocReels;
        existing.required_reels = existing.planned_reels;
        existing.planned_weight_kg = Number((existing.planned_weight_kg + allocWeight).toFixed(2));
        existing.weight_kg = existing.planned_weight_kg;
        if (existing.planned_reels > 0) {
          existing.weight_per_reel_kg = Number((existing.planned_weight_kg / existing.planned_reels).toFixed(2));
        }
        existing.remaining_after_kg = Math.max(0, Number((existing.remaining_after_kg - allocWeight).toFixed(2)));
        existing.is_closed = existing.remaining_after_kg <= 0.01;
      } else {
        const remBefore = alloc.remaining_before_kg ?? allocWeight;
        const remAfter = alloc.remaining_after_kg !== undefined ? alloc.remaining_after_kg : Math.max(0, remBefore - allocWeight);
        aggregatedMap.set(orderKey, {
          order_id: alloc.order_id,
          sales_order: alloc.sales_order,
          item_number: alloc.item_number,
          customer: alloc.customer,
          width_mm: alloc.width_mm,
          length_m: alloc.length_m,
          ups: alloc.ups ?? 1,
          planned_reels: allocReels,
          required_reels: allocReels,
          weight_per_reel_kg: alloc.weight_per_reel_kg ?? Number((allocWeight / allocReels).toFixed(2)),
          planned_weight_kg: Number(allocWeight.toFixed(2)),
          weight_kg: Number(allocWeight.toFixed(2)),
          remaining_before_kg: remBefore,
          remaining_after_kg: remAfter,
          is_closed: alloc.is_closed ?? (remAfter <= 0.01),
        });
      }
    }
  }

  return Array.from(aggregatedMap.values());
}

/**
 * Validates order allocation headroom ceiling against demand map.
 */
export function validateOrderAllocationHeadroom(
  ordersCovered: (MetallizerPlanOrderAllocation | MetallizerSegmentOrderAllocation)[],
  orderDemandMap: Map<string, number>,
  maxOverheadFactor: number = MSL_CUSTOMER_MAX_OVERALLOCATION_FACTOR
): { isValid: boolean; is_valid: boolean; violations: string[]; errors: string[] } {
  const violations: string[] = [];

  const allocMap = new Map<string, { totalAllocated: number; salesOrder: string; itemNumber: number; orderId?: string }>();
  for (const cov of ordersCovered) {
    const key = cov.order_id || `${cov.sales_order}/${cov.item_number}`;
    const weight = cov.weight_kg ?? (cov as any).planned_weight_kg ?? 0;
    const existing = allocMap.get(key);
    if (existing) {
      existing.totalAllocated = Number((existing.totalAllocated + weight).toFixed(2));
    } else {
      allocMap.set(key, {
        totalAllocated: Number(weight.toFixed(2)),
        salesOrder: cov.sales_order,
        itemNumber: cov.item_number,
        orderId: cov.order_id,
      });
    }
  }

  for (const [key, info] of allocMap.entries()) {
    const demand = orderDemandMap.get(key) ?? (info.orderId ? orderDemandMap.get(info.orderId) : undefined) ?? orderDemandMap.get(`${info.salesOrder}/${info.itemNumber}`) ?? orderDemandMap.get(`${info.salesOrder}-${info.itemNumber}`);
    if (demand !== undefined && demand > 0) {
      const ceiling = Number((demand * maxOverheadFactor).toFixed(2));
      if (info.totalAllocated > ceiling + 0.05) {
        violations.push(
          `Headroom breach for order ${info.salesOrder}/${info.itemNumber}: Demand ${demand} kg, Ceiling ${ceiling} kg, Allocated ${info.totalAllocated.toFixed(2)} kg`
        );
      }
    }
  }

  return {
    isValid: violations.length === 0,
    is_valid: violations.length === 0,
    violations,
    errors: violations,
  };
}

export interface CreatePackageSegmentParams {
  segment_index: number;
  start_length_m: number;
  length_m: number;
  cuts: number[];
  master_width_mm: number;
  orders: (MetallizerSegmentOrderAllocation | MetallizerPlanOrderAllocation)[];
  shaft_distribution?: {
    front_cuts: number[];
    rear_cuts: number[];
    front_ups: number;
    rear_ups: number;
  };
  thickness_micron: number;
  density?: number;
  package_number?: number;
  notes?: string;
}

/**
 * Constructs a verified MetallizerPackageSegment with calculated trims, weights, waste %, and duplex shaft distribution.
 */
export function createPackageSegment(params: CreatePackageSegmentParams): MetallizerPackageSegment {
  const density = params.density ?? 0.91;
  const total_slit_width_mm = params.cuts.reduce((a, b) => a + b, 0);
  const trim_mm = params.master_width_mm - total_slit_width_mm;
  const end_length_m = params.start_length_m + params.length_m;
  const ups = params.cuts.length;

  const segment_weight_kg = Number(calculateJumboWeight(total_slit_width_mm, params.thickness_micron, density, params.length_m).toFixed(2));
  const trim_weight_kg = Number(calculateJumboWeight(trim_mm, params.thickness_micron, density, params.length_m).toFixed(2));
  const totalSegMass = segment_weight_kg + trim_weight_kg;
  const waste_percent = totalSegMass > 0 ? Number(((trim_weight_kg / totalSegMass) * 100).toFixed(2)) : 0;

  let shaft_distribution = params.shaft_distribution;
  if (!shaft_distribution && params.cuts.length > 0) {
    const derived = deriveDuplexShaftDistribution(params.cuts);
    shaft_distribution = {
      front_cuts: derived.front_cuts,
      rear_cuts: derived.rear_cuts,
      front_ups: derived.front_ups,
      rear_ups: derived.rear_ups,
    };
  }

  return {
    segment_index: params.segment_index,
    package_number: params.package_number ?? params.segment_index,
    start_length_m: params.start_length_m,
    end_length_m,
    length_m: params.length_m,
    cuts: [...params.cuts],
    finished_widths_covered: [...params.cuts],
    total_slit_width_mm,
    trim_mm,
    ups,
    orders_covered: params.orders,
    shaft_distribution,
    segment_weight_kg,
    trim_weight_kg,
    waste_percent,
    notes: params.notes,
  };
}

export interface CreateSegmentedJumboRequirementParams {
  id?: string;
  film: string;
  thickness_micron: number;
  master_width_mm: number;
  segments: MetallizerPackageSegment[];
  transitions?: DoffKnifeTransition[];
  core?: string;
  density?: number;
  required_rolls_count?: number; // Must be 1; values > 1 strictly rejected or enforced to 1
  created_by?: string;
  ps01_feasibility?: any;
  ps01_parent_deckle_id?: string;
  ps01_run_index?: number;
  ps01_cut_combination?: number[];
  planning_mode?: 'COMBINED' | 'SEPARATE' | 'SINGLE';
  compatible_group_key?: string;
  notes?: string;
  is_master_width_clustered?: boolean;
  master_width_cluster_id?: string;
  canonical_master_width_mm?: number;
}

/**
 * Constructs a verified multi-segment JumboRequirement (Wmaster x Ltotal) with M ordered package segments (PS1..PSM),
 * setting required_rolls_count = 1 (1:1 physical unity), computing dimensions/weights, setting finished_widths_covered = segments[0].cuts.
 */
export function createSegmentedJumboRequirement(
  params: CreateSegmentedJumboRequirementParams
): JumboRequirement {
  const density = params.density ?? 0.91;
  const core = params.core ?? '10-inch steel core';
  const totalLengthM = params.segments.reduce((acc, s) => acc + s.length_m, 0);

  // Compute total weight across segments and sync segment metrics
  let totalWeightKg = 0;
  for (const seg of params.segments) {
    const segCutsSum = seg.cuts.reduce((a, b) => a + b, 0);
    seg.total_slit_width_mm = segCutsSum;
    seg.trim_mm = params.master_width_mm - segCutsSum;
    seg.ups = seg.cuts.length;
    if (!seg.finished_widths_covered || seg.finished_widths_covered.length === 0) {
      seg.finished_widths_covered = [...seg.cuts];
    }
    const segWeight = Number(calculateJumboWeight(segCutsSum, params.thickness_micron, density, seg.length_m).toFixed(2));
    const trimWeight = Number(calculateJumboWeight(seg.trim_mm, params.thickness_micron, density, seg.length_m).toFixed(2));
    seg.segment_weight_kg = segWeight;
    seg.trim_weight_kg = trimWeight;
    seg.waste_percent = (segWeight + trimWeight) > 0 ? Number(((trimWeight / (segWeight + trimWeight)) * 100).toFixed(2)) : 0;
    totalWeightKg += (segWeight + trimWeight);

    if (!seg.shaft_distribution && seg.cuts.length > 0) {
      const derived = deriveDuplexShaftDistribution(seg.cuts);
      seg.shaft_distribution = {
        front_cuts: derived.front_cuts,
        rear_cuts: derived.rear_cuts,
        front_ups: derived.front_ups,
        rear_ups: derived.rear_ups,
      };
    }
  }

  const primarySeg = params.segments[0];
  const diameterMm = calculateJumboDiameter(params.thickness_micron, totalLengthM);
  const aggregatedAllocations = aggregateSegmentOrderAllocations(params.segments);
  const reqOrdersCovered = aggregatedAllocations.map(alloc => ({
    order_id: alloc.order_id,
    sales_order: alloc.sales_order,
    item_number: alloc.item_number,
    customer: alloc.customer,
    width_mm: alloc.width_mm,
    length_m: alloc.length_m,
    required_reels: alloc.required_reels ?? alloc.planned_reels ?? 1,
    weight_kg: alloc.weight_kg ?? alloc.planned_weight_kg ?? 0,
  }));
  const reqId = params.id || `JR-SEG-${Date.now()}`;

  return {
    id: reqId,
    film: params.film,
    thickness_micron: params.thickness_micron,
    required_jumbo_width_mm: params.master_width_mm,
    required_jumbo_length_m: totalLengthM,
    calculated_diameter_mm: diameterMm,
    core,
    required_rolls_count: 1, // MANDATORY: 1:1 physical unity
    ups: primarySeg.ups,
    finished_widths_covered: [...primarySeg.cuts],
    expected_trim_mm: primarySeg.trim_mm,
    trim_width_mm: primarySeg.trim_mm,
    orders_covered: reqOrdersCovered,
    package_multiple: params.segments.length,
    total_weight_kg: Number(totalWeightKg.toFixed(2)),
    efficiency_percent: Number((((params.master_width_mm - primarySeg.trim_mm) / params.master_width_mm) * 100).toFixed(1)),
    is_mutually_feasible: params.ps01_feasibility ? params.ps01_feasibility.is_feasible !== false : true,
    created_at: new Date().toISOString(),
    is_segmented: true,
    segments: params.segments,
    transitions: params.transitions ?? [],
    is_master_width_clustered: params.is_master_width_clustered ?? false,
    master_width_cluster_id: params.master_width_cluster_id,
    master_width_mm: params.master_width_mm,
    canonical_master_width_mm: params.canonical_master_width_mm ?? params.master_width_mm,
    ps01_feasibility: params.ps01_feasibility,
    ps01_parent_deckle_id: params.ps01_parent_deckle_id,
    ps01_run_index: params.ps01_run_index,
    ps01_cut_combination: params.ps01_cut_combination,
    planning_mode: params.planning_mode,
    compatible_group_key: params.compatible_group_key,
    notes: params.notes,
  };
}

/**
 * Phase 5: Campaign Optimizer Segmentation and Continuation Pass.
 * Scans candidate requirements within compatible film campaigns to identify valid package-boundary
 * segmented jumbo opportunities that eliminate unnecessary single-roll tails while strictly
 * preserving customer order slit widths, demand ceilings (<= 110%), and physical duplex invariants.
 */
export function applyCampaignSegmentationAndContinuation(
  requirements: JumboRequirement[],
  options?: {
    rules?: FilmCompatibilityRule[];
    maxJumboLengthM?: number;
    maxJumboDiameterMm?: number;
    orders?: VA05Order[];
  }
): JumboRequirement[] {
  const maxLen = options?.maxJumboLengthM || 60000;
  const maxDia = options?.maxJumboDiameterMm || 1250;
  const rules = options?.rules || DEFAULT_FILM_COMPATIBILITY_RULES;

  let pool = requirements.map(r => ({ ...r }));
  const mergedIds = new Set<string>();

  for (let i = 0; i < pool.length; i++) {
    const r1 = pool[i];
    if (mergedIds.has(r1.id) || r1.is_segmented) continue;

    for (let j = i + 1; j < pool.length; j++) {
      const r2 = pool[j];
      if (mergedIds.has(r2.id) || r2.is_segmented) continue;

      if (r1.thickness_micron !== r2.thickness_micron) continue;
      if (!areFilmsCompatible(r1.film, r2.film, rules)) continue;
      if ((r1.required_rolls_count || 1) !== 1 || (r2.required_rolls_count || 1) !== 1) continue;

      const totalLen = r1.required_jumbo_length_m + r2.required_jumbo_length_m;
      if (totalLen > maxLen) continue;

      const estimatedDia = calculateJumboDiameter(r1.thickness_micron || 18, totalLen);
      if (estimatedDia > maxDia) continue;

      const S1 = getPatternSlitSum(r1);
      const S2 = getPatternSlitSum(r2);
      if (S1 <= 0 || S2 <= 0) continue;

      const minW = Math.max(S1 + 18, S2 + 18);
      const maxW = Math.min(S1 + 45, S2 + 45);
      if (minW > maxW) continue;

      let canonicalW: number;
      if (r1.required_jumbo_width_mm >= minW && r1.required_jumbo_width_mm <= maxW) {
        canonicalW = r1.required_jumbo_width_mm;
      } else if (r2.required_jumbo_width_mm >= minW && r2.required_jumbo_width_mm <= maxW) {
        canonicalW = r2.required_jumbo_width_mm;
      } else {
        canonicalW = Math.round((minW + maxW) / 2);
      }

      const seg1 = createPackageSegment({
        segment_index: 1,
        start_length_m: 0,
        length_m: r1.required_jumbo_length_m,
        cuts: r1.finished_widths_covered || [],
        master_width_mm: canonicalW,
        orders: (r1.orders_covered || []).map(o => ({
          order_id: o.order_id,
          sales_order: o.sales_order,
          item_number: o.item_number,
          customer: o.customer,
          width_mm: o.width_mm,
          length_m: o.length_m,
          required_reels: o.required_reels,
          weight_kg: o.weight_kg,
          planned_weight_kg: o.weight_kg,
          remaining_before_kg: o.weight_kg,
          remaining_after_kg: 0,
          is_closed: true,
        })),
        thickness_micron: r1.thickness_micron,
      });

      const seg2 = createPackageSegment({
        segment_index: 2,
        start_length_m: r1.required_jumbo_length_m,
        length_m: r2.required_jumbo_length_m,
        cuts: r2.finished_widths_covered || [],
        master_width_mm: canonicalW,
        orders: (r2.orders_covered || []).map(o => ({
          order_id: o.order_id,
          sales_order: o.sales_order,
          item_number: o.item_number,
          customer: o.customer,
          width_mm: o.width_mm,
          length_m: o.length_m,
          required_reels: o.required_reels,
          weight_kg: o.weight_kg,
          planned_weight_kg: o.weight_kg,
          remaining_before_kg: o.weight_kg,
          remaining_after_kg: 0,
          is_closed: true,
        })),
        thickness_micron: r2.thickness_micron,
      });

      const trans = evaluateDoffKnifeTransition(seg1, seg2, canonicalW);
      if (!trans.is_valid || !trans.transition) continue;

      const segmentedReq = createSegmentedJumboRequirement({
        id: r1.id,
        film: r1.film,
        thickness_micron: r1.thickness_micron,
        master_width_mm: canonicalW,
        segments: [seg1, seg2],
        transitions: [trans.transition],
        core: r1.core,
        ps01_parent_deckle_id: r1.ps01_parent_deckle_id,
      });

      const valid = validateSegmentedJumboInvariants(segmentedReq);
      if (!valid.is_valid) continue;

      pool[i] = segmentedReq;
      mergedIds.add(r2.id);
      break;
    }
  }

  return pool.filter(r => !mergedIds.has(r.id));
}

/**
 * Phase 5: Campaign Master-Width Clustering Integration.
 * Evaluates candidate clusters of requirements across the campaign and applies dynamic trim-bounded
 * clustering to unify master widths, maximizing PS01 slitter deckle synchronization.
 */
export function applyCampaignMasterWidthClustering(
  requirements: JumboRequirement[],
  options?: {
    rules?: FilmCompatibilityRule[];
  }
): JumboRequirement[] {
  let pool = requirements.map(r => ({ ...r }));
  const clusteredIds = new Set<string>();

  for (let i = 0; i < pool.length; i++) {
    const r1 = pool[i];
    if (r1.is_segmented || clusteredIds.has(r1.id)) continue;

    const clusterCandidates: JumboRequirement[] = [r1];

    for (let j = i + 1; j < pool.length; j++) {
      const r2 = pool[j];
      if (r2.is_segmented || clusteredIds.has(r2.id)) continue;

      if (
        r1.film === r2.film &&
        r1.thickness_micron === r2.thickness_micron &&
        r1.package_multiple === r2.package_multiple &&
        r1.required_jumbo_length_m === r2.required_jumbo_length_m
      ) {
        const testCluster = [...clusterCandidates, r2];
        const evalRes = evaluateMasterWidthClustering(testCluster);
        if (evalRes.is_valid && evalRes.canonical_master_width_mm) {
          clusterCandidates.push(r2);
        }
      }
    }

    if (clusterCandidates.length > 1) {
      const evalRes = evaluateMasterWidthClustering(clusterCandidates);
      if (evalRes.is_valid && evalRes.canonical_master_width_mm) {
        const canonicalW = evalRes.canonical_master_width_mm;
        const clusterId = `cluster-${canonicalW}-${i}`;

        // Synchronize and update cutting combinations for all affected parent deckles
        const deckleGroups = new Map<string, JumboRequirement[]>();
        clusterCandidates.forEach(c => {
          if (c.ps01_parent_deckle_id) {
            if (!deckleGroups.has(c.ps01_parent_deckle_id)) {
              deckleGroups.set(c.ps01_parent_deckle_id, []);
            }
            deckleGroups.get(c.ps01_parent_deckle_id)!.push(c);
          }
        });

        for (const [deckleId, reqsInDeckle] of deckleGroups.entries()) {
          const firstInDeckle = reqsInDeckle[0];
          const origCombo = firstInDeckle.ps01_cut_combination || firstInDeckle.ps01_feasibility?.ps01_cut_combination;
          if (origCombo && origCombo.length >= 3 && origCombo.length <= 4) {
            const updatedCombo = [...origCombo];
            const isPureDeckle = origCombo.every(w => w === origCombo[0]);

            if (isPureDeckle) {
              // When a pure repeated-width PS cut combination has its width changed to a canonical/common width,
              // update ALL occurrences belonging to that deckle.
              for (let k = 0; k < updatedCombo.length; k++) {
                updatedCombo[k] = canonicalW;
              }
            } else {
              // For mixed deckles: replace all occurrences matching the requirements being clustered.
              // Note: A single JumboRequirement can occupy multiple slots in the pattern (e.g. 8 rolls with 4 repeat cycles = 2 cuts per set).
              const allReqsInPoolForDeckle = pool.filter(r => r.ps01_parent_deckle_id === deckleId);
              const clusteredOldWs = new Set(reqsInDeckle.map(r => r.required_jumbo_width_mm));
              for (const oldW of clusteredOldWs) {
                const poolReqsWithOldW = allReqsInPoolForDeckle.filter(r => r.required_jumbo_width_mm === oldW);
                const clustReqsWithOldW = reqsInDeckle.filter(r => r.required_jumbo_width_mm === oldW);
                if (poolReqsWithOldW.length === clustReqsWithOldW.length) {
                  for (let k = 0; k < updatedCombo.length; k++) {
                    if (updatedCombo[k] === oldW) {
                      updatedCombo[k] = canonicalW;
                    }
                  }
                } else {
                  let replaceSlots = clustReqsWithOldW.length;
                  for (let k = 0; k < updatedCombo.length; k++) {
                    if (updatedCombo[k] === oldW && replaceSlots > 0) {
                      updatedCombo[k] = canonicalW;
                      replaceSlots--;
                    }
                  }
                }
              }
            }
            const totalWeb = updatedCombo.reduce((a, b) => a + b, 0);
            const deckleForCombo = pool.find(r => r.ps01_parent_deckle_id === deckleId)?.ps01_feasibility?.ps01_deckle_mm || 10400;
            const trim = deckleForCombo - totalWeb;
            const eff = Number(((totalWeb / deckleForCombo) * 100).toFixed(2));

            // Lockstep update across ALL requirements in pool with this parent deckle
            for (let pIdx = 0; pIdx < pool.length; pIdx++) {
              if (pool[pIdx].ps01_parent_deckle_id === deckleId) {
                const old = pool[pIdx];
                pool[pIdx] = {
                  ...old,
                  ps01_cut_combination: updatedCombo,
                  ps01_feasibility: {
                    ...old.ps01_feasibility!,
                    ps01_cut_combination: updatedCombo,
                    ps01_total_width_mm: totalWeb,
                    ps01_trim_mm: trim,
                    ps01_deckle_efficiency_percent: eff,
                  }
                };
              }
            }
          }
        }

        const updated = applyMasterWidthClustering(clusterCandidates, evalRes, clusterId);
        for (let k = 0; k < clusterCandidates.length; k++) {
          const orig = clusterCandidates[k];
          const up = updated[k];
          const idx = pool.findIndex(r => r.id === orig.id);
          if (idx !== -1) {
            const currentDeckleCombo = pool[idx].ps01_cut_combination;
            pool[idx] = {
              ...up,
              ps01_cut_combination: currentDeckleCombo || up.ps01_cut_combination,
              ps01_feasibility: {
                ...up.ps01_feasibility,
                ps01_cut_combination: currentDeckleCombo || up.ps01_feasibility.ps01_cut_combination,
                ps01_total_width_mm: currentDeckleCombo ? currentDeckleCombo.reduce((a, b) => a + b, 0) : up.ps01_feasibility.ps01_total_width_mm,
                ps01_trim_mm: currentDeckleCombo
                  ? (up.ps01_feasibility?.ps01_deckle_mm || 10400) - currentDeckleCombo.reduce((a, b) => a + b, 0)
                  : up.ps01_feasibility.ps01_trim_mm,
              }
            };
            clusteredIds.add(orig.id);
          }
        }
      }
    }
  }

  return pool;
}

/**
 * Phase 7: MSL Execution Plan Consolidation.
 * Merges identical non-segmented MSL execution plans (same film, thickness, jumbo width,
 * package length, package multiple, and finished slit widths) into a single dispatch ticket.
 * Preserves individual physical roll tracking (consolidated_roll_ids) while eliminating ticket fatigue.
 */
export function consolidateMetallizerPlans(plans: MetallizerPlan[]): MetallizerPlan[] {
  const consolidated: MetallizerPlan[] = [];
  const merged = new Set<number>();

  for (let i = 0; i < plans.length; i++) {
    if (merged.has(i)) continue;
    const p1 = plans[i];

    if (p1.is_segmented) {
      consolidated.push({
        ...p1,
        is_consolidated: true,
        consolidated_rolls_count: 1,
        consolidated_roll_ids: [p1.jumbo_roll_id],
      });
      continue;
    }

    let rollCount = p1.consolidated_rolls_count || 1;
    const rollIds = [...(p1.consolidated_roll_ids || [p1.jumbo_roll_id])];
    let totalKg = p1.planned_quantity_kg;
    let trimKg = p1.trim_weight_kg;

    const matchingPlans = [p1];

    for (let j = i + 1; j < plans.length; j++) {
      if (merged.has(j)) continue;
      const p2 = plans[j];
      if (p2.is_segmented) continue;

      if (
        p1.film === p2.film &&
        p1.thickness_micron === p2.thickness_micron &&
        p1.jumbo_width_mm === p2.jumbo_width_mm &&
        p1.package_length_m === p2.package_length_m &&
        p1.package_multiple === p2.package_multiple &&
        p1.finished_sizes.length === p2.finished_sizes.length &&
        p1.finished_sizes.every((s, idx) => s === p2.finished_sizes[idx])
      ) {
        rollCount += p2.consolidated_rolls_count || 1;
        rollIds.push(...(p2.consolidated_roll_ids || [p2.jumbo_roll_id]));
        totalKg = Number((totalKg + p2.planned_quantity_kg).toFixed(2));
        trimKg = Number((trimKg + p2.trim_weight_kg).toFixed(2));
        matchingPlans.push(p2);
        merged.add(j);
      }
    }

    const orderMap = new Map<string, MetallizerPlanOrderAllocation>();
    for (const plan of matchingPlans) {
      for (const ord of plan.orders_covered) {
        const key = `${ord.order_id || ord.sales_order}_${ord.width_mm}_${ord.length_m}`;
        const ordReels = ord.planned_reels ?? (ord as any).required_reels ?? 1;
        const ordWeight = ord.planned_weight_kg ?? ord.weight_kg ?? 0;
        if (!orderMap.has(key)) {
          orderMap.set(key, {
            order_id: ord.order_id,
            sales_order: ord.sales_order,
            item_number: ord.item_number,
            customer: ord.customer,
            width_mm: ord.width_mm,
            length_m: ord.length_m,
            ups: ord.ups ?? 1,
            planned_reels: ordReels,
            weight_per_reel_kg: ord.weight_per_reel_kg ?? Number((ordWeight / ordReels).toFixed(2)),
            planned_weight_kg: Number(ordWeight.toFixed(2)),
            weight_kg: Number(ordWeight.toFixed(2)),
            remaining_before_kg: ord.remaining_before_kg ?? 0,
            remaining_after_kg: ord.remaining_after_kg ?? 0,
            is_closed: ord.is_closed ?? false,
          });
        } else {
          const existing = orderMap.get(key)!;
          existing.planned_reels += ordReels;
          existing.planned_weight_kg = Number((existing.planned_weight_kg + ordWeight).toFixed(2));
          existing.weight_kg = Number(((existing.weight_kg || 0) + ordWeight).toFixed(2));
          existing.remaining_after_kg = Math.min(existing.remaining_after_kg, ord.remaining_after_kg ?? 0);
          existing.is_closed = existing.is_closed || ord.is_closed || false;
        }
      }
    }

    consolidated.push({
      ...p1,
      is_consolidated: true,
      consolidated_rolls_count: rollCount,
      consolidated_roll_ids: rollIds,
      planned_quantity_kg: totalKg,
      trim_weight_kg: trimKg,
      orders_covered: Array.from(orderMap.values()),
    });
  }

  return consolidated;
}

/**
 * Metallizer Slitter Plan Optimizer
 * Generates execution slitting plans strictly against available physical jumbo rolls
 * Supports 1 to 6 UPS (MSL has 6 UPS available).
 * Enables multi-plan sequential jumbo roll reuse (e.g. 1 x 20,000m jumbo supplying Plan A 10,000m and Plan B 10,000m).
 */
export function generateMetallizerPlans(
  orders: VA05Order[],
  availableJumboRolls: JumboRoll[],
  rawSettings: MetallizerMachineSettings,
  selectedFilm?: string,
  rules: FilmCompatibilityRule[] = DEFAULT_FILM_COMPATIBILITY_RULES,
  options?: {
    consolidatePlans?: boolean;
    enableDynamicOrderContinuation?: boolean;
    enableHybridOptimization?: boolean;
    dynamicContinuationOptions?: DynamicContinuationOptions;
  }
): { plans: MetallizerPlan[]; remainingOrders: VA05Order[]; updatedRolls: JumboRoll[] } {
  const settings = { ...DEFAULT_METALLIZER_SETTINGS, ...rawSettings };
  // HARD RULE: Only usable MZ jumbo rolls are processed for Metallizer Slitter
  let usableRolls = availableJumboRolls.filter(r => 
    isMetallizedFilm(r.film) &&
    (r.status === 'AVAILABLE' || r.status === 'PARTIALLY_CONSUMED') && 
    r.remaining_length_m > 0 &&
    r.width_mm <= settings.max_jumbo_width_mm &&
    r.diameter_mm <= settings.max_jumbo_diameter_mm
  );

  if (selectedFilm && selectedFilm !== 'ALL') {
    const compatibleFilms = getCompatibleFilmsFor(selectedFilm, rules);
    usableRolls = usableRolls.filter(r => compatibleFilms.includes(r.film));

    // Sort rolls to prioritize:
    // 1. Exact film match over cross-film compatibility
    // 2. Rolls specifically synthesized for requirements (source_requirement)
    usableRolls.sort((a, b) => {
      const aExact = a.film === selectedFilm ? 1 : 0;
      const bExact = b.film === selectedFilm ? 1 : 0;
      if (bExact !== aExact) return bExact - aExact;

      const aReq = a.source_requirement ? 1 : 0;
      const bReq = b.source_requirement ? 1 : 0;
      if (bReq !== aReq) return bReq - aReq;

      return 0;
    });
  }

  if (usableRolls.length === 0) {
    return { plans: [], remainingOrders: orders, updatedRolls: availableJumboRolls };
  }

  const activeOrders = orders.map(o => ({ ...o }));
  const rollsPool = usableRolls.map(r => ({ ...r }));
  const generatedPlans: MetallizerPlan[] = [];
  let planCounter = 1;

  // Process available jumbo rolls sequentially, allowing EACH jumbo roll to supply
  // multiple MSL plans until its length is fully exhausted
  for (const roll of rollsPool) {
    let rollLoopCount = 0;
    const maxRollLoops = 50;

    while (roll.remaining_length_m > 0 && roll.status !== 'CONSUMED' && rollLoopCount < maxRollLoops) {
      rollLoopCount++;

      let best: MetallizerCandidatePattern | null = null;

      // Direct requirement contract execution if roll is bound to an approved requirement:
      if (roll.source_requirement) {
        const req = roll.source_requirement;

        // Phase 1 / Phase 3: Segmented requirement execution as a single physical entity
        if (isSegmentedJumboRequirement(req)) {
          const segments = req.segments || [];
          const transitions = req.transitions || [];

          // Aggregate allocations across all segments for this physical roll
          const aggregatedAllocations = aggregateSegmentOrderAllocations(segments);

          // Update live orders in activeOrders
          for (const alloc of aggregatedAllocations) {
            const liveOrd = activeOrders.find(o => o.id === alloc.order_id || (o.sales_order === alloc.sales_order && o.item_number === alloc.item_number));
            if (liveOrd) {
              const remBefore = liveOrd.remaining_qty;
              const remAfter = Math.max(0, Number((remBefore - (alloc.planned_weight_kg || alloc.weight_kg || 0)).toFixed(2)));
              liveOrd.remaining_qty = remAfter;
              liveOrd.produced_qty = Number((liveOrd.produced_qty + (alloc.planned_weight_kg || alloc.weight_kg || 0)).toFixed(2));
              liveOrd.status = remAfter <= 0.01 ? 'COMPLETED' : 'PARTIALLY_FULFILLED';
              alloc.remaining_before_kg = remBefore;
              alloc.remaining_after_kg = remAfter;
              alloc.is_closed = remAfter <= 0.01;
            }
          }

          const planId = `plan-msl-${Date.now()}-${planCounter}`;
          const planNumber = `MSL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(planCounter).padStart(3, '0')}`;
          planCounter++;

          const newPlan: MetallizerPlan = {
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
            ups: req.ups || segments[0]?.ups || 1,
            finished_sizes: segments[0]?.cuts || req.finished_widths_covered || [],
            total_slit_width_mm: segments[0]?.total_slit_width_mm || (req.required_jumbo_width_mm - (req.expected_trim_mm || 0)),
            trim_mm: segments[0]?.trim_mm || req.expected_trim_mm || 0,
            package_length_m: segments[0]?.length_m || Math.round(roll.length_m / (req.package_multiple || 1)),
            package_multiple: req.package_multiple || segments.length || 1,
            orders_covered: aggregatedAllocations,
            planned_quantity_kg: req.total_weight_kg,
            trim_weight_kg: Number((req.total_weight_kg * ((req.expected_trim_mm || 25) / roll.width_mm)).toFixed(2)),
            waste_percent: Number((((req.expected_trim_mm || 25) / roll.width_mm) * 100).toFixed(2)),
            consumed_length_m: roll.length_m,
            remaining_roll_length_m: 0,
            roll_status_after: 'CONSUMED',
            status: 'APPROVED',
            created_by: 'Planner Engine',
            created_at: new Date().toISOString(),
            // Phase 1 / Phase 3 Segmented Representation
            is_segmented: true,
            segments: segments,
            transitions: transitions,
            is_consolidated: true,
            consolidated_roll_ids: [roll.roll_id],
            consolidated_rolls_count: 1,
          };

          generatedPlans.push(newPlan);

          // Consume entire physical roll: ZERO sibling roll decomposition!
          roll.remaining_length_m = 0;
          roll.remaining_quantity_kg = 0;
          roll.status = 'CONSUMED';
          roll.consumed_by_plan = planNumber;
          roll.updated_at = new Date().toISOString();
          continue;
        }

        const rollCount = req.required_rolls_count || 1;
        const rollLen = roll.remaining_length_m;
        const pkgMult = req.package_multiple || 1;
        const pkgLen = Math.round(rollLen / pkgMult);
        const totalSlitWidth = (req.finished_widths_covered || []).reduce((a, b) => a + b, 0);
        const trimMm = req.expected_trim_mm !== undefined ? req.expected_trim_mm : Math.max(0, roll.width_mm - totalSlitWidth);
        const singleRollWeight = calculateJumboWeight(roll.width_mm, roll.thickness_micron, roll.density, rollLen);

        const orderPlanItems: {
          order: VA05Order;
          ups: number;
          width_mm: number;
          length_m: number;
          reels: number;
          weight_kg: number;
          is_closed: boolean;
        }[] = [];

        let totalWeight = 0;

        for (const cov of req.orders_covered) {
          const liveOrd = activeOrders.find(o => o.id === cov.order_id || (o.sales_order === cov.sales_order && o.item_number === cov.item_number));
          const plannedReels = Math.max(1, Math.round(cov.required_reels / rollCount));
          const plannedKg = Number((cov.weight_kg / rollCount).toFixed(2));
          totalWeight += plannedKg;

          orderPlanItems.push({
            order: liveOrd || ({ id: cov.order_id, sales_order: cov.sales_order, item_number: cov.item_number, customer: cov.customer, width_mm: cov.width_mm, length_m: cov.length_m, remaining_qty: plannedKg, produced_qty: 0 } as any),
            ups: 1,
            width_mm: cov.width_mm,
            length_m: cov.length_m,
            reels: plannedReels,
            weight_kg: plannedKg,
            is_closed: (liveOrd?.remaining_qty || 0) <= plannedKg + 0.01,
          });
        }

        const trimWeight = Number(calculateJumboWeight(trimMm, roll.thickness_micron, roll.density, rollLen).toFixed(2));
        const wastePct = singleRollWeight > 0 ? (trimWeight / singleRollWeight) * 100 : 0;

        best = {
          jumbo_roll: roll,
          ups: req.finished_widths_covered?.length || req.ups || 1,
          slit_widths: req.finished_widths_covered || [],
          orders: orderPlanItems,
          total_slit_width_mm: totalSlitWidth,
          trim_mm: trimMm,
          package_length_m: pkgLen,
          package_multiple: pkgMult,
          total_planned_weight_kg: totalWeight,
          trim_weight_kg: trimWeight,
          waste_percent: wastePct,
          score: 50000,
        };
      } else {
        // Fallback: unconstrained combinatorial search for unassigned or legacy inventory rolls
        const matchingOrders = activeOrders.filter(o => 
          isMetallizerOrder(o) &&
          o.remaining_qty > 0.01 && 
          areFilmsCompatible(o.film, roll.film, rules) && 
          (o.thickness_micron === roll.thickness_micron || !o.thickness_micron)
        );

        if (matchingOrders.length === 0) break;

        const candidates = findMSLCandidatePatterns(roll, activeOrders, settings, rules);
        if (candidates.length === 0) break;

        candidates.sort((a, b) => {
          const kgDiff = b.total_planned_weight_kg - a.total_planned_weight_kg;
          if (Math.abs(kgDiff) > 0.01) return kgDiff;
          const closedDiff = b.orders.filter(o => o.is_closed).length - a.orders.filter(o => o.is_closed).length;
          if (closedDiff !== 0) return closedDiff;
          const diaDiff = (b.jumbo_roll.diameter_mm || 0) - (a.jumbo_roll.diameter_mm || 0);
          if (Math.abs(diaDiff) > 1) return diaDiff;
          const lenDiff = (b.package_length_m * b.package_multiple) - (a.package_length_m * a.package_multiple);
          if (lenDiff !== 0) return lenDiff;
          const setupsA = new Set(a.slit_widths).size;
          const setupsB = new Set(b.slit_widths).size;
          if (setupsA !== setupsB) return setupsA - setupsB;
          return b.score - a.score;
        });
        best = candidates[0];
      }

      if (!best) break;

      const planId = `plan-msl-${Date.now()}-${planCounter}`;
      const planNumber = `MSL-${new Date().toISOString().slice(0,10).replace(/-/g, '')}-${String(planCounter).padStart(3, '0')}`;
      planCounter++;

      const consumedLength = best.package_length_m * best.package_multiple;
      const newRemainingLength = Math.max(0, roll.remaining_length_m - consumedLength);
      const rollStatusAfter = newRemainingLength <= 0 ? 'CONSUMED' : 'PARTIALLY_CONSUMED';

      const orderAllocations: MetallizerPlanOrderAllocation[] = best.orders.map(item => {
        const liveOrd = activeOrders.find(o => o.id === item.order.id)!;
        const remBefore = liveOrd.remaining_qty;
        const remAfter = Math.max(0, Number((remBefore - item.weight_kg).toFixed(2)));
        
        // Update order in place
        liveOrd.remaining_qty = remAfter;
        liveOrd.produced_qty = Number((liveOrd.produced_qty + item.weight_kg).toFixed(2));
        const isClosed = remAfter <= 0.01;
        liveOrd.status = isClosed ? 'COMPLETED' : 'PARTIALLY_FULFILLED';

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
          is_closed: isClosed,
        };
      });

      const newPlan: MetallizerPlan = {
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
      };

      generatedPlans.push(newPlan);

      // Update physical roll in inventory
      roll.remaining_length_m = newRemainingLength;
      roll.remaining_quantity_kg = calculateJumboWeight(roll.width_mm, roll.thickness_micron, roll.density, newRemainingLength);
      roll.status = rollStatusAfter;
      roll.consumed_by_plan = planNumber;
      roll.updated_at = new Date().toISOString();
    }
  }

  // Update complete rolls in available list
  const finalRolls = availableJumboRolls.map(r => {
    const updated = rollsPool.find(p => p.id === r.id);
    return updated || r;
  });

  const shouldConsolidate = options?.consolidatePlans ?? true;
  const finalPlans = shouldConsolidate ? consolidateMetallizerPlans(generatedPlans) : generatedPlans;

  return {
    plans: finalPlans,
    remainingOrders: activeOrders,
    updatedRolls: finalRolls,
  };
}

/**
 * Dynamic Asynchronous MSL Customer-Job Continuation Optimization.
 * Directly runs the multi-step dynamic continuation engine across pending orders.
 */
export function generateDynamicContinuousMSLPlans(
  orders: VA05Order[],
  rawSettings: MetallizerMachineSettings,
  selectedFilm?: string,
  options?: DynamicContinuationOptions
) {
  return runDynamicCampaignOptimization(orders, rawSettings, selectedFilm, options);
}


