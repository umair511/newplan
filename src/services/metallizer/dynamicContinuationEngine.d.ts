import { VA05Order } from '../../types';
import {
    MetallizerPlan,
    MetallizerPackageSegment,
    DoffKnifeTransition,
    ArmScheduleInterval,
    SlitterDoffEvent,
    MetallizerMachineSettings,
} from '../../types/metallizer';
import { FilmCompatibilityRule } from './filmCompatibilityMaster';

export interface DynamicContinuationOptions {
    rules?: FilmCompatibilityRule[];
    maxJumboLengthM?: number;
    maxJumboDiameterMm?: number;
    maxLookAheadDepth?: number;
    beamWidth?: number;
    maxOverallocationFactor?: number;
    onProgress?: (percent: number, message: string) => void;
}

export interface ActiveArmState {
    arm_index: number;
    shaft: 'FRONT' | 'REAR';
    order: VA05Order;
    order_id: string;
    sales_order: string;
    item_number: number;
    customer: string;
    width_mm: number;
    reel_length_m: number;
    total_required_reels: number;
    produced_reels: number;
    current_run_meters: number;
    is_completed: boolean;
}

export interface DynamicRunResult {
    run_id: string;
    film: string;
    thickness_micron: number;
    master_width_mm: number;
    total_meters: number;
    segments: MetallizerPackageSegment[];
    transitions: DoffKnifeTransition[];
    arm_schedules: ArmScheduleInterval[];
    doff_events: SlitterDoffEvent[];
    orders_covered: any[];
    fulfilled_order_ids: Set<string>;
    total_weight_kg: number;
    trim_weight_kg: number;
    waste_percent: number;
}

export declare function getOrderPackageDemand(order: VA05Order): {
    reelLengthM: number;
    reelsRequired: number;
    weightPerReelKg: number;
    totalMetersRequired: number;
};

export declare function findBestReplacementArms(
    freedArms: ActiveArmState[],
    continuousArms: ActiveArmState[],
    masterWidthMm: number,
    pendingOrders: VA05Order[],
    orderAllocationMap: Map<string, number>,
    packageLengthM: number,
    options?: DynamicContinuationOptions
): {
    success: boolean;
    replacements: Array<{ arm: ActiveArmState; newOrder: VA05Order; deltaMm: number }>;
    newTrimMm: number;
    transitionType: '1-ARM' | '2-ARM_SAME_SHAFT';
    score: number;
} | null;

export declare function buildDynamicContinuousRun(
    anchorOrders: VA05Order[],
    pendingOrdersPool: VA05Order[],
    orderAllocationMap: Map<string, number>,
    masterWidthMm: number,
    packageLengthM: number,
    runId: string,
    options?: DynamicContinuationOptions
): DynamicRunResult;

export declare function partitionRunIntoPhysicalPlans(
    run: DynamicRunResult,
    startPlanCounter?: number
): MetallizerPlan[];

export declare function runDynamicCampaignOptimization(
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

