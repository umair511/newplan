import { SSJumboRoll, SSMachineSettings, SSPlan, SSJumboRequirement, JumboRoll, MetallizerMachineSettings, MetallizerPlan, JumboRequirement } from '../../types/ss';
import { VA05Order, UserProfile } from '../../types';
import { DEFAULT_SS_SETTINGS, INITIAL_SS_JUMBO_ROLLS, calculateJumboWeight } from './ssMasterData';
import { STORAGE_KEYS, commitStorageBatch, getStoredOrders, logAuditEvent } from '../storage';

const SS_STORAGE_KEYS = {
  SETTINGS: 'gpak_ss_settings_v1',
  ROLLS: 'gpak_ss_jumbo_rolls_v1',
  PLANS: 'gpak_ss_plans_v1',
  REQUIREMENTS: 'gpak_ss_requirements_v1',
};

const isStorageAvailable = (): boolean => {
  try {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
};

export function getStoredSSSettings(): SSMachineSettings {
  try {
    if (isStorageAvailable()) {
      const raw = localStorage.getItem(SS_STORAGE_KEYS.SETTINGS);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Merge defaults; upgrade legacy trim floors to GREEN 11–35 / YELLOW max 45
        // min 15 or 20 → 11 so factory 11mm side trim is always eligible (MATTPL12/TNBPL10)
        const legacyMin = parsed.min_trim_mm === 15 || parsed.min_trim_mm === 20 || parsed.min_trim_mm === 30;
        const legacyMax = parsed.max_trim_mm === 30 || parsed.max_trim_mm === 40;
        const legacyHard = parsed.hard_max_trim_mm === 40 || parsed.hard_max_trim_mm === 50;
        return {
          ...DEFAULT_SS_SETTINGS,
          ...parsed,
          max_jumbo_width_mm: Math.max(parsed.max_jumbo_width_mm || 0, DEFAULT_SS_SETTINGS.max_jumbo_width_mm),
          ps01_deckle_width_mm: Number(parsed.ps01_deckle_width_mm) > 0
            ? Number(parsed.ps01_deckle_width_mm)
            : DEFAULT_SS_SETTINGS.ps01_deckle_width_mm,
          min_trim_mm: legacyMin ? 11 : (parsed.min_trim_mm ?? DEFAULT_SS_SETTINGS.min_trim_mm),
          max_trim_mm: legacyMax ? 35 : (parsed.max_trim_mm ?? DEFAULT_SS_SETTINGS.max_trim_mm),
          hard_max_trim_mm: legacyHard ? 45 : (parsed.hard_max_trim_mm ?? DEFAULT_SS_SETTINGS.hard_max_trim_mm),
        };
      }
      saveStoredSSSettings(DEFAULT_SS_SETTINGS);
    }
  } catch (e) {
    console.error('Error reading SS settings:', e);
  }
  return DEFAULT_SS_SETTINGS;
}

export function saveStoredSSSettings(settings: SSMachineSettings): void {
  try {
    if (isStorageAvailable()) {
      localStorage.setItem(SS_STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    }
  } catch (e) {
    console.error('Error saving SS settings:', e);
  }
}

// Aliases for compatibility
export const getStoredMetallizerSettings = getStoredSSSettings;
export const saveStoredMetallizerSettings = saveStoredSSSettings;

export function getStoredSSJumboRolls(): SSJumboRoll[] {
  try {
    if (isStorageAvailable()) {
      const raw = localStorage.getItem(SS_STORAGE_KEYS.ROLLS);
      if (raw) return JSON.parse(raw);
      saveStoredSSJumboRolls(INITIAL_SS_JUMBO_ROLLS);
    }
  } catch (e) {
    console.error('Error reading SS jumbo rolls:', e);
  }
  return INITIAL_SS_JUMBO_ROLLS;
}

export function saveStoredSSJumboRolls(rolls: SSJumboRoll[]): void {
  try {
    if (isStorageAvailable()) {
      localStorage.setItem(SS_STORAGE_KEYS.ROLLS, JSON.stringify(rolls));
    }
  } catch (e) {
    console.error('Error saving SS jumbo rolls:', e);
  }
}

export const getStoredJumboRolls = getStoredSSJumboRolls;
export const saveStoredJumboRolls = saveStoredSSJumboRolls;

export function getStoredSSPlans(): SSPlan[] {
  try {
    if (isStorageAvailable()) {
      const raw = localStorage.getItem(SS_STORAGE_KEYS.PLANS);
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error reading SS plans:', e);
  }
  return [];
}

export function saveStoredSSPlans(plans: SSPlan[]): void {
  try {
    if (isStorageAvailable()) {
      localStorage.setItem(SS_STORAGE_KEYS.PLANS, JSON.stringify(plans));
    }
  } catch (e) {
    console.error('Error saving SS plans:', e);
  }
}

export const getStoredMetallizerPlans = getStoredSSPlans;
export const saveStoredMetallizerPlans = saveStoredSSPlans;

export function getStoredSSJumboRequirements(): SSJumboRequirement[] {
  try {
    if (isStorageAvailable()) {
      const raw = localStorage.getItem(SS_STORAGE_KEYS.REQUIREMENTS);
      if (raw) {
        const parsed: SSJumboRequirement[] = JSON.parse(raw);
        // Self-healing migration: invalidate legacy requirements that used old 7-UPS CG44H20 patterns
        const hasLegacy7Ups = parsed.some(r =>
          r.film === 'CG44H20' && (r.ps01_feasibility?.ps01_ups === 7 || (r.ps01_feasibility?.explanation && r.ps01_feasibility.explanation.includes('7-UPS')))
        );
        if (hasLegacy7Ups) {
          localStorage.removeItem(SS_STORAGE_KEYS.REQUIREMENTS);
          return [];
        }
        return parsed;
      }
    }
  } catch (e) {
    console.error('Error reading SS jumbo requirements:', e);
  }
  return [];
}

export function saveStoredSSJumboRequirements(reqs: SSJumboRequirement[]): void {
  try {
    if (isStorageAvailable()) {
      localStorage.setItem(SS_STORAGE_KEYS.REQUIREMENTS, JSON.stringify(reqs));
    }
  } catch (e) {
    console.error('Error saving SS jumbo requirements:', e);
  }
}

export const getStoredJumboRequirements = getStoredSSJumboRequirements;
export const saveStoredJumboRequirements = saveStoredSSJumboRequirements;

export function consumeSSJumboRoll(
  rollIdOrDbId: string,
  planId: string,
  consumedLengthM: number
): { success: boolean; updatedRoll?: SSJumboRoll; error?: string } {
  const rolls = getStoredSSJumboRolls();
  const index = rolls.findIndex(r => r.id === rollIdOrDbId || r.roll_id === rollIdOrDbId);

  if (index === -1) {
    return { success: false, error: `Secondary Slitter Jumbo Roll ${rollIdOrDbId} not found in inventory.` };
  }

  const roll = rolls[index];
  if (roll.status === 'CONSUMED') {
    return { success: false, error: `Secondary Slitter Jumbo Roll ${roll.roll_id} has already been CONSUMED and cannot be reused.` };
  }

  const newRemainingLength = Math.max(0, roll.remaining_length_m - consumedLengthM);
  const newStatus = newRemainingLength <= 0 ? 'CONSUMED' : 'PARTIALLY_CONSUMED';
  const newRemainingKg = calculateJumboWeight(roll.width_mm, roll.thickness_micron, roll.density, newRemainingLength);

  const updatedRoll: SSJumboRoll = {
    ...roll,
    remaining_length_m: newRemainingLength,
    remaining_quantity_kg: newRemainingKg,
    status: newStatus,
    consumed_by_plan: planId,
    updated_at: new Date().toISOString(),
  };

  rolls[index] = updatedRoll;
  saveStoredSSJumboRolls(rolls);

  return { success: true, updatedRoll };
}

export const consumeJumboRoll = consumeSSJumboRoll;

/**
 * PLX-A07: Reverses the material + demand ledger effect of a set of SS plans.
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
 * are deleted out of order. Writing the absolute `remaining_before_kg` back
 * would corrupt state in exactly those cases.
 *
 * Pure computation - callers persist the returned collections.
 */
export function reverseSSPlanLedger(
  plansToReverse: SSPlan[],
  currentRolls: SSJumboRoll[],
  currentOrders: VA05Order[]
): { rolls: SSJumboRoll[]; orders: VA05Order[]; restoredLengthM: number; restoredDemandKg: number } {
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
      // generateSSPlans stamps plan_number here, older paths stamp plan.id.
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
 * PLX-A07 + PLX-A06: Deletes SS plans and reverses their ledger effect in a
 * single all-or-nothing commit (plans + rolls + shared orders).
 *
 * Pass every plan id to implement "delete all". Returns the post-delete state
 * so the caller can drive React state from the same values that were persisted.
 */
export function deleteSSPlansWithLedgerReversal(
  planIdsToDelete: string[],
  user?: UserProfile
): { plans: SSPlan[]; rolls: SSJumboRoll[]; orders: VA05Order[]; committed: boolean } {
  const idSet = new Set(planIdsToDelete);
  const allPlans = getStoredSSPlans();
  const survivingPlans = allPlans.filter(p => !idSet.has(p.id));
  const deletedPlans = allPlans.filter(p => idSet.has(p.id));

  const currentRolls = getStoredSSJumboRolls();
  const currentOrders = getStoredOrders();

  if (deletedPlans.length === 0) {
    return { plans: survivingPlans, rolls: currentRolls, orders: currentOrders, committed: true };
  }

  const { rolls, orders, restoredLengthM, restoredDemandKg } = reverseSSPlanLedger(
    deletedPlans,
    currentRolls,
    currentOrders
  );

  const committed = commitStorageBatch([
    { key: SS_STORAGE_KEYS.PLANS, value: survivingPlans },
    { key: SS_STORAGE_KEYS.ROLLS, value: rolls },
    { key: STORAGE_KEYS.ORDERS, value: orders },
  ]);

  if (!committed) {
    console.error('deleteSSPlansWithLedgerReversal: batch rolled back; no state was changed.');
    return { plans: allPlans, rolls: currentRolls, orders: currentOrders, committed: false };
  }

  if (user) {
    logAuditEvent(
      user,
      'STATUS_CHANGE',
      'PLAN',
      deletedPlans.length === 1 ? deletedPlans[0].id : 'SS_BULK_DELETE',
      `Deleted ${deletedPlans.length} Secondary Slitter plan(s) [${deletedPlans.map(p => p.plan_number).join(', ')}] and reversed the ledger: ` +
        `restored ${restoredLengthM.toFixed(0)} m of jumbo length and ${restoredDemandKg.toFixed(2)} kg of order demand`
    );
  }

  return { plans: survivingPlans, rolls, orders, committed: true };
}

/**
 * PLX-A06: All-or-nothing commit of an SS planning run
 * (SS plans + jumbo rolls + shared order ledger).
 */
export function commitSSRunAtomic(
  plans: SSPlan[],
  rolls: SSJumboRoll[],
  orders: VA05Order[]
): boolean {
  const committed = commitStorageBatch([
    { key: SS_STORAGE_KEYS.PLANS, value: plans },
    { key: SS_STORAGE_KEYS.ROLLS, value: rolls },
    { key: STORAGE_KEYS.ORDERS, value: orders },
  ]);
  if (!committed) {
    console.error('commitSSRunAtomic: batch rolled back; no state was changed.');
  }
  return committed;
}

/**
 * Updates a single jumbo roll in storage and returns the updated roll list
 */
export function updateStoredSSJumboRoll(updatedRoll: SSJumboRoll): SSJumboRoll[] {
  const rolls = getStoredSSJumboRolls();
  const index = rolls.findIndex(r => r.id === updatedRoll.id || r.roll_id === updatedRoll.roll_id);
  if (index !== -1) {
    rolls[index] = {
      ...updatedRoll,
      updated_at: new Date().toISOString(),
    };
  } else {
    rolls.push(updatedRoll);
  }
  saveStoredSSJumboRolls(rolls);
  return rolls;
}

export const updateStoredJumboRoll = updateStoredSSJumboRoll;

/**
 * Deletes a single jumbo roll by id or roll_id from storage and returns the updated roll list
 */
export function deleteStoredSSJumboRoll(rollIdOrId: string): SSJumboRoll[] {
  const rolls = getStoredSSJumboRolls();
  const filtered = rolls.filter(r => r.id !== rollIdOrId && r.roll_id !== rollIdOrId);
  saveStoredSSJumboRolls(filtered);
  return filtered;
}

export const deleteStoredJumboRoll = deleteStoredSSJumboRoll;

/**
 * Deletes all jumbo rolls from storage and returns empty roll list
 */
export function deleteAllStoredSSJumboRolls(): SSJumboRoll[] {
  saveStoredSSJumboRolls([]);
  return [];
}

export const deleteAllStoredJumboRolls = deleteAllStoredSSJumboRolls;

export function resetSSDatabase(): void {
  saveStoredSSSettings(DEFAULT_SS_SETTINGS);
  saveStoredSSJumboRolls(INITIAL_SS_JUMBO_ROLLS);
  saveStoredSSPlans([]);
  saveStoredSSJumboRequirements([]);
}

export const resetMetallizerDatabase = resetSSDatabase;
