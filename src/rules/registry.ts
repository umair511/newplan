/**
 * PACKAGING & MATH RULES - MASTER REGISTRY
 * Single Source of Truth for all packaging, palletization, stuffing,
 * dimensions, weight, quantity, tolerance, and mathematical rules.
 *
 * EXTRACTED STRICTLY FROM THE CURRENT STABLE CODEBASE.
 *
 * CRITICAL DIRECTIVE:
 * Any future AI or code modification MUST review these rules first.
 * Modifying code to violate ANY HARD rule is strictly prohibited.
 * If a requested feature conflicts with a HARD rule, STOP and report.
 */

import { PackagingRule } from './types';

export const PACKAGING_AND_MATH_RULES: PackagingRule[] = [
  // ===========================================================================
  // CATEGORY: MATHEMATICAL RULES (MATH)
  // ===========================================================================
  {
    id: 'MATH-001',
    category: 'MATH',
    severity: 'HARD',
    name: 'Reel Weight Calculation Formula',
    description: 'Computes individual film reel net weight based on width, running length, micron thickness, and material density.',
    formulaOrConstraint: 'Per Reel Weight (kg) = Number(((Length_m * Size_mm * Density_g_cm3 * Thickness_um) / 1,000,000).toFixed(2))',
    source: 'src/services/stuffingCalculator.ts:calculateOrderMetrics (line 1156)',
    rationale: 'Fundamental physical law of mass (Mass = Volume * Density). Rounded to 2 decimal places.',
  },
  {
    id: 'MATH-002',
    category: 'MATH',
    severity: 'HARD',
    name: 'Industrial Roll Diameter Calculation Formula',
    description: 'Calculates the wound outer diameter of a roll given running length and thickness using the empirical Golden Geometry SRS formula.',
    formulaOrConstraint: 'Calculated_DIA_mm = Math.round(1.174 * Math.sqrt(Length_m * Thickness_um))',
    source: 'src/services/stuffingCalculator.ts:calculateRollDiameter (line 66)',
    rationale: 'Empirical formula from factory Golden Geometry SRS used across all automated packing routines.',
    ambiguitiesOrNotes: 'Calculated DIA = 1.174 * SQRT(Length * Thickness). Geometric annular area formula sqrt(d_core^2 + 4Lt/pi) is an alternative analytical model; the empirical SRS formula is what is actively executed in the stable engine.',
  },
  {
    id: 'MATH-003',
    category: 'MATH',
    severity: 'HARD',
    name: 'Roll Running Length from Diameter (SRS Inversion)',
    description: 'Inverts outer diameter back to running meters using the empirical SRS coefficient.',
    formulaOrConstraint: 'Length_m = Math.round((Outer_Dia_mm / 1.174)^2 / Thickness_um)',
    source: 'src/services/stuffingCalculator.ts derived from calculateRollDiameter',
    rationale: 'Inverse formulation of the active empirical roll diameter calculation.',
  },
  {
    id: 'MATH-004',
    category: 'MATH',
    severity: 'HARD',
    name: 'Discrete Pallet Integrity (No Fractional Pallets)',
    description: 'All pallets loaded into containers or planned for packing must be non-negative integer values.',
    formulaOrConstraint: 'PalletCount in Z_>=0 (Total pallets and sub-pallet counts must be whole integer numbers)',
    source: 'src/services/stuffingCalculator.ts:findOptimalPalletPlan',
    rationale: 'Physical pallets cannot be manufactured, strapped, or loaded into shipping containers in fractional quantities.',
  },
  {
    id: 'MATH-005',
    category: 'MATH',
    severity: 'HARD',
    name: 'Reel Count Conservation in Pallet Partitioning',
    description: 'The sum of reels across all configured pallet types must exactly equal total planned reels.',
    formulaOrConstraint: 'Planned_Reels = (Count_8 * 8) + (Count_6 * 6) + (Count_4 * 4) + (Count_3 * 3) + (Count_2 * 2) + (Count_Other * Reels_Other)',
    source: 'src/services/stuffingCalculator.ts:findOptimalPalletPlan & expandItemForStuffingMaster',
    rationale: 'Reel inventory must balance exactly with no phantom or missing rolls.',
  },
  {
    id: 'MATH-006',
    category: 'MATH',
    severity: 'HARD',
    name: 'Conservation of Mass Across Pallet Splits',
    description: 'When splitting mixed configurations into separate export rows, sum of split planned weights must equal order total planned weight.',
    formulaOrConstraint: 'Sum(SubPallet_Planned_Weights) === Order_Planned_Weight (Difference <= 0.01 kg rounding margin)',
    source: 'src/services/stuffingCalculator.ts:expandItemForStuffingMaster',
    rationale: 'Prevents mass discrepancies between packing list line items and shipping manifests.',
  },
  {
    id: 'MATH-007',
    category: 'MATH',
    severity: 'HARD',
    name: 'Excess / Less Quantity Formula',
    description: 'Quantifies shipment variance against customer ordered quantity.',
    formulaOrConstraint: 'Excess_Less_kg = Planned_Weight_kg - Order_Qty_kg',
    source: 'src/services/stuffingCalculator.ts:calculateOrderMetrics',
    rationale: 'Standard commercial variance metric for customs documentation and invoice balancing.',
  },
  {
    id: 'MATH-008',
    category: 'MATH',
    severity: 'HARD',
    name: 'Container Payload Weight Utilization Percentage',
    description: 'Percentage of container gross weight capacity utilized by loaded cargo.',
    formulaOrConstraint: 'Utilization_Pct = Number(((Container_Total_Weight / Container_Max_Weight) * 100).toFixed(1))',
    source: 'src/services/stuffingCalculator.ts:generateStuffingPlan',
    rationale: 'Ensures containers meet shipping line weight efficiency without overloading axles.',
  },
  {
    id: 'MATH-009',
    category: 'MATH',
    severity: 'HARD',
    name: 'Numeric Precision & Rounding Standard',
    description: 'Weights are formatted to 2 decimal places; dimensions (mm) and reel counts are rounded to integers.',
    formulaOrConstraint: 'Weights: Number(val.toFixed(2)); Dimensions: Math.round(val); Counts: Math.round(val)',
    source: 'src/services/stuffingCalculator.ts',
    rationale: 'Consistency across UI displays, database storage, and Excel workbook cell export.',
  },

  // ===========================================================================
  // CATEGORY: CONTAINER SPECIFICATIONS & LIMITS (CONT)
  // ===========================================================================
  {
    id: 'CONT-001',
    category: 'CONT',
    severity: 'HARD',
    name: '40ft High Cube Container Internal Dimensions',
    description: 'Physical interior dimensions of standard 40ft High Cube ocean container.',
    formulaOrConstraint: 'Length: 12,032 mm; Width: 2,352 mm; Internal Height: 2,698 mm; Door Height: 2,585 mm; Max Weight: 26,000 kg (default)',
    source: 'src/types/stuffing.ts:DEFAULT_STUFFING_CONFIG',
    rationale: 'ISO 668 international freight container physical manufacturing standard.',
  },
  {
    id: 'CONT-002',
    category: 'CONT',
    severity: 'HARD',
    name: '20ft Standard Container Internal Dimensions',
    description: 'Physical interior dimensions of standard 20ft general cargo ocean container.',
    formulaOrConstraint: 'Length: 5,898 mm; Width: 2,352 mm; Internal Height: 2,393 mm; Door Height: 2,280 mm; Max Weight: 21,500 kg (default)',
    source: 'src/types/stuffing.ts:CONFIG_20FT',
    rationale: 'ISO 668 container manufacturing standard for 20ft equipment.',
  },
  {
    id: 'CONT-003',
    category: 'CONT',
    severity: 'HARD',
    name: 'Container Door Ingress Height Limit',
    description: 'Pallet total vertical height must not exceed the container door opening height.',
    formulaOrConstraint: 'Pallet_Height_mm <= Container_Door_Height_mm (2,585 mm for 40ft HC, 2,280 mm for 20ft)',
    source: 'src/services/stuffingCalculator.ts:findOptimalPalletPlan & stuffing.ts',
    rationale: 'Pallets taller than the door opening cannot physically enter the container during forklift stuffing.',
    ambiguitiesOrNotes: 'Container internal height is 2,698 mm (40HC) / 2,393 mm (20ft), but usable vertical loading is gated by the door opening (2,585 mm / 2,280 mm).',
  },
  {
    id: 'CONT-004',
    category: 'CONT',
    severity: 'HARD',
    name: 'Longitudinal Fit Constraint',
    description: 'The maximum cumulative length of any loaded line/row must not exceed container internal length.',
    formulaOrConstraint: 'Max(Row1_Length, Row2_Length, Row3_Length) <= Container_Internal_Length (12,032 mm for 40ft HC, 5,898 mm for 20ft)',
    source: 'src/services/stuffingCalculator.ts:generateStuffingPlan & ContainerStuffingPlanner.tsx',
    rationale: 'Container doors cannot close if cargo length exceeds interior wall-to-door dimensions.',
  },
  {
    id: 'CONT-005',
    category: 'CONT',
    severity: 'HARD',
    name: 'Container Maximum Payload Weight Enforcement',
    description: 'Total cargo weight packed inside any single container must not exceed its configured maximum payload.',
    formulaOrConstraint: 'Container_Total_Weight <= Container_Max_Weight (Default 26,000 kg for 40HC, 21,500 kg for 20ft)',
    source: 'src/services/stuffingCalculator.ts:generateStuffingPlan',
    rationale: 'SOLAS VGM (Verified Gross Mass) regulations and highway legal axle gross vehicle weight ratings.',
  },
  {
    id: 'CONT-006',
    category: 'CONT',
    severity: 'HARD',
    name: '20ft Container 10-Pallet Floor Cap',
    description: 'In 20ft containers, physical floor space restricts loading to a maximum of 10 pallets.',
    formulaOrConstraint: 'Loaded_Pallets_20ft <= 10 (Strict limit: 2 parallel lines of 5 pallets)',
    source: 'src/services/stuffingCalculator.ts:generateStuffingPlan (lines 2011, 2697)',
    rationale: '5,898 mm internal length / approx 1,150 mm pallet width = 5 pallets per line * 2 lines = 10 pallets maximum.',
  },
  {
    id: 'CONT-007',
    category: 'CONT',
    severity: 'HARD',
    name: 'Transverse Floor Width Fit',
    description: 'Combined width of parallel pallet lines must fit within container internal width of 2,352 mm.',
    formulaOrConstraint: 'Sum(Line_Base_Widths) <= 2,352 mm (e.g. 3 lines: 3 * 765 = 2,295 mm <= 2,352 mm; 2 lines: 2 * 850 = 1,700 mm <= 2,352 mm)',
    source: 'src/services/stuffingCalculator.ts & ContainerStuffingPlanner.tsx',
    rationale: 'Pallets cannot overlap or crush against container corrugated steel side walls.',
  },

  // ===========================================================================
  // CATEGORY: GENERAL PACKAGING RULES (PACK)
  // ===========================================================================
  {
    id: 'PACK-001',
    category: 'PACK',
    severity: 'HARD',
    name: 'HPP Pallet Width Dimension Formula',
    description: 'Pallet width in Horizontal Pallet Packing is determined by roll slit width plus clearance.',
    formulaOrConstraint: 'Pallet_Width_mm = Slit_Size_mm + Pallet_Clearance_mm (default clearance = 120 mm)',
    source: 'src/services/stuffingCalculator.ts:calculateOrderMetrics',
    rationale: 'Wooden pallet base must extend beyond film roll edges to protect roll face from forklift impact.',
  },
  {
    id: 'PACK-002',
    category: 'PACK',
    severity: 'HARD',
    name: 'HPP Pallet Length Equals Cradle Ply Dimension',
    description: 'In HPP, pallet longitudinal dimension corresponds to the cradle ply depth.',
    formulaOrConstraint: 'Pallet_Length_mm = Cradle_Ply_mm (Single column: 850 or 765 mm; Double column: 2 * 600 = 1200 mm, 2 * 550 = 1100 mm)',
    source: 'src/services/stuffingCalculator.ts:calculateOrderMetrics & getPalletHeightForHPP',
    rationale: 'Cradle end-boards sit on wooden runners cut to matching ply lengths.',
  },
  {
    id: 'PACK-003',
    category: 'PACK',
    severity: 'HARD',
    name: 'Minimum 1 Reel Per Pallet Floor Limit',
    description: 'A planned pallet must carry at least one physical reel.',
    formulaOrConstraint: 'Reels_Per_Pallet >= 1',
    source: 'src/services/stuffingCalculator.ts',
    rationale: 'Empty pallets cannot be planned as cargo units.',
  },
  {
    id: 'PACK-004',
    category: 'PACK',
    severity: 'SOFT',
    name: 'Default HPP Pallet Clearance Allowance',
    description: 'Standard margin added to roll width for pallet deck dimensioning.',
    formulaOrConstraint: 'Pallet_Clearance = 120 mm (Configurable in StuffingConfig)',
    source: 'src/types/stuffing.ts:DEFAULT_STUFFING_CONFIG.pallet_clearance',
    rationale: 'Provides 60 mm overhang protection on each roll edge.',
    ambiguitiesOrNotes: 'Some older documentation noted 100 mm clearance; 120 mm is the authoritative active default in code.',
  },
  {
    id: 'PACK-005',
    category: 'PACK',
    severity: 'SOFT',
    name: 'Pallet Base Tare Height Allowances',
    description: 'Vertical height added for wooden skid deck, runners, and strapping.',
    formulaOrConstraint: 'HPP Tare = 200 mm; VPP Tare = 200 to 250 mm',
    source: 'src/services/stuffingCalculator.ts:getPalletHeightForHPP & getPalletHeightForVPP',
    rationale: 'Wooden runners and top protection boards occupy physical vertical height.',
    ambiguitiesOrNotes: 'getPalletHeightForVPP uses 250 mm as default argument, while UI documentation mentions 200 mm tare.',
  },

  // ===========================================================================
  // CATEGORY: HORIZONTAL PALLET PACKING / CRADLE RULES (HPP)
  // ===========================================================================
  {
    id: 'HPP-001',
    category: 'HPP',
    severity: 'HARD',
    name: 'Cradle Ply Selection by Roll Diameter',
    description: 'Cradle ply size is strictly determined by roll outer diameter.',
    formulaOrConstraint: 'Dia > 745 mm -> 850 mm Ply; 590 mm <= Dia <= 745 mm -> 765 mm Ply; 530 mm <= Dia < 590 mm -> 600 mm Ply; Dia < 530 mm -> 550 mm Ply',
    source: 'src/services/stuffingCalculator.ts:getPlyForDiameter',
    rationale: 'Roll curvature and notch depth in cradle boards must prevent roll shifting during transit.',
  },
  {
    id: 'HPP-002',
    category: 'HPP',
    severity: 'HARD',
    name: '3-Line Loading Width Eligibility',
    description: '3-line longitudinal loading is allowed ONLY when pallet length is <= 765 mm.',
    formulaOrConstraint: 'Has_Row3 = (Pallet_Length <= 765 mm) -> 3 * 765 = 2,295 mm <= 2,352 mm (Fit OK)',
    source: 'src/services/stuffingCalculator.ts:generateStuffingPlan & ContainerStuffingPlanner.tsx',
    rationale: 'Container internal width is 2,352 mm. 3 lines of 765 mm total 2,295 mm with 57 mm clearance.',
  },
  {
    id: 'HPP-003',
    category: 'HPP',
    severity: 'HARD',
    name: '850 mm Ply Restriction to 2 Lines Max',
    description: 'Pallets using 850 mm cradle ply cannot be loaded in 3 lines.',
    formulaOrConstraint: 'Pallet_Length === 850 mm -> Lines_Count <= 2 (Because 3 * 850 = 2,550 mm > 2,352 mm)',
    source: 'src/services/stuffingCalculator.ts:generateStuffingPlan',
    rationale: 'Loading three 850 mm pallets across the container exceeds interior container width by 198 mm.',
  },
  {
    id: 'HPP-004',
    category: 'HPP',
    severity: 'HARD',
    name: 'Slit Width >= 1100 mm Strict 2 Reels Maximum Cap',
    description: 'Rolls with slit width >= 1100 mm are strictly prohibited from stacking 3 reels per pallet.',
    formulaOrConstraint: 'If Size_mm >= 1100 mm, then Reels_Per_Pallet <= 2 (3-reel stack strictly prohibited)',
    source: 'src/services/stuffingCalculator.ts:findOptimalPalletPlan (options.isSizeOver1100)',
    rationale: 'Rolls wider than 1100 mm on a pyramid cradle create high center of gravity and lateral instability.',
  },
  {
    id: 'HPP-005',
    category: 'HPP',
    severity: 'HARD',
    name: '600 mm Ply Maximum 6 Reels Cap (8 Reels Prohibited)',
    description: 'Pallets using 600 mm cradle ply are capped at 6 reels maximum; 8 reels is strictly forbidden.',
    formulaOrConstraint: 'Cradle_Ply === 600 mm -> Reels_Per_Pallet <= 6 (8 reels never allowed)',
    source: 'src/services/stuffingCalculator.ts:findOptimalPalletPlan',
    rationale: '600 mm ply double-column structure cannot support 4 vertical tiers (8 reels) without collapse.',
  },
  {
    id: 'HPP-006',
    category: 'HPP',
    severity: 'HARD',
    name: '4-Reel Pallet Constraint for Completion Only',
    description: '4-reel pallets are strictly restricted to remainder/completion units and must satisfy tolerance.',
    formulaOrConstraint: '4-reel configuration only used as completion/remainder pallet, never as uniform primary configuration',
    source: 'src/services/stuffingCalculator.ts:findOptimalPalletPlan',
    rationale: 'Standardizing on uniform primary configurations (6, 8, 2, or 3) maintains packing stability.',
  },
  {
    id: 'HPP-007',
    category: 'HPP',
    severity: 'SOFT',
    name: 'Dia > 580 mm Default 2 Reels Per Pallet',
    description: 'Rolls with diameter > 580 mm default to 2 reels per pallet to spread weight along container floor.',
    formulaOrConstraint: 'Dia > 580 mm -> Default Reels_Per_Pallet = 2 (Pallets spread across ~11.5m container length)',
    source: 'src/services/stuffingCalculator.ts:findOptimalPalletPlan & ContainerStuffingPlanner.tsx',
    rationale: 'Spreading pallets longitudinally ensures proper axle load distribution across the container floor.',
  },
  {
    id: 'HPP-008',
    category: 'HPP',
    severity: 'SOFT',
    name: 'User Permission for 3 Reels on Dia > 580 mm',
    description: '3 reels per pallet for Dia > 580 mm is permitted only with explicit authorization when slit < 1100 mm.',
    formulaOrConstraint: '3-reel stack allowed on Dia > 580 mm ONLY IF (Size < 1100 mm AND allow3ReelsPermission === true)',
    source: 'src/services/stuffingCalculator.ts:findOptimalPalletPlan & ContainerStuffingPlanner.tsx',
    rationale: 'Allows increasing payload density to avoid container count inflation when safety conditions permit.',
  },
  {
    id: 'HPP-009',
    category: 'HPP',
    severity: 'SOFT',
    name: '550 mm Ply Standard Configuration Hierarchy',
    description: '550 mm ply defaults to 6 reels preferred, 8 reels allowed for size < 1100 mm, 4/5/7 completion.',
    formulaOrConstraint: '550 mm Ply: Preferred = 6 reels; Allowed Standard (< 1100 mm) = 8 reels; Completion = 4, 5, or 7 reels',
    source: 'src/services/stuffingCalculator.ts:findOptimalPalletPlan',
    rationale: 'Provides optimal packaging density for small diameter converter rolls.',
  },
  {
    id: 'HPP-010',
    category: 'HPP',
    severity: 'HARD',
    name: 'HPP 850 Ply Pinwheel Stuffing Layout',
    description: 'HPP 850 mm ply pallets must be loaded in a 2-line pinwheel arrangement with Row 2 / center corridor remaining empty.',
    formulaOrConstraint: 'Applies ONLY to HPP 850 Ply: 2-line pinwheel arrangement (Row 1 = Rotated 90° orientation where length footprint = pallet width; Row 2 = Strictly empty 0 mm center corridor; Row 3 = Standard 850 mm longitudinal orientation); Existing pallet dimensions and orientation rules preserved; 3-line loading strictly prohibited; Every row <= container physical length limit (12,032 mm / 5,898 mm).',
    source: 'src/services/stuffingCalculator.ts:generateRowLayoutForContainer & assignToContainers',
    rationale: 'Loading three lines of 850 mm pallets exceeds interior container width (3 * 850 = 2,550 mm > 2,352 mm). The 2-line pinwheel layout maximizes space utilization while keeping Row 2 open as a physical clearance corridor and ensuring every row remains within container physical boundaries. This rule must never be violated by future optimization changes.',
  },

  // ===========================================================================
  // CATEGORY: VERTICAL PALLET PACKING / EYE-TO-SKY RULES (VPP)
  // ===========================================================================
  {
    id: 'VPP-001',
    category: 'VPP',
    severity: 'HARD',
    name: 'Small Roll / Cigarette VPP Specification (Dia <= 360 mm)',
    description: 'Small rolls packed on 1000x1000 mm skids in 3x3 grid (9 rolls per layer).',
    formulaOrConstraint: 'Dia <= 360 mm -> Skid: 1000 x 1000 mm; Grid: 3 x 3 = 9 rolls/layer; Height = (Tiers * Size) + 200 mm',
    source: 'src/services/stuffingCalculator.ts:calculateOrderMetrics & ContainerStuffingPlanner.tsx',
    rationale: 'Standard cigarette packaging overwrap geometry (e.g. BAT Sudan 120, 245, 350 mm slits).',
  },
  {
    id: 'VPP-002',
    category: 'VPP',
    severity: 'HARD',
    name: 'Standard Slit VPP Specification (Dia 361 - 460 mm)',
    description: 'Standard slit rolls packed on 900x1300 mm skids in 2x3 grid (6 rolls per layer).',
    formulaOrConstraint: '360 mm < Dia <= 460 mm -> Skid: 900 x 1300 mm; Grid: 2 x 3 = 6 rolls/layer; Height = (Tiers * Size) + 200 mm',
    source: 'src/services/stuffingCalculator.ts:calculateOrderMetrics & ContainerStuffingPlanner.tsx',
    rationale: 'Standard slit BOPP packaging geometry (e.g. Global Packaging 620-1050 mm slits).',
  },
  {
    id: 'VPP-003',
    category: 'VPP',
    severity: 'HARD',
    name: 'VPP Pallet Vertical Height Formula',
    description: 'Height of vertical eye-to-sky pallet based on number of tiers and slit width.',
    formulaOrConstraint: 'VPP_Height_mm = (Tiers * Slit_Size_mm) + Tare_Height_mm (Tare = 200 to 250 mm)',
    source: 'src/services/stuffingCalculator.ts:getPalletHeightForVPP',
    rationale: 'Rolls stack vertically on their flat ends separated by divider sheets.',
  },
  {
    id: 'VPP-004',
    category: 'VPP',
    severity: 'HARD',
    name: 'VPP Maximum Height Ingress Limit',
    description: 'Total vertical stack height of VPP pallet must not exceed container door height.',
    formulaOrConstraint: 'VPP_Height_mm <= Container_Door_Height (2,585 mm for 40HC, 2,280 mm for 20ft)',
    source: 'src/services/stuffingCalculator.ts:getPalletHeightForVPP & findOptimalPalletPlan',
    rationale: 'Prevent crushing top layer of rolls against container door header during forklift entry.',
  },
  {
    id: 'VPP-005',
    category: 'VPP',
    severity: 'SOFT',
    name: 'VPP 20ft Container Loading Layout',
    description: '20ft container VPP loading uses 2 parallel rows (1000+1000 or 900+1300 = 2000-2200 mm width) up to 10 pallets.',
    formulaOrConstraint: '2 parallel lines across 2,352 mm width; maximum 10 pallets in 20ft container',
    source: 'src/components/ContainerStuffingPlanner.tsx (lines 1520-1523, 1663)',
    rationale: 'Fits within 2,352 mm width with 152 to 352 mm total side clearance.',
  },
  {
    id: 'VPP-006',
    category: 'VPP',
    severity: 'HARD',
    name: 'VPP Pinwheel Pallet Placement',
    description: 'VPP pallets inside the container use an optimized pinwheel-style floor placement across the two side loading lines (Row 1 & Row 2) to maintain clear corridor space and ensure row lengths never exceed the physical container length boundary.',
    formulaOrConstraint: 'VPP 2-line pinwheel: Row 1 oriented with pallet width along length, Row 2 oriented with standard length along length. Transverse width <= 2,352 mm (e.g., 900/1100 + 1100/1300 = 2,200 mm). Both row1_length <= Container_Internal_Length (5,898 mm / 12,032 mm) and row2_length <= Container_Internal_Length.',
    source: 'src/services/stuffingCalculator.ts:generateStuffingPlan',
    rationale: 'Balancing floor stacks between rotated and longitudinal orientations across Row 1 and Row 2 prevents floor length overflow beyond container boundaries (e.g. 5,898 mm for 20ft container) while keeping clear corridor space and maintaining exact pallet counts, vertical 1+1 stacks, and weights.',
  },
  {
    id: 'VPP-007',
    category: 'VPP',
    severity: 'HARD',
    name: 'TC20 VPP Homogeneous 84-Reel & 1+1 Stacking Freeze',
    description: 'Scope: Film Code = TC20 (or TC20-*) AND Size < 120 mm in VPP mode. Every qualifying TC20 order MUST use exactly 84 reels per pallet, existing TC20 84-reel pallet configuration (12 rolls/tier x 7 tiers, 250 mm tare), and existing 1+1 vertical stacking concept. Pallets MUST ALWAYS remain strictly homogeneous: never mix different sizes, never mix different film codes, never use TC20 reels as fillers, never use other reels to fill a TC20 pallet, and explicitly exclude TC20 from any VPP mixed-size/mixed-film consolidation, remainder pooling, or cross-order pallet consolidation.',
    formulaOrConstraint: 'For VPP orders where Film Code in [TC20, TC20-*] and Size < 120 mm: reels_per_pallet = 84 (12 rolls/tier x 7 tiers); 1+1 vertical stacking enabled; pallet_mix_allowed = false; consolidation_eligible = false; cross_order_fillers = false; pallet must contain 100% identical TC20 film and size.',
    source: 'src/services/stuffingCalculator.ts & src/rules/validator.ts',
    rationale: 'High-speed cigarette overwrap BOPP packaging lines (e.g. BAT Sudan, FACTORY VPP) require exact 84-reel pallet geometry (7 tiers of 12 rolls, 1+1 dual-pallet container stacking) and strict 100% film and size homogeneity without cross-contamination, remainder mixing, or dimensional variations.',
  },

  // ===========================================================================
  // CATEGORY: FILM SPECIFICATIONS & NOMENCLATURE (FILM)
  // ===========================================================================
  {
    id: 'FILM-001',
    category: 'FILM',
    severity: 'HARD',
    name: 'Film Thickness Extraction from Nomenclature',
    description: 'Film thickness in microns is parsed from the trailing numeric segment of the film code.',
    formulaOrConstraint: 'Film code e.g. "TH21-25" -> 25 um; "PTN01-12" -> 12 um; "MZ10S-18" -> 18 um; default = 20 um',
    source: 'src/services/filmDensities.ts:lookupFilmSpecs',
    rationale: 'Global flexible packaging industry naming standard for plastic films.',
  },
  {
    id: 'FILM-002',
    category: 'FILM',
    severity: 'HARD',
    name: 'Substrate Density Standards',
    description: 'Specific gravity by polymer substrate family.',
    formulaOrConstraint: 'BOPP: 0.905 - 0.910 g/cm3; BOPET / Polyester: 1.400 g/cm3; CPP / Cast PP: 0.900 - 0.905 g/cm3; BOPA / Nylon: 1.150 g/cm3',
    source: 'src/services/filmDensities.ts:FILM_DENSITIES_DATABASE',
    rationale: 'Intrinsic polymer physical densities determined by polymer chain crystallinity.',
  },
  {
    id: 'FILM-003',
    category: 'FILM',
    severity: 'HARD',
    name: 'Core Outer Diameter Standards',
    description: 'Outer diameters for 3-inch and 6-inch winding cores.',
    formulaOrConstraint: '3-inch core = 89 mm Outer Diameter; 6-inch core = 170 mm Outer Diameter',
    source: 'src/services/stuffingCalculator.ts:calculateRollDiameter & calculateRollLength',
    rationale: '3-inch core has 76.2 mm inner diameter + 6.4 mm wall * 2 = 89 mm OD; 6-inch core has 152.4 mm ID + wall = 170 mm OD.',
  },
  {
    id: 'FILM-004',
    category: 'FILM',
    severity: 'SOFT',
    name: 'Default Substrate Fallback Density',
    description: 'Fallback density when an uncataloged film code cannot be matched.',
    formulaOrConstraint: 'Fallback density = 0.905 g/cm3 (standard BOPP)',
    source: 'src/services/filmDensities.ts:lookupFilmSpecs',
    rationale: 'BOPP represents the majority of standard packaging production volume.',
  },

  // ===========================================================================
  // CATEGORY: QUANTITY & WEIGHT TOLERANCE RULES (TOL)
  // ===========================================================================
  {
    id: 'TOL-001',
    category: 'TOL',
    severity: 'HARD',
    name: 'Final Order Quantity Tolerance Window (+/-10%)',
    description: 'Planned order weight must strictly fall within +/-10% of the customer order quantity.',
    formulaOrConstraint: 'Order_Qty * 0.90 <= Planned_Weight <= Order_Qty * 1.10',
    source: 'src/services/stuffingCalculator.ts:findOptimalPalletPlan (lines 267-268)',
    rationale: 'Standard commercial packaging contract tolerance. Over-shipping or under-shipping beyond 10% causes invoice rejection.',
  },
  {
    id: 'TOL-002',
    category: 'TOL',
    severity: 'HARD',
    name: 'Drop Palletization Rule on Tolerance Breach',
    description: 'If no discrete whole-pallet combination satisfies +/-10% tolerance, palletization is dropped to 0.',
    formulaOrConstraint: 'If all candidate plans outside [0.90 * Qty, 1.10 * Qty], return 0 pallets, 0 reels, 0 planned weight with isDropped=true',
    source: 'src/services/stuffingCalculator.ts:findOptimalPalletPlan (lines 488-518)',
    rationale: 'Prevents automated generation of illegal contract shipments without human supervisor review.',
  },
  {
    id: 'TOL-003',
    category: 'TOL',
    severity: 'SOFT',
    name: 'Planning Buffer Percentage Default',
    description: 'Target multiplier applied when calculating raw required reel counts.',
    formulaOrConstraint: 'Buffer_Multiplier = 1.10 (10% over-production planning buffer, configurable in StuffingConfig)',
    source: 'src/types/stuffing.ts:DEFAULT_STUFFING_CONFIG.buffer_percentage',
    rationale: 'Accounts for slitting trim waste and start-up production yield losses.',
  },
];

/**
 * Lookup helper: Get rule by unique ID
 */
export function getPackagingRule(ruleId: string): PackagingRule | undefined {
  return PACKAGING_AND_MATH_RULES.find(r => r.id.toUpperCase() === ruleId.toUpperCase());
}

/**
 * Filter helper: Get all HARD (immutable) rules
 */
export function getHardPackagingRules(): PackagingRule[] {
  return PACKAGING_AND_MATH_RULES.filter(r => r.severity === 'HARD');
}

/**
 * Filter helper: Get all rules in a specific category
 */
export function getRulesByCategory(category: PackagingRule['category']): PackagingRule[] {
  return PACKAGING_AND_MATH_RULES.filter(r => r.category === category);
}
