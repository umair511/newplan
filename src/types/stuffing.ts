/**
 * Container Stuffing & Planning Module - Type Definitions
 * Based on Industrial Export Specifications (DARU TRADING, Global Packaging, BAT Sudan, Euro Asia)
 */

export type PackingMode = 'HPP' | 'VPP' | 'AUTO';
export type ContainerType = '20ft' | '40ft_HC';

export interface OrderInput {
  item?: number;
  film: string;          // e.g., "TH21-25", "OC217-40", "TN01-30", "TC20-20"
  size: number;          // mm (e.g. 950, 620, 640, 120, 245)
  length: number;        // m (e.g. 15500, 3200, 4275, 2400)
  core: number;          // 3 or 6 inch (default 6 or 3)
  dia?: number;          // mm (if 0, auto-calculated from length & thickness)
  qty: number;           // kg (Order quantity)
  customer?: string;
  po_ref?: string;
  packing_mode?: PackingMode; // "HPP", "VPP", or "AUTO"
  container_type?: ContainerType; // "20ft" or "40ft_HC"
  custom_reels_per_pallet?: number; // Optional manual override (e.g., 1, 2, 3 in HPP or 144, 72, 18, 12 in VPP)
  custom_planned_reels?: number;    // Optional manual override for total planned reel count (e.g. 20, 21, 22...)
  custom_rolls_per_layer?: number;  // Optional manual override for VPP rolls per layer (e.g. 9, 6, 4)
  custom_layers?: number;           // Optional manual override for VPP stacked layers/tiers (e.g. 16, 8, 3, 2)
}

export interface CalculatedItem {
  item: number;
  formula: string;       // e.g. "10TH21-25950"
  film: string;
  size: number;
  length: number;
  core: number;
  dia: number;
  thickness: number;
  density: number;
  order_qty: number;
  per_reel_wt: number;
  required_reels_buffer: number; // Order Qty * 1.10 / per_reel_wt
  planned_reels: number;
  planned_weight: number;
  reels_per_pallet: number;
  total_pallets: number;
  pallet_width: number;  // Size + Clearance in HPP (e.g., 950 + 120 = 1070) or 1000 / 1300 / 1100 in VPP
  pallet_length: number; // 765 mm / 1100 mm in HPP or 1000 / 900 / 1100 in VPP
  pallet_height: number; // calculated mm (e.g., 2545, 1780, 2120, 2160, 1950, 2060)
  pallet_dims_str: string; // e.g. "765*1070*2545" or "1000*1000*2120"
  cradle_ply: number;    // 550, 765, 1100 (HPP) or 900, 1000, 1100 (VPP)
  packing_mode: 'HPP' | 'VPP';
  vpp_rolls_per_layer?: number; // e.g., 9 (3x3), 6 (2x3), 4 (2x2)
  vpp_layers?: number;          // e.g., 16 (for 120mm), 8 (for 245mm), 3 (for 620mm), 2 (for 950mm)
  vpp_grid_desc?: string;       // e.g. "3x3 = 9/layer (16 tiers)"
  excess_less: number;   // Order Qty - Planned Weight
  loaded_in_container: number;
  container_type?: ContainerType;
  pallets_8_reels?: number; // count of pallets with 8 reels (550 ply)
  pallets_6_reels?: number; // count of pallets with 6 reels (550/600 ply)
  pallets_4_reels?: number; // count of completion pallets with 4 reels (550/600 ply)
  pallets_3_reels?: number; // count of pallets with 3 reels
  pallets_2_reels?: number; // count of pallets with 2 reels
  pallets_1_reel?: number;  // count of pallets with 1 reel (2->1 space-fill)
  pallets_other_reels?: number; // count of pallets with other reel counts (1, 4, 6, 8)
  pallets_summary?: string; // human-readable breakdown, e.g. "5x 3-reel + 2x 2-reel = 7 pallets"
  reels_per_pallet_reason?: string;
  custom_reels_per_pallet?: number;
  custom_planned_reels?: number;
  is_size_over_1100?: boolean;
  requires_permission_for_size_over_1100?: boolean;
  is_dropped?: boolean;
  dropped_reason?: string;
  is_film_code_missing?: boolean;
  missing_film_code?: string;
  row1?: number | null;
  row2?: number | null;
  row3?: number | null;
  valid_candidates?: any[];
}

export interface RowPalletPlacement {
  row_index: 1 | 2 | 3;
  item: number;
  film: string;
  size: number;
  pallet_width: number;
  pallet_length: number;
  pallet_height: number;
  reels_per_pallet: number;
  packing_mode: 'HPP' | 'VPP';
  color_code: string;
}

export interface PalletCompositionItem {
  item: number;
  film: string;
  size: number;
  length?: number;
  core?: number;
  dia?: number;
  per_reel_wt?: number;
  reels: number;
  weight: number;
  tier_desc?: string;
  tier_position?: string;
}

export interface PalletSlotInfo {
  pallet_number: number;
  is_mixed: boolean;
  is_tc20?: boolean;
  is_space_fill?: boolean;
  mixed_type?: 'mixed_film' | 'mixed_size' | 'homogeneous';
  total_reels: number;
  total_weight: number;
  dims_str: string;
  tier_desc?: string;
  primary_film: string;
  primary_item: number;
  items: PalletCompositionItem[];
  row_index?: number;
  bay_index?: number;
  position_desc?: string;
  orientation?: 'standard' | 'rotated';
  floor_dim?: number;
  palletHeight?: number;
  transverseDim?: number;
  stackedPallet?: any;
}

export interface ContainerStuffingRow {
  bay?: number;
  row1: number | null;
  row2: number | null;
  row3: number | null;
  item1?: number;
  item2?: number;
  item3?: number;
  dims1?: string;
  dims2?: string;
  dims3?: string;
  pallet1_info?: PalletSlotInfo;
  pallet2_info?: PalletSlotInfo;
  pallet3_info?: PalletSlotInfo;
}

export interface PalletPackingDetail {
  size: number;
  film: string;
  total_pallet: number;
  pallet_width: number;
  pallet_dims_str?: string;
  packing_mode?: 'HPP' | 'VPP';
  loaded_in_container: number;
}

export interface ContainerPlan {
  id: number;
  name: string; // e.g. "Container # 1 40ft HC" or "Container # 1 20ft"
  container_type: ContainerType;
  total_weight: number;
  max_weight: number;
  weight_utilization_pct: number;
  space_utilization_pct?: number; // % of 12032 mm length utilized by the longest row
  total_reels: number;
  total_pallets: number;
  pallets_8_reels?: number;
  pallets_6_reels?: number;
  pallets_4_reels?: number;
  pallets_3_reels?: number;
  pallets_2_reels?: number;
  pallets_1_reel?: number;
  loaded_pallets: number;
  orders: CalculatedItem[];
  stuffing_grid: ContainerStuffingRow[];
  pallet_packing_details: PalletPackingDetail[];
  row_lengths: {
    row1: number;
    row2: number;
    row3?: number;
    max_length: number;
  };
  physical_pallets?: PalletSlotInfo[];
}

export interface FinalPlanTotals {
  total_order_qty: number;
  total_planned_weight: number;
  excess_less_total: number;
  total_containers: number;
  total_reels: number;
  total_pallets: number;
}

export interface VppSpaceFillCandidate {
  gridA: number;
  gridB: number;
  palletLength: number;
  palletWidth: number;
  reelsPerLayer: number;
  layers: number;
  totalReelsAbsorbed: number;
  palletHeight: number;
  palletWeight: number;
  orientation: 'standard' | 'rotated';
  dimsStr: string;
  floorDimension: number;
  transverseDimension: number;
  targetRow: number;
  availableSpaceDesc: string;
  areaUtilization?: number;
}

export interface VppSpaceFillOpportunity {
  spilloverItem: CalculatedItem;
  spilloverReels: number;
  spilloverWeight: number;
  sourceContainerIndex: number;
  targetContainerIndex: number;
  availableFreeSpace: {
    length: number;
    width: number;
    height: number;
    remainingPayload: number;
    targetRow: number;
    description: string;
  };
  proposedPallet: VppSpaceFillCandidate;
  containerCountBefore: number;
  containerCountAfter: number;
  eliminatesExtraContainer: boolean;
  approved?: boolean;
}

export type VppSpaceFillFeasibilityStatus = 'ALREADY_OPTIMAL' | 'FEASIBLE' | 'NOT_FEASIBLE';

export interface VppSpaceFillFeasibilityReport {
  status: VppSpaceFillFeasibilityStatus;
  reason?: string;
  opportunity?: VppSpaceFillOpportunity | null;
}

export interface FinalPlan {
  summary: CalculatedItem[];
  containers: ContainerPlan[];
  totals: FinalPlanTotals;
  client_name?: string;
  container_type: ContainerType;
  packing_mode: PackingMode;
  generated_at: string;
  config_used: StuffingConfig;
  vpp_space_fill_opportunity?: VppSpaceFillOpportunity | null;
  vpp_space_fill_feasibility?: VppSpaceFillFeasibilityReport | null;
}

export interface StuffingConfig {
  container_type: ContainerType;  // '20ft' | '40ft_HC'
  default_packing_mode: PackingMode; // 'HPP' | 'VPP' | 'AUTO'
  container_max_weight: number;   // Default: 26000 kg (40ft HC) or 21500 kg (20ft)
  container_internal_width: number; // Default: 2352 mm
  container_internal_length: number; // Default: 12032 mm (40ft) or 5898 mm (20ft)
  container_internal_height: number; // Default: 2698 mm (40ft HC) or 2393 mm (20ft)
  pallet_clearance: number;       // Default: 120 mm for HPP
  pallet_length: number;          // Default: 765 mm
  buffer_percentage: number;      // Default: 1.10 (10% extra)
  dia_threshold_for_3_reels: number; // Default: 760 mm (height limit in 40ft HC)
  max_size_for_3_reels: number;      // Default: 1099 mm (sizes >= 1100 mm default strictly to max 2 reels/pallet)
  allow_3_reels_above_1100_size?: boolean; // Default: false (requires user permission to allow 3 reels for size >= 1100 mm)
  allow_3_reels_above_580_dia?: boolean; // Default: false (allows 3 reels for Dia > 580 mm)
  allow_850_ply_mixed_orientation?: boolean; // Default: true (Line 1 Ply-Facing + Line 2 Side-Facing 90° for 850mm Ply to maximize weight payload)
  enable_smart_hybrid_optimization?: boolean; // Default: true (auto-optimizes 2-reel vs 3-reel mix for size < 1100 mm to fill 12m length & weight)
  allow_vpp_space_fill_pallet?: boolean; // Default: false (planner approved VPP non-standard residual space-fill pallet exception)
  max_pallets_per_container: number; // Default: 999 (unlimited, bounded by space/weight)
  vpp_pallet_base_width: number;  // 1300 mm
  vpp_pallet_base_length: number; // 900 mm
  vpp_tare_height: number;        // 200 mm
}

export interface SavedStuffingPlan {
  id: string;
  plan_name: string;
  customer: string;
  sales_order: string;
  po_ref?: string;
  container_type: ContainerType;
  packing_mode: PackingMode;
  total_containers: number;
  total_weight: number;
  total_pallets: number;
  items_count: number;
  orders: OrderInput[];
  created_at: string;
  updated_at: string;
  notes?: string;
}

export interface FilmDensityMaster {
  code: string;
  thickness: number;
  density: number;
  summary_code: string;
  plant?: string;
  rejected_material?: string;
}
