/**
 * Local Storage Persistence & State Manager with Transactional Safety & Audit Logging
 * Strict Implementation of SRS Sections 13, 14, 43, 59, 60, 63
 */

import { VA05Order, ImportBatch, PlanningRun, SlitterPlan, PlanningRules, AuditLog, UserProfile, PlanStatus } from '../types';
import { SEED_VA05_ORDERS, INITIAL_IMPORT_BATCH } from './seedOrders';
import { DEFAULT_PLANNING_RULES, FILM_MASTERS } from './masterData';
import { extractNormalizedFilmGrade } from './va05Parser';

export const STORAGE_KEYS = {
  ORDERS: 'gpak_ps01_orders_v1',
  BATCHES: 'gpak_ps01_batches_v1',
  RUNS: 'gpak_ps01_planning_runs_v1',
  PLANS: 'gpak_ps01_plans_v1',
  RULES: 'gpak_ps01_rules_v1',
  AUDIT: 'gpak_ps01_audit_logs_v1',
  USER: 'gpak_ps01_current_user_v1',
};

export const CURRENT_USER: UserProfile = {
  id: 'usr-001',
  name: 'Umair Ahmed',
  email: 'umairahmedddd@gmail.com',
  role: 'PLANNER',
};

const isStorageAvailable = (): boolean => {
  try {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
};

/**
 * PLX-A06: All-or-nothing multi-key persistence.
 *
 * localStorage has no transactions, so a multi-key commit that fails halfway
 * (QuotaExceededError, serialization error, private-mode write block) used to
 * leave the ledger split-brained: plans saved but rolls or orders not, or
 * vice versa. This snapshots every target key first, performs the writes, and
 * restores every snapshot if any single write throws.
 *
 * Returns true only if every key was written.
 */
export function commitStorageBatch(entries: { key: string; value: unknown }[]): boolean {
  if (!isStorageAvailable()) return false;

  const snapshot = entries.map(e => ({ key: e.key, previous: localStorage.getItem(e.key) }));
  const serialized: { key: string; raw: string }[] = [];

  try {
    // Serialize everything before writing anything, so a bad payload cannot
    // leave a partial commit behind.
    for (const e of entries) {
      serialized.push({ key: e.key, raw: JSON.stringify(e.value) });
    }
    for (const s of serialized) {
      localStorage.setItem(s.key, s.raw);
    }
    return true;
  } catch (e) {
    console.error('Storage batch commit failed - rolling back all keys:', e);
    for (const s of snapshot) {
      try {
        if (s.previous === null) localStorage.removeItem(s.key);
        else localStorage.setItem(s.key, s.previous);
      } catch (rollbackError) {
        console.error(`Rollback failed for storage key ${s.key}:`, rollbackError);
      }
    }
    return false;
  }
}

export function getStoredUser(): UserProfile {
  try {
    if (isStorageAvailable()) {
      const raw = localStorage.getItem(STORAGE_KEYS.USER);
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error loading stored user:', e);
  }
  return CURRENT_USER;
}

export function saveStoredUser(user: UserProfile) {
  try {
    if (isStorageAvailable()) {
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    }
  } catch (e) {
    console.error('Error saving stored user:', e);
  }
}

export function getStoredOrders(): VA05Order[] {
  try {
    if (isStorageAvailable()) {
      const raw = localStorage.getItem(STORAGE_KEYS.ORDERS);
      if (raw) {
        const parsed: VA05Order[] = JSON.parse(raw);
        let needsResave = false;

        // Auto-upgrade: if stored orders is the old 44 legacy seed dataset, upgrade to current seed
        if (parsed.length === 44 && parsed[0]?.id === 'ord-tno20-001') {
          saveStoredOrders(SEED_VA05_ORDERS);
          saveStoredBatches([INITIAL_IMPORT_BATCH]);
          return SEED_VA05_ORDERS;
        }

        // Self-healing migration: sanitize any orders stored with bare 'TH21' or missing micron
        const sanitized = parsed.map(o => {
          if (o.film === 'TH21' || !o.film.includes('-') && o.film.startsWith('TH21')) {
            const norm = extractNormalizedFilmGrade(o.material || o.film, o.material_description || '', o.thickness_micron);
            needsResave = true;
            return {
              ...o,
              film: norm.film,
              thickness_micron: norm.thickness,
              material_description: o.material_description || norm.description,
            };
          }
          return o;
        });

        if (needsResave) {
          saveStoredOrders(sanitized);
        }
        return sanitized;
      }
    }
  } catch (e) {
    console.error('Error loading stored orders:', e);
  }
  // Initialize with seed orders
  saveStoredOrders(SEED_VA05_ORDERS);
  return SEED_VA05_ORDERS;
}

export function saveStoredOrders(orders: VA05Order[]) {
  try {
    if (isStorageAvailable()) {
      localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(orders));
    }
  } catch (e) {
    console.error('Error saving orders:', e);
  }
}

/**
 * PLX-A05: deterministic fingerprint of the shared order ledger.
 *
 * PS, MSL and SS all plan against the same order array and none of them holds a
 * reservation. A preview built by one module and committed after another module
 * has already deducted demand used to overwrite the whole array, silently
 * erasing the other module's deduction (last-writer-wins). Studios snapshot this
 * fingerprint when a preview is generated and re-check it before committing.
 */
export function getOrdersLedgerFingerprint(orders?: VA05Order[]): string {
  const list = orders ?? getStoredOrders();
  let hash = 0;
  for (const o of list) {
    const field = `${o.id}:${o.remaining_qty}:${o.produced_qty}:${o.status}`;
    for (let i = 0; i < field.length; i++) {
      hash = (hash * 31 + field.charCodeAt(i)) | 0;
    }
  }
  return `${list.length}-${hash}`;
}

export function getStoredBatches(): ImportBatch[] {
  try {
    if (isStorageAvailable()) {
      const raw = localStorage.getItem(STORAGE_KEYS.BATCHES);
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error loading stored batches:', e);
  }
  saveStoredBatches([INITIAL_IMPORT_BATCH]);
  return [INITIAL_IMPORT_BATCH];
}

export function saveStoredBatches(batches: ImportBatch[]) {
  try {
    if (isStorageAvailable()) {
      localStorage.setItem(STORAGE_KEYS.BATCHES, JSON.stringify(batches));
    }
  } catch (e) {
    console.error('Error saving batches:', e);
  }
}

export function getStoredPlanningRuns(): PlanningRun[] {
  try {
    if (isStorageAvailable()) {
      const raw = localStorage.getItem(STORAGE_KEYS.RUNS);
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error loading planning runs:', e);
  }
  return [];
}

export function saveStoredPlanningRuns(runs: PlanningRun[]) {
  try {
    if (isStorageAvailable()) {
      localStorage.setItem(STORAGE_KEYS.RUNS, JSON.stringify(runs));
    }
  } catch (e) {
    console.error('Error saving planning runs:', e);
  }
}

export function getStoredPlans(): SlitterPlan[] {
  try {
    if (isStorageAvailable()) {
      const raw = localStorage.getItem(STORAGE_KEYS.PLANS);
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error loading plans:', e);
  }
  return [];
}

export function saveStoredPlans(plans: SlitterPlan[]) {
  try {
    if (isStorageAvailable()) {
      localStorage.setItem(STORAGE_KEYS.PLANS, JSON.stringify(plans));
    }
  } catch (e) {
    console.error('Error saving plans:', e);
  }
}

export function getStoredRules(): PlanningRules {
  try {
    if (isStorageAvailable()) {
      const raw = localStorage.getItem(STORAGE_KEYS.RULES);
      if (raw) {
        const parsed: PlanningRules = JSON.parse(raw);
        // Business decision 2026-09-21: PS NORMAL trim window updated to 150-280mm (Yellow: 281-500mm, Red: <150 or >500mm).
        // Rules are cached in localStorage, so an existing install would keep
        // serving previous windows. Adopt the new trim window whenever cached version
        // predates DEFAULT_PLANNING_RULES.version, leaving other locally tuned fields untouched.
        if (parsed.version !== DEFAULT_PLANNING_RULES.version) {
          const migrated: PlanningRules = {
            ...parsed,
            version: DEFAULT_PLANNING_RULES.version,
            min_trim_mm: DEFAULT_PLANNING_RULES.min_trim_mm,
            max_trim_mm: DEFAULT_PLANNING_RULES.max_trim_mm,
            updated_at: new Date().toISOString(),
          };
          saveStoredRules(migrated);
          return migrated;
        }
        const deckle = Number(parsed.deckle_width_mm ?? parsed.deckle_mm) || DEFAULT_PLANNING_RULES.deckle_width_mm;
        return {
          ...parsed,
          deckle_width_mm: deckle,
          deckle_mm: deckle,
        };
      }
    }
  } catch (e) {
    console.error('Error loading rules:', e);
  }
  return DEFAULT_PLANNING_RULES;
}

export function saveStoredRules(rules: PlanningRules) {
  try {
    if (isStorageAvailable()) {
      const deckle = Number(rules.deckle_width_mm ?? rules.deckle_mm) || 10400;
      const normalized = { ...rules, deckle_width_mm: deckle, deckle_mm: deckle };
      localStorage.setItem(STORAGE_KEYS.RULES, JSON.stringify(normalized));
    }
  } catch (e) {
    console.error('Error saving rules:', e);
  }
}

export function getStoredAuditLogs(): AuditLog[] {
  try {
    if (isStorageAvailable()) {
      const raw = localStorage.getItem(STORAGE_KEYS.AUDIT);
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error loading audit logs:', e);
  }
  return [
    {
      id: 'log-001',
      user: 'M.USMAN',
      role: 'ADMIN',
      action: 'IMPORT',
      entity_type: 'IMPORT_BATCH',
      entity_id: INITIAL_IMPORT_BATCH.id,
      description: `Imported initial SAP VA05 pending order dataset [${INITIAL_IMPORT_BATCH.filename}] with ${INITIAL_IMPORT_BATCH.total_rows} rows (${INITIAL_IMPORT_BATCH.films_detected.length} films)`,
      timestamp: INITIAL_IMPORT_BATCH.uploaded_at,
    },
  ];
}

export function logAuditEvent(
  user: UserProfile,
  action: AuditLog['action'],
  entity_type: AuditLog['entity_type'],
  entity_id: string,
  description: string,
  old_value?: string,
  new_value?: string
) {
  const currentLogs = getStoredAuditLogs();
  const newLog: AuditLog = {
    id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    user: user.name,
    user_name: user.name,
    role: user.role,
    user_role: user.role,
    action,
    entity_type,
    entity_id,
    description,
    details: description,
    old_value,
    new_value,
    timestamp: new Date().toISOString(),
  };
  // PLX-A06: guarded so an audit-write failure can never abort (or half-abort)
  // the ledger commit that called it.
  try {
    if (isStorageAvailable()) {
      localStorage.setItem(STORAGE_KEYS.AUDIT, JSON.stringify([newLog, ...currentLogs]));
    }
  } catch (e) {
    console.error('Error saving audit log:', e);
  }
}

/**
 * Atomic Commit for Plan Generation Run (SRS Section 59)
 *
 * PLX-A06: previously three independent writes; a failure on the 2nd or 3rd
 * left runs/plans/orders mutually inconsistent with no way to recover. Now a
 * single all-or-nothing batch. Returns false if nothing was committed.
 */
export function commitPlanningRun(
  user: UserProfile,
  run: PlanningRun,
  plans: SlitterPlan[],
  updatedOrders: VA05Order[]
): boolean {
  const allRuns = getStoredPlanningRuns();
  const allPlans = getStoredPlans();

  const committed = commitStorageBatch([
    { key: STORAGE_KEYS.RUNS, value: [run, ...allRuns] },
    { key: STORAGE_KEYS.PLANS, value: [...plans, ...allPlans] },
    { key: STORAGE_KEYS.ORDERS, value: updatedOrders },
  ]);

  if (!committed) {
    console.error(`commitPlanningRun: batch rolled back for run ${run.run_number}; no state was changed.`);
    return false;
  }

  logAuditEvent(
    user,
    'PLAN_GENERATED',
    'PLANNING_RUN',
    run.id,
    `Generated ${plans.length} Primary Slitter plans for Film [${run.film}] (Planned ${run.planned_quantity_kg.toLocaleString()} kg)`
  );

  return true;
}

/**
 * Update plan status with audit trail
 */
export function updatePlanStatus(
  user: UserProfile,
  planId: string,
  newStatus: PlanStatus,
  notes?: string
) {
  const plans = getStoredPlans();
  const targetPlan = plans.find(p => p.id === planId);
  if (!targetPlan) return;

  const oldStatus = targetPlan.status;
  targetPlan.status = newStatus;
  if (newStatus === 'APPROVED') {
    targetPlan.approved_by = user.name;
    targetPlan.approved_at = new Date().toISOString();
    targetPlan.approval_notes = notes;
  }

  saveStoredPlans([...plans]);

  logAuditEvent(
    user,
    newStatus === 'APPROVED' ? 'PLAN_APPROVED' : 'PLAN_STATUS_CHANGE',
    'PLAN',
    planId,
    `Changed plan [${targetPlan.plan_number}] status from ${oldStatus} to ${newStatus}${notes ? ` (Notes: ${notes})` : ''}`,
    oldStatus,
    newStatus
  );
}

/**
 * Toggle order priority star ⭐
 */
export function toggleOrderPriority(user: UserProfile, orderId: string): boolean {
  const orders = getStoredOrders();
  const order = orders.find(o => o.id === orderId);
  if (!order) return false;

  order.priority = !order.priority;
  order.updated_at = new Date().toISOString();
  saveStoredOrders([...orders]);

  logAuditEvent(
    user,
    'ORDER_MODIFIED',
    'ORDER',
    orderId,
    `Set priority for SO# ${order.sales_order} / Item ${order.item_number} (${order.customer}) to ${order.priority ? 'STARRED (HIGH)' : 'NORMAL'}`
  );

  return order.priority;
}

export const getStoredRuns = getStoredPlanningRuns;
export const saveStoredRuns = saveStoredPlanningRuns;

/**
 * Delete a single order line with audit log
 */
export function deleteSingleOrder(user: UserProfile, orderId: string): VA05Order[] {
  const orders = getStoredOrders();
  const targetOrder = orders.find(o => o.id === orderId);
  const remaining = orders.filter(o => o.id !== orderId);
  saveStoredOrders(remaining);

  if (targetOrder) {
    logAuditEvent(
      user,
      'UPDATE',
      'VA05_ORDER',
      targetOrder.sales_order,
      `Deleted order line SO# ${targetOrder.sales_order} Item #${targetOrder.item_number} (${targetOrder.customer}) - ${targetOrder.film} ${targetOrder.width_mm}mm (${targetOrder.remaining_qty} kg)`
    );
  }
  return remaining;
}

/**
 * Delete multiple selected orders
 */
export function deleteBulkOrders(user: UserProfile, orderIds: string[]): VA05Order[] {
  const orderIdSet = new Set(orderIds);
  const orders = getStoredOrders();
  const remaining = orders.filter(o => !orderIdSet.has(o.id));
  saveStoredOrders(remaining);

  logAuditEvent(
    user,
    'UPDATE',
    'VA05_ORDER',
    'BULK_DELETE',
    `Bulk deleted ${orderIds.length} orders from active planning dataset`
  );
  return remaining;
}

/**
 * Delete all orders of a specific film grade
 */
export function deleteOrdersByFilm(user: UserProfile, film: string): VA05Order[] {
  const orders = getStoredOrders();
  const deletedCount = orders.filter(o => o.film === film).length;
  const remaining = orders.filter(o => o.film !== film);
  saveStoredOrders(remaining);

  logAuditEvent(
    user,
    'UPDATE',
    'VA05_ORDER',
    film,
    `Deleted all ${deletedCount} pending orders for film grade [${film}]`
  );
  return remaining;
}

/**
 * Delete all orders completely (clear to 0)
 */
export function deleteAllOrders(user: UserProfile): VA05Order[] {
  const orders = getStoredOrders();
  const count = orders.length;
  saveStoredOrders([]);

  logAuditEvent(
    user,
    'UPDATE',
    'DATABASE',
    'CLEAR_ALL',
    `Deleted all ${count} sales orders from the planning database`
  );
  return [];
}

/**
 * Delete an entire import batch and all associated orders
 */
export function deleteImportBatch(user: UserProfile, batchId: string): { remainingOrders: VA05Order[]; remainingBatches: ImportBatch[] } {
  const batches = getStoredBatches();
  const targetBatch = batches.find(b => b.id === batchId);
  const remainingBatches = batches.filter(b => b.id !== batchId);

  const orders = getStoredOrders();
  const remainingOrders = orders.filter(o => o.import_batch_id !== batchId);

  saveStoredBatches(remainingBatches);
  saveStoredOrders(remainingOrders);

  if (targetBatch) {
    logAuditEvent(
      user,
      'IMPORT',
      'IMPORT_BATCH',
      batchId,
      `Deleted import batch [${targetBatch.batch_number}] (${targetBatch.filename}) and associated orders`
    );
  }

  return { remainingOrders, remainingBatches };
}

export function resetDatabaseToSeed() {
  localStorage.removeItem(STORAGE_KEYS.ORDERS);
  localStorage.removeItem(STORAGE_KEYS.BATCHES);
  localStorage.removeItem(STORAGE_KEYS.RUNS);
  localStorage.removeItem(STORAGE_KEYS.PLANS);
  localStorage.removeItem(STORAGE_KEYS.RULES);
  localStorage.removeItem(STORAGE_KEYS.AUDIT);

  // Clear all plans across all modules so planner starts with 0 plans
  localStorage.removeItem('gpak_msl_plans_v1');
  localStorage.removeItem('gpak_msl_plans_version_v2');
  localStorage.removeItem('gpak_ss_plans_v1');
  localStorage.removeItem('gpak_msl_requirements_v1');
  localStorage.removeItem('gpak_ss_requirements_v1');

  saveStoredPlans([]);
  saveStoredPlanningRuns([]);
  saveStoredOrders(SEED_VA05_ORDERS);
  saveStoredBatches([INITIAL_IMPORT_BATCH]);
  saveStoredRules(DEFAULT_PLANNING_RULES);
}
