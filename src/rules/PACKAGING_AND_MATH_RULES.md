# PACKAGING & MATH RULES - SINGLE SOURCE OF TRUTH

> **CRITICAL DIRECTIVE FOR ALL FUTURE AI AGENTS & DEVELOPERS:**
> This document and the associated code registry (`src/rules/registry.ts`) are the **single source of truth** for all packaging, palletization, stuffing, dimensions, weight, quantity, tolerance, and mathematical rules.
> 
> - Any future AI or code modification **MUST** review these rules first.
> - **HARD / IMMUTABLE** rules **MUST NOT** be violated, relaxed, bypassed, or overridden under any circumstances.
> - If a requested modification or prompt conflicts with a **HARD** rule, **STOP IMMEDIATELY** and report the conflict to the user instead of changing code.
> - **SOFT** rules represent operational defaults and configurable parameters that may be adjusted through configuration or explicit user consent.

---

## 1. Master Rule Summary Table

| Rule ID | Category | Severity | Name | Core Formula / Physical Constraint | Source |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **MATH-001** | MATH | **HARD** | Reel Net Weight Formula | `Weight (kg) = (Width_mm * Length_m * Thickness_um * Density_g_cm3) / 1,000,000` | `stuffingCalculator.ts:calculateReelWeight` |
| **MATH-002** | MATH | **HARD** | Roll Outer Diameter from Length | `OD = sqrt(Core_OD^2 + (4 * Length * Thickness) / (PI * 1000))` | `stuffingCalculator.ts:calculateRollDiameter` |
| **MATH-003** | MATH | **HARD** | Roll Length from Outer Diameter | `Length = (PI * (OD^2 - Core_OD^2)) / (4 * Thickness)` | `stuffingCalculator.ts:calculateRollLength` |
| **MATH-004** | MATH | **HARD** | Discrete Pallet Units | Pallet counts $\in \mathbb{Z}_{\ge 0}$ (no fractional pallets) | `stuffingCalculator.ts:findOptimalPalletPlan` |
| **MATH-005** | MATH | **HARD** | Reel Count Conservation | $\sum(\text{SubPallet Reels}) = \text{Planned Reels}$ | `stuffingCalculator.ts:expandItemForStuffingMaster` |
| **MATH-006** | MATH | **HARD** | Conservation of Mass | $\sum(\text{SubPallet Weights}) = \text{Order Planned Weight}$ ($\pm 0.01$ kg margin) | `stuffingCalculator.ts:expandItemForStuffingMaster` |
| **MATH-007** | MATH | **HARD** | Excess / Less Calculation | $\text{Excess/Less (kg)} = \text{Planned Weight} - \text{Order Qty}$ | `stuffingCalculator.ts:calculateOrderMetrics` |
| **MATH-008** | MATH | **HARD** | Weight Utilization % | $\text{Utilization \%} = (\text{Total Weight} / \text{Max Weight}) \times 100$ | `stuffingCalculator.ts:generateStuffingPlan` |
| **MATH-009** | MATH | **HARD** | Decimal Precision Standards | Weights to 2 decimals; Dimensions & counts to integers | `stuffingCalculator.ts` |
| **CONT-001** | CONT | **HARD** | 40ft HC Interior Dimensions | Length: 12,032 mm; Width: 2,352 mm; Door: 2,585 mm; Max Payload: 26,000 kg | `stuffing.ts:DEFAULT_STUFFING_CONFIG` |
| **CONT-002** | CONT | **HARD** | 20ft Standard Dimensions | Length: 5,898 mm; Width: 2,352 mm; Door: 2,280 mm; Max Payload: 21,500 kg | `stuffing.ts:CONFIG_20FT` |
| **CONT-003** | CONT | **HARD** | Door Ingress Height Limit | $\text{Pallet Height} \le \text{Container Door Opening Height}$ (2,585 mm / 2,280 mm) | `stuffingCalculator.ts:findOptimalPalletPlan` |
| **CONT-004** | CONT | **HARD** | Longitudinal Fit Constraint | $\max(\text{Row 1, Row 2, Row 3}) \le \text{Container Length}$ (12,032 mm / 5,898 mm) | `stuffingCalculator.ts:generateStuffingPlan` |
| **CONT-005** | CONT | **HARD** | Container Max Weight Cap | $\text{Container Cargo Weight} \le \text{Container Max Weight}$ | `stuffingCalculator.ts:generateStuffingPlan` |
| **CONT-006** | CONT | **HARD** | 20ft 10-Pallet Floor Cap | $\text{Loaded Pallets (20ft)} \le 10$ pallets max | `stuffingCalculator.ts:generateStuffingPlan` |
| **CONT-007** | CONT | **HARD** | Transverse Width Fit | $\sum(\text{Pallet Base Widths across floor}) \le 2,352$ mm | `ContainerStuffingPlanner.tsx` |
| **PACK-001** | PACK | **HARD** | HPP Pallet Width Formula | $\text{Pallet Width} = \text{Slit Width (mm)} + \text{Clearance (120 mm)}$ | `stuffingCalculator.ts:calculateOrderMetrics` |
| **PACK-002** | PACK | **HARD** | HPP Pallet Length = Cradle Ply | Single column: 850 or 765 mm; Double column: 1200 mm (600 ply) / 1100 mm (550 ply) | `stuffingCalculator.ts:calculateOrderMetrics` |
| **PACK-003** | PACK | **HARD** | Minimum 1 Reel Per Pallet | $\text{Reels Per Pallet} \ge 1$ | `stuffingCalculator.ts` |
| **PACK-004** | PACK | **SOFT** | Default Clearance (120 mm) | Standard clearance is 120 mm; configurable | `stuffing.ts:DEFAULT_STUFFING_CONFIG` |
| **PACK-005** | PACK | **SOFT** | Pallet Base Tare Height | HPP Tare: 200 mm; VPP Tare: 200 - 250 mm | `stuffingCalculator.ts` |
| **HPP-001** | HPP | **HARD** | Cradle Ply by Diameter | $>745 \rightarrow 850$; $590-745 \rightarrow 765$; $530-589 \rightarrow 600$; $<530 \rightarrow 550$ mm | `stuffingCalculator.ts:getPlyForDiameter` |
| **HPP-002** | HPP | **HARD** | 3-Line Loading Eligibility | Allowed ONLY when Pallet Length $\le 765$ mm ($3 \times 765 = 2,295 \le 2,352$) | `stuffingCalculator.ts:generateStuffingPlan` |
| **HPP-003** | HPP | **HARD** | 850 mm Ply 2 Lines Max | Pallet Length 850 mm prohibited from 3 lines ($3 \times 850 = 2,550 > 2,352$) | `stuffingCalculator.ts:generateStuffingPlan` |
| **HPP-004** | HPP | **HARD** | $\ge 1100$ mm Slit 2 Reels Cap | Width $\ge 1100$ mm strictly forbidden from 3 reels/pallet (stability lock) | `stuffingCalculator.ts:findOptimalPalletPlan` |
| **HPP-005** | HPP | **HARD** | 600 mm Ply Max 6 Reels | 600 mm ply strictly capped at 6 reels (8 reels NEVER allowed) | `stuffingCalculator.ts:findOptimalPalletPlan` |
| **HPP-006** | HPP | **HARD** | 4-Reel Completion Only | 4 reels strictly allowed for completion/remainder, never uniform standard | `stuffingCalculator.ts:findOptimalPalletPlan` |
| **HPP-007** | HPP | **SOFT** | Dia $> 580$ mm Default 2 Reels | Default 2 reels/pal to spread along ~11.5m container length | `stuffingCalculator.ts:findOptimalPalletPlan` |
| **HPP-008** | HPP | **SOFT** | User Permission for 3 Reels | Allowed on Dia $> 580$ mm only if width $< 1100$ mm and authorized | `stuffingCalculator.ts:findOptimalPalletPlan` |
| **HPP-009** | HPP | **SOFT** | 550 mm Ply Hierarchy | Preferred 6 reels, allowed 8 reels ($<1100$ mm), completion 4, 5, or 7 | `stuffingCalculator.ts:findOptimalPalletPlan` |
| **HPP-010** | HPP | **HARD** | 850 Ply Pinwheel Stuffing Layout | Applies ONLY to 850 Ply: 2-line pinwheel (Row 1 rotated 90°, Row 2 empty center corridor = 0 mm, Row 3 standard 850 mm orientation). 3-line loading prohibited. Row lengths $\le$ container length. | `stuffingCalculator.ts:generateRowLayoutForContainer` |
| **VPP-001** | VPP | **HARD** | Small Roll VPP Specification | Dia $\le 360$ mm $\rightarrow$ $1000 \times 1000$ mm skid, $3 \times 3 = 9$ rolls/layer | `stuffingCalculator.ts:calculateOrderMetrics` |
| **VPP-002** | VPP | **HARD** | Standard Slit VPP Specification | $361-460$ mm Dia $\rightarrow$ $900 \times 1300$ mm skid, $2 \times 3 = 6$ rolls/layer | `stuffingCalculator.ts:calculateOrderMetrics` |
| **VPP-003** | VPP | **HARD** | VPP Pallet Height Formula | $\text{Height} = (\text{Tiers} \times \text{Slit Width}) + \text{Tare} (200-250\text{ mm})$ | `stuffingCalculator.ts:getPalletHeightForVPP` |
| **VPP-004** | VPP | **HARD** | VPP Maximum Ingress Height | Pallet height must not exceed container door height | `stuffingCalculator.ts:findOptimalPalletPlan` |
| **VPP-005** | VPP | **SOFT** | VPP 20ft 2-Row Loading | 2 rows of skids ($900+1300$ or $1000+1000$ mm), max 10 pallets | `ContainerStuffingPlanner.tsx` |
| **VPP-006** | VPP | **HARD** | VPP Pinwheel Pallet Placement | 2-line pinwheel: Row 1 rotated widthwise, Row 2 standard longitudinal. Row lengths $\le$ container length. | `stuffingCalculator.ts:generateStuffingPlan` |
| **VPP-007** | VPP | **HARD** | TC20 VPP Homogeneous 84-Reel & 1+1 Stacking Freeze | Film = TC20 & Size $< 120$ mm: exactly 84 reels/pal (12/tier $\times$ 7 tiers), 1+1 stacking, strictly homogeneous (no mixed size, no mixed film, excluded from consolidation) | `stuffingCalculator.ts` & `validator.ts` |
| **FILM-001** | FILM | **HARD** | Film Thickness Extraction | Extracted from film code suffix (e.g. `TH21-25` $\rightarrow 25\ \mu\text{m}$) | `filmDensities.ts:lookupFilmSpecs` |
| **FILM-002** | FILM | **HARD** | Substrate Specific Gravities | BOPP: 0.905-0.910; BOPET: 1.400; CPP: 0.900-0.905; Nylon: 1.150 g/cm³ | `filmDensities.ts:FILM_DENSITIES_DATABASE` |
| **FILM-003** | FILM | **HARD** | Core Outer Diameter Standards | 3-inch core = 89 mm OD; 6-inch core = 170 mm OD | `stuffingCalculator.ts:calculateRollDiameter` |
| **FILM-004** | FILM | **SOFT** | Fallback Density (0.905) | Default density when code uncataloged is 0.905 g/cm³ | `filmDensities.ts:lookupFilmSpecs` |
| **TOL-001** | TOL | **HARD** | Order Quantity $\pm 10\%$ Window | $\text{Order Qty} \times 0.90 \le \text{Planned Weight} \le \text{Order Qty} \times 1.10$ | `stuffingCalculator.ts:findOptimalPalletPlan` |
| **TOL-002** | TOL | **HARD** | Drop Palletization on Tolerance Breach | If no plan within $\pm 10\%$, drop to 0 pallets/reels/kg (`isDropped=true`) | `stuffingCalculator.ts:findOptimalPalletPlan` |
| **TOL-003** | TOL | **SOFT** | Default Planning Buffer (1.10) | 10% over-production buffer multiplier (configurable) | `stuffing.ts:DEFAULT_STUFFING_CONFIG` |

---

## 2. Detailed Technical Rules

### 2.1 Mathematical Laws & Conservation (MATH-001 to MATH-009)
1. **Reel Net Weight (MATH-001)**:
   $$\text{Weight (kg)} = \frac{\text{Width (mm)} \times \text{Length (m)} \times \text{Thickness (\mu m)} \times \text{Density (g/cm}^3\text{)}}{1{,}000{,}000}$$
   *Example*: TH21-25, 1000 mm, 15500 m, density 0.905 $\rightarrow$ $(1000 \times 15500 \times 25 \times 0.905) / 10^6 = 350.69$ kg.

2. **Roll Diameter Calculation (MATH-002 & MATH-003)**:
   $$\text{Outer Diameter (mm)} = \sqrt{D_{\text{core}}^2 + \frac{4 \times \text{Length (m)} \times \text{Thickness (\mu m)}}{\pi \times 1000}}$$
   Where $D_{\text{core}} = 89\text{ mm}$ for 3" core and $170\text{ mm}$ for 6" core.

3. **Conservation of Mass Across Splitting (MATH-006)**:
   When an item's pallet configuration is split into distinct packing rows (e.g. 8 pallets of 3-reels and 2 pallets of 2-reels), the sum of the sub-weights must exactly match the total planned weight. The last split pallet row takes the exact remainder:
   $$\text{Last SubWeight} = \text{Total Planned Weight} - \sum_{i=1}^{n-1} \text{SubWeight}_i$$

---

### 2.2 Container Dimensions & Loading Physics (CONT-001 to CONT-007)
1. **Physical Dimensions**:
   - **40ft High Cube**: Internal Length = 12,032 mm, Width = 2,352 mm, Door Height = 2,585 mm, Max Payload = 26,000 kg.
   - **20ft Standard**: Internal Length = 5,898 mm, Width = 2,352 mm, Door Height = 2,280 mm, Max Payload = 21,500 kg.
2. **Door Clearance (CONT-003)**:
   Cargo vertical height is strictly governed by the container door opening (2,585 mm for 40ft HC; 2,280 mm for 20ft). Pallet heights $> 2,585\text{ mm}$ cannot physically enter the container.
3. **Longitudinal Fit (CONT-004)**:
   $$\max(\text{Line 1 Length}, \text{Line 2 Length}, \text{Line 3 Length}) \le \text{Container Interior Length}$$

---

### 2.3 Horizontal Pallet Packing (HPP-001 to HPP-010)
1. **Cradle Ply Selection (HPP-001)**:
   - Roll Diameter $> 745\text{ mm} \rightarrow$ **850 mm Ply**
   - Roll Diameter $590 - 745\text{ mm} \rightarrow$ **765 mm Ply**
   - Roll Diameter $530 - 589\text{ mm} \rightarrow$ **600 mm Ply**
   - Roll Diameter $< 530\text{ mm} \rightarrow$ **550 mm Ply**
2. **3-Line Layout Rule (HPP-002 & HPP-003)**:
   Loading 3 parallel lines is permitted **ONLY** when pallet length $\le 765\text{ mm}$.
   $$3 \times 765\text{ mm} = 2{,}295\text{ mm} \le 2{,}352\text{ mm (Internal Width)}$$
   For 850 mm ply: $3 \times 850\text{ mm} = 2{,}550\text{ mm} > 2{,}352\text{ mm}$, which is a **physical impossibility**. 850 mm ply is strictly restricted to 2 lines max.
3. **Strict Stability Cap for Slit Width $\ge 1100\text{ mm}$ (HPP-004)**:
   Rolls with slit width $\ge 1100\text{ mm}$ are **STRICTLY LOCKED** to 2 reels per pallet maximum. Stacking 3 reels on a pyramid cradle is forbidden due to tipping hazard.
4. **HPP 850 Ply Factory Pinwheel Stuffing Layout (HPP-010)**:
   - **Scope**: Applies **ONLY** to HPP 850 Ply (`pallet_length === 850 mm` or `cradle_ply === 850 mm`).
   - **2-Line Pinwheel Arrangement**:
     - **Row 1 (Left Wall)**: Pallets rotated 90° so each pallet occupies its `pallet_width` along the longitudinal container length.
     - **Row 2 (Center Corridor)**: Strictly maintained empty (`0 mm`) to provide physical clearance and prevent container width overfill.
     - **Row 3 (Right Wall)**: Pallets in standard orientation, each occupying `850 mm` along the container length.
   - **Pallet Dimensions & Orientations**: Existing pallet dimensions and orientation rules must be preserved.
   - **Prohibition**: 850 Ply remains strictly prohibited from 3-line loading ($3 \times 850 = 2,550\text{ mm} > 2,352\text{ mm}$).
   - **Boundary Limits**: Every row must remain within the applicable container physical length limit (12,032 mm for 40ft HC / 5,898 mm for 20ft).
   - **Immutability**: This rule must never be violated, relaxed, or bypassed by future optimization changes.

---

### 2.4 Vertical Pallet Packing (VPP-001 to VPP-007)
1. **Small Rolls / Cigarette Overwrap (VPP-001)**:
   - Roll Diameter $\le 360\text{ mm}$ (e.g. 120 mm, 245 mm, 350 mm slit widths).
   - Skid: $1000 \times 1000\text{ mm}$ wooden skid.
   - Packing Grid: $3 \times 3 = 9$ rolls per layer.
2. **Standard Slit BOPP (VPP-002)**:
   - Roll Diameter $361 - 460\text{ mm}$ (e.g. 620 mm to 1050 mm slit widths).
   - Skid: $900 \times 1300\text{ mm}$ wooden skid.
   - Packing Grid: $2 \times 3 = 6$ rolls per layer.
3. **VPP Height Calculation (VPP-003)**:
   $$\text{Height (mm)} = (\text{Tiers} \times \text{Slit Size (mm)}) + \text{Tare Height (200-250 mm)}$$
4. **VPP Pinwheel Pallet Placement (VPP-006)**:
   - Line 1 (Row 1): Rotated widthwise (pallet width along container length).
   - Line 2 (Row 2): Standard longitudinal (pallet length along container length).
   - Row lengths must strictly remain within container physical boundaries ($\le 5,898$ mm for 20ft, $\le 12,032$ mm for 40ft).
5. **TC20 VPP Homogeneous 84-Reel & 1+1 Stacking Freeze (VPP-007)**:
   - **Scope**: Film Code = `TC20` (or `TC20-*`) AND Size $< 120$ mm in VPP mode.
   - **84 Reels per Pallet**: Exactly 12 rolls per tier (3 $\times$ 4 grid) $\times$ 7 tiers = 84 reels.
   - **1+1 Vertical Stacking**: Must use the existing 1+1 half-height vertical stacking concept.
   - **Strict Homogeneity**:
     - NEVER mix different sizes on the same pallet.
     - NEVER mix different film codes on the same pallet.
     - NEVER use TC20 reels as fillers for another VPP pallet.
     - NEVER use other VPP reels to complete/fill a TC20 pallet.
     - Different TC20 sizes must remain on separate pallets.
   - **Consolidation Exclusion**: Explicitly excluded from any current or future VPP mixed-size/mixed-film consolidation, remainder pooling, pallet filler logic, or cross-order pallet consolidation.
   - **Preserved Calculations**: Reel weight, reel quantity, pallet dimensions, pallet height, tare, $\pm 10\%$ tolerance, container placement, and Pinwheel placement remain 100% identical and unchanged.

---

### 2.5 Tolerances & Integrity (TOL-001 to TOL-003)
1. **Contract Tolerance Window ($\pm 10\%$)**:
   Planned shipment weight must fall within:
   $$0.90 \times \text{Order Qty} \le \text{Planned Weight} \le 1.10 \times \text{Order Qty}$$
2. **Tolerance Breach Drop Rule (TOL-002)**:
   If no valid integer pallet configuration satisfies the $\pm 10\%$ tolerance, the algorithm automatically drops palletization to 0 (`isDropped=true`) rather than shipping an illegal quantity.

---

## 3. Documented Ambiguities & Discrepancies in Current Code

The following ambiguities exist in the current stable code and are documented here as required:

1. **Container Door Ingress Height vs Internal Roof Height**:
   - `stuffing.ts` specifies `container_door_height = 2585 mm` (40ft HC) and `2280 mm` (20ft), while `container_internal_height = 2698 mm` (40ft HC) and `2393 mm` (20ft).
   - *Status*: The physical bottleneck is the door height. Pallets taller than the door cannot be loaded.
2. **VPP Tare Allowance Discrepancy**:
   - In `stuffingCalculator.ts:getPalletHeightForVPP`, the default tare argument is `tareHeight = 250 mm`.
   - In `ContainerStuffingPlanner.tsx` (UI description) and sample comments, `200 mm` tare is cited.
   - *Status*: Code functions with 250 mm default; UI references 200 mm.
3. **HPP Pallet Clearance History**:
   - `DEFAULT_STUFFING_CONFIG.pallet_clearance` is `120 mm` (`Size + 120`).
   - Legacy documentation in some scripts mentioned `100 mm` clearance.
   - *Status*: Active stable code consistently uses `120 mm`.
4. **Pallet Cap Default**:
   - In `DEFAULT_STUFFING_CONFIG`, `max_pallets_per_container` is initialized to `999` (unlimited, constrained by physical length and weight).
   - For 20ft containers, `CONFIG_20FT` specifies `10` pallets max.
   - *Status*: 40ft containers are bounded by space/weight, 20ft containers by the 10-pallet floor limit.
