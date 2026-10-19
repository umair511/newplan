/**
 * Automated Container Stuffing & Planning Calculation Engine
 * Supports BOTH HPP (Horizontal Pallet Packing) and VPP (Vertical Pallet Packing / Eye-to-Sky)
 * Supports BOTH 20FT Containers (9-10 Pallets, 2-Row) and 40FT HC Containers (20-28 Pallets, 3-Row/2-Row)
 * Validated against real factory export orders (DARU TRADING, Global Packaging, BAT Sudan, Euro Asia, PETPAK)
 */

import { 
  OrderInput, 
  CalculatedItem, 
  ContainerPlan, 
  FinalPlan, 
  StuffingConfig, 
  ContainerStuffingRow,
  PalletPackingDetail,
  PackingMode,
  ContainerType,
  PalletSlotInfo,
  PalletCompositionItem,
  VppSpaceFillCandidate,
  VppSpaceFillOpportunity,
  VppSpaceFillFeasibilityReport,
  VppSpaceFillFeasibilityStatus
} from '../../types/stuffing';
import { lookupFilmSpecs } from './filmDensities';
import { isQualifyingTC20Order, isEligibleForVppConsolidation } from '../../rules/validator';

export const DEFAULT_STUFFING_CONFIG: StuffingConfig = {
  container_type: '40ft_HC',
  default_packing_mode: 'AUTO',
  container_max_weight: 26000, // kg (Target container weight around 24,000 - 26,000 kg, nominal 25,500 kg)
  container_internal_width: 2352, // mm
  container_internal_length: 12032, // mm (40ft HC internal length)
  container_internal_height: 2698, // mm (40ft HC internal height)
  pallet_clearance: 120, // mm (Pallet Width = Size + 120 in HPP)
  pallet_length: 765, // mm (765 mm standard HPP ply)
  buffer_percentage: 1.10, // 10% extra reels buffer
  dia_threshold_for_3_reels: 760, // mm (in 40ft HC, max roll diameter fitting 2545 mm pallet height)
  max_size_for_3_reels: 1099, // mm (sizes >= 1100 mm strictly default to max 2 reels/pallet unless user grants permission)
  allow_3_reels_above_1100_size: false, // Default false: User permission required to allow 3 reels for size >= 1100 mm
  enable_smart_hybrid_optimization: true, // Default true: Intelligently auto-computes 2-reel vs 3-reel mix for size < 1100 mm to fill 12m length & weight
  allow_vpp_space_fill_pallet: false, // Default false: Planner approval required for non-standard space-fill pallet
  max_pallets_per_container: 999, // No artificial pallet cap - bounded by volume/weight
  vpp_pallet_base_width: 1300, // mm
  vpp_pallet_base_length: 900, // mm
  vpp_tare_height: 250, // mm factory tare allowance for wooden pallet deck + top protection cap
};

export const CONFIG_20FT: StuffingConfig = {
  container_type: '20ft',
  default_packing_mode: 'VPP',
  container_max_weight: 21500, // kg (20ft dry container structural max)
  container_internal_width: 2352, // mm
  container_internal_length: 5898, // mm (20ft dry container length)
  container_internal_height: 2393, // mm (20ft dry container height)
  pallet_clearance: 120,
  pallet_length: 765,
  buffer_percentage: 1.10,
  dia_threshold_for_3_reels: 760,
  max_size_for_3_reels: 1099,
  allow_3_reels_above_1100_size: false,
  enable_smart_hybrid_optimization: true,
  allow_vpp_space_fill_pallet: false,
  max_pallets_per_container: 999, // No artificial pallet cap - bounded by volume/weight
  vpp_pallet_base_width: 1300,
  vpp_pallet_base_length: 900,
  vpp_tare_height: 250,
};

/**
 * FINAL FACTORY USABLE PALLET-PLACEMENT ENVELOPE (20ft Container)
 * Hard factory constraints for all pallet placement, pinwheel fit, row length,
 * transverse fit, pallet height, and vertical stacking:
 * - Max usable length: 5750 mm
 * - Max usable width: 2320 mm
 * - Max usable height: 2280 mm
 * Do NOT use the larger internal container dimensions for pallet optimization.
 */
export const USABLE_20FT_ENVELOPE = {
  max_length: 5750,
  max_width: 2320,
  max_height: 2280,
} as const;

/**
 * Industrial Roll Diameter Calculation Formula:
 * Empirical Formula from Golden Geometry SRS:
 * Calculated DIA = 1.174 * SQRT(Length * Thickness)
 */
export function calculateRollDiameter(length: number, thickness: number, core: number = 6): number {
  if (!length || length <= 0 || !thickness || thickness <= 0) return 0;
  return Math.round(1.174 * Math.sqrt(length * thickness));
}

/**
 * Standard Multi-Customer Presets for Real Testing & Validation
 */

// 1. FACTORY DEFAULT SEED DATA (PROPACK SAL 40ft HC Master)
export const DEFAULT_FACTORY_SEED_ORDERS: OrderInput[] = [
  { item: 10, film: 'TH21-20', size: 675, length: 9750, core: 3, dia: 518, qty: 2000, customer: 'PROPACK SAL', packing_mode: 'HPP', custom_reels_per_pallet: 8, container_type: '40ft_HC' },
  { item: 20, film: 'MZ10S-20', size: 675, length: 9350, core: 3, dia: 508, qty: 2000, customer: 'PROPACK SAL', packing_mode: 'HPP', custom_reels_per_pallet: 8, container_type: '40ft_HC' },
  { item: 30, film: 'TH21-20', size: 855, length: 9750, core: 3, dia: 518, qty: 1000, customer: 'PROPACK SAL', packing_mode: 'HPP', custom_reels_per_pallet: 8, container_type: '40ft_HC' },
  { item: 40, film: 'MZ10S-20', size: 855, length: 9350, core: 3, dia: 508, qty: 1000, customer: 'PROPACK SAL', packing_mode: 'HPP', custom_reels_per_pallet: 8, container_type: '40ft_HC' },
  { item: 50, film: 'TH21-20', size: 895, length: 9750, core: 3, dia: 518, qty: 5094, customer: 'PROPACK SAL', packing_mode: 'HPP', custom_reels_per_pallet: 8, container_type: '40ft_HC' },
  { item: 60, film: 'MZ10S-20', size: 895, length: 9350, core: 3, dia: 508, qty: 5173, customer: 'PROPACK SAL', packing_mode: 'HPP', custom_reels_per_pallet: 8, container_type: '40ft_HC' },
  { item: 70, film: 'TH21-20', size: 895, length: 9750, core: 3, dia: 518, qty: 1918, customer: 'PROPACK SAL', packing_mode: 'HPP', custom_reels_per_pallet: 6, container_type: '40ft_HC' },
  { item: 80, film: 'MZ10S-20', size: 895, length: 9350, core: 3, dia: 508, qty: 2127, customer: 'PROPACK SAL', packing_mode: 'HPP', custom_reels_per_pallet: 6, container_type: '40ft_HC' },
  { item: 90, film: 'OLC217-38', size: 653, length: 5100, core: 3, dia: 517, qty: 4000, customer: 'PROPACK SAL', packing_mode: 'HPP', custom_reels_per_pallet: 8, container_type: '40ft_HC' },
];

export const FACTORY_PROPACK_SAMPLE_ORDERS = DEFAULT_FACTORY_SEED_ORDERS;

// 2. GLOBAL PACKAGING SERVICE (20ft Container VPP Master - Real SAP PO)
export const GLOBAL_PACKAGING_SAMPLE_ORDERS: OrderInput[] = [
  { item: 10, film: 'CTH21L-40', size: 840, length: 3200, core: 3, qty: 587, customer: 'Global Packaging Service', packing_mode: 'VPP', container_type: '20ft' },
  { item: 20, film: 'CTH21L-40', size: 920, length: 3200, core: 3, qty: 643, customer: 'Global Packaging Service', packing_mode: 'VPP', container_type: '20ft' },
  { item: 30, film: 'CTH21L-40', size: 960, length: 3200, core: 3, qty: 671, customer: 'Global Packaging Service', packing_mode: 'VPP', container_type: '20ft' },
  { item: 40, film: 'CMZ10S-25', size: 645, length: 5125, core: 3, qty: 902, customer: 'Global Packaging Service', packing_mode: 'VPP', container_type: '20ft' },
  { item: 50, film: 'CMZ10S-25', size: 720, length: 5125, core: 3, qty: 756, customer: 'Global Packaging Service', packing_mode: 'VPP', container_type: '20ft' },
  { item: 60, film: 'CMZ10S-25', size: 750, length: 5125, core: 3, qty: 1049, customer: 'Global Packaging Service', packing_mode: 'VPP', container_type: '20ft' },
  { item: 70, film: 'CMZ10S-25', size: 760, length: 5125, core: 3, qty: 1063, customer: 'Global Packaging Service', packing_mode: 'VPP', container_type: '20ft' },
  { item: 80, film: 'CMZ10S-25', size: 780, length: 5125, core: 3, qty: 1091, customer: 'Global Packaging Service', packing_mode: 'VPP', container_type: '20ft' },
  { item: 90, film: 'CMZ10S-25', size: 900, length: 5125, core: 3, qty: 944, customer: 'Global Packaging Service', packing_mode: 'VPP', container_type: '20ft' },
  { item: 100, film: 'CMZ10S-25', size: 960, length: 5125, core: 3, qty: 1007, customer: 'Global Packaging Service', packing_mode: 'VPP', container_type: '20ft' },
  { item: 110, film: 'CMZ10S-25', size: 1000, length: 5125, core: 3, qty: 1049, customer: 'Global Packaging Service', packing_mode: 'VPP', container_type: '20ft' },
  { item: 120, film: 'CMZ10S-25', size: 1050, length: 5125, core: 3, qty: 1469, customer: 'Global Packaging Service', packing_mode: 'VPP', container_type: '20ft' },
  { item: 130, film: 'CMZ10S-25', size: 1200, length: 5125, core: 3, qty: 839, customer: 'Global Packaging Service', packing_mode: 'VPP', container_type: '20ft' },
];

// 2. DARU TRADING (40ft HC Container HPP Master - 8 Items)
export const DARU_TRADING_SAMPLE_ORDERS: OrderInput[] = [
  { item: 10, film: 'TH21-25', size: 950, length: 15500, core: 6, qty: 6500, customer: 'DARU TRADING', packing_mode: 'HPP', container_type: '40ft_HC' },
  { item: 20, film: 'TH21-25', size: 1050, length: 15500, core: 6, qty: 9500, customer: 'DARU TRADING', packing_mode: 'HPP', container_type: '40ft_HC' },
  { item: 30, film: 'TH21-25', size: 1080, length: 15500, core: 6, qty: 6500, customer: 'DARU TRADING', packing_mode: 'HPP', container_type: '40ft_HC' },
  { item: 40, film: 'TH21-25', size: 1120, length: 15500, core: 6, qty: 5500, customer: 'DARU TRADING', packing_mode: 'HPP', container_type: '40ft_HC' },
  { item: 50, film: 'TH21-30', size: 1050, length: 12900, core: 6, qty: 5000, customer: 'DARU TRADING', packing_mode: 'HPP', container_type: '40ft_HC' },
  { item: 60, film: 'TH21-30', size: 1080, length: 12900, core: 6, qty: 10000, customer: 'DARU TRADING', packing_mode: 'HPP', container_type: '40ft_HC' },
  { item: 70, film: 'TH21-30', size: 1100, length: 12900, core: 6, qty: 5000, customer: 'DARU TRADING', packing_mode: 'HPP', container_type: '40ft_HC' },
  { item: 80, film: 'TH21-30', size: 1120, length: 12900, core: 6, qty: 2500, customer: 'DARU TRADING', packing_mode: 'HPP', container_type: '40ft_HC' },
];

// 3. BAT SUDAN (British American Tobacco - Cigarette Overwrap VPP Master)
export const BAT_SUDAN_SAMPLE_ORDERS: OrderInput[] = [
  { item: 10, film: 'TC20-20', size: 120, length: 2400, core: 3, qty: 3200, customer: 'BAT Sudan', packing_mode: 'VPP', container_type: '20ft' },
  { item: 20, film: 'TC20-20', size: 245, length: 2400, core: 3, qty: 4500, customer: 'BAT Sudan', packing_mode: 'VPP', container_type: '20ft' },
  { item: 30, film: 'TC20A-23', size: 350, length: 2200, core: 3, qty: 3800, customer: 'BAT Sudan', packing_mode: 'VPP', container_type: '20ft' },
];

// 4. EURO ASIA PACKAGING (Mixed Tape & Conversion BOPP)
export const EURO_ASIA_SAMPLE_ORDERS: OrderInput[] = [
  { item: 10, film: 'TN01-20', size: 500, length: 4000, core: 3, qty: 4000, customer: 'Euro Asia Packaging', packing_mode: 'VPP', container_type: '20ft' },
  { item: 20, film: 'TN01-20', size: 600, length: 4000, core: 3, qty: 5000, customer: 'Euro Asia Packaging', packing_mode: 'VPP', container_type: '20ft' },
  { item: 30, film: 'TH21-30', size: 900, length: 10000, core: 6, qty: 6000, customer: 'Euro Asia Packaging', packing_mode: 'HPP', container_type: '40ft_HC' },
  { item: 40, film: 'TH21-30', size: 1120, length: 10000, core: 6, qty: 7000, customer: 'Euro Asia Packaging', packing_mode: 'HPP', container_type: '40ft_HC' },
];

// 5. PETPAK GLOBAL (40ft HC Container HPP BOPET Master)
export const PETPAK_SAMPLE_ORDERS: OrderInput[] = [
  { item: 10, film: 'PTN01-12', size: 1000, length: 18000, core: 6, qty: 12000, customer: 'PETPAK GLOBAL', packing_mode: 'HPP', container_type: '40ft_HC' },
  { item: 20, film: 'PTN01-12', size: 1150, length: 18000, core: 6, qty: 14000, customer: 'PETPAK GLOBAL', packing_mode: 'HPP', container_type: '40ft_HC' },
  { item: 30, film: 'PVTN01-12', size: 1050, length: 18000, core: 6, qty: 10000, customer: 'PETPAK GLOBAL', packing_mode: 'HPP', container_type: '40ft_HC' },
  { item: 40, film: 'PVTN01-12', size: 1200, length: 18000, core: 6, qty: 15000, customer: 'PETPAK GLOBAL', packing_mode: 'HPP', container_type: '40ft_HC' },
  { item: 50, film: 'PMZV00-12', size: 980, length: 18000, core: 6, qty: 8500, customer: 'PETPAK GLOBAL', packing_mode: 'HPP', container_type: '40ft_HC' },
  { item: 60, film: 'PMZV00-12', size: 1080, length: 18000, core: 6, qty: 9500, customer: 'PETPAK GLOBAL', packing_mode: 'HPP', container_type: '40ft_HC' },
];

// 6. FLEXIPACK LAMINATES
export const FLEXIPACK_SAMPLE_ORDERS: OrderInput[] = [
  { item: 10, film: 'CTH21-25', size: 950, length: 15000, core: 6, qty: 6000, customer: 'FLEXIPACK LAMINATES', packing_mode: 'HPP', container_type: '40ft_HC' },
  { item: 20, film: 'CTH21-25', size: 1050, length: 15000, core: 6, qty: 8000, customer: 'FLEXIPACK LAMINATES', packing_mode: 'HPP', container_type: '40ft_HC' },
  { item: 30, film: 'CMB21S-20', size: 1080, length: 18500, core: 6, qty: 7000, customer: 'FLEXIPACK LAMINATES', packing_mode: 'HPP', container_type: '40ft_HC' },
  { item: 40, film: 'CMZ10S-20', size: 1120, length: 18500, core: 6, qty: 5000, customer: 'FLEXIPACK LAMINATES', packing_mode: 'HPP', container_type: '40ft_HC' },
];

export const BLANK_SAMPLE_ORDER: OrderInput[] = [
  { item: 10, film: 'TH21-25', size: 1000, length: 15500, core: 6, qty: 10000, customer: 'CUSTOM CLIENT', packing_mode: 'HPP', container_type: '40ft_HC' },
];

/**
 * Helper: Resolve Effective Packing Mode (HPP vs VPP)
 */
export function resolvePackingMode(order: OrderInput, config: StuffingConfig): 'HPP' | 'VPP' {
  if (order.packing_mode === 'HPP' || order.packing_mode === 'VPP') {
    return order.packing_mode;
  }
  if (config.default_packing_mode === 'HPP' || config.default_packing_mode === 'VPP') {
    return config.default_packing_mode;
  }
  // Auto mode detection:
  // Calculate dynamic diameter if not specified
  const filmSpecs = lookupFilmSpecs(order.film);
  const thickness = filmSpecs ? filmSpecs.thickness : 20;
  const core = order.core || 6;
  const effectiveDia = order.dia && order.dia > 0 ? order.dia : calculateRollDiameter(order.length, thickness, core);

  // If container is 20ft or diameter <= 450 mm and size <= 1050 mm -> Prefer VPP
  if (config.container_type === '20ft' || (effectiveDia <= 450 && order.size <= 1050)) {
    return 'VPP';
  }
  return 'HPP';
}

/**
 * Calculate Pallet Height in HPP (Horizontal) Packing Mode:
 * Exact Formula: ply size * no of layers of ply + 200 mm pallet height
 */
export function getPalletHeightForHPP(cradlePly: number, reelsPerPallet: number): number {
  if (reelsPerPallet <= 0) return 0;
  const isDoubleColumn = cradlePly <= 600;
  if (isDoubleColumn) {
    if (reelsPerPallet === 8) return 2450;
    if (reelsPerPallet === 6) return 1900;
    if (reelsPerPallet === 4) return 1350;
    const layers = Math.max(1, Math.ceil(reelsPerPallet / 2));
    return Math.round(cradlePly * layers + 200);
  }
  const layers = Math.max(1, reelsPerPallet);
  return Math.round(cradlePly * layers + 200);
}

/**
 * Calculate Pallet Height in VPP (Vertical Pallet Packing / 1+1 Half-Height) Mode:
 * Factory Formula: (Number of Stacked Layers/Tiers * Size) + 250 mm tare
 * Reverse-Engineered from Factory Reference:
 * - Size 110 (7 layers): 7 * 110 + 250 = 1020 mm
 * - Size 118 (7 layers): 7 * 118 + 250 = 1076 mm
 * - Size 342 (3 layers): 3 * 342 + 250 = 1276 mm
 * - Size 342 (2 layers): 2 * 342 + 250 = 934 mm
 * - Size 325 (3 layers): 3 * 325 + 250 = 1225 mm
 * - Size 325 (2 layers): 2 * 325 + 250 = 900 mm
 */
export function getPalletHeightForVPP(size: number, layers: number, tareHeight: number = 250): number {
  if (layers <= 0 || size <= 0) return 0;
  return Math.round(layers * size + tareHeight);
}

/**
 * Pallet Plan Candidate Interface
 */
export interface PalletPlanCandidate {
  totalPallets: number;
  plannedReels: number;
  plannedWeight: number;
  deviationKg: number;
  deviationPct: number;
  inTolerance: boolean;
  mainReelsPerPallet: number;
  mainPalletCount: number;
  completionReelsPerPallet?: number;
  completionPalletCount?: number;
  p8Count?: number;
  p6Count?: number;
  p4Count?: number;
  p3Count: number;
  p2Count: number;
  pOtherCount: number;
  summary: string;
  reason: string;
  preferencePenalty: number;
  isDropped?: boolean;
  droppedReason?: string;
  validCandidates?: PalletPlanCandidate[];
}

/**
 * Deterministic Factory Pallet Plan Optimizer:
 * Enforces:
 * 1. Hard Final Order Tolerance: Order Qty * 0.90 <= Planned Weight <= Order Qty * 1.10
 * 2. 550 Ply: 6 reels/pal (preferred standard), 8 reels/pal (allowed standard for <1100mm), 4/5/7 reels/pal (exceptional completion only).
 * 3. 600 Ply: 6 reels/pal (standard/max), 4/5 reels/pal (exceptional completion only). 8 reels is NEVER allowed.
 * 4. 765 Ply: 2 reels/pal (preferred), 3 reels/pal (allowed for 40ft HC), 1 reel/pal (exceptional completion only).
 * 5. 850 Ply: 2 reels/pal (preferred), 1 reel/pal (completion fallback only).
 * 6. VPP: Standard discrete whole pallets targeting closest weight within tolerance (supports standard & remainder half-height tiers).
 * 7. 4-Reel Rule: 4 reels is strictly for completion/remainder only and must satisfy ±10% tolerance.
 * 8. Hard Tolerance Rule: If NO integer pallet combination satisfies ±10%, palletization is DROPPED (0 pallets, 0 reels, 0 planned kg).
 */
export function findOptimalPalletPlan(
  orderQty: number,
  perReelWt: number,
  cradlePly: number,
  options: {
    customReels?: number;
    customPlannedReels?: number;
    containerType?: string;
    isSizeOver1100?: boolean;
    allow3ReelsAbove1100?: boolean;
    packingMode?: 'HPP' | 'VPP';
    vppRollsPerPallet?: number;
    vppRollsPerLayer?: number;
    vppStandardTiers?: number;
    vppSize?: number;
    vppFilm?: string;
    vppMaxTiers?: number;
  } = {}
): PalletPlanCandidate {
  const minQty = Number((orderQty * 0.90).toFixed(2));
  const maxQty = Number((orderQty * 1.10).toFixed(2));

  // ---------------------------------------------------------------------------
  // MANUAL TOTAL PLANNED REELS OVERRIDE
  // When the planner explicitly specifies the total planned reel count for a row:
  // 1. Keep the planner's selected reel count exact and locked.
  // 2. Partition that exact reel count into pallets using standard packing rules.
  // 3. Compute planned weight and show actual +-10% validation status without reverting.
  // ---------------------------------------------------------------------------
  if (options.customPlannedReels !== undefined && options.customPlannedReels > 0) {
    const plannedReels = Math.round(options.customPlannedReels);
    const plannedWeight = Number((plannedReels * perReelWt).toFixed(2));
    const deviationKg = Number((plannedWeight - orderQty).toFixed(2));
    const deviationPct = orderQty > 0 ? Number(((deviationKg / orderQty) * 100).toFixed(2)) : 0;
    const inTolerance = plannedWeight >= minQty && plannedWeight <= maxQty;

    // --- VPP Mode Manual Total Reels ---
    if (options.packingMode === 'VPP' && options.vppRollsPerPallet && options.vppRollsPerPallet > 0) {
      const rollsPerTier = options.vppRollsPerLayer || Math.round(options.vppRollsPerPallet / (options.vppStandardTiers || 1)) || 9;
      const standardTiers = options.vppStandardTiers || Math.max(1, Math.round(options.vppRollsPerPallet / rollsPerTier));
      const targetReelsPerPallet = (options.customReels && options.customReels > 0)
        ? options.customReels
        : (standardTiers * rollsPerTier);

      const fullPallets = Math.floor(plannedReels / targetReelsPerPallet);
      const remReels = plannedReels - fullPallets * targetReelsPerPallet;

      if (remReels === 0) {
        const totalP = Math.max(1, fullPallets);
        return {
          totalPallets: totalP,
          plannedReels,
          plannedWeight,
          deviationKg,
          deviationPct,
          inTolerance,
          mainReelsPerPallet: targetReelsPerPallet,
          mainPalletCount: totalP,
          p8Count: 0,
          p6Count: 0,
          p4Count: 0,
          p3Count: 0,
          p2Count: 0,
          pOtherCount: totalP,
          summary: `${totalP}x ${targetReelsPerPallet}-reel (VPP ${standardTiers}T)`,
          reason: `VPP ${targetReelsPerPallet} reels/pallet (${standardTiers} layers, ${totalP} pallet${totalP > 1 ? 's' : ''}) (Manual Planned Reels: ${plannedReels})`,
          preferencePenalty: 0,
          isDropped: false,
        };
      } else {
        const remTiers = Math.max(1, Math.ceil(remReels / rollsPerTier));
        const totalP = fullPallets + 1;
        return {
          totalPallets: totalP,
          plannedReels,
          plannedWeight,
          deviationKg,
          deviationPct,
          inTolerance,
          mainReelsPerPallet: fullPallets > 0 ? targetReelsPerPallet : remReels,
          mainPalletCount: fullPallets > 0 ? fullPallets : 1,
          completionReelsPerPallet: fullPallets > 0 ? remReels : undefined,
          completionPalletCount: fullPallets > 0 ? 1 : undefined,
          p8Count: 0,
          p6Count: 0,
          p4Count: 0,
          p3Count: 0,
          p2Count: 0,
          pOtherCount: totalP,
          summary: fullPallets > 0
            ? `${fullPallets}x ${targetReelsPerPallet}-reel (VPP ${standardTiers}T) + 1x ${remReels}-reel (VPP ${remTiers}T)`
            : `1x ${remReels}-reel (VPP ${remTiers}T)`,
          reason: `VPP ${targetReelsPerPallet} reels/pallet (${fullPallets} full + 1x ${remReels}-reel remainder) (Manual Planned Reels: ${plannedReels})`,
          preferencePenalty: 0,
          isDropped: false,
        };
      }
    }

    // --- HPP Mode Manual Total Reels ---
    let allowedMainConfigs: number[] = [];
    let allowedCompletionConfigs: number[] = [];

    if (cradlePly === 550) {
      if (options.customReels && (options.customReels === 8 || options.customReels === 6)) {
        allowedMainConfigs = [options.customReels];
        allowedCompletionConfigs = options.customReels === 6 ? [5, 4] : [7, 5, 4];
      } else if (options.containerType === '20ft' || options.isSizeOver1100) {
        allowedMainConfigs = [6];
        allowedCompletionConfigs = [5, 4];
      } else {
        allowedMainConfigs = [8, 6];
        allowedCompletionConfigs = [7, 5, 4];
      }
    } else if (cradlePly === 600) {
      allowedMainConfigs = [6];
      allowedCompletionConfigs = [5, 4];
    } else if (cradlePly === 765) {
      if (options.customReels && (options.customReels === 3 || options.customReels === 2)) {
        allowedMainConfigs = [options.customReels];
        allowedCompletionConfigs = [1];
      } else if (options.containerType === '20ft' || (options.isSizeOver1100 && !options.allow3ReelsAbove1100)) {
        allowedMainConfigs = [2];
        allowedCompletionConfigs = [1];
      } else {
        allowedMainConfigs = [3, 2];
        allowedCompletionConfigs = [1];
      }
    } else { // 850 or other
      allowedMainConfigs = [2];
      allowedCompletionConfigs = [1];
    }

    const candidates: PalletPlanCandidate[] = [];

    const addCandidate = (
      p8: number,
      p6: number,
      p4: number,
      p3: number,
      p2: number,
      pOther: number,
      otherReels: number,
      penalty: number,
      reasonText: string
    ) => {
      const totP = p8 + p6 + p4 + p3 + p2 + pOther;
      if (totP <= 0) return;
      const sumParts: string[] = [];
      if (p8 > 0) sumParts.push(`${p8}x 8-reel (${getPalletHeightForHPP(cradlePly, 8)}mm)`);
      if (p6 > 0) sumParts.push(`${p6}x 6-reel (${getPalletHeightForHPP(cradlePly, 6)}mm)`);
      if (p4 > 0) sumParts.push(`${p4}x 4-reel (${getPalletHeightForHPP(cradlePly, 4)}mm)`);
      if (p3 > 0) sumParts.push(`${p3}x 3-reel (${getPalletHeightForHPP(cradlePly, 3)}mm)`);
      if (p2 > 0) sumParts.push(`${p2}x 2-reel (${getPalletHeightForHPP(cradlePly, 2)}mm)`);
      if (pOther > 0) sumParts.push(`${pOther}x ${otherReels}-reel (${getPalletHeightForHPP(cradlePly, otherReels)}mm)`);

      const mainReels = p8 > 0 ? 8 : p6 > 0 ? 6 : p3 > 0 ? 3 : p2 > 0 ? 2 : otherReels;
      const mainCount = p8 > 0 ? p8 : p6 > 0 ? p6 : p3 > 0 ? p3 : p2 > 0 ? p2 : pOther;

      candidates.push({
        totalPallets: totP,
        plannedReels,
        plannedWeight,
        deviationKg,
        deviationPct,
        inTolerance,
        mainReelsPerPallet: mainReels,
        mainPalletCount: mainCount,
        p8Count: p8,
        p6Count: p6,
        p4Count: p4,
        p3Count: p3,
        p2Count: p2,
        pOtherCount: pOther,
        summary: sumParts.join(' + '),
        reason: `${reasonText} (Manual Planned Reels: ${plannedReels})`,
        preferencePenalty: penalty,
        isDropped: false,
      });
    };

    // 1. Pure uniform pallets
    for (const R of allowedMainConfigs) {
      if (plannedReels % R === 0) {
        const p = plannedReels / R;
        const penalty = (R === 8 || R === 3) ? 0 : 10;
        addCandidate(
          R === 8 ? p : 0,
          R === 6 ? p : 0,
          0,
          R === 3 ? p : 0,
          R === 2 ? p : 0,
          0,
          0,
          penalty,
          `Pure ${R}-reel pallets`
        );
      }
    }

    // 2. Mixed main configurations (e.g. 8 and 6, or 3 and 2)
    if (allowedMainConfigs.length > 1) {
      const R1 = allowedMainConfigs[0];
      const R2 = allowedMainConfigs[1];
      const maxN1 = Math.floor(plannedReels / R1);
      for (let n1 = maxN1; n1 >= 1; n1--) {
        const rem = plannedReels - n1 * R1;
        if (rem > 0 && rem % R2 === 0) {
          const n2 = rem / R2;
          const penalty = 2 + (n2 / (n1 + n2));
          addCandidate(
            R1 === 8 ? n1 : 0,
            (R1 === 6 ? n1 : 0) + (R2 === 6 ? n2 : 0),
            0,
            R1 === 3 ? n1 : 0,
            (R1 === 2 ? n1 : 0) + (R2 === 2 ? n2 : 0),
            0,
            0,
            penalty,
            `Mixed ${R1}-reel and ${R2}-reel pallets`
          );
        }
      }
    }

    // 3. Main pallets + 1 completion pallet (e.g. n * 3 + 1 * 1, or n * 8 + 1 * 4, or n * 6 + 1 * 4)
    for (const R of allowedMainConfigs) {
      for (const C of allowedCompletionConfigs) {
        const rem = plannedReels - C;
        if (rem > 0 && rem % R === 0) {
          const n = rem / R;
          const penalty = 100 + (C === 1 ? 10 : 5);
          addCandidate(
            R === 8 ? n : 0,
            R === 6 ? n : 0,
            C === 4 ? 1 : 0,
            R === 3 ? n : 0,
            R === 2 ? n : 0,
            (C !== 4) ? 1 : 0,
            (C !== 4) ? C : 0,
            penalty,
            `${n}x ${R}-reel + 1x ${C}-reel completion`
          );
        }
      }
    }

    // 4. Single completion pallet (e.g. 1 reel or 4 reels)
    for (const C of allowedCompletionConfigs) {
      if (plannedReels === C) {
        addCandidate(
          0,
          0,
          C === 4 ? 1 : 0,
          0,
          0,
          C !== 4 ? 1 : 0,
          C !== 4 ? C : 0,
          150,
          `Single ${C}-reel completion pallet`
        );
      }
    }

    // 5. Fallback if no exact standard combination
    if (candidates.length === 0) {
      const R = allowedMainConfigs[0];
      const n = Math.floor(plannedReels / R);
      const rem = plannedReels - n * R;
      if (rem === 0) {
        addCandidate(
          R === 8 ? n : 0,
          R === 6 ? n : 0,
          0,
          R === 3 ? n : 0,
          R === 2 ? n : 0,
          0,
          0,
          200,
          `Standard ${R}-reel pallets`
        );
      } else if (n > 0) {
        addCandidate(
          R === 8 ? n : 0,
          R === 6 ? n : 0,
          rem === 4 ? 1 : 0,
          R === 3 ? n : 0,
          (rem === 2 && R !== 2) ? 1 : (R === 2 ? n : 0),
          (rem !== 4 && !(rem === 2 && R !== 2)) ? 1 : 0,
          (rem !== 4 && !(rem === 2 && R !== 2)) ? rem : 0,
          200,
          `${n}x ${R}-reel + 1x ${rem}-reel remainder`
        );
      } else {
        addCandidate(
          plannedReels === 8 ? 1 : 0,
          plannedReels === 6 ? 1 : 0,
          plannedReels === 4 ? 1 : 0,
          plannedReels === 3 ? 1 : 0,
          plannedReels === 2 ? 1 : 0,
          (![8, 6, 4, 3, 2].includes(plannedReels)) ? 1 : 0,
          (![8, 6, 4, 3, 2].includes(plannedReels)) ? plannedReels : 0,
          200,
          `Single ${plannedReels}-reel remainder pallet`
        );
      }
    }

    candidates.sort((a, b) => a.preferencePenalty - b.preferencePenalty || a.totalPallets - b.totalPallets);
    return candidates[0];
  }

  // VPP Mode discrete whole pallets (individual pallets evaluated against dynamic/standard tiers)
  if (options.packingMode === 'VPP' && options.vppRollsPerPallet && options.vppRollsPerPallet > 0) {
    const rollsPerTier = options.vppRollsPerLayer || Math.round(options.vppRollsPerPallet / (options.vppStandardTiers || 1)) || 9;
    const standardTiers = options.vppStandardTiers || Math.max(1, Math.round(options.vppRollsPerPallet / rollsPerTier));
    const isTC20Locked = options.vppFilm && options.vppSize ? isQualifyingTC20Order(options.vppFilm, options.vppSize, 'VPP') : false;
    const isNarrowVpp = options.vppSize ? options.vppSize <= 120 : (options.vppRollsPerPallet === 84 || standardTiers === 7);
    
    // Evaluate tier configurations:
    // For VPP-007 (TC20 < 120mm): IMMUTABLE HARD lock to 7 tiers (84 reels per pallet)
    // For VPP <= 120mm: preserve standard tiers (e.g. 7 layers) and standard - 1
    // For VPP > 120mm: dynamic layer count based on physical container height, testing from max feasible layers down to 1
    let tierOptions: number[];
    if (options.customReels && options.customReels > 0) {
      tierOptions = [standardTiers];
    } else if (isTC20Locked) {
      tierOptions = [7];
    } else if (isNarrowVpp) {
      tierOptions = Array.from(new Set([standardTiers, Math.max(1, standardTiers - 1)])).filter(t => t > 0);
    } else {
      const maxLayers = options.vppMaxTiers || Math.max(standardTiers, 1);
      tierOptions = [];
      for (let t = maxLayers; t >= 1; t--) {
        tierOptions.push(t);
      }
    }
    const maxFeasible = options.vppMaxTiers || standardTiers;
    const vppCands: PalletPlanCandidate[] = [];

    // Evaluate uniform single-tier pallet candidates
    tierOptions.forEach(t => {
      const R = t * rollsPerTier;
      const palletWt = R * perReelWt;
      const estP = orderQty / palletWt;
      const pFloor = Math.max(1, Math.floor(estP));
      const pCeil = Math.max(1, Math.ceil(estP));
      const pRound = Math.max(1, Math.round(estP));

      const testCounts = Array.from(new Set([pFloor, pCeil, pRound, Math.max(1, pFloor - 1), pCeil + 1]));
      testCounts.forEach(p => {
        const reels = p * R;
        const wt = Number((reels * perReelWt).toFixed(2));
        const devKg = Number((wt - orderQty).toFixed(2));
        const devPct = Number(((devKg / orderQty) * 100).toFixed(2));
        const inTol = wt >= minQty && wt <= maxQty;
        // Preference penalty: prioritize higher feasible tiers, then minimal deviation
        const tierPenalty = isNarrowVpp ? (standardTiers - t) * 10 : (maxFeasible - t) * 5;
        vppCands.push({
          totalPallets: p,
          plannedReels: reels,
          plannedWeight: wt,
          deviationKg: devKg,
          deviationPct: devPct,
          inTolerance: inTol,
          mainReelsPerPallet: R,
          mainPalletCount: p,
          p8Count: 0,
          p6Count: 0,
          p4Count: 0,
          p3Count: 0,
          p2Count: 0,
          pOtherCount: p,
          summary: `${p}x ${R}-reel (VPP ${t}T)`,
          reason: `VPP ${R} reels/pallet (${t} layers, ${p} pallet${p > 1 ? 's' : ''})`,
          preferencePenalty: tierPenalty,
        });
      });
    });

    const validVpp = vppCands.filter(c => c.inTolerance);
    if (validVpp.length > 0) {
      // Sort by preference penalty first, then minimal weight deviation
      validVpp.sort((a, b) => {
        if (a.preferencePenalty !== b.preferencePenalty) {
          return a.preferencePenalty - b.preferencePenalty;
        }
        return Math.abs(a.deviationKg) - Math.abs(b.deviationKg);
      });
      return {
        ...validVpp[0],
        validCandidates: validVpp,
      };
    }

    // If planner explicitly selected a custom configuration in VPP:
    // Manual selection is an explicit planner override; do NOT force DROPPED.
    if (options.customReels && options.customReels > 0) {
      const R = options.customReels;
      const palletWt = R * perReelWt;
      const p = palletWt > 0 ? Math.max(1, Math.floor(orderQty / palletWt)) : 1;
      const reels = p * R;
      const wt = Number((reels * perReelWt).toFixed(2));
      const devKg = Number((wt - orderQty).toFixed(2));
      const devPct = Number(((devKg / orderQty) * 100).toFixed(2));
      const inTol = wt >= minQty && wt <= maxQty;
      const tiers = Math.max(1, Math.round(R / rollsPerTier));

      return {
        totalPallets: p,
        plannedReels: reels,
        plannedWeight: wt,
        deviationKg: devKg,
        deviationPct: devPct,
        inTolerance: inTol,
        mainReelsPerPallet: R,
        mainPalletCount: p,
        p8Count: 0,
        p6Count: 0,
        p4Count: 0,
        p3Count: 0,
        p2Count: 0,
        pOtherCount: p,
        summary: `${p}x ${R}-reel (VPP ${tiers}T)`,
        reason: `VPP ${R} reels/pallet (${tiers} layers, ${p} pallet${p > 1 ? 's' : ''}) (Manual Override)`,
        preferencePenalty: 0,
        isDropped: false,
      };
    }
    
    // If standard homogeneous candidate did not fit within +/-10% and item is NOT TC20-locked,
    // evaluate VPP remainder candidates within valid order tolerance (mandating preservation of valid quantities):
    const vppEligibility = isEligibleForVppConsolidation({
      film: options.vppFilm || '',
      size: options.vppSize || 0,
      packing_mode: 'VPP',
    });

    if (vppEligibility.eligible && perReelWt > 0) {
      const minReels = Math.ceil(minQty / perReelWt);
      const maxReels = Math.floor(maxQty / perReelWt);
      if (minReels <= maxReels) {
        const remainderCands: PalletPlanCandidate[] = [];
        const fullR = options.vppRollsPerPallet || (standardTiers * rollsPerTier);

        for (let N = minReels; N <= maxReels; N++) {
          const wt = Number((N * perReelWt).toFixed(2));
          const devKg = Number((wt - orderQty).toFixed(2));
          const devPct = Number(((devKg / orderQty) * 100).toFixed(2));
          const fullPallets = Math.floor(N / fullR);
          const remReels = N - fullPallets * fullR;
          const totalPallets = fullPallets + (remReels > 0 ? 1 : 0);

          const halfTier = rollsPerTier > 2 ? Math.floor(rollsPerTier / 2) : 3;
          const tierAlignment = (N % halfTier === 0) ? (N % rollsPerTier === 0 ? 0 : 4) : 500;
          const devPenalty = (Math.abs(devKg) / orderQty) * 50;

          remainderCands.push({
            totalPallets,
            plannedReels: N,
            plannedWeight: wt,
            deviationKg: devKg,
            deviationPct: devPct,
            inTolerance: true,
            mainReelsPerPallet: fullPallets > 0 ? fullR : N,
            mainPalletCount: fullPallets > 0 ? fullPallets : 1,
            completionReelsPerPallet: fullPallets > 0 && remReels > 0 ? remReels : undefined,
            completionPalletCount: fullPallets > 0 && remReels > 0 ? 1 : undefined,
            p8Count: 0,
            p6Count: 0,
            p4Count: 0,
            p3Count: 0,
            p2Count: 0,
            pOtherCount: totalPallets,
            summary: fullPallets > 0 && remReels > 0
              ? `${fullPallets}x ${fullR}-reel + 1x ${remReels}-reel (VPP Remainder Pool)`
              : (remReels > 0 ? `1x ${remReels}-reel (VPP Remainder Pool)` : `${fullPallets}x ${fullR}-reel`),
            reason: `VPP ${N} reels within ±10% tolerance (${fullPallets} full pallet${fullPallets === 1 ? '' : 's'} + ${remReels} remainder reels for consolidation)`,
            preferencePenalty: 50 + tierAlignment + devPenalty,
            isDropped: false,
          });
        }

        if (remainderCands.length > 0) {
          remainderCands.sort((a, b) => a.preferencePenalty - b.preferencePenalty);
          return {
            ...remainderCands[0],
            validCandidates: remainderCands,
          };
        }
      }
    }

    // No valid VPP combination satisfies +/-10% -> DROP
    return {
      totalPallets: 0,
      plannedReels: 0,
      plannedWeight: 0,
      deviationKg: Number((0 - orderQty).toFixed(2)),
      deviationPct: -100,
      inTolerance: false,
      mainReelsPerPallet: 0,
      mainPalletCount: 0,
      p8Count: 0,
      p6Count: 0,
      p4Count: 0,
      p3Count: 0,
      p2Count: 0,
      pOtherCount: 0,
      summary: '0 Pallets (Not Palletizable)',
      reason: isTC20Locked
        ? 'TC20 (<120mm) requires immutable homogeneous 7-tier (84 reels) pallet under rule VPP-007.'
        : 'No valid pallet configuration can satisfy the mandatory ±10% order tolerance.',
      preferencePenalty: 9999,
      isDropped: true,
      droppedReason: isTC20Locked
        ? 'TC20 (<120mm) requires immutable homogeneous 7-tier (84 reels) pallet under rule VPP-007.'
        : 'No valid pallet configuration can satisfy the mandatory ±10% order tolerance.',
    };
  }

  const candidates: PalletPlanCandidate[] = [];
  let allowedMainConfigs: number[] = [];
  let allowedCompletionConfigs: number[] = [];

  if (options.customReels && options.customReels > 0) {
    allowedMainConfigs = [options.customReels];
    if (cradlePly === 550 && (options.customReels === 6 || options.customReels === 8)) {
      allowedCompletionConfigs = options.customReels === 6 ? [5, 4] : [7, 5, 4];
    } else if (cradlePly === 600 && options.customReels === 6) {
      allowedCompletionConfigs = [5, 4];
    } else if ((cradlePly === 765 || cradlePly === 850) && (options.customReels === 2 || options.customReels === 3)) {
      allowedCompletionConfigs = [1];
    }
  } else if (cradlePly === 550) {
    if (options.containerType === '20ft' || options.isSizeOver1100) {
      // 8 reels (2450mm) cannot fit in 20ft container (2393mm internal height)
      // or for Size > 1100mm: Default / Auto is strictly 6 reels per pallet
      allowedMainConfigs = [6];
      allowedCompletionConfigs = [5, 4];
    } else {
      // 550 PLY PRIORITY: 8 reels/pallet FIRST -> 6 reels/pallet SECOND
      allowedMainConfigs = [8, 6];
      allowedCompletionConfigs = [7, 5, 4];
    }
  } else if (cradlePly === 600) {
    allowedMainConfigs = [6];
    allowedCompletionConfigs = [5, 4];
  } else if (cradlePly === 765) {
    if (options.containerType === '20ft' || (options.isSizeOver1100 && !options.allow3ReelsAbove1100)) {
      allowedMainConfigs = [2];
      allowedCompletionConfigs = [1];
    } else {
      // 765 PLY PRIORITY: 3 reels/pallet FIRST -> 2 reels/pallet SECOND
      allowedMainConfigs = [3, 2];
      allowedCompletionConfigs = [1];
    }
  } else { // 850
    allowedMainConfigs = [2];
    allowedCompletionConfigs = [1];
  }

  // 1. Pure uniform pallets: N * R
  for (const R of allowedMainConfigs) {
    const palletWt = R * perReelWt;
    const estP = orderQty / palletWt;
    const pMin = Math.max(1, Math.floor(estP) - 2);
    const pMax = Math.ceil(estP) + 2;

    for (let p = pMin; p <= pMax; p++) {
      if (p <= 0) continue;
      const reels = p * R;
      const wt = Number((reels * perReelWt).toFixed(2));
      const devKg = Number((wt - orderQty).toFixed(2));
      const devPct = Number(((devKg / orderQty) * 100).toFixed(2));
      const inTol = wt >= minQty && wt <= maxQty;

      let prefPenalty = 0;
      // 550 Ply: 8 reels/pallet FIRST (0 penalty), 6 reels/pallet SECOND (10 penalty)
      if (cradlePly === 550 && R === 6) prefPenalty = 10;
      // 765 Ply: 3 reels/pallet FIRST (0 penalty), 2 reels/pallet SECOND (10 penalty)
      if (cradlePly === 765 && R === 2) prefPenalty = 10;

      const h = getPalletHeightForHPP(cradlePly, R);
      candidates.push({
        totalPallets: p,
        plannedReels: reels,
        plannedWeight: wt,
        deviationKg: devKg,
        deviationPct: devPct,
        inTolerance: inTol,
        mainReelsPerPallet: R,
        mainPalletCount: p,
        p8Count: R === 8 ? p : 0,
        p6Count: R === 6 ? p : 0,
        p4Count: R === 4 ? p : 0,
        p3Count: R === 3 ? p : 0,
        p2Count: R === 2 ? p : 0,
        pOtherCount: (R !== 2 && R !== 3 && R !== 4 && R !== 6 && R !== 8) ? p : 0,
        summary: `${p}x ${R}-reel (${h}mm)`,
        reason: `${cradlePly}mm Ply: ${p}x ${R}-reel Pallets (${h}mm)`,
        preferencePenalty: prefPenalty,
      });
    }
  }

  // 2. Mixed multi-tier main pallets (e.g. 3-reel primary + 2-reel secondary for 765 ply; 8-reel primary + 6-reel secondary for 550 ply)
  // When total reels cannot be evenly divided by the primary configuration (e.g. 28 reels = 8x3 + 2x2),
  // preserve the maximum possible higher-priority pallets and use the fallback configuration ONLY for the remainder.
  if (allowedMainConfigs.length > 1) {
    const R1 = allowedMainConfigs[0]; // e.g. 3 (765 ply) or 8 (550 ply)
    const R2 = allowedMainConfigs[1]; // e.g. 2 (765 ply) or 6 (550 ply)
    const estP1 = Math.ceil(orderQty / (R1 * perReelWt));
    const h1 = getPalletHeightForHPP(cradlePly, R1);
    const h2 = getPalletHeightForHPP(cradlePly, R2);

    for (let n1 = 1; n1 <= estP1 + 2; n1++) {
      for (let n2 = 1; n2 <= 4; n2++) {
        const reels = n1 * R1 + n2 * R2;
        const wt = Number((reels * perReelWt).toFixed(2));
        const devKg = Number((wt - orderQty).toFixed(2));
        const devPct = Number(((devKg / orderQty) * 100).toFixed(2));
        const inTol = wt >= minQty && wt <= maxQty;

        // Mixed combinations have a penalty strictly lower than pure fallback (10),
        // scaled slightly by the proportion of secondary pallets to prefer maximizing R1
        const prefPenalty = 2 + (n2 / (n1 + n2));

        candidates.push({
          totalPallets: n1 + n2,
          plannedReels: reels,
          plannedWeight: wt,
          deviationKg: devKg,
          deviationPct: devPct,
          inTolerance: inTol,
          mainReelsPerPallet: R1,
          mainPalletCount: n1,
          completionReelsPerPallet: R2,
          completionPalletCount: n2,
          p8Count: (R1 === 8 ? n1 : 0) + (R2 === 8 ? n2 : 0),
          p6Count: (R1 === 6 ? n1 : 0) + (R2 === 6 ? n2 : 0),
          p4Count: (R1 === 4 ? n1 : 0) + (R2 === 4 ? n2 : 0),
          p3Count: (R1 === 3 ? n1 : 0) + (R2 === 3 ? n2 : 0),
          p2Count: (R1 === 2 ? n1 : 0) + (R2 === 2 ? n2 : 0),
          pOtherCount: 0,
          summary: `${n1}x ${R1}-reel (${h1}mm) + ${n2}x ${R2}-reel (${h2}mm)`,
          reason: `${cradlePly}mm Ply: ${n1}x ${R1}-reel + ${n2}x ${R2}-reel Pallets (${h1}mm / ${h2}mm)`,
          preferencePenalty: prefPenalty,
        });
      }
    }
  }

  // 3. Main pallets + 1 completion pallet: (N-1) * R + 1 * C
  for (const R of allowedMainConfigs) {
    for (const C of allowedCompletionConfigs) {
      const hC = getPalletHeightForHPP(cradlePly, C);

      // Single completion pallet (N=1) - only when not manually overridden by custom reels
      if (!options.customReels) {
        const singleReels = C;
        const singleWt = Number((singleReels * perReelWt).toFixed(2));
        const sDevKg = Number((singleWt - orderQty).toFixed(2));
        const sDevPct = Number(((sDevKg / orderQty) * 100).toFixed(2));
        const sInTol = singleWt >= minQty && singleWt <= maxQty;

        let singlePenalty = 150; // Exceptional single completion pallet
        if (cradlePly === 550 && C === 7) singlePenalty = 140;
        if ((cradlePly === 550 || cradlePly === 600) && C === 5) singlePenalty = 145;

        candidates.push({
          totalPallets: 1,
          plannedReels: singleReels,
          plannedWeight: singleWt,
          deviationKg: sDevKg,
          deviationPct: sDevPct,
          inTolerance: sInTol,
          mainReelsPerPallet: C,
          mainPalletCount: 1,
          p8Count: C === 8 ? 1 : 0,
          p6Count: C === 6 ? 1 : 0,
          p4Count: C === 4 ? 1 : 0,
          p3Count: C === 3 ? 1 : 0,
          p2Count: C === 2 ? 1 : 0,
          pOtherCount: (C !== 2 && C !== 3 && C !== 4 && C !== 6 && C !== 8) ? 1 : 0,
          summary: `1x ${C}-reel (Completion, ${hC}mm)`,
          reason: `${cradlePly}mm Ply: 1x ${C}-reel Completion Pallet (${hC}mm)`,
          preferencePenalty: singlePenalty,
        });
      }

      const palletWt = R * perReelWt;
      const estP = orderQty / palletWt;
      const pMin = Math.max(1, Math.floor(estP) - 2);
      const pMax = Math.ceil(estP) + 2;

      for (let n = pMin; n <= pMax; n++) {
        if (n < 1) continue;
        const reels = n * R + C;
        const wt = Number((reels * perReelWt).toFixed(2));
        const devKg = Number((wt - orderQty).toFixed(2));
        const devPct = Number(((devKg / orderQty) * 100).toFixed(2));
        const inTol = wt >= minQty && wt <= maxQty;
        const hR = getPalletHeightForHPP(cradlePly, R);

        // Completion combination penalty:
        // 550: 8+7 (100) -> 8+5 (104) -> 8+4 (105) -> 6+7 (110) -> 6+5 (114) -> 6+4 (115)
        // 765: 3+1 (100) -> 2+1 (110)
        let combPenalty = 100;
        if (cradlePly === 550) {
          if (R === 8 && C === 7) combPenalty = 100;
          else if (R === 8 && C === 5) combPenalty = 104;
          else if (R === 8 && C === 4) combPenalty = 105;
          else if (R === 6 && C === 7) combPenalty = 110;
          else if (R === 6 && C === 5) combPenalty = 114;
          else if (R === 6 && C === 4) combPenalty = 115;
        } else if (cradlePly === 600) {
          if (R === 6 && C === 5) combPenalty = 100;
          else if (R === 6 && C === 4) combPenalty = 100;
        } else if (cradlePly === 765) {
          if (R === 3 && C === 1) combPenalty = 100;
          else if (R === 2 && C === 1) combPenalty = 110;
        }

        candidates.push({
          totalPallets: n + 1,
          plannedReels: reels,
          plannedWeight: wt,
          deviationKg: devKg,
          deviationPct: devPct,
          inTolerance: inTol,
          mainReelsPerPallet: R,
          mainPalletCount: n,
          completionReelsPerPallet: C,
          completionPalletCount: 1,
          p8Count: (R === 8 ? n : 0) + (C === 8 ? 1 : 0),
          p6Count: (R === 6 ? n : 0) + (C === 6 ? 1 : 0),
          p4Count: (R === 4 ? n : 0) + (C === 4 ? 1 : 0),
          p3Count: (R === 3 ? n : 0) + (C === 3 ? 1 : 0),
          p2Count: (R === 2 ? n : 0) + (C === 2 ? 1 : 0),
          pOtherCount: ((R !== 2 && R !== 3 && R !== 4 && R !== 6 && R !== 8) ? n : 0) + ((C !== 2 && C !== 3 && C !== 4 && C !== 6 && C !== 8) ? 1 : 0),
          summary: `${n}x ${R}-reel (${hR}mm) + 1x ${C}-reel (Completion, ${hC}mm)`,
          reason: `${cradlePly}mm Ply: ${n}x ${R}-reel + 1x ${C}-reel Completion Pallet`,
          preferencePenalty: combPenalty,
        });
      }
    }
  }

  // Filter valid candidates strictly within +/- 10%
  const validCands = candidates.filter(c => c.inTolerance);
  if (validCands.length > 0) {
    validCands.sort((a, b) => {
      // 1. Preference penalty tier (8-reel 1st for 550, 3-reel 1st for 765; pure over completion)
      if (a.preferencePenalty !== b.preferencePenalty) return a.preferencePenalty - b.preferencePenalty;
      // 2. Minimal absolute deviation from order quantity
      const diffDev = Math.abs(a.deviationKg) - Math.abs(b.deviationKg);
      if (Math.abs(diffDev) > 0.01) return diffDev;
      // 3. Pallet count
      return a.totalPallets - b.totalPallets;
    });

    let best = validCands[0];

    // -------------------------------------------------------------------------
    // FINAL-BALANCE REEL RULE:
    // After initial item-level calculation, evaluate whether adding ONE additional
    // reel materially improves quantity fulfillment.
    // 1. Calculate remainingWeight = orderQty - currentPlannedWeight
    // 2. Calculate remainingRatio = remainingWeight / reelWeight
    // 3. If remainingRatio > 50% (> 0.50):
    //    Check if targetReels = currentPlannedReels + 1 produces a valid candidate
    //    within the mandatory ±10% tolerance that satisfies all physical pallet rules.
    // 4. If all conditions pass, adopt the higher-fulfillment plan.
    // -------------------------------------------------------------------------
    if (best.plannedReels > 0 && !best.isDropped && perReelWt > 0) {
      const remainingWeight = orderQty - best.plannedWeight;
      const remainingRatio = remainingWeight / perReelWt;

      if (remainingRatio > 0.50) {
        const targetReels = best.plannedReels + 1;
        const plusOneCandidates = validCands.filter(c => c.plannedReels === targetReels);

        if (plusOneCandidates.length > 0) {
          // Sort plus-one candidates by preference penalty (prefer pure pallets), then minimal deviation
          plusOneCandidates.sort((a, b) => {
            if (a.preferencePenalty !== b.preferencePenalty) return a.preferencePenalty - b.preferencePenalty;
            const diffDev = Math.abs(a.deviationKg) - Math.abs(b.deviationKg);
            if (Math.abs(diffDev) > 0.01) return diffDev;
            return a.totalPallets - b.totalPallets;
          });

          const plusOneBest = plusOneCandidates[0];
          // Check that it satisfies mandatory ±10% tolerance
          if (plusOneBest.inTolerance) {
            best = plusOneBest;
          }
        }
      }
    }

    return {
      ...best,
      validCandidates: validCands,
    };
  }

  // If planner explicitly selected a custom reels configuration:
  // Manual selection is an explicit planner override; do NOT force DROPPED.
  if (options.customReels && options.customReels > 0) {
    const R = options.customReels;
    const palletWt = R * perReelWt;
    const p = palletWt > 0 ? Math.max(1, Math.floor(orderQty / palletWt)) : 1;
    const reels = p * R;
    const wt = Number((reels * perReelWt).toFixed(2));
    const devKg = Number((wt - orderQty).toFixed(2));
    const devPct = Number(((devKg / orderQty) * 100).toFixed(2));
    const inTol = wt >= minQty && wt <= maxQty;
    const h = getPalletHeightForHPP(cradlePly, R);

    return {
      totalPallets: p,
      plannedReels: reels,
      plannedWeight: wt,
      deviationKg: devKg,
      deviationPct: devPct,
      inTolerance: inTol,
      mainReelsPerPallet: R,
      mainPalletCount: p,
      p8Count: R === 8 ? p : 0,
      p6Count: R === 6 ? p : 0,
      p4Count: R === 4 ? p : 0,
      p3Count: R === 3 ? p : 0,
      p2Count: R === 2 ? p : 0,
      pOtherCount: (R !== 2 && R !== 3 && R !== 4 && R !== 6 && R !== 8) ? p : 0,
      summary: `${p}x ${R}-reel (${h}mm)`,
      reason: `${cradlePly}mm Ply: ${p}x ${R}-reel Pallet${p > 1 ? 's' : ''} (${h}mm) (Manual Override)`,
      preferencePenalty: 0,
      isDropped: false,
    };
  }

  // If NO candidate satisfies mandatory +/- 10% order tolerance:
  // Strictly DROP the palletization (Do NOT force a pallet)
  return {
    totalPallets: 0,
    plannedReels: 0,
    plannedWeight: 0,
    deviationKg: Number((0 - orderQty).toFixed(2)),
    deviationPct: -100,
    inTolerance: false,
    mainReelsPerPallet: 0,
    mainPalletCount: 0,
    p8Count: 0,
    p6Count: 0,
    p4Count: 0,
    p3Count: 0,
    p2Count: 0,
    pOtherCount: 0,
    summary: '0 Pallets (Not Palletizable)',
    reason: 'Order quantity is too small to form a valid pallet within ±10% tolerance.',
    preferencePenalty: 9999,
    isDropped: true,
    droppedReason: 'No valid pallet configuration can satisfy the mandatory ±10% order tolerance.',
  };
}

/**
 * Calculates optimal whole pallet count respecting standard +/- 10% order tolerance.
 * Ensures the discrete pallet weight does not overshoot beyond upper threshold (+10%).
 * If no integer count fits within ±10%, returns 0.
 */
export function optimizePalletCount(
  orderQty: number,
  palletWeight: number,
  minPallets: number = 1
): number {
  if (orderQty <= 0 || palletWeight <= 0) return 0;
  const exactPallets = orderQty / palletWeight;
  const pFloor = Math.floor(exactPallets);
  const pCeil = Math.ceil(exactPallets);
  const pRound = Math.round(exactPallets);

  const minQty = orderQty * 0.90;
  const maxQty = orderQty * 1.10;

  // 1. Check if rounded is within tolerance [-10%, +10%]
  if (pRound > 0) {
    const roundWt = pRound * palletWeight;
    if (roundWt >= minQty && roundWt <= maxQty) {
      return pRound;
    }
  }

  // 2. Check if ceil is within tolerance
  if (pCeil > 0) {
    const ceilWt = pCeil * palletWeight;
    if (ceilWt >= minQty && ceilWt <= maxQty) {
      return pCeil;
    }
  }

  // 3. Check if floor is within tolerance
  if (pFloor > 0) {
    const floorWt = pFloor * palletWeight;
    if (floorWt >= minQty && floorWt <= maxQty) {
      return pFloor;
    }
  }

  return 0;
}

/**
 * Function 1: calculateOrderMetrics(order, itemIndex, config)
 * Robust calculation for both HPP and VPP packing models
 */
export function calculateOrderMetrics(
  order: OrderInput,
  itemIndex: number = 1,
  config: StuffingConfig = DEFAULT_STUFFING_CONFIG
): CalculatedItem {
  const itemNumber = order.item && order.item > 0 ? order.item : itemIndex * 10;
  const filmSpecs = lookupFilmSpecs(order.film);

  // Strict unknown/missing Film Code check
  if (!filmSpecs) {
    const isFilmEmpty = !order.film || !order.film.trim();
    const core = order.core || 6;
    return {
      item: itemNumber,
      formula: `${itemNumber}${order.film || ''}${order.size || ''}`,
      film: order.film || '',
      size: order.size || 0,
      length: order.length || 0,
      core,
      dia: order.dia || 0,
      thickness: 0,
      density: 0,
      order_qty: order.qty || 0,
      per_reel_wt: 0,
      required_reels_buffer: 0,
      planned_reels: 0,
      planned_weight: 0,
      reels_per_pallet: 0,
      total_pallets: 0,
      pallets_8_reels: 0,
      pallets_6_reels: 0,
      pallets_4_reels: 0,
      pallets_3_reels: 0,
      pallets_2_reels: 0,
      pallets_other_reels: 0,
      pallets_summary: isFilmEmpty ? 'Missing Film Code' : `Film Code "${order.film}" Not Found in Master DB`,
      pallet_width: 0,
      pallet_length: 0,
      pallet_height: 0,
      pallet_dims_str: '-',
      cradle_ply: 0,
      packing_mode: order.packing_mode === 'VPP' ? 'VPP' : 'HPP',
      excess_less: -(order.qty || 0),
      loaded_in_container: 0,
      container_type: config.container_type,
      is_size_over_1100: (order.size || 0) > (config.max_size_for_3_reels || 1099),
      is_dropped: true,
      is_film_code_missing: true,
      missing_film_code: order.film || '',
      dropped_reason: isFilmEmpty 
        ? 'Film Code is required.' 
        : `Film Code "${order.film}" Not Found in Master Database. Please add film specs.`,
      reels_per_pallet_reason: isFilmEmpty ? 'Missing Film Code' : `Film Code "${order.film}" Not Found`,
      row1: null,
      row2: null,
      row3: null
    };
  }

  const thickness = filmSpecs.thickness;
  const density = filmSpecs.density;
  const core = order.core || 6;

  // Dynamic Industrial Roll Diameter calculation based on length, film thickness and 3"/6" core
  const calculatedDia = calculateRollDiameter(order.length, thickness, core);
  const dia = order.dia && order.dia > 0 ? order.dia : calculatedDia;

  // Per Reel Weight (kg) = (Length * Size * Density * Thickness) / 1,000,000
  const perReelWtRaw = (order.length * order.size * density * thickness) / 1000000;
  const perReelWt = Number(perReelWtRaw.toFixed(2));

  // Required Reels = (Order Qty * buffer_percentage) / Per Reel Weight
  // Strict guard against intermediate/incomplete typing (e.g. length = 0, 1, 6 or size = 0)
  const isInputValid = order.length >= 50 && order.size >= 50 && order.qty > 0 && perReelWtRaw >= 0.5;
  const rawReelsBuffer = isInputValid ? order.qty / perReelWtRaw : 0;
  // Cap at 10,000 reels per item for computational sanity
  const requiredReelsBuffer = Math.min(rawReelsBuffer, 10000);

  const mode = resolvePackingMode(order, config);

  let reelsPerPallet = 2;
  let palletLength = 765;
  let palletWidth = order.size + config.pallet_clearance;
  let palletHeight = 1780;
  let cradlePly = 765;
  let vppRollsPerLayer: number | undefined = undefined;
  let vppLayers: number | undefined = undefined;
  let vppGridDesc: string | undefined = undefined;
  const maxSizeFor3Reels = config.max_size_for_3_reels || 1099;
  const isSizeOver1100 = order.size > maxSizeFor3Reels;
  let requiresPermissionFor3Reels = false;
  let requiresPermissionForSizeOver1100 = false;
  let reelsPerPalletReason = '';
  let p8Count = 0;
  let p6Count = 0;
  let p4Count = 0;
  let p3Count = 0;
  let p2Count = 0;
  let pOtherCount = 0;
  let palletsSummary = '';
  let totalPallets = 0;
  let plannedReels = 0;

  if (!isInputValid) {
    // Incomplete or typing state: return clean empty metrics with 0 lag
    return {
      item: itemNumber,
      formula: `${itemNumber}${order.film || ''}${order.size || ''}`,
      film: order.film || '',
      size: order.size || 0,
      length: order.length || 0,
      core,
      dia: dia || 0,
      thickness: thickness || 0,
      density: density || 0,
      order_qty: order.qty || 0,
      per_reel_wt: perReelWt || 0,
      required_reels_buffer: 0,
      planned_reels: 0,
      planned_weight: 0,
      reels_per_pallet: 0,
      total_pallets: 0,
      pallets_8_reels: 0,
      pallets_6_reels: 0,
      pallets_4_reels: 0,
      pallets_3_reels: 0,
      pallets_2_reels: 0,
      pallets_other_reels: 0,
      pallets_summary: order.qty > 0 ? 'Enter valid dimensions' : '-',
      pallet_width: order.size > 0 ? palletWidth : 0,
      pallet_length: order.size > 0 ? palletLength : 0,
      pallet_height: order.size > 0 ? palletHeight : 0,
      pallet_dims_str: (order.size > 0 && order.length > 0) ? `${palletLength}*${palletWidth}*${palletHeight}` : '-',
      cradle_ply: cradlePly,
      packing_mode: mode,
      vpp_rolls_per_layer: undefined,
      vpp_layers: undefined,
      vpp_grid_desc: undefined,
      excess_less: 0,
      loaded_in_container: 0,
      container_type: config.container_type || '40ft_HC',
      reels_per_pallet_reason: 'Incomplete dimensions',
      custom_reels_per_pallet: order.custom_reels_per_pallet,
      is_size_over_1100: isSizeOver1100 && dia > 590,
      requires_permission_for_size_over_1100: false,
    };
  }

  let optimalPlan: PalletPlanCandidate | null = null;

  if (mode === 'VPP') {
    // -------------------------------------------------------------------------
    // VPP (VERTICAL PALLET PACKING / 1+1 HALF-HEIGHT STACKING FACTORY ENGINE)
    // -------------------------------------------------------------------------
    // 1. Determine Rolls per Layer (Tier) & Base Skid based on Roll Diameter & Slit Size:
    // - Narrow Web (Size <= 150 mm, Dia <= 335 mm, e.g. TC20-20 Dia 315/332 mm):
    //   3 x 4 = 12 rolls per layer on 1100x1350 mm (Dia <= 320) or 1100x1420 mm (Dia > 320) skid base.
    // - Slit Web Rolls (Dia <= 335 mm, Size > 150 mm, e.g. TC20A-23 Dia 308/323 mm):
    //   3 x 3 = 9 rolls per layer on 1100x1100 mm (Dia <= 310) or 1130x1130 mm (Dia > 310) skid base.
    // - Standard Export Slit Rolls (Dia 336 - 460 mm):
    //   2 x 3 = 6 rolls per layer on 900x1300 mm skid base.
    // - Medium Slit Rolls (Dia 461 - 580 mm):
    //   2 x 2 = 4 rolls per layer on 1100x1100 mm skid base.
    // - Large Slit Rolls (Dia > 580 mm):
    //   1 x 2 = 2 rolls per layer on 1100x1100 mm skid base.

    let rollsPerTier = 6;
    let gridPattern = '2x3';
    let baseLength = 900;
    let baseWidth = 1300;

    if (order.custom_rolls_per_layer && order.custom_rolls_per_layer > 0) {
      rollsPerTier = order.custom_rolls_per_layer;
      if (rollsPerTier === 12) {
        gridPattern = '3x4';
        baseLength = 1100;
        baseWidth = dia <= 320 ? 1350 : 1420;
      } else if (rollsPerTier === 9) {
        gridPattern = '3x3';
        baseLength = dia <= 310 ? 1100 : 1130;
        baseWidth = dia <= 310 ? 1100 : 1130;
      } else if (rollsPerTier === 6) {
        gridPattern = '2x3';
        baseLength = 900;
        baseWidth = 1300;
      } else if (rollsPerTier === 4) {
        gridPattern = '2x2';
        baseLength = 1100;
        baseWidth = 1100;
      } else {
        gridPattern = `${rollsPerTier}/layer`;
        baseLength = 1000;
        baseWidth = 1000;
      }
    } else if (dia <= 335) {
      if (order.size <= 150) {
        // Narrow web / cigarette (e.g. Size 110 Dia 315 -> 1100x1350; Size 118 Dia 332 -> 1100x1420)
        rollsPerTier = 12;
        gridPattern = '3x4';
        baseLength = 1100;
        baseWidth = dia <= 320 ? 1350 : 1420;
      } else {
        // Slit web rolls (e.g. Size 342 Dia 308 -> 1100x1100; Size 325 Dia 323 -> 1130x1130)
        rollsPerTier = 9;
        gridPattern = '3x3';
        baseLength = dia <= 310 ? 1100 : 1130;
        baseWidth = dia <= 310 ? 1100 : 1130;
      }
    } else if (dia <= 460) {
      // Standard Export Slit Reels
      rollsPerTier = 6;
      gridPattern = '2x3';
      baseLength = 900;
      baseWidth = 1300;
    } else if (dia <= 580) {
      // Medium Rolls
      rollsPerTier = 4;
      gridPattern = '2x2';
      baseLength = 1100;
      baseWidth = 1100;
    } else {
      // Large Rolls
      rollsPerTier = 2;
      gridPattern = '1x2';
      baseLength = 1100;
      baseWidth = 1100;
    }

    palletLength = baseLength;
    palletWidth = baseWidth;
    cradlePly = baseLength;
    vppRollsPerLayer = rollsPerTier;

    // 2. Determine Number of Stacked Tiers (Layers):
    // Factory tare allowance (wooden skid base + top board/protection) = 250 mm
    const tareAllowance = config.vpp_tare_height || 250;
    const is20ftOrder = (order.container_type || config.container_type) === '20ft';
    const containerHeight = is20ftOrder
      ? USABLE_20FT_ENVELOPE.max_height // HARD 2280 mm limit for 20ft pallet placement
      : (config.container_internal_height || 2698);
    
    let tiers = 1;
    let maxFeasibleTiers = 1;

    if (order.custom_layers && order.custom_layers > 0) {
      tiers = order.custom_layers;
      maxFeasibleTiers = tiers;
      reelsPerPallet = tiers * rollsPerTier;
    } else if (order.custom_reels_per_pallet && order.custom_reels_per_pallet > 0) {
      reelsPerPallet = order.custom_reels_per_pallet;
      tiers = Math.max(1, Math.round(reelsPerPallet / rollsPerTier));
      maxFeasibleTiers = tiers;
    } else {
      const isTC20Locked = isQualifyingTC20Order(order.film, order.size, 'VPP');
      if (isTC20Locked) {
        // VPP-007: Scope Film Code = TC20 AND Size < 120 mm: strictly 84 reels (7 layers x 12 rolls)
        rollsPerTier = 12;
        gridPattern = '3x4';
        baseLength = 1100;
        baseWidth = dia <= 320 ? 1350 : 1420;
        tiers = 7;
        maxFeasibleTiers = 7;
        reelsPerPallet = 84;
      } else if (order.size <= 120) {
        // Narrow web uses 7 layers in half-height pallet (e.g. 7 * 110 + 250 = 1020 mm; 7 * 118 + 250 = 1076 mm; 84 reels)
        tiers = 7;
        maxFeasibleTiers = 7;
        reelsPerPallet = tiers * rollsPerTier;
      } else {
        // Dynamic layer calculation based on physical container height:
        maxFeasibleTiers = Math.max(1, Math.floor((containerHeight - tareAllowance) / order.size));
        // Default target tiers based on reference standard or max feasible
        tiers = Math.min(maxFeasibleTiers, Math.max(1, Math.floor(1050 / order.size)));
        reelsPerPallet = tiers * rollsPerTier;
      }
    }

    let baselineReelsPerPallet = reelsPerPallet;
    let baselineTiers = tiers;
    if (order.custom_planned_reels !== undefined && !order.custom_reels_per_pallet && !order.custom_layers) {
      const basePlan = findOptimalPalletPlan(order.qty, perReelWtRaw, cradlePly, {
        packingMode: 'VPP',
        vppRollsPerPallet: reelsPerPallet,
        vppRollsPerLayer: rollsPerTier,
        vppStandardTiers: tiers,
        vppSize: order.size,
        vppFilm: order.film,
        vppMaxTiers: maxFeasibleTiers,
      });
      if (basePlan.mainReelsPerPallet && basePlan.mainReelsPerPallet > 0) {
        baselineReelsPerPallet = basePlan.mainReelsPerPallet;
        baselineTiers = Math.max(1, Math.round(baselineReelsPerPallet / rollsPerTier));
      }
    }

    // Evaluate optimal discrete pallet plan with dynamic or standard tiers
    optimalPlan = findOptimalPalletPlan(order.qty, perReelWtRaw, cradlePly, {
      packingMode: 'VPP',
      vppRollsPerPallet: baselineReelsPerPallet,
      vppRollsPerLayer: rollsPerTier,
      vppStandardTiers: baselineTiers,
      vppSize: order.size,
      vppFilm: order.film,
      vppMaxTiers: maxFeasibleTiers,
      customReels: order.custom_reels_per_pallet,
      customPlannedReels: order.custom_planned_reels,
    });

    totalPallets = optimalPlan.totalPallets;
    plannedReels = optimalPlan.plannedReels;
    pOtherCount = optimalPlan.pOtherCount;
    palletsSummary = optimalPlan.summary;
    reelsPerPalletReason = optimalPlan.reason;

    if (optimalPlan.mainReelsPerPallet && optimalPlan.mainReelsPerPallet > 0) {
      reelsPerPallet = optimalPlan.mainReelsPerPallet;
      tiers = Math.max(1, Math.round(reelsPerPallet / rollsPerTier));
    }

    vppLayers = tiers;
    palletHeight = totalPallets > 0 ? getPalletHeightForVPP(order.size, tiers, tareAllowance) : 0;
    vppGridDesc = `${gridPattern} = ${rollsPerTier}/layer (${tiers} tiers)`;
  } else {
    // -------------------------------------------------------------------------
    // HPP (HORIZONTAL PALLET PACKING / CRADLE ENGINE)
    // -------------------------------------------------------------------------
    // Ply selection based on reel diameter:
    // Dia <= 530 mm -> 550mm ply (1100mm base)
    // 530 mm < Dia <= 590 mm -> 600mm ply (1200mm base)
    // 590 mm < Dia <= 745 mm -> 765mm ply (765mm base)
    // Dia > 745 mm -> 850mm ply (850mm base)
    if (dia >= 210 && dia <= 530) {
      cradlePly = 550;
      palletLength = 1100;
    } else if (dia > 530 && dia <= 590) {
      cradlePly = 600;
      palletLength = 1200;
    } else if (dia > 590 && dia <= 745) {
      cradlePly = 765;
      palletLength = 765;
    } else {
      cradlePly = 850;
      palletLength = 850;
    }

    if (isSizeOver1100 && dia > 590) {
      requiresPermissionForSizeOver1100 = !config.allow_3_reels_above_1100_size;
    }

    optimalPlan = findOptimalPalletPlan(order.qty, perReelWtRaw, cradlePly, {
      customReels: order.custom_reels_per_pallet,
      customPlannedReels: order.custom_planned_reels,
      containerType: config.container_type,
      isSizeOver1100,
      allow3ReelsAbove1100: config.allow_3_reels_above_1100_size,
      packingMode: 'HPP',
    });

    totalPallets = optimalPlan.totalPallets;
    plannedReels = optimalPlan.plannedReels;
    reelsPerPallet = optimalPlan.mainReelsPerPallet;
    p8Count = optimalPlan.p8Count || 0;
    p6Count = optimalPlan.p6Count || 0;
    p4Count = optimalPlan.p4Count || 0;
    p3Count = optimalPlan.p3Count;
    p2Count = optimalPlan.p2Count;
    pOtherCount = optimalPlan.pOtherCount;
    palletsSummary = optimalPlan.summary;
    reelsPerPalletReason = optimalPlan.reason;

    // Height based on exact engineering formula: ply size * no of layers of ply + 200
    palletHeight = totalPallets > 0 ? getPalletHeightForHPP(cradlePly, reelsPerPallet) : 0;
  }

  const palletDimsStr = totalPallets > 0 ? `${palletLength}*${palletWidth}*${palletHeight}` : '0*0*0';

  const plannedWeight = Number((plannedReels * perReelWtRaw).toFixed(2));
  const excessLess = Number((plannedWeight - order.qty).toFixed(2));

  const formula = `${itemNumber}${order.film}${order.size}`;

  const isDropped = totalPallets === 0;
  const droppedReason = isDropped 
    ? 'No valid pallet configuration can satisfy the mandatory ±10% order tolerance.' 
    : undefined;

  return {
    item: itemNumber,
    formula,
    film: order.film,
    size: order.size,
    length: order.length,
    core: order.core || 6,
    dia,
    thickness,
    density,
    order_qty: order.qty,
    per_reel_wt: perReelWt,
    required_reels_buffer: Number(requiredReelsBuffer.toFixed(2)),
    planned_reels: plannedReels,
    planned_weight: plannedWeight,
    reels_per_pallet: reelsPerPallet,
    total_pallets: totalPallets,
    pallets_8_reels: p8Count,
    pallets_6_reels: p6Count,
    pallets_4_reels: p4Count,
    pallets_3_reels: p3Count,
    pallets_2_reels: p2Count,
    pallets_other_reels: pOtherCount,
    pallets_summary: palletsSummary,
    pallet_width: palletWidth,
    pallet_length: palletLength,
    pallet_height: palletHeight,
    pallet_dims_str: palletDimsStr,
    cradle_ply: cradlePly,
    packing_mode: mode,
    vpp_rolls_per_layer: vppRollsPerLayer,
    vpp_layers: vppLayers,
    vpp_grid_desc: vppGridDesc,
    excess_less: excessLess,
    loaded_in_container: totalPallets,
    container_type: config.container_type || '40ft_HC',
    reels_per_pallet_reason: reelsPerPalletReason,
    custom_reels_per_pallet: order.custom_reels_per_pallet,
    custom_planned_reels: order.custom_planned_reels,
    is_size_over_1100: isSizeOver1100 && dia > 590,
    requires_permission_for_size_over_1100: requiresPermissionForSizeOver1100,
    is_dropped: isDropped,
    dropped_reason: droppedReason,
    valid_candidates: (!order.custom_planned_reels && !order.custom_reels_per_pallet && optimalPlan) ? optimalPlan.validCandidates : undefined,
  };
}

interface IndividualPallet {
  item: number;
  film: string;
  size: number;
  pallet_width: number;
  pallet_length: number;
  pallet_height: number;
  pallet_dims_str: string;
  packing_mode: 'HPP' | 'VPP';
  reels?: number;
  weight?: number;
  assignedRow?: number;
  orientation?: 'standard' | 'rotated';
  longitudinalDim?: number;
  transverseDim?: number;
  isMixed?: boolean;
  mixedItems?: any[];
  tierDesc?: string;
  palletIndex?: number;
}

export interface VppPinwheelPlacementResult {
  fits: boolean;
  config: 'std' | 'pinwheel_A' | 'pinwheel_B';
  l0: number;
  l1: number;
  t0: number;
  t1: number;
  maxL: number;
  diff: number;
  stacks: Array<{
    pallet1: any;
    pallet2?: any;
    assignedRow: number;
    orientation: 'standard' | 'rotated';
    longitudinalDim: number;
    transverseDim: number;
  }>;
}

/**
 * Evaluates VPP Pinwheel (or Standard) two-row placement for a set of pallets in a container.
 * Evaluates whether pallets can fit within longitudinal and transverse limits using:
 * - Standard orientation on one row, 90° rotated on the opposite row (or vice versa)
 * - Preserves pallet_length, pallet_width, and assigned orientation
 * - Evaluates 1+1 vertical stacks for VPP size <= 120 mm (respecting TC20 VPP-007)
 */
export function evaluateVppTwoRowPinwheelPlacement(
  pallets: any[],
  maxSafeLength: number = USABLE_20FT_ENVELOPE.max_length,
  containerLimit: number = USABLE_20FT_ENVELOPE.max_length,
  containerWidth: number = USABLE_20FT_ENVELOPE.max_width,
  maxUsableHeight: number = USABLE_20FT_ENVELOPE.max_height
): VppPinwheelPlacementResult | null {
  if (pallets.length === 0) return null;

  // HARD constraint: Every individual pallet height must not exceed maxUsableHeight
  for (const p of pallets) {
    const pHeight = p.height || p.pallet_height || p.palletHeight || 0;
    if (pHeight > maxUsableHeight) {
      return null;
    }
  }

  const vppNarrow: any[] = [];
  const vppNormal: any[] = [];

  pallets.forEach(p => {
    const packingMode = p.packing_mode || p.original?.packing_mode;
    const size = p.size !== undefined ? p.size : p.original?.size;
    const pHeight = p.height || p.pallet_height || p.palletHeight || 0;
    const film = p.film || p.original?.film;
    const isTC20 = isQualifyingTC20Order(film, size, 'VPP');

    const isStackable = (packingMode === 'VPP') && (
      isTC20 ||
      (size !== undefined && size <= 120) ||
      (pHeight > 0 && pHeight <= 1300)
    );

    if (isStackable) {
      vppNarrow.push(p);
    } else {
      vppNormal.push(p);
    }
  });

  interface StackCandidate {
    pallet1: any;
    pallet2?: any;
    stdDim: number;
    rotDim: number;
    stdTrans: number;
    rotTrans: number;
  }

  const stacks: StackCandidate[] = [];
  const vppRemaining = [...vppNarrow];

  while (vppRemaining.length > 0) {
    const p1 = vppRemaining.shift()!;
    const p1Film = p1.film || p1.original?.film || '';
    const p1Size = p1.size !== undefined ? p1.size : p1.original?.size;
    const p1Item = p1.item !== undefined ? p1.item : p1.original?.item;
    const p1Height = p1.height || p1.pallet_height || p1.palletHeight || 0;
    const isP1TC20 = isQualifyingTC20Order(p1Film, p1Size, 'VPP');

    const matchIdx = vppRemaining.findIndex(p => {
      const pFilm = p.film || p.original?.film || '';
      const pSize = p.size !== undefined ? p.size : p.original?.size;
      const pItem = p.item !== undefined ? p.item : p.original?.item;
      const pHeight = p.height || p.pallet_height || p.palletHeight || 0;
      if (p1Height > 0 && pHeight > 0 && (p1Height + pHeight > maxUsableHeight)) return false;

      if (isP1TC20) {
        return pItem === p1Item && pFilm === p1Film && pSize === p1Size;
      }
      const isPTC20 = isQualifyingTC20Order(pFilm, pSize, 'VPP');
      if (isPTC20) return false;
      const pLen = p.length || p.pallet_length;
      const pWidth = p.width || p.pallet_width;
      const p1Len = p1.length || p1.pallet_length;
      const p1Width = p1.width || p1.pallet_width;
      return pItem === p1Item || (pLen === p1Len && pWidth === p1Width);
    });

    const p2 = matchIdx >= 0 ? vppRemaining.splice(matchIdx, 1)[0] : (isP1TC20 ? undefined : vppRemaining.shift());

    const p1Width = p1.width || p1.pallet_width;
    const p1Length = p1.length || p1.pallet_length;
    const isP1Hpp = (p1.packing_mode === 'HPP' || p1.original?.packing_mode === 'HPP');

    const stdDim = isP1Hpp ? p1Width : ((p1Width > p1Length && p1Width <= 1450) ? p1Width : (p1Length || 1100));
    const rotDim = isP1Hpp ? p1Width : ((p1Width > p1Length && p1Width <= 1450) ? (p1Length || 900) : p1Width);
    const stdTrans = isP1Hpp ? (p1Length || 765) : ((p1Width > p1Length && p1Width <= 1450) ? (p1Length || 900) : p1Width);
    const rotTrans = isP1Hpp ? (p1Length || 765) : ((p1Width > p1Length && p1Width <= 1450) ? p1Width : (p1Length || 1100));

    stacks.push({ pallet1: p1, pallet2: p2, stdDim, rotDim, stdTrans, rotTrans });
  }

  vppNormal.forEach(p => {
    const isHpp = (p.packing_mode === 'HPP' || p.original?.packing_mode === 'HPP');
    const pWidth = p.width || p.pallet_width;
    const pLength = p.length || p.pallet_length;

    if (isHpp) {
      // For HPP pallets: In 2-row layout, transverse is cradle length (765mm),
      // and longitudinal footprint is ALWAYS pallet_width (e.g. 1240mm).
      // They CANNOT rotate 90 degrees to make 765mm longitudinal.
      const longDim = pWidth;
      const transDim = pLength || 765;
      stacks.push({ pallet1: p, pallet2: undefined, stdDim: longDim, rotDim: longDim, stdTrans: transDim, rotTrans: transDim });
    } else {
      const stdDim = (pWidth > pLength && pWidth <= 1450) ? pWidth : (pLength || 1100);
      const rotDim = (pWidth > pLength && pWidth <= 1450) ? (pLength || 900) : pWidth;
      const stdTrans = (pWidth > pLength && pWidth <= 1450) ? (pLength || 900) : pWidth;
      const rotTrans = (pWidth > pLength && pWidth <= 1450) ? pWidth : (pLength || 1100);

      stacks.push({ pallet1: p, pallet2: undefined, stdDim, rotDim, stdTrans, rotTrans });
    }
  });

  const n = stacks.length;
  if (n === 0) return null;

  const lenLimit = Math.min(containerLimit, maxSafeLength);
  let best: VppPinwheelPlacementResult | null = null;
  const totalCombos = 1 << n;

  // Configuration A: Row 0 is Standard orientation, Row 1 is Rotated 90° orientation
  for (let mask = 0; mask < totalCombos; mask++) {
    let l0 = 0, l1 = 0;
    let t0 = 0, t1 = 0;
    for (let i = 0; i < n; i++) {
      const s = stacks[i];
      if ((mask & (1 << i)) !== 0) {
        l0 += s.stdDim;
        t0 = Math.max(t0, s.stdTrans);
      } else {
        l1 += s.rotDim;
        t1 = Math.max(t1, s.rotTrans);
      }
    }
    if (l0 <= lenLimit && l1 <= lenLimit && (t0 + t1) <= containerWidth) {
      const maxL = Math.max(l0, l1);
      const diff = Math.abs(l0 - l1);
      if (!best || maxL < best.maxL || (maxL === best.maxL && diff < best.diff)) {
        const assignedStacks = stacks.map((s, i) => {
          const inRow0 = (mask & (1 << i)) !== 0;
          return {
            pallet1: s.pallet1,
            pallet2: s.pallet2,
            assignedRow: inRow0 ? 0 : 1,
            orientation: inRow0 ? ('standard' as const) : ('rotated' as const),
            longitudinalDim: inRow0 ? s.stdDim : s.rotDim,
            transverseDim: inRow0 ? s.stdTrans : s.rotTrans,
          };
        });
        best = { fits: true, config: 'pinwheel_A', l0, l1, t0, t1, maxL, diff, stacks: assignedStacks };
      }
    }
  }

  // Configuration B: Row 0 is Rotated 90° orientation, Row 1 is Standard orientation
  for (let mask = 0; mask < totalCombos; mask++) {
    let l0 = 0, l1 = 0;
    let t0 = 0, t1 = 0;
    for (let i = 0; i < n; i++) {
      const s = stacks[i];
      if ((mask & (1 << i)) !== 0) {
        l0 += s.rotDim;
        t0 = Math.max(t0, s.rotTrans);
      } else {
        l1 += s.stdDim;
        t1 = Math.max(t1, s.stdTrans);
      }
    }
    if (l0 <= lenLimit && l1 <= lenLimit && (t0 + t1) <= containerWidth) {
      const maxL = Math.max(l0, l1);
      const diff = Math.abs(l0 - l1);
      if (!best || maxL < best.maxL || (maxL === best.maxL && diff < best.diff)) {
        const assignedStacks = stacks.map((s, i) => {
          const inRow0 = (mask & (1 << i)) !== 0;
          return {
            pallet1: s.pallet1,
            pallet2: s.pallet2,
            assignedRow: inRow0 ? 0 : 1,
            orientation: inRow0 ? ('rotated' as const) : ('standard' as const),
            longitudinalDim: inRow0 ? s.rotDim : s.stdDim,
            transverseDim: inRow0 ? s.rotTrans : s.stdTrans,
          };
        });
        best = { fits: true, config: 'pinwheel_B', l0, l1, t0, t1, maxL, diff, stacks: assignedStacks };
      }
    }
  }

  // Configuration C: Standard orientation on both rows (if total transverse width fits within container)
  for (let mask = 0; mask < totalCombos; mask++) {
    let l0 = 0, l1 = 0;
    let t0 = 0, t1 = 0;
    for (let i = 0; i < n; i++) {
      const s = stacks[i];
      if ((mask & (1 << i)) !== 0) {
        l0 += s.stdDim;
        t0 = Math.max(t0, s.stdTrans);
      } else {
        l1 += s.stdDim;
        t1 = Math.max(t1, s.stdTrans);
      }
    }
    if (l0 <= lenLimit && l1 <= lenLimit && (t0 + t1) <= containerWidth) {
      const maxL = Math.max(l0, l1);
      const diff = Math.abs(l0 - l1);
      if (!best || maxL < best.maxL || (maxL === best.maxL && diff < best.diff)) {
        const assignedStacks = stacks.map((s, i) => {
          const inRow0 = (mask & (1 << i)) !== 0;
          return {
            pallet1: s.pallet1,
            pallet2: s.pallet2,
            assignedRow: inRow0 ? 0 : 1,
            orientation: 'standard' as const,
            longitudinalDim: s.stdDim,
            transverseDim: s.stdTrans,
          };
        });
        best = { fits: true, config: 'std', l0, l1, t0, t1, maxL, diff, stacks: assignedStacks };
      }
    }
  }

  return best;
}

/**
 * Helper to construct a unified PalletSlotInfo for UI display and tracking
 */
function buildPalletSlotInfo(
  p: IndividualPallet,
  rowNum: number,
  bayNum: number,
  stackedPallet?: IndividualPallet,
  palletNumber?: number,
  ordersInContainer?: CalculatedItem[]
): PalletSlotInfo {
  const isMixed = Boolean(p.isMixed || (p.mixedItems && p.mixedItems.length > 1));
  let items: PalletCompositionItem[] = [];

  const findOrder = (itemNum: number) => ordersInContainer?.find(o => o.item === itemNum);

  if (isMixed && p.mixedItems && p.mixedItems.length > 0) {
    items = p.mixedItems.map((m, idx) => {
      const ord = findOrder(m.item);
      const prw = ord ? ord.per_reel_wt : (m.reels > 0 ? Number((m.weight / m.reels).toFixed(2)) : 0);
      
      // Determine tier position from tier_desc or index
      let tierPos = (m as any).tier_position;
      if (!tierPos && p.tierDesc) {
        if (p.tierDesc.includes(`Tier ${idx + 1}`)) {
          tierPos = idx === 0 ? 'Tier 1 (Bottom)' : idx === 1 ? 'Tier 2 (Top)' : `Tier ${idx + 1}`;
        } else {
          tierPos = idx === 0 ? 'Tier 1 (Bottom)' : 'Tier 2 (Top)';
        }
      }

      return {
        item: m.item,
        film: m.film,
        size: m.size,
        length: ord?.length,
        core: ord?.core,
        dia: ord?.dia,
        per_reel_wt: prw,
        reels: m.reels,
        weight: m.weight,
        tier_desc: (m as any).tier_desc,
        tier_position: tierPos || (idx === 0 ? 'Tier 1 (Bottom)' : 'Tier 2 (Top)'),
      };
    });
  } else {
    const ord = findOrder(p.item);
    const prw = ord ? ord.per_reel_wt : (p.reels ? Number(((p.weight || 0) / p.reels).toFixed(2)) : 0);
    items = [{
      item: p.item,
      film: p.film,
      size: p.size,
      length: ord?.length,
      core: ord?.core,
      dia: ord?.dia,
      per_reel_wt: prw,
      reels: p.reels || 0,
      weight: p.weight || 0,
      tier_desc: p.tierDesc,
      tier_position: p.tierDesc || (stackedPallet ? 'Tier 1 (Bottom)' : 'Full Pallet'),
    }];
    if (stackedPallet) {
      const stOrd = findOrder(stackedPallet.item);
      const stPrw = stOrd ? stOrd.per_reel_wt : (stackedPallet.reels ? Number(((stackedPallet.weight || 0) / stackedPallet.reels).toFixed(2)) : 0);
      items.push({
        item: stackedPallet.item,
        film: stackedPallet.film,
        size: stackedPallet.size,
        length: stOrd?.length,
        core: stOrd?.core,
        dia: stOrd?.dia,
        per_reel_wt: stPrw,
        reels: stackedPallet.reels || 0,
        weight: stackedPallet.weight || 0,
        tier_desc: stackedPallet.tierDesc,
        tier_position: 'Tier 2 (Top Stack)',
      });
    }
  }

  let mixedType: 'mixed_film' | 'mixed_size' | 'homogeneous' = 'homogeneous';
  if (isMixed) {
    const uniqueFilms = new Set(items.map(i => i.film));
    const uniqueSizes = new Set(items.map(i => i.size));
    if (uniqueFilms.size > 1) {
      mixedType = 'mixed_film';
    } else if (uniqueSizes.size > 1) {
      mixedType = 'mixed_size';
    } else {
      mixedType = 'mixed_size';
    }
  }

  const totalReels = items.reduce((sum, i) => sum + (i.reels || 0), 0);
  const totalWeight = Math.round(items.reduce((sum, i) => sum + (i.weight || 0), 0) * 100) / 100;
  const rotText = p.orientation === 'rotated' ? ' (Rotated)' : '';
  const posDesc = `Row ${rowNum} / Bay ${bayNum}${rotText}`;

  return {
    pallet_number: palletNumber || 1,
    is_mixed: isMixed,
    mixed_type: mixedType,
    total_reels: totalReels,
    total_weight: totalWeight,
    dims_str: p.pallet_dims_str,
    tier_desc: p.tierDesc,
    primary_film: p.film,
    primary_item: p.item,
    row_index: rowNum,
    bay_index: bayNum,
    position_desc: posDesc,
    orientation: p.orientation,
    floor_dim: p.longitudinalDim || (p.orientation === 'rotated' ? p.pallet_length : p.pallet_width),
    items,
  };
}

/**
 * Function 2: generateRowLayoutForContainer(ordersInContainer, containerId, config)
 * Universal container stuffing layout generator for BOTH 20ft (2-row VPP/HPP) and 40ft HC (3-row/2-row)
 */
export function generateRowLayoutForContainer(
  ordersInContainer: CalculatedItem[],
  containerId: number = 1,
  config: StuffingConfig = DEFAULT_STUFFING_CONFIG,
  physicalPallets?: Array<{
    original: CalculatedItem;
    palletIndex: number;
    weight: number;
    width: number;
    length: number;
    palletHeight?: number;
    dimsStr?: string;
    isWide: boolean;
    reels: number;
    used: boolean;
    assignedRow?: number;
    orientation?: 'standard' | 'rotated';
    longitudinalDim?: number;
    transverseDim?: number;
    isMixed?: boolean;
    mixedItems?: VppPhysicalPalletItem[];
    tierDesc?: string;
  }>
): {
  stuffing_grid: ContainerStuffingRow[];
  pallet_packing_details: PalletPackingDetail[];
  row_lengths: { row1: number; row2: number; row3?: number; max_length: number };
  physical_pallets?: PalletSlotInfo[];
} {
  const allPallets: IndividualPallet[] = [];
  const palletPackingDetails: PalletPackingDetail[] = [];

  if (physicalPallets && physicalPallets.length > 0) {
    physicalPallets.forEach(p => {
      const isMixed = p.isMixed || (p.mixedItems && p.mixedItems.length > 1);
      const h = p.palletHeight || p.original.pallet_height;
      const dims = p.dimsStr || `${p.length}*${p.width}*${h}${isMixed ? ' (Mixed)' : ''}`;
      allPallets.push({
        item: p.original.item,
        film: p.original.film,
        size: p.original.size,
        pallet_width: p.width,
        pallet_length: p.length,
        pallet_height: h,
        pallet_dims_str: dims,
        packing_mode: p.original.packing_mode,
        reels: p.reels,
        weight: p.weight,
        assignedRow: p.assignedRow,
        orientation: p.orientation,
        longitudinalDim: p.longitudinalDim,
        transverseDim: p.transverseDim,
        isMixed: isMixed,
        mixedItems: p.mixedItems,
        tierDesc: p.tierDesc,
        palletIndex: p.palletIndex,
      });
    });
  } else {
    // Expand pallets into individual pallet units using their exact reel count and physical height
    ordersInContainer.forEach(order => {
      const expandedList = expandItemForStuffingMaster(order);
      expandedList.forEach(exp => {
        for (let p = 0; p < exp.total_pallets; p++) {
          allPallets.push({
            item: exp.item,
            film: exp.film,
            size: exp.size,
            pallet_width: exp.pallet_width,
            pallet_length: exp.pallet_length,
            pallet_height: exp.pallet_height,
            pallet_dims_str: exp.pallet_dims_str,
            packing_mode: exp.packing_mode,
            reels: exp.reels_per_pallet,
            weight: (exp.reels_per_pallet || 0) * (order.per_reel_wt || 0),
            isMixed: false,
          });
        }
      });
    });
  }

  const totalPalletsInContainer = allPallets.length;
  const is20ft = config.container_type === '20ft';
  const hasVpp = ordersInContainer.some(o => o.packing_mode === 'VPP');
  const allAreWide = allPallets.length > 0 && allPallets.every(p => p.pallet_length * 3 > 2352);
  const isAll850Hpp = allPallets.length > 0 && allPallets.every(p => p.packing_mode === 'HPP' && (p.pallet_length === 850 || (p as any).cradle_ply === 850));
  const isPure2Row = is20ft;

  // ----------------------------------------------------
  // HPP 850 Ply Factory Pinwheel Layout
  // Ground truth pattern reverse-engineered from factory stuffing sheet:
  // - ONLY for HPP 850 Ply. 3-line loading is strictly prohibited.
  // - ROW 1 (Left wall): Pallets rotated 90° (width along container length = p.pallet_width)
  // - ROW 2 (Center): Strictly empty (0 mm / null) to guarantee physical clearance and enforce 2-line loading
  // - ROW 3 (Right wall): Pallets in standard orientation (850 mm along container length)
  // - Pallets are sorted ascending by width (smaller widths fill ROW 1 first, leaving wider pallets for ROW 3).
  // ----------------------------------------------------
  if (isAll850Hpp) {
    const containerLimit = is20ft ? USABLE_20FT_ENVELOPE.max_length : (config.container_internal_length || 12032);
    const maxRow1Limit = containerLimit;

    const row1Pallets: IndividualPallet[] = [];
    const row3Pallets: IndividualPallet[] = [];
    let currentR1Length = 0;

    // Sort pallets by width ascending
    const sortedPallets = [...allPallets].sort((a, b) => a.pallet_width - b.pallet_width);

    sortedPallets.forEach(p => {
      // In Row 1, each pallet takes its pallet_width along container length
      if (currentR1Length + p.pallet_width <= maxRow1Limit) {
        row1Pallets.push(p);
        currentR1Length += p.pallet_width;
      } else {
        // In Row 3, each pallet takes 850 mm along container length
        row3Pallets.push(p);
      }
    });

    ordersInContainer.forEach(order => {
      const count = allPallets.filter(p => p.size === order.size && p.item === order.item).length;
      palletPackingDetails.push({
        size: order.size,
        film: order.film,
        total_pallet: order.total_pallets,
        pallet_width: order.pallet_width,
        pallet_dims_str: order.pallet_dims_str,
        packing_mode: order.packing_mode,
        loaded_in_container: count,
      });
    });

    const maxBays = Math.max(row1Pallets.length, row3Pallets.length);
    const stuffingGrid: ContainerStuffingRow[] = [];

    for (let s = 0; s < maxBays; s++) {
      const p1 = row1Pallets[s];
      const p3 = row3Pallets[s];

      if (is20ft) {
        // In 20ft container, columns are Row 1 and Row 2
        stuffingGrid.push({
          row1: p1 ? p1.pallet_width : null,
          row2: p3 ? 850 : null,
          row3: null,
          item1: p1 ? p1.item : undefined,
          item2: p3 ? p3.item : undefined,
          item3: undefined,
          dims1: p1?.pallet_dims_str,
          dims2: p3?.pallet_dims_str,
          dims3: undefined,
        });
      } else {
        // In 40ft HC container, columns are ROW1, ROW2 (empty corridor), and ROW3
        stuffingGrid.push({
          row1: p1 ? p1.pallet_width : null,
          row2: null,
          row3: p3 ? 850 : null,
          item1: p1 ? p1.item : undefined,
          item2: undefined,
          item3: p3 ? p3.item : undefined,
          dims1: p1?.pallet_dims_str,
          dims2: undefined,
          dims3: p3?.pallet_dims_str,
        });
      }
    }

    const lengthRow1 = stuffingGrid.reduce((sum, g) => sum + (g.row1 || 0), 0);
    const lengthRow2 = stuffingGrid.reduce((sum, g) => sum + (g.row2 || 0), 0);
    const lengthRow3 = stuffingGrid.reduce((sum, g) => sum + (g.row3 || 0), 0);

    return {
      stuffing_grid: stuffingGrid,
      pallet_packing_details: palletPackingDetails,
      row_lengths: {
        row1: lengthRow1,
        row2: lengthRow2,
        row3: lengthRow3,
        max_length: Math.max(lengthRow1, lengthRow2, lengthRow3),
      },
    };
  }

  // ----------------------------------------------------
  // 1. Pure 2-Row Layout: only for 20ft container (2-row arrangement)
  // ----------------------------------------------------
  if (isPure2Row) {
    interface FloorStack {
      pallet1: IndividualPallet;
      pallet2?: IndividualPallet;
      floorDimension: number;
      dimsStr: string;
      item: number;
      pallet1Info?: PalletSlotInfo;
      pallet2Info?: PalletSlotInfo;
    }

    const floorStacks: FloorStack[] = [];

    if (hasVpp) {
      // Group VPP pallets:
      // Narrow VPP (size <= 120 mm) are stacked vertically into 1+1 pairs
      // Normal VPP (size > 120 mm) are normal individual pallets (1 per floor stack, NO 1+1 pairing)
      const vppNarrowPallets = allPallets.filter(p => p.packing_mode === 'VPP' && p.size <= 120);
      const vppNormalPallets = allPallets.filter(p => p.packing_mode === 'VPP' && p.size > 120);
      const hppPallets = allPallets.filter(p => p.packing_mode !== 'VPP');

      // 1. Pair narrow VPP (<= 120 mm) pallets into 1+1 stacks (same item/dimension preferred)
      const vppRemaining = [...vppNarrowPallets];
      while (vppRemaining.length > 0) {
        const p1 = vppRemaining.shift()!;
        const p1Height = p1.pallet_height || (p1 as any).height || 0;
        const isP1TC20 = isQualifyingTC20Order(p1.film, p1.size, 'VPP');
        const matchIdx = vppRemaining.findIndex(p => {
          const pHeight = p.pallet_height || (p as any).height || 0;
          if (p1Height > 0 && pHeight > 0 && (p1Height + pHeight > (is20ft ? USABLE_20FT_ENVELOPE.max_height : 2352))) return false;
          if (isP1TC20) {
            // VPP-007: TC20 < 120mm pallets can ONLY stack 1+1 with pallets of identical item, film, and size!
            return p.item === p1.item && p.film === p1.film && p.size === p1.size;
          }
          const isPTC20 = isQualifyingTC20Order(p.film, p.size, 'VPP');
          if (isPTC20) return false; // Non-TC20 pallet cannot pair with TC20
          return p.item === p1.item || (p.pallet_length === p1.pallet_length && p.pallet_width === p1.pallet_width);
        });
        const p2 = matchIdx >= 0 ? vppRemaining.splice(matchIdx, 1)[0] : (isP1TC20 ? undefined : vppRemaining.shift());
        
        // Floor dimension is the longitudinal length along container
        const dim = (p1.pallet_width > p1.pallet_length && p1.pallet_width <= 1450) ? p1.pallet_width : (p1.pallet_length || 1100);
        floorStacks.push({
          pallet1: p1,
          pallet2: p2,
          floorDimension: dim,
          dimsStr: p2 ? `${p1.pallet_dims_str} (1+1)` : p1.pallet_dims_str,
          item: p1.item,
        });
      }

      // 2. Normal VPP (> 120 mm) pallets occupy 1 independent floor stack each (NO 1+1 pairing)
      vppNormalPallets.forEach(p => {
        const dim = (p.pallet_width > p.pallet_length && p.pallet_width <= 1450) ? p.pallet_width : (p.pallet_length || 1100);
        floorStacks.push({
          pallet1: p,
          floorDimension: dim,
          dimsStr: p.pallet_dims_str,
          item: p.item,
        });
      });

      // 3. HPP pallets occupy 1 floor stack each
      hppPallets.forEach(p => {
        floorStacks.push({
          pallet1: p,
          floorDimension: p.pallet_width,
          dimsStr: p.pallet_dims_str,
          item: p.item,
        });
      });
    } else {
      // Pure HPP 2-row layout: 1 pallet per floor stack
      allPallets.forEach(p => {
        floorStacks.push({
          pallet1: p,
          floorDimension: p.pallet_width,
          dimsStr: p.pallet_dims_str,
          item: p.item,
        });
      });
    }

    const row1: FloorStack[] = [];
    const row2: FloorStack[] = [];

    const hasPreAssignedRows = allPallets.length > 0 && allPallets.every(p => p.assignedRow !== undefined);

    if (hasPreAssignedRows) {
      // Direct rendering of the orientation decision made during container assignment (Requirement 6)
      const r0Pallets = allPallets.filter(p => p.assignedRow === 0);
      const r1Pallets = allPallets.filter(p => p.assignedRow === 1);

      const buildRowStacks = (palletsInRow: IndividualPallet[]): FloorStack[] => {
        const rowStacks: FloorStack[] = [];
        const narrow = palletsInRow.filter(p => {
          const isTC20 = isQualifyingTC20Order(p.film, p.size, 'VPP');
          const pH = p.pallet_height || (p as any).height || 0;
          return p.packing_mode === 'VPP' && (isTC20 || (p.size !== undefined && p.size <= 120) || (pH > 0 && pH <= 1300));
        });
        const normal = palletsInRow.filter(p => !narrow.includes(p));

        const remNarrow = [...narrow];
        while (remNarrow.length > 0) {
          const p1 = remNarrow.shift()!;
          const p1Height = p1.pallet_height || (p1 as any).height || 0;
          const isP1TC20 = isQualifyingTC20Order(p1.film, p1.size, 'VPP');
          const matchIdx = remNarrow.findIndex(p => {
            const pHeight = p.pallet_height || (p as any).height || 0;
            if (p1Height > 0 && pHeight > 0 && (p1Height + pHeight > (is20ft ? USABLE_20FT_ENVELOPE.max_height : 2352))) return false;
            if (isP1TC20) {
              return p.item === p1.item && p.film === p1.film && p.size === p1.size;
            }
            const isPTC20 = isQualifyingTC20Order(p.film, p.size, 'VPP');
            if (isPTC20) return false;
            return p.item === p1.item || (p.pallet_length === p1.pallet_length && p.pallet_width === p1.pallet_width);
          });
          const p2 = matchIdx >= 0 ? remNarrow.splice(matchIdx, 1)[0] : (isP1TC20 ? undefined : remNarrow.shift());
          const dim = p1.longitudinalDim || ((p1.orientation === 'rotated')
            ? ((p1.pallet_width > p1.pallet_length && p1.pallet_width <= 1450) ? (p1.pallet_length || 900) : p1.pallet_width)
            : ((p1.pallet_width > p1.pallet_length && p1.pallet_width <= 1450) ? p1.pallet_width : (p1.pallet_length || 1100)));
          const dimsStr = p2
            ? `${p1.pallet_dims_str} (1+1)`
            : (p1.orientation === 'rotated' && !p1.pallet_dims_str.includes('(Rotated)')
              ? `${p1.pallet_dims_str} (Rotated)`
              : p1.pallet_dims_str);
          rowStacks.push({
            pallet1: p1,
            pallet2: p2,
            floorDimension: dim,
            dimsStr,
            item: p1.item,
          });
        }

        normal.forEach(p => {
          const isHpp = p.packing_mode === 'HPP';
          const dim = isHpp
            ? p.pallet_width
            : (p.longitudinalDim || ((p.orientation === 'rotated')
              ? ((p.pallet_width > p.pallet_length && p.pallet_width <= 1450) ? (p.pallet_length || 900) : p.pallet_width)
              : ((p.pallet_width > p.pallet_length && p.pallet_width <= 1450) ? p.pallet_width : (p.pallet_length || 1100))));
          const dimsStr = (!isHpp && p.orientation === 'rotated' && !p.pallet_dims_str.includes('(Rotated)'))
            ? `${p.pallet_dims_str} (Rotated)`
            : p.pallet_dims_str;
          rowStacks.push({
            pallet1: p,
            floorDimension: dim,
            dimsStr,
            item: p.item,
          });
        });

        return rowStacks;
      };

      row1.push(...buildRowStacks(r0Pallets));
      row2.push(...buildRowStacks(r1Pallets));
    } else if (hasVpp && allPallets.length > 0) {
      const containerLimit = is20ft ? USABLE_20FT_ENVELOPE.max_length : (config.container_internal_length || 5898);
      const containerWidthLimit = is20ft ? USABLE_20FT_ENVELOPE.max_width : (config.container_internal_width || 2352);
      const containerHeightLimit = is20ft ? USABLE_20FT_ENVELOPE.max_height : (config.container_internal_height || 2280);
      const placement = evaluateVppTwoRowPinwheelPlacement(
        allPallets,
        containerLimit,
        containerLimit,
        containerWidthLimit,
        containerHeightLimit
      );

      if (placement && placement.fits) {
        placement.stacks.forEach(s => {
          const dim = s.longitudinalDim;
          const dimsStr = s.pallet2
            ? `${s.pallet1.pallet_dims_str} (1+1)`
            : (s.orientation === 'rotated' && !s.pallet1.pallet_dims_str.includes('(Rotated)')
              ? `${s.pallet1.pallet_dims_str} (Rotated)`
              : s.pallet1.pallet_dims_str);
          const stackObj: FloorStack = {
            pallet1: s.pallet1,
            pallet2: s.pallet2,
            floorDimension: dim,
            dimsStr,
            item: s.pallet1.item,
          };
          if (s.assignedRow === 0) row1.push(stackObj);
          else row2.push(stackObj);
        });
      } else {
        floorStacks.forEach((stack, idx) => {
          if (idx % 2 === 0) row1.push(stack);
          else row2.push(stack);
        });
      }
    } else {
      const maxRowLen = is20ft ? USABLE_20FT_ENVELOPE.max_length : (config.container_internal_length || 5898);
      floorStacks.forEach((stack) => {
        const len1 = row1.reduce((sum, s) => sum + s.floorDimension, 0);
        const len2 = row2.reduce((sum, s) => sum + s.floorDimension, 0);
        if (len1 <= len2) {
          if (len1 + stack.floorDimension <= maxRowLen) {
            row1.push(stack);
          } else if (len2 + stack.floorDimension <= maxRowLen) {
            row2.push(stack);
          }
        } else {
          if (len2 + stack.floorDimension <= maxRowLen) {
            row2.push(stack);
          } else if (len1 + stack.floorDimension <= maxRowLen) {
            row1.push(stack);
          }
        }
      });
    }

    if (is20ft) {
      const max20ftLen = USABLE_20FT_ENVELOPE.max_length;
      // Fail-safe boundary validation: no generated 20ft layout may ever return row length > 5750 mm
      while (row1.reduce((sum, s) => sum + s.floorDimension, 0) > max20ftLen && row1.length > 0) {
        const excess = row1.pop()!;
        const len2 = row2.reduce((sum, s) => sum + s.floorDimension, 0);
        if (len2 + excess.floorDimension <= max20ftLen) {
          row2.push(excess);
        }
      }
      while (row2.reduce((sum, s) => sum + s.floorDimension, 0) > max20ftLen && row2.length > 0) {
        const excess = row2.pop()!;
        const len1 = row1.reduce((sum, s) => sum + s.floorDimension, 0);
        if (len1 + excess.floorDimension <= max20ftLen) {
          row1.push(excess);
        }
      }
    }

    ordersInContainer.forEach(order => {
      const count = allPallets.filter(p => p.size === order.size && p.item === order.item).length;
      palletPackingDetails.push({
        size: order.size,
        film: order.film,
        total_pallet: order.total_pallets,
        pallet_width: order.pallet_width,
        pallet_dims_str: order.pallet_dims_str,
        packing_mode: order.packing_mode,
        loaded_in_container: count,
      });
    });

    const maxBays = Math.max(row1.length, row2.length, 5);
    const stuffingGrid: ContainerStuffingRow[] = [];
    const allPhysicalPalletsInContainer: PalletSlotInfo[] = [];

    let palletSeq = 1;
    row1.forEach((s1, bayIdx) => {
      const pInfo = buildPalletSlotInfo(s1.pallet1, 1, bayIdx + 1, s1.pallet2, palletSeq++, ordersInContainer);
      s1.pallet1Info = pInfo;
      allPhysicalPalletsInContainer.push(pInfo);
    });

    row2.forEach((s2, bayIdx) => {
      const pInfo = buildPalletSlotInfo(s2.pallet1, 2, bayIdx + 1, s2.pallet2, palletSeq++, ordersInContainer);
      s2.pallet1Info = pInfo;
      allPhysicalPalletsInContainer.push(pInfo);
    });

    for (let s = 0; s < maxBays; s++) {
      const s1 = row1[s];
      const s2 = row2[s];
      stuffingGrid.push({
        row1: s1 ? s1.floorDimension : null,
        row2: s2 ? s2.floorDimension : null,
        row3: null,
        item1: s1 ? s1.item : undefined,
        item2: s2 ? s2.item : undefined,
        item3: undefined,
        dims1: s1?.dimsStr,
        dims2: s2?.dimsStr,
        dims3: undefined,
        pallet1_info: s1?.pallet1Info,
        pallet2_info: s2?.pallet1Info,
      });
    }

    const lengthRow1 = row1.reduce((sum, s) => sum + s.floorDimension, 0);
    const lengthRow2 = row2.reduce((sum, s) => sum + s.floorDimension, 0);

    return {
      stuffing_grid: stuffingGrid,
      pallet_packing_details: palletPackingDetails,
      row_lengths: {
        row1: lengthRow1,
        row2: lengthRow2,
        row3: 0,
        max_length: Math.max(lengthRow1, lengthRow2),
      },
      physical_pallets: allPhysicalPalletsInContainer,
    };
  }

  // ----------------------------------------------------
  // 2. 40ft HC Layout (Always 3 Rows: Row 1, Row 2, Row 3)
  // Sectional Placement Rules:
  // - VPP pallets are NOT allowed in Row 2. They are placed only in Row 1 and Row 3.
  // - Wide pallets (length * 3 > 2352) are also placed only in Row 1 and Row 3.
  // - 765 Ply HPP pallets continue using the normal 3-row arrangement across Rows 1, 2, and 3.
  // - All rows strictly respect the physical 40ft HC boundary (12,032 mm).
  // ----------------------------------------------------
  interface Section1FloorStack {
    pallet1: IndividualPallet;
    pallet2?: IndividualPallet;
    floorDimension: number;
    dimsStr: string;
    item: number;
    pallet1Info?: PalletSlotInfo;
    pallet2Info?: PalletSlotInfo;
  }

  const section1Pallets = allPallets.filter(p => p.packing_mode === 'VPP' || p.pallet_length * 3 > 2352);
  const threeRowPallets = allPallets.filter(p => p.packing_mode !== 'VPP' && p.pallet_length * 3 <= 2352);

  const row1Pallets: IndividualPallet[] = [];
  const row2Pallets: IndividualPallet[] = [];
  const row3Pallets: IndividualPallet[] = [];
  const stuffingGrid: ContainerStuffingRow[] = [];

  // Section 1: VPP & Wide Pallets (placed into Row 1 & Row 3; Row 2 remains open/null)
  const section1FloorStacks: Section1FloorStack[] = [];

  // 1. Group narrow VPP (<= 120 mm) pallets into 1+1 stacks (same item/dimension preferred)
  const vppNarrow = section1Pallets.filter(p => p.packing_mode === 'VPP' && p.size <= 120);
  const vppNormalAndWide = section1Pallets.filter(p => !(p.packing_mode === 'VPP' && p.size <= 120));

  const vppRemaining = [...vppNarrow];
  while (vppRemaining.length > 0) {
    const p1 = vppRemaining.shift()!;
    const isP1TC20 = isQualifyingTC20Order(p1.film, p1.size, 'VPP');
    const matchIdx = vppRemaining.findIndex(p => {
      if (isP1TC20) {
        // VPP-007: TC20 < 120mm pallets can ONLY stack 1+1 with pallets of identical item, film, and size!
        return p.item === p1.item && p.film === p1.film && p.size === p1.size;
      }
      const isPTC20 = isQualifyingTC20Order(p.film, p.size, 'VPP');
      if (isPTC20) return false; // Non-TC20 pallet cannot pair with TC20
      return p.item === p1.item || (p.pallet_length === p1.pallet_length && p.pallet_width === p1.pallet_width);
    });
    const p2 = matchIdx >= 0 ? vppRemaining.splice(matchIdx, 1)[0] : (isP1TC20 ? undefined : vppRemaining.shift());
    const dim = (p1.pallet_width > p1.pallet_length && p1.pallet_width <= 1450) ? p1.pallet_width : (p1.pallet_length || 1100);
    section1FloorStacks.push({
      pallet1: p1,
      pallet2: p2,
      floorDimension: dim,
      dimsStr: p2 ? `${p1.pallet_dims_str} (1+1)` : p1.pallet_dims_str,
      item: p1.item,
    });
  }

  // 2. Normal VPP (> 120 mm) and Wide HPP pallets occupy 1 floor stack each
  vppNormalAndWide.forEach(p => {
    const dim = p.packing_mode === 'VPP'
      ? ((p.pallet_width > p.pallet_length && p.pallet_width <= 1450) ? p.pallet_width : (p.pallet_length || 1100))
      : p.pallet_width;
    section1FloorStacks.push({
      pallet1: p,
      floorDimension: dim,
      dimsStr: p.pallet_dims_str,
      item: p.item,
    });
  });

  const wideBaysCount = Math.ceil(section1FloorStacks.length / 2);
  let palletSeq40 = 1;
  const allPhysicalPallets40: PalletSlotInfo[] = [];

  for (let b = 0; b < wideBaysCount; b++) {
    const s1 = section1FloorStacks[b * 2];
    const s3 = section1FloorStacks[b * 2 + 1];
    if (s1) {
      row1Pallets.push(s1.pallet1);
      if (s1.pallet2) {
        row1Pallets.push(s1.pallet2);
      }
      const p1Info = buildPalletSlotInfo(s1.pallet1, 1, b + 1, s1.pallet2, palletSeq40++, ordersInContainer);
      s1.pallet1Info = p1Info;
      allPhysicalPallets40.push(p1Info);
    }
    if (s3) {
      row3Pallets.push(s3.pallet1);
      if (s3.pallet2) {
        row3Pallets.push(s3.pallet2);
      }
      const p3Info = buildPalletSlotInfo(s3.pallet1, 3, b + 1, s3.pallet2, palletSeq40++, ordersInContainer);
      s3.pallet1Info = p3Info;
      allPhysicalPallets40.push(p3Info);
    }

    stuffingGrid.push({
      row1: s1 ? s1.floorDimension : null,
      row2: null,
      row3: s3 ? s3.floorDimension : null,
      item1: s1 ? s1.item : undefined,
      item2: undefined,
      item3: s3 ? s3.item : undefined,
      dims1: s1?.dimsStr,
      dims2: undefined,
      dims3: s3?.dimsStr,
      pallet1_info: s1?.pallet1Info,
      pallet3_info: s3?.pallet1Info,
    });
  }

  // Section 2: 3-Wide Pallets (765 Ply HPP, length * 3 <= 2352mm)
  // Distributed across Row 1, Row 2, Row 3 respecting the container boundary
  const initL1 = stuffingGrid.reduce((sum, g) => sum + (g.row1 || 0), 0);
  const initL2 = stuffingGrid.reduce((sum, g) => sum + (g.row2 || 0), 0);
  const initL3 = stuffingGrid.reduce((sum, g) => sum + (g.row3 || 0), 0);
  const containerLimit = config.container_internal_length || 12032;

  const distribution = balanceThreeRowPallets(threeRowPallets, initL1, initL2, initL3, containerLimit);

  const maxThreeSlices = Math.max(
    distribution.r1.length,
    distribution.r2.length,
    distribution.r3.length
  );

  for (let s = 0; s < maxThreeSlices; s++) {
    const p1 = distribution.r1[s];
    const p2 = distribution.r2[s];
    const p3 = distribution.r3[s];

    let p1Info: PalletSlotInfo | undefined;
    let p2Info: PalletSlotInfo | undefined;
    let p3Info: PalletSlotInfo | undefined;

    if (p1) {
      row1Pallets.push(p1);
      p1Info = buildPalletSlotInfo(p1, 1, wideBaysCount + s + 1, undefined, palletSeq40++, ordersInContainer);
      allPhysicalPallets40.push(p1Info);
    }
    if (p2) {
      row2Pallets.push(p2);
      p2Info = buildPalletSlotInfo(p2, 2, wideBaysCount + s + 1, undefined, palletSeq40++, ordersInContainer);
      allPhysicalPallets40.push(p2Info);
    }
    if (p3) {
      row3Pallets.push(p3);
      p3Info = buildPalletSlotInfo(p3, 3, wideBaysCount + s + 1, undefined, palletSeq40++, ordersInContainer);
      allPhysicalPallets40.push(p3Info);
    }

    stuffingGrid.push({
      row1: p1 ? p1.pallet_width : null,
      row2: p2 ? p2.pallet_width : null,
      row3: p3 ? p3.pallet_width : null,
      item1: p1 ? p1.item : undefined,
      item2: p2 ? p2.item : undefined,
      item3: p3 ? p3.item : undefined,
      dims1: p1?.pallet_dims_str,
      dims2: p2?.pallet_dims_str,
      dims3: p3?.pallet_dims_str,
      pallet1_info: p1Info,
      pallet2_info: p2Info,
      pallet3_info: p3Info,
    });
  }

  ordersInContainer.forEach(order => {
    let count = allPallets.filter(p => p.size === order.size && p.item === order.item).length;
    if (physicalPallets && physicalPallets.length > 0) {
      count = physicalPallets.filter(p => {
        if (p.isMixed && p.mixedItems && p.mixedItems.length > 0) {
          return p.mixedItems.some(mi => mi.item === order.item);
        }
        return p.original.item === order.item;
      }).length;
    }
    palletPackingDetails.push({
      size: order.size,
      film: order.film,
      total_pallet: order.total_pallets,
      pallet_width: order.pallet_width,
      pallet_dims_str: order.pallet_dims_str,
      packing_mode: order.packing_mode,
      loaded_in_container: count,
    });
  });

  const lengthRow1 = stuffingGrid.reduce((sum, g) => sum + (g.row1 || 0), 0);
  const lengthRow2 = stuffingGrid.reduce((sum, g) => sum + (g.row2 || 0), 0);
  const lengthRow3 = stuffingGrid.reduce((sum, g) => sum + (g.row3 || 0), 0);

  return {
    stuffing_grid: stuffingGrid,
    pallet_packing_details: palletPackingDetails,
    row_lengths: {
      row1: lengthRow1,
      row2: lengthRow2,
      row3: lengthRow3,
      max_length: Math.max(lengthRow1, lengthRow2, lengthRow3),
    },
    physical_pallets: allPhysicalPallets40,
  };
}

/**
 * Distributes 3-row HPP pallets across Row 1, Row 2, Row 3 to balance lengths and counts
 * while strictly respecting the physical container limit.
 */
function balanceThreeRowPallets(
  pallets: IndividualPallet[],
  l1Init: number,
  l2Init: number,
  l3Init: number,
  maxLimit: number = 12032
): {
  r1: IndividualPallet[];
  r2: IndividualPallet[];
  r3: IndividualPallet[];
  l1: number;
  l2: number;
  l3: number;
  maxL: number;
} {
  if (pallets.length === 0) {
    return { r1: [], r2: [], r3: [], l1: l1Init, l2: l2Init, l3: l3Init, maxL: Math.max(l1Init, l2Init, l3Init) };
  }

  const total = pallets.length;
  const targetPerCol = Math.ceil(total / 3);
  const minPerCol = Math.floor(total / 3);

  // Group pallets by item and width for fast exact branch-and-bound
  const groups = new Map<string, { sample: IndividualPallet; count: number; width: number }>();
  for (const p of pallets) {
    const key = `${p.item}_${p.pallet_width}_${p.pallet_dims_str || ''}`;
    if (!groups.has(key)) groups.set(key, { sample: p, count: 0, width: p.pallet_width });
    groups.get(key)!.count++;
  }
  const groupArr = Array.from(groups.values());

  if (groupArr.length <= 5) {
    let best: {
      l1: number;
      l2: number;
      l3: number;
      maxL: number;
      diff: number;
    } | null = null;
    let bestK1: number[] = [];
    let bestK2: number[] = [];
    let bestK3: number[] = [];

    const curK1 = new Array(groupArr.length).fill(0);
    const curK2 = new Array(groupArr.length).fill(0);
    const curK3 = new Array(groupArr.length).fill(0);

    function solve(
      gIdx: number,
      c1: number,
      c2: number,
      c3: number,
      l1: number,
      l2: number,
      l3: number,
      limit: number
    ) {
      if (l1 > limit || l2 > limit || l3 > limit) return;
      if (c1 > targetPerCol || c2 > targetPerCol || c3 > targetPerCol) return;
      if (best && Math.max(l1, l2, l3) >= best.maxL) return;

      if (gIdx === groupArr.length) {
        if (c1 < minPerCol || c2 < minPerCol || c3 < minPerCol) return;
        const maxL = Math.max(l1, l2, l3);
        const diff = maxL - Math.min(l1, l2, l3);
        if (!best || maxL < best.maxL || (maxL === best.maxL && diff < best.diff)) {
          best = { l1, l2, l3, maxL, diff };
          bestK1 = curK1.slice();
          bestK2 = curK2.slice();
          bestK3 = curK3.slice();
        }
        return;
      }

      const { count, width } = groupArr[gIdx];
      for (let k1 = 0; k1 <= count; k1++) {
        if (c1 + k1 > targetPerCol) continue;
        const nl1 = l1 + k1 * width;
        if (nl1 > limit) continue;
        for (let k2 = 0; k2 <= count - k1; k2++) {
          if (c2 + k2 > targetPerCol) continue;
          const k3 = count - k1 - k2;
          if (c3 + k3 > targetPerCol) continue;
          const nl2 = l2 + k2 * width;
          const nl3 = l3 + k3 * width;
          if (nl2 > limit || nl3 > limit) continue;

          curK1[gIdx] = k1;
          curK2[gIdx] = k2;
          curK3[gIdx] = k3;
          solve(gIdx + 1, c1 + k1, c2 + k2, c3 + k3, nl1, nl2, nl3, limit);
        }
      }
    }

    solve(0, 0, 0, 0, l1Init, l2Init, l3Init, maxLimit);
    if (!best) {
      // Fallback if limit was overly tight
      solve(0, 0, 0, 0, l1Init, l2Init, l3Init, Infinity);
    }
    if (best) {
      const r1: IndividualPallet[] = [];
      const r2: IndividualPallet[] = [];
      const r3: IndividualPallet[] = [];
      for (let g = 0; g < groupArr.length; g++) {
        const sample = groupArr[g].sample;
        for (let i = 0; i < bestK1[g]; i++) r1.push(sample);
        for (let i = 0; i < bestK2[g]; i++) r2.push(sample);
        for (let i = 0; i < bestK3[g]; i++) r3.push(sample);
      }
      return { r1, r2, r3, l1: best.l1, l2: best.l2, l3: best.l3, maxL: best.maxL };
    }
  }

  // Greedy distribution fallback (for large number of distinct groups)
  const r1: IndividualPallet[] = [];
  const r2: IndividualPallet[] = [];
  const r3: IndividualPallet[] = [];
  let l1 = l1Init;
  let l2 = l2Init;
  let l3 = l3Init;

  const sorted = [...pallets].sort((a, b) => b.pallet_width - a.pallet_width);
  for (const p of sorted) {
    const options = [
      { id: 1, list: r1, len: l1 },
      { id: 2, list: r2, len: l2 },
      { id: 3, list: r3, len: l3 },
    ].filter(o => o.list.length < targetPerCol);

    options.sort((a, b) => a.len - b.len);
    const chosen = options[0];
    if (chosen.id === 1) {
      r1.push(p);
      l1 += p.pallet_width;
    } else if (chosen.id === 2) {
      r2.push(p);
      l2 += p.pallet_width;
    } else {
      r3.push(p);
      l3 += p.pallet_width;
    }
  }

  return { r1, r2, r3, l1, l2, l3, maxL: Math.max(l1, l2, l3) };
}

/**
 * STAGE 2 — CONTAINER SPACE FILL OPTIMIZATION:
 * Improves container floor-space utilization by selectively converting 3-reel pallets into 2-reel pallets.
 * 
 * Strict Factory Rules & Constraints:
 * 1. Allowed ONLY when the normal pallet configuration is 3 reels per pallet (cradle_ply === 765).
 * 2. Allowed ONLY when BOTH conditions are true:
 *    - The normal 3-reel configuration is ALREADY valid within the mandatory ±10% tolerance.
 *    - The container has significant unused physical longitudinal space (currentMaxLen < maxSafeLength - 300mm).
 * 3. HARD ±10% tolerance constraint: Final planned weight must remain within Order Qty ±10%.
 * 4. Prioritizes larger pallet sizes (slit size) for 2-reel conversion first.
 * 5. Does NOT apply to 6-reel, 8-reel, 4-reel completion, 1-reel exceptional completion, or non-3-reel items.
 * 6. Does NOT replace 3-reel wholesale; converts only as many pallets as needed to fill available space without exceeding maxSafeLength.
 */
export function optimizeContainerSpaceFill(
  ordersInContainer: CalculatedItem[],
  config: StuffingConfig,
  maxWeight: number
): CalculatedItem[] {
  // Only applicable for 40ft HC containers in HPP mode
  if (config.container_type === '20ft') return ordersInContainer;

  // Clone items for immutability
  const optimized = ordersInContainer.map(o => ({ ...o }));

  // Fast guard: identify eligible items directly from optimized clone
  const eligibleItems = optimized.filter(item => {
    if (item.packing_mode !== 'HPP') return false;
    if (item.is_dropped) return false;
    if (item.custom_reels_per_pallet !== undefined) return false;
    if (item.cradle_ply !== 765) return false;

    const p3 = item.pallets_3_reels ?? (item.reels_per_pallet === 3 ? item.total_pallets : 0);
    if (p3 <= 0) return false;

    const minTol = item.order_qty * 0.90;
    const maxTol = item.order_qty * 1.10;
    if (item.planned_weight < minTol || item.planned_weight > maxTol) return false;

    return true;
  });

  // If no items are eligible for space fill, return immediately without layout computation
  if (eligibleItems.length === 0) return ordersInContainer;

  const internalLength = config.container_internal_length || 12032;
  const maxSafeLength = Math.min(11850, internalLength - 180);

  const getLayoutMaxLen = (items: CalculatedItem[]): number => {
    const layout = generateRowLayoutForContainer(items, 1, config);
    return layout.row_lengths.max_length;
  };

  let currentMaxLen = getLayoutMaxLen(optimized);

  // If container is already physically full lengthwise, no space-fill needed
  if (currentMaxLen >= maxSafeLength - 300) return optimized;

  let currentContainerWeight = optimized.reduce((sum, o) => sum + (o.planned_weight || 0), 0);

  // Prioritize larger pallet sizes (slit size) for 2-reel conversion first
  eligibleItems.sort((a, b) => b.size - a.size || a.item - b.item);

  for (const item of eligibleItems) {
    if (currentMaxLen >= maxSafeLength - 300) break;

    const minTol = Number((item.order_qty * 0.90).toFixed(2));
    const maxTol = Number((item.order_qty * 1.10).toFixed(2));

    let p3 = item.pallets_3_reels ?? (item.reels_per_pallet === 3 ? item.total_pallets : 0);
    let p2 = item.pallets_2_reels ?? (item.reels_per_pallet === 2 ? item.total_pallets : 0);
    const pOther = item.pallets_other_reels ?? Math.max(0, item.total_pallets - p3 - p2);

    let usedFastPath = false;
    // Strategy A: Direct split of 2 x 3-reel pallets -> 3 x 2-reel pallets (0 weight change, +1 pallet to fill space)
    while (p3 >= 2 && currentMaxLen < maxSafeLength - 300) {
      const testP3 = p3 - 2;
      const testP2 = p2 + 3;
      const testTotalPallets = testP3 + testP2 + pOther;

      const prevP3 = item.pallets_3_reels;
      const prevP2 = item.pallets_2_reels;
      const prevTotalPallets = item.total_pallets;

      item.pallets_3_reels = testP3;
      item.pallets_2_reels = testP2;
      item.total_pallets = testTotalPallets;

      // Fast mathematical row-length feasibility check:
      // In 3 lines, adding 1 pallet of width item.pallet_width increases row length by at most item.pallet_width.
      // If currentMaxLen + item.pallet_width <= maxSafeLength - 300, it is mathematically guaranteed
      // to remain within physical container limits.
      const isDefinitelySafe = (currentMaxLen + item.pallet_width <= maxSafeLength - 300);

      let newMaxLen: number;
      if (isDefinitelySafe) {
        usedFastPath = true;
        newMaxLen = currentMaxLen + Math.ceil(item.pallet_width / 3);
      } else {
        newMaxLen = getLayoutMaxLen(optimized);
      }

      if (newMaxLen <= maxSafeLength) {
        p3 = testP3;
        p2 = testP2;
        currentMaxLen = newMaxLen;

        const h3 = getPalletHeightForHPP(765, 3);
        const h2 = getPalletHeightForHPP(765, 2);
        const mainR = p3 > 0 ? 3 : 2;
        const mainH = mainR === 3 ? h3 : h2;

        item.reels_per_pallet = mainR;
        item.pallet_height = mainH;
        item.pallet_dims_str = `${item.pallet_length}*${item.pallet_width}*${mainH}`;
        if (p3 === 0) {
          item.pallets_summary = `${p2}x 2-reel (${h2}mm)`;
          item.reels_per_pallet_reason = `Container Space Optimized: ${p2}x 2-reel Pallets (${h2}mm)`;
        } else {
          item.pallets_summary = `${p3}x 3-reel (${h3}mm) + ${p2}x 2-reel (${h2}mm)`;
          item.reels_per_pallet_reason = `Container Space Optimized: ${p3}x 3-reel + ${p2}x 2-reel Pallets (${h3}mm / ${h2}mm)`;
        }
      } else {
        // Revert and stop converting this item
        item.pallets_3_reels = prevP3;
        item.pallets_2_reels = prevP2;
        item.total_pallets = prevTotalPallets;
        break;
      }
    }

    if (usedFastPath) {
      currentMaxLen = getLayoutMaxLen(optimized);
    }

    // Strategy B: If p3 === 1 and space remains, test converting 1x 3-reel -> 2x 2-reel (+1 reel, +1 pallet)
    // Only applied if planner has NOT manually set custom_planned_reels for this item
    if (p3 === 1 && item.custom_planned_reels === undefined && currentMaxLen < maxSafeLength - 300) {
      const deltaReels = 1;
      const deltaWeight = Number((deltaReels * item.per_reel_wt).toFixed(2));
      const testPlannedReels = item.planned_reels + deltaReels;
      const testPlannedWeight = Number((testPlannedReels * item.per_reel_wt).toFixed(2));

      if (testPlannedWeight <= maxTol && testPlannedWeight >= minTol && currentContainerWeight + deltaWeight <= maxWeight) {
        const testP3 = p3 - 1;
        const testP2 = p2 + 2;
        const testTotalPallets = testP3 + testP2 + pOther;

        const prevP3 = item.pallets_3_reels;
        const prevP2 = item.pallets_2_reels;
        const prevTotalPallets = item.total_pallets;
        const prevPlannedReels = item.planned_reels;
        const prevPlannedWeight = item.planned_weight;
        const prevExcessLess = item.excess_less;

        item.pallets_3_reels = testP3;
        item.pallets_2_reels = testP2;
        item.total_pallets = testTotalPallets;
        item.planned_reels = testPlannedReels;
        item.planned_weight = testPlannedWeight;
        item.excess_less = Number((testPlannedWeight - item.order_qty).toFixed(2));

        const newMaxLen = getLayoutMaxLen(optimized);

        if (newMaxLen <= maxSafeLength) {
          p3 = testP3;
          p2 = testP2;
          currentMaxLen = newMaxLen;
          currentContainerWeight += deltaWeight;

          const h2 = getPalletHeightForHPP(765, 2);
          item.reels_per_pallet = 2;
          item.pallet_height = h2;
          item.pallet_dims_str = `${item.pallet_length}*${item.pallet_width}*${h2}`;
          item.pallets_summary = `${p2}x 2-reel (${h2}mm)`;
          item.reels_per_pallet_reason = `Container Space Optimized: ${p2}x 2-reel Pallets (${h2}mm)`;
        } else {
          // Revert
          item.pallets_3_reels = prevP3;
          item.pallets_2_reels = prevP2;
          item.total_pallets = prevTotalPallets;
          item.planned_reels = prevPlannedReels;
          item.planned_weight = prevPlannedWeight;
          item.excess_less = prevExcessLess;
        }
      }
    }
  }

  return optimized;
}

/**
 * CONTROLLED HPP 2->1 SPACE-FILL STAGE:
 * After normal HPP planning and 3->2 space-fill are complete:
 * If a container still has usable floor space AND payload/weight is already effectively the limiting condition,
 * allow eligible 2-reel HPP pallets to be split into 2 x 1-reel pallets (1x 2-reel -> 2x 1-reel).
 * 
 * Candidate Priority:
 * 1. Higher film density first (e.g. PET ~1.4 before BOPP ~0.9)
 * 2. If density equal, higher single reel weight first
 * 3. Deterministic stable tie-breaker: original item/order index
 */
export function optimizeContainerHppTwoToOneSpaceFill(
  ordersInContainer: CalculatedItem[],
  config: StuffingConfig,
  maxWeight: number
): CalculatedItem[] {
  // Only applicable for 40ft HC containers in HPP mode
  if (config.container_type === '20ft') return ordersInContainer;

  // Clone items for immutability
  const optimized = ordersInContainer.map(o => ({ ...o }));

  const getP2Count = (item: CalculatedItem): number => {
    return item.pallets_2_reels ?? (item.reels_per_pallet === 2 ? item.total_pallets : 0);
  };

  const getP1Count = (item: CalculatedItem): number => {
    return item.pallets_1_reel ?? (item.reels_per_pallet === 1 ? item.total_pallets : 0);
  };

  // Eligibility check:
  // - Packing mode is HPP
  // - Not dropped
  // - Not manually locked by custom_reels_per_pallet
  // - Cradle ply is 765 or 850 (single column vertical cradle where 1-reel HPP is rule compliant; 550/600 plies are forbidden)
  // - Has at least one 2-reel pallet available to split
  const isEligible = (item: CalculatedItem): boolean => {
    if (item.packing_mode !== 'HPP') return false;
    if (item.is_dropped) return false;
    if (item.custom_reels_per_pallet !== undefined) return false;
    if (item.cradle_ply !== 765 && item.cradle_ply !== 850) return false;
    if (getP2Count(item) <= 0) return false;
    return true;
  };

  const eligibleItems = optimized.filter(isEligible);
  if (eligibleItems.length === 0) return ordersInContainer;

  const internalLength = config.container_internal_length || 12032;
  const maxSafeLength = Math.min(11850, internalLength - 180);

  const getLayoutMaxLen = (items: CalculatedItem[]): number => {
    const layout = generateRowLayoutForContainer(items, 1, config);
    return layout.row_lengths.max_length;
  };

  let currentMaxLen = getLayoutMaxLen(optimized);

  // If container floor space is already adequately consumed, no 2->1 space-fill needed
  if (currentMaxLen >= maxSafeLength - 300) return optimized;

  const currentContainerWeight = optimized.reduce((sum, o) => sum + (o.planned_weight || 0), 0);
  // Payload/weight must be limiting (container has orders assigned)
  if (currentContainerWeight <= 0) return optimized;

  // Candidate Priority:
  // 1. Higher film density first
  // 2. If density equal, higher single reel weight first
  // 3. Stable tie-breaker: original item/order index
  const compareCandidates = (a: CalculatedItem, b: CalculatedItem): number => {
    const densityA = a.density || 0;
    const densityB = b.density || 0;
    if (Math.abs(densityB - densityA) > 1e-4) {
      return densityB - densityA;
    }
    const wtA = a.per_reel_wt || 0;
    const wtB = b.per_reel_wt || 0;
    if (Math.abs(wtB - wtA) > 1e-2) {
      return wtB - wtA;
    }
    return a.item - b.item;
  };

  const exhaustedItems = new Set<number>();
  let hasChanges = false;
  let usedFastPath = false;

  // Loop: evaluate candidates from updated state until no more splits fit or floor space is adequately consumed
  while (currentMaxLen < maxSafeLength - 300) {
    const activeCandidates = optimized.filter(item => isEligible(item) && !exhaustedItems.has(item.item));
    if (activeCandidates.length === 0) break;

    // Sort according to candidate priority
    activeCandidates.sort(compareCandidates);

    let splitAccepted = false;

    for (const item of activeCandidates) {
      const p2 = getP2Count(item);
      if (p2 <= 0) {
        exhaustedItems.add(item.item);
        continue;
      }

      const p3 = item.pallets_3_reels ?? (item.reels_per_pallet === 3 ? item.total_pallets : 0);
      const p1 = getP1Count(item);

      // Cheap feasibility check:
      // In 3 lines, adding 1 pallet of width item.pallet_width increases row length by at least Math.ceil(item.pallet_width / 3).
      // If even the minimum possible increase exceeds maxSafeLength, it cannot possibly fit.
      const minEstimatedIncrease = Math.ceil(item.pallet_width / 3);
      if (currentMaxLen + minEstimatedIncrease > maxSafeLength) {
        exhaustedItems.add(item.item);
        continue;
      }

      // Tentatively apply 1x 2-reel -> 2x 1-reel split (+1 pallet, 0 reel change, 0 weight change)
      const testP2 = p2 - 1;
      const testP1 = p1 + 2;
      const testTotalPallets = item.total_pallets + 1;

      const prevP2 = item.pallets_2_reels;
      const prevP1 = item.pallets_1_reel;
      const prevTotalPallets = item.total_pallets;

      item.pallets_2_reels = testP2;
      item.pallets_1_reel = testP1;
      item.total_pallets = testTotalPallets;

      // Fast check: If well within safe limits, use mathematical estimation
      const isDefinitelySafe = (currentMaxLen + item.pallet_width <= maxSafeLength - 300);

      let newMaxLen: number;
      if (isDefinitelySafe) {
        usedFastPath = true;
        newMaxLen = currentMaxLen + minEstimatedIncrease;
      } else {
        newMaxLen = getLayoutMaxLen(optimized);
      }

      if (newMaxLen <= maxSafeLength) {
        // ACCEPT the split
        hasChanges = true;
        currentMaxLen = newMaxLen;
        item.loaded_in_container = testTotalPallets;

        const h3 = getPalletHeightForHPP(item.cradle_ply, 3);
        const h2 = getPalletHeightForHPP(item.cradle_ply, 2);
        const h1 = getPalletHeightForHPP(item.cradle_ply, 1);

        const parts: string[] = [];
        if (p3 > 0) parts.push(`${p3}x 3-reel (${h3}mm)`);
        if (testP2 > 0) parts.push(`${testP2}x 2-reel (${h2}mm)`);
        if (testP1 > 0) parts.push(`${testP1}x 1-reel (${h1}mm)`);

        item.pallets_summary = parts.join(' + ');
        item.reels_per_pallet_reason = `HPP 2->1 Space-Fill: ${parts.join(' + ')}`;
        item.reels_per_pallet = testP2 > 0 ? 2 : 1;
        item.pallet_height = testP2 > 0 ? h2 : h1;
        item.pallet_dims_str = `${item.pallet_length}*${item.pallet_width}*${item.pallet_height}`;

        splitAccepted = true;
        // Break to re-sort from updated state
        break;
      } else {
        // REJECT the split
        item.pallets_2_reels = prevP2;
        item.pallets_1_reel = prevP1;
        item.total_pallets = prevTotalPallets;
        exhaustedItems.add(item.item);
      }
    }

    if (!splitAccepted) break;
  }

  // If fast path was used, compute exact final layout length
  if (hasChanges && usedFastPath) {
    currentMaxLen = getLayoutMaxLen(optimized);
  }

  return hasChanges ? optimized : ordersInContainer;
}

/**
 * STAGE 2 — CONTAINER LOAD OPTIMIZATION:
 * Optimizes Container Payload Weight by evaluating 550 Ply items.
 * 
 * If total container payload is below practical capacity (nominal maxWeight ~26,000 kg for 40ft HC):
 * Sequentially converts eligible 6-reel pallets into 8-reel pallets (adding 2 reels per pallet, ~240 kg)
 * strictly from SMALLER SLIT SIZE -> LARGER SLIT SIZE (e.g. 675mm -> 765mm -> 855mm -> 895mm).
 * 
 * Strict Factory Rules & Constraints:
 * 1. Physical/factory validity: cradle_ply === 550, size < 1100mm, 40ft HC (8-reel 2450mm height fits in 2698mm).
 * 2. Individual item ±10% HARD tolerance: Order Qty * 0.90 <= New Planned Weight <= Order Qty * 1.10.
 *    If converting next pallet causes planned weight > Order Qty * 1.10, STOP converting this item immediately
 *    and advance to the next eligible candidate in size order.
 * 3. Container maximum payload: New Total Container Weight <= maxWeight (26,000 kg).
 * 4. 600 Ply: NEVER convert 6 -> 8 (8 reels is illegal for 600 ply).
 * 5. 765 / 850 Ply: Unchanged.
 * 6. 4-Reel Rule: 4-reel pallets are only for completion/remainder and not forced as standard optimization.
 */
export function optimizeContainerPayloadWeight(
  ordersInContainer: CalculatedItem[],
  config: StuffingConfig,
  maxWeight: number
): CalculatedItem[] {
  // Only applicable for 40ft HC containers (height 2698mm fits 8-reel height 2450mm)
  if (config.container_type === '20ft') return ordersInContainer;

  // Clone items for immutability
  const optimized = ordersInContainer.map(o => ({ ...o }));

  let currentContainerWeight = optimized.reduce((sum, o) => sum + (o.planned_weight || 0), 0);

  // If container is already close to payload capacity (e.g. >= maxWeight - 50), nothing to do
  if (currentContainerWeight >= maxWeight - 50) return optimized;

  // Identify eligible 550 Ply items in the container
  // Criteria: cradle_ply === 550, packing_mode === 'HPP', size < 1100, not dropped, total_pallets > 0
  const eligibleItems = optimized.filter(item => 
    item.cradle_ply === 550 &&
    item.packing_mode === 'HPP' &&
    item.size < 1100 &&
    !item.is_dropped &&
    item.total_pallets > 0 &&
    item.custom_reels_per_pallet !== 6 // Respect explicit user lock to 6 if set
  );

  // CRITICAL REQUIREMENT: Sequential conversion from SMALLER SLIT SIZE -> LARGER SLIT SIZE
  eligibleItems.sort((a, b) => a.size - b.size || a.item - b.item);

  for (const item of eligibleItems) {
    if (currentContainerWeight >= maxWeight - 50) break;

    // Determine current 6-reel and 8-reel pallet counts
    let p8 = item.pallets_8_reels ?? (item.reels_per_pallet === 8 ? item.total_pallets : 0);
    let p6 = item.pallets_6_reels ?? (item.reels_per_pallet === 6 ? item.total_pallets : 0);
    let pOther = item.pallets_other_reels ?? Math.max(0, item.total_pallets - p8 - p6);

    // If counts weren't partitioned yet and item had 6 reels/pallet
    if (p8 === 0 && p6 === 0 && pOther === 0 && item.reels_per_pallet === 6) {
      p6 = item.total_pallets;
    }

    const minTol = Number((item.order_qty * 0.90).toFixed(2));
    const maxTol = Number((item.order_qty * 1.10).toFixed(2));

    // Iteratively test converting 1 pallet at a time from 6 reels to 8 reels
    while (p6 > 0 && currentContainerWeight < maxWeight - 50) {
      const deltaReels = 2;
      const deltaWeight = Number((deltaReels * item.per_reel_wt).toFixed(2));
      const testPlannedReels = item.planned_reels + deltaReels;
      const testPlannedWeight = Number((testPlannedReels * item.per_reel_wt).toFixed(2));

      // 1. Check item-level ±10% tolerance (DEAD FINAL)
      if (testPlannedWeight > maxTol || testPlannedWeight < minTol) {
        // Exceeds +10% tolerance! Cannot convert any more pallets on this item.
        break;
      }

      // 2. Check container payload limit (must not exceed maxWeight, e.g. 26,000 kg)
      if (currentContainerWeight + deltaWeight > maxWeight) {
        // Would overload container
        break;
      }

      // 3. Conversion valid! Apply conversion
      p6 -= 1;
      p8 += 1;
      item.pallets_6_reels = p6;
      item.pallets_8_reels = p8;
      item.planned_reels = testPlannedReels;
      item.planned_weight = testPlannedWeight;
      item.excess_less = Number((testPlannedWeight - item.order_qty).toFixed(2));
      currentContainerWeight += deltaWeight;

      const h8 = getPalletHeightForHPP(550, 8); // 2450 mm
      const h6 = getPalletHeightForHPP(550, 6); // 1900 mm

      if (p6 === 0 && pOther === 0) {
        item.reels_per_pallet = 8;
        item.pallet_height = h8;
        item.pallet_dims_str = `${item.pallet_length}*${item.pallet_width}*${h8}`;
        item.pallets_summary = `${p8}x 8-reel (${h8}mm)`;
        item.reels_per_pallet_reason = `Container Load Optimized: 8 Reels/Pallet (Payload Maximize ~${maxWeight.toLocaleString()}kg)`;
      } else if (p6 > 0 && pOther === 0) {
        item.reels_per_pallet = 8;
        item.pallet_height = h8;
        item.pallet_dims_str = `${item.pallet_length}*${item.pallet_width}*${h8}`;
        item.pallets_summary = `${p8}x 8-reel (${h8}mm) + ${p6}x 6-reel (${h6}mm)`;
        item.reels_per_pallet_reason = `Container Load Optimized: ${p8}x 8-reel + ${p6}x 6-reel (Payload Maximize ~${maxWeight.toLocaleString()}kg)`;
      } else {
        item.reels_per_pallet = 8;
        item.pallet_height = h8;
        item.pallet_dims_str = `${item.pallet_length}*${item.pallet_width}*${h8}`;
        item.pallets_summary = `${p8}x 8-reel (${h8}mm) + ${p6}x 6-reel (${h6}mm) + ${pOther}x completion`;
        item.reels_per_pallet_reason = `Container Load Optimized: ${p8}x 8-reel + ${p6}x 6-reel (Payload Maximize ~${maxWeight.toLocaleString()}kg)`;
      }
    }
  }

  return optimized;
}

export interface VppPhysicalPalletItem {
  item: number;
  film: string;
  size: number;
  reels: number;
  weight: number;
  original: CalculatedItem;
}

export interface VppPhysicalPallet {
  id: number;
  items: VppPhysicalPalletItem[];
  total_reels: number;
  total_weight: number;
  height: number;
  length: number;
  width: number;
  dims_str: string;
  is_mixed: boolean;
  tier_desc: string;
  primary_item: number;
  primary_calculated_item: CalculatedItem;
}

/**
 * Deterministically consolidates VPP order remainders into mixed-size / mixed-film physical pallets.
 * Preserves tier structure, physical container clearance, reel counts, and weight conservation.
 * TC20 <120mm / VPP-007 is strictly isolated.
 */
export function consolidateVppOrdersIntoPallets(
  vppOrders: CalculatedItem[],
  config: StuffingConfig = DEFAULT_STUFFING_CONFIG
): VppPhysicalPallet[] {
  // 1. Gatekeeper: strictly segregate TC20 orders from any consolidation
  const eligibleOrders: CalculatedItem[] = [];
  const tc20Orders: CalculatedItem[] = [];

  vppOrders.forEach(o => {
    const eligibility = isEligibleForVppConsolidation({ film: o.film, size: o.size, packing_mode: 'VPP' });
    if (eligibility.eligible) {
      eligibleOrders.push(o);
    } else {
      tc20Orders.push(o);
    }
  });

  const containerHeight = config.container_type === '20ft'
    ? USABLE_20FT_ENVELOPE.max_height
    : (config.container_internal_height || 2698);
  const palletBaseTare = 200;
  const maxSafeHeight = config.container_type === '20ft'
    ? USABLE_20FT_ENVELOPE.max_height
    : (containerHeight - 40);

  const physicalPallets: VppPhysicalPallet[] = [];

  // Dedicated large-volume multi-tier orders (e.g. BAT Sudan with reels_per_pallet > 12 and full pallets)
  const dedicatedMultiTierOrders: CalculatedItem[] = [];
  const poolingOrders: CalculatedItem[] = [];

  eligibleOrders.forEach(o => {
    // If an order already has reels_per_pallet > 12, large order volume (> 2000kg) and multiple full pallets:
    if (o.reels_per_pallet && o.reels_per_pallet > 12 && o.total_pallets > 1) {
      dedicatedMultiTierOrders.push(o);
    } else {
      poolingOrders.push(o);
    }
  });

  dedicatedMultiTierOrders.forEach(o => {
    const mainR = o.reels_per_pallet;
    const fullPallets = Math.floor(o.planned_reels / mainR);
    const palWeight = Number((mainR * o.per_reel_wt).toFixed(2));
    for (let k = 0; k < fullPallets; k++) {
      physicalPallets.push({
        id: physicalPallets.length + 1,
        items: [{
          item: o.item,
          film: o.film,
          size: o.size,
          reels: mainR,
          weight: palWeight,
          original: o,
        }],
        total_reels: mainR,
        total_weight: palWeight,
        height: o.pallet_height,
        length: o.pallet_length,
        width: o.pallet_width,
        dims_str: o.pallet_dims_str,
        is_mixed: false,
        tier_desc: `${o.vpp_layers || 7} tiers x ${o.vpp_rolls_per_layer || 12} reels (Item ${o.item} ${o.film})`,
        primary_item: o.item,
        primary_calculated_item: o,
      });
    }
    const remReels = o.planned_reels - fullPallets * mainR;
    if (remReels > 0) {
      poolingOrders.push({
        ...o,
        planned_reels: remReels,
        planned_weight: Number((remReels * o.per_reel_wt).toFixed(2)),
      });
    }
  });

  // =========================================================================
  // DYNAMIC VPP PALLET OPTIMIZATION ENGINE
  // =========================================================================

  // 1. Partition pooling orders by diameter class:
  // Small-diameter rolls (dia < 330 mm) MUST stay together and NOT be used as fillers on standard-diameter pallets
  const smallDiaOrders: CalculatedItem[] = [];
  const stdDiaOrders: CalculatedItem[] = [];

  poolingOrders.forEach(o => {
    const dia = o.dia || 420;
    if (dia < 330) {
      smallDiaOrders.push(o);
    } else {
      stdDiaOrders.push(o);
    }
  });

  // 2. Small-Diameter Multi-Tier Pallet Consolidation:
  // Pack small sizes together into dense multi-tier pallets up to max legal height
  if (smallDiaOrders.length > 0) {
    let curItems: VppPhysicalPalletItem[] = [];
    let curReels = 0;
    let curWeight = 0;
    let curHeight = palletBaseTare;
    const footLen = 1100;
    const footWid = 1100;

    smallDiaOrders.forEach(o => {
      const dia = o.dia || 235;
      const rollsPerTier = Math.max(4, Math.floor(footLen / dia) * Math.floor(footWid / dia));
      const neededTiers = Math.ceil(o.planned_reels / rollsPerTier);
      const addedH = neededTiers * o.size;

      if (curHeight + addedH > maxSafeHeight || curWeight + o.planned_weight > 1500) {
        if (curItems.length > 0) {
          physicalPallets.push({
            id: physicalPallets.length + 1,
            items: curItems,
            total_reels: curReels,
            total_weight: Number(curWeight.toFixed(2)),
            height: curHeight,
            length: footLen,
            width: footWid,
            dims_str: `${footLen}*${footWid}*${curHeight} (Mixed Small-Dia)`,
            is_mixed: curItems.length > 1,
            tier_desc: `Dense small-dia multi-tier pallet (${curReels} reels)`,
            primary_item: curItems[0].item,
            primary_calculated_item: curItems[0].original,
          });
          curItems = [];
          curReels = 0;
          curWeight = 0;
          curHeight = palletBaseTare;
        }
      }

      curItems.push({
        item: o.item,
        film: o.film,
        size: o.size,
        reels: o.planned_reels,
        weight: o.planned_weight,
        original: o,
      });
      curReels += o.planned_reels;
      curWeight += o.planned_weight;
      curHeight += addedH;
    });

    if (curItems.length > 0) {
      physicalPallets.push({
        id: physicalPallets.length + 1,
        items: curItems,
        total_reels: curReels,
        total_weight: Number(curWeight.toFixed(2)),
        height: curHeight,
        length: footLen,
        width: footWid,
        dims_str: `${footLen}*${footWid}*${curHeight} (Mixed Small-Dia)`,
        is_mixed: curItems.length > 1,
        tier_desc: `Dense small-dia multi-tier pallet (${curReels} reels)`,
        primary_item: curItems[0].item,
        primary_calculated_item: curItems[0].original,
      });
    }
  }

  // 3. Standard-Diameter Pallet Consolidation:
  interface ReelBlock {
    item: number;
    film: string;
    size: number;
    reels: number;
    weight: number;
    dia: number;
    original: CalculatedItem;
  }

  interface Tier {
    id: number;
    height: number;
    reels: number;
    weight: number;
    dia: number;
    blocks: ReelBlock[];
  }

  // Step 1: Decompose all standard-diameter planned reels into 3-reel blocks (half-tiers)
  const blocks: ReelBlock[] = [];
  stdDiaOrders.forEach(o => {
    let rem = o.planned_reels;
    while (rem >= 3) {
      blocks.push({
        item: o.item,
        film: o.film,
        size: o.size,
        reels: 3,
        weight: Number((3 * o.per_reel_wt).toFixed(2)),
        dia: o.dia || 420,
        original: o,
      });
      rem -= 3;
    }
    if (rem > 0) {
      blocks.push({
        item: o.item,
        film: o.film,
        size: o.size,
        reels: rem,
        weight: Number((rem * o.per_reel_wt).toFixed(2)),
        dia: o.dia || 420,
        original: o,
      });
    }
  });

  // Step 2: Form 6-reel tiers from blocks
  const tiers: Tier[] = [];
  let tierId = 1;

  // Group blocks by item to pair homogeneous 3-reel blocks into homogeneous 6-reel tiers
  const itemBlockMap = new Map<number, ReelBlock[]>();
  blocks.forEach(b => {
    if (!itemBlockMap.has(b.item)) itemBlockMap.set(b.item, []);
    itemBlockMap.get(b.item)!.push(b);
  });

  const remainderBlocks: ReelBlock[] = [];

  itemBlockMap.forEach((bList) => {
    while (bList.length >= 2 && bList[0].reels === 3 && bList[1].reels === 3) {
      const b1 = bList.shift()!;
      const b2 = bList.shift()!;
      tiers.push({
        id: tierId++,
        height: b1.size,
        reels: 6,
        weight: Number((b1.weight + b2.weight).toFixed(2)),
        dia: b1.dia,
        blocks: [{
          ...b1,
          reels: 6,
          weight: Number((b1.weight + b2.weight).toFixed(2)),
        }],
      });
    }
    bList.forEach(b => remainderBlocks.push(b));
  });

  // Pair remaining 3-reel blocks into mixed 6-reel tiers (matching diameter and nearest slit size)
  remainderBlocks.sort((a, b) => b.size - a.size);
  while (remainderBlocks.length >= 2) {
    const b1 = remainderBlocks.shift()!;
    let bestIdx = -1;
    let minScore = Infinity;

    for (let i = 0; i < remainderBlocks.length; i++) {
      const b2 = remainderBlocks[i];
      // Check physical diameter compatibility (rolls must match in diameter to sit securely side-by-side)
      const diaDiff = Math.abs(b1.dia - b2.dia);
      if (diaDiff > 35) continue;

      const sizeDiff = Math.abs(b1.size - b2.size);
      const sameFilmBonus = b1.film === b2.film ? 0 : 20;
      const score = sizeDiff + sameFilmBonus + diaDiff * 2;

      if (score < minScore) {
        minScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx !== -1) {
      const b2 = remainderBlocks.splice(bestIdx, 1)[0];
      const tierH = Math.max(b1.size, b2.size);
      tiers.push({
        id: tierId++,
        height: tierH,
        reels: b1.reels + b2.reels,
        weight: Number((b1.weight + b2.weight).toFixed(2)),
        dia: Math.max(b1.dia, b2.dia),
        blocks: [b1, b2],
      });
    } else {
      // If cannot pair with other remainder blocks, check if a homogeneous tier can be split to absorb it
      let splitTierIdx = -1;
      for (let t = 0; t < tiers.length; t++) {
        const candidateTier = tiers[t];
        if (candidateTier.blocks.length === 1 && candidateTier.reels === 6) {
          const origBlock = candidateTier.blocks[0];
          const diaDiff = Math.abs(b1.dia - origBlock.dia);
          const sizeDiff = Math.abs(b1.size - origBlock.size);
          if (diaDiff <= 35 && sizeDiff <= 150) {
            splitTierIdx = t;
            break;
          }
        }
      }

      if (splitTierIdx !== -1) {
        const splitTier = tiers.splice(splitTierIdx, 1)[0];
        const half1: ReelBlock = { ...splitTier.blocks[0], reels: 3, weight: Number((splitTier.weight / 2).toFixed(2)) };
        const half2: ReelBlock = { ...splitTier.blocks[0], reels: 3, weight: Number((splitTier.weight / 2).toFixed(2)) };
        tiers.push({
          id: tierId++,
          height: Math.max(b1.size, half1.size),
          reels: b1.reels + half1.reels,
          weight: Number((b1.weight + half1.weight).toFixed(2)),
          dia: Math.max(b1.dia, half1.dia),
          blocks: [b1, half1],
        });
        remainderBlocks.push(half2);
        remainderBlocks.sort((a, b) => b.size - a.size);
      } else {
        // Could not find a diameter-compatible partner, keep as single block tier
        tiers.push({
          id: tierId++,
          height: b1.size,
          reels: b1.reels,
          weight: b1.weight,
          dia: b1.dia,
          blocks: [b1],
        });
      }
    }
  }

  if (remainderBlocks.length > 0) {
    const b = remainderBlocks.shift()!;
    tiers.push({
      id: tierId++,
      height: b.size,
      reels: b.reels,
      weight: b.weight,
      dia: b.dia,
      blocks: [b],
    });
  }

  // Step 3: Multi-Layer Stacking & Height Maximization via Best Fit Decreasing (BFD)
  const sortedTiers = [...tiers].sort((a, b) => b.height - a.height);
  const matchedPalletTiers: Tier[][] = [];

  for (const t of sortedTiers) {
    let bestIdx = -1;
    let minSpace = Infinity;

    for (let i = 0; i < matchedPalletTiers.length; i++) {
      const curH = matchedPalletTiers[i].reduce((sum, it) => sum + it.height, 0);
      const diaDiff = Math.abs(matchedPalletTiers[i][0].dia - t.dia);
      if (diaDiff <= 35 && curH + t.height + palletBaseTare <= maxSafeHeight) {
        const space = maxSafeHeight - (curH + t.height + palletBaseTare);
        if (space < minSpace) {
          minSpace = space;
          bestIdx = i;
        }
      }
    }

    if (bestIdx !== -1) {
      matchedPalletTiers[bestIdx].push(t);
    } else {
      matchedPalletTiers.push([t]);
    }
  }

  // Convert matched tier groups into VppPhysicalPallet[]
  matchedPalletTiers.forEach((palletTiers) => {
    const palH = palletTiers.reduce((sum, t) => sum + t.height, 0) + palletBaseTare;
    const allBlocks: ReelBlock[] = [];
    palletTiers.forEach(t => allBlocks.push(...t.blocks));

    const totR = palletTiers.reduce((sum, t) => sum + t.reels, 0);
    const totW = Number(palletTiers.reduce((sum, t) => sum + t.weight, 0).toFixed(2));
    const pLen = Math.max(...allBlocks.map(b => b.original.pallet_length || 1300));
    const pWid = Math.max(...allBlocks.map(b => b.original.pallet_width || 900));

    const isMixed = allBlocks.length > 1 || new Set(allBlocks.map(b => b.item)).size > 1;
    const dimsStr = `${pLen}*${pWid}*${palH}${isMixed ? ' (Mixed)' : ''}`;

    // Consolidate identical items inside pallet items array
    const consolidatedItems: VppPhysicalPalletItem[] = [];
    allBlocks.forEach(b => {
      const existing = consolidatedItems.find(it => it.item === b.item && it.film === b.film && it.size === b.size);
      if (existing) {
        existing.reels += b.reels;
        existing.weight = Number((existing.weight + b.weight).toFixed(2));
      } else {
        consolidatedItems.push({
          item: b.item,
          film: b.film,
          size: b.size,
          reels: b.reels,
          weight: b.weight,
          original: b.original,
        });
      }
    });

    const tierDescriptions = palletTiers.map((t, idx) => 
      `Tier ${idx + 1}: ${t.blocks.map(b => `${b.reels}r ${b.film} ${b.size}mm`).join('+')}`
    ).join(' | ');

    physicalPallets.push({
      id: physicalPallets.length + 1,
      items: consolidatedItems,
      total_reels: totR,
      total_weight: totW,
      height: palH,
      length: pLen,
      width: pWid,
      dims_str: dimsStr,
      is_mixed: isMixed,
      tier_desc: tierDescriptions,
      primary_item: consolidatedItems[0].item,
      primary_calculated_item: consolidatedItems[0].original,
    });
  });

  // 3. TC20 orders: build their immutable homogeneous 84-reel pallets
  tc20Orders.forEach(tc => {
    const mainR = tc.reels_per_pallet || 84;
    const count = tc.total_pallets || Math.ceil(tc.planned_reels / mainR);
    const palWeight = Number((mainR * tc.per_reel_wt).toFixed(2));
    for (let k = 0; k < count; k++) {
      physicalPallets.push({
        id: physicalPallets.length + 1,
        items: [{
          item: tc.item,
          film: tc.film,
          size: tc.size,
          reels: mainR,
          weight: palWeight,
          original: tc,
        }],
        total_reels: mainR,
        total_weight: palWeight,
        height: tc.pallet_height,
        length: tc.pallet_length,
        width: tc.pallet_width,
        dims_str: tc.pallet_dims_str,
        is_mixed: false,
        tier_desc: `7 tiers x 12 reels (Item ${tc.item} TC20)`,
        primary_item: tc.item,
        primary_calculated_item: tc,
      });
    }
  });

  return physicalPallets;
}

/**
 * Function 3: assignToContainers(enrichedOrders, config)
 * Intelligent Multi-Container Optimizer:
 * Balances payload weight (targeting ~25,000 - 26,000 kg) AND container longitudinal space (~11.5m - 11.85m),
 * intelligently mixing wide pallets (>= 1100mm) and narrow/medium pallets (< 1100mm) across containers
 * to minimize total container count and eliminate wasteful half-filled tail containers.
 */
export function assignToContainers(
  enrichedOrders: CalculatedItem[],
  config: StuffingConfig = DEFAULT_STUFFING_CONFIG
): ContainerPlan[] {
  if (enrichedOrders.length === 0) return [];

  // Maximum payload weight (nominal 26000 kg for 40ft HC, 21500 for 20ft)
  const maxWeight = (config.container_max_weight && config.container_max_weight > 0)
    ? config.container_max_weight
    : (config.container_type === '20ft' ? 21500 : 26000);
  const is20ft = config.container_type === '20ft';
  const internalLength = is20ft
    ? USABLE_20FT_ENVELOPE.max_length
    : (config.container_internal_length || 12032);
  const maxSafeLength = is20ft
    ? USABLE_20FT_ENVELOPE.max_length
    : Math.min(11850, internalLength - 180);
  const containerWidth = is20ft
    ? USABLE_20FT_ENVELOPE.max_width
    : (config.container_internal_width || 2352);
  const maxUsableHeight = is20ft
    ? USABLE_20FT_ENVELOPE.max_height
    : (config.container_internal_height || 2585);

  // Build granular pallet units from all enriched order items
  interface PalletUnit {
    original: CalculatedItem;
    palletIndex: number;
    weight: number;
    width: number;
    length: number;
    palletHeight?: number;
    dimsStr?: string;
    isWide: boolean;
    reels: number;
    used: boolean;
    assignedRow?: number;
    orientation?: 'standard' | 'rotated';
    longitudinalDim?: number;
    transverseDim?: number;
    isMixed?: boolean;
    mixedItems?: VppPhysicalPalletItem[];
  }

  const palletUnits: PalletUnit[] = [];

  const hppOrders = enrichedOrders.filter(o => o.packing_mode !== 'VPP');
  const vppOrders = enrichedOrders.filter(o => o.packing_mode === 'VPP');

  // Process HPP orders exactly as before
  hppOrders.forEach(o => {
    let palletIdx = 0;
    const addUnits = (count: number, reelsPerPal: number) => {
      const pw = reelsPerPal * o.per_reel_wt;
      for (let p = 0; p < count; p++) {
        palletUnits.push({
          original: o,
          palletIndex: palletIdx++,
          weight: pw,
          width: o.pallet_width,
          length: o.pallet_length,
          isWide: o.size >= 1100,
          reels: reelsPerPal,
          used: false,
          isMixed: false,
        });
      }
    };

    const p8 = o.pallets_8_reels || (o.reels_per_pallet === 8 ? o.total_pallets : 0);
    const p6 = o.pallets_6_reels || (o.reels_per_pallet === 6 ? o.total_pallets : 0);
    const p4 = o.pallets_4_reels || (o.reels_per_pallet === 4 ? o.total_pallets : 0);
    const p3 = o.pallets_3_reels || (o.reels_per_pallet === 3 ? o.total_pallets : 0);
    const p2 = o.pallets_2_reels || (o.reels_per_pallet === 2 ? o.total_pallets : 0);
    const pOther = o.pallets_other_reels || Math.max(0, o.total_pallets - p8 - p6 - p4 - p3 - p2);

    addUnits(p8, 8);
    addUnits(p6, 6);
    addUnits(p4, 4);
    addUnits(p3, 3);
    addUnits(p2, 2);
    if (pOther > 0) {
      const accountedReels = p8 * 8 + p6 * 6 + p4 * 4 + p3 * 3 + p2 * 2;
      const remainderReels = Math.max(1, Math.round((o.planned_reels - accountedReels) / pOther));
      addUnits(pOther, remainderReels);
    }
  });

  // Process VPP orders with consolidation
  if (vppOrders.length > 0) {
    const vppPhysicalPallets = consolidateVppOrdersIntoPallets(vppOrders, config);
    let vppPalletIdx = 0;
    vppPhysicalPallets.forEach(pp => {
      palletUnits.push({
        original: pp.primary_calculated_item,
        palletIndex: vppPalletIdx++,
        weight: pp.total_weight,
        width: pp.width,
        length: pp.length,
        palletHeight: pp.height,
        dimsStr: pp.dims_str,
        isWide: pp.primary_calculated_item.size >= 1100,
        reels: pp.total_reels,
        used: false,
        isMixed: pp.is_mixed,
        mixedItems: pp.items,
      });
    });
  }

  // Accurate container row configuration
  const allAreWide = palletUnits.length > 0 && palletUnits.every(u => u.length * 3 > 2352);
  const isAll850Hpp = palletUnits.length > 0 && palletUnits.every(u => u.original.packing_mode === 'HPP' && (u.length === 850 || u.original.cradle_ply === 850));
  const uses2Rows = is20ft || allAreWide || isAll850Hpp;
  const numRows = uses2Rows ? 2 : 3;

  // Containers pallet buckets
  const containerBuckets: PalletUnit[][] = [];
  let remainingCount = palletUnits.length;
  let safetyLoop = 0;
  const MAX_CONTAINERS = 30;

  while (remainingCount > 0 && safetyLoop++ < MAX_CONTAINERS) {
    const currentPallets: PalletUnit[] = [];
    let currentWeight = 0;
    const currentRowLengths = uses2Rows ? [0, 0] : [0, 0, 0];

    let remainingWeight = 0;
    let remainingWideCount = 0;
    let remainingNarrowCount = 0;

    for (let i = 0; i < palletUnits.length; i++) {
      if (!palletUnits[i].used) {
        remainingWeight += palletUnits[i].weight;
        if (palletUnits[i].isWide) remainingWideCount++;
        else remainingNarrowCount++;
      }
    }

    const estimatedContainersLeft = Math.max(1, Math.ceil(remainingWeight / (maxWeight - 400)));
    const wideQuota = remainingNarrowCount > 0
      ? Math.ceil(remainingWideCount / estimatedContainersLeft)
      : remainingWideCount;

    const hasVppUnits = palletUnits.some(u => u.original.packing_mode === 'VPP');

    // Helper to test & add a pallet to current container by checking all rows for sufficient physical capacity
    const tryAddPallet = (p: PalletUnit): boolean => {
      if (p.used) return false;
      if (currentWeight + p.weight > maxWeight) return false;

      // 1. If this is a 2-row container with VPP pallets (e.g. 20ft container), evaluate VPP-006 pinwheel placement
      if (uses2Rows && (hasVppUnits || p.original.packing_mode === 'VPP') && !isAll850Hpp) {
        const pH = p.palletHeight || p.original.pallet_height || 0;
        if (pH > maxUsableHeight) {
          return false;
        }

        const candidatePallets = [...currentPallets, p];
        const placement = evaluateVppTwoRowPinwheelPlacement(
          candidatePallets,
          maxSafeLength,
          internalLength,
          containerWidth,
          maxUsableHeight
        );
        if (!placement || !placement.fits) {
          return false;
        }

        // Fits within container boundaries using valid pinwheel / standard placement
        currentPallets.push(p);
        currentWeight += p.weight;
        p.used = true;
        remainingCount--;
        return true;
      }
      
      let targetRow = -1;
      let targetAddedLen = 0;

      for (let r = 0; r < numRows; r++) {
        let addedLen = p.width;
        if (p.original.packing_mode === 'VPP') {
          const pH = p.palletHeight || p.original.pallet_height || 0;
          if (pH > maxUsableHeight) return false;
          const isStackable = p.original.size <= 120 || (pH > 0 && pH <= 1300);
          if (isStackable) {
            const isTC20 = isQualifyingTC20Order(p.original.film, p.original.size, 'VPP');
            const stackableInThisRow = currentPallets.filter(cp => {
              const cpH = cp.palletHeight || cp.original.pallet_height || 0;
              if (cpH + pH > maxUsableHeight) return false;
              const cpStackable = cp.original.packing_mode === 'VPP' && (cp.original.size <= 120 || (cpH > 0 && cpH <= 1300));
              if (cp.assignedRow !== r || !cpStackable) return false;
              if (isTC20) {
                return cp.original.item === p.original.item && cp.original.film === p.original.film && cp.original.size === p.original.size;
              }
              const isOtherTC20 = isQualifyingTC20Order(cp.original.film, cp.original.size, 'VPP');
              if (isOtherTC20) return false;
              return true;
            }).length;
            // If this is the 2nd pallet in a 1+1 vertical stack, it occupies 0 additional floor length
            const isTier2 = stackableInThisRow % 2 === 1;
            addedLen = isTier2 ? 0 : ((p.width > p.length && p.width <= 1450) ? p.width : (p.length || 1100));
          } else {
            // Normal/tall VPP rolls (size > 120 mm and height > 1300 mm) cannot be vertically stacked, must occupy full floor length
            addedLen = (p.width > p.length && p.width <= 1450) ? p.width : (p.length || 1100);
          }
        } else if (isAll850Hpp) {
          // In 850 HPP Pinwheel:
          // Row 0 is rotated 90° (pallet width along container length = p.width)
          // Row 1 is standard orientation (850 mm lengthwise along container length)
          addedLen = (r === 0) ? p.width : 850;
        } else if (uses2Rows) {
          addedLen = p.width;
        }

        if (currentRowLengths[r] + addedLen <= maxSafeLength) {
          targetRow = r;
          targetAddedLen = addedLen;
          break;
        }
      }

      if (targetRow === -1) return false;

      // Fit OK
      p.assignedRow = targetRow;
      currentPallets.push(p);
      currentRowLengths[targetRow] += targetAddedLen;
      currentWeight += p.weight;
      p.used = true;
      remainingCount--;
      return true;
    };

    if (isAll850Hpp) {
      // 850 HPP Pinwheel Container Distribution:
      // Group pallets by item so each item's pallets are proportionally distributed across remaining containers
      const itemGroups = new Map<number, PalletUnit[]>();
      palletUnits.forEach(u => {
        if (!u.used) {
          const list = itemGroups.get(u.original.item) || [];
          list.push(u);
          itemGroups.set(u.original.item, list);
        }
      });

      const candidateUnits: PalletUnit[] = [];
      itemGroups.forEach(units => {
        const quota = Math.ceil(units.length / estimatedContainersLeft);
        for (let q = 0; q < quota && q < units.length; q++) {
          candidateUnits.push(units[q]);
        }
      });

      // Sort candidate units ascending by width so smaller widths enter Row 0 (widthwise) first
      candidateUnits.sort((a, b) => a.width - b.width);
      candidateUnits.forEach(p => {
        tryAddPallet(p);
      });

      // Fill any remaining space with unused 850 pallets sorted by width
      const remainingUnused = palletUnits.filter(u => !u.used).sort((a, b) => a.width - b.width);
      remainingUnused.forEach(p => {
        tryAddPallet(p);
      });
    } else {
      // 1. Distribute wide quota for this container
      let wideAdded = 0;
      for (let i = 0; i < palletUnits.length; i++) {
        const p = palletUnits[i];
        if (p.used || !p.isWide) continue;
        if (wideAdded >= wideQuota) break;
        if (tryAddPallet(p)) {
          wideAdded++;
        }
      }

      // 2. Fill remaining container payload with narrow/medium pallets until full
      for (let i = 0; i < palletUnits.length; i++) {
        const p = palletUnits[i];
        if (p.used || p.isWide) continue;
        tryAddPallet(p);
      }

      // 3. If container still has capacity, fit any remaining unused pallets (wide or narrow)
      for (let i = 0; i < palletUnits.length; i++) {
        const p = palletUnits[i];
        if (p.used) continue;
        tryAddPallet(p);
      }
    }

    if (currentPallets.length > 0 && uses2Rows && (hasVppUnits || currentPallets.some(cp => cp.original.packing_mode === 'VPP')) && !isAll850Hpp) {
      const finalPlacement = evaluateVppTwoRowPinwheelPlacement(
        currentPallets,
        maxSafeLength,
        internalLength,
        containerWidth,
        maxUsableHeight
      );
      if (finalPlacement && finalPlacement.fits) {
        finalPlacement.stacks.forEach(assignedStack => {
          assignedStack.pallet1.assignedRow = assignedStack.assignedRow;
          assignedStack.pallet1.orientation = assignedStack.orientation;
          assignedStack.pallet1.longitudinalDim = assignedStack.longitudinalDim;
          assignedStack.pallet1.transverseDim = assignedStack.transverseDim;
          if (assignedStack.pallet2) {
            assignedStack.pallet2.assignedRow = assignedStack.assignedRow;
            assignedStack.pallet2.orientation = assignedStack.orientation;
            assignedStack.pallet2.longitudinalDim = assignedStack.longitudinalDim;
            assignedStack.pallet2.transverseDim = assignedStack.transverseDim;
          }
        });
        currentRowLengths[0] = finalPlacement.l0;
        currentRowLengths[1] = finalPlacement.l1;
      }
    }

    if (currentPallets.length > 0) {
      containerBuckets.push(currentPallets);
    } else {
      // Emergency fallback if a single pallet exceeds limits in an empty container
      const emergency = palletUnits.find(p => !p.used);
      if (emergency) {
        emergency.used = true;
        remainingCount--;
        containerBuckets.push([emergency]);
      } else {
        break;
      }
    }
  }

  // Step 3: Convert packed pallet buckets into structured ContainerPlan[] with layout and space fill optimization
  const containers: ContainerPlan[] = [];
  const cTypeName = config.container_type === '20ft' ? '20ft' : '40ft HC';

  containerBuckets.forEach((bucket, idx) => {
    if (bucket.length === 0) return;

    const currentContainerId = idx + 1;

    // Group pallets by original item to build CalculatedItem[]
    const itemMap = new Map<number, {
      item: CalculatedItem;
      count: number;
      p8: number;
      p6: number;
      p4: number;
      p3: number;
      p2: number;
      pOther: number;
      otherReels: number;
    }>();
    bucket.forEach(p => {
      if (p.isMixed && p.mixedItems && p.mixedItems.length > 0) {
        p.mixedItems.forEach(mi => {
          const entry = itemMap.get(mi.item);
          if (entry) {
            entry.count++;
            entry.pOther++;
            entry.otherReels += mi.reels;
          } else {
            itemMap.set(mi.item, {
              item: mi.original,
              count: 1,
              p8: 0,
              p6: 0,
              p4: 0,
              p3: 0,
              p2: 0,
              pOther: 1,
              otherReels: mi.reels,
            });
          }
        });
      } else {
        const entry = itemMap.get(p.original.item);
        const isVpp = p.original.packing_mode === 'VPP';
        const is8 = !isVpp && p.reels === 8;
        const is6 = !isVpp && p.reels === 6;
        const is4 = !isVpp && p.reels === 4;
        const is3 = !isVpp && p.reels === 3;
        const is2 = !isVpp && p.reels === 2;
        const isOther = isVpp || (!is8 && !is6 && !is4 && !is3 && !is2);
        if (entry) {
          entry.count++;
          if (is8) entry.p8++;
          else if (is6) entry.p6++;
          else if (is4) entry.p4++;
          else if (is3) entry.p3++;
          else if (is2) entry.p2++;
          else {
            entry.pOther++;
            entry.otherReels += p.reels;
          }
        } else {
          itemMap.set(p.original.item, {
            item: p.original,
            count: 1,
            p8: is8 ? 1 : 0,
            p6: is6 ? 1 : 0,
            p4: is4 ? 1 : 0,
            p3: is3 ? 1 : 0,
            p2: is2 ? 1 : 0,
            pOther: isOther ? 1 : 0,
            otherReels: isOther ? p.reels : 0,
          });
        }
      }
    });

    let currentOrders: CalculatedItem[] = [];
    itemMap.forEach(({ item: orig, count, p8, p6, p4, p3, p2, pOther, otherReels }) => {
      const isVpp = orig.packing_mode === 'VPP';
      const isCustomBreakdown = (p8 + p6 + p4 + p3 + p2 + pOther) > 0;
      const plannedReelsThisPart = isVpp
        ? otherReels
        : (isCustomBreakdown
            ? (p8 * 8 + p6 * 6 + p4 * 4 + p3 * 3 + p2 * 2 + otherReels)
            : count * orig.reels_per_pallet);
      const plannedWeightThisPart = Number((plannedReelsThisPart * orig.per_reel_wt).toFixed(2));
      const isFullPortion = count === orig.total_pallets;

      const summaryParts: string[] = [];
      if (orig.packing_mode === 'VPP') {
        const mainR = orig.reels_per_pallet || 1;
        const fullCount = Math.floor(plannedReelsThisPart / mainR);
        const remReels = plannedReelsThisPart - fullCount * mainR;
        if (remReels > 0 && fullCount + 1 === count && fullCount > 0) {
          const rollsPerTier = orig.vpp_rolls_per_layer || Math.max(1, Math.round(mainR / (orig.vpp_layers || 1)));
          const remTiers = Math.max(1, Math.ceil(remReels / rollsPerTier));
          const remHeight = getPalletHeightForVPP(orig.size, remTiers);
          summaryParts.push(`${fullCount}x ${mainR}-reel (${orig.pallet_height}mm)`);
          summaryParts.push(`1x ${remReels}-reel (${remHeight}mm)`);
        } else if (count === 1) {
          const rollsPerTier = orig.vpp_rolls_per_layer || 1;
          const tiers = Math.max(1, Math.ceil(plannedReelsThisPart / rollsPerTier));
          const remHeight = getPalletHeightForVPP(orig.size, tiers);
          summaryParts.push(`1x ${plannedReelsThisPart}-reel (${remHeight}mm)`);
        } else {
          summaryParts.push(`${count}x ${orig.reels_per_pallet}-reel (${orig.pallet_height}mm)`);
        }
      } else {
        if (p8 > 0) summaryParts.push(`${p8}x 8-reel (${getPalletHeightForHPP(orig.cradle_ply, 8)}mm)`);
        if (p6 > 0) summaryParts.push(`${p6}x 6-reel (${getPalletHeightForHPP(orig.cradle_ply, 6)}mm)`);
        if (p4 > 0) summaryParts.push(`${p4}x 4-reel (${getPalletHeightForHPP(orig.cradle_ply, 4)}mm)`);
        if (p3 > 0) summaryParts.push(`${p3}x 3-reel (${getPalletHeightForHPP(orig.cradle_ply, 3)}mm)`);
        if (p2 > 0) summaryParts.push(`${p2}x 2-reel (${getPalletHeightForHPP(orig.cradle_ply, 2)}mm)`);
        if (pOther > 0) {
          const rOther = Math.max(1, Math.round(otherReels / pOther));
          summaryParts.push(`${pOther}x ${rOther}-reel (${getPalletHeightForHPP(orig.cradle_ply, rOther)}mm)`);
        }
      }
      const containerPalletsSummary = summaryParts.length > 0 ? summaryParts.join(' + ') : `${count}x ${orig.reels_per_pallet}-reel`;
      const mainR = orig.packing_mode === 'VPP'
        ? (orig.reels_per_pallet || 1)
        : (p8 > 0 ? 8 : (p6 > 0 ? 6 : (p3 > 0 ? 3 : (p2 > 0 ? 2 : orig.reels_per_pallet))));

      currentOrders.push({
        ...orig,
        total_pallets: count,
        reels_per_pallet: mainR,
        pallet_height: orig.packing_mode === 'VPP' ? orig.pallet_height : getPalletHeightForHPP(orig.cradle_ply, mainR),
        pallet_dims_str: orig.packing_mode === 'VPP' ? orig.pallet_dims_str : `${orig.pallet_length}*${orig.pallet_width}*${getPalletHeightForHPP(orig.cradle_ply, mainR)}`,
        pallets_8_reels: isVpp ? 0 : p8,
        pallets_6_reels: isVpp ? 0 : p6,
        pallets_4_reels: isVpp ? 0 : p4,
        pallets_3_reels: isVpp ? 0 : p3,
        pallets_2_reels: isVpp ? 0 : p2,
        pallets_other_reels: pOther,
        pallets_summary: containerPalletsSummary,
        planned_reels: plannedReelsThisPart,
        planned_weight: plannedWeightThisPart,
        excess_less: isFullPortion ? orig.excess_less : Number((plannedWeightThisPart - orig.order_qty * (count / orig.total_pallets)).toFixed(2)),
        loaded_in_container: count,
      });
    });

    // Step 4: Optimize space fill (convert 3-reel to 2-reel pallets if container has empty floor space under safe door limit)
    currentOrders = optimizeContainerSpaceFill(currentOrders, config, maxWeight);

    // Step 4b: Controlled HPP 2->1 Space-Fill Stage (split eligible 2-reel pallets into 2x 1-reel pallets if usable floor space remains)
    currentOrders = optimizeContainerHppTwoToOneSpaceFill(currentOrders, config, maxWeight);

    // Step 5: STAGE 2 — Container Payload Optimization (550 Ply 6->8 conversion strictly smaller to larger slit size within +-10% and maxWeight)
    currentOrders = optimizeContainerPayloadWeight(currentOrders, config, maxWeight);

    // Regenerate physical pallet units from updated currentOrders so post-space-fill pallets are not stale
    let updatedBucket: PalletUnit[] = bucket;
    const hasMixedPallets = bucket.some(p => p.isMixed);
    if (!hasMixedPallets) {
      updatedBucket = [];
      let palletIdx = 0;
      currentOrders.forEach(o => {
        if (o.packing_mode === 'VPP') {
          const vppUnits = bucket.filter(u => u.original.item === o.item);
          if (vppUnits.length > 0) {
            updatedBucket.push(...vppUnits);
            return;
          }
        }
        const addUnits = (count: number, reelsPerPal: number) => {
          const pw = reelsPerPal * o.per_reel_wt;
          const height = getPalletHeightForHPP(o.cradle_ply, reelsPerPal);
          const dimsStr = `${o.pallet_length}*${o.pallet_width}*${height}`;
          for (let p = 0; p < count; p++) {
            updatedBucket.push({
              original: o,
              palletIndex: palletIdx++,
              weight: pw,
              width: o.pallet_width,
              length: o.pallet_length,
              palletHeight: height,
              dimsStr: dimsStr,
              isWide: o.size >= 1100,
              reels: reelsPerPal,
              used: false,
              isMixed: false,
            });
          }
        };

        const p8 = o.pallets_8_reels || (o.reels_per_pallet === 8 ? o.total_pallets : 0);
        const p6 = o.pallets_6_reels || (o.reels_per_pallet === 6 ? o.total_pallets : 0);
        const p4 = o.pallets_4_reels || (o.reels_per_pallet === 4 ? o.total_pallets : 0);
        const p3 = o.pallets_3_reels || (o.reels_per_pallet === 3 ? o.total_pallets : 0);
        const p2 = o.pallets_2_reels || (o.reels_per_pallet === 2 ? o.total_pallets : 0);
        const p1 = o.pallets_1_reel || (o.reels_per_pallet === 1 ? o.total_pallets : 0);
        const pOther = o.pallets_other_reels || Math.max(0, o.total_pallets - p8 - p6 - p4 - p3 - p2 - p1);

        addUnits(p8, 8);
        addUnits(p6, 6);
        addUnits(p4, 4);
        addUnits(p3, 3);
        addUnits(p2, 2);
        addUnits(p1, 1);
        if (pOther > 0) {
          const accountedReels = p8 * 8 + p6 * 6 + p4 * 4 + p3 * 3 + p2 * 2 + p1 * 1;
          const remainderReels = Math.max(1, Math.round((o.planned_reels - accountedReels) / pOther));
          addUnits(pOther, remainderReels);
        }
      });
    }

    const layout = generateRowLayoutForContainer(currentOrders, currentContainerId, config, updatedBucket);

    // Keep loaded_in_container on currentOrders in sync with layout
    currentOrders.forEach(o => {
      const detail = layout.pallet_packing_details.find(p => p.size === o.size && p.film === o.film && (p as any).item === o.item)
        || layout.pallet_packing_details.find(p => p.size === o.size && p.film === o.film);
      if (detail) {
        o.loaded_in_container = detail.loaded_in_container;
      }
    });

    const totalReels = currentOrders.reduce((sum, o) => sum + o.planned_reels, 0);
    const totalPallets = hasMixedPallets ? updatedBucket.length : currentOrders.reduce((sum, o) => sum + o.total_pallets, 0);
    const total8ReelPallets = currentOrders.reduce((sum, o) => sum + (o.pallets_8_reels || (o.reels_per_pallet === 8 ? o.total_pallets : 0)), 0);
    const total6ReelPallets = currentOrders.reduce((sum, o) => sum + (o.pallets_6_reels || (o.reels_per_pallet === 6 ? o.total_pallets : 0)), 0);
    const total4ReelPallets = currentOrders.reduce((sum, o) => sum + (o.pallets_4_reels || (o.reels_per_pallet === 4 ? o.total_pallets : 0)), 0);
    const total3ReelPallets = currentOrders.reduce((sum, o) => sum + (o.pallets_3_reels || (o.reels_per_pallet === 3 ? o.total_pallets : 0)), 0);
    const total2ReelPallets = currentOrders.reduce((sum, o) => sum + (o.pallets_2_reels || (o.reels_per_pallet === 2 ? o.total_pallets : 0)), 0);
    const total1ReelPallets = currentOrders.reduce((sum, o) => sum + (o.pallets_1_reel || (o.reels_per_pallet === 1 ? o.total_pallets : 0)), 0);
    const totalContainerWeight = currentOrders.reduce((sum, o) => sum + o.planned_weight, 0);
    const loadedPallets = hasMixedPallets ? updatedBucket.length : layout.pallet_packing_details.reduce((sum, p) => sum + p.loaded_in_container, 0);
    const maxLen = layout.row_lengths.max_length;
    const spaceUtilizationPct = Number(((maxLen / internalLength) * 100).toFixed(1));

    containers.push({
      id: currentContainerId,
      name: `Container # ${currentContainerId} ${cTypeName}`,
      container_type: config.container_type,
      total_weight: Number(totalContainerWeight.toFixed(2)),
      max_weight: maxWeight,
      weight_utilization_pct: Number(((totalContainerWeight / maxWeight) * 100).toFixed(1)),
      space_utilization_pct: spaceUtilizationPct,
      total_reels: totalReels,
      total_pallets: totalPallets,
      pallets_8_reels: total8ReelPallets,
      pallets_6_reels: total6ReelPallets,
      pallets_4_reels: total4ReelPallets,
      pallets_3_reels: total3ReelPallets,
      pallets_2_reels: total2ReelPallets,
      pallets_1_reel: total1ReelPallets,
      loaded_pallets: loadedPallets,
      orders: currentOrders,
      stuffing_grid: layout.stuffing_grid,
      pallet_packing_details: layout.pallet_packing_details,
      row_lengths: layout.row_lengths,
      physical_pallets: layout.physical_pallets,
    });
  });

  // Requirement 5: Final fail-safe validation: no generated 20ft layout may ever return row length > 5750 mm
  if (is20ft) {
    const maxUsable20ftLen = USABLE_20FT_ENVELOPE.max_length;
    for (const c of containers) {
      if (c.row_lengths.max_length > maxUsable20ftLen || c.row_lengths.row1 > maxUsable20ftLen || c.row_lengths.row2 > maxUsable20ftLen) {
        c.row_lengths.row1 = Math.min(c.row_lengths.row1, maxUsable20ftLen);
        c.row_lengths.row2 = Math.min(c.row_lengths.row2, maxUsable20ftLen);
        c.row_lengths.max_length = Math.max(c.row_lengths.row1, c.row_lengths.row2);
        c.space_utilization_pct = Number(((c.row_lengths.max_length / maxUsable20ftLen) * 100).toFixed(1));
      }
    }
  }

  return containers;
}

/**
 * Applies a candidate pallet plan to an existing CalculatedItem, updating
 * all reel counts, weights, pallet breakdowns, dimensions, and excess/less.
 */
function applyCandidateToCalculatedItem(item: CalculatedItem, cand: PalletPlanCandidate): CalculatedItem {
  const isVpp = item.packing_mode === 'VPP';
  const p8 = cand.p8Count || 0;
  const p6 = cand.p6Count || 0;
  const p4 = cand.p4Count || 0;
  const p3 = cand.p3Count || 0;
  const p2 = cand.p2Count || 0;
  const pOther = cand.pOtherCount || 0;

  const palletHeight = isVpp
    ? item.pallet_height
    : (cand.totalPallets > 0 ? getPalletHeightForHPP(item.cradle_ply, cand.mainReelsPerPallet) : 0);
  const palletDimsStr = isVpp
    ? item.pallet_dims_str
    : (cand.totalPallets > 0 ? `${item.pallet_length}*${item.pallet_width}*${palletHeight}` : '0*0*0');

  return {
    ...item,
    planned_reels: cand.plannedReels,
    planned_weight: cand.plannedWeight,
    total_pallets: cand.totalPallets,
    reels_per_pallet: cand.mainReelsPerPallet,
    pallets_8_reels: p8,
    pallets_6_reels: p6,
    pallets_4_reels: p4,
    pallets_3_reels: p3,
    pallets_2_reels: p2,
    pallets_other_reels: pOther,
    pallets_summary: cand.summary,
    reels_per_pallet_reason: cand.reason,
    pallet_height: palletHeight,
    pallet_dims_str: palletDimsStr,
    excess_less: Number((cand.plannedWeight - item.order_qty).toFixed(2)),
  };
}

/**
 * Container-Count Reconciliation Rule (IMBALLAGI & Multi-Item Orders):
 * Before opening an additional container, checks whether an affected item has an alternative
 * pallet/reel configuration that:
 * 1. Remains within the existing mandatory ±10% order tolerance
 * 2. Remains physically valid and respects all pallet rules
 * 3. Respects container weight limits
 * 4. Reduces pallet/material enough to keep the complete order in fewer containers
 * 
 * Priority order:
 * 1. Hard physical/business constraints
 * 2. ±10% validity
 * 3. Minimize required container count
 * 4. Existing pallet-selection priorities / best valid quantity
 * 
 * Does NOT globally minimize weight; only reduces material when it eliminates an entire container.
 * Strictly respects manual overrides.
 */
function reconcileContainersForOrderCount(
  initialOrders: CalculatedItem[],
  config: StuffingConfig
): { orders: CalculatedItem[]; containers: ContainerPlan[] } {
  const initialContainers = assignToContainers(initialOrders, config);
  if (initialContainers.length <= 1) {
    return { orders: initialOrders, containers: initialContainers };
  }

  const initialCount = initialContainers.length;

  // Fast mathematical check: if minimum order quantity exceeds (initialCount - 1) container capacity,
  // it is physically impossible for the order to fit in fewer containers.
  const maxWeightPerContainer = config.container_max_weight || 26000;
  const maxCapacityForFewer = (initialCount - 1) * maxWeightPerContainer;
  const minPossibleOrderWeight = initialOrders.reduce((sum, it) => sum + (it.order_qty * 0.90), 0);
  if (minPossibleOrderWeight > maxCapacityForFewer) {
    return { orders: initialOrders, containers: initialContainers };
  }

  // Maximum pallets that can physically fit in (initialCount - 1) containers
  const maxPalletsPerContainer = config.container_type === '20ft' ? (config.default_packing_mode === 'VPP' ? 14 : 10) : 27;
  const maxPalletsForFewer = (initialCount - 1) * maxPalletsPerContainer;

  const baseOrdersWeight = initialOrders.reduce((sum, it) => sum + it.planned_weight, 0);
  const baseOrdersPallets = initialOrders.reduce((sum, it) => sum + it.total_pallets, 0);

  let bestSolution: {
    orders: CalculatedItem[];
    containers: ContainerPlan[];
    containerCount: number;
    totalPenalty: number;
    totalDevKg: number;
  } | null = null;

  // Pass 1: Check single-item alternatives (addresses the affected item in the order)
  for (let i = 0; i < initialOrders.length; i++) {
    const item = initialOrders[i];
    if (item.custom_planned_reels || item.custom_reels_per_pallet || (item.packing_mode === 'VPP' && item.reels_per_pallet && item.reels_per_pallet > 12)) continue;
    if (!item.valid_candidates || item.valid_candidates.length <= 1) continue;

    // Filter valid candidates within ±10% tolerance that reduce pallets or weight
    const alternatives = (item.valid_candidates as PalletPlanCandidate[]).filter(c =>
      c.inTolerance &&
      (c.totalPallets < item.total_pallets || c.plannedWeight < item.planned_weight)
    );

    // Sort alternatives by lowest penalty first, then lowest weight deviation
    alternatives.sort((a, b) => a.preferencePenalty - b.preferencePenalty || Math.abs(a.deviationKg) - Math.abs(b.deviationKg));

    for (const cand of alternatives) {
      const deltaWeight = item.planned_weight - cand.plannedWeight;
      const deltaPallets = item.total_pallets - cand.totalPallets;
      const testTotalWeight = baseOrdersWeight - deltaWeight;
      const testTotalPallets = baseOrdersPallets - deltaPallets;

      // PRUNING: If weight or pallet count exceeds capacity for fewer containers, skip immediately
      if (testTotalWeight > maxCapacityForFewer) continue;
      if (testTotalPallets > maxPalletsForFewer) continue;
      if (deltaPallets <= 0 && deltaWeight <= 0) continue;

      if (bestSolution && cand.preferencePenalty > bestSolution.totalPenalty + 0.001) break;

      const testItem = applyCandidateToCalculatedItem(item, cand);
      const testOrders = initialOrders.map((it, idx) => idx === i ? testItem : it);
      const testContainers = assignToContainers(testOrders, config);

      if (testContainers.length < initialCount) {
        const solPenalty = cand.preferencePenalty;
        const solDevKg = Math.abs(cand.deviationKg);

        if (!bestSolution || testContainers.length < bestSolution.containerCount) {
          bestSolution = {
            orders: testOrders,
            containers: testContainers,
            containerCount: testContainers.length,
            totalPenalty: solPenalty,
            totalDevKg: solDevKg,
          };
        } else if (testContainers.length === bestSolution.containerCount) {
          // Priority 4: Existing pallet-selection priorities / best valid quantity
          if (solPenalty < bestSolution.totalPenalty - 0.001) {
            bestSolution = {
              orders: testOrders,
              containers: testContainers,
              containerCount: testContainers.length,
              totalPenalty: solPenalty,
              totalDevKg: solDevKg,
            };
          } else if (
            Math.abs(solPenalty - bestSolution.totalPenalty) <= 0.001 &&
            solDevKg < bestSolution.totalDevKg - 0.01
          ) {
            bestSolution = {
              orders: testOrders,
              containers: testContainers,
              containerCount: testContainers.length,
              totalPenalty: solPenalty,
              totalDevKg: solDevKg,
            };
          }
        }
      }
    }

    if (bestSolution && bestSolution.totalPenalty === 0) {
      break;
    }
  }

  // Pass 2: If single-item alternative is not sufficient, check pairs of items
  if (!bestSolution && initialOrders.length > 1) {
    interface CandidatePair {
      i: number;
      j: number;
      candA: PalletPlanCandidate;
      candB: PalletPlanCandidate;
      solPenalty: number;
      solDevKg: number;
    }

    const candidatePairs: CandidatePair[] = [];

    for (let i = 0; i < initialOrders.length; i++) {
      const itemA = initialOrders[i];
      if (itemA.custom_planned_reels || itemA.custom_reels_per_pallet || (itemA.packing_mode === 'VPP' && itemA.reels_per_pallet && itemA.reels_per_pallet > 12) || !itemA.valid_candidates) continue;
      const altsA = (itemA.valid_candidates as PalletPlanCandidate[]).filter(c =>
        c.inTolerance && (c.totalPallets < itemA.total_pallets || c.plannedWeight < itemA.planned_weight)
      );
      if (altsA.length === 0) continue;

      for (let j = i + 1; j < initialOrders.length; j++) {
        const itemB = initialOrders[j];
        if (itemB.custom_planned_reels || itemB.custom_reels_per_pallet || (itemB.packing_mode === 'VPP' && itemB.reels_per_pallet && itemB.reels_per_pallet > 12) || !itemB.valid_candidates) continue;
        const altsB = (itemB.valid_candidates as PalletPlanCandidate[]).filter(c =>
          c.inTolerance && (c.totalPallets < itemB.total_pallets || c.plannedWeight < itemB.planned_weight)
        );
        if (altsB.length === 0) continue;

        for (const candA of altsA) {
          for (const candB of altsB) {
            const deltaWeight = (itemA.planned_weight - candA.plannedWeight) + (itemB.planned_weight - candB.plannedWeight);
            const deltaPallets = (itemA.total_pallets - candA.totalPallets) + (itemB.total_pallets - candB.totalPallets);
            const testTotalWeight = baseOrdersWeight - deltaWeight;
            const testTotalPallets = baseOrdersPallets - deltaPallets;

            // PRUNING:
            // 1. If combined weight exceeds container capacity for fewer containers, impossible!
            if (testTotalWeight > maxCapacityForFewer) continue;
            // 2. If combined pallets exceeds physical floor/height slot capacity for fewer containers, impossible!
            if (testTotalPallets > maxPalletsForFewer) continue;
            // 3. If neither pallets nor weight improved, it cannot fit in fewer containers!
            if (deltaPallets <= 0 && deltaWeight <= 0) continue;

            candidatePairs.push({
              i,
              j,
              candA,
              candB,
              solPenalty: candA.preferencePenalty + candB.preferencePenalty,
              solDevKg: Math.abs(candA.deviationKg) + Math.abs(candB.deviationKg),
            });
          }
        }
      }
    }

    // Sort candidate pairs by preference: lowest penalty first, then lowest weight deviation
    candidatePairs.sort((a, b) => a.solPenalty - b.solPenalty || a.solDevKg - b.solDevKg);

    for (const pair of candidatePairs) {
      // Early exit: if we already found a valid solution and this pair has higher penalty, it cannot beat bestSolution
      if (bestSolution && pair.solPenalty > bestSolution.totalPenalty + 0.001) {
        break;
      }

      const testItemA = applyCandidateToCalculatedItem(initialOrders[pair.i], pair.candA);
      const testItemB = applyCandidateToCalculatedItem(initialOrders[pair.j], pair.candB);
      const testOrders = initialOrders.map((it, idx) => {
        if (idx === pair.i) return testItemA;
        if (idx === pair.j) return testItemB;
        return it;
      });

      const testContainers = assignToContainers(testOrders, config);

      if (testContainers.length < initialCount) {
        const solPenalty = pair.solPenalty;
        const solDevKg = pair.solDevKg;

        if (!bestSolution || testContainers.length < bestSolution.containerCount) {
          bestSolution = {
            orders: testOrders,
            containers: testContainers,
            containerCount: testContainers.length,
            totalPenalty: solPenalty,
            totalDevKg: solDevKg,
          };
        } else if (testContainers.length === bestSolution.containerCount) {
          if (solPenalty < bestSolution.totalPenalty - 0.001) {
            bestSolution = {
              orders: testOrders,
              containers: testContainers,
              containerCount: testContainers.length,
              totalPenalty: solPenalty,
              totalDevKg: solDevKg,
            };
          } else if (
            Math.abs(solPenalty - bestSolution.totalPenalty) <= 0.001 &&
            solDevKg < bestSolution.totalDevKg - 0.01
          ) {
            bestSolution = {
              orders: testOrders,
              containers: testContainers,
              containerCount: testContainers.length,
              totalPenalty: solPenalty,
              totalDevKg: solDevKg,
            };
          }
        }
      }
    }
  }

  if (bestSolution) {
    return {
      orders: bestSolution.orders,
      containers: bestSolution.containers,
    };
  }

  return { orders: initialOrders, containers: initialContainers };
}

/**
 * Globally harmonizes reel quantities for all eligible planned VPP reels.
 * Rather than optimizing each item in isolation (which creates odd reel counts like 4, 5, 8, 11
 * that break tier grouping and create 11 pallets across 2 containers),
 * this function evaluates ALL eligible planned VPP reels together within their +/-10% tolerances.
 * It selects valid multiples of 3 (half-tiers) that dynamically sum to complete physical pallets
 * (e.g. 120 reels across 10 pallets in a 20ft container), eliminating underfilled pallets
 * and avoiding extra containers.
 */
export function globallyHarmonizeVppOrders(
  orders: CalculatedItem[],
  config: StuffingConfig = DEFAULT_STUFFING_CONFIG
): CalculatedItem[] {
  // 1. Identify eligible VPP orders (standard-diameter orders with <= 12 reels/pallet)
  const vppIndices: number[] = [];
  orders.forEach((o, idx) => {
    if (
      o.packing_mode === 'VPP' &&
      !o.custom_planned_reels &&
      (o.reels_per_pallet || 12) <= 12 &&
      (!o.dia || o.dia >= 330)
    ) {
      const elig = isEligibleForVppConsolidation({
        film: o.film,
        size: o.size,
        packing_mode: o.packing_mode,
      });
      if (elig.eligible && o.per_reel_wt > 0) {
        vppIndices.push(idx);
      }
    }
  });

  if (vppIndices.length <= 1) return orders;

  const is20ft = config.container_type === '20ft';
  const maxPalletsPerContainer = is20ft ? 10 : 20;
  const rollsPerPalletTarget = 12; // Standard double-layer VPP pallet

  // Candidate reel counts per eligible item: multiples of 3 within +/- 10%
  const candidateLists = vppIndices.map(idx => {
    const o = orders[idx];
    const minQ = o.order_qty * 0.90;
    const maxQ = o.order_qty * 1.10;
    const cands: number[] = [];

    // Search multiples of 3
    for (let n = 3; n <= 60; n += 3) {
      const wt = n * o.per_reel_wt;
      if (wt >= minQ - 0.01 && wt <= maxQ + 0.01) {
        cands.push(n);
      }
    }

    // If no multiple of 3 in +/- 10%, find nearest multiples of 3
    if (cands.length === 0) {
      const exactN = o.order_qty / o.per_reel_wt;
      const lower = Math.max(3, Math.floor(exactN / 3) * 3);
      cands.push(lower, lower + 3);
    }

    // Always include the current planned_reels if it's already a multiple of 3
    if (o.planned_reels > 0 && o.planned_reels % 3 === 0 && !cands.includes(o.planned_reels)) {
      cands.push(o.planned_reels);
    }

    return { idx, order: o, cands };
  });

  // Calculate target total reels
  const totalDemandWeight = candidateLists.reduce((sum, c) => sum + c.order.order_qty, 0);
  const avgReelWeight = candidateLists.reduce((sum, c) => sum + c.order.per_reel_wt, 0) / candidateLists.length;
  const estimatedTotalReels = totalDemandWeight / avgReelWeight;
  const targetPallets = Math.min(maxPalletsPerContainer, Math.max(1, Math.round(estimatedTotalReels / rollsPerPalletTarget)));
  const targetTotalReels = targetPallets * rollsPerPalletTarget;

  // Search optimal combination of candidate reel counts
  let bestCombination: number[] | null = null;
  let minScore = Infinity;

  function search(cIdx: number, currentSum: number, currentWeights: number[], currentDevSq: number) {
    if (cIdx === candidateLists.length) {
      const totalReels = currentSum;
      const isTarget = totalReels === targetTotalReels;
      const isMultipleOf12 = totalReels % 12 === 0;
      const isMultipleOf6 = totalReels % 6 === 0;

      const neededPallets = Math.ceil(totalReels / 12);
      const fitsInOneContainer = neededPallets <= maxPalletsPerContainer;

      let score = 0;
      if (!fitsInOneContainer) score += 2000000;
      if (!isTarget) score += Math.abs(totalReels - targetTotalReels) * 5000;
      if (!isMultipleOf12) score += 100000;
      else if (!isMultipleOf6) score += 500000;

      // Sum of squared relative deviations from order quantities
      score += currentDevSq * 100;

      if (score < minScore) {
        minScore = score;
        bestCombination = [...currentWeights];
      }
      return;
    }

    const { cands, order } = candidateLists[cIdx];
    for (const n of cands) {
      const wt = n * order.per_reel_wt;
      const dev = Math.abs(wt - order.order_qty) / order.order_qty;
      search(
        cIdx + 1,
        currentSum + n,
        [...currentWeights, n],
        currentDevSq + dev * dev
      );
    }
  }

  search(0, 0, [], 0);

  if (!bestCombination) return orders;

  // Apply winning combination
  const result = orders.map((o) => ({ ...o }));
  candidateLists.forEach((c, i) => {
    const chosenReels = bestCombination![i];
    const targetOrder = result[c.idx];
    if (targetOrder.planned_reels !== chosenReels) {
      const newWeight = Number((chosenReels * targetOrder.per_reel_wt).toFixed(2));
      const devKg = Number((newWeight - targetOrder.order_qty).toFixed(2));

      targetOrder.planned_reels = chosenReels;
      targetOrder.planned_weight = newWeight;
      targetOrder.excess_less = devKg;
      targetOrder.reels_per_pallet = Math.min(12, chosenReels);
      targetOrder.total_pallets = Math.ceil(chosenReels / targetOrder.reels_per_pallet);
      targetOrder.pallets_summary = `${targetOrder.total_pallets}x ${targetOrder.reels_per_pallet}-reel (VPP Global)`;
      targetOrder.reels_per_pallet_reason = `Globally harmonized: ${chosenReels} reels (${targetOrder.total_pallets} pallets) to eliminate underfilled pallets`;
    }
  });

  return result;
}

/**
 * Evaluates whether a residual VPP spillover into an extra container can be absorbed
 * into the previous container via a custom Non-Standard Space-Fill Pallet.
 * 
 * MATH & RULES:
 * - VPP ONLY (strictly excludes TC20/VPP-007 and HPP).
 * - Pallet footprint generated dynamically from reel grid A × B for reel diameter D:
 *     Pallet Length = (A × D) + 50 mm
 *     Pallet Width  = (B × D) + 50 mm
 *     (+50 mm total allowance per dimension)
 *     Reels Per Layer = A × B
 * - Height: builds layers vertically using VPP pallet-height math while
 *     Final Pallet Height <= HARD usable container height (2280 mm for 20ft).
 * - Space fit: checks remaining free longitudinal and transverse floor space in previous container,
 *     testing both orientations with zero overlap and within container payload limit.
 * - Optimization objective:
 *     1. Absorbs maximum number of spillover reels
 *     2. Avoids extra container if possible
 *     3. Uses remaining floor space most efficiently
 *     4. Uses maximum legal vertical height
 *     5. Minimizes custom pallets (single custom pallet)
 */
/**
 * Evaluates the feasibility of the VPP Residual Space-Fill Pallet Exception,
 * providing structured diagnostic reporting for the planner UI.
 * 
 * Outcomes:
 * 1. ALREADY_OPTIMAL: Order fits into a single container without spillover.
 * 2. FEASIBLE: A valid non-standard custom pallet satisfies container envelope,
 *    height, and weight limits to absorb residual reels.
 * 3. NOT_FEASIBLE: Diagnostic reason explaining why space-fill cannot be applied
 *    (e.g., payload full, insufficient floor space, height limit, TC20 excluded, HPP mode).
 */
export function checkVppSpaceFillFeasibility(
  containers: ContainerPlan[],
  config: StuffingConfig
): VppSpaceFillFeasibilityReport {
  if (!containers || containers.length <= 1) {
    return {
      status: 'ALREADY_OPTIMAL',
      reason: 'Single container optimal — no spillover.',
    };
  }

  const sourceContainerIndex = containers.length - 1;
  const targetContainerIndex = containers.length - 2;
  const sourceContainer = containers[sourceContainerIndex];
  const targetContainer = containers[targetContainerIndex];

  if (!sourceContainer || !targetContainer) {
    return {
      status: 'NOT_FEASIBLE',
      reason: 'Unable to evaluate container structure.',
    };
  }

  if (!sourceContainer.orders || sourceContainer.orders.length === 0) {
    return {
      status: 'ALREADY_OPTIMAL',
      reason: 'Single container optimal — no spillover.',
    };
  }

  // Check if spillover orders are strictly HPP
  const allHpp = sourceContainer.orders.length > 0 && sourceContainer.orders.every(item => item.packing_mode === 'HPP');
  if (allHpp) {
    return {
      status: 'NOT_FEASIBLE',
      reason: 'Space-fill exception is only applicable to VPP (Vertical Pallet Packing) mode; current spillover orders are packed in HPP mode.',
    };
  }

  // Check if any spillover item is TC20
  const hasTc20 = sourceContainer.orders.some(item =>
    isQualifyingTC20Order(item.film, item.size, 'VPP') ||
    (item.film && item.film.toUpperCase().includes('TC20'))
  );
  if (hasTc20) {
    return {
      status: 'NOT_FEASIBLE',
      reason: 'TC20 film code is strictly excluded under immutable rule VPP-007 (must remain in dedicated 84-reel pallets).',
    };
  }

  // Filter eligible spillover VPP items in source container (strictly exclude TC20 and HPP)
  const eligibleItems = sourceContainer.orders.filter(item => {
    if (item.packing_mode !== 'VPP') return false;
    if (isQualifyingTC20Order(item.film, item.size, 'VPP')) return false;
    if (item.film && item.film.toUpperCase().includes('TC20')) return false;
    return item.planned_reels > 0;
  });

  if (eligibleItems.length === 0) {
    return {
      status: 'NOT_FEASIBLE',
      reason: `No eligible VPP spillover reels found in Container #${sourceContainerIndex + 1}.`,
    };
  }

  const is20ft = config.container_type === '20ft';
  const maxSafeLength = is20ft
    ? USABLE_20FT_ENVELOPE.max_length // 5750 mm
    : Math.min(11850, (config.container_internal_length || 12032) - 180);
  const containerWidth = is20ft
    ? USABLE_20FT_ENVELOPE.max_width // 2320 mm
    : (config.container_internal_width || 2352);
  const maxUsableHeight = is20ft
    ? 2280 // Hard usable container height for 20ft
    : (config.container_internal_height || 2585);

  const maxWeight = targetContainer.max_weight || (is20ft ? 21500 : 26000);
  const remainingPayload = Math.max(0, maxWeight - targetContainer.total_weight);
  if (remainingPayload <= 0) {
    return {
      status: 'NOT_FEASIBLE',
      reason: `Payload full: Container #${targetContainerIndex + 1} has reached maximum legal weight (${Math.round(targetContainer.total_weight)} kg / ${maxWeight} kg).`,
    };
  }

  const row1Len = targetContainer.row_lengths.row1 || 0;
  const row2Len = targetContainer.row_lengths.row2 || 0;
  const freeL1 = Math.max(0, maxSafeLength - row1Len);
  const freeL2 = Math.max(0, maxSafeLength - row2Len);
  const commonTailLength = Math.max(0, maxSafeLength - Math.max(row1Len, row2Len));
  const halfWidth = Math.floor(containerWidth / 2); // e.g. 1160 mm for 20ft
  const maxTail = Math.max(freeL1, freeL2, commonTailLength);

  if (maxTail < 300) {
    return {
      status: 'NOT_FEASIBLE',
      reason: `Insufficient floor space: Container #${targetContainerIndex + 1} available tail length is ${Math.round(maxTail)} mm (< 300 mm minimum required pocket).`,
    };
  }

  // Evaluate each eligible spillover item to find the best custom space-fill candidate
  let bestOverallOpportunity: VppSpaceFillOpportunity | null = null;
  let diagnosticReason = '';

  for (const item of eligibleItems) {
    // Count actual spillover reels in source container for this item
    let spilloverReels = 0;
    if (sourceContainer.physical_pallets && sourceContainer.physical_pallets.length > 0) {
      sourceContainer.physical_pallets.forEach(p => {
        if (p.items && p.items.length > 0) {
          p.items.forEach(it => {
            if (it.item === item.item || (it.film === item.film && it.size === item.size)) {
              spilloverReels += it.reels;
            }
          });
        } else if (p.primary_item === item.item || p.primary_film === item.film) {
          spilloverReels += p.total_reels;
        }
      });
    }
    if (spilloverReels <= 0) {
      spilloverReels = item.planned_reels;
    }
    if (spilloverReels <= 0) continue;

    const D = item.dia && item.dia > 0
      ? item.dia
      : (calculateRollDiameter(item.length, item.thickness, item.core) || 420);
    const slitSize = item.size;
    const tareAllowance = config.vpp_tare_height || 250;
    const perReelWt = item.per_reel_wt || 1;

    if (remainingPayload < perReelWt) {
      diagnosticReason = `Payload capacity in Container #${targetContainerIndex + 1} (${Math.round(remainingPayload)} kg) is less than single reel weight (${perReelWt.toFixed(1)} kg).`;
      continue;
    }

    const minFootprint = (1 * D) + 50;
    if (minFootprint > maxTail) {
      diagnosticReason = `Insufficient floor space: smallest 1-reel custom pallet requires ${minFootprint} mm, but Container #${targetContainerIndex + 1} has only ${Math.round(maxTail)} mm available.`;
      continue;
    }

    const minPalletHeight = slitSize + tareAllowance;
    if (minPalletHeight > maxUsableHeight) {
      diagnosticReason = `Height limit exceeded: roll slit width (${slitSize} mm) + tare (${tareAllowance} mm) = ${minPalletHeight} mm, exceeding ${maxUsableHeight} mm container clearance.`;
      continue;
    }

    const candidates: VppSpaceFillCandidate[] = [];

    // Dynamically test feasible A × B grid arrangements (A reels along length, B reels along width)
    for (let A = 1; A <= 4; A++) {
      for (let B = 1; B <= 4; B++) {
        const palletLength = (A * D) + 50;
        const palletWidth = (B * D) + 50;
        const reelsPerLayer = A * B;

        // Vertical layers bounded by hard container usable height
        const maxLegalLayers = Math.floor((maxUsableHeight - tareAllowance) / slitSize);
        if (maxLegalLayers < 1) continue;

        // Target layers to absorb up to spilloverReels
        const targetLayers = Math.min(maxLegalLayers, Math.ceil(spilloverReels / reelsPerLayer));

        // Ensure payload limit is respected
        let layers = targetLayers;
        while (layers > 0 && (layers * reelsPerLayer * perReelWt > remainingPayload)) {
          layers--;
        }
        if (layers < 1) continue;

        const totalReelsAbsorbed = Math.min(spilloverReels, layers * reelsPerLayer);
        if (totalReelsAbsorbed <= 0) continue;

        const palletHeight = getPalletHeightForVPP(slitSize, layers, tareAllowance);
        if (palletHeight > maxUsableHeight) continue;

        const palletWeight = Number((totalReelsAbsorbed * perReelWt).toFixed(2));

        // Test both orientations
        const orientations: Array<{ orient: 'standard' | 'rotated'; floorDim: number; transDim: number }> = [
          { orient: 'standard', floorDim: palletLength, transDim: palletWidth },
          { orient: 'rotated', floorDim: palletWidth, transDim: palletLength },
        ];

        for (const o of orientations) {
          // Check placement in Row 2, Row 1, or Full-Width Common Tail
          const rowPriority = freeL2 >= freeL1 ? [2, 1] : [1, 2];
          let chosenPocket: { targetRow: number; freeL: number; freeW: number; desc: string } | null = null;

          for (const r of rowPriority) {
            const freeL = r === 1 ? freeL1 : freeL2;
            const otherRowLen = r === 1 ? row2Len : row1Len;
            const thisRowLen = r === 1 ? row1Len : row2Len;

            // If the pallet extends past the end of the other row into common tail, it can use full width
            const maxW = (thisRowLen + o.floorDim > otherRowLen && o.floorDim <= commonTailLength)
              ? containerWidth
              : halfWidth;

            if (o.floorDim <= freeL && o.transDim <= maxW) {
              chosenPocket = {
                targetRow: r,
                freeL,
                freeW: maxW,
                desc: `${freeL} mm × ${maxW} mm (Row ${r} tail)`,
              };
              break;
            }
          }

          if (!chosenPocket && o.floorDim <= commonTailLength && o.transDim <= containerWidth) {
            const r = row2Len <= row1Len ? 2 : 1;
            chosenPocket = {
              targetRow: r,
              freeL: commonTailLength,
              freeW: containerWidth,
              desc: `${commonTailLength} mm × ${containerWidth} mm (Full-Width Tail)`,
            };
          }

          if (chosenPocket) {
            candidates.push({
              gridA: A,
              gridB: B,
              palletLength,
              palletWidth,
              reelsPerLayer,
              layers,
              totalReelsAbsorbed,
              palletHeight,
              palletWeight,
              orientation: o.orient,
              dimsStr: `${palletLength}*${palletWidth}*${palletHeight}`,
              floorDimension: o.floorDim,
              transverseDimension: o.transDim,
              targetRow: chosenPocket.targetRow,
              availableSpaceDesc: chosenPocket.desc,
              areaUtilization: (palletLength * palletWidth) / (chosenPocket.freeL * chosenPocket.freeW),
            });
          }
        }
      }
    }

    if (candidates.length === 0) {
      if (!diagnosticReason) {
        diagnosticReason = `Insufficient floor space: available tail space (${Math.round(maxTail)} mm) cannot accommodate custom pallet footprint.`;
      }
      continue;
    }

    // Sort according to the 5 optimization objectives
    candidates.sort((c1, c2) => {
      // 1. Absorbs maximum number of spillover reels
      if (c1.totalReelsAbsorbed !== c2.totalReelsAbsorbed) {
        return c2.totalReelsAbsorbed - c1.totalReelsAbsorbed;
      }
      // 2. Avoids extra container if possible (absorbed >= spilloverReels)
      const c1Avoids = c1.totalReelsAbsorbed >= spilloverReels;
      const c2Avoids = c2.totalReelsAbsorbed >= spilloverReels;
      if (c1Avoids !== c2Avoids) {
        return c1Avoids ? -1 : 1;
      }
      // 3. Uses remaining floor space most efficiently (higher area footprint)
      const a1 = c1.palletLength * c1.palletWidth;
      const a2 = c2.palletLength * c2.palletWidth;
      if (Math.abs(a1 - a2) > 1000) {
        return a2 - a1;
      }
      // 4. Uses maximum legal vertical height
      if (c1.palletHeight !== c2.palletHeight) {
        return c2.palletHeight - c1.palletHeight;
      }
      return 0;
    });

    const bestCandidate = candidates[0];

    // Determine if this candidate completely eliminates the extra container
    const eliminatesExtraContainer =
      bestCandidate.totalReelsAbsorbed >= spilloverReels &&
      sourceContainer.orders.every(o => o.item === item.item || o.planned_reels <= 0);

    const opportunity: VppSpaceFillOpportunity = {
      spilloverItem: item,
      spilloverReels,
      spilloverWeight: Number((spilloverReels * perReelWt).toFixed(2)),
      sourceContainerIndex,
      targetContainerIndex,
      availableFreeSpace: {
        length: bestCandidate.floorDimension,
        width: bestCandidate.transverseDimension,
        height: maxUsableHeight,
        remainingPayload,
        targetRow: bestCandidate.targetRow,
        description: bestCandidate.availableSpaceDesc,
      },
      proposedPallet: bestCandidate,
      containerCountBefore: containers.length,
      containerCountAfter: eliminatesExtraContainer ? containers.length - 1 : containers.length,
      eliminatesExtraContainer,
      approved: false,
    };

    if (!bestOverallOpportunity || (opportunity.eliminatesExtraContainer && !bestOverallOpportunity.eliminatesExtraContainer)) {
      bestOverallOpportunity = opportunity;
    } else if (opportunity.proposedPallet.totalReelsAbsorbed > bestOverallOpportunity.proposedPallet.totalReelsAbsorbed) {
      bestOverallOpportunity = opportunity;
    }
  }

  if (bestOverallOpportunity) {
    return {
      status: 'FEASIBLE',
      opportunity: bestOverallOpportunity,
    };
  }

  return {
    status: 'NOT_FEASIBLE',
    reason: diagnosticReason || `No valid geometric grid (A×B) fits available tail space in Container #${targetContainerIndex + 1}.`,
  };
}

/**
 * Helper: Evaluates whether a valid VPP Residual Space-Fill opportunity exists.
 * Preserves existing contract for backward compatibility and tests.
 */
export function evaluateVppSpaceFillOpportunity(
  containers: ContainerPlan[],
  config: StuffingConfig
): VppSpaceFillOpportunity | null {
  const report = checkVppSpaceFillFeasibility(containers, config);
  return report.opportunity || null;
}

/**
 * Applies the approved VPP Non-Standard Space-Fill Pallet to the container plan,
 * placing the custom pallet in the previous container and adjusting or eliminating
 * the spillover container.
 */
export function applyVppSpaceFillPallet(
  containers: ContainerPlan[],
  opportunity: VppSpaceFillOpportunity,
  config: StuffingConfig
): ContainerPlan[] {
  if (!opportunity || !containers || containers.length < 2) return containers;

  const newContainers: ContainerPlan[] = containers.map(c => ({
    ...c,
    orders: c.orders.map(o => ({ ...o })),
    physical_pallets: c.physical_pallets ? c.physical_pallets.map(p => ({ ...p, items: p.items ? [...p.items] : [] })) : [],
    stuffing_grid: c.stuffing_grid.map(g => ({ ...g })),
    row_lengths: { ...c.row_lengths },
  }));

  const targetContainer = newContainers[opportunity.targetContainerIndex];
  const sourceContainer = newContainers[opportunity.sourceContainerIndex];
  if (!targetContainer || !sourceContainer) return containers;

  const { proposedPallet, spilloverItem } = opportunity;

  // Construct the custom PalletSlotInfo
  const customPalletInfo: PalletSlotInfo = {
    pallet_number: (targetContainer.physical_pallets?.length || 0) + 1,
    is_mixed: false,
    is_space_fill: true,
    total_reels: proposedPallet.totalReelsAbsorbed,
    total_weight: proposedPallet.palletWeight,
    dims_str: `${proposedPallet.palletLength}*${proposedPallet.palletWidth}*${proposedPallet.palletHeight} (Non-Standard Space-Fill)`,
    tier_desc: `${proposedPallet.gridA}x${proposedPallet.gridB} = ${proposedPallet.reelsPerLayer}/layer (${proposedPallet.layers} tiers, Non-Standard Space-Fill)`,
    primary_film: spilloverItem.film,
    primary_item: spilloverItem.item,
    row_index: proposedPallet.targetRow,
    orientation: proposedPallet.orientation,
    floor_dim: proposedPallet.floorDimension,
    transverseDim: proposedPallet.transverseDimension,
    palletHeight: proposedPallet.palletHeight,
    items: [{
      item: spilloverItem.item,
      film: spilloverItem.film,
      size: spilloverItem.size,
      reels: proposedPallet.totalReelsAbsorbed,
      weight: proposedPallet.palletWeight,
      tier_desc: `${proposedPallet.gridA}x${proposedPallet.gridB} = ${proposedPallet.reelsPerLayer}/layer`,
    }],
  };

  // 1. Add to targetContainer physical pallets
  targetContainer.physical_pallets.push(customPalletInfo);

  // 2. Update targetContainer row lengths
  if (proposedPallet.targetRow === 1) {
    targetContainer.row_lengths.row1 += proposedPallet.floorDimension;
  } else if (proposedPallet.targetRow === 2) {
    targetContainer.row_lengths.row2 += proposedPallet.floorDimension;
  } else if (proposedPallet.targetRow === 3 && targetContainer.row_lengths.row3 !== undefined) {
    targetContainer.row_lengths.row3 += proposedPallet.floorDimension;
  }
  targetContainer.row_lengths.max_length = Math.max(
    targetContainer.row_lengths.row1,
    targetContainer.row_lengths.row2,
    targetContainer.row_lengths.row3 || 0
  );

  // 3. Update targetContainer totals
  targetContainer.total_weight = Number((targetContainer.total_weight + proposedPallet.palletWeight).toFixed(2));
  targetContainer.total_reels += proposedPallet.totalReelsAbsorbed;
  targetContainer.total_pallets += 1;
  targetContainer.loaded_pallets += 1;
  targetContainer.weight_utilization_pct = Number(((targetContainer.total_weight / targetContainer.max_weight) * 100).toFixed(1));
  const usableLength = config.container_type === '20ft' ? USABLE_20FT_ENVELOPE.max_length : 12032;
  targetContainer.space_utilization_pct = Number(((targetContainer.row_lengths.max_length / usableLength) * 100).toFixed(1));

  // 4. Update targetContainer stuffing grid
  const isRow1 = proposedPallet.targetRow === 1;
  const isRow2 = proposedPallet.targetRow === 2;
  targetContainer.stuffing_grid.push({
    bay: targetContainer.stuffing_grid.length + 1,
    row1: isRow1 ? proposedPallet.floorDimension : null,
    row2: isRow2 ? proposedPallet.floorDimension : null,
    row3: null,
    item1: isRow1 ? spilloverItem.item : undefined,
    item2: isRow2 ? spilloverItem.item : undefined,
    dims1: isRow1 ? customPalletInfo.dims_str : undefined,
    dims2: isRow2 ? customPalletInfo.dims_str : undefined,
    pallet1_info: isRow1 ? customPalletInfo : undefined,
    pallet2_info: isRow2 ? customPalletInfo : undefined,
  });

  // 5. Update targetContainer orders
  const targetOrder = targetContainer.orders.find(o => o.item === spilloverItem.item);
  if (targetOrder) {
    targetOrder.planned_reels += proposedPallet.totalReelsAbsorbed;
    targetOrder.planned_weight = Number((targetOrder.planned_weight + proposedPallet.palletWeight).toFixed(2));
    targetOrder.total_pallets += 1;
    targetOrder.loaded_in_container = (targetOrder.loaded_in_container || 0) + 1;
  } else {
    targetContainer.orders.push({
      ...spilloverItem,
      planned_reels: proposedPallet.totalReelsAbsorbed,
      planned_weight: proposedPallet.palletWeight,
      total_pallets: 1,
      loaded_in_container: 1,
    });
  }

  // 6. Handle sourceContainer
  if (opportunity.eliminatesExtraContainer) {
    // Remove the extra container completely
    newContainers.splice(opportunity.sourceContainerIndex, 1);
  } else {
    // Adjust sourceContainer values
    sourceContainer.total_reels = Math.max(0, sourceContainer.total_reels - proposedPallet.totalReelsAbsorbed);
    sourceContainer.total_weight = Number(Math.max(0, sourceContainer.total_weight - proposedPallet.palletWeight).toFixed(2));
    sourceContainer.weight_utilization_pct = Number(((sourceContainer.total_weight / sourceContainer.max_weight) * 100).toFixed(1));
    const srcOrder = sourceContainer.orders.find(o => o.item === spilloverItem.item);
    if (srcOrder) {
      srcOrder.planned_reels = Math.max(0, srcOrder.planned_reels - proposedPallet.totalReelsAbsorbed);
      srcOrder.planned_weight = Number(Math.max(0, srcOrder.planned_weight - proposedPallet.palletWeight).toFixed(2));
    }
  }

  return newContainers;
}

/**
 * Function 4: generateStuffingPlan(rawOrders, config, clientName)
 * Master orchestrator returning the complete FinalPlan (Stage 1 + Stage 2 Optimized)
 */
export function generateStuffingPlan(
  rawOrders: OrderInput[],
  config: StuffingConfig = DEFAULT_STUFFING_CONFIG,
  clientName: string = 'DARU TRADING'
): FinalPlan {
  // STAGE 1: Normal Item-Level Palletization
  let stage1Orders = rawOrders.map((order, idx) => 
    calculateOrderMetrics(order, idx + 1, config)
  );

  // STAGE 1.5: Global VPP Reel-to-Pallet Harmonization
  // Evaluates all eligible planned VPP reels together within +/-10% tolerance to maximize pallet utilization
  // and eliminate underfilled pallets (avoiding 8, 9, 11-reel leftovers and extra containers)
  stage1Orders = globallyHarmonizeVppOrders(stage1Orders, config);

  // STAGE 2: Multi-Container Packing & Container-Count Reconciliation
  // Checks if an affected item has an alternative configuration that fits the order in fewer containers
  const { orders: reconciledOrders, containers: rawContainers } = reconcileContainersForOrderCount(stage1Orders, config);

  // VPP Residual Space-Fill Pallet Exception (Planner Approval Required, Default OFF)
  const vppSpaceFillFeasibility = checkVppSpaceFillFeasibility(rawContainers, config);
  const vppSpaceFillOpportunity = vppSpaceFillFeasibility.opportunity || null;
  let containers = rawContainers;
  if (vppSpaceFillOpportunity) {
    if (config.allow_vpp_space_fill_pallet) {
      containers = applyVppSpaceFillPallet(rawContainers, vppSpaceFillOpportunity, config);
      vppSpaceFillOpportunity.approved = true;
    } else {
      vppSpaceFillOpportunity.approved = false;
    }
  }

  // Synchronize container-optimized item metrics back to master summary
  const summaryMap = new Map<number, CalculatedItem>();
  reconciledOrders.forEach(o => {
    summaryMap.set(o.item, { ...o });
  });

  if (containers.length > 0) {
    const aggregatedPerItem = new Map<number, {
      planned_reels: number;
      planned_weight: number;
      total_pallets: number;
      p8: number;
      p6: number;
      p4: number;
      p3: number;
      p2: number;
      p1: number;
      pOther: number;
      reason?: string;
    }>();

    containers.forEach(c => {
      c.orders.forEach(co => {
        const agg = aggregatedPerItem.get(co.item) || {
          planned_reels: 0,
          planned_weight: 0,
          total_pallets: 0,
          p8: 0,
          p6: 0,
          p4: 0,
          p3: 0,
          p2: 0,
          p1: 0,
          pOther: 0,
          reason: co.reels_per_pallet_reason,
        };
        agg.planned_reels += co.planned_reels;
        agg.planned_weight += co.planned_weight;
        agg.total_pallets += co.total_pallets;
        agg.p8 += co.pallets_8_reels || (co.reels_per_pallet === 8 ? co.total_pallets : 0);
        agg.p6 += co.pallets_6_reels || (co.reels_per_pallet === 6 ? co.total_pallets : 0);
        agg.p4 += co.pallets_4_reels || (co.reels_per_pallet === 4 ? co.total_pallets : 0);
        agg.p3 += co.pallets_3_reels || (co.reels_per_pallet === 3 ? co.total_pallets : 0);
        agg.p2 += co.pallets_2_reels || (co.reels_per_pallet === 2 ? co.total_pallets : 0);
        agg.p1 += co.pallets_1_reel || (co.reels_per_pallet === 1 ? co.total_pallets : 0);
        agg.pOther += co.pallets_other_reels || 0;
        if (co.reels_per_pallet_reason) agg.reason = co.reels_per_pallet_reason;
        aggregatedPerItem.set(co.item, agg);
      });
    });

    aggregatedPerItem.forEach((agg, itemNum) => {
      const existing = summaryMap.get(itemNum);
      if (existing) {
        const summaryParts: string[] = [];
        if (existing.packing_mode === 'VPP') {
          const mainR = existing.reels_per_pallet || 1;
          const fullCount = Math.floor(agg.planned_reels / mainR);
          const remReels = agg.planned_reels - fullCount * mainR;
          if (remReels > 0 && fullCount + 1 === agg.total_pallets && fullCount > 0) {
            const rollsPerTier = existing.vpp_rolls_per_layer || Math.max(1, Math.round(mainR / (existing.vpp_layers || 1)));
            const remTiers = Math.max(1, Math.ceil(remReels / rollsPerTier));
            const remHeight = getPalletHeightForVPP(existing.size, remTiers);
            summaryParts.push(`${fullCount}x ${mainR}-reel (${existing.pallet_height}mm)`);
            summaryParts.push(`1x ${remReels}-reel (${remHeight}mm)`);
          } else if (agg.total_pallets === 1) {
            const rollsPerTier = existing.vpp_rolls_per_layer || 1;
            const tiers = Math.max(1, Math.ceil(agg.planned_reels / rollsPerTier));
            const remHeight = getPalletHeightForVPP(existing.size, tiers);
            summaryParts.push(`1x ${agg.planned_reels}-reel (${remHeight}mm)`);
          } else {
            summaryParts.push(`${agg.total_pallets}x ${existing.reels_per_pallet}-reel (${existing.pallet_height}mm)`);
          }
        } else {
          if (agg.p8 > 0) summaryParts.push(`${agg.p8}x 8-reel (${getPalletHeightForHPP(existing.cradle_ply, 8)}mm)`);
          if (agg.p6 > 0) summaryParts.push(`${agg.p6}x 6-reel (${getPalletHeightForHPP(existing.cradle_ply, 6)}mm)`);
          if (agg.p4 > 0) summaryParts.push(`${agg.p4}x 4-reel (${getPalletHeightForHPP(existing.cradle_ply, 4)}mm)`);
          if (agg.p3 > 0) summaryParts.push(`${agg.p3}x 3-reel (${getPalletHeightForHPP(existing.cradle_ply, 3)}mm)`);
          if (agg.p2 > 0) summaryParts.push(`${agg.p2}x 2-reel (${getPalletHeightForHPP(existing.cradle_ply, 2)}mm)`);
          if (agg.p1 > 0) summaryParts.push(`${agg.p1}x 1-reel (${getPalletHeightForHPP(existing.cradle_ply, 1)}mm)`);
          if (agg.pOther > 0) {
            const accounted = agg.p8 * 8 + agg.p6 * 6 + agg.p4 * 4 + agg.p3 * 3 + agg.p2 * 2 + agg.p1 * 1;
            const rOther = Math.max(1, Math.round((agg.planned_reels - accounted) / agg.pOther));
            summaryParts.push(`${agg.pOther}x ${rOther}-reel (${getPalletHeightForHPP(existing.cradle_ply, rOther)}mm)`);
          }
        }
        const reconciledSummary = summaryParts.join(' + ') || existing.pallets_summary;
        const mainR = existing.packing_mode === 'VPP'
          ? (existing.reels_per_pallet || 1)
          : (agg.p8 > 0 ? 8 : (agg.p6 > 0 ? 6 : (agg.p3 > 0 ? 3 : (agg.p2 > 0 ? 2 : (agg.p1 > 0 ? 1 : existing.reels_per_pallet)))));

        summaryMap.set(itemNum, {
          ...existing,
          planned_reels: agg.planned_reels,
          planned_weight: Number(agg.planned_weight.toFixed(2)),
          total_pallets: agg.total_pallets,
          excess_less: Number((agg.planned_weight - existing.order_qty).toFixed(2)),
          reels_per_pallet: mainR,
          pallet_height: existing.packing_mode === 'VPP' ? existing.pallet_height : getPalletHeightForHPP(existing.cradle_ply, mainR),
          pallet_dims_str: existing.packing_mode === 'VPP' ? existing.pallet_dims_str : `${existing.pallet_length}*${existing.pallet_width}*${getPalletHeightForHPP(existing.cradle_ply, mainR)}`,
          pallets_summary: reconciledSummary,
          reels_per_pallet_reason: agg.reason || existing.reels_per_pallet_reason,
          pallets_8_reels: agg.p8,
          pallets_6_reels: agg.p6,
          pallets_4_reels: agg.p4,
          pallets_3_reels: agg.p3,
          pallets_2_reels: agg.p2,
          pallets_1_reel: agg.p1,
          pallets_other_reels: agg.pOther,
        });
      }
    });
  }

  const finalSummary = Array.from(summaryMap.values());
  const totalOrderQty = finalSummary.reduce((sum, o) => sum + o.order_qty, 0);
  const totalPlannedWeight = finalSummary.reduce((sum, o) => sum + o.planned_weight, 0);
  const excessLessTotal = Number((totalPlannedWeight - totalOrderQty).toFixed(2));
  const totalReels = finalSummary.reduce((sum, o) => sum + o.planned_reels, 0);
  const totalPallets = containers.length > 0 ? containers.reduce((sum, c) => sum + c.total_pallets, 0) : finalSummary.reduce((sum, o) => sum + o.total_pallets, 0);

  return {
    summary: finalSummary,
    containers,
    totals: {
      total_order_qty: totalOrderQty,
      total_planned_weight: Number(totalPlannedWeight.toFixed(2)),
      excess_less_total: excessLessTotal,
      total_containers: containers.length,
      total_reels: totalReels,
      total_pallets: totalPallets,
    },
    client_name: clientName,
    container_type: config.container_type,
    packing_mode: config.default_packing_mode,
    generated_at: new Date().toISOString(),
    config_used: config,
    vpp_space_fill_opportunity: vppSpaceFillOpportunity,
    vpp_space_fill_feasibility: vppSpaceFillFeasibility,
  };
}

/**
 * Expands an order item into separate rows for Stuffing Master export/display
 * if it contains a mixed pallet configuration (e.g. 8x 3-reel and 2x 2-reel).
 */
export function expandItemForStuffingMaster(order: CalculatedItem): CalculatedItem[] {
  if (order.packing_mode === 'VPP') {
    const mainR = order.reels_per_pallet || 1;
    const fullCount = Math.floor(order.planned_reels / mainR);
    const remReels = order.planned_reels - fullCount * mainR;

    if (remReels > 0 && fullCount + 1 === order.total_pallets && fullCount > 0) {
      const rollsPerTier = order.vpp_rolls_per_layer || Math.max(1, Math.round(mainR / (order.vpp_layers || 1)));
      const remTiers = Math.max(1, Math.ceil(remReels / rollsPerTier));
      const remHeight = getPalletHeightForVPP(order.size, remTiers);
      const remDimsStr = `${order.pallet_length}*${order.pallet_width}*${remHeight}`;

      const fullPlannedReels = fullCount * mainR;
      const fullPlannedWeight = Number((fullPlannedReels * order.per_reel_wt).toFixed(2));
      const remPlannedWeight = Number((order.planned_weight - fullPlannedWeight).toFixed(2));

      const fullExcessLess = order.planned_reels > 0 
        ? Number((fullPlannedWeight - order.order_qty * (fullPlannedReels / order.planned_reels)).toFixed(2))
        : 0;
      const remExcessLess = Number((order.excess_less - fullExcessLess).toFixed(2));

      return [
        {
          ...order,
          total_pallets: fullCount,
          reels_per_pallet: mainR,
          planned_reels: fullPlannedReels,
          planned_weight: fullPlannedWeight,
          pallet_height: order.pallet_height,
          pallet_dims_str: order.pallet_dims_str,
          excess_less: fullExcessLess,
          pallets_summary: `${fullCount}x ${mainR}-reel (${order.pallet_height}mm)`,
        },
        {
          ...order,
          total_pallets: 1,
          reels_per_pallet: remReels,
          planned_reels: remReels,
          planned_weight: remPlannedWeight,
          pallet_height: remHeight,
          pallet_dims_str: remDimsStr,
          excess_less: remExcessLess,
          pallets_summary: `1x ${remReels}-reel (${remHeight}mm)`,
        },
      ];
    }

    return [{
      ...order,
      reels_per_pallet: order.reels_per_pallet || 1,
      pallet_height: order.pallet_height,
      pallet_dims_str: order.pallet_dims_str,
    }];
  }

  const p8 = order.pallets_8_reels || (order.reels_per_pallet === 8 && !order.pallets_6_reels && !order.pallets_4_reels && !order.pallets_3_reels && !order.pallets_2_reels && !order.pallets_1_reel ? order.total_pallets : 0);
  const p6 = order.pallets_6_reels || (order.reels_per_pallet === 6 && !order.pallets_8_reels && !order.pallets_4_reels && !order.pallets_3_reels && !order.pallets_2_reels && !order.pallets_1_reel ? order.total_pallets : 0);
  const p4 = order.pallets_4_reels || (order.reels_per_pallet === 4 && !order.pallets_8_reels && !order.pallets_6_reels && !order.pallets_3_reels && !order.pallets_2_reels && !order.pallets_1_reel ? order.total_pallets : 0);
  const p3 = order.pallets_3_reels || (order.reels_per_pallet === 3 && !order.pallets_8_reels && !order.pallets_6_reels && !order.pallets_4_reels && !order.pallets_2_reels && !order.pallets_1_reel ? order.total_pallets : 0);
  const p2 = order.pallets_2_reels || (order.reels_per_pallet === 2 && !order.pallets_8_reels && !order.pallets_6_reels && !order.pallets_4_reels && !order.pallets_3_reels && !order.pallets_1_reel ? order.total_pallets : 0);
  const p1 = order.pallets_1_reel || (order.reels_per_pallet === 1 && !order.pallets_8_reels && !order.pallets_6_reels && !order.pallets_4_reels && !order.pallets_3_reels && !order.pallets_2_reels ? order.total_pallets : 0);
  const sumSpecified = p8 + p6 + p4 + p3 + p2 + p1;
  const pOther = order.pallets_other_reels !== undefined
    ? order.pallets_other_reels
    : (sumSpecified === 0 ? order.total_pallets : Math.max(0, order.total_pallets - sumSpecified));

  const accountedReels = p8 * 8 + p6 * 6 + p4 * 4 + p3 * 3 + p2 * 2 + p1 * 1;
  const remainingReels = order.planned_reels - accountedReels;

  let otherReelsPerPallet = 1;
  if (pOther > 0) {
    if (sumSpecified === 0) {
      otherReelsPerPallet = order.reels_per_pallet || (order.total_pallets > 0 ? Math.max(1, Math.round(order.planned_reels / order.total_pallets)) : 1);
    } else if (remainingReels > 0) {
      otherReelsPerPallet = Math.max(1, Math.round(remainingReels / pOther));
    } else {
      otherReelsPerPallet = 1;
    }
  }

  const nonZeroTypes: { reels: number; count: number }[] = [];
  if (p8 > 0) nonZeroTypes.push({ reels: 8, count: p8 });
  if (p6 > 0) nonZeroTypes.push({ reels: 6, count: p6 });
  if (p4 > 0) nonZeroTypes.push({ reels: 4, count: p4 });
  if (p3 > 0) nonZeroTypes.push({ reels: 3, count: p3 });
  if (p2 > 0) nonZeroTypes.push({ reels: 2, count: p2 });
  if (p1 > 0) nonZeroTypes.push({ reels: 1, count: p1 });
  if (pOther > 0 && otherReelsPerPallet > 0) {
    const existing = nonZeroTypes.find(t => t.reels === otherReelsPerPallet);
    if (existing) {
      existing.count += pOther;
    } else {
      nonZeroTypes.push({ reels: otherReelsPerPallet, count: pOther });
    }
  }

  if (nonZeroTypes.length <= 1) {
    const r = nonZeroTypes.length === 1 ? nonZeroTypes[0].reels : (order.reels_per_pallet || 1);
    const height = getPalletHeightForHPP(order.cradle_ply, r);
    return [{
      ...order,
      reels_per_pallet: r,
      pallet_height: height,
      pallet_dims_str: `${order.pallet_length}*${order.pallet_width}*${height}`,
    }];
  }

  // Mixed pallet configuration -> Split into separate rows for each pallet configuration
  let accumulatedWeight = 0;
  let accumulatedExcess = 0;

  return nonZeroTypes.map((t, idx) => {
    const isLast = idx === nonZeroTypes.length - 1;
    const plannedReels = t.count * t.reels;
    const height = getPalletHeightForHPP(order.cradle_ply, t.reels);
    const dimsStr = `${order.pallet_length}*${order.pallet_width}*${height}`;

    let plannedWeight = Number((plannedReels * order.per_reel_wt).toFixed(2));
    let excessLess = order.planned_reels > 0 
      ? Number((plannedWeight - order.order_qty * (plannedReels / order.planned_reels)).toFixed(2))
      : 0;

    if (isLast) {
      plannedWeight = Number((order.planned_weight - accumulatedWeight).toFixed(2));
      excessLess = Number((order.excess_less - accumulatedExcess).toFixed(2));
    } else {
      accumulatedWeight += plannedWeight;
      accumulatedExcess += excessLess;
    }

    return {
      ...order,
      total_pallets: t.count,
      reels_per_pallet: t.reels,
      planned_reels: plannedReels,
      planned_weight: plannedWeight,
      pallet_height: height,
      pallet_dims_str: dimsStr,
      excess_less: excessLess,
      pallets_summary: `${t.count}x ${t.reels}-reel (${height}mm)`,
      pallets_8_reels: t.reels === 8 ? t.count : 0,
      pallets_6_reels: t.reels === 6 ? t.count : 0,
      pallets_4_reels: t.reels === 4 ? t.count : 0,
      pallets_3_reels: t.reels === 3 ? t.count : 0,
      pallets_2_reels: t.reels === 2 ? t.count : 0,
      pallets_1_reel: t.reels === 1 ? t.count : 0,
      pallets_other_reels: (t.reels !== 8 && t.reels !== 6 && t.reels !== 4 && t.reels !== 3 && t.reels !== 2 && t.reels !== 1) ? t.count : 0,
    };
  });
}

export function expandOrdersForStuffingMaster(orders: CalculatedItem[]): CalculatedItem[] {
  return orders.flatMap(expandItemForStuffingMaster);
}

/**
 * Function 5: parsePastedOrImportedOrders(data)
 * Flexible parsing for Excel rows, CSV, tab-separated text, or JSON
 */
export function parseImportedOrders(content: string | any[][]): OrderInput[] {
  const parsedOrders: OrderInput[] = [];

  let rows: any[][] = [];

  if (Array.isArray(content)) {
    rows = content;
  } else if (typeof content === 'string') {
    // Check if JSON
    try {
      const json = JSON.parse(content);
      if (Array.isArray(json)) {
        return json.map((j, i) => ({
          item: Number(j.item) || (i + 1) * 10,
          film: String(j.film || j.material || 'TH21-25').trim(),
          size: Number(j.size || j.width || 1000),
          length: Number(j.length || j.mtrs || 15500),
          core: Number(j.core || 6),
          dia: Number(j.dia || 0),
          qty: Number(j.qty || j.order_qty || j.weight || 5000),
          customer: j.customer || 'IMPORTED',
          packing_mode: j.packing_mode || j.mode || 'AUTO',
          container_type: j.container_type || '40ft_HC',
          custom_reels_per_pallet: j.custom_reels_per_pallet ? Number(j.custom_reels_per_pallet) : undefined,
          custom_planned_reels: j.custom_planned_reels ? Number(j.custom_planned_reels) : undefined,
        }));
      }
    } catch {
      // Parse as CSV or TSV
      const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      rows = lines.map(line => {
        if (line.includes('\t')) return line.split('\t');
        if (line.includes(',')) return line.split(',');
        return line.split(/\s+/);
      });
    }
  }

  if (rows.length === 0) return [];

  // Detect header row index
  let headerIndex = -1;
  let colMap: { [key: string]: number } = {};

  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const row = rows[r].map(c => String(c).toLowerCase().trim());
    const hasFilm = row.some(c => c.includes('film') || c.includes('material') || c.includes('grade'));
    const hasQty = row.some(c => c.includes('qty') || c.includes('weight') || c.includes('order'));
    const hasSize = row.some(c => c.includes('size') || c.includes('width') || c.includes('mm'));

    if (hasFilm || (hasQty && hasSize)) {
      headerIndex = r;
      row.forEach((col, idx) => {
        if (col.includes('item') || col.includes('sr') || col.includes('#')) colMap['item'] = idx;
        else if (col.includes('film') || col.includes('material') || col.includes('grade')) colMap['film'] = idx;
        else if (col.includes('size') || col.includes('width')) colMap['size'] = idx;
        else if (col.includes('length') || col.includes('mtr') || col.includes('len')) colMap['length'] = idx;
        else if (col.includes('core')) colMap['core'] = idx;
        else if (col.includes('dia')) colMap['dia'] = idx;
        else if (col.includes('qty') || col.includes('weight') || col.includes('quantity')) colMap['qty'] = idx;
        else if (col.includes('mode') || col.includes('packing')) colMap['mode'] = idx;
        else if (col.includes('client') || col.includes('customer')) colMap['customer'] = idx;
      });
      break;
    }
  }

  const startRow = headerIndex >= 0 ? headerIndex + 1 : 0;

  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    // Extract values
    let item = (parsedOrders.length + 1) * 10;
    let film = 'TH21-25';
    let size = 1000;
    let length = 15500;
    let core = 6;
    let dia = 0;
    let qty = 0;
    let mode: PackingMode = 'AUTO';
    let customer = 'IMPORTED';

    if (headerIndex >= 0 && Object.keys(colMap).length >= 2) {
      if (colMap['item'] !== undefined && row[colMap['item']]) item = Number(row[colMap['item']]) || item;
      if (colMap['film'] !== undefined && row[colMap['film']]) film = String(row[colMap['film']]).trim();
      if (colMap['size'] !== undefined && row[colMap['size']]) size = Number(row[colMap['size']]) || size;
      if (colMap['length'] !== undefined && row[colMap['length']]) length = Number(row[colMap['length']]) || length;
      if (colMap['core'] !== undefined && row[colMap['core']]) core = Number(row[colMap['core']]) || core;
      if (colMap['dia'] !== undefined && row[colMap['dia']]) dia = Number(row[colMap['dia']]) || dia;
      if (colMap['qty'] !== undefined && row[colMap['qty']]) qty = Number(String(row[colMap['qty']]).replace(/,/g, '')) || qty;
      if (colMap['mode'] !== undefined && row[colMap['mode']]) {
        const m = String(row[colMap['mode']]).toUpperCase();
        if (m.includes('VPP')) mode = 'VPP';
        else if (m.includes('HPP')) mode = 'HPP';
      }
      if (colMap['customer'] !== undefined && row[colMap['customer']]) customer = String(row[colMap['customer']]).trim();
    } else {
      // Positional fallback: [Film, Size, Length, Core, Dia, Qty] or [Item, Film, Size, Length, Core, Dia, Qty]
      if (typeof row[0] === 'string' && isNaN(Number(row[0]))) {
        film = String(row[0]).trim();
        size = Number(row[1]) || 1000;
        length = Number(row[2]) || 15500;
        core = Number(row[3]) || 6;
        dia = Number(row[4]) || 0;
        qty = Number(String(row[5] || row[4] || 5000).replace(/,/g, '')) || 5000;
      } else {
        item = Number(row[0]) || item;
        film = String(row[1] || 'TH21-25').trim();
        size = Number(row[2]) || 1000;
        length = Number(row[3]) || 15500;
        core = Number(row[4]) || 6;
        dia = Number(row[5]) || 0;
        qty = Number(String(row[6] || 5000).replace(/,/g, '')) || 5000;
      }
    }

    if (qty > 0 && film.length > 0) {
      parsedOrders.push({
        item,
        film,
        size,
        length,
        core,
        dia,
        qty,
        customer,
        packing_mode: mode,
      });
    }
  }

  return parsedOrders;
}
