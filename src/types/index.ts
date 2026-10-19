/**
 * Primary Slitter Planning SaaS - Domain Types
 * Based on SRS v1.0 (GPAK PS01 Primary Slitter)
 */

export type UserRole = 'ADMIN' | 'PLANNER' | 'VIEWER';

export interface UserProfile {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
  department?: string;
}

export type OrderStatus = 'PENDING' | 'PARTIALLY_FULFILLED' | 'COMPLETED' | 'CANCELLED';

export interface VA05Order {
  id: string;
  import_batch_id: string;
  sales_order: string;
  item_number: number;
  customer: string;
  material: string; // e.g. "TNO20", "TH21-20", "MZ18"
  film: string;     // Normalized film family (e.g. "TNO20", "MZ18", "TH21-20", "TH21-30")
  material_description?: string;
  width_mm: number;
  length_m: number;
  thickness_micron: number;
  density: number;
  core: 3 | 6;
  treatment_side: 'OS' | 'IS' | 'Both' | 'None';
  ordered_qty: number;   // In KG or reels
  balance_qty: number;   // Original balance from VA05
  remaining_qty: number; // Dynamically updated remaining demand
  produced_qty: number;  // Fulfilled so far
  unit: string;
  plant: string;
  priority: boolean;     // Planner priority star ⭐
  status: OrderStatus;
  delivery_date?: string;
  customer_reference?: string;
  created_on?: string;
  sales_person?: string;
  ship_to_city?: string;
  payment_term?: string;
  approval_status?: string;
  delivery_block?: string;
  created_at: string;
  updated_at: string;
}

export interface ImportBatch {
  id: string;
  batch_number: string; // e.g. VA05-2026-08-19-001
  filename: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  zero_balance_rows: number;
  films_detected: string[];
  total_orders: number;
  total_remaining_kg: number;
  uploaded_by: string;
  uploaded_at: string;
  errors?: string[];
}

export type PlanningRunStatus = 'DRAFT' | 'GENERATING' | 'COMPLETED' | 'PARTIALLY_PLANNED' | 'NO_FEASIBLE_MATCH' | 'CANCELLED';

export type TrimRuleMode = 'NORMAL' | 'RELAXED_50MM' | 'MANUAL_OVERRIDE';

export interface PlanningRun {
  id: string;
  run_number: string; // e.g. RUN-TNO20-20260819-001
  film: string;
  films?: string[]; // Array of combined films (e.g. ["TNO20", "TH21-20"])
  target_quantity_kg: number;
  planned_quantity_kg: number;
  remaining_quantity_kg: number;
  target_min_kg?: number; // Target * 0.95
  target_max_kg?: number; // Target * 1.05
  target_deviation_percent?: number; // e.g. +1.2%
  planning_mode: 'TARGET_QUANTITY' | 'ALL_REMAINING';
  priority_so_items: string[]; // List of `SO-Item` keys marked as priority
  status: PlanningRunStatus;
  stop_reason?: string;
  rules_version: string;
  optimizer_version: string;
  trim_rule_mode?: TrimRuleMode;
  min_trim_mm_used?: number;
  max_trim_mm_used?: number;
  trim_override_reason?: string;
  trim_override_by?: string;
  created_by: string;
  created_at: string;
  completed_at?: string;
  plans_count: number;
  orders_closed_count: number;
  orders_partial_count: number;
  orders_remaining_count: number;
}

export type PlanStatus = 'DRAFT' | 'APPROVED' | 'IN_PRODUCTION' | 'COMPLETED' | 'CANCELLED';

export interface PlanItem {
  id: string;
  plan_id: string;
  segment_id: string;
  position: number; // 1 to 16 (Primary physical arm position)
  positions?: number[]; // [1, 2, 3, 4] (All identical physical knife arm positions)
  position_label?: string; // e.g. "1-4" or "1"
  station?: 'SIDE_A' | 'SIDE_B'; // Rewind Station: Side A (Station 1 / Upper) vs Side B (Station 2 / Lower)
  sales_order: string;
  item_number: number;
  customer: string;
  film?: string; // Film grade code for this order line (e.g. "TNO20" or "TH21-20")
  width_mm: number;
  length_m: number;
  core: 3 | 6;
  treatment_side: 'OS' | 'IS' | 'Both' | 'None';
  reels: number;      // Total target reels produced for this combined order line
  ups: number;        // Number of identical physical positions assigned
  initial_ups: number; // Active UPS in initial pack (0 for future size replacements before change)
  active_packs?: number; // How many packs this order line runs for
  start_pack?: number;   // 1 for initial setup, >1 for dynamic replacements
  deckle_mm: number;  // width_mm * ups
  weight_per_pack_kg: number;
  total_weight_kg: number;
  is_closed: boolean; // Did this fulfill the order completely?
  is_future_replacement?: boolean; // True if scheduled as a future size change
  replacement_instruction?: string; // e.g. "Starts on Pos 4 after Pack 3"
  parent_deckle_id?: string; // PS01 mother-roll parent deckle run identifier
  source_requirement_id?: string; // Sourced JumboRequirement identifier
}

export interface PlanChange {
  id: string;
  plan_id: string;
  segment_id: string;
  position: number; // e.g. 7
  old_width_mm: number;
  new_width_mm: number;
  after_pack: number; // e.g. 1
  reason: 'ORDER_COMPLETED' | 'LENGTH_CHANGE' | 'OPTIMIZATION';
  instruction: string; // e.g. "CHANGE SIZE 1012MM INTO 987MM AFTER 1 PACK"
  old_order_ref: string;
  new_order_ref: string;
  created_at: string;
}

export interface PlanSegment {
  id: string;
  plan_id: string;
  segment_number: number;
  name?: string; // e.g. "Initial Layout (Packs 1–3)" or "Post-Shift Layout (Packs 4–5)"
  start_pack: number;
  end_pack: number;
  repetitions: number;
  total_slit_width_mm: number;
  trim_mm: number;
  ups: number;
  items: PlanItem[];
  changes?: PlanChange[];
}

export interface SlitterPlan {
  id: string;
  planning_run_id: string;
  plan_number: string; // e.g. PS1-030726-H or PS1-20260819-001
  machine_id: string;  // e.g. "PS01"
  machine_name: string; // "PRIMARY SLITTER 1"
  film: string;
  films?: string[]; // Multiple films if combined (e.g. ["TNO20", "TH21-20"])
  thickness_micron: number;
  density: number;
  deckle_mm: number;           // Fixed 10400 mm
  total_slit_width_mm: number; // e.g. 10214 mm (10180 to 10280)
  trim_mm: number;             // e.g. 186 mm (120 to 250)
  allowed_trim_mm: number;     // e.g. 180 mm
  remaining_web_mm: number;    // e.g. 6 mm
  ups: number;                 // Active knives count (3 to 16)
  max_ups_capacity: number;    // 16
  repetitions: number;         // e.g. 2.0
  length_m: number;            // Finished roll length, e.g. 19500 or 9750
  planned_mr_length_m: number; // e.g. 39000 m
  mill_roll_weight_kg: number; // e.g. 7381.92 kg
  trim_weight_kg: number;      // e.g. 140.90 kg
  waste_percent: number;       // e.g. 1.91%
  planned_quantity_kg: number; // e.g. 7249.90 kg
  order_weight_kg: number;     // e.g. 7241.02 kg
  total_reels: number;         // e.g. 32
  weight_per_pack_total_kg: number; // e.g. 3624.95 kg
  rejection_material: string;  // e.g. "R-TNO20"
  trim_rule_mode?: TrimRuleMode; // 'NORMAL' | 'RELAXED_50MM' | 'MANUAL_OVERRIDE'
  min_trim_mm_used?: number;
  max_trim_mm_used?: number;
  trim_override_reason?: string;
  trim_override_by?: string;
  duplex_layout?: {
    side_a_ups: number;
    side_b_ups: number;
    side_a_core?: number;
    side_b_core?: number;
    side_a_length_m?: number;
    side_b_length_m?: number;
    is_dual_core?: boolean;
    is_dual_length?: boolean;
    balance_delta?: number;
  };
  doc_ref: string;             // "APS/QR/PL/01"
  rev_no: number;              // 0
  issue_date: string;          // "01/02/2024"
  items: PlanItem[];
  changes: PlanChange[];
  segments: PlanSegment[];
  status: PlanStatus;
  approval_notes?: string;
  notes?: string;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
}

export interface PlanningRules {
  id: string;
  version: string;
  deckle_width_mm: number;      // 10400
  deckle_mm?: number;           // Alias for 10400
  min_trim_mm: number;          // 150
  max_trim_mm: number;          // 280
  min_slit_width_mm?: number;   // 355
  min_ups: number;              // 3
  max_ups: number;              // 16
  full_repetition_length_m: number; // 19500
  half_repetition_length_m: number; // 9750
  weight_divisor: number;       // 1000000
  target_tolerance_percent: number; // e.g. 5%
  updated_at: string;
}

export interface FilmMaster {
  code: string;                 // e.g. "TNO20"
  name: string;                 // "Transparent Non Heat Sealable BOPP Film"
  category: 'TRANSPARENT' | 'METALLIZED' | 'PEARLIZED' | 'MATT' | 'SPECIALTY';
  thickness_micron: number;     // 20
  density: number;              // 0.91
  standard_length_m: number;    // 19500
  rejection_code: string;       // "R-TNO20"
  rejection_material_code?: string;
}

export type AuditLogAction = 'IMPORT' | 'PLAN_GENERATED' | 'PLAN_APPROVED' | 'PLAN_CANCELLED' | 'PLAN_STATUS_CHANGE' | 'RULE_UPDATED' | 'ORDER_MODIFIED' | 'UPDATE' | 'APPROVE' | 'STATUS_CHANGE';

export interface AuditLog {
  id: string;
  user?: string;
  user_name?: string;
  role?: UserRole;
  user_role?: UserRole;
  action: AuditLogAction;
  entity_type: 'ORDER' | 'PLAN' | 'PLANNING_RUN' | 'RULE' | 'IMPORT_BATCH' | 'DATABASE' | 'VA05_ORDER' | 'SLITTER_PLAN' | 'PLANNING_RULES' | string;
  entity_id: string;
  description?: string;
  details?: string;
  old_value?: string;
  new_value?: string;
  timestamp: string;
}

export type AuditLogEntry = AuditLog;

export interface TestResult {
  id: string;
  category: 'PHYSICAL_CONSTRAINTS' | 'UPS_LIMITS' | 'WEIGHT_FORMULA' | 'WEIGHT_CALCULATIONS' | 'REPETITIONS' | 'PARTIAL_FULFILLMENT' | 'ORDER_CLOSURE' | 'DYNAMIC_REPLACEMENT' | 'TRIM_RULES' | 'NO_FEASIBLE_MATCH' | 'GOLDEN_DATASET' | 'TARGET_QUANTITY_CONTROL' | 'PLANNING_SHEET_DISPLAY' | 'RESIDUAL_ACCOUNTING' | 'OVERPRODUCTION_GUARD' | 'MULTI_PLAN_OPTIMIZATION';
  title: string;
  description: string;
  status: 'PASS' | 'FAIL';
  expected: string;
  actual: string;
  execution_ms: number;
}

export * from './metallizer';
