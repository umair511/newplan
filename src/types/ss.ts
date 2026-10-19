import { UserRole, PlanStatus } from './index';

export type SSJumboRollStatus = 'AVAILABLE' | 'RESERVED' | 'PARTIALLY_CONSUMED' | 'CONSUMED';
export type JumboRollStatus = SSJumboRollStatus;

export interface SSJumboRoll {
  id: string;
  roll_id: string; // e.g. "SS-JR-001" or "SS-JR-MZ18-3000-01"
  film: string;    // e.g. "MZ18", "MZ20", "TH21-18", "TH21-20"
  width_mm: number; // Max 1730 mm
  length_m: number; // Length in meters
  thickness_micron: number; // Thickness in microns (e.g. 18)
  diameter_mm: number; // Calculated: 1.14 * sqrt(thickness_micron * length_m)
  core: string; // Default: '10-inch steel core'
  density: number; // Default: 0.91
  production_date?: string;
  status: SSJumboRollStatus;
  source_plan?: string;
  source_requirement_id?: string;
  requirement?: SSJumboRequirement;
  consumed_by_plan?: string;
  remaining_length_m: number;
  remaining_quantity_kg: number;
  total_weight_kg: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export type JumboRoll = SSJumboRoll;

export interface SSMachineSettings {
  id: string;
  machine_name: string; // "Secondary Slitter"
  physical_ups: number; // 14
  preferred_ups: number; // 3
  max_planning_ups: number; // 14 (SS has 14 UPS available, can use 1 to 14 UPS)
  max_jumbo_width_mm: number; // 1730
  /** PS01 mother deckle for SS jumbo synthesis. Options: 10400 | 10330 | 8700 | 8630 */
  ps01_deckle_width_mm?: number;
  max_jumbo_diameter_mm: number; // 1000
  min_trim_mm: number; // 11 (GREEN zone min)
  max_trim_mm: number; // 35 (GREEN zone max)
  hard_max_trim_mm?: number; // 45 (YELLOW zone max, 36–45)
  min_slit_width_mm?: number;
  max_slit_width_mm?: number;
  diameter_constant?: number;
  core: string; // "10-inch steel core"
  density: number; // 0.91
  package_multiples: number[]; // [1, 2, 3, 4, 5, 6]
  thickness_micron_default: number; // 18
  updated_at: string;
}

export type MetallizerMachineSettings = SSMachineSettings;

export type SSPS01HandshakeStatus = 'GREEN' | 'YELLOW' | 'RED';
export type SSTrimRelaxationType = 'NONE' | 'MSL_TRIM_ADJUSTED' | 'PS01_TRIM_RELAXED';

export interface SSPS01FeasibilityInfo {
  status: SSPS01HandshakeStatus;
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
  relaxation_type: SSTrimRelaxationType;
  relaxation_flag?: string;
  explanation: string;
}

export type PS01FeasibilityInfo = SSPS01FeasibilityInfo;

export interface SSJumboRequirement {
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
  ps01_feasibility?: SSPS01FeasibilityInfo;
  is_mutually_feasible: boolean;
  relaxation_flag?: string;
  selected_for_msl?: boolean;
  relaxation_accepted?: boolean;
  ps01_run_index?: number;
  ps01_parent_deckle_id?: string;
  notes?: string;
  created_at: string;
}

export type JumboRequirement = SSJumboRequirement;

export interface SSPlanOrderAllocation {
  order_id: string;
  sales_order: string;
  item_number: number;
  customer: string;
  width_mm: number;
  length_m: number;
  ups: number;
  planned_reels: number;
  weight_per_reel_kg: number;
  planned_weight_kg: number;
  weight_kg: number;
  remaining_before_kg: number;
  remaining_after_kg: number;
  is_closed: boolean;
}

export type MetallizerPlanOrderAllocation = SSPlanOrderAllocation;

export interface SSPlan {
  id: string;
  plan_number: string; // e.g. "SS-20260821-001"
  film: string;
  jumbo_roll_id: string; // e.g. "SS-JR-001"
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
  orders_covered: SSPlanOrderAllocation[];
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
  repeat_count?: number;
  jumbo_rolls_count?: number;
  jumbo_roll_ids?: string[];
  source_requirement_id?: string;
}

export type MetallizerPlan = SSPlan;

export interface SSTestResult {
  id: string;
  code: string; // e.g. "SS-01"
  title: string;
  description: string;
  status: 'PASS' | 'FAIL';
  expected: string;
  actual: string;
  execution_ms: number;
}

export type MetallizerTestResult = SSTestResult;
