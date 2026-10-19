/**
 * In-memory cache of authentic PS SlitterPlans produced by the SS → PS Engine path.
 * Survives within the session even if localStorage strips large `source_ps_plan` blobs.
 */
import { SlitterPlan } from '../../types';

const byReqId = new Map<string, SlitterPlan>();
const byPlanId = new Map<string, SlitterPlan>();
const byPlanNumber = new Map<string, SlitterPlan>();

export function cachePsEnginePlan(reqId: string, plan: SlitterPlan): void {
  if (!reqId || !plan) return;
  byReqId.set(reqId, plan);
  if (plan.id) byPlanId.set(plan.id, plan);
  if (plan.plan_number) byPlanNumber.set(plan.plan_number, plan);
}

export function cachePsEnginePlans(
  pairs: { reqId: string; plan: SlitterPlan }[]
): void {
  for (const p of pairs) cachePsEnginePlan(p.reqId, p.plan);
}

export function getCachedPsEnginePlan(req: {
  id?: string;
  source_ps_plan_id?: string;
  source_ps_plan_number?: string;
  source_ps_plan?: SlitterPlan;
}): SlitterPlan | null {
  if (req.source_ps_plan && req.source_ps_plan.id) return req.source_ps_plan;
  if (req.id && byReqId.has(req.id)) return byReqId.get(req.id)!;
  if (req.source_ps_plan_id && byPlanId.has(req.source_ps_plan_id)) {
    return byPlanId.get(req.source_ps_plan_id)!;
  }
  if (req.source_ps_plan_number && byPlanNumber.has(req.source_ps_plan_number)) {
    return byPlanNumber.get(req.source_ps_plan_number)!;
  }
  return null;
}

export function clearPsEnginePlanCache(): void {
  byReqId.clear();
  byPlanId.clear();
  byPlanNumber.clear();
}
