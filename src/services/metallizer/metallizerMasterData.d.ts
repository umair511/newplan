import { MetallizerMachineSettings, JumboRoll } from '../../types/metallizer';
export declare const MSL_GREEN_MIN_TRIM_MM = 18;
export declare const MSL_GREEN_MAX_TRIM_MM = 45;
export declare const MSL_TARGET_TRIM_MM = 25;
export declare const MSL_CUSTOMER_MAX_OVERALLOCATION_FACTOR = 1.1;
export declare const DEFAULT_METALLIZER_SETTINGS: MetallizerMachineSettings;
/**
 * EXACT HARD RULE FORMULA:
 * Diameter (mm) = 1.14 * SQRT(Thickness (µm) * Length (m))
 * (Thickness is used directly in microns, e.g. 18)
 */
export declare function calculateJumboDiameter(thicknessMicron: number, lengthM: number): number;
/**
 * Universal Weight Formula:
 * Weight (kg) = (Width (mm) * Thickness (µm) * Density (g/cm³) * Length (m)) / 1,000,000
 */
export declare function calculateJumboWeight(widthMm: number, thicknessMicron: number, density: number, lengthM: number): number;
export declare const INITIAL_JUMBO_ROLLS: JumboRoll[];
