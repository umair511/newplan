/**
 * PACKAGING & MATH RULES - VALIDATION & GUARDRAIL LAYER
 * Machine-readable validation engine to prevent future code or AI changes
 * from violating HARD immutable rules.
 */

import { PACKAGING_AND_MATH_RULES, getPackagingRule } from './registry';
import { RuleValidationResult, RuleViolation } from './types';
import { CalculatedItem, ContainerPlan, FinalPlan, StuffingConfig } from '../types/stuffing';

export class RuleGuardrailEngine {
  /**
   * Validate a single calculated order row against registered rules.
   */
  public static validateCalculatedOrder(order: CalculatedItem, config?: StuffingConfig): RuleValidationResult {
    const violations: RuleViolation[] = [];
    const warnings: RuleViolation[] = [];

    // 1. Check TOL-001 (Final Order Quantity Tolerance Window: +/-10%)
    const minQty = Number((order.order_qty * 0.90).toFixed(2));
    const maxQty = Number((order.order_qty * 1.10).toFixed(2));
    if (order.planned_weight > 0 && (order.planned_weight < minQty || order.planned_weight > maxQty)) {
      const v: RuleViolation = {
        ruleId: 'TOL-001',
        ruleName: 'Final Order Quantity Tolerance Window (+/-10%)',
        severity: 'HARD',
        message: `Order Item ${order.item} planned weight (${order.planned_weight} kg) is outside +/-10% contract tolerance [${minQty} kg - ${maxQty} kg].`,
        actualValue: order.planned_weight,
        expectedConstraint: `Between ${minQty} and ${maxQty} kg`,
        context: { item: order.item, orderQty: order.order_qty, plannedWeight: order.planned_weight },
      };
      violations.push(v);
    }

    // 2. Check HPP-004 (Slit Width >= 1100 mm Strict 2 Reels Maximum Cap)
    if (order.packing_mode === 'HPP' && order.size >= 1100) {
      if (order.reels_per_pallet > 2 || (order.pallets_3_reels && order.pallets_3_reels > 0)) {
        const v: RuleViolation = {
          ruleId: 'HPP-004',
          ruleName: 'Slit Width >= 1100 mm Strict 2 Reels Maximum Cap',
          severity: 'HARD',
          message: `Order Item ${order.item} with slit width ${order.size} mm (>= 1100 mm) has > 2 reels per pallet, which is strictly prohibited for stability.`,
          actualValue: order.reels_per_pallet,
          expectedConstraint: 'reels_per_pallet <= 2',
          context: { item: order.item, size: order.size, reelsPerPallet: order.reels_per_pallet },
        };
        violations.push(v);
      }
    }

    // 3. Check HPP-005 (600 mm Ply Maximum 6 Reels Cap, 8 Reels Prohibited)
    if (order.packing_mode === 'HPP' && order.cradle_ply === 600) {
      if (order.reels_per_pallet > 6 || (order.pallets_8_reels && order.pallets_8_reels > 0)) {
        const v: RuleViolation = {
          ruleId: 'HPP-005',
          ruleName: '600 mm Ply Maximum 6 Reels Cap (8 Reels Prohibited)',
          severity: 'HARD',
          message: `Order Item ${order.item} has 600 mm cradle ply with > 6 reels per pallet (${order.reels_per_pallet} reels planned). 8 reels is strictly forbidden on 600 ply.`,
          actualValue: order.reels_per_pallet,
          expectedConstraint: 'reels_per_pallet <= 6 for 600 mm ply',
          context: { item: order.item, cradlePly: order.cradle_ply, reelsPerPallet: order.reels_per_pallet },
        };
        violations.push(v);
      }
    }

    // 4. Check MATH-005 (Reel Count Conservation)
    const p8 = order.pallets_8_reels || 0;
    const p6 = order.pallets_6_reels || 0;
    const p4 = order.pallets_4_reels || 0;
    const p3 = order.pallets_3_reels || 0;
    const p2 = order.pallets_2_reels || 0;
    const pOther = order.pallets_other_reels || 0;
    const accountedExplicit = p8 * 8 + p6 * 6 + p4 * 4 + p3 * 3 + p2 * 2;
    if (p8 + p6 + p4 + p3 + p2 > 0 && pOther === 0) {
      if (accountedExplicit !== order.planned_reels) {
        const v: RuleViolation = {
          ruleId: 'MATH-005',
          ruleName: 'Reel Count Conservation in Pallet Partitioning',
          severity: 'HARD',
          message: `Order Item ${order.item} sub-pallet reels (${accountedExplicit}) does not match planned reels (${order.planned_reels}).`,
          actualValue: accountedExplicit,
          expectedConstraint: `Sum of sub-pallets must equal ${order.planned_reels}`,
          context: { item: order.item, accountedExplicit, plannedReels: order.planned_reels },
        };
        violations.push(v);
      }
    }

    // 5. Check CONT-003 / VPP-004 (Door Height Limit)
    const doorHeight = config?.container_type === '20ft' ? 2280 : 2585;
    if (order.pallet_height > doorHeight) {
      const v: RuleViolation = {
        ruleId: order.packing_mode === 'VPP' ? 'VPP-004' : 'CONT-003',
        ruleName: 'Container Door Ingress Height Limit',
        severity: 'HARD',
        message: `Order Item ${order.item} pallet height (${order.pallet_height} mm) exceeds container door opening height (${doorHeight} mm).`,
        actualValue: order.pallet_height,
        expectedConstraint: `pallet_height <= ${doorHeight} mm`,
        context: { item: order.item, palletHeight: order.pallet_height, doorHeight },
      };
      violations.push(v);
    }

    // 6. Check VPP-007 (TC20 VPP Homogeneous 84-Reel & 1+1 Stacking Freeze)
    if (isQualifyingTC20Order(order.film, order.size, order.packing_mode)) {
      if (order.reels_per_pallet !== 84 && (!order.custom_reels_per_pallet || order.custom_reels_per_pallet === 0)) {
        const v: RuleViolation = {
          ruleId: 'VPP-007',
          ruleName: 'TC20 VPP Homogeneous 84-Reel & 1+1 Stacking Freeze',
          severity: 'HARD',
          message: `Order Item ${order.item} (${order.film}, size ${order.size} mm < 120 mm) must use exactly 84 reels per pallet under HARD rule VPP-007, but got ${order.reels_per_pallet}.`,
          actualValue: order.reels_per_pallet,
          expectedConstraint: 'reels_per_pallet === 84',
          context: { item: order.item, film: order.film, size: order.size, reelsPerPallet: order.reels_per_pallet },
        };
        violations.push(v);
      }
    }

    return {
      valid: violations.length === 0,
      hasHardViolations: violations.some(v => v.severity === 'HARD'),
      violations,
      warnings,
    };
  }

  /**
   * Validate a loaded container against container physical & legal limits.
   */
  public static validateContainerPlan(container: ContainerPlan, config?: StuffingConfig): RuleValidationResult {
    const violations: RuleViolation[] = [];
    const warnings: RuleViolation[] = [];

    const is20ft = container.container_type === '20ft';
    const maxAllowedLength = is20ft ? 5750 : 12032;
    const maxAllowedWidth = is20ft ? 2320 : 2352;
    const maxAllowedHeight = is20ft ? 2280 : (config?.container_internal_height || 2698);
    const maxAllowedWeight = container.max_weight || (is20ft ? 21500 : 26000);

    // 1. Check CONT-004 (Longitudinal Fit Constraint)
    const maxRowLength = Math.max(
      container.row_lengths.row1 || 0,
      container.row_lengths.row2 || 0,
      container.row_lengths.row3 || 0
    );
    if (maxRowLength > maxAllowedLength) {
      violations.push({
        ruleId: 'CONT-004',
        ruleName: 'Longitudinal Fit Constraint',
        severity: 'HARD',
        message: `Container ${container.name} longitudinal line length (${maxRowLength} mm) exceeds usable container length (${maxAllowedLength} mm).`,
        actualValue: maxRowLength,
        expectedConstraint: `<= ${maxAllowedLength} mm`,
        context: { container: container.name, maxRowLength, maxAllowedLength },
      });
    }

    // 2. Check CONT-005 (Container Payload Weight Limit)
    if (container.total_weight > maxAllowedWeight) {
      violations.push({
        ruleId: 'CONT-005',
        ruleName: 'Container Maximum Payload Weight Enforcement',
        severity: 'HARD',
        message: `Container ${container.name} cargo weight (${container.total_weight} kg) exceeds maximum rated payload (${maxAllowedWeight} kg).`,
        actualValue: container.total_weight,
        expectedConstraint: `<= ${maxAllowedWeight} kg`,
        context: { container: container.name, totalWeight: container.total_weight, maxAllowedWeight },
      });
    }

    // 3. Check CONT-006 (20ft Container 10-Pallet Floor Cap)
    const has1Plus1 = container.stuffing_grid?.some(
      r => r.pallet1_info?.stackedPallet ||
           r.pallet2_info?.stackedPallet ||
           r.dims1?.includes('(1+1)') ||
           r.dims2?.includes('(1+1)') ||
           r.pallet1_info?.items?.some(it => it.tier_position?.includes('Tier 2')) ||
           r.pallet2_info?.items?.some(it => it.tier_position?.includes('Tier 2'))
    );
    const floorPositions = has1Plus1 && container.stuffing_grid
      ? (container.stuffing_grid.filter(g => g.row1 != null && g.row1 > 0).length + container.stuffing_grid.filter(g => g.row2 != null && g.row2 > 0).length)
      : container.loaded_pallets;
    if (is20ft && floorPositions > 10) {
      violations.push({
        ruleId: 'CONT-006',
        ruleName: '20ft Container 10-Pallet Floor Cap',
        severity: 'HARD',
        message: `20ft Container ${container.name} has ${floorPositions} floor pallet positions loaded, exceeding the 10-pallet maximum floor capacity.`,
        actualValue: floorPositions,
        expectedConstraint: '<= 10 pallets in 20ft container',
        context: { container: container.name, floorPositions, loadedPallets: container.loaded_pallets },
      });
    }

    // 4. Check Pallet Height & Vertical Stacking Limits (VPP-004 / CONT-003)
    for (const order of container.orders) {
      if (order.pallet_height > maxAllowedHeight) {
        violations.push({
          ruleId: order.packing_mode === 'VPP' ? 'VPP-004' : 'CONT-003',
          ruleName: 'Pallet Height Usable Envelope Limit',
          severity: 'HARD',
          message: `Pallet height (${order.pallet_height} mm) exceeds ${is20ft ? '20ft' : ''} usable height limit (${maxAllowedHeight} mm).`,
          actualValue: order.pallet_height,
          expectedConstraint: `<= ${maxAllowedHeight} mm`,
          context: { container: container.name, item: order.item, palletHeight: order.pallet_height },
        });
      }
    }

    if (container.stuffing_grid) {
      for (const row of container.stuffing_grid) {
        if (row.pallet1_info?.stackedPallet) {
          const totalH = (row.pallet1_info.palletHeight || 0) + (row.pallet1_info.stackedPallet.palletHeight || 0);
          if (totalH > maxAllowedHeight) {
            violations.push({
              ruleId: 'VPP-004',
              ruleName: 'Vertical Stacking Usable Height Limit',
              severity: 'HARD',
              message: `Vertical 1+1 stack height (${totalH} mm) in Row 1 exceeds usable height limit (${maxAllowedHeight} mm).`,
              actualValue: totalH,
              expectedConstraint: `<= ${maxAllowedHeight} mm`,
              context: { container: container.name, totalHeight: totalH },
            });
          }
        }
        if (row.pallet2_info?.stackedPallet) {
          const totalH = (row.pallet2_info.palletHeight || 0) + (row.pallet2_info.stackedPallet.palletHeight || 0);
          if (totalH > maxAllowedHeight) {
            violations.push({
              ruleId: 'VPP-004',
              ruleName: 'Vertical Stacking Usable Height Limit',
              severity: 'HARD',
              message: `Vertical 1+1 stack height (${totalH} mm) in Row 2 exceeds usable height limit (${maxAllowedHeight} mm).`,
              actualValue: totalH,
              expectedConstraint: `<= ${maxAllowedHeight} mm`,
              context: { container: container.name, totalHeight: totalH },
            });
          }
        }
      }
    }

    // 4. Check HPP-002 & HPP-003 (3-Line Loading Width Eligibility)
    const is3LinesLoaded = Boolean(
      container.row_lengths.row1 && container.row_lengths.row1 > 0 &&
      container.row_lengths.row2 && container.row_lengths.row2 > 0 &&
      container.row_lengths.row3 && container.row_lengths.row3 > 0
    );
    if (is3LinesLoaded) {
      const hasPalletOver765 = container.orders.some(o => o.pallet_length > 765);
      if (hasPalletOver765) {
        violations.push({
          ruleId: 'HPP-003',
          ruleName: '850 mm Ply Restriction to 2 Lines Max',
          severity: 'HARD',
          message: `Container ${container.name} uses 3 lines, but contains pallets with length > 765 mm (e.g. 850 mm). 3 lines with >765 mm exceeds internal width (3 * 850 = 2,550 > 2,352 mm).`,
          actualValue: '> 765 mm in 3 lines',
          expectedConstraint: '3-line layout requires all pallet lengths <= 765 mm',
          context: { container: container.name },
        });
      }
    }

    // 5. Check CONT-007 (Transverse Fit Constraint: Max usable width 2320 mm for 20ft)
    if (container.stuffing_grid) {
      for (let idx = 0; idx < container.stuffing_grid.length; idx++) {
        const row = container.stuffing_grid[idx];
        const t1 = row.pallet1_info?.transverseDim;
        const t2 = row.pallet2_info?.transverseDim;
        if (t1 !== undefined && t2 !== undefined && t1 > 0 && t2 > 0) {
          const totalTransverse = t1 + t2;
          if (totalTransverse > maxAllowedWidth) {
            violations.push({
              ruleId: 'CONT-007',
              ruleName: 'Transverse Fit Constraint',
              severity: 'HARD',
              message: `Bay ${idx + 1} combined transverse width (${totalTransverse} mm) exceeds usable container width (${maxAllowedWidth} mm).`,
              actualValue: totalTransverse,
              expectedConstraint: `<= ${maxAllowedWidth} mm`,
              context: { container: container.name, bay: idx + 1, totalTransverse, maxAllowedWidth },
            });
          }
        }
      }
    }

    return {
      valid: violations.length === 0,
      hasHardViolations: violations.some(v => v.severity === 'HARD'),
      violations,
      warnings,
    };
  }

  /**
   * Validate entire final plan against all rules.
   */
  public static validateFinalPlan(plan: FinalPlan): RuleValidationResult {
    const allViolations: RuleViolation[] = [];
    const allWarnings: RuleViolation[] = [];

    // Validate each container
    plan.containers.forEach(container => {
      const cRes = this.validateContainerPlan(container, plan.config_used);
      allViolations.push(...cRes.violations);
      allWarnings.push(...cRes.warnings);

      // Validate each order within container
      container.orders.forEach(order => {
        const oRes = this.validateCalculatedOrder(order, plan.config_used);
        allViolations.push(...oRes.violations);
        allWarnings.push(...oRes.warnings);
      });
    });

    return {
      valid: allViolations.length === 0,
      hasHardViolations: allViolations.some(v => v.severity === 'HARD'),
      violations: allViolations,
      warnings: allWarnings,
    };
  }

  /**
   * Proposed Change Guardrail:
   * Any future AI or developer change MUST check against this guardrail before modifying logic.
   * If a change targets or conflicts with a HARD rule, it returns valid=false and instructions to STOP.
   */
  public static evaluateProposedChange(ruleId: string, proposedModificationDescription: string): {
    canProceed: boolean;
    rule?: (typeof PACKAGING_AND_MATH_RULES)[number];
    directive: string;
  } {
    const descLower = proposedModificationDescription.toLowerCase();
    
    // Proactively intercept any attempt to mix, consolidate, or modify TC20 < 120 mm
    if (
      (ruleId === 'VPP-007' || descLower.includes('tc20')) &&
      (descLower.includes('mix') ||
       descLower.includes('consolidat') ||
       descLower.includes('filler') ||
       descLower.includes('pool') ||
       descLower.includes('override') ||
       descLower.includes('relax') ||
       ruleId === 'VPP-007')
    ) {
      const vpp007 = getPackagingRule('VPP-007');
      return {
        canProceed: false,
        rule: vpp007,
        directive: `STOP! Rule VPP-007 (TC20 VPP Homogeneous 84-Reel & 1+1 Stacking Freeze) is marked as HARD / IMMUTABLE. Modifying code to alter, relax, mix, consolidate, or bypass TC20 (< 120 mm) homogeneous 84-reel / 1+1 behavior is strictly prohibited. Report the conflict to the user immediately without altering code.`,
      };
    }

    const rule = getPackagingRule(ruleId);
    if (!rule) {
      return {
        canProceed: true,
        directive: `Rule ${ruleId} is not registered in the immutable registry.`,
      };
    }

    if (rule.severity === 'HARD') {
      return {
        canProceed: false,
        rule,
        directive: `STOP! Rule ${rule.id} (${rule.name}) is marked as HARD / IMMUTABLE. Modifying code to alter, relax, or bypass this rule is strictly prohibited. Report the conflict to the user immediately without altering code.`,
      };
    }

    return {
      canProceed: true,
      rule,
      directive: `Rule ${rule.id} is marked as SOFT. Modification is permitted with user confirmation and proper regression testing.`,
    };
  }
}

/**
 * Check whether an order/item qualifies for the TC20 frozen behavior rule (VPP-007).
 * Scope: Film Code = TC20 (or TC20-*) AND Size < 120 mm in VPP mode.
 */
export function isQualifyingTC20Order(film?: string, size?: number, packingMode?: string): boolean {
  if (packingMode && packingMode !== 'VPP') return false;
  if (!film || typeof size !== 'number') return false;
  const norm = film.trim().toUpperCase();
  const isTC20 = norm === 'TC20' || norm.startsWith('TC20-') || norm.startsWith('TC20/') || norm.startsWith('TC20 ');
  return isTC20 && size < 120;
}

/**
 * Validates that a VPP pallet obeys the strict homogeneity constraint of VPP-007.
 * Rejects pallets that combine TC20 < 120 mm with any other size, film code, or filler.
 */
export function validateTC20PalletHomogeneity(pallet: {
  reels?: Array<{ film: string; size: number; qty?: number }>;
  items?: Array<{ film: string; size: number; qty?: number }>;
  films?: string[];
  sizes?: number[];
  pallet_type?: string;
  is_mixed?: boolean;
}): RuleValidationResult {
  const violations: RuleViolation[] = [];
  const entries = pallet.reels || pallet.items || [];
  
  const films = new Set<string>((pallet.films || []).concat(entries.map(e => e.film)));
  const sizes = new Set<number>((pallet.sizes || []).concat(entries.map(e => e.size)));

  const hasQualifyingTC20 = Array.from(films).some(f => {
    const norm = f.trim().toUpperCase();
    return norm === 'TC20' || norm.startsWith('TC20-') || norm.startsWith('TC20/') || norm.startsWith('TC20 ');
  }) && Array.from(sizes).some(s => s < 120);

  if (hasQualifyingTC20) {
    // 1. Must not contain multiple distinct film codes
    if (films.size > 1) {
      violations.push({
        ruleId: 'VPP-007',
        ruleName: 'TC20 VPP Homogeneous 84-Reel & 1+1 Stacking Freeze',
        severity: 'HARD',
        message: `TC20 VPP pallet violation: Qualifying TC20 (< 120 mm) must NEVER share a pallet with another film code (${Array.from(films).join(', ')}).`,
        actualValue: Array.from(films),
        expectedConstraint: '100% homogeneous film code (TC20 only)',
        context: { films: Array.from(films) },
      });
    }

    // 2. Must not contain multiple distinct sizes
    if (sizes.size > 1) {
      violations.push({
        ruleId: 'VPP-007',
        ruleName: 'TC20 VPP Homogeneous 84-Reel & 1+1 Stacking Freeze',
        severity: 'HARD',
        message: `TC20 VPP pallet violation: Qualifying TC20 (< 120 mm) must NEVER mix different sizes on the same pallet (${Array.from(sizes).join(', ')} mm).`,
        actualValue: Array.from(sizes),
        expectedConstraint: '100% homogeneous roll width (single size only)',
        context: { sizes: Array.from(sizes) },
      });
    }

    // 3. Must not be marked as mixed or filler pallet
    if (pallet.is_mixed || pallet.pallet_type === 'MIXED' || pallet.pallet_type === 'FILLER') {
      violations.push({
        ruleId: 'VPP-007',
        ruleName: 'TC20 VPP Homogeneous 84-Reel & 1+1 Stacking Freeze',
        severity: 'HARD',
        message: `TC20 VPP pallet violation: TC20 (< 120 mm) is strictly prohibited from mixed-pallet consolidation or filler usage.`,
        actualValue: pallet.pallet_type || 'is_mixed=true',
        expectedConstraint: 'Homogeneous dedicated 84-reel TC20 pallet',
      });
    }
  }

  return {
    valid: violations.length === 0,
    hasHardViolations: violations.length > 0,
    violations,
    warnings: [],
  };
}

/**
 * Gatekeeper function for any future VPP consolidation / mixed-pallet generator.
 * Explicitly rejects qualifying TC20 from mixed-size, mixed-film, remainder pooling,
 * pallet filler logic, and cross-order consolidation.
 */
export function isEligibleForVppConsolidation(item: { film: string; size: number; packing_mode?: string }): {
  eligible: boolean;
  reason?: string;
  ruleId?: string;
} {
  if (isQualifyingTC20Order(item.film, item.size, item.packing_mode)) {
    return {
      eligible: false,
      reason: `TC20 with size ${item.size} mm is strictly locked under HARD rule VPP-007 and excluded from all mixed-size / mixed-film consolidation, remainder pooling, and pallet filler logic.`,
      ruleId: 'VPP-007',
    };
  }
  return { eligible: true };
}
