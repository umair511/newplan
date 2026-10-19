/**
 * Order Fulfillment Summary & Reporting Calculation Service
 * 
 * Provides isolated, deterministic calculations for order-level planned vs remaining
 * quantities, fulfillment percentages, and plan membership without mutating or altering
 * any optimizer calculations.
 */

import { VA05Order, SlitterPlan } from '../types';

export interface OrderFulfillmentBreakdown {
  id: string;
  salesOrder: string;
  itemNumber: number;
  customer: string;
  customerRef: string;
  film: string;
  width_mm: number;
  length_m: number;
  core: number;
  treatment_side: string;
  initialKg: number;
  plannedInRunKg: number;
  remainingKg: number;
  completionPct: number;
  status: 'COMPLETED' | 'PARTIAL' | 'UNPLANNED';
  matchingPlanNumbers: string[];
  priority: boolean;
}

export interface OrderFulfillmentTotals {
  totalOrders: number;
  completedOrders: number;
  partialOrders: number;
  unplannedOrders: number;
  totalInitialKg: number;
  totalPlannedInRunKg: number;
  totalRemainingKg: number;
}

/**
 * Calculates accurate order-by-order planned vs remaining breakdown across all plans in a run.
 */
export function calculateOrderFulfillmentSummary(
  film: string,
  originalOrders: VA05Order[],
  plans: SlitterPlan[],
  _remainingOrders?: VA05Order[]
): {
  orderBreakdowns: OrderFulfillmentBreakdown[];
  totals: OrderFulfillmentTotals;
} {
  // Filter to orders belonging to this film or combined film list
  const filmList = film.includes('+') ? film.split('+').map(f => f.trim()) : [film.trim()];
  const filmOrig = originalOrders.filter(o => filmList.includes(o.film) || o.film === film);

  const orderBreakdowns: OrderFulfillmentBreakdown[] = filmOrig.map(orig => {
    const initialKg = Number(orig.remaining_qty > 0 ? orig.remaining_qty : orig.balance_qty || orig.ordered_qty);

    // Sum planned weight across all plans ONLY for items matching this exact order identity
    let plannedInRunKg = 0;
    const matchingPlanNumbers: string[] = [];

    plans.forEach(plan => {
      let planWeightForOrder = 0;

      plan.items.forEach(it => {
        // Direct ID match (plan item tagged with original order id)
        const isIdMatch = Boolean(it.id && (it.id === `item-order-${orig.id}` || it.id.startsWith(`item-order-${orig.id}-rep-`)));

        // Strict attribute match (SO + Item# + Width + Length + Core + Film)
        const isAttrMatch = (
          it.sales_order === orig.sales_order &&
          Number(it.item_number) === Number(orig.item_number) &&
          Number(it.width_mm) === Number(orig.width_mm) &&
          Number(it.length_m) === Number(orig.length_m) &&
          Number(it.core) === Number(orig.core) &&
          (!it.film || !orig.film || it.film === orig.film)
        );

        if (isIdMatch || isAttrMatch) {
          planWeightForOrder += (Number(it.total_weight_kg) || 0);
        }
      });

      if (planWeightForOrder > 0) {
        plannedInRunKg += planWeightForOrder;
        if (!matchingPlanNumbers.includes(plan.plan_number)) {
          matchingPlanNumbers.push(plan.plan_number);
        }
      }
    });

    plannedInRunKg = Math.round(plannedInRunKg * 100) / 100;

    // Remaining Unplanned = max(0, Initial Qty - Actual Planned Qty) with 0.05kg tolerance
    let actualRemainingKg = Math.max(0, Math.round((initialKg - plannedInRunKg) * 100) / 100);
    if (actualRemainingKg <= 0.05 || plannedInRunKg >= initialKg - 0.05) {
      actualRemainingKg = 0;
    }

    const isCompleted = actualRemainingKg === 0;
    const isPartial = plannedInRunKg > 0 && !isCompleted;
    const isUnplanned = plannedInRunKg === 0 && actualRemainingKg > 0;

    const rawCompletionPct = initialKg > 0 
      ? Math.round((plannedInRunKg / initialKg) * 1000) / 10 
      : 100;
    const completionPct = isCompleted ? 100 : Math.min(100, Math.max(0, rawCompletionPct));

    return {
      id: orig.id,
      salesOrder: orig.sales_order,
      itemNumber: orig.item_number,
      customer: orig.customer,
      customerRef: orig.customer_reference || '-',
      film: orig.film,
      width_mm: orig.width_mm,
      length_m: orig.length_m,
      core: orig.core,
      treatment_side: orig.treatment_side,
      initialKg: Math.round(initialKg * 100) / 100,
      plannedInRunKg,
      remainingKg: actualRemainingKg,
      completionPct,
      status: isCompleted ? 'COMPLETED' : isPartial ? 'PARTIAL' : 'UNPLANNED',
      matchingPlanNumbers,
      priority: Boolean(orig.priority),
    };
  });

  const totals: OrderFulfillmentTotals = {
    totalOrders: orderBreakdowns.length,
    completedOrders: orderBreakdowns.filter(o => o.status === 'COMPLETED').length,
    partialOrders: orderBreakdowns.filter(o => o.status === 'PARTIAL').length,
    unplannedOrders: orderBreakdowns.filter(o => o.status === 'UNPLANNED').length,
    totalInitialKg: Math.round(orderBreakdowns.reduce((sum, o) => sum + o.initialKg, 0) * 100) / 100,
    totalPlannedInRunKg: Math.round(orderBreakdowns.reduce((sum, o) => sum + o.plannedInRunKg, 0) * 100) / 100,
    totalRemainingKg: Math.round(orderBreakdowns.reduce((sum, o) => sum + o.remainingKg, 0) * 100) / 100,
  };

  return {
    orderBreakdowns,
    totals,
  };
}
