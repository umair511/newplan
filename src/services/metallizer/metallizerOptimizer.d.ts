import { VA05Order } from '../../types';
import {
    JumboRoll,
    MetallizerMachineSettings,
    MetallizerPlan,
    JumboRequirement,
    MasterWidthClusterCandidate,
    MasterWidthClusteringOptions,
    MasterWidthClusteringResult,
    ShaftDistributionResult,
    SegmentValidationResult,
    SegmentedJumboValidationOptions,
    SegmentedJumboValidationResult,
    DoffKnifeTransition,
    DoffTransitionValidationResult,
    MetallizerPackageSegment,
    MetallizerPlanOrderAllocation,
    MetallizerSegmentOrderAllocation,
} from '../../types/metallizer';
import { FilmCompatibilityRule } from './filmCompatibilityMaster';
import { DynamicContinuationOptions, DynamicRunResult } from './dynamicContinuationEngine';

export interface MetallizerCandidatePattern {
    jumbo_roll: JumboRoll;
    ups: number;
    slit_widths: number[];
    orders: {
        order: VA05Order;
        ups: number;
        width_mm: number;
        length_m: number;
        reels: number;
        weight_kg: number;
        is_closed: boolean;
    }[];
    total_slit_width_mm: number;
    trim_mm: number;
    package_length_m: number;
    package_multiple: number;
    total_planned_weight_kg: number;
    trim_weight_kg: number;
    waste_percent: number;
    score: number;
}
export interface OptimizationStrategyEvaluation {
    strategy: 'COMBINED' | 'SEPARATE';
    film_group: string;
    films_included: string[];
    requirements: JumboRequirement[];
    total_rolls: number;
    unique_jumbo_widths: number[];
    total_planned_kg: number;
    total_trim_kg: number;
    average_waste_percent: number;
    ps01_3ups_count: number;
    ps01_4ups_count: number;
    max_jumbo_length_m: number;
    is_fully_feasible: boolean;
    score: number;
    reason: string;
}
/**
 * HARD BUSINESS RULE — METALLIZED FILM IDENTIFICATION
 * A film order shall be treated as a METALLIZED FILM order ONLY when its Film Code contains "MZ".
 * Examples:
 * - MZ10S-18 -> Metallized Film
 * - MZ18 -> Metallized Film
 * - MZ20 -> Metallized Film
 * - MZ10S-20 -> Metallized Film
 * - MZ10MB-15 -> Metallized Film
 *
 * Any Film Code that does NOT contain "MZ" must NOT be treated as a Metallized Film order.
 * This classification is strictly enforced at the BACKEND / optimizer level.
 */
export declare function isMetallizedFilm(filmCode: string | undefined | null): boolean;
/**
 * Check if a VA05 order is a metallized film order based strictly on whether its film code contains "MZ"
 */
export declare function isMetallizerOrder(order: VA05Order | undefined | null): boolean;
/**
 * Generate candidate combinations of finished slit widths (1 to 6 UPS) from available orders.
 * MSL slitter has 6 UPS physically available (Arms 1-3 on Side A, Arms 4-6 on Side B).
 * All 1 to 6 UPS are available at all times wherever deckle is maximally adjusted.
 * Supports:
 * - Single width repeats (1-6 UPS)
 * - Mixed widths (e.g. 1120 + 1130 + 1140 mm)
 * - Mixed compatible lengths (e.g. 10,000 m + 20,000 m)
 */
export declare function generateMSLWidthCombinations(uniqueWidths: number[], maxUps?: number, maxTotalWidth?: number, minTrim?: number): {
    widths: number[];
    ups: number;
    sumWidth: number;
}[];
/**
 * Computes the sum of customer slit widths (Sj) for a candidate pattern or requirement.
 */
export declare function getPatternSlitSum(p: MasterWidthClusterCandidate | JumboRequirement): number;

/**
 * Phase 2: Dynamic Trim-Bounded Master-Width Clustering Evaluation.
 */
export declare function evaluateMasterWidthClustering(
    patterns: (MasterWidthClusterCandidate | JumboRequirement)[],
    options?: MasterWidthClusteringOptions
): MasterWidthClusteringResult;

/**
 * Phase 2: Applies master-width clustering to a set of jumbo requirements.
 */
export declare function applyMasterWidthClustering(
    requirements: JumboRequirement[],
    clusterResult: MasterWidthClusteringResult,
    clusterId?: string
): JumboRequirement[];

/**
 * Phase 3: Automatically derives or balances duplex shaft distribution for a list of cuts.
 */
export declare function deriveDuplexShaftDistribution(
    cuts: number[],
    orderLengths?: number[]
): ShaftDistributionResult;

/**
 * Phase 3: Validates physical manufacturing invariants of a single MetallizerPackageSegment.
 */
export declare function validatePackageSegmentInvariants(
    segment: MetallizerPackageSegment,
    masterWidthMm: number,
    options?: SegmentedJumboValidationOptions
): SegmentValidationResult;

export declare const validateSegmentInvariants: typeof validatePackageSegmentInvariants;

/**
 * Phase 3: Validates end-to-end multi-segment physical unity, contiguity, and customer headroom on a JumboRequirement or MetallizerPlan.
 */
export declare function validateSegmentedJumboInvariants(
    jumbo: JumboRequirement | MetallizerPlan,
    options?: SegmentedJumboValidationOptions
): SegmentedJumboValidationResult;

export interface DoffTransitionOptions {
    transition_index?: number;
    min_trim_mm?: number;
    max_trim_mm?: number;
    min_cut_width_mm?: number;
    max_total_cuts?: number;
    max_shaft_cuts?: number;
    orderDemandMap?: Map<string, number>;
    orders?: VA05Order[];
    max_overallocation_factor?: number;
}

/**
 * Phase 4: Generic transition engine that evaluates physical feasibility of a package-boundary doff knife transition.
 */
export declare function evaluateDoffKnifeTransition(
    segmentA: MetallizerPackageSegment,
    segmentB: MetallizerPackageSegment,
    masterWidthMm: number,
    options?: DoffTransitionOptions
): DoffTransitionValidationResult;

/**
 * Phase 4: Fast pattern-level transition feasibility check between two candidate slit cut arrays.
 */
export declare function evaluateSlitPatternTransition(
    cutsA: number[],
    cutsB: number[],
    masterWidthMm: number,
    options?: { minTrim?: number; maxTrim?: number }
): DoffTransitionValidationResult;

/**
 * Phase 4: Factory function to construct a verified DoffKnifeTransition between two adjacent segments.
 */
export declare function createDoffKnifeTransition(
    segmentA: MetallizerPackageSegment,
    segmentB: MetallizerPackageSegment,
    transitionIndex: number,
    masterWidthMm: number,
    options?: DoffTransitionOptions
): DoffKnifeTransition;

/**
 * Aggregates order allocations across all segments into unified MetallizerPlanOrderAllocation objects.
 */
export declare function aggregateSegmentOrderAllocations(
    segments: MetallizerPackageSegment[]
): MetallizerPlanOrderAllocation[];

/**
 * Validates order allocation headroom ceiling against demand map.
 */
export declare function validateOrderAllocationHeadroom(
    ordersCovered: (MetallizerPlanOrderAllocation | MetallizerSegmentOrderAllocation)[],
    orderDemandMap: Map<string, number>,
    maxOverheadFactor?: number
): { isValid: boolean; is_valid: boolean; violations: string[]; errors: string[] };

export interface CreatePackageSegmentParams {
    segment_index: number;
    start_length_m: number;
    length_m: number;
    cuts: number[];
    master_width_mm: number;
    orders: (MetallizerSegmentOrderAllocation | MetallizerPlanOrderAllocation)[];
    shaft_distribution?: {
        front_cuts: number[];
        rear_cuts: number[];
        front_ups: number;
        rear_ups: number;
    };
    thickness_micron: number;
    density?: number;
    package_number?: number;
    notes?: string;
}

/**
 * Phase 3: Constructs a verified MetallizerPackageSegment.
 */
export declare function createPackageSegment(params: CreatePackageSegmentParams): MetallizerPackageSegment;

export interface CreateSegmentedJumboRequirementParams {
    id?: string;
    film: string;
    thickness_micron: number;
    master_width_mm: number;
    segments: MetallizerPackageSegment[];
    transitions?: DoffKnifeTransition[];
    core?: string;
    density?: number;
    required_rolls_count?: number;
    created_by?: string;
    ps01_feasibility?: any;
    ps01_parent_deckle_id?: string;
    ps01_run_index?: number;
    ps01_cut_combination?: number[];
    planning_mode?: 'COMBINED' | 'SEPARATE' | 'SINGLE';
    compatible_group_key?: string;
    notes?: string;
    is_master_width_clustered?: boolean;
    master_width_cluster_id?: string;
    canonical_master_width_mm?: number;
}

/**
 * Phase 3: Constructs a verified multi-segment JumboRequirement.
 */
export declare function createSegmentedJumboRequirement(
    params: CreateSegmentedJumboRequirementParams
): JumboRequirement;

/**
 * Phase 5: Campaign Optimizer Segmentation and Continuation Pass.
 */
export declare function applyCampaignSegmentationAndContinuation(
    requirements: JumboRequirement[],
    options?: {
        rules?: FilmCompatibilityRule[];
        maxJumboLengthM?: number;
        maxJumboDiameterMm?: number;
        orders?: VA05Order[];
    }
): JumboRequirement[];

/**
 * Phase 5: Campaign Master-Width Clustering Integration.
 */
export declare function applyCampaignMasterWidthClustering(
    requirements: JumboRequirement[],
    options?: {
        rules?: FilmCompatibilityRule[];
    }
): JumboRequirement[];

/**
 * Phase 7: MSL Execution Plan Consolidation.
 */
export declare function consolidateMetallizerPlans(plans: MetallizerPlan[]): MetallizerPlan[];

/**
 * Generate Upstream Jumbo Roll Requirements from Metallized Orders
 *
 * IMPLEMENTS COMPATIBLE FILM GROUP PLANNING (Sections 1-25):
 * 1. Determines film compatibility group (e.g. MZ10S-18 ↔ MZ18, MZ10S-20 ↔ MZ20).
 * 2. Compares Option A (Separate Planning) vs Option B (Combined Planning).
 * 3. Prefers Combined Planning when feasible and objectively better under locked priority hierarchy.
 * 4. Allows a PORTFOLIO OF DIFFERENT JUMBO WIDTHS in the final plan.
 * 5. Strictly enforces per-order +10% ceiling (Allocated <= Balance * 1.10).
 * 6. Discards RED candidates immediately (0 KG, 0 rolls).
 */
export declare function generateJumboRollRequirements(orders: VA05Order[], settings: MetallizerMachineSettings, selectedFilm?: string, options?: {
    compatibilityRules?: FilmCompatibilityRule[];
    forceStrategy?: 'AUTO' | 'COMBINED' | 'SEPARATE';
    onProgress?: (progressPercent: number, stageDescription: string) => void;
    enableCampaignOptimization?: boolean;
    enableSegmentationContinuation?: boolean;
    enableMasterWidthClustering?: boolean;
    enableDynamicContinuation?: boolean;
    dynamicContinuationOptions?: DynamicContinuationOptions;
    maxJumboLengthM?: number;
    maxJumboDiameterMm?: number;
}): JumboRequirement[];

/**
 * Metallizer Slitter Plan Optimizer
 * Generates execution slitting plans strictly against available physical jumbo rolls
 * Supports 1 to 6 UPS (MSL has 6 UPS available).
 * Enables multi-plan sequential jumbo roll reuse (e.g. 1 x 20,000m jumbo supplying Plan A 10,000m and Plan B 10,000m).
 */
export declare function generateMetallizerPlans(orders: VA05Order[], availableJumboRolls: JumboRoll[], rawSettings: MetallizerMachineSettings, selectedFilm?: string, rules?: FilmCompatibilityRule[], options?: {
    consolidatePlans?: boolean;
    enableDynamicOrderContinuation?: boolean;
    dynamicContinuationOptions?: DynamicContinuationOptions;
}): {
    plans: MetallizerPlan[];
    remainingOrders: VA05Order[];
    updatedRolls: JumboRoll[];
};

/**
 * Dynamic Asynchronous MSL Customer-Job Continuation Optimization.
 * Directly runs the multi-step dynamic continuation engine across pending orders.
 */
export declare function generateDynamicContinuousMSLPlans(
    orders: VA05Order[],
    rawSettings: MetallizerMachineSettings,
    selectedFilm?: string,
    options?: DynamicContinuationOptions
): {
    plans: MetallizerPlan[];
    continuousRuns: DynamicRunResult[];
    remainingOrders: VA05Order[];
    summary: {
        totalPhysicalPlans: number;
        totalContinuousRuns: number;
        totalMetersPlanned: number;
        averageRunMeters: number;
        totalWeightKg: number;
        tailRunsCount: number;
        smallDiameterCount: number;
    };
};

