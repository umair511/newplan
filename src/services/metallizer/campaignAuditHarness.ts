import { VA05Order, SlitterPlan } from '../../types';
import { JumboRequirement, JumboRoll, MetallizerPlan } from '../../types/metallizer';
import { calculateJumboDiameter, calculateJumboWeight, MSL_CUSTOMER_MAX_OVERALLOCATION_FACTOR } from './metallizerMasterData';

export interface InvariantValidationOptions {
  requirePhysicalPlans?: boolean;
  expectedPhysicalRollCount?: number;
}

export interface InvariantValidationResult {
  passed: boolean;
  violations: string[];
  metrics: {
    totalOrders: number;
    ordersWithBreach: number;
    maxOverageFactor: number;
    totalDemandKg: number;
    totalAllocatedKg: number;
    realFulfilledKg: number;
    residualKg: number;
    shaftBalanceViolations: number;
    trimViolations: number;
    physicalPlansCount: number;
    physicalFulfilledKg: number;
    physicalPlanAllocBreaches: number;
  };
}

/**
 * Generate fully-specified mock inventory JumboRoll objects from synthesized JumboRequirements.
 * Every roll includes calculated diameter_mm, width_mm, length_m, thickness, and valid metallized film.
 */
export function createMockInventoryFromRequirements(
  requirements: JumboRequirement[]
): JumboRoll[] {
  const rolls: JumboRoll[] = [];
  let rollIndex = 1;

  for (const req of requirements) {
    const rollCount = req.required_rolls_count || 1;
    for (let i = 0; i < rollCount; i++) {
      const diameter = req.calculated_diameter_mm || calculateJumboDiameter(
        req.thickness_micron || 18,
        req.required_jumbo_length_m
      );
      const weightKg = calculateJumboWeight(
        req.required_jumbo_width_mm,
        req.thickness_micron || 18,
        0.91,
        req.required_jumbo_length_m
      );

      const now = new Date().toISOString();
      rolls.push({
        id: `mock-roll-${rollIndex}`,
        roll_id: `JR-${String(rollIndex).padStart(4, '0')}`,
        film: req.film,
        width_mm: req.required_jumbo_width_mm,
        length_m: req.required_jumbo_length_m,
        remaining_length_m: req.required_jumbo_length_m,
        thickness_micron: req.thickness_micron || 18,
        diameter_mm: diameter,
        total_weight_kg: weightKg,
        remaining_quantity_kg: weightKg,
        density: 0.91,
        core: req.core || '10-inch steel core',
        status: 'AVAILABLE',
        source_requirement_id: req.id,
        source_requirement: req,
        created_at: now,
        updated_at: now,
      });
      rollIndex++;
    }
  }

  return rolls;
}

export function validateEngineInvariants(
  orders: VA05Order[],
  requirements: JumboRequirement[],
  mslSheets: SlitterPlan[] = [],
  physicalPlans: MetallizerPlan[] = [],
  options?: InvariantValidationOptions
): InvariantValidationResult {
  const violations: string[] = [];
  const orderMap = new Map<string, VA05Order>();
  for (const o of orders) {
    orderMap.set(o.id, o);
  }

  // 1. Check Requirement-level Order Ceilings
  const reqAllocByOrder = new Map<string, number>();
  for (const r of requirements) {
    for (const cov of r.orders_covered) {
      reqAllocByOrder.set(cov.order_id, (reqAllocByOrder.get(cov.order_id) || 0) + cov.weight_kg);
    }
  }

  let ordersWithBreach = 0;
  let maxOverage = 0;
  let totalDemandKg = 0;
  let realFulfilledKg = 0;
  let residualKg = 0;

  for (const o of orders) {
    if (o.remaining_qty <= 0) continue;
    totalDemandKg += o.remaining_qty;
    const alloc = reqAllocByOrder.get(o.id) || 0;
    const fulfilled = Math.min(o.remaining_qty, alloc);
    realFulfilledKg += fulfilled;
    if (o.remaining_qty > alloc) {
      residualKg += (o.remaining_qty - alloc);
    }

    const ceiling = Number((o.remaining_qty * MSL_CUSTOMER_MAX_OVERALLOCATION_FACTOR).toFixed(2));
    const factor = alloc / o.remaining_qty;
    if (factor > maxOverage) maxOverage = factor;

    if (alloc > ceiling + 0.05) {
      ordersWithBreach++;
      violations.push(`Requirement Ceiling Breach: Order ${o.sales_order}/${o.item_number} demand ${o.remaining_qty}kg, ceiling ${ceiling}kg, allocated ${alloc.toFixed(2)}kg (factor: ${factor.toFixed(3)})`);
    }
  }

  // 2. Check Physical Plan Duplex Shaft Balance, Length Homogeneity, Diameter & Order Ceilings
  let shaftBalanceViolations = 0;
  let physicalPlanAllocBreaches = 0;
  let physicalFulfilledTotalKg = 0;

  const mustVerifyPhysical = options?.requirePhysicalPlans || options?.expectedPhysicalRollCount !== undefined || physicalPlans.length > 0;

  if (mustVerifyPhysical) {
    if (physicalPlans.length === 0) {
      violations.push('Physical MSL Execution Failure: Expected non-zero physical MSL plans to be generated, but received 0 physical plans.');
    } else if (options?.expectedPhysicalRollCount !== undefined && physicalPlans.length !== options.expectedPhysicalRollCount) {
      violations.push(`Physical Plan Count Mismatch: Expected ${options.expectedPhysicalRollCount} physical MSL plans, but received ${physicalPlans.length}.`);
    }

    const planAllocByOrder = new Map<string, number>();
    for (const p of physicalPlans) {
      if (!p.diameter_mm || p.diameter_mm <= 0) {
        violations.push(`Physical Plan Invalid Diameter in Plan ${p.plan_number}: diameter_mm is missing or <= 0 (${p.diameter_mm})`);
      }

      for (const cov of p.orders_covered) {
        const ordKey = cov.order_id || `${cov.sales_order}/${cov.item_number}`;
        const w = cov.weight_kg ?? cov.planned_weight_kg ?? 0;
        planAllocByOrder.set(ordKey, (planAllocByOrder.get(ordKey) || 0) + w);
      }

      // Evaluate duplex slitter physical shaft balance per cutting configuration (per segment for segmented plans)
      const configsToCheck = p.is_segmented && p.segments && p.segments.length > 0
        ? p.segments.map(s => s.orders_covered)
        : [p.orders_covered];

      for (const ordersList of configsToCheck) {
        const lengthCounts = new Map<number, number>();
        for (const cov of ordersList) {
          lengthCounts.set(cov.length_m, (lengthCounts.get(cov.length_m) || 0) + (cov.ups || 1));
        }

        const distinctLengths = Array.from(lengthCounts.keys());
        if (distinctLengths.length === 2) {
          const lenA = distinctLengths[0];
          const lenB = distinctLengths[1];
          const countA = lengthCounts.get(lenA) || 0;
          const countB = lengthCounts.get(lenB) || 0;

          if (countA > 3 || countB > 3) {
            shaftBalanceViolations++;
            violations.push(`Duplex Shaft Capacity Breach in Plan ${p.plan_number}: Side A has ${countA} arms, Side B has ${countB} arms (max 3 allowed per shaft)`);
          }
        } else if (distinctLengths.length > 2) {
          shaftBalanceViolations++;
          violations.push(`Duplex Shaft Homogeneity Breach in Plan ${p.plan_number}: More than 2 distinct lengths (${distinctLengths.length}) present`);
        }
      }
    }

    // Validate Physical Plan Allocations against Order Demands
    for (const o of orders) {
      if (o.remaining_qty <= 0) continue;
      const alloc = planAllocByOrder.get(o.id) || planAllocByOrder.get(`${o.sales_order}/${o.item_number}`) || 0;
      if (alloc > 0) {
        const ceiling = Number((o.remaining_qty * MSL_CUSTOMER_MAX_OVERALLOCATION_FACTOR).toFixed(2));
        if (alloc > ceiling + 0.05) {
          physicalPlanAllocBreaches++;
          violations.push(`Physical Plan Ceiling Breach: Order ${o.sales_order}/${o.item_number} demand ${o.remaining_qty}kg, ceiling ${ceiling}kg, physical plan allocated ${alloc.toFixed(2)}kg`);
        }
        physicalFulfilledTotalKg += Math.min(o.remaining_qty, alloc);
      }
    }
  }

  // 3. Check MSL Trim Bounds on Requirements
  let trimViolations = 0;
  for (const r of requirements) {
    const sumCuts = r.finished_widths_covered.reduce((a, b) => a + b, 0);
    const mslTrim = r.required_jumbo_width_mm - sumCuts;
    if (mslTrim < 18 || mslTrim > 45) {
      trimViolations++;
      violations.push(`Requirement MSL Trim Violation in ${r.id}: Width ${r.required_jumbo_width_mm}mm - Cuts ${sumCuts}mm = Trim ${mslTrim}mm (must be 18-45mm)`);
    }
  }

  // 4. Check MSL Factory Sheet Customer Allocation Breaches
  if (mslSheets.length > 0) {
    const sheetAllocByOrder = new Map<string, number>();
    for (const sheet of mslSheets) {
      for (const item of sheet.items) {
        if (item.sales_order) {
          const soClean = item.sales_order.replace('SO#', '').trim();
          const key = `${soClean}/${item.item_number}`;
          sheetAllocByOrder.set(key, (sheetAllocByOrder.get(key) || 0) + (item.total_weight_kg || 0));
        }
      }
    }

    for (const o of orders) {
      const key = `${o.sales_order}/${o.item_number}`;
      const alloc = sheetAllocByOrder.get(key) || 0;
      const ceiling = Number((o.remaining_qty * MSL_CUSTOMER_MAX_OVERALLOCATION_FACTOR).toFixed(2));
      if (alloc > ceiling + 0.05) {
        violations.push(`MSL Factory Sheet Ceiling Breach: Order ${o.sales_order}/${o.item_number} demand ${o.remaining_qty}kg, ceiling ${ceiling}kg, sheet allocated ${alloc.toFixed(2)}kg`);
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    metrics: {
      totalOrders: orders.length,
      ordersWithBreach,
      maxOverageFactor: Number(maxOverage.toFixed(3)),
      totalDemandKg: Number(totalDemandKg.toFixed(2)),
      totalAllocatedKg: Number(Array.from(reqAllocByOrder.values()).reduce((a, b) => a + b, 0).toFixed(2)),
      realFulfilledKg: Number(realFulfilledKg.toFixed(2)),
      residualKg: Number(residualKg.toFixed(2)),
      shaftBalanceViolations,
      trimViolations,
      physicalPlansCount: physicalPlans.length,
      physicalFulfilledKg: Number(physicalFulfilledTotalKg.toFixed(2)),
      physicalPlanAllocBreaches,
    },
  };
}
