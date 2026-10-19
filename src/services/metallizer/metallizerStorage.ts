import { 
  JumboRoll, 
  MetallizerMachineSettings, 
  MetallizerPlan, 
  JumboRequirement,
  deserializeMetallizerPlan,
  serializeMetallizerPlan,
  deserializeJumboRequirement,
  serializeJumboRequirement
} from '../../types/metallizer';
import { VA05Order, UserProfile } from '../../types';
import { DEFAULT_METALLIZER_SETTINGS, INITIAL_JUMBO_ROLLS, calculateJumboWeight } from './metallizerMasterData';
import { STORAGE_KEYS, commitStorageBatch, getStoredOrders, logAuditEvent } from '../storage';
import { isMetallizerOrder } from './metallizerOptimizer';
import { runHybridMslOptimization } from './hybridMslOptimizer';
import { SEED_VA05_ORDERS } from '../seedOrders';

export const METALLIZER_STORAGE_KEYS = {
  SETTINGS: 'gpak_msl_settings_v1',
  ROLLS: 'gpak_msl_jumbo_rolls_v1',
  PLANS: 'gpak_msl_plans_v1',
  REQUIREMENTS: 'gpak_msl_requirements_v1',
  VERSION: 'gpak_msl_plans_version_v2',
};

export const CURRENT_METALLIZER_PLANS_VERSION = 'v3_no_pregenerated_plans';

const memoryStore = new Map<string, string>();

const isStorageAvailable = (): boolean => {
  try {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
};

const getStorageItem = (key: string): string | null => {
  if (isStorageAvailable()) {
    return localStorage.getItem(key);
  }
  return memoryStore.has(key) ? (memoryStore.get(key) ?? null) : null;
};

const setStorageItem = (key: string, value: string): void => {
  if (isStorageAvailable()) {
    localStorage.setItem(key, value);
  }
  memoryStore.set(key, value);
};

export function getStoredMetallizerSettings(): MetallizerMachineSettings {
  try {
    const raw = getStorageItem(METALLIZER_STORAGE_KEYS.SETTINGS);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge defaults: allow_4_ups defaults to false (3-UPS only) unless planner enabled it
      return {
        ...DEFAULT_METALLIZER_SETTINGS,
        ...parsed,
        allow_4_ups: parsed.allow_4_ups === true,
        ps01_deckle_width_mm: Number(parsed.ps01_deckle_width_mm) > 0
          ? Number(parsed.ps01_deckle_width_mm)
          : DEFAULT_METALLIZER_SETTINGS.ps01_deckle_width_mm,
      };
    }
    saveStoredMetallizerSettings(DEFAULT_METALLIZER_SETTINGS);
  } catch (e) {
    console.error('Error reading metallizer settings:', e);
  }
  return DEFAULT_METALLIZER_SETTINGS;
}

export function saveStoredMetallizerSettings(settings: MetallizerMachineSettings): void {
  try {
    setStorageItem(METALLIZER_STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error('Error saving metallizer settings:', e);
  }
}

export function getStoredJumboRolls(): JumboRoll[] {
  try {
    const raw = getStorageItem(METALLIZER_STORAGE_KEYS.ROLLS);
    if (raw) return JSON.parse(raw);
    saveStoredJumboRolls(INITIAL_JUMBO_ROLLS);
  } catch (e) {
    console.error('Error reading jumbo rolls:', e);
  }
  return INITIAL_JUMBO_ROLLS;
}

export function saveStoredJumboRolls(rolls: JumboRoll[]): void {
  try {
    setStorageItem(METALLIZER_STORAGE_KEYS.ROLLS, JSON.stringify(rolls));
  } catch (e) {
    console.error('Error saving jumbo rolls:', e);
  }
}

import { SEED_METALLIZER_PLANS } from './seedMetallizerPlans';

/**
 * Generates the authoritative Two-Pass Hybrid MSL plan set (65 physical plans)
 * strictly against customer demand with zero speculative production.
 */
export function generateAuthoritativeHybridPlans(): MetallizerPlan[] {
  try {
    const orders = getStoredOrders();
    const settings = getStoredMetallizerSettings();
    const mzOrders = orders.filter(o => o.film === 'MZ10S-20' || o.film === 'MZ20');
    const targetOrders = mzOrders.length > 0 ? mzOrders : SEED_VA05_ORDERS.filter(o => o.film === 'MZ10S-20' || o.film === 'MZ20');
    const res = runHybridMslOptimization(targetOrders, settings, 'MZ20');
    return res.plans;
  } catch (err) {
    console.error('Failed to generate authoritative hybrid plans:', err);
    return SEED_METALLIZER_PLANS;
  }
}

export function getStoredMetallizerPlans(): MetallizerPlan[] {
  try {
    const version = getStorageItem(METALLIZER_STORAGE_KEYS.VERSION);
    const raw = getStorageItem(METALLIZER_STORAGE_KEYS.PLANS);

    // If version predates v3_no_pregenerated_plans, purge old pre-generated seed plans
    if (version !== CURRENT_METALLIZER_PLANS_VERSION) {
      setStorageItem(METALLIZER_STORAGE_KEYS.VERSION, CURRENT_METALLIZER_PLANS_VERSION);
      setStorageItem(METALLIZER_STORAGE_KEYS.PLANS, JSON.stringify([]));
      return [];
    }

    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // If parsed is the legacy 65 seed plans, purge them
        if (parsed.length === 65 && parsed.some(p => p.id === 'plan-hybrid-2' || p.created_by?.includes('Hybrid Multi-Pass'))) {
          setStorageItem(METALLIZER_STORAGE_KEYS.PLANS, JSON.stringify([]));
          return [];
        }
        return parsed.map(deserializeMetallizerPlan);
      }
    }
  } catch (e) {
    console.error('Error reading metallizer plans:', e);
  }
  return [];
}

export function saveStoredMetallizerPlans(plans: MetallizerPlan[]): void {
  try {
    setStorageItem(METALLIZER_STORAGE_KEYS.PLANS, serializeMetallizerPlan(plans));
    setStorageItem(METALLIZER_STORAGE_KEYS.VERSION, CURRENT_METALLIZER_PLANS_VERSION);
  } catch (e) {
    console.error('Error saving metallizer plans:', e);
  }
}

export function getStoredJumboRequirements(): JumboRequirement[] {
  try {
    const raw = getStorageItem(METALLIZER_STORAGE_KEYS.REQUIREMENTS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(deserializeJumboRequirement);
      }
    }
  } catch (e) {
    console.error('Error reading jumbo requirements:', e);
  }
  return [];
}

export function saveStoredJumboRequirements(reqs: JumboRequirement[]): void {
  try {
    setStorageItem(METALLIZER_STORAGE_KEYS.REQUIREMENTS, serializeJumboRequirement(reqs));
  } catch (e) {
    console.error('Error saving jumbo requirements:', e);
  }
}

export function consumeJumboRoll(
  rollIdOrDbId: string,
  planId: string,
  consumedLengthM: number
): { success: boolean; updatedRoll?: JumboRoll; error?: string } {
  const rolls = getStoredJumboRolls();
  const index = rolls.findIndex(r => r.id === rollIdOrDbId || r.roll_id === rollIdOrDbId);

  if (index === -1) {
    return { success: false, error: `Jumbo Roll ${rollIdOrDbId} not found in inventory.` };
  }

  const roll = rolls[index];
  if (roll.status === 'CONSUMED') {
    return { success: false, error: `Jumbo Roll ${roll.roll_id} has already been CONSUMED and cannot be reused.` };
  }

  const newRemainingLength = Math.max(0, roll.remaining_length_m - consumedLengthM);
  const newStatus = newRemainingLength <= 0 ? 'CONSUMED' : 'PARTIALLY_CONSUMED';
  const newRemainingKg = calculateJumboWeight(roll.width_mm, roll.thickness_micron, roll.density, newRemainingLength);

  const updatedRoll: JumboRoll = {
    ...roll,
    remaining_length_m: newRemainingLength,
    remaining_quantity_kg: newRemainingKg,
    status: newStatus,
    consumed_by_plan: planId,
    updated_at: new Date().toISOString(),
  };

  rolls[index] = updatedRoll;
  saveStoredJumboRolls(rolls);

  return { success: true, updatedRoll };
}

/**
 * PLX-A07: Reverses the material + demand ledger effect of a set of MSL plans.
 *
 * Deleting a committed plan used to only drop the plan record: the jumbo roll
 * stayed CONSUMED/PARTIALLY_CONSUMED and the order stayed fulfilled, so the
 * material was orphaned forever and the demand was silently lost.
 *
 * Restoration is DELTA based, never absolute. At commit time the deduction was
 * `remaining_after_kg = max(0, remaining_before_kg - weight)` (clamped) while
 * `produced_qty` received the full `planned_weight_kg`. Adding back the clamped
 * delta and subtracting the full planned weight is therefore the exact inverse,
 * and it composes correctly when several plans hit the same order or when plans
 * are deleted out of order.
 *
 * Pure computation - callers persist the returned collections.
 */
export function reverseMetallizerPlanLedger(
  plansToReverse: MetallizerPlan[],
  currentRolls: JumboRoll[],
  currentOrders: VA05Order[]
): { rolls: JumboRoll[]; orders: VA05Order[]; restoredLengthM: number; restoredDemandKg: number } {
  const rolls = currentRolls.map(r => ({ ...r }));
  const orders = currentOrders.map(o => ({ ...o }));
  const now = new Date().toISOString();
  let restoredLengthM = 0;
  let restoredDemandKg = 0;

  for (const plan of plansToReverse) {
    // --- 1. Give the consumed length back to the physical jumbo roll ---
    const rollIndex = rolls.findIndex(
      r => r.id === plan.jumbo_roll_db_id || r.roll_id === plan.jumbo_roll_id
    );
    if (rollIndex !== -1) {
      const roll = rolls[rollIndex];
      const consumed = Number(plan.consumed_length_m) || 0;
      const restoredLength = Math.min(roll.length_m, roll.remaining_length_m + consumed);
      restoredLengthM += restoredLength - roll.remaining_length_m;

      roll.remaining_length_m = restoredLength;
      roll.remaining_quantity_kg = calculateJumboWeight(
        roll.width_mm,
        roll.thickness_micron,
        roll.density,
        restoredLength
      );
      // Full again => AVAILABLE. Still short => another live plan holds the rest.
      roll.status = restoredLength >= roll.length_m ? 'AVAILABLE' : 'PARTIALLY_CONSUMED';
      // generateMetallizerPlans stamps plan_number here, older paths stamp plan.id.
      if (roll.consumed_by_plan === plan.plan_number || roll.consumed_by_plan === plan.id) {
        roll.consumed_by_plan = undefined;
      }
      roll.updated_at = now;
    }
    // Match on canonical order_id, falling back to composite key if not present.
    for (const alloc of plan.orders_covered || []) {
      const order = orders.find(
        o => (alloc.order_id && o.id === alloc.order_id) || (o.sales_order === alloc.sales_order && o.item_number === alloc.item_number)
      );
      if (!order) continue;

      const deductedKg = Math.max(0, alloc.remaining_before_kg - alloc.remaining_after_kg);
      const restoredRemaining = Math.min(
        order.balance_qty,
        Number((order.remaining_qty + deductedKg).toFixed(2))
      );
      restoredDemandKg += restoredRemaining - order.remaining_qty;

      order.remaining_qty = restoredRemaining;
      order.produced_qty = Number(
        Math.max(0, order.produced_qty - alloc.planned_weight_kg).toFixed(2)
      );
      order.status =
        order.produced_qty <= 0.01
          ? 'PENDING'
          : order.remaining_qty <= 0.01
            ? 'COMPLETED'
            : 'PARTIALLY_FULFILLED';
      order.updated_at = now;
    }
  }

  return { rolls, orders, restoredLengthM, restoredDemandKg };
}

/**
 * PLX-A07 + PLX-A06: Deletes MSL plans and reverses their ledger effect in a
 * single all-or-nothing commit (plans + rolls + shared orders).
 *
 * Pass every plan id to implement "delete all". Returns the post-delete state
 * so the caller can drive React state from the same values that were persisted.
 */
export function deleteMetallizerPlansWithLedgerReversal(
  planIdsToDelete: string[],
  user?: UserProfile
): { plans: MetallizerPlan[]; rolls: JumboRoll[]; orders: VA05Order[]; committed: boolean } {
  const idSet = new Set(planIdsToDelete);
  const allPlans = getStoredMetallizerPlans();
  const survivingPlans = allPlans.filter(p => !idSet.has(p.id));
  const deletedPlans = allPlans.filter(p => idSet.has(p.id));

  const currentRolls = getStoredJumboRolls();
  const currentOrders = getStoredOrders();

  if (deletedPlans.length === 0) {
    return { plans: survivingPlans, rolls: currentRolls, orders: currentOrders, committed: true };
  }

  const { rolls, orders, restoredLengthM, restoredDemandKg } = reverseMetallizerPlanLedger(
    deletedPlans,
    currentRolls,
    currentOrders
  );

  const committed = commitStorageBatch([
    { key: METALLIZER_STORAGE_KEYS.PLANS, value: survivingPlans },
    { key: METALLIZER_STORAGE_KEYS.ROLLS, value: rolls },
    { key: STORAGE_KEYS.ORDERS, value: orders },
    { key: METALLIZER_STORAGE_KEYS.VERSION, value: CURRENT_METALLIZER_PLANS_VERSION },
  ]);

  if (!committed) {
    console.error('deleteMetallizerPlansWithLedgerReversal: batch rolled back; no state was changed.');
    return { plans: allPlans, rolls: currentRolls, orders: currentOrders, committed: false };
  }

  if (user) {
    logAuditEvent(
      user,
      'STATUS_CHANGE',
      'PLAN',
      deletedPlans.length === 1 ? deletedPlans[0].id : 'MSL_BULK_DELETE',
      `Deleted ${deletedPlans.length} Metallizer Slitter plan(s) [${deletedPlans.map(p => p.plan_number).join(', ')}] and reversed the ledger: ` +
        `restored ${restoredLengthM.toFixed(0)} m of jumbo length and ${restoredDemandKg.toFixed(2)} kg of order demand`
    );
  }

  return { plans: survivingPlans, rolls, orders, committed: true };
}

/**
 * PLX-A06: All-or-nothing commit of an MSL planning run
 * (MSL plans + jumbo rolls + shared order ledger).
 */
export function commitMetallizerRunAtomic(
  plans: MetallizerPlan[],
  rolls: JumboRoll[],
  orders: VA05Order[]
): boolean {
  const committed = commitStorageBatch([
    { key: METALLIZER_STORAGE_KEYS.PLANS, value: plans },
    { key: METALLIZER_STORAGE_KEYS.ROLLS, value: rolls },
    { key: STORAGE_KEYS.ORDERS, value: orders },
    { key: METALLIZER_STORAGE_KEYS.VERSION, value: CURRENT_METALLIZER_PLANS_VERSION },
  ]);
  if (!committed) {
    console.error('commitMetallizerRunAtomic: batch rolled back; no state was changed.');
  }
  return committed;
}

/**
 * Updates a single jumbo roll in storage and returns the updated roll list
 */
export function updateStoredJumboRoll(updatedRoll: JumboRoll): JumboRoll[] {
  const rolls = getStoredJumboRolls();
  const index = rolls.findIndex(r => r.id === updatedRoll.id || r.roll_id === updatedRoll.roll_id);
  if (index !== -1) {
    rolls[index] = {
      ...updatedRoll,
      updated_at: new Date().toISOString(),
    };
  } else {
    rolls.push(updatedRoll);
  }
  saveStoredJumboRolls(rolls);
  return rolls;
}

/**
 * Deletes a single jumbo roll by id or roll_id from storage and returns the updated roll list
 */
export function deleteStoredJumboRoll(rollIdOrId: string): JumboRoll[] {
  const rolls = getStoredJumboRolls();
  const filtered = rolls.filter(r => r.id !== rollIdOrId && r.roll_id !== rollIdOrId);
  saveStoredJumboRolls(filtered);
  return filtered;
}

/**
 * Deletes all jumbo rolls from storage and returns empty roll list
 */
export function deleteAllStoredJumboRolls(): JumboRoll[] {
  saveStoredJumboRolls([]);
  return [];
}

export function resetMetallizerDatabase(): void {
  saveStoredMetallizerSettings(DEFAULT_METALLIZER_SETTINGS);
  saveStoredJumboRolls(INITIAL_JUMBO_ROLLS);
  saveStoredMetallizerPlans([]);
  saveStoredJumboRequirements([]);
}
