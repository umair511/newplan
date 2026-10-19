/**
 * Centralized Universal Weight Calculator for Primary Slitter Planning
 * Strict Implementation of SRS Section 8 & 87
 *
 * Formula:
 * Weight_kg = (Width_mm * Thickness_micron * Density * Length_m) / 1,000,000
 */

export function calculateSingleReelWeight(
  widthMm: number,
  thicknessMicron: number,
  density: number,
  lengthM: number
): number {
  if (widthMm <= 0 || thicknessMicron <= 0 || density <= 0 || lengthM <= 0) {
    return 0;
  }
  const rawWeight = (widthMm * thicknessMicron * density * lengthM) / 1_000_000;
  // Round to 2 decimal places with strict precision
  return Math.round((rawWeight + Number.EPSILON) * 100) / 100;
}

export function calculateWeightHighPrecision(
  widthMm: number,
  thicknessMicron: number,
  density: number,
  lengthM: number
): number {
  if (widthMm <= 0 || thicknessMicron <= 0 || density <= 0 || lengthM <= 0) {
    return 0;
  }
  return (widthMm * thicknessMicron * density * lengthM) / 1_000_000;
}

/**
 * Calculates total weight for given reels
 */
export function calculateBatchWeight(
  widthMm: number,
  thicknessMicron: number,
  density: number,
  lengthM: number,
  reelsCount: number
): number {
  const singleWeight = calculateSingleReelWeight(widthMm, thicknessMicron, density, lengthM);
  const total = singleWeight * reelsCount;
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates trim weight from 10400 mm deckle
 */
export function calculateTrimWeight(
  trimMm: number,
  thicknessMicron: number,
  density: number,
  totalLengthM: number
): number {
  return calculateSingleReelWeight(trimMm, thicknessMicron, density, totalLengthM);
}

/**
 * Calculates parent mill roll jumbo weight
 */
export function calculateMillRollWeight(
  deckleMm: number,
  thicknessMicron: number,
  density: number,
  totalLengthM: number
): number {
  return calculateSingleReelWeight(deckleMm, thicknessMicron, density, totalLengthM);
}
