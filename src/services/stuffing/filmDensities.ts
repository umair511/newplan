/**
 * Master Film Densities Database & Single Source of Truth Management
 */

import * as XLSX from 'xlsx';
import { FilmDensityMaster } from '../../types/stuffing';

export const FILM_SPECS_STORAGE_KEY = 'acsoe_film_specs_master_db_v1';

export interface ParsedFilmSpecRow {
  rowNumber: number;
  code: string;
  thickness: number;
  density: number;
  summary_code: string;
  isValid: boolean;
  isDuplicateInBatch: boolean;
  isExistingInDb: boolean;
  errors: string[];
  warnings: string[];
}

export interface FilmSpecsImportResult {
  rows: ParsedFilmSpecRow[];
  summary: {
    total: number;
    validNew: number;
    existingDuplicates: number;
    batchDuplicates: number;
    invalid: number;
  };
}

export const BASELINE_FILM_DENSITIES_DATABASE: FilmDensityMaster[] = [
  // MT Films (IPAK / NURSCON)
  { code: 'MT21D-20', thickness: 20, density: 0.84, summary_code: 'MT21D-20', plant: 'IPAK', rejected_material: 'R-MT21D-20' },

  // PPAK Films
  { code: 'PTN01-10', thickness: 10, density: 1.40, summary_code: 'PTN01-10', plant: 'PPAK', rejected_material: 'R-PTN01-10' },
  { code: 'PTN01-12', thickness: 12, density: 1.40, summary_code: 'PTN01-12', plant: 'PPAK', rejected_material: 'R-PTN01-12' },
  { code: 'PTN01-25', thickness: 25, density: 1.40, summary_code: 'PTN01-25', plant: 'PPAK', rejected_material: 'R-PTN01-25' },
  { code: 'PTN01-30', thickness: 30, density: 1.40, summary_code: 'PTN01-30', plant: 'PPAK', rejected_material: 'R-PTN01-30' },
  { code: 'PVTN01-10', thickness: 10, density: 1.40, summary_code: 'PVTN01-10', plant: 'PPAK', rejected_material: 'R-PVTN01-10' },
  { code: 'PVTN01-12', thickness: 12, density: 1.40, summary_code: 'PVTN01-12', plant: 'PPAK', rejected_material: 'R-PVTN01-12' },
  { code: 'PVTN01-19', thickness: 19, density: 1.40, summary_code: 'PVTN01-19', plant: 'PPAK', rejected_material: 'R-PVTN01-19' },
  { code: 'PVTN00-10', thickness: 10, density: 1.40, summary_code: 'PVTN00-10', plant: 'PPAK', rejected_material: 'R-PVTN00-10' },
  { code: 'PVTN00-12', thickness: 12, density: 1.40, summary_code: 'PVTN00-12', plant: 'PPAK', rejected_material: 'R-PVTN00-12' },
  { code: 'PVMZ01-10', thickness: 10, density: 1.40, summary_code: 'PVMZ01-10', plant: 'PPAK', rejected_material: 'R-PVMZ01-10' },
  { code: 'PVMZ01-12', thickness: 12, density: 1.40, summary_code: 'PVMZ01-12', plant: 'PPAK', rejected_material: 'R-PVMZ01-12' },
  { code: 'PMZV00-10', thickness: 10, density: 1.40, summary_code: 'PMZV00-10', plant: 'PPAK', rejected_material: 'R-PMZV00-10' },
  { code: 'PMZV00-12', thickness: 12, density: 1.40, summary_code: 'PMZV00-12', plant: 'PPAK', rejected_material: 'R-PMZV00-12' },
  { code: 'PVTN01FR-12', thickness: 12, density: 1.40, summary_code: 'PVTN01FR-12', plant: 'PPAK', rejected_material: 'R-PVTN01FR-12' },
  { code: 'PMZ00T-18', thickness: 18, density: 1.40, summary_code: 'PMZ00T-18', plant: 'PPAK', rejected_material: 'R-PMZ00T-18' },
  { code: 'PMZ00T-23', thickness: 23, density: 1.40, summary_code: 'PMZ00T-23', plant: 'PPAK', rejected_material: 'R-PMZ00T-23' },
  { code: 'PVTN01ST-18', thickness: 18, density: 1.40, summary_code: 'PVTN01ST-18', plant: 'PPAK', rejected_material: 'R-PVTN01ST-18' },
  { code: 'PVTN01ST-23', thickness: 23, density: 1.40, summary_code: 'PVTN01ST-23', plant: 'PPAK', rejected_material: 'R-PVTN01ST-23' },
  { code: 'PMZV00ST-23', thickness: 23, density: 1.40, summary_code: 'PMZV00ST-23', plant: 'PPAK', rejected_material: 'R-PMZV00ST-23' },
  { code: 'POWN01NT-20', thickness: 20, density: 1.40, summary_code: 'POWN01NT-20', plant: 'PPAK', rejected_material: 'R-POWN01NT-20' },
  { code: 'POWN01NT-23', thickness: 23, density: 1.40, summary_code: 'POWN01NT-23', plant: 'PPAK', rejected_material: 'R-POWN01NT-23' },

  // CPAK Films
  { code: 'CMB111-20', thickness: 20, density: 0.91, summary_code: 'CMB111-20', plant: 'CPAK', rejected_material: 'R-CMB111-20' },
  { code: 'CMZ111-20', thickness: 20, density: 0.91, summary_code: 'CMZ111-20', plant: 'CPAK', rejected_material: 'R-CMZ111-20' },
  { code: 'CMB21R-20', thickness: 20, density: 0.91, summary_code: 'CMB21R-20', plant: 'CPAK', rejected_material: 'R-CMB21R-20' },
  { code: 'CMB21R-25', thickness: 25, density: 0.91, summary_code: 'CMB21R-25', plant: 'CPAK', rejected_material: 'R-CMB21R-25' },
  { code: 'CMB21R-30', thickness: 30, density: 0.91, summary_code: 'CMB21R-30', plant: 'CPAK', rejected_material: 'R-CMB21R-30' },
  { code: 'CMB21S-18', thickness: 18, density: 0.91, summary_code: 'CMB21S-18', plant: 'CPAK', rejected_material: 'R-CMB21S-18' },
  { code: 'CMB21S-20', thickness: 20, density: 0.91, summary_code: 'CMB21S-20', plant: 'CPAK', rejected_material: 'R-CMB21S-20' },
  { code: 'CMB21S-25', thickness: 25, density: 0.91, summary_code: 'CMB21S-25', plant: 'CPAK', rejected_material: 'R-CMB21S-25' },
  { code: 'CMB21S-30', thickness: 30, density: 0.91, summary_code: 'CMB21S-30', plant: 'CPAK', rejected_material: 'R-CMB21S-30' },
  { code: 'CMB21S-40', thickness: 40, density: 0.91, summary_code: 'CMB21S-40', plant: 'CPAK', rejected_material: 'R-CMB21S-40' },
  { code: 'CMB21S-50', thickness: 50, density: 0.91, summary_code: 'CMB21S-50', plant: 'CPAK', rejected_material: 'R-CMB21S-50' },
  { code: 'CMZ(HB)20', thickness: 20, density: 0.91, summary_code: 'CMZ(HB)20', plant: 'CPAK', rejected_material: 'R-CMZ(HB)20' },
  { code: 'CMZ(HB)25', thickness: 25, density: 0.91, summary_code: 'CMZ(HB)25', plant: 'CPAK', rejected_material: 'R-CMZ(HB)25' },
  { code: 'CMZ(HB)30', thickness: 30, density: 0.91, summary_code: 'CMZ(HB)30', plant: 'CPAK', rejected_material: 'R-CMZ(HB)30' },
  { code: 'CMZ10R-20', thickness: 20, density: 0.91, summary_code: 'CMZ10R-20', plant: 'CPAK', rejected_material: 'R-CMZ10R-20' },
  { code: 'CMZ10R-25', thickness: 25, density: 0.91, summary_code: 'CMZ10R-25', plant: 'CPAK', rejected_material: 'R-CMZ10R-25' },
  { code: 'CMZ10R-30', thickness: 30, density: 0.91, summary_code: 'CMZ10R-30', plant: 'CPAK', rejected_material: 'R-CMZ10R-30' },
  { code: 'CMZ10S-18', thickness: 18, density: 0.91, summary_code: 'CMZ10S-18', plant: 'CPAK', rejected_material: 'R-CMZ10S-18' },
  { code: 'CMZ10S-20', thickness: 20, density: 0.91, summary_code: 'CMZ10S-20', plant: 'CPAK', rejected_material: 'R-CMZ10S-20' },
  { code: 'CMZ10S-25', thickness: 25, density: 0.91, summary_code: 'CMZ10S-25', plant: 'CPAK', rejected_material: 'R-CMZ10S-25' },
  { code: 'CMZ10S-30', thickness: 30, density: 0.91, summary_code: 'CMZ10S-30', plant: 'CPAK', rejected_material: 'R-CMZ10S-30' },
  { code: 'CMZ10S-40', thickness: 40, density: 0.91, summary_code: 'CMZ10S-40', plant: 'CPAK', rejected_material: 'R-CMZ10S-40' },
  { code: 'CMZ10S-50', thickness: 50, density: 0.91, summary_code: 'CMZ10S-50', plant: 'CPAK', rejected_material: 'R-CMZ10S-50' },
  { code: 'CTH21-20', thickness: 20, density: 0.91, summary_code: 'CTH21-20', plant: 'CPAK', rejected_material: 'R-CTH21-20' },
  { code: 'CTH21-25', thickness: 25, density: 0.91, summary_code: 'CTH21-25', plant: 'CPAK', rejected_material: 'R-CTH21-25' },
  { code: 'CTH21-30', thickness: 30, density: 0.91, summary_code: 'CTH21-30', plant: 'CPAK', rejected_material: 'R-CTH21-30' },
  { code: 'CTH21-40', thickness: 40, density: 0.91, summary_code: 'CTH21-40', plant: 'CPAK', rejected_material: 'R-CTH21-40' },
  { code: 'CTH21L-25', thickness: 25, density: 0.91, summary_code: 'CTH21L-25', plant: 'CPAK', rejected_material: 'R-CTH21L-25' },
  { code: 'CTH21L-40', thickness: 40, density: 0.91, summary_code: 'CTH21L-40', plant: 'CPAK', rejected_material: 'R-CTH21L-40' },
  { code: 'CTH21B-30', thickness: 30, density: 0.91, summary_code: 'CTH21B-30', plant: 'CPAK', rejected_material: 'R-CTH21B-30' },
  { code: 'CTN01-15', thickness: 15, density: 0.91, summary_code: 'CTN01-15', plant: 'CPAK', rejected_material: 'R-CTN01-15' },
  { code: 'CMBW21-30', thickness: 30, density: 0.95, summary_code: 'CMBW21-30', plant: 'CPAK', rejected_material: 'R-CMBW21-30' },
  { code: 'CMBW21-40', thickness: 40, density: 0.95, summary_code: 'CMBW21-40', plant: 'CPAK', rejected_material: 'R-CMBW21-40' },
  { code: 'CMZW10-30', thickness: 30, density: 0.95, summary_code: 'CMZW10-30', plant: 'CPAK', rejected_material: 'R-CMZW10-30' },
  { code: 'CMZW10-40', thickness: 40, density: 0.95, summary_code: 'CMZW10-40', plant: 'CPAK', rejected_material: 'R-CMZW10-40' },
  { code: 'CMZWS30', thickness: 30, density: 0.95, summary_code: 'CMZWS30', plant: 'CPAK', rejected_material: 'R-CMZWS30' },
  { code: 'CMZWS40', thickness: 40, density: 0.95, summary_code: 'CMZWS40', plant: 'CPAK', rejected_material: 'R-CMZWS40' },
  { code: 'CW21-25', thickness: 25, density: 0.95, summary_code: 'CW21-25', plant: 'CPAK', rejected_material: 'R-CW21-25' },
  { code: 'CWSO25', thickness: 25, density: 0.95, summary_code: 'CWSO25', plant: 'CPAK', rejected_material: 'R-CWSO25' },

  // IPAK Standard BOPP Films (TH21, TNO, MATTWL, MZ, etc.)
  { code: 'TH21-12', thickness: 12, density: 0.91, summary_code: 'TH12', plant: 'IPAK' },
  { code: 'TH21-15', thickness: 15, density: 0.91, summary_code: 'TH15', plant: 'IPAK' },
  { code: 'TH21-17', thickness: 17, density: 0.91, summary_code: 'TH17', plant: 'IPAK' },
  { code: 'TH21-18', thickness: 18, density: 0.91, summary_code: 'TH18', plant: 'IPAK' },
  { code: 'TH21-20', thickness: 20, density: 0.91, summary_code: 'TH20', plant: 'IPAK' },
  { code: 'TH21-22', thickness: 22, density: 0.91, summary_code: 'TH22', plant: 'IPAK' },
  { code: 'TH21-23', thickness: 23, density: 0.91, summary_code: 'TH23', plant: 'IPAK' },
  { code: 'TH21-24', thickness: 24, density: 0.91, summary_code: 'TH24', plant: 'IPAK' },
  { code: 'TH21-25', thickness: 25, density: 0.91, summary_code: 'TH25', plant: 'IPAK' },
  { code: 'TH21-27', thickness: 27, density: 0.91, summary_code: 'TH21-27', plant: 'IPAK' },
  { code: 'TH21-30', thickness: 30, density: 0.91, summary_code: 'TH30', plant: 'IPAK' },
  { code: 'TH21-35', thickness: 35, density: 0.91, summary_code: 'TH35', plant: 'IPAK' },
  { code: 'TH21-40', thickness: 40, density: 0.91, summary_code: 'TH40', plant: 'IPAK' },
  { code: 'TH21-48', thickness: 48, density: 0.91, summary_code: 'TH48', plant: 'IPAK' },
  { code: 'TH21-50', thickness: 50, density: 0.91, summary_code: 'TH50', plant: 'IPAK' },
  { code: 'TH21A-20', thickness: 20, density: 0.91, summary_code: 'TH21A-20', plant: 'IPAK' },
  { code: 'TH21A-30', thickness: 30, density: 0.91, summary_code: 'TH21A-30', plant: 'IPAK' },
  { code: 'TH21B-15', thickness: 15, density: 0.91, summary_code: 'TH21B-15', plant: 'IPAK' },
  { code: 'TH21B-18', thickness: 18, density: 0.91, summary_code: 'TH21B-18', plant: 'IPAK' },
  { code: 'TH21B-20', thickness: 20, density: 0.91, summary_code: 'TH21B-20', plant: 'IPAK' },
  { code: 'TH21D-20', thickness: 20, density: 0.91, summary_code: 'TH21D-20', plant: 'IPAK' },
  { code: 'TH21D-25', thickness: 25, density: 0.91, summary_code: 'TH21D-25', plant: 'IPAK' },
  { code: 'TH21PC-25', thickness: 25, density: 0.91, summary_code: 'TH21PC-25', plant: 'IPAK' },
  { code: 'TH21PI-18', thickness: 18, density: 0.91, summary_code: 'TH21PI-18', plant: 'IPAK' },
  { code: 'TH21PI-20', thickness: 20, density: 0.91, summary_code: 'TH21PI-20', plant: 'IPAK' },
  { code: 'TH21PI-23', thickness: 23, density: 0.91, summary_code: 'TH21PI-23', plant: 'IPAK' },
  { code: 'TH21PI-24', thickness: 24, density: 0.91, summary_code: 'TH21PI-24', plant: 'IPAK' },
  { code: 'TH21PI-25', thickness: 25, density: 0.91, summary_code: 'TH21PI-25', plant: 'IPAK' },
  { code: 'TH21PI-30', thickness: 30, density: 0.91, summary_code: 'TH30', plant: 'IPAK' },
  { code: 'TH21PI-35', thickness: 35, density: 0.91, summary_code: 'TH35', plant: 'IPAK' },

  // TNO Family
  { code: 'TNO10', thickness: 10, density: 0.91, summary_code: 'TNO10', plant: 'IPAK' },
  { code: 'TNO15', thickness: 15, density: 0.91, summary_code: 'TN15', plant: 'IPAK' },
  { code: 'TNO18', thickness: 18, density: 0.91, summary_code: 'TN18', plant: 'IPAK' },
  { code: 'TNO20', thickness: 20, density: 0.91, summary_code: 'TN20', plant: 'IPAK' },
  { code: 'TNO25', thickness: 25, density: 0.91, summary_code: 'TN25', plant: 'IPAK' },
  { code: 'TNO30', thickness: 30, density: 0.91, summary_code: 'TN30', plant: 'IPAK' },
  { code: 'TNO35', thickness: 35, density: 0.91, summary_code: 'TN35', plant: 'IPAK' },
  { code: 'TNO40', thickness: 40, density: 0.91, summary_code: 'TN40', plant: 'IPAK' },

  // MZ & Metallized Family
  { code: 'MZ10S-08', thickness: 8, density: 0.91, summary_code: 'MZ10S-08', plant: 'IPAK' },
  { code: 'MZ10S-15', thickness: 15, density: 0.91, summary_code: 'MZ15', plant: 'IPAK' },
  { code: 'MZ10S-17', thickness: 17, density: 0.91, summary_code: 'MZ17', plant: 'IPAK' },
  { code: 'MZ10S-18', thickness: 18, density: 0.91, summary_code: 'MZ18', plant: 'IPAK' },
  { code: 'MZ10S-20', thickness: 20, density: 0.91, summary_code: 'MZ20', plant: 'IPAK' },
  { code: 'MZ10S-22', thickness: 22, density: 0.91, summary_code: 'MZ10S-22', plant: 'IPAK' },
  { code: 'MZ10S-25', thickness: 25, density: 0.91, summary_code: 'MZ25', plant: 'IPAK' },
  { code: 'MZ10S-30', thickness: 30, density: 0.91, summary_code: 'MZ30', plant: 'IPAK' },
  { code: 'MZ10S-40', thickness: 40, density: 0.91, summary_code: 'MZ40', plant: 'IPAK' },
  { code: 'MZ10MB-15', thickness: 15, density: 0.91, summary_code: 'MZ10MB-15', plant: 'IPAK' },
  { code: 'MZ10MB-18', thickness: 18, density: 0.91, summary_code: 'MZ10MB-18', plant: 'IPAK' },
  { code: 'MZ15', thickness: 15, density: 0.91, summary_code: 'MZ15', plant: 'IPAK' },
  { code: 'MZ18', thickness: 18, density: 0.91, summary_code: 'MZ18', plant: 'IPAK' },
  { code: 'MZ20', thickness: 20, density: 0.91, summary_code: 'MZ20', plant: 'IPAK' },
  { code: 'MZ25', thickness: 25, density: 0.91, summary_code: 'MZ25', plant: 'IPAK' },
  { code: 'MZ30', thickness: 30, density: 0.91, summary_code: 'MZ30', plant: 'IPAK' },
  { code: 'MZ40', thickness: 40, density: 0.91, summary_code: 'MZ40', plant: 'IPAK' },

  // Matt Films (Density ~0.84)
  { code: 'MT11D-20', thickness: 20, density: 0.84, summary_code: 'MT20', plant: 'IPAK' },
  { code: 'MATTWL12', thickness: 12, density: 0.84, summary_code: 'MATTWL12', plant: 'IPAK' },
  { code: 'MATTWL15', thickness: 15, density: 0.84, summary_code: 'MATTWL15', plant: 'IPAK' },
  { code: 'MATTWL18', thickness: 18, density: 0.84, summary_code: 'MATTWL18', plant: 'IPAK' },
  { code: 'MATTWL20', thickness: 20, density: 0.84, summary_code: 'MATTWL20', plant: 'IPAK' },
  { code: 'MATTWL30', thickness: 30, density: 0.84, summary_code: 'MATTWL30', plant: 'IPAK' },
  { code: 'MATTPL12', thickness: 12, density: 0.82, summary_code: 'MATTPL12', plant: 'IPAK', rejected_material: 'R-MATTPL12' },
  // Pearl / SS-routed fixed-1705 films (required for SS + PS-engine worker path — no localStorage in worker)
  { code: 'TNBPL10', thickness: 10, density: 0.70, summary_code: 'TNBPL10', plant: 'IPAK', rejected_material: 'R-TNBPL10' },
  { code: 'TNBPL-10', thickness: 10, density: 0.70, summary_code: 'TNBPL10', plant: 'IPAK', rejected_material: 'R-TNBPL10' },
  { code: 'MATTPL15', thickness: 15, density: 0.84, summary_code: 'MATTPL15', plant: 'IPAK' },

  // Solid White / Pearlized / Opaque (Density 0.62 - 0.95)
  { code: 'OW219-18', thickness: 18, density: 0.95, summary_code: 'WS18', plant: 'IPAK' },
  { code: 'OW219-20', thickness: 20, density: 0.95, summary_code: 'WS20', plant: 'IPAK' },
  { code: 'OW219-25', thickness: 25, density: 0.95, summary_code: 'WS25', plant: 'IPAK' },
  { code: 'OW219-30', thickness: 30, density: 0.95, summary_code: 'WS30', plant: 'IPAK' },
  { code: 'OW219-35', thickness: 35, density: 0.95, summary_code: 'WS35', plant: 'IPAK' },
  { code: 'OW219-40', thickness: 40, density: 0.95, summary_code: 'WS40', plant: 'IPAK' },
  { code: 'PRL25', thickness: 25, density: 0.70, summary_code: 'PRL25', plant: 'IPAK' },
  { code: 'PRL30', thickness: 30, density: 0.70, summary_code: 'PRL30', plant: 'IPAK' },
  { code: 'PRL38', thickness: 38, density: 0.71, summary_code: 'PRL38', plant: 'IPAK' },
  { code: 'PRL40', thickness: 40, density: 0.70, summary_code: 'PRL40', plant: 'IPAK' },
  { code: 'IML60', thickness: 60, density: 0.62, summary_code: 'IML60', plant: 'IPAK' },
  { code: 'IML-60', thickness: 60, density: 0.55, summary_code: 'IML-60', plant: 'IPAK' },

  // Tape / Industrial (TNIT, THOW, etc.)
  { code: 'TNIT23', thickness: 23, density: 0.91, summary_code: 'TNT23', plant: 'IPAK' },
  { code: 'TNIT-23', thickness: 23, density: 0.91, summary_code: 'TNT23', plant: 'IPAK' },
  { code: 'TNIT25', thickness: 25, density: 0.91, summary_code: 'TNT25', plant: 'IPAK' },
  { code: 'TNIT-35', thickness: 35, density: 0.91, summary_code: 'TNIT-35', plant: 'IPAK' },
  { code: 'THOW18', thickness: 18, density: 0.91, summary_code: 'THW18', plant: 'IPAK' },
  { code: 'THO18', thickness: 18, density: 0.91, summary_code: 'THW18', plant: 'IPAK' },
  { code: 'THOW20', thickness: 20, density: 0.91, summary_code: 'THW20', plant: 'IPAK' },
  { code: 'THO20', thickness: 20, density: 0.91, summary_code: 'THW20', plant: 'IPAK' },
  { code: 'THOW25', thickness: 25, density: 0.91, summary_code: 'THW25', plant: 'IPAK' },
  { code: 'THO25', thickness: 25, density: 0.91, summary_code: 'THW25', plant: 'IPAK' },
  { code: 'THOW30', thickness: 30, density: 0.91, summary_code: 'THW30', plant: 'IPAK' },
  { code: 'THO30', thickness: 30, density: 0.91, summary_code: 'THW30', plant: 'IPAK' },
  { code: 'THOW40', thickness: 40, density: 0.91, summary_code: 'THW40', plant: 'IPAK' },
  { code: 'THO40', thickness: 40, density: 0.91, summary_code: 'THW40', plant: 'IPAK' },
  { code: 'TC20-20', thickness: 20, density: 0.91, summary_code: 'TC20', plant: 'IPAK' },
  { code: 'TC20A-23', thickness: 23, density: 0.91, summary_code: 'TC23', plant: 'IPAK' },
  { code: 'STN02-12', thickness: 12, density: 0.91, summary_code: 'STN12', plant: 'IPAK' },
  { code: 'OC217-40', thickness: 40, density: 0.91, summary_code: 'OC40', plant: 'IPAK' },
  { code: 'TN01-30', thickness: 30, density: 0.91, summary_code: 'TN30', plant: 'IPAK' },
];

export const FILM_DENSITIES_DATABASE: FilmDensityMaster[] = BASELINE_FILM_DENSITIES_DATABASE;

// In-memory cache for fast lookups
let cachedFilmSpecsDb: FilmDensityMaster[] | null = null;
let cachedDensityMap: Map<string, FilmDensityMaster> | null = null;

export function invalidateFilmSpecsCache(): void {
  cachedFilmSpecsDb = null;
  cachedDensityMap = null;
}

/**
 * Permanent planning entry-point for density.
 * Always reloads from localStorage so a just-saved film (any code) is visible
 * on the main thread and can be posted into workers (workers have no localStorage).
 * Use this for: pre-flight density checks AND every worker postMessage.filmSpecs.
 */
export function getFilmSpecsSnapshotForPlanning(): FilmDensityMaster[] {
  invalidateFilmSpecsCache();
  const db = getFilmSpecsDatabase();
  // Structured clone-safe plain objects for worker postMessage
  return db.map(s => ({
    code: s.code,
    thickness: s.thickness,
    density: s.density,
    summary_code: s.summary_code,
    plant: s.plant,
    rejected_material: s.rejected_material,
  }));
}

function rebuildCache(specs: FilmDensityMaster[]) {
  cachedFilmSpecsDb = specs;
  const map = new Map<string, FilmDensityMaster>();
  specs.forEach(item => {
    const rawCode = (item.code || '').trim();
    if (!rawCode) return;
    const upper = rawCode.toUpperCase();
    const cleanKey = upper.replace(/[\s_-]/g, '');
    map.set(upper, item);
    map.set(cleanKey, item);
  });
  cachedDensityMap = map;
}

/**
 * Retrieve the active Film Specs Master Database from local storage
 * Defaults to BASELINE_FILM_DENSITIES_DATABASE if none stored.
 */
export function getFilmSpecsDatabase(): FilmDensityMaster[] {
  if (cachedFilmSpecsDb) {
    return cachedFilmSpecsDb;
  }
  if (typeof window === 'undefined') {
    rebuildCache(BASELINE_FILM_DENSITIES_DATABASE);
    return BASELINE_FILM_DENSITIES_DATABASE;
  }

  try {
    const stored = localStorage.getItem(FILM_SPECS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Validate items
        const validList: FilmDensityMaster[] = parsed
          .filter((x: any) => x && typeof x.code === 'string' && x.code.trim() !== '')
          .map((x: any) => ({
            code: x.code.trim(),
            thickness: Number(x.thickness) || 20,
            density: Number(x.density) > 0 ? Number(x.density) : 0,
            summary_code: (x.summary_code || x.code).trim(),
            plant: x.plant || 'IPAK',
            rejected_material: x.rejected_material
          }));

        if (validList.length > 0) {
          const missingBaselines = BASELINE_FILM_DENSITIES_DATABASE.filter(
            b => !validList.some(v => v.code.toUpperCase() === b.code.toUpperCase())
          );
          if (missingBaselines.length > 0) {
            validList.push(...missingBaselines);
            saveFilmSpecsDatabase(validList);
          }
          rebuildCache(validList);
          return validList;
        }
      }
    }
  } catch (e) {
    console.error('Failed to load film specs database from localStorage:', e);
  }

  rebuildCache(BASELINE_FILM_DENSITIES_DATABASE);
  return BASELINE_FILM_DENSITIES_DATABASE;
}

/**
 * Save Film Specs Master Database to local storage and update runtime caches
 */
export function saveFilmSpecsDatabase(specs: FilmDensityMaster[]): void {
  rebuildCache(specs);
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(FILM_SPECS_STORAGE_KEY, JSON.stringify(specs));
      window.dispatchEvent(new CustomEvent('film-specs-updated', { detail: { count: specs.length } }));
    } catch (e) {
      console.error('Failed to save film specs database to localStorage:', e);
    }
  }
}

/**
 * Seed / refresh in-memory density cache (Web Workers have no localStorage).
 * Main thread must pass getFilmSpecsDatabase() on every synthesis / plan message.
 */
export function hydrateFilmSpecsCache(specs: FilmDensityMaster[] | null | undefined): void {
  if (!specs || !Array.isArray(specs) || specs.length === 0) return;
  // Exact Film Specs Master DB snapshot from main-thread localStorage — no hardcoded merge
  const validList: FilmDensityMaster[] = specs
    .filter((x: any) => x && typeof x.code === 'string' && x.code.trim() !== '')
    .map((x: any) => ({
      code: String(x.code).trim(),
      thickness: Number(x.thickness) > 0 ? Number(x.thickness) : 0,
      density: Number(x.density) > 0 ? Number(x.density) : 0,
      summary_code: String(x.summary_code || x.code).trim(),
      plant: x.plant || 'IPAK',
      rejected_material: x.rejected_material,
    }));
  if (validList.length === 0) return;
  rebuildCache(validList);
}

/**
 * Add a single Film Spec to the Master Database
 */
export function addFilmSpec(spec: {
  code: string;
  thickness: number;
  density: number;
  summary_code: string;
  plant?: string;
}): { success: boolean; error?: string } {
  const code = (spec.code || '').trim();
  if (!code) return { success: false, error: 'Film Code is required.' };
  if (isNaN(spec.thickness) || spec.thickness <= 0) return { success: false, error: 'Thickness (micron) must be a positive number.' };
  if (isNaN(spec.density) || spec.density <= 0) return { success: false, error: 'Density must be a positive number.' };
  
  const summary_code = (spec.summary_code || code).trim();
  const currentDb = getFilmSpecsDatabase();

  const isDuplicate = currentDb.some(
    item => item.code.trim().toUpperCase() === code.toUpperCase()
  );

  if (isDuplicate) {
    return { success: false, error: `Film Code "${code}" already exists in the Master Database.` };
  }

  const newSpec: FilmDensityMaster = {
    code,
    thickness: Number(spec.thickness),
    density: Number(spec.density),
    summary_code,
    plant: spec.plant || 'IPAK'
  };

  const updatedDb = [newSpec, ...currentDb];
  saveFilmSpecsDatabase(updatedDb);
  return { success: true };
}

/**
 * Update an existing Film Spec in the Master Database
 */
export function updateFilmSpec(
  originalCode: string,
  spec: {
    code: string;
    thickness: number;
    density: number;
    summary_code: string;
    plant?: string;
  }
): { success: boolean; error?: string } {
  const code = (spec.code || '').trim();
  if (!code) return { success: false, error: 'Film Code is required.' };
  if (isNaN(spec.thickness) || spec.thickness <= 0) return { success: false, error: 'Thickness (micron) must be a positive number.' };
  if (isNaN(spec.density) || spec.density <= 0) return { success: false, error: 'Density must be a positive number.' };

  const summary_code = (spec.summary_code || code).trim();
  const currentDb = getFilmSpecsDatabase();

  const originalIndex = currentDb.findIndex(
    item => item.code.trim().toUpperCase() === originalCode.trim().toUpperCase()
  );

  if (originalIndex === -1) {
    return { success: false, error: `Original Film Code "${originalCode}" not found in database.` };
  }

  // Check duplicate if code was renamed
  if (originalCode.trim().toUpperCase() !== code.toUpperCase()) {
    const duplicateExists = currentDb.some(
      (item, idx) => idx !== originalIndex && item.code.trim().toUpperCase() === code.toUpperCase()
    );
    if (duplicateExists) {
      return { success: false, error: `Cannot rename to "${code}" because that Film Code already exists.` };
    }
  }

  const updatedDb = [...currentDb];
  updatedDb[originalIndex] = {
    ...updatedDb[originalIndex],
    code,
    thickness: Number(spec.thickness),
    density: Number(spec.density),
    summary_code,
    plant: spec.plant || updatedDb[originalIndex].plant || 'IPAK'
  };

  saveFilmSpecsDatabase(updatedDb);
  return { success: true };
}

/**
 * Delete a Film Spec from the Master Database
 */
export function deleteFilmSpec(code: string): { success: boolean; error?: string } {
  const trimmed = (code || '').trim().toUpperCase();
  const currentDb = getFilmSpecsDatabase();
  const filtered = currentDb.filter(item => item.code.trim().toUpperCase() !== trimmed);

  if (filtered.length === currentDb.length) {
    return { success: false, error: `Film Code "${code}" not found in database.` };
  }

  saveFilmSpecsDatabase(filtered);
  return { success: true };
}

/**
 * Reset the Master Database to baseline factory defaults
 */
export function resetFilmSpecsToDefault(): FilmDensityMaster[] {
  saveFilmSpecsDatabase(BASELINE_FILM_DENSITIES_DATABASE);
  return BASELINE_FILM_DENSITIES_DATABASE;
}

/**
 * Retrieve film specifications with STRICT lookup.
 * 
 * CRITICAL RULE:
 * If the film code is NOT found in the Master Database, returns NULL.
 * NEVER guesses, assumes, or derives thickness, density, or grammage.
 */
/**
 * Strict density for planning engines. Returns null if film not in Film Specs Master DB.
 * Callers MUST NOT invent 0.91 — prompt planner to add density in Film Specs Master.
 */
export function resolveFilmDensity(filmCode: string): number | null {
  const specs = lookupFilmSpecs(filmCode);
  if (specs && specs.is_found && specs.density > 0) return specs.density;
  return null; // Master DB only — never invent / hardcode density
}

export function resolveFilmThickness(filmCode: string): number | null {
  const specs = lookupFilmSpecs(filmCode);
  if (!specs || !specs.is_found || !(specs.thickness > 0)) return null;
  return specs.thickness;
}

/** Films among codes that lack density in the master DB. */
export function findFilmsMissingDensity(filmCodes: string[]): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const raw of filmCodes) {
    const code = (raw || '').trim();
    if (!code) continue;
    const key = code.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (resolveFilmDensity(code) == null) missing.push(code);
  }
  return missing;
}

export function lookupFilmSpecs(
  filmCode: string,
  customDb?: FilmDensityMaster[]
): { thickness: number; density: number; plant: string; summary_code: string; is_found: boolean } | null {
  if (!filmCode || typeof filmCode !== 'string' || !filmCode.trim()) {
    return null;
  }

  const normalized = filmCode.trim().toUpperCase();
  const cleanKey = normalized.replace(/[\s_-]/g, '');

  if (customDb) {
    const found = customDb.find(item => {
      const c = item.code.trim().toUpperCase();
      return c === normalized || c.replace(/[\s_-]/g, '') === cleanKey;
    });
    if (found) {
      return {
        thickness: found.thickness,
        density: found.density,
        plant: found.plant || 'IPAK',
        summary_code: found.summary_code || found.code,
        is_found: true
      };
    }
    return null;
  }

  if (!cachedDensityMap) {
    getFilmSpecsDatabase();
  }

  if (cachedDensityMap?.has(normalized)) {
    const found = cachedDensityMap.get(normalized)!;
    return {
      thickness: found.thickness,
      density: found.density,
      plant: found.plant || 'IPAK',
      summary_code: found.summary_code || found.code,
      is_found: true
    };
  }

  if (cachedDensityMap?.has(cleanKey)) {
    const found = cachedDensityMap.get(cleanKey)!;
    return {
      thickness: found.thickness,
      density: found.density,
      plant: found.plant || 'IPAK',
      summary_code: found.summary_code || found.code,
      is_found: true
    };
  }

  // Soft aliases: factory short codes → catalog codes (e.g. THO18 → THOW18)
  const aliasCandidates: string[] = [];
  const tho = normalized.match(/^THO(\d+)$/i);
  if (tho) aliasCandidates.push(`THOW${tho[1]}`);
  const thow = normalized.match(/^THOW(\d+)$/i);
  if (thow) aliasCandidates.push(`THO${thow[1]}`);
  for (const alt of aliasCandidates) {
    const altClean = alt.replace(/[\s_-]/g, '');
    const found = cachedDensityMap?.get(alt) || cachedDensityMap?.get(altClean);
    if (found) {
      return {
        thickness: found.thickness,
        density: found.density,
        plant: found.plant || 'IPAK',
        summary_code: found.summary_code || found.code,
        is_found: true
      };
    }
  }

  // STRICT RULE: Unknown film code returns null.
  return null;
}

/**
 * Parses raw tabular text (pasted from Excel, CSV, or TSV)
 * Format: Film Code | Thickness | Density | Code for Summary
 */
export function parseFilmSpecsTabular(
  rawText: string,
  existingDb: FilmDensityMaster[] = getFilmSpecsDatabase()
): FilmSpecsImportResult {
  const lines = (rawText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows: ParsedFilmSpecRow[] = [];
  const seenInBatch = new Set<string>();

  const existingCodes = new Set<string>(
    existingDb.map(item => item.code.trim().toUpperCase())
  );

  let rowCounter = 0;

  for (const line of lines) {
    rowCounter++;
    // Split by tab, pipe, or comma
    let parts: string[] = [];
    if (line.includes('\t')) {
      parts = line.split('\t');
    } else if (line.includes('|')) {
      parts = line.split('|');
    } else if (line.includes(',')) {
      parts = line.split(',');
    } else {
      parts = line.split(/\s{2,}/); // 2+ spaces
    }

    parts = parts.map(p => p.trim());
    if (parts.length === 0 || (parts.length === 1 && !parts[0])) continue;

    // Check if header row
    const firstPartLower = parts[0].toLowerCase();
    if (
      (firstPartLower === 'film code' || firstPartLower === 'film' || firstPartLower === 'code') &&
      rowCounter === 1
    ) {
      continue;
    }

    const rawCode = parts[0] || '';
    const rawThickness = parts[1] || '';
    const rawDensity = parts[2] || '';
    const rawSummaryCode = parts[3] || rawCode;

    const thickness = parseFloat(rawThickness);
    const density = parseFloat(rawDensity);

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!rawCode) {
      errors.push('Film Code is required.');
    }

    if (!rawThickness || isNaN(thickness) || thickness <= 0) {
      errors.push('Thickness must be a positive number in microns.');
    }

    if (!rawDensity || isNaN(density) || density <= 0) {
      errors.push('Density must be a positive number (e.g. 0.91, 1.40).');
    }

    const upperCode = rawCode.toUpperCase();
    const isDuplicateInBatch = seenInBatch.has(upperCode);
    if (isDuplicateInBatch && rawCode) {
      errors.push(`Duplicate Film Code in this import batch.`);
    } else if (rawCode) {
      seenInBatch.add(upperCode);
    }

    const isExistingInDb = existingCodes.has(upperCode);
    if (isExistingInDb) {
      warnings.push(`Film Code already exists in database (will overwrite or skip per selected action).`);
    }

    const isValid = errors.length === 0;

    rows.push({
      rowNumber: rowCounter,
      code: rawCode,
      thickness: isNaN(thickness) ? 0 : thickness,
      density: isNaN(density) ? 0 : density,
      summary_code: rawSummaryCode || rawCode,
      isValid,
      isDuplicateInBatch,
      isExistingInDb,
      errors,
      warnings
    });
  }

  const validNew = rows.filter(r => r.isValid && !r.isExistingInDb).length;
  const existingDuplicates = rows.filter(r => r.isValid && r.isExistingInDb).length;
  const batchDuplicates = rows.filter(r => r.isDuplicateInBatch).length;
  const invalid = rows.filter(r => !r.isValid).length;

  return {
    rows,
    summary: {
      total: rows.length,
      validNew,
      existingDuplicates,
      batchDuplicates,
      invalid
    }
  };
}

/**
 * Parses an Excel or CSV file for Film Specs
 */
export async function parseFilmSpecsExcel(
  file: File,
  existingDb: FilmDensityMaster[] = getFilmSpecsDatabase()
): Promise<FilmSpecsImportResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        if (!rawRows || rawRows.length === 0) {
          resolve({
            rows: [],
            summary: { total: 0, validNew: 0, existingDuplicates: 0, batchDuplicates: 0, invalid: 0 }
          });
          return;
        }

        // Detect header row index
        let headerRowIdx = -1;
        let colMap = { code: -1, thickness: -1, density: -1, summary_code: -1 };

        for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
          const row = rawRows[i].map(c => String(c || '').toLowerCase().trim());
          const codeIdx = row.findIndex(c => c.includes('film') || c.includes('code') || c === 'grade');
          const thickIdx = row.findIndex(c => c.includes('thick') || c.includes('micron') || c.includes('mic') || c === 'thk');
          const densIdx = row.findIndex(c => c.includes('dens') || c.includes('grammage') || c.includes('gravity'));
          const sumIdx = row.findIndex(c => c.includes('summary') || c.includes('short') || c.includes('abbr'));

          if (codeIdx !== -1 && (thickIdx !== -1 || densIdx !== -1)) {
            headerRowIdx = i;
            colMap = {
              code: codeIdx,
              thickness: thickIdx !== -1 ? thickIdx : 1,
              density: densIdx !== -1 ? densIdx : 2,
              summary_code: sumIdx !== -1 ? sumIdx : 3
            };
            break;
          }
        }

        const dataLines: string[] = [];
        const startIdx = headerRowIdx !== -1 ? headerRowIdx + 1 : 0;

        for (let i = startIdx; i < rawRows.length; i++) {
          const row = rawRows[i];
          if (!row || row.length === 0) continue;

          let code = '';
          let thickness = '';
          let density = '';
          let summaryCode = '';

          if (headerRowIdx !== -1) {
            code = String(row[colMap.code] ?? '').trim();
            thickness = String(row[colMap.thickness] ?? '').trim();
            density = String(row[colMap.density] ?? '').trim();
            summaryCode = colMap.summary_code !== -1 && row[colMap.summary_code] !== undefined
              ? String(row[colMap.summary_code]).trim()
              : code;
          } else {
            code = String(row[0] ?? '').trim();
            thickness = String(row[1] ?? '').trim();
            density = String(row[2] ?? '').trim();
            summaryCode = String(row[3] ?? code).trim();
          }

          if (code || thickness || density) {
            dataLines.push(`${code}\t${thickness}\t${density}\t${summaryCode}`);
          }
        }

        const result = parseFilmSpecsTabular(dataLines.join('\n'), existingDb);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Export Film Specs Database to Excel file
 */
export function exportFilmSpecsToExcel(
  specs: FilmDensityMaster[] = getFilmSpecsDatabase(),
  filename: string = 'Film_Specs_Master_Database.xlsx'
): void {
  const headers = ['Film Code', 'Thickness (micron)', 'Density (g/cm3)', 'Code for Summary', 'Plant'];
  const rows = specs.map(s => [
    s.code,
    s.thickness,
    s.density,
    s.summary_code || s.code,
    s.plant || 'IPAK'
  ]);

  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  ws['!cols'] = [
    { wch: 18 },
    { wch: 20 },
    { wch: 18 },
    { wch: 22 },
    { wch: 12 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Film Specs Master');
  XLSX.writeFile(wb, filename);
}

/**
 * Download standard Excel template for bulk importing film specs
 */
export function downloadFilmSpecsTemplate(): void {
  const headers = ['Film Code', 'Thickness (micron)', 'Density', 'Code for Summary'];
  const sampleData = [
    ['TH21-30', 30, 0.91, 'TH30'],
    ['MZ10S-18', 18, 0.91, 'MZ18'],
    ['PTN01-12', 12, 1.40, 'PTN01-12'],
    ['MATTWL20', 20, 0.84, 'MATTWL20'],
    ['OW219-25', 25, 0.95, 'WS25']
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleData]);
  ws['!cols'] = [{ wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 20 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Film Specs Template');
  XLSX.writeFile(wb, 'Film_Specs_Import_Template.xlsx');
}

