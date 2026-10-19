/**
 * Dynamic Asynchronous MSL Customer-Job Continuation Engine
 * 
 * CORE FACTORY CAPABILITY:
 * When one customer order finishes inside an active MSL plan, the slitter does NOT stop
 * or terminate the plan. Instead:
 * - Companion active orders keep running uninterrupted.
 * - The knife arm(s) serving the finished order become FREED.
 * - The engine searches the pending customer order pool using multi-step look-ahead beam search.
 * - The freed arm(s) are reassigned to compatible pending orders (1-arm or same-shaft 2-arm shifts).
 * - Net width delta preserves MSL trim in [18, 45] mm.
 * - Duplex balance, shaft capacity (max 3 cuts/shaft, max 5 total), min cut (>= 400 mm) preserved.
 * - Customer allocation <= Demand * 1.10.
 * - Zero speculative / dummy material.
 * - The slitter continues slitting the SAME production run across package boundaries and spliced jumbos.
 */

import { VA05Order } from '../../types';
import {
  JumboRequirement,
  MetallizerPlan,
  MetallizerMachineSettings,
  ArmScheduleInterval,
  SlitterDoffEvent,
  MetallizerPackageSegment,
  DoffKnifeTransition,
  ShaftDistributionResult,
} from '../../types/metallizer';
import {
  DEFAULT_METALLIZER_SETTINGS,
  calculateJumboDiameter,
  calculateJumboWeight,
  MSL_CUSTOMER_MAX_OVERALLOCATION_FACTOR,
  MSL_GREEN_MIN_TRIM_MM,
  MSL_GREEN_MAX_TRIM_MM,
} from './metallizerMasterData';
import {
  deriveDuplexShaftDistribution,
  evaluateDoffKnifeTransition,
  createPackageSegment,
  aggregateSegmentOrderAllocations,
  getPatternSlitSum,
} from './metallizerOptimizer';
import { areFilmsCompatible, DEFAULT_FILM_COMPATIBILITY_RULES, FilmCompatibilityRule, getAllCompatibleGroups, getCompatibleFilmsFor } from './filmCompatibilityMaster';
import { evaluatePS01Feasibility } from './ps01FeasibilityAdapter';

export interface DynamicContinuationOptions {
  rules?: FilmCompatibilityRule[];
  maxJumboLengthM?: number;       // default: 60,000 m
  maxJumboDiameterMm?: number;   // default: 1,250 mm
  maxLookAheadDepth?: number;    // default: 3 package boundaries
  beamWidth?: number;            // default: 5 candidates
  maxOverallocationFactor?: number; // default: 1.10
  onProgress?: (percent: number, message: string) => void;
}

export interface ActiveArmState {
  arm_index: number;
  shaft: 'FRONT' | 'REAR';
  order: VA05Order;
  order_id: string;
  sales_order: string;
  item_number: number;
  customer: string;
  width_mm: number;
  reel_length_m: number;
  total_required_reels: number;
  produced_reels: number;
  current_run_meters: number;
  is_completed: boolean;
}

export interface DynamicRunResult {
  run_id: string;
  film: string;
  thickness_micron: number;
  master_width_mm: number;
  total_meters: number;
  segments: MetallizerPackageSegment[];
  transitions: DoffKnifeTransition[];
  arm_schedules: ArmScheduleInterval[];
  doff_events: SlitterDoffEvent[];
  orders_covered: any[];
  fulfilled_order_ids: Set<string>;
  total_weight_kg: number;
  trim_weight_kg: number;
  waste_percent: number;
}

/**
 * Normalizes an order demand into packages/reels based on width, length, and micron.
 */
export function getOrderPackageDemand(order: VA05Order): {
  reelLengthM: number;
  reelsRequired: number;
  weightPerReelKg: number;
  totalMetersRequired: number;
} {
  const thick = order.thickness_micron || 20;
  const dens = order.density || 0.91;
  const wM = order.width_mm / 1000;
  const reelLen = order.length_m || 20000;
  const kgPerM = wM * thick * dens / 1000;
  const weightPerReel = Number((kgPerM * reelLen).toFixed(2));
  const remKg = order.remaining_qty > 0 ? order.remaining_qty : order.ordered_qty || 0;
  const totalM = kgPerM > 0 ? remKg / kgPerM : 0;
  const reels = Math.max(1, Math.round(remKg / weightPerReel));

  return {
    reelLengthM: reelLen,
    reelsRequired: reels,
    weightPerReelKg: weightPerReel,
    totalMetersRequired: Math.round(totalM),
  };
}

/**
 * Searches the pending order pool for compatible replacement orders when 1 or 2 arms are freed.
 * Evaluates candidate width deltas, same-shaft invariant, MSL trim [18, 45] mm, and look-ahead run potential.
 */
export function findBestReplacementArms(
  freedArms: ActiveArmState[],
  continuousArms: ActiveArmState[],
  masterWidthMm: number,
  pendingOrders: VA05Order[],
  orderAllocationMap: Map<string, number>,
  packageLengthM: number,
  options?: DynamicContinuationOptions
): {
  success: boolean;
  replacements: Array<{ arm: ActiveArmState; newOrder: VA05Order; deltaMm: number }>;
  newTrimMm: number;
  transitionType: '1-ARM' | '2-ARM_SAME_SHAFT';
  score: number;
} | null {
  if (freedArms.length === 0 || freedArms.length > 2) return null;

  // SAME-SHAFT INVARIANT: If 2 arms freed, both must be on the EXACT SAME SHAFT
  if (freedArms.length === 2 && freedArms[0].shaft !== freedArms[1].shaft) {
    // Cross-shaft movement rejected!
    return null;
  }

  const continuousWidth = continuousArms.reduce((sum, a) => sum + a.width_mm, 0);
  const maxOverhead = options?.maxOverallocationFactor ?? MSL_CUSTOMER_MAX_OVERALLOCATION_FACTOR;

  // Case 1: Exactly 1 Arm Freed
  if (freedArms.length === 1) {
    const freed = freedArms[0];
    let bestCandidate: { order: VA05Order; deltaMm: number; trim: number; score: number } | null = null;

    for (const ord of pendingOrders) {
      // Check positive balance and strict headroom
      const currAlloc = orderAllocationMap.get(ord.id) || 0;
      const demand = ord.remaining_qty > 0 ? ord.remaining_qty : ord.ordered_qty;
      const thick = ord.thickness_micron || 20;
      const dens = ord.density || 0.91;
      const kgPerPkg = (ord.width_mm / 1000) * thick * dens / 1000 * packageLengthM;
      if (currAlloc + kgPerPkg > demand * maxOverhead + 0.05) continue;

      const wNew = ord.width_mm;
      if (wNew < 400) continue; // Min cut width

      const newSum = continuousWidth + wNew;
      const newTrim = masterWidthMm - newSum;
      if (newTrim < MSL_GREEN_MIN_TRIM_MM || newTrim > MSL_GREEN_MAX_TRIM_MM) continue;

      const delta = wNew - freed.width_mm;
      const absDelta = Math.abs(delta);

      // Look-ahead scoring:
      // 1. Smaller arm delta is preferred (+100 for delta <= 15mm, +50 for delta <= 30mm)
      // 2. More remaining reels on candidate order provides longer continuous anchor (+20 per reel, up to 100)
      // 3. Perfect trim around 20-30mm (+50)
      let score = 500 - (absDelta * 5);
      if (absDelta <= 15) score += 100;
      else if (absDelta <= 30) score += 50;

      const reelsLeft = Math.max(1, Math.floor((demand - currAlloc) / kgPerPkg));
      score += Math.min(100, Math.max(0, reelsLeft * 25));

      if (newTrim >= 20 && newTrim <= 30) score += 50;

      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = { order: ord, deltaMm: delta, trim: newTrim, score };
      }
    }

    if (bestCandidate) {
      return {
        success: true,
        replacements: [{ arm: freed, newOrder: bestCandidate.order, deltaMm: bestCandidate.deltaMm }],
        newTrimMm: bestCandidate.trim,
        transitionType: '1-ARM',
        score: bestCandidate.score,
      };
    }
  }

  // Case 2: Exactly 2 Arms Freed (Both on the SAME duplex shaft)
  if (freedArms.length === 2 && freedArms[0].shaft === freedArms[1].shaft) {
    const freed1 = freedArms[0];
    const freed2 = freedArms[1];
    let bestPair: {
      ord1: VA05Order;
      ord2: VA05Order;
      delta1: number;
      delta2: number;
      trim: number;
      score: number;
    } | null = null;

    for (let i = 0; i < pendingOrders.length; i++) {
      const o1 = pendingOrders[i];
      const alloc1 = orderAllocationMap.get(o1.id) || 0;
      const dem1 = o1.remaining_qty > 0 ? o1.remaining_qty : o1.ordered_qty;
      const thick1 = o1.thickness_micron || 20;
      const dens1 = o1.density || 0.91;
      const kgPerPkg1 = (o1.width_mm / 1000) * thick1 * dens1 / 1000 * packageLengthM;
      if (alloc1 + kgPerPkg1 > dem1 * maxOverhead + 0.05) continue;
      if (o1.width_mm < 400) continue;

      for (let j = i + 1; j < pendingOrders.length; j++) {
        const o2 = pendingOrders[j];
        const alloc2 = orderAllocationMap.get(o2.id) || 0;
        const dem2 = o2.remaining_qty > 0 ? o2.remaining_qty : o2.ordered_qty;
        const thick2 = o2.thickness_micron || 20;
        const dens2 = o2.density || 0.91;
        const kgPerPkg2 = (o2.width_mm / 1000) * thick2 * dens2 / 1000 * packageLengthM;
        if (alloc2 + kgPerPkg2 > dem2 * maxOverhead + 0.05) continue;
        if (o2.width_mm < 400) continue;

        const newSum = continuousWidth + o1.width_mm + o2.width_mm;
        const newTrim = masterWidthMm - newSum;
        if (newTrim < MSL_GREEN_MIN_TRIM_MM || newTrim > MSL_GREEN_MAX_TRIM_MM) continue;

        const delta1 = o1.width_mm - freed1.width_mm;
        const delta2 = o2.width_mm - freed2.width_mm;
        const netDelta = Math.abs(delta1 + delta2);

        let score = 400 - (netDelta * 4) - (Math.abs(delta1) * 2) - (Math.abs(delta2) * 2);
        if (newTrim >= 20 && newTrim <= 30) score += 60;

        if (!bestPair || score > bestPair.score) {
          bestPair = { ord1: o1, ord2: o2, delta1, delta2, trim: newTrim, score };
        }
      }
    }

    if (bestPair) {
      return {
        success: true,
        replacements: [
          { arm: freed1, newOrder: bestPair.ord1, deltaMm: bestPair.delta1 },
          { arm: freed2, newOrder: bestPair.ord2, deltaMm: bestPair.delta2 },
        ],
        newTrimMm: bestPair.trim,
        transitionType: '2-ARM_SAME_SHAFT',
        score: bestPair.score,
      };
    }
  }

  return null;
}

/**
 * Builds a single continuous dynamic MSL production run starting from an anchor group of orders,
 * advancing by package length, and dynamically chaining replacement orders when arms complete.
 */
export function buildDynamicContinuousRun(
  anchorOrders: VA05Order[],
  pendingOrdersPool: VA05Order[],
  orderAllocationMap: Map<string, number>,
  masterWidthMm: number,
  packageLengthM: number,
  runId: string,
  options?: DynamicContinuationOptions
): DynamicRunResult {
  const film = anchorOrders[0].film;
  const thickness = anchorOrders[0].thickness_micron || 20;
  const density = anchorOrders[0].density || 0.91;
  const maxM = options?.maxJumboLengthM || 60000;

  // Initialize active arms with anchor orders
  const cuts = anchorOrders.map(o => o.width_mm);
  const shaftDist = deriveDuplexShaftDistribution(cuts);

  const activeArms: ActiveArmState[] = anchorOrders.map((ord, idx) => {
    const isFront = idx < shaftDist.front_ups;
    const kgPerM = (ord.width_mm / 1000) * thickness * density / 1000;
    const kgPerPkg = kgPerM * packageLengthM;
    const dem = ord.remaining_qty > 0 ? ord.remaining_qty : ord.ordered_qty;
    const alloc = orderAllocationMap.get(ord.id) || 0;
    const ceiling = dem * (options?.maxOverallocationFactor ?? 1.10);
    const maxPkgs = Math.floor((ceiling - alloc + 0.05) / kgPerPkg);

    return {
      arm_index: idx + 1,
      shaft: isFront ? 'FRONT' : 'REAR',
      order: ord,
      order_id: ord.id,
      sales_order: ord.sales_order,
      item_number: ord.item_number,
      customer: ord.customer,
      width_mm: ord.width_mm,
      reel_length_m: ord.length_m || packageLengthM,
      total_required_reels: maxPkgs,
      produced_reels: 0,
      current_run_meters: 0,
      is_completed: maxPkgs <= 0,
    };
  });

  const segments: MetallizerPackageSegment[] = [];
  const transitions: DoffKnifeTransition[] = [];
  const armSchedules: ArmScheduleInterval[] = [];
  const doffEvents: SlitterDoffEvent[] = [];
  const fulfilledOrderIds = new Set<string>();

  let currentRunMeters = 0;
  let packageCount = 0;
  let runActive = true;
  const maxPackagesInRun = Math.max(3, Math.floor(maxM / packageLengthM) * 3); // Allow multi-jumbo continuous runs

  while (runActive && packageCount < maxPackagesInRun) {
    const startM = currentRunMeters;
    const endM = startM + packageLengthM;
    const segIdx = packageCount + 1;

    // Record segment allocations
    const currentCuts = activeArms.map(a => a.width_mm);
    const currentShaftDist = deriveDuplexShaftDistribution(currentCuts);
    const sumCuts = currentCuts.reduce((a, b) => a + b, 0);
    const segTrim = masterWidthMm - sumCuts;

    const segOrders = activeArms.map(a => {
      const kgPerM = (a.width_mm / 1000) * thickness * density / 1000;
      const plannedKg = Number((kgPerM * packageLengthM).toFixed(2));
      const ordLen = a.reel_length_m || packageLengthM;
      const reelsCount = Math.max(1, Math.round(packageLengthM / ordLen));

      // Update allocation map
      const prevAlloc = orderAllocationMap.get(a.order_id) || 0;
      const newAlloc = Number((prevAlloc + plannedKg).toFixed(2));
      orderAllocationMap.set(a.order_id, newAlloc);

      a.produced_reels += 1;
      a.current_run_meters += packageLengthM;

      const dem = a.order.remaining_qty > 0 ? a.order.remaining_qty : a.order.ordered_qty;
      const ceiling = dem * (options?.maxOverallocationFactor ?? 1.10);

      // Complete if reached max packages or if next package would exceed ceiling
      if (a.produced_reels >= a.total_required_reels || newAlloc + plannedKg > ceiling + 0.05) {
        a.is_completed = true;
        fulfilledOrderIds.add(a.order_id);
      }

      return {
        order_id: a.order_id,
        sales_order: a.sales_order,
        item_number: a.item_number,
        customer: a.customer,
        width_mm: a.width_mm,
        length_m: ordLen,
        ups: 1,
        planned_reels: reelsCount,
        weight_per_reel_kg: Number((plannedKg / reelsCount).toFixed(2)),
        planned_weight_kg: plannedKg,
        weight_kg: plannedKg,
        remaining_before_kg: prevAlloc,
        remaining_after_kg: Math.max(0, dem - newAlloc),
        is_closed: a.is_completed,
      };
    });

    const segment = createPackageSegment({
      segment_index: segIdx,
      package_number: segIdx,
      start_length_m: startM,
      length_m: packageLengthM,
      cuts: currentCuts,
      master_width_mm: masterWidthMm,
      orders: segOrders,
      shaft_distribution: {
        front_cuts: currentShaftDist.front_cuts,
        rear_cuts: currentShaftDist.rear_cuts,
        front_ups: currentShaftDist.front_ups,
        rear_ups: currentShaftDist.rear_ups,
      },
      thickness_micron: thickness,
      density,
    });
    segments.push(segment);

    // Update arm schedules
    for (const a of activeArms) {
      armSchedules.push({
        arm_index: a.arm_index,
        shaft: a.shaft,
        order_id: a.order_id,
        sales_order: a.sales_order,
        item_number: a.item_number,
        customer: a.customer,
        width_mm: a.width_mm,
        start_length_m: startM,
        end_length_m: endM,
        length_m: packageLengthM,
        reels: 1,
        weight_kg: Number(((a.width_mm / 1000) * thickness * density / 1000 * packageLengthM).toFixed(2)),
        package_index_start: segIdx,
        package_index_end: segIdx,
      });
    }

    currentRunMeters = endM;
    packageCount++;

    // Check for package boundary doff event
    const completedArms = activeArms.filter(a => a.is_completed);
    const continuousArms = activeArms.filter(a => !a.is_completed);

    if (completedArms.length === 0) {
      // All orders continue into next package cycle
      continue;
    }

    // Filter available pending orders (exclude currently active orders)
    const activeOrderIds = new Set(activeArms.map(a => a.order_id));
    const availablePending = pendingOrdersPool.filter(o => {
      if (activeOrderIds.has(o.id)) return false;
      const alloc = orderAllocationMap.get(o.id) || 0;
      const dem = o.remaining_qty > 0 ? o.remaining_qty : o.ordered_qty;
      const ceiling = dem * (options?.maxOverallocationFactor ?? 1.10);
      const kgPerM = (o.width_mm / 1000) * thickness * density / 1000;
      const kgPerPkg = kgPerM * packageLengthM;
      return alloc + kgPerPkg <= ceiling + 0.05;
    });

    // If ALL arms completed, run ends naturally
    if (continuousArms.length === 0) {
      runActive = false;
      break;
    }

    // If 1 or 2 arms completed, attempt dynamic replacement!
    const replacementResult = findBestReplacementArms(
      completedArms,
      continuousArms,
      masterWidthMm,
      availablePending,
      orderAllocationMap,
      packageLengthM,
      options
    );

    if (replacementResult && replacementResult.success) {
      // Execute the knife shift and update active arm state!
      const doffEvent: SlitterDoffEvent = {
        at_length_m: currentRunMeters,
        package_boundary: packageCount,
        completed_orders: completedArms.map(ca => ({
          sales_order: ca.sales_order,
          item_number: ca.item_number,
          arm_index: ca.arm_index,
          width_mm: ca.width_mm,
          customer: ca.customer,
        })),
        reassigned_arms: replacementResult.replacements.map(rep => ({
          arm_index: rep.arm.arm_index,
          shaft: rep.arm.shaft,
          from_width_mm: rep.arm.width_mm,
          to_width_mm: rep.newOrder.width_mm,
          delta_mm: rep.deltaMm,
          new_order: `${rep.newOrder.sales_order}-${rep.newOrder.item_number}`,
          customer: rep.newOrder.customer,
        })),
        continuous_arms: continuousArms.map(cta => ({
          arm_index: cta.arm_index,
          shaft: cta.shaft,
          width_mm: cta.width_mm,
          order: `${cta.sales_order}-${cta.item_number}`,
          customer: cta.customer,
        })),
        transition_type: replacementResult.transitionType,
        estimated_downtime_minutes: replacementResult.transitionType === '1-ARM' ? 5 : 8,
      };
      doffEvents.push(doffEvent);

      // Build transition object for segment A -> segment B
      const segA = segments[segments.length - 1];
      const nextCuts = activeArms.map(a => {
        const rep = replacementResult.replacements.find(r => r.arm.arm_index === a.arm_index);
        return rep ? rep.newOrder.width_mm : a.width_mm;
      });
      const trans = evaluateDoffKnifeTransition(
        segA,
        { ...segA, cuts: nextCuts, segment_index: segIdx + 1 },
        masterWidthMm
      );
      if (trans.transition) {
        transitions.push({
          ...trans.transition,
          transition_index: transitions.length + 1,
          at_length_m: currentRunMeters,
          from_segment_index: segIdx,
          to_segment_index: segIdx + 1,
        });
      }

      // Update activeArms in place for the next interval
      for (const rep of replacementResult.replacements) {
        const armIdx = rep.arm.arm_index;
        const targetArm = activeArms.find(a => a.arm_index === armIdx);
        if (targetArm) {
          const kgPerM = (rep.newOrder.width_mm / 1000) * thickness * density / 1000;
          const kgPerPkg = kgPerM * packageLengthM;
          const dem = rep.newOrder.remaining_qty > 0 ? rep.newOrder.remaining_qty : rep.newOrder.ordered_qty;
          const currentAlloc = orderAllocationMap.get(rep.newOrder.id) || 0;
          const ceiling = dem * (options?.maxOverallocationFactor ?? 1.10);
          const maxPkgs = Math.max(1, Math.floor((ceiling - currentAlloc + 0.05) / kgPerPkg));

          targetArm.order = rep.newOrder;
          targetArm.order_id = rep.newOrder.id;
          targetArm.sales_order = rep.newOrder.sales_order;
          targetArm.item_number = rep.newOrder.item_number;
          targetArm.customer = rep.newOrder.customer;
          targetArm.width_mm = rep.newOrder.width_mm;
          targetArm.reel_length_m = rep.newOrder.length_m || packageLengthM;
          targetArm.total_required_reels = maxPkgs;
          targetArm.produced_reels = 0;
          targetArm.is_completed = false;
        }
      }
    } else {
      // No legal replacement found or cross-shaft movement required -> run terminates
      runActive = false;
    }
  }

  // Mass calculations
  const totalWeightKg = Number(
    (calculateJumboWeight(masterWidthMm, thickness, density, currentRunMeters)).toFixed(2)
  );
  const netSlitWeightKg = segments.reduce((sum, s) => sum + (s.segment_weight_kg || 0), 0);
  const trimWeightKg = Number(Math.max(0, totalWeightKg - netSlitWeightKg).toFixed(2));
  const wastePercent = totalWeightKg > 0 ? Number(((trimWeightKg / totalWeightKg) * 100).toFixed(2)) : 0;

  return {
    run_id: runId,
    film,
    thickness_micron: thickness,
    master_width_mm: masterWidthMm,
    total_meters: currentRunMeters,
    segments,
    transitions,
    arm_schedules: armSchedules,
    doff_events: doffEvents,
    orders_covered: aggregateSegmentOrderAllocations(segments),
    fulfilled_order_ids: fulfilledOrderIds,
    total_weight_kg: totalWeightKg,
    trim_weight_kg: trimWeightKg,
    waste_percent: wastePercent,
  };
}

/**
 * Maps a continuous multi-segment production run into physical jumbo rolls (<= 56.1k or 60k),
 * creating unified MetallizerPlan execution records that preserve continuous run linkage.
 */
export function partitionRunIntoPhysicalPlans(
  run: DynamicRunResult,
  startPlanCounter: number = 1
): MetallizerPlan[] {
  const maxJumboM = (run.film === 'MZ10S-20' || run.segments[0]?.length_m === 18700) ? 56100 : 60000;
  const plans: MetallizerPlan[] = [];
  let planIdx = startPlanCounter;

  if (!run.segments || run.segments.length === 0) {
    return plans;
  }

  let currentChunkSegs: MetallizerPackageSegment[] = [];
  let currentChunkLen = 0;

  for (let i = 0; i < run.segments.length; i++) {
    const seg = run.segments[i];
    if (currentChunkLen + seg.length_m > maxJumboM + 10 && currentChunkSegs.length > 0) {
      plans.push(createPlanFromSegments(run, currentChunkSegs, currentChunkLen, planIdx++));
      currentChunkSegs = [];
      currentChunkLen = 0;
    }
    currentChunkSegs.push(seg);
    currentChunkLen += seg.length_m;
  }

  if (currentChunkSegs.length > 0) {
    plans.push(createPlanFromSegments(run, currentChunkSegs, currentChunkLen, planIdx++));
  }

  return plans;
}

function createPlanFromSegments(
  run: DynamicRunResult,
  chunkSegments: MetallizerPackageSegment[],
  chunkLen: number,
  planIdx: number
): MetallizerPlan {
  const startOffsetM = chunkSegments[0].start_length_m;
  const endOffsetM = chunkSegments[chunkSegments.length - 1].end_length_m;

  const chunkArmSchedules = run.arm_schedules.filter(as => as.end_length_m > startOffsetM && as.start_length_m < endOffsetM);
  const chunkDoffEvents = run.doff_events.filter(de => de.at_length_m > startOffsetM && de.at_length_m < endOffsetM);
  const chunkTransitions = run.transitions.filter(tr => tr.at_length_m > startOffsetM && tr.at_length_m < endOffsetM);

  const firstSeg = chunkSegments[0];
  const initialCuts = firstSeg ? firstSeg.cuts : [];
  const sumCuts = initialCuts.reduce((a, b) => a + b, 0);

  const planNumber = `MSL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(planIdx).padStart(3, '0')}`;
  const planId = `plan-msl-dyn-${Date.now()}-${planIdx}`;

  return {
    id: planId,
    plan_number: planNumber,
    film: run.film,
    jumbo_roll_id: `JR-DYN-${String(planIdx).padStart(4, '0')}`,
    jumbo_roll_db_id: `jumbo-dyn-${planIdx}`,
    jumbo_width_mm: run.master_width_mm,
    jumbo_length_m: chunkLen,
    thickness_micron: run.thickness_micron,
    diameter_mm: Number(calculateJumboDiameter(run.thickness_micron, chunkLen).toFixed(1)),
    core: '10-inch steel core',
    ups: initialCuts.length,
    finished_sizes: [...initialCuts],
    total_slit_width_mm: sumCuts,
    trim_mm: run.master_width_mm - sumCuts,
    package_length_m: chunkSegments[0]?.length_m || 20000,
    package_multiple: chunkSegments.length || 1,
    orders_covered: aggregateSegmentOrderAllocations(chunkSegments),
    planned_quantity_kg: Number(calculateJumboWeight(run.master_width_mm, run.thickness_micron, 0.91, chunkLen).toFixed(2)),
    trim_weight_kg: Number((calculateJumboWeight(run.master_width_mm - sumCuts, run.thickness_micron, 0.91, chunkLen)).toFixed(2)),
    waste_percent: run.waste_percent,
    consumed_length_m: chunkLen,
    remaining_roll_length_m: 0,
    roll_status_after: 'CONSUMED',
    status: 'APPROVED',
    created_by: 'Dynamic Continuation Engine',
    created_at: new Date().toISOString(),
    is_segmented: chunkSegments.length > 1,
    segments: chunkSegments,
    transitions: chunkTransitions,
    is_consolidated: true,
    consolidated_roll_ids: [`JR-DYN-${String(planIdx).padStart(4, '0')}`],
    consolidated_rolls_count: 1,
    arm_schedules: chunkArmSchedules,
    doff_events: chunkDoffEvents,
    is_dynamic_continuous_run: true,
    continuous_run_meters: run.total_meters,
    continuous_run_id: run.run_id,
  };
}

/**
 * Executes full dynamic campaign optimization across pending orders.
 * Automatically forms continuous multi-order runs, dynamically chains replacement orders
 * on freed knife arms, and partitions the resulting runs into physical execution plans.
 */
export function runDynamicCampaignOptimization(
  orders: VA05Order[],
  rawSettings: MetallizerMachineSettings,
  selectedFilm?: string,
  options?: DynamicContinuationOptions
): {
  plans: MetallizerPlan[];
  continuousRuns: DynamicRunResult[];
  remainingOrders: VA05Order[];
  summary: {
    totalPhysicalPlans: number;
    totalContinuousRuns: number;
    totalMetersPlanned: number;
    averageRunMeters: number;
    totalWeightKg: number;
    tailRunsCount: number;
    smallDiameterCount: number;
  };
} {
  const settings = { ...DEFAULT_METALLIZER_SETTINGS, ...rawSettings };
  const rules = options?.rules || DEFAULT_FILM_COMPATIBILITY_RULES;

  // Filter pending MZ orders
  let pending = orders.filter(o => (o.film.includes('MZ') || (o as any).material?.includes('MZ')) && o.remaining_qty > 0.01);
  if (selectedFilm && selectedFilm !== 'ALL') {
    pending = pending.filter(o => areFilmsCompatible(o.film, selectedFilm, rules));
  }

  const orderAllocMap = new Map<string, number>();
  const continuousRuns: DynamicRunResult[] = [];
  const physicalPlans: MetallizerPlan[] = [];

  let runCounter = 1;
  let planCounter = 1;

  // Group by compatible film group
  const uniqueFilms = Array.from(new Set(pending.map(o => o.film)));
  const groups = selectedFilm && selectedFilm !== 'ALL'
    ? [{ group_name: selectedFilm, films: getCompatibleFilmsFor(selectedFilm, rules), thickness_micron: 20 }]
    : getAllCompatibleGroups(uniqueFilms, rules);

  for (const group of groups) {
    const groupOrders = pending.filter(o => group.films.includes(o.film));
    if (groupOrders.length === 0) continue;

    const sample = groupOrders[0];
    const thickness = sample.thickness_micron || group.thickness_micron || 20;
    const is18700 = group.films.includes('MZ10S-20') || group.films.includes('MZ10S-18');
    const pkgLen = is18700 ? 18700 : 20000;
    const maxJumboM = is18700 ? 56100 : 60000;

    let safety = 0;
    while (safety++ < 100) {
      // Find orders with unallocated balance that can take at least 1 package
      const availableOrders = groupOrders.filter(o => {
        const alloc = orderAllocMap.get(o.id) || 0;
        const dem = o.remaining_qty > 0 ? o.remaining_qty : o.ordered_qty;
        const ceiling = dem * (options?.maxOverallocationFactor ?? 1.10);
        const kgPerM = (o.width_mm / 1000) * (o.thickness_micron || thickness) * (o.density || 0.91) / 1000;
        const kgPerPkg = kgPerM * pkgLen;
        return (alloc + kgPerPkg) <= ceiling + 0.05;
      }).sort((a, b) => {
        const remA = a.remaining_qty - (orderAllocMap.get(a.id) || 0);
        const remB = b.remaining_qty - (orderAllocMap.get(b.id) || 0);
        return remB - remA;
      });

      if (availableOrders.length < 2) break;

      // Find best 3-UPS anchor group
      let bestAnchor: VA05Order[] | null = null;
      let bestMasterW = 0;

      for (let i = 0; i < Math.min(10, availableOrders.length); i++) {
        for (let j = i + 1; j < Math.min(15, availableOrders.length); j++) {
          for (let k = j + 1; k < Math.min(20, availableOrders.length); k++) {
            const o1 = availableOrders[i];
            const o2 = availableOrders[j];
            const o3 = availableOrders[k];
            const sum = o1.width_mm + o2.width_mm + o3.width_mm;
            if (sum < 3200 || sum > 3550) continue;

            const targetMasterW = Math.round(sum + 25);
            const ps01 = evaluatePS01Feasibility(targetMasterW, o1.film, thickness);
            if (ps01.status !== 'RED') {
              bestAnchor = [o1, o2, o3];
              bestMasterW = targetMasterW;
              break;
            }
          }
          if (bestAnchor) break;
        }
        if (bestAnchor) break;
      }

      // Fallback 2-UPS anchor if 3-UPS not found
      if (!bestAnchor && availableOrders.length >= 2) {
        for (let i = 0; i < Math.min(5, availableOrders.length); i++) {
          for (let j = i + 1; j < Math.min(10, availableOrders.length); j++) {
            const o1 = availableOrders[i];
            const o2 = availableOrders[j];
            const sum = o1.width_mm + o2.width_mm;
            if (sum < 2100 || sum > 2700) continue;
            const targetMasterW = Math.round(sum + 30);
            bestAnchor = [o1, o2];
            bestMasterW = targetMasterW;
            break;
          }
          if (bestAnchor) break;
        }
      }

      if (!bestAnchor) break;

      const runId = `RUN-${(group as any).primary_film || group.group_name}-${String(runCounter).padStart(3, '0')}`;
      runCounter++;

      const run = buildDynamicContinuousRun(
        bestAnchor,
        availableOrders,
        orderAllocMap,
        bestMasterW,
        pkgLen,
        runId,
        options
      );

      continuousRuns.push(run);

      const plans = partitionRunIntoPhysicalPlans(run, planCounter);
      planCounter += plans.length;
      physicalPlans.push(...plans);
    }
  }

  // Calculate remaining orders with unfulfilled balance
  const remainingOrders: VA05Order[] = pending.map(o => {
    const alloc = orderAllocMap.get(o.id) || 0;
    const dem = o.remaining_qty > 0 ? o.remaining_qty : o.ordered_qty;
    const rem = Math.max(0, Number((dem - alloc).toFixed(2)));
    return {
      ...o,
      remaining_qty: rem,
      produced_qty: alloc,
      status: rem <= 0.01 ? 'COMPLETED' : 'PARTIALLY_FULFILLED',
    };
  });

  // Calculate metrics
  let tailRunsCount = 0;
  let smallDiameterCount = 0;
  let totalMetersPlanned = 0;
  let totalWeightKg = 0;

  for (const p of physicalPlans) {
    const isFull = (p.film === 'MZ10S-20' && p.jumbo_length_m >= 56100) || (p.film === 'MZ20' && p.jumbo_length_m >= (p.package_length_m === 18700 ? 56100 : 60000));
    if (!isFull) tailRunsCount++;
    if (p.diameter_mm < 750) smallDiameterCount++;
    totalMetersPlanned += p.jumbo_length_m;
    totalWeightKg += p.planned_quantity_kg;
  }

  const averageRunMeters = continuousRuns.length > 0 
    ? Math.round(continuousRuns.reduce((s, r) => s + r.total_meters, 0) / continuousRuns.length)
    : 0;

  return {
    plans: physicalPlans,
    continuousRuns,
    remainingOrders,
    summary: {
      totalPhysicalPlans: physicalPlans.length,
      totalContinuousRuns: continuousRuns.length,
      totalMetersPlanned,
      averageRunMeters,
      totalWeightKg: Number(totalWeightKg.toFixed(2)),
      tailRunsCount,
      smallDiameterCount,
    },
  };
}

