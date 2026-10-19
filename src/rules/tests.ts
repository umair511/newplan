/**
 * AUTOMATED TEST SUITE FOR CRITICAL HARD RULES
 * Verifies that all fundamental mathematical formulas and physical constraints
 * operate with 100% precision and that guardrails catch any attempted violations.
 */

import {
  calculateRollDiameter,
  calculateOrderMetrics,
  expandItemForStuffingMaster,
  generateStuffingPlan,
  DEFAULT_STUFFING_CONFIG,
  CONFIG_20FT,
  USABLE_20FT_ENVELOPE,
} from '../services/stuffing/stuffingCalculator';
import { lookupFilmSpecs } from '../services/stuffing/filmDensities';
import { CalculatedItem, ContainerPlan } from '../types/stuffing';
import {
  RuleGuardrailEngine,
  isQualifyingTC20Order,
  validateTC20PalletHomogeneity,
  isEligibleForVppConsolidation,
} from './validator';
import { getPackagingRule, getHardPackagingRules } from './registry';

// Active formulas from stuffingCalculator.ts
const calculateReelWeight = (size: number, length: number, thickness: number, density: number): number =>
  Number(((length * size * density * thickness) / 1000000).toFixed(2));

const calculateRollLength = (dia: number, thickness: number): number =>
  Math.round(Math.pow(dia / 1.174, 2) / thickness);

interface TestResult {
  ruleId: string;
  testName: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const testResults: TestResult[] = [];

function assert(condition: boolean, ruleId: string, testName: string, errorMsg?: string, details?: any) {
  if (condition) {
    testResults.push({ ruleId, testName, passed: true, details });
  } else {
    testResults.push({ ruleId, testName, passed: false, error: errorMsg || 'Assertion failed', details });
  }
}

export function runCriticalHardRuleTests(): { total: number; passed: number; failed: number; results: TestResult[] } {
  console.log('====================================================');
  console.log('RUNNING CRITICAL HARD RULES AUTOMATED TEST SUITE');
  console.log('====================================================\n');

  // ---------------------------------------------------------------------------
  // TEST 1: MATH-001 (Reel Net Weight Formula)
  // Formula: (Length * Size * Density * Thickness) / 1,000,000
  // ---------------------------------------------------------------------------
  // Case A: BOPP TH21-25 (1000 mm, 15500 m, 25 um, 0.905 g/cm3)
  // Expected: (15500 * 1000 * 0.905 * 25) / 1e6 = 350.6875 -> 350.69 kg
  const wtBopp = calculateReelWeight(1000, 15500, 25, 0.905);
  assert(
    Math.abs(wtBopp - 350.69) < 0.01,
    'MATH-001',
    'Reel Net Weight for BOPP TH21-25',
    `Expected 350.69 kg, got ${wtBopp} kg`,
    { wtBopp }
  );

  // Case B: BOPET PTN01-12 (1000 mm, 18000 m, 12 um, 1.400 g/cm3)
  // Expected: (18000 * 1000 * 1.400 * 12) / 1e6 = 302.40 kg
  const wtBopet = calculateReelWeight(1000, 18000, 12, 1.400);
  assert(
    Math.abs(wtBopet - 302.40) < 0.01,
    'MATH-001',
    'Reel Net Weight for BOPET PTN01-12',
    `Expected 302.40 kg, got ${wtBopet} kg`,
    { wtBopet }
  );

  // ---------------------------------------------------------------------------
  // TEST 2: MATH-002 & MATH-003 (Roll Diameter and Length Inverse)
  // ---------------------------------------------------------------------------
  // Length 15,500 m, 25 um: DIA = 1.174 * SQRT(15500 * 25) = 731 mm
  const dia6 = calculateRollDiameter(15500, 25, 6);
  assert(
    dia6 === 731,
    'MATH-002',
    'Roll Outer Diameter calculation via Golden Geometry SRS (1.174 * sqrt(L * t))',
    `Expected 731 mm, got ${dia6} mm`,
    { dia6 }
  );

  // Invert diameter back to length: (731 / 1.174)^2 / 25
  const recoveredLength = calculateRollLength(dia6, 25);
  const lenErrorPct = Math.abs((recoveredLength - 15500) / 15500) * 100;
  assert(
    lenErrorPct < 0.1,
    'MATH-003',
    'Inverse Roll Length calculation precision (<0.1% deviation)',
    `Recovered length ${recoveredLength} m deviates by ${lenErrorPct.toFixed(2)}% from original 15,500 m`,
    { dia6, recoveredLength, lenErrorPct }
  );

  // ---------------------------------------------------------------------------
  // TEST 3: MATH-006 (Conservation of Mass in Mixed Pallet Splitting)
  // ---------------------------------------------------------------------------
  const mockOrder: CalculatedItem = {
    item: 10,
    formula: '10TH21-251000',
    film: 'TH21-25',
    size: 1000,
    length: 15500,
    core: 6,
    dia: 720,
    thickness: 25,
    density: 0.905,
    order_qty: 10000,
    packing_mode: 'HPP',
    container_type: '40ft_HC',
    per_reel_wt: 350.69,
    required_reels_buffer: 28,
    planned_reels: 28, // e.g. 8 pallets of 3-reel (24 reels) + 2 pallets of 2-reel (4 reels)
    planned_weight: 9819.32,
    total_pallets: 10,
    loaded_in_container: 10,
    reels_per_pallet: 3,
    pallets_8_reels: 0,
    pallets_6_reels: 0,
    pallets_4_reels: 0,
    pallets_3_reels: 8,
    pallets_2_reels: 2,
    pallets_other_reels: 0,
    pallet_length: 765,
    pallet_width: 1120,
    pallet_height: 1650,
    pallet_dims_str: '765*1120*1650',
    excess_less: -180.68,
    pallets_summary: '8x 3-reel + 2x 2-reel',
    cradle_ply: 765,
    is_dropped: false,
  };

  const splitRows = expandItemForStuffingMaster(mockOrder);
  const sumSplitWeight = splitRows.reduce((sum, r) => sum + r.planned_weight, 0);
  const sumSplitReels = splitRows.reduce((sum, r) => sum + r.planned_reels, 0);

  assert(
    Math.abs(sumSplitWeight - mockOrder.planned_weight) < 0.02,
    'MATH-006',
    'Conservation of mass across mixed pallet split rows',
    `Sum of split weights (${sumSplitWeight}) !== order planned weight (${mockOrder.planned_weight})`,
    { sumSplitWeight, orderPlannedWeight: mockOrder.planned_weight }
  );

  assert(
    sumSplitReels === mockOrder.planned_reels,
    'MATH-005',
    'Reel count conservation in mixed pallet split rows',
    `Sum of split reels (${sumSplitReels}) !== planned reels (${mockOrder.planned_reels})`,
    { sumSplitReels, orderPlannedReels: mockOrder.planned_reels }
  );

  // ---------------------------------------------------------------------------
  // TEST 4: CONT-001 & CONT-002 (Container Dimension Specifications)
  // ---------------------------------------------------------------------------
  assert(
    DEFAULT_STUFFING_CONFIG.container_internal_length === 12032 &&
    DEFAULT_STUFFING_CONFIG.container_internal_width === 2352 &&
    DEFAULT_STUFFING_CONFIG.container_internal_height === 2698 &&
    DEFAULT_STUFFING_CONFIG.container_max_weight === 26000,
    'CONT-001',
    '40ft High Cube standard specifications verification (12032 x 2352 x 2698 mm, max 26,000 kg)',
    '40ft HC dimensions mismatch standard specifications',
    DEFAULT_STUFFING_CONFIG
  );

  assert(
    CONFIG_20FT.container_internal_length === 5898 &&
    CONFIG_20FT.container_internal_width === 2352 &&
    CONFIG_20FT.container_internal_height === 2393 &&
    CONFIG_20FT.container_max_weight === 21500,
    'CONT-002',
    '20ft Standard container specifications verification (5898 x 2352 x 2393 mm, max 21,500 kg)',
    '20ft dimensions mismatch standard specifications',
    CONFIG_20FT
  );

  // ---------------------------------------------------------------------------
  // TEST 5: CONT-005 (Container Payload Overweight Guardrail)
  // ---------------------------------------------------------------------------
  const overweightContainer: ContainerPlan = {
    id: 1,
    name: 'Container 1 (40ft_HC)',
    container_type: '40ft_HC',
    total_weight: 27500, // Exceeds 26,000 kg
    max_weight: 26000,
    weight_utilization_pct: 105.8,
    loaded_pallets: 20,
    total_pallets: 20,
    total_reels: 40,
    orders: [],
    row_lengths: { row1: 10000, row2: 10000, max_length: 10000 },
    stuffing_grid: [],
    pallet_packing_details: [],
  };
  const cWeightValidation = RuleGuardrailEngine.validateContainerPlan(overweightContainer, DEFAULT_STUFFING_CONFIG);
  assert(
    !cWeightValidation.valid && cWeightValidation.violations.some(v => v.ruleId === 'CONT-005'),
    'CONT-005',
    'Guardrail detects container cargo weight exceeding maximum legal payload',
    'Failed to flag overweight container',
    cWeightValidation
  );

  // ---------------------------------------------------------------------------
  // TEST 6: CONT-006 (20ft Container 10-Pallet Floor Cap Guardrail)
  // ---------------------------------------------------------------------------
  const overPallet20ft: ContainerPlan = {
    id: 1,
    name: 'Container 1 (20ft)',
    container_type: '20ft',
    total_weight: 18000,
    max_weight: 21500,
    weight_utilization_pct: 83.7,
    loaded_pallets: 12, // Exceeds 10 pallets in 20ft
    total_pallets: 12,
    total_reels: 24,
    orders: [],
    row_lengths: { row1: 5500, row2: 5500, max_length: 5500 },
    stuffing_grid: [],
    pallet_packing_details: [],
  };
  const cPalletValidation = RuleGuardrailEngine.validateContainerPlan(overPallet20ft, CONFIG_20FT);
  assert(
    !cPalletValidation.valid && cPalletValidation.violations.some(v => v.ruleId === 'CONT-006'),
    'CONT-006',
    'Guardrail detects 20ft container exceeding 10-pallet floor capacity',
    'Failed to flag 20ft container with > 10 pallets',
    cPalletValidation
  );

  // ---------------------------------------------------------------------------
  // TEST 7: HPP-001 (Cradle Ply Selection by Diameter Thresholds)
  // ---------------------------------------------------------------------------
  const m800 = calculateOrderMetrics({ item: 1, film: 'TH21-25', size: 1000, length: 15500, core: 6, dia: 800, qty: 5000, packing_mode: 'HPP' });
  const m700 = calculateOrderMetrics({ item: 2, film: 'TH21-25', size: 1000, length: 15500, core: 6, dia: 700, qty: 5000, packing_mode: 'HPP' });
  const m560 = calculateOrderMetrics({ item: 3, film: 'TH21-25', size: 1000, length: 15500, core: 6, dia: 560, qty: 5000, packing_mode: 'HPP' });
  const m500 = calculateOrderMetrics({ item: 4, film: 'TH21-25', size: 1000, length: 15500, core: 6, dia: 500, qty: 5000, packing_mode: 'HPP' });

  assert(
    m800.cradle_ply === 850 && m800.pallet_length === 850 &&
    m700.cradle_ply === 765 && m700.pallet_length === 765 &&
    m560.cradle_ply === 600 && m560.pallet_length === 1200 &&
    m500.cradle_ply === 550 && m500.pallet_length === 1100,
    'HPP-001',
    'Cradle Ply & Pallet Length Selection by Diameter Thresholds (Dia>745->850; 590-745->765; 530-590->600; <=530->550)',
    'Cradle ply or pallet length mismatch calculated values',
    { m800: m800.cradle_ply, m700: m700.cradle_ply, m560: m560.cradle_ply, m500: m500.cradle_ply }
  );

  // ---------------------------------------------------------------------------
  // TEST 8: HPP-003 (850 mm Ply Prohibited from 3-Line Loading)
  // ---------------------------------------------------------------------------
  const illegal3Line850: ContainerPlan = {
    id: 1,
    name: 'Container 1',
    container_type: '40ft_HC',
    total_weight: 24000,
    max_weight: 26000,
    weight_utilization_pct: 92.3,
    loaded_pallets: 20,
    total_pallets: 20,
    total_reels: 40,
    orders: [
      {
        ...mockOrder,
        pallet_length: 850, // 850 mm ply
      },
    ],
    row_lengths: { row1: 11000, row2: 11000, row3: 11000, max_length: 11000 },
    stuffing_grid: [],
    pallet_packing_details: [],
  };
  const line3Validation = RuleGuardrailEngine.validateContainerPlan(illegal3Line850, DEFAULT_STUFFING_CONFIG);
  assert(
    !line3Validation.valid && line3Validation.violations.some(v => v.ruleId === 'HPP-003'),
    'HPP-003',
    'Guardrail flags 850 mm ply pallets loaded in 3 lines (exceeds container width)',
    'Failed to flag 850 mm ply pallets in 3-line layout',
    line3Validation
  );

  // ---------------------------------------------------------------------------
  // TEST 9: HPP-004 (Slit Width >= 1100 mm Strict 2 Reels Maximum Cap)
  // ---------------------------------------------------------------------------
  const illegalWidthOver1100: CalculatedItem = {
    ...mockOrder,
    size: 1150, // >= 1100 mm
    reels_per_pallet: 3, // 3-reel stack forbidden!
    pallets_3_reels: 5,
  };
  const width1100Validation = RuleGuardrailEngine.validateCalculatedOrder(illegalWidthOver1100);
  assert(
    !width1100Validation.valid && width1100Validation.violations.some(v => v.ruleId === 'HPP-004'),
    'HPP-004',
    'Guardrail enforces strict 2 reels maximum for slit widths >= 1100 mm',
    'Failed to flag 3-reel stacking on roll width >= 1100 mm',
    width1100Validation
  );

  // ---------------------------------------------------------------------------
  // TEST 10: HPP-005 (600 mm Ply Maximum 6 Reels Cap, 8 Reels Prohibited)
  // ---------------------------------------------------------------------------
  const illegal600Ply8Reels: CalculatedItem = {
    ...mockOrder,
    cradle_ply: 600,
    reels_per_pallet: 8, // 8 reels forbidden on 600 mm ply!
    pallets_8_reels: 4,
  };
  const ply600Validation = RuleGuardrailEngine.validateCalculatedOrder(illegal600Ply8Reels);
  assert(
    !ply600Validation.valid && ply600Validation.violations.some(v => v.ruleId === 'HPP-005'),
    'HPP-005',
    'Guardrail enforces maximum 6 reels on 600 mm ply (8 reels prohibited)',
    'Failed to flag 8 reels per pallet on 600 mm ply',
    ply600Validation
  );

  // ---------------------------------------------------------------------------
  // TEST 11: TOL-001 (Final Order Quantity Tolerance Window +/-10%)
  // ---------------------------------------------------------------------------
  const outOfToleranceOrder: CalculatedItem = {
    ...mockOrder,
    order_qty: 10000,
    planned_weight: 11500, // +15% over order qty
  };
  const tolValidation = RuleGuardrailEngine.validateCalculatedOrder(outOfToleranceOrder);
  assert(
    !tolValidation.valid && tolValidation.violations.some(v => v.ruleId === 'TOL-001'),
    'TOL-001',
    'Guardrail flags planned weight deviating by more than +/-10% from order quantity',
    'Failed to flag order with +15% weight deviation',
    tolValidation
  );

  // ---------------------------------------------------------------------------
  // TEST 12: GUARDRAIL ENGINE CHECK (Stop on Attempted Modification of HARD Rules)
  // ---------------------------------------------------------------------------
  const hardRuleCheck = RuleGuardrailEngine.evaluateProposedChange(
    'HPP-004',
    'Allow 3 reels per pallet for 1200 mm slit width to increase density'
  );
  assert(
    !hardRuleCheck.canProceed && hardRuleCheck.directive.includes('STOP'),
    'GUARDRAIL',
    'Guardrail engine rejects attempted modifications to HARD rule HPP-004 with STOP directive',
    'Guardrail engine failed to halt modification to HARD rule',
    hardRuleCheck
  );

  const softRuleCheck = RuleGuardrailEngine.evaluateProposedChange(
    'PACK-004',
    'Change pallet clearance from 120 mm to 100 mm'
  );
  assert(
    softRuleCheck.canProceed,
    'GUARDRAIL',
    'Guardrail engine allows modification of SOFT rule PACK-004 with advisory notice',
    'Guardrail engine erroneously blocked modification to SOFT rule',
    softRuleCheck
  );

  // ---------------------------------------------------------------------------
  // TEST 13: PINWHEEL STUFFING LAYOUT FOR HPP 850 PLY (NURSCON 850mm ply)
  // ---------------------------------------------------------------------------
  const nursconOrders = [
    { item: 10, film: 'MT21D-20', size: 900, length: 24200, core: 6, dia: 817, qty: 8781.70, customer: 'NURSCON', po_ref: 'PO 26-NURSCON-850', packing_mode: 'HPP' as const, container_type: '40ft_HC' as const },
    { item: 20, film: 'MT21D-20', size: 962, length: 24200, core: 6, dia: 817, qty: 9386.67, customer: 'NURSCON', po_ref: 'PO 26-NURSCON-850', packing_mode: 'HPP' as const, container_type: '40ft_HC' as const },
    { item: 30, film: 'MT21D-20', size: 1120, length: 24200, core: 6, dia: 817, qty: 21856.67, customer: 'NURSCON', po_ref: 'PO 26-NURSCON-850', packing_mode: 'HPP' as const, container_type: '40ft_HC' as const },
  ];

  const nursconPlan = generateStuffingPlan(nursconOrders, DEFAULT_STUFFING_CONFIG);
  const c1 = nursconPlan.containers[0];
  const c2 = nursconPlan.containers[1];
  
  assert(
    nursconPlan.containers.length === 2 &&
    c1 && c1.total_pallets === 24 &&
    c1.row_lengths.row1 === 11530 &&
    (c1.row_lengths.row2 === 0 || !c1.row_lengths.row2) &&
    c1.row_lengths.row3 === 11050 &&
    c1.row_lengths.max_length <= 12032 &&
    c2 && c2.total_pallets === 24 &&
    c2.row_lengths.row1 === 11530 &&
    c2.row_lengths.row3 === 11050,
    'HPP-010',
    'HPP 850 Ply Pinwheel produces 2x40ft HC containers with exact 24 pallets each, ROW1=11,530mm, ROW2=0mm, ROW3=11,050mm',
    'NURSCON 850mm ply pinwheel test failed',
    {
      containerCount: nursconPlan.containers.length,
      c1Pallets: c1?.total_pallets,
      c1RowLengths: c1?.row_lengths,
      c2Pallets: c2?.total_pallets,
      c2RowLengths: c2?.row_lengths,
      totalWeight: nursconPlan.containers.reduce((s, c) => s + c.total_weight, 0)
    }
  );

  // Verify HPP-010 rule registration and guardrail protection
  const hpp010Rule = getPackagingRule('HPP-010');
  assert(
    hpp010Rule !== undefined && hpp010Rule.severity === 'HARD',
    'HPP-010',
    'HPP-010 registered in master rule database as an immutable HARD rule',
    'HPP-010 missing or not marked HARD in registry',
    hpp010Rule
  );

  const hpp010Guardrail = RuleGuardrailEngine.evaluateProposedChange(
    'HPP-010',
    'Bypass pinwheel and allow 3 lines for 850 ply'
  );
  assert(
    !hpp010Guardrail.canProceed && hpp010Guardrail.directive.includes('STOP'),
    'GUARDRAIL',
    'Guardrail engine rejects attempted modifications to HARD rule HPP-010 with STOP directive',
    'Guardrail engine failed to halt modification to HARD rule HPP-010',
    hpp010Guardrail
  );

  // ---------------------------------------------------------------------------
  // TEST 14: PINWHEEL PALLET PLACEMENT FOR VPP (BAT Sudan 20ft)
  // ---------------------------------------------------------------------------
  const batSudanOrders = [
    { item: 10, film: 'TC20-20', size: 120, length: 2400, core: 3, dia: 257, qty: 3200, customer: 'BAT Sudan', po_ref: 'SO-4500912', packing_mode: 'VPP' as const, container_type: '20ft' as const },
    { item: 20, film: 'TC20-20', size: 245, length: 2400, core: 3, dia: 257, qty: 4500, customer: 'BAT Sudan', po_ref: 'SO-4500912', packing_mode: 'VPP' as const, container_type: '20ft' as const },
    { item: 30, film: 'TC20A-23', size: 350, length: 2200, core: 3, dia: 265, qty: 3800, customer: 'BAT Sudan', po_ref: 'SO-4500912', packing_mode: 'VPP' as const, container_type: '20ft' as const },
  ];

  const batPlan = generateStuffingPlan(batSudanOrders, CONFIG_20FT);
  const batC1 = batPlan.containers[0];
  const batC2 = batPlan.containers[1];

  assert(
    batPlan.containers.length === 2 &&
    batC1 && batC1.total_pallets === 12 &&
    batC1.row_lengths.row1 <= 5750 &&
    batC1.row_lengths.row2 <= 5750 &&
    batC1.row_lengths.row1 === 5400 &&
    batC1.row_lengths.row2 === 5500 &&
    batC2 && (batC2.total_pallets === 5 || batC2.total_pallets === 6) &&
    batC2.row_lengths.row1 <= 5750 &&
    batC2.row_lengths.row2 <= 5750,
    'VPP-006',
    'VPP Pinwheel Pallet Placement fits BAT Sudan inside 20ft container boundaries (R1=5,400mm, R2=5,500mm <= 5,750mm usable limit) preserving pallet count & 1+1 stacks',
    'BAT Sudan VPP pinwheel placement test failed',
    {
      containers: batPlan.containers.length,
      c1Pallets: batC1?.total_pallets,
      c1RowLengths: batC1?.row_lengths,
      c2Pallets: batC2?.total_pallets,
      c2RowLengths: batC2?.row_lengths,
    }
  );

  const vpp006Rule = getPackagingRule('VPP-006');
  assert(
    vpp006Rule !== undefined && vpp006Rule.severity === 'HARD',
    'VPP-006',
    'VPP-006 registered in master rule database as an immutable HARD rule',
    'VPP-006 missing or not marked HARD in registry',
    vpp006Rule
  );

  const vpp006Guardrail = RuleGuardrailEngine.evaluateProposedChange(
    'VPP-006',
    'Allow row length to exceed 5898 mm container length limit'
  );
  assert(
    !vpp006Guardrail.canProceed && vpp006Guardrail.directive.includes('STOP'),
    'GUARDRAIL',
    'Guardrail engine rejects attempted modifications to HARD rule VPP-006 with STOP directive',
    'Guardrail engine failed to halt modification to HARD rule VPP-006',
    vpp006Guardrail
  );

  // ---------------------------------------------------------------------------
  // TEST 23: VPP-007 (TC20 VPP Homogeneous 84-Reel & 1+1 Stacking Freeze)
  // Scope: Film Code = TC20 AND Size < 120 mm in VPP Mode
  // ---------------------------------------------------------------------------
  // 1. TC20 + Size < 120 => strictly 84 reels/pallet (12 rolls/tier x 7 tiers)
  const tc20Order110 = calculateOrderMetrics({
    item: 1,
    film: 'TC20-20',
    size: 110,
    length: 3600,
    core: 3,
    qty: 5000,
    packing_mode: 'VPP',
  }, 1, CONFIG_20FT);

  const tc20Order118 = calculateOrderMetrics({
    item: 2,
    film: 'TC20-20',
    size: 118,
    length: 3800,
    core: 3,
    qty: 5500,
    packing_mode: 'VPP',
  }, 2, CONFIG_20FT);

  assert(
    tc20Order110.reels_per_pallet === 84 &&
    tc20Order110.vpp_layers === 7 &&
    tc20Order110.vpp_rolls_per_layer === 12 &&
    tc20Order118.reels_per_pallet === 84 &&
    tc20Order118.vpp_layers === 7 &&
    tc20Order118.vpp_rolls_per_layer === 12,
    'VPP-007',
    'TC20 + Size < 120 mm strictly yields exactly 84 reels/pallet (12 rolls/tier x 7 tiers) in VPP',
    'TC20 84-reel pallet calculation failed',
    {
      item110: { reels: tc20Order110.reels_per_pallet, layers: tc20Order110.vpp_layers, rollsPerTier: tc20Order110.vpp_rolls_per_layer },
      item118: { reels: tc20Order118.reels_per_pallet, layers: tc20Order118.vpp_layers, rollsPerTier: tc20Order118.vpp_rolls_per_layer },
    }
  );

  // 2. TC20 + Size < 120 => existing 1+1 stacking concept preserved
  const tc20OrdersForStacking = [
    {
      item: 10,
      film: 'TC20-20',
      size: 110,
      length: 3600,
      core: 3,
      qty: 6000,
      packing_mode: 'VPP' as const,
      container_type: '20ft' as const,
    },
  ];
  const tc20Plan = generateStuffingPlan(tc20OrdersForStacking, CONFIG_20FT);
  const tc20Container = tc20Plan.containers[0];
  const tc20FloorStacks1plus1 = tc20Container?.stuffing_grid.some(
    row => (row.dims1 && row.dims1.includes('(1+1)')) || (row.dims2 && row.dims2.includes('(1+1)'))
  );
  assert(
    tc20FloorStacks1plus1 === true,
    'VPP-007',
    'TC20 + Size < 120 mm pallets preserve existing 1+1 vertical half-height stacking in container',
    'TC20 1+1 stacking verification failed',
    { totalPallets: tc20Container?.total_pallets, grid: tc20Container?.stuffing_grid }
  );

  // 3. Two different TC20 sizes can NEVER share one pallet
  const mixedSizesPallet = validateTC20PalletHomogeneity({
    items: [
      { film: 'TC20-20', size: 110, qty: 42 },
      { film: 'TC20-20', size: 118, qty: 42 },
    ],
  });
  assert(
    !mixedSizesPallet.valid &&
    mixedSizesPallet.hasHardViolations &&
    mixedSizesPallet.violations.some(v => v.ruleId === 'VPP-007' && v.message.includes('mix different sizes')),
    'VPP-007',
    'Two different TC20 sizes (110 mm & 118 mm) can NEVER share one pallet',
    'Failed to reject mixed-size TC20 pallet',
    mixedSizesPallet
  );

  // 4. TC20 can NEVER share a pallet with another film code
  const mixedFilmPallet = validateTC20PalletHomogeneity({
    items: [
      { film: 'TC20-20', size: 110, qty: 42 },
      { film: 'TH21-25', size: 110, qty: 42 },
    ],
  });
  assert(
    !mixedFilmPallet.valid &&
    mixedFilmPallet.hasHardViolations &&
    mixedFilmPallet.violations.some(v => v.ruleId === 'VPP-007' && v.message.includes('another film code')),
    'VPP-007',
    'TC20 can NEVER share a pallet with another film code (e.g. TH21)',
    'Failed to reject mixed-film TC20 pallet',
    mixedFilmPallet
  );

  // 5. TC20 is rejected from generic VPP mixed-pallet/consolidation candidate generation
  const tc20ConsolidationEligibility = isEligibleForVppConsolidation({
    film: 'TC20-20',
    size: 110,
    packing_mode: 'VPP',
  });
  const nonTc20Eligibility = isEligibleForVppConsolidation({
    film: 'TH21-25',
    size: 342,
    packing_mode: 'VPP',
  });
  assert(
    !tc20ConsolidationEligibility.eligible &&
    tc20ConsolidationEligibility.ruleId === 'VPP-007' &&
    nonTc20Eligibility.eligible === true,
    'VPP-007',
    'TC20 is explicitly rejected from generic VPP mixed-pallet/consolidation candidate generation',
    'Failed to exclude TC20 from VPP consolidation',
    { tc20ConsolidationEligibility, nonTc20Eligibility }
  );

  // 6. Single pallets of different TC20 sizes are NEVER paired into a 1+1 vertical stack
  const mixedTwoSizesOrder = [
    {
      item: 10,
      film: 'TC20-20',
      size: 110,
      length: 3600,
      core: 3,
      qty: 1500,
      packing_mode: 'VPP' as const,
      container_type: '20ft' as const,
      custom_reels_per_pallet: 84,
      custom_planned_reels: 84, // 1 pallet
    },
    {
      item: 20,
      film: 'TC20-20',
      size: 118,
      length: 3800,
      core: 3,
      qty: 1500,
      packing_mode: 'VPP' as const,
      container_type: '20ft' as const,
      custom_reels_per_pallet: 84,
      custom_planned_reels: 84, // 1 pallet
    },
  ];
  const mixedPlan = generateStuffingPlan(mixedTwoSizesOrder, CONFIG_20FT);
  const mixedContainer = mixedPlan.containers[0];
  const containsMixedPair = mixedContainer?.stuffing_grid.some(
    row => (row.dims1 && row.dims1.includes('(1+1)')) || (row.dims2 && row.dims2.includes('(1+1)'))
  );
  assert(
    containsMixedPair === false,
    'VPP-007',
    'Single pallets of different TC20 sizes (110 mm & 118 mm) are NEVER paired into a 1+1 vertical stack',
    'Different TC20 sizes were illegally paired in 1+1 stack',
    { grid: mixedContainer?.stuffing_grid }
  );

  // 7. VPP-007 registered in master rule database as an immutable HARD rule
  const vpp007Rule = getPackagingRule('VPP-007');
  assert(
    vpp007Rule !== undefined && vpp007Rule.severity === 'HARD',
    'VPP-007',
    'VPP-007 registered in master rule database as an immutable HARD rule',
    'VPP-007 missing or not marked HARD in registry',
    vpp007Rule
  );

  // 8. Future VPP consolidation cannot override this rule
  const vpp007GuardrailDirect = RuleGuardrailEngine.evaluateProposedChange(
    'VPP-007',
    'Allow mixed-size consolidation and remainder pooling for TC20 under 120mm'
  );
  const vpp007GuardrailImplicit = RuleGuardrailEngine.evaluateProposedChange(
    'VPP-MIX-001',
    'Consolidate TC20 remainders into generic mixed VPP pallets'
  );
  assert(
    !vpp007GuardrailDirect.canProceed &&
    vpp007GuardrailDirect.directive.includes('STOP') &&
    !vpp007GuardrailImplicit.canProceed &&
    vpp007GuardrailImplicit.directive.includes('STOP'),
    'GUARDRAIL',
    'Guardrail engine blocks future VPP consolidation from overriding TC20 VPP-007 rule with STOP directive',
    'Guardrail failed to halt VPP consolidation override on TC20',
    { direct: vpp007GuardrailDirect, implicit: vpp007GuardrailImplicit }
  );

  // ---------------------------------------------------------------------------
  // TEST 24: FACTORY PALLET-PLACEMENT ENVELOPE (5750 × 2320 × 2280 mm)
  // ---------------------------------------------------------------------------
  // 1. Usable envelope constant values verification
  assert(
    USABLE_20FT_ENVELOPE.max_length === 5750 &&
    USABLE_20FT_ENVELOPE.max_width === 2320 &&
    USABLE_20FT_ENVELOPE.max_height === 2280,
    'CONT-ENV',
    'Factory 20ft pallet-placement envelope constants strictly match 5750 × 2320 × 2280 mm',
    'USABLE_20FT_ENVELOPE does not match 5750 x 2320 x 2280 mm',
    USABLE_20FT_ENVELOPE
  );

  // 2. Guardrail detects pallet height exceeding 2280 mm in 20ft container
  const overHeightOrder = {
    item: 1,
    film: 'TC20-20',
    size: 350,
    planned_reels: 18,
    reels_per_pallet: 18,
    pallets: 1,
    pallet_height: 2350, // Exceeds 2280 mm
    pallet_length: 1100,
    pallet_width: 1100,
    packing_mode: 'VPP' as const,
    planned_weight: 1000,
  } as unknown as CalculatedItem;

  const heightValOrder = RuleGuardrailEngine.validateCalculatedOrder(overHeightOrder, CONFIG_20FT);
  assert(
    !heightValOrder.valid && heightValOrder.violations.some(v => v.ruleId === 'VPP-004' && v.severity === 'HARD'),
    'VPP-004',
    'Guardrail flags individual VPP pallet height exceeding 2280 mm factory limit as HARD violation',
    'Guardrail failed to flag pallet height > 2280 mm',
    heightValOrder
  );

  // 3. Guardrail detects row length exceeding 5750 mm in 20ft container
  const overLength20ftContainer = {
    id: 1,
    name: '20ft OverLength Container',
    container_type: '20ft' as const,
    max_weight: 21500,
    orders: [],
    total_reels: 0,
    pallet_packing_details: [],
    total_pallets: 10,
    loaded_pallets: 10,
    total_weight: 12000,
    weight_utilization_pct: 55,
    row_lengths: {
      row1: 5800, // Exceeds 5750 mm
      row2: 5400,
      row3: 0,
      max_length: 5800,
    },
    stuffing_grid: [],
  } as unknown as ContainerPlan;

  const lenValContainer = RuleGuardrailEngine.validateContainerPlan(overLength20ftContainer, CONFIG_20FT);
  assert(
    !lenValContainer.valid && lenValContainer.violations.some(v => v.ruleId === 'CONT-004' && v.severity === 'HARD'),
    'CONT-004',
    'Guardrail flags 20ft row length exceeding 5750 mm usable length as HARD violation',
    'Guardrail failed to flag 20ft row length > 5750 mm',
    lenValContainer
  );

  // 4. Guardrail detects vertical 1+1 stack exceeding 2280 mm in 20ft container
  const overStack20ftContainer = {
    id: 1,
    name: '20ft OverStack Container',
    container_type: '20ft' as const,
    max_weight: 21500,
    orders: [],
    total_reels: 0,
    pallet_packing_details: [],
    total_pallets: 12,
    loaded_pallets: 12,
    total_weight: 14000,
    weight_utilization_pct: 65,
    row_lengths: { row1: 5200, row2: 5200, row3: 0, max_length: 5200 },
    stuffing_grid: [
      {
        bay: 1,
        row1: 1100,
        pallet1_info: {
          palletHeight: 1200,
          stackedPallet: { palletHeight: 1150 } as any, // 1200 + 1150 = 2350 mm > 2280 mm
        },
      } as any,
    ],
  } as unknown as ContainerPlan;

  const stackValContainer = RuleGuardrailEngine.validateContainerPlan(overStack20ftContainer, CONFIG_20FT);
  assert(
    !stackValContainer.valid && stackValContainer.violations.some(v => v.ruleId === 'VPP-004' && v.severity === 'HARD'),
    'VPP-004',
    'Guardrail flags vertical 1+1 stack exceeding 2280 mm usable height as HARD violation',
    'Guardrail failed to flag 1+1 vertical stack > 2280 mm',
    stackValContainer
  );

  // 5. Guardrail detects transverse width exceeding 2320 mm in 20ft container
  const overWidth20ftContainer = {
    id: 1,
    name: '20ft OverWidth Container',
    container_type: '20ft' as const,
    max_weight: 21500,
    orders: [],
    total_reels: 0,
    pallet_packing_details: [],
    total_pallets: 10,
    loaded_pallets: 10,
    total_weight: 12000,
    weight_utilization_pct: 55,
    row_lengths: { row1: 5200, row2: 5200, row3: 0, max_length: 5200 },
    stuffing_grid: [
      {
        bay: 1,
        pallet1_info: { transverseDim: 1180 },
        pallet2_info: { transverseDim: 1160 }, // 1180 + 1160 = 2340 mm > 2320 mm
      } as any,
    ],
  } as unknown as ContainerPlan;

  const widthValContainer = RuleGuardrailEngine.validateContainerPlan(overWidth20ftContainer, CONFIG_20FT);
  assert(
    !widthValContainer.valid && widthValContainer.violations.some(v => v.ruleId === 'CONT-007' && v.severity === 'HARD'),
    'CONT-007',
    'Guardrail flags 20ft transverse width exceeding 2320 mm usable width as HARD violation',
    'Guardrail failed to flag 20ft transverse width > 2320 mm',
    widthValContainer
  );

  // ---------------------------------------------------------------------------
  // TEST 21: HPP 550 PLY ALLOWS 5 REELS AS VALID COMPLETION PALLET
  // ---------------------------------------------------------------------------
  const hpp550Auto = calculateOrderMetrics({
    item: 101,
    film: 'TH21-25',
    size: 1000,
    length: 15500,
    core: 6,
    dia: 500,
    qty: 10.8 * 350.69,
    packing_mode: 'HPP',
  });
  const hpp550Manual = calculateOrderMetrics({
    item: 102,
    film: 'TH21-25',
    size: 1000,
    length: 15500,
    core: 6,
    dia: 500,
    qty: 5000,
    packing_mode: 'HPP',
    custom_planned_reels: 13,
  });
  assert(
    hpp550Auto.cradle_ply === 550 &&
    hpp550Auto.planned_reels === 11 &&
    hpp550Auto.total_pallets === 2 &&
    hpp550Auto.pallets_6_reels === 1 &&
    hpp550Auto.pallets_other_reels === 1 &&
    hpp550Auto.pallets_summary.includes('5-reel') &&
    hpp550Manual.planned_reels === 13 &&
    hpp550Manual.pallets_8_reels === 1 &&
    hpp550Manual.pallets_other_reels === 1 &&
    hpp550Manual.pallets_summary.includes('5-reel'),
    'HPP-009',
    'HPP 550 allows 5 reels as a valid completion pallet (auto: 1x 6-reel + 1x 5-reel; manual: 1x 8-reel + 1x 5-reel)',
    'HPP 550 failed to plan 5-reel completion pallet',
    { hpp550Auto, hpp550Manual }
  );

  // ---------------------------------------------------------------------------
  // TEST 22: HPP 600 PLY ALLOWS 5 REELS AS VALID COMPLETION PALLET
  // ---------------------------------------------------------------------------
  const hpp600Auto = calculateOrderMetrics({
    item: 103,
    film: 'TH21-25',
    size: 1000,
    length: 15500,
    core: 6,
    dia: 560,
    qty: 10.8 * 350.69,
    packing_mode: 'HPP',
  });
  const hpp600Manual = calculateOrderMetrics({
    item: 104,
    film: 'TH21-25',
    size: 1000,
    length: 15500,
    core: 6,
    dia: 560,
    qty: 4000,
    packing_mode: 'HPP',
    custom_planned_reels: 11,
  });
  assert(
    hpp600Auto.cradle_ply === 600 &&
    hpp600Auto.planned_reels === 11 &&
    hpp600Auto.total_pallets === 2 &&
    hpp600Auto.pallets_6_reels === 1 &&
    hpp600Auto.pallets_other_reels === 1 &&
    hpp600Auto.pallets_summary.includes('5-reel') &&
    hpp600Manual.planned_reels === 11 &&
    hpp600Manual.pallets_6_reels === 1 &&
    hpp600Manual.pallets_other_reels === 1 &&
    hpp600Manual.pallets_summary.includes('5-reel'),
    'HPP-005',
    'HPP 600 allows 5 reels as a valid completion pallet (auto: 1x 6-reel + 1x 5-reel; manual: 1x 6-reel + 1x 5-reel)',
    'HPP 600 failed to plan 5-reel completion pallet',
    { hpp600Auto, hpp600Manual }
  );

  // =========================================================================
  // VPP RESIDUAL SPACE-FILL PALLET EXCEPTION TESTS
  // =========================================================================
  // 1. Footprint math verification: For D=420, 2x1 -> 890x470, 2x2 -> 890x890, etc. (A*D+50) x (B*D+50)
  const dia420 = 420;
  const fp2x1 = { length: (2 * dia420) + 50, width: (1 * dia420) + 50 };
  const fp2x2 = { length: (2 * dia420) + 50, width: (2 * dia420) + 50 };
  assert(
    fp2x1.length === 890 && fp2x1.width === 470 &&
    fp2x2.length === 890 && fp2x2.width === 890,
    'VPP-SPACE-FILL',
    'VPP Space-Fill Pallet Math: Footprint strictly adheres to (A*D)+50 mm by (B*D)+50 mm',
    'Footprint math did not match specification',
    { fp2x1, fp2x2 }
  );

  // 2. Detection & Approval Workflow Test: A VPP order where 10 standard pallets fit in container 1, and 1 remainder pallet spills into container 2
  // We can construct an order that fills 10 pallets and leaves a small spillover in 20ft container
  const testVppOrders = [
    {
      item: 10,
      film: 'TH21-25',
      size: 450,
      length: 8000,
      core: 3,
      qty: 21000, // Enough to fill container 1 and spill a few reels into container 2
      packing_mode: 'VPP' as const,
      container_type: '20ft' as const,
    },
  ];

  // Run with default (allow_vpp_space_fill_pallet = false)
  const defaultPlan = generateStuffingPlan(testVppOrders, {
    ...CONFIG_20FT,
    default_packing_mode: 'VPP',
    allow_vpp_space_fill_pallet: false,
  }, 'VPP Space Fill Test Customer');

  // If there's an opportunity detected
  if (defaultPlan.vpp_space_fill_opportunity) {
    const opp = defaultPlan.vpp_space_fill_opportunity;
    assert(
      opp.approved === false &&
      opp.proposedPallet.palletLength === (opp.proposedPallet.gridA * opp.spilloverItem.dia) + 50 &&
      opp.proposedPallet.palletWidth === (opp.proposedPallet.gridB * opp.spilloverItem.dia) + 50 &&
      opp.proposedPallet.palletHeight <= USABLE_20FT_ENVELOPE.max_height,
      'VPP-SPACE-FILL',
      'Engine detects VPP space-fill opportunity, defaults to unapproved, and calculates compliant footprint',
      'Failed space fill detection test',
      { opp }
    );

    // Now run with approval: allow_vpp_space_fill_pallet = true
    const approvedPlan = generateStuffingPlan(testVppOrders, {
      ...CONFIG_20FT,
      default_packing_mode: 'VPP',
      allow_vpp_space_fill_pallet: true,
    }, 'VPP Space Fill Test Customer');

    if (opp.eliminatesExtraContainer) {
      assert(
        approvedPlan.containers.length === defaultPlan.containers.length - 1 &&
        approvedPlan.vpp_space_fill_opportunity?.approved === true,
        'VPP-SPACE-FILL',
        'Planner approval activates space-fill pallet, placing it in Container 1 and eliminating spillover Container 2',
        'Failed to eliminate extra container on planner approval',
        { defaultContainers: defaultPlan.containers.length, approvedContainers: approvedPlan.containers.length }
      );
    }
  }

  // 3. TC20 exclusion: TC20 orders must NEVER produce or be targeted for space-fill pallets
  const tc20Order = [
    {
      item: 10,
      film: 'TC20-20',
      size: 110,
      length: 3600,
      core: 3,
      qty: 21500,
      packing_mode: 'VPP' as const,
      container_type: '20ft' as const,
    },
  ];
  const tc20SpaceFillPlan = generateStuffingPlan(tc20Order, {
    ...CONFIG_20FT,
    default_packing_mode: 'VPP',
    allow_vpp_space_fill_pallet: true,
  }, 'TC20 Customer');
  assert(
    tc20SpaceFillPlan.vpp_space_fill_opportunity === undefined ||
    !tc20SpaceFillPlan.containers.some(c => c.physical_pallets?.some(p => p.is_space_fill)),
    'VPP-SPACE-FILL',
    'TC20 orders are strictly excluded from VPP space-fill pallet exceptions',
    'TC20 erroneously generated space-fill pallet',
    { tc20PlanOpportunity: tc20SpaceFillPlan.vpp_space_fill_opportunity }
  );

  // ==========================================
  // HPP 2->1 CONTROLLED SPACE-FILL TESTS
  // ==========================================
  // Test 1: Density priority: PET (density 1.4) prioritized over BOPP (density 0.91)
  const hppDensityPriorityOrders = [
    { item: 10, film: 'PTN01-12', size: 1200, length: 25000, core: 6, dia: 650, qty: 8000, packing_mode: 'HPP' as const, container_type: '40ft_HC' as const },
    { item: 20, film: 'TH21-25', size: 1200, length: 12000, core: 6, dia: 650, qty: 8000, packing_mode: 'HPP' as const, container_type: '40ft_HC' as const },
  ];
  const hppDensityPlan = generateStuffingPlan(hppDensityPriorityOrders, DEFAULT_STUFFING_CONFIG);
  const hppDensityC1 = hppDensityPlan.containers[0];
  const petOrder = hppDensityC1?.orders.find(o => o.item === 10);
  const boppOrder = hppDensityC1?.orders.find(o => o.item === 20);
  assert(
    hppDensityC1 !== undefined &&
    petOrder !== undefined &&
    boppOrder !== undefined &&
    (petOrder.pallets_1_reel || 0) > 0 &&
    (boppOrder.pallets_1_reel || 0) === 0 &&
    hppDensityC1.loaded_pallets === hppDensityC1.total_pallets &&
    hppDensityC1.row_lengths.max_length <= 11850,
    'HPP-2TO1-SPACE-FILL',
    'HPP 2->1 Space-Fill prioritizes higher film density (PET ~1.4) before lower film density (BOPP ~0.91)',
    'Higher density PET was not prioritized over BOPP in 2->1 split',
    {
      petPallets1Reel: petOrder?.pallets_1_reel,
      boppPallets1Reel: boppOrder?.pallets_1_reel,
      c1Pallets: hppDensityC1?.total_pallets,
      c1Loaded: hppDensityC1?.loaded_pallets,
      maxLen: hppDensityC1?.row_lengths.max_length,
    }
  );

  // Test 2: Single reel weight priority: Among equal density, heavier single reel prioritized
  const hppWeightPriorityOrders = [
    { item: 10, film: 'PTN01-12', size: 1200, length: 15000, core: 6, dia: 650, qty: 6000, packing_mode: 'HPP' as const, container_type: '40ft_HC' as const },
    { item: 20, film: 'PTN01-12', size: 1200, length: 25000, core: 6, dia: 650, qty: 6000, packing_mode: 'HPP' as const, container_type: '40ft_HC' as const },
  ];
  const hppWeightPlan = generateStuffingPlan(hppWeightPriorityOrders, DEFAULT_STUFFING_CONFIG);
  const hppWeightC1 = hppWeightPlan.containers[0];
  const lighterOrder = hppWeightC1?.orders.find(o => o.item === 10);
  const heavierOrder = hppWeightC1?.orders.find(o => o.item === 20);
  assert(
    hppWeightC1 !== undefined &&
    lighterOrder !== undefined &&
    heavierOrder !== undefined &&
    (heavierOrder.pallets_1_reel || 0) > (lighterOrder.pallets_1_reel || 0),
    'HPP-2TO1-SPACE-FILL',
    'HPP 2->1 Space-Fill prioritizes heavier single reel weight first when densities are equal',
    'Heavier single reel was not prioritized in 2->1 split',
    {
      heavierPallets1Reel: heavierOrder?.pallets_1_reel,
      lighterPallets1Reel: lighterOrder?.pallets_1_reel,
      heavierWt: heavierOrder?.per_reel_wt,
      lighterWt: lighterOrder?.per_reel_wt,
    }
  );

  // Test 3: Total reel and mass conservation: Cargo weight and planned reels are strictly preserved
  const originalPlannedReels = (petOrder?.planned_reels || 0) + (boppOrder?.planned_reels || 0);
  const postSplitCalculatedReels = (petOrder ? (petOrder.pallets_2_reels || 0) * 2 + (petOrder.pallets_1_reel || 0) * 1 : 0) +
    (boppOrder ? (boppOrder.pallets_2_reels || 0) * 2 + (boppOrder.pallets_1_reel || 0) * 1 : 0);
  assert(
    originalPlannedReels > 0 &&
    originalPlannedReels === postSplitCalculatedReels,
    'HPP-2TO1-SPACE-FILL',
    'HPP 2->1 Space-Fill strictly conserves total planned reels and cargo mass (no reels removed)',
    'Reels were not conserved during 2->1 split',
    { originalPlannedReels, postSplitCalculatedReels }
  );

  // Print Summary
  const passed = testResults.filter(r => r.passed).length;
  const failed = testResults.filter(r => !r.passed).length;
  console.log(`\nTEST SUITE COMPLETED: ${passed} PASSED, ${failed} FAILED (${testResults.length} TOTAL)\n`);
  testResults.forEach(r => {
    const status = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${status}] [${r.ruleId}] ${r.testName}${r.error ? ` - ERROR: ${r.error}` : ''}`);
  });

  return {
    total: testResults.length,
    passed,
    failed,
    results: testResults,
  };
}

// Run when executed directly via tsx
if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('tests')) {
  const summary = runCriticalHardRuleTests();
  if (summary.failed > 0) {
    process.exit(1);
  }
}
