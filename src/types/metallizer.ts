import { UserRole, PlanStatus } from './index';

export type JumboRollStatus = 'AVAILABLE' | 'RESERVED' | 'PARTIALLY_CONSUMED' | 'CONSUMED';

export interface JumboRoll {
  id: string;
  roll_id: string; // e.g. "JR-001" or "JR-MZ18-3000-01"
  film: string;    // e.g. "MZ18", "MZ20", "TH21-18", "TH21-20"
  width_mm: number; // Max 3650 mm
  length_m: number; // Length in meters
  thickness_micron: number; // Thickness in microns (e.g. 18)
  diameter_mm: number; // Calculated: 1.14 * sqrt(thickness_micron * length_m)
  core: string; // Default: '10-inch steel core'
  density: number; // Default: 0.91
  production_date?: string;
  status: JumboRollStatus;
  source_plan?: string;
  source_requirement_id?: string;
  source_requirement?: JumboRequirement;
  consumed_by_plan?: string;
  remaining_length_m: number;
  remaining_quantity_kg: number;
  total_weight_kg: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface MetallizerMachineSettings {
  id: string;
  machine_name: string; // "Metallizer Slitter"
  physical_ups: number; // 6
  preferred_ups: number; // 3
  /** When false (default): only 3-UPS PS01 mother packs. When true: allow 4-UPS fallback as before. */
  allow_4_ups?: boolean;
  max_planning_ups: number; // 6 (MSL has 6 UPS available, can use 1 to 6 UPS)
  max_jumbo_width_mm: number; // 3650
  /** PS01 mother deckle for MSL jumbo synthesis. Options: 10400 | 8700 */
  ps01_deckle_width_mm?: number;
  max_jumbo_diameter_mm: number; // 1250
  min_trim_mm: number; // 20
  max_trim_mm: number; // 30
  green_min_trim_mm?: number; // 18 (Plant-approved MSL GREEN trim lower bound)
  green_max_trim_mm?: number; // 45 (Plant-approved MSL GREEN trim upper bound)
  hard_max_trim_mm?: number; // Optional hard trim maximum
  min_slit_width_mm?: number;
  max_slit_width_mm?: number;
  diameter_constant?: number;
  core: string; // "10-inch steel core"
  density: number; // 0.91
  package_multiples: number[]; // [1, 2, 3, 4, 5, 6]
  thickness_micron_default: number; // 18
  updated_at: string;
}

export type PS01HandshakeStatus = 'GREEN' | 'YELLOW' | 'RED';
export type TrimRelaxationType = 'NONE' | 'MSL_TRIM_ADJUSTED' | 'PS01_TRIM_RELAXED';

export interface PS01FeasibilityInfo {
  status: PS01HandshakeStatus;
  is_feasible: boolean;
  ps01_deckle_mm: number;
  jumbo_width_mm: number;
  ps01_ups: number;
  ps01_cut_combination: number[];
  ps01_total_width_mm: number;
  ps01_trim_mm: number;
  ps01_deckle_efficiency_percent: number;
  ps01_duplex_balanced: boolean;
  side_a_ups: number;
  side_b_ups: number;
  relaxation_type: TrimRelaxationType;
  relaxation_flag?: string;
  explanation: string;
}

export interface JumboRequirement {
  id: string;
  film: string;
  thickness_micron: number;
  required_jumbo_width_mm: number;
  required_jumbo_length_m: number;
  calculated_diameter_mm: number;
  core: string;
  required_rolls_count: number;
  ups: number;
  finished_widths_covered: number[];
  expected_trim_mm: number;
  orders_covered: {
    order_id?: string;
    sales_order: string;
    item_number: number;
    customer: string;
    width_mm: number;
    length_m: number;
    required_reels: number;
    weight_kg: number;
  }[];
  package_multiple: number;
  total_weight_kg: number;
  efficiency_percent: number;
  planning_mode?: 'COMBINED' | 'SEPARATE' | 'SINGLE';
  compatible_group_key?: string;
  trim_width_mm?: number;
  msl_pattern_summary?: {
    total_cuts: number;
    cuts: Array<{
      order_id?: string;
      sales_order?: string;
      film?: string;
      width_mm: number;
      length_m: number;
      allocated_weight_kg: number;
    }>;
  };
  ps01_feasibility?: PS01FeasibilityInfo;
  is_mutually_feasible: boolean;
  relaxation_flag?: string;
  selected_for_msl?: boolean;
  relaxation_accepted?: boolean;
  ps01_run_index?: number;
  ps01_parent_deckle_id?: string;
  ps01_cut_combination?: number[];
  notes?: string;
  created_at: string;
  // Segmented & Master Width Support (Phase 1 Data Model)
  is_segmented?: boolean;
  segments?: MetallizerPackageSegment[];
  transitions?: DoffKnifeTransition[];
  is_master_width_clustered?: boolean;
  master_width_cluster_id?: string;
  master_width_mm?: number;
  canonical_master_width_mm?: number;
}

export interface KnifeArmMovement {
  arm_index?: number;
  shaft?: 'FRONT' | 'REAR';
  from_width_mm: number;
  to_width_mm: number;
  delta_mm: number;
  order_id_from?: string;
  order_id_to?: string;
  sales_order_from?: string;
  sales_order_to?: string;
  customer_from?: string;
  customer_to?: string;
}

export interface StationaryKnifeArm {
  arm_index?: number;
  shaft?: 'FRONT' | 'REAR';
  width_mm: number;
  order_id?: string;
  sales_order?: string;
  customer?: string;
}

export interface DoffKnifeTransition {
  transition_index: number;
  at_length_m: number;
  from_segment_index: number;
  to_segment_index: number;
  stationary_arms: StationaryKnifeArm[];
  shifted_arms: KnifeArmMovement[];
  cuts_before: number[];
  cuts_after: number[];
  trim_before_mm: number;
  trim_after_mm: number;
  net_width_delta_mm: number;
  duplex_balanced: boolean;
  estimated_downtime_minutes?: number;
  notes?: string;
}

export interface DoffTransitionValidationResult {
  is_valid: boolean;
  isValid: boolean;
  reject_reason?: string;
  errors: string[];
  violations: string[];
  transition?: DoffKnifeTransition;
  stationary_arms: StationaryKnifeArm[];
  shifted_arms: KnifeArmMovement[];
  stationary_arms_count: number;
  shifted_arms_count: number;
  shifted_shaft?: 'FRONT' | 'REAR' | 'BOTH' | 'NONE';
  is_same_shaft: boolean;
  is_1arm_transition: boolean;
  is_2arm_same_shaft_transition: boolean;
  net_width_delta_mm: number;
  trim_before_mm: number;
  trim_after_mm: number;
}

export interface MetallizerSegmentOrderAllocation {
  order_id: string;
  sales_order: string;
  item_number: number;
  customer: string;
  width_mm: number;
  length_m: number;
  ups?: number;
  planned_reels?: number;
  required_reels?: number;
  weight_per_reel_kg?: number;
  planned_weight_kg?: number;
  weight_kg: number;
  remaining_before_kg?: number;
  remaining_after_kg?: number;
  is_closed?: boolean;
}

export interface MetallizerPackageSegment {
  segment_index: number;
  package_number?: number;
  start_length_m: number;
  end_length_m: number;
  length_m: number;
  cuts: number[];
  finished_widths_covered?: number[];
  total_slit_width_mm: number;
  trim_mm: number;
  ups: number;
  orders_covered: (MetallizerPlanOrderAllocation | MetallizerSegmentOrderAllocation)[];
  shaft_distribution?: {
    front_cuts: number[];
    rear_cuts: number[];
    front_ups: number;
    rear_ups: number;
  };
  segment_weight_kg?: number;
  trim_weight_kg?: number;
  waste_percent?: number;
  notes?: string;
}

export interface MetallizerPlanOrderAllocation {
  order_id?: string;
  sales_order: string;
  item_number: number;
  customer: string;
  width_mm: number;
  length_m: number;
  ups: number;
  planned_reels: number;
  required_reels?: number;
  weight_per_reel_kg: number;
  planned_weight_kg: number;
  weight_kg?: number;
  remaining_before_kg: number;
  remaining_after_kg: number;
  is_closed: boolean;
}

export interface MetallizerPlan {
  id: string;
  plan_number: string; // e.g. "MSL-20260821-001"
  film: string;
  jumbo_roll_id: string; // e.g. "JR-001"
  jumbo_roll_db_id: string;
  jumbo_width_mm: number;
  jumbo_length_m: number;
  thickness_micron: number;
  diameter_mm: number;
  core: string;
  ups: number;
  finished_sizes: number[];
  total_slit_width_mm: number;
  trim_mm: number;
  package_length_m: number;
  package_multiple: number;
  orders_covered: (MetallizerPlanOrderAllocation | MetallizerSegmentOrderAllocation)[];
  planned_quantity_kg: number;
  trim_weight_kg: number;
  waste_percent: number;
  consumed_length_m: number;
  remaining_roll_length_m: number;
  roll_status_after: 'CONSUMED' | 'PARTIALLY_CONSUMED';
  status: PlanStatus;
  created_by: string;
  created_at: string;
  approved_by?: string;
  approved_at?: string;
  notes?: string;

  // Segmented & Consolidated MSL Plan Support (Phase 1 Data Model)
  is_segmented?: boolean;
  segments?: MetallizerPackageSegment[];
  transitions?: DoffKnifeTransition[];
  is_consolidated?: boolean;
  consolidated_roll_ids?: string[];
  consolidated_rolls_count?: number;
  is_master_width_clustered?: boolean;
  master_width_cluster_id?: string;
  master_width_mm?: number;
  canonical_master_width_mm?: number;

  // Dynamic Asynchronous Continuation Support
  arm_schedules?: ArmScheduleInterval[];
  doff_events?: SlitterDoffEvent[];
  is_dynamic_continuous_run?: boolean;
  is_residual_sweep?: boolean;
  continuous_run_meters?: number;
  continuous_run_id?: string;
}

export interface MasterWidthClusterCandidate {
  id?: string;
  film?: string;
  thickness_micron?: number;
  package_length_m?: number;
  package_multiple?: number;
  required_jumbo_length_m?: number;
  required_jumbo_width_mm?: number;
  jumbo_width_mm?: number;
  finished_widths_covered?: number[];
  slit_widths?: number[];
  total_slit_width_mm?: number;
  expected_trim_mm?: number;
  trim_width_mm?: number;
  trim_mm?: number;
  required_rolls_count?: number;
  ps01_parent_deckle_id?: string;
  ps01_cut_combination?: number[];
  ps01_feasibility?: PS01FeasibilityInfo;
  orders_covered?: any[];
  [key: string]: any;
}

export interface MasterWidthClusteringOptions {
  deckle_width_mm?: number;
  ps01_min_green_trim_mm?: number;
  ps01_max_green_trim_mm?: number;
  msl_min_trim_mm?: number;
  msl_max_trim_mm?: number;
  companionPool?: (MasterWidthClusterCandidate | JumboRequirement)[];
  preferredWmaster?: number;
}

export interface MasterWidthClusteringResult {
  is_valid: boolean;
  status: 'ACCEPTED' | 'REJECTED';
  reject_reason?: string;
  omega_min: number;
  omega_max: number;
  canonical_master_width_mm?: number;
  pattern_trims: Array<{
    id?: string;
    sum_cuts: number;
    original_width: number;
    canonical_width: number;
    trim_mm: number;
    is_msl_valid: boolean;
  }>;
  msl_feasibility: {
    is_valid: boolean;
    reason?: string;
  };
  ps01_feasibility: {
    is_valid: boolean;
    status: 'GREEN' | 'YELLOW' | 'RED';
    ps01_deckle_mm: number;
    ps01_trim_mm: number;
    ps01_cut_combination: number[];
    ps01_ups: number;
    explanation: string;
  };
}

export interface MetallizerTestResult {
  id: string;
  code: string; // e.g. "MSL-01"
  title: string;
  description: string;
  status: 'PASS' | 'FAIL';
  expected: string;
  actual: string;
  execution_ms: number;
}

/**
 * Checks whether a MetallizerPlan is a segmented plan with package-boundary segments.
 */
export function isSegmentedMetallizerPlan(plan?: MetallizerPlan | null): boolean {
  if (!plan || typeof plan !== 'object') return false;
  return Boolean(plan.is_segmented && Array.isArray(plan.segments) && plan.segments.length > 0);
}

/**
 * Checks whether a JumboRequirement is a segmented requirement.
 */
export function isSegmentedJumboRequirement(req?: JumboRequirement | null): boolean {
  if (!req || typeof req !== 'object') return false;
  return Boolean(req.is_segmented && Array.isArray(req.segments) && req.segments.length > 0);
}

/**
 * Safely deserializes a JSON string into a MetallizerPlan, ensuring backward compatibility
 * with non-segmented legacy plans.
 */
export function deserializeMetallizerPlan(raw: string | object | null | undefined): MetallizerPlan {
  if (!raw) return { is_segmented: false } as MetallizerPlan;
  try {
    const plan: any = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!plan || typeof plan !== 'object') return { is_segmented: false } as MetallizerPlan;
    return {
      ...plan,
      is_segmented: plan.is_segmented ?? false,
      segments: Array.isArray(plan.segments) ? plan.segments : undefined,
      transitions: Array.isArray(plan.transitions) ? plan.transitions : undefined,
    };
  } catch {
    return { is_segmented: false } as MetallizerPlan;
  }
}

/**
 * Safely serializes a MetallizerPlan or plan array into a JSON string, preserving all segment data if present.
 */
export function serializeMetallizerPlan(plan: MetallizerPlan | MetallizerPlan[]): string {
  return JSON.stringify(plan);
}

/**
 * Safely deserializes a JSON string into a JumboRequirement, ensuring backward compatibility
 * with non-segmented legacy requirements.
 */
export function deserializeJumboRequirement(raw: string | object | null | undefined): JumboRequirement {
  if (!raw) return { is_segmented: false } as JumboRequirement;
  try {
    const req: any = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!req || typeof req !== 'object') return { is_segmented: false } as JumboRequirement;
    return {
      ...req,
      is_segmented: req.is_segmented ?? false,
      segments: Array.isArray(req.segments) ? req.segments : undefined,
      transitions: Array.isArray(req.transitions) ? req.transitions : undefined,
    };
  } catch {
    return { is_segmented: false } as JumboRequirement;
  }
}

/**
 * Safely serializes a JumboRequirement or requirement array into a JSON string.
 */
export function serializeJumboRequirement(req: JumboRequirement | JumboRequirement[]): string {
  return JSON.stringify(req);
}

/**
 * Phase 3: Physical Slitting & Segment Validation Interfaces
 */
export interface SegmentValidationResult {
  is_valid: boolean;
  isValid: boolean;
  violations: string[];
  errors: string[];
  segment_index?: number;
  trim_mm?: number;
  total_slit_width_mm?: number;
  ups?: number;
  front_ups?: number;
  rear_ups?: number;
  is_trim_valid?: boolean;
  is_min_cut_valid?: boolean;
  is_max_cuts_valid?: boolean;
  is_shaft_cuts_valid?: boolean;
  is_duplex_balanced?: boolean;
  is_shaft_length_homogeneous?: boolean;
  // Whole-jumbo continuity fields
  jumbo_id?: string;
  segments_count?: number;
  segment_results?: SegmentValidationResult[];
  is_continuity_valid?: boolean;
  is_headroom_valid?: boolean;
}

export interface SegmentedJumboValidationOptions {
  min_trim_mm?: number;          // default: 18
  max_trim_mm?: number;          // default: 45
  min_cut_width_mm?: number;     // default: 400
  max_total_cuts?: number;       // default: 5
  max_shaft_cuts?: number;       // default: 3
  max_duplex_imbalance?: number; // default: 1
  max_overallocation_factor?: number; // default: 1.10
  orderDemandMap?: Map<string, number>;
  orders?: any[];
}

export type SegmentedJumboValidationResult = SegmentValidationResult;

export interface ShaftDistributionResult {
  front_cuts: number[];
  rear_cuts: number[];
  front_ups: number;
  rear_ups: number;
  is_balanced: boolean;
}

export interface ArmScheduleInterval {
  arm_index: number;
  shaft: 'FRONT' | 'REAR';
  order_id: string;
  sales_order: string;
  item_number: number;
  customer: string;
  width_mm: number;
  start_length_m: number;
  end_length_m: number;
  length_m: number;
  reels: number;
  weight_kg: number;
  package_index_start: number;
  package_index_end: number;
}

export interface SlitterDoffEvent {
  at_length_m: number;
  package_boundary: number;
  completed_orders: Array<{
    sales_order: string;
    item_number: number;
    arm_index: number;
    width_mm: number;
    customer: string;
  }>;
  reassigned_arms: Array<{
    arm_index: number;
    shaft: 'FRONT' | 'REAR';
    from_width_mm: number;
    to_width_mm: number;
    delta_mm: number;
    new_order: string;
    customer: string;
  }>;
  continuous_arms: Array<{
    arm_index: number;
    shaft: 'FRONT' | 'REAR';
    width_mm: number;
    order: string;
    customer: string;
  }>;
  transition_type: '0-ARM' | '1-ARM' | '2-ARM_SAME_SHAFT';
  estimated_downtime_minutes: number;
}


