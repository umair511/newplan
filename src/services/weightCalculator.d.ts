/**
 * Centralized Universal Weight Calculator for Primary Slitter Planning
 * Strict Implementation of SRS Section 8 & 87
 *
 * Formula:
 * Weight_kg = (Width_mm * Thickness_micron * Density * Length_m) / 1,000,000
 */
export declare function calculateSingleReelWeight(widthMm: number, thicknessMicron: number, density: number, lengthM: number): number;
export declare function calculateWeightHighPrecision(widthMm: number, thicknessMicron: number, density: number, lengthM: number): number;
/**
 * Calculates total weight for given reels
 */
export declare function calculateBatchWeight(widthMm: number, thicknessMicron: number, density: number, lengthM: number, reelsCount: number): number;
/**
 * Calculates trim weight from 10400 mm deckle
 */
export declare function calculateTrimWeight(trimMm: number, thicknessMicron: number, density: number, totalLengthM: number): number;
/**
 * Calculates parent mill roll jumbo weight
 */
export declare function calculateMillRollWeight(deckleMm: number, thicknessMicron: number, density: number, totalLengthM: number): number;
