import { SSMachineSettings, SSJumboRoll, MetallizerMachineSettings, JumboRoll } from '../../types/ss';

/** Selectable PS01 mother deckles for SS jumbo-roll synthesis (trim window unchanged). */
export const SS_PS01_DECKLE_OPTIONS = [10400, 10330, 8700, 8630] as const;
export type SSPs01DeckleOption = (typeof SS_PS01_DECKLE_OPTIONS)[number];

export const DEFAULT_SS_SETTINGS: SSMachineSettings = {
  id: 'ss-settings-01',
  machine_name: 'Secondary Slitter',
  physical_ups: 20,
  preferred_ups: 6,
  max_planning_ups: 20,
  max_jumbo_width_mm: 1730,
  ps01_deckle_width_mm: 10400,
  max_jumbo_diameter_mm: 1000,
  min_trim_mm: 11,   // GREEN zone lower bound
  max_trim_mm: 35,   // GREEN zone upper bound
  hard_max_trim_mm: 45, // YELLOW zone upper bound (36–45)
  core: '6" paper core',
  density: 0.91,
  package_multiples: [1, 2, 3, 4, 5, 6],
  thickness_micron_default: 18,
  updated_at: '2026-08-21T00:00:00Z',
};

export const DEFAULT_METALLIZER_SETTINGS = DEFAULT_SS_SETTINGS;

/**
 * EXACT HARD RULE FORMULA:
 * Diameter (mm) = 1.14 * SQRT(Thickness (µm) * Length (m))
 * (Thickness is used directly in microns, e.g. 18)
 */
export function calculateJumboDiameter(thicknessMicron: number, lengthM: number): number {
  if (thicknessMicron <= 0 || lengthM <= 0) return 0;
  return Number((1.14 * Math.sqrt(thicknessMicron * lengthM)).toFixed(2));
}

/**
 * Universal Weight Formula:
 * Weight (kg) = (Width (mm) * Thickness (µm) * Density (g/cm³) * Length (m)) / 1,000,000
 */
export function calculateJumboWeight(
  widthMm: number,
  thicknessMicron: number,
  density: number,
  lengthM: number
): number {
  return Number(((widthMm * thicknessMicron * density * lengthM) / 1000000).toFixed(2));
}

export const INITIAL_SS_JUMBO_ROLLS: SSJumboRoll[] = [
  {
    id: 'ss-jr-001',
    roll_id: 'SS-JR-MZ18-1700-01',
    film: 'MZ18',
    width_mm: 1700,
    length_m: 39000,
    thickness_micron: 18,
    diameter_mm: calculateJumboDiameter(18, 39000), // ~955.16 mm
    core: '6" paper core',
    density: 0.91,
    production_date: '2026-08-20',
    status: 'AVAILABLE',
    remaining_length_m: 39000,
    total_weight_kg: calculateJumboWeight(1700, 18, 0.91, 39000),
    remaining_quantity_kg: calculateJumboWeight(1700, 18, 0.91, 39000),
    notes: 'Secondary Slitter MZ18 jumbo feed roll (1700mm max deckle)',
    created_at: '2026-08-20T08:00:00Z',
    updated_at: '2026-08-20T08:00:00Z',
  },
  {
    id: 'ss-jr-002',
    roll_id: 'SS-JR-MZ18-1650-01',
    film: 'MZ18',
    width_mm: 1650,
    length_m: 39000,
    thickness_micron: 18,
    diameter_mm: calculateJumboDiameter(18, 39000), // ~955.16 mm (<1000mm -> VALID)
    core: '6" paper core',
    density: 0.91,
    production_date: '2026-08-20',
    status: 'AVAILABLE',
    remaining_length_m: 39000,
    total_weight_kg: calculateJumboWeight(1650, 18, 0.91, 39000),
    remaining_quantity_kg: calculateJumboWeight(1650, 18, 0.91, 39000),
    notes: 'Double-pack SS MZ18 jumbo roll (2 x 19500m)',
    created_at: '2026-08-20T08:30:00Z',
    updated_at: '2026-08-20T08:30:00Z',
  },
  {
    id: 'ss-jr-003',
    roll_id: 'SS-JR-MZ18-1500-01',
    film: 'MZ18',
    width_mm: 1500,
    length_m: 19500,
    thickness_micron: 18,
    diameter_mm: calculateJumboDiameter(18, 19500), // ~675.39 mm
    core: '6" paper core',
    density: 0.91,
    production_date: '2026-08-20',
    status: 'AVAILABLE',
    remaining_length_m: 19500,
    total_weight_kg: calculateJumboWeight(1500, 18, 0.91, 19500),
    remaining_quantity_kg: calculateJumboWeight(1500, 18, 0.91, 19500),
    notes: 'Single-pack 19500m 10" core SS MZ18 jumbo',
    created_at: '2026-08-20T09:00:00Z',
    updated_at: '2026-08-20T09:00:00Z',
  },
  {
    id: 'ss-jr-004',
    roll_id: 'SS-JR-MZ18-1680-01',
    film: 'MZ18',
    width_mm: 1680,
    length_m: 39000,
    thickness_micron: 18,
    diameter_mm: calculateJumboDiameter(18, 39000),
    core: '6" paper core',
    density: 0.91,
    production_date: '2026-08-20',
    status: 'AVAILABLE',
    remaining_length_m: 39000,
    total_weight_kg: calculateJumboWeight(1680, 18, 0.91, 39000),
    remaining_quantity_kg: calculateJumboWeight(1680, 18, 0.91, 39000),
    notes: 'Secondary slitter feed jumbo (MZ18 grade)',
    created_at: '2026-08-20T09:30:00Z',
    updated_at: '2026-08-20T09:30:00Z',
  },
  {
    id: 'ss-jr-005',
    roll_id: 'SS-JR-MZ18-1450-01',
    film: 'MZ18',
    width_mm: 1450,
    length_m: 39000,
    thickness_micron: 18,
    diameter_mm: calculateJumboDiameter(18, 39000),
    core: '6" paper core',
    density: 0.91,
    production_date: '2026-08-20',
    status: 'AVAILABLE',
    remaining_length_m: 39000,
    total_weight_kg: calculateJumboWeight(1450, 18, 0.91, 39000),
    remaining_quantity_kg: calculateJumboWeight(1450, 18, 0.91, 39000),
    notes: 'Matched for SS MZ18 combos',
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
  },
  {
    id: 'ss-jr-006',
    roll_id: 'SS-JR-MZ20-1600-01',
    film: 'MZ20',
    width_mm: 1600,
    length_m: 30000,
    thickness_micron: 20,
    diameter_mm: calculateJumboDiameter(20, 30000), // ~883.04 mm
    core: '6" paper core',
    density: 0.91,
    production_date: '2026-08-20',
    status: 'AVAILABLE',
    remaining_length_m: 30000,
    total_weight_kg: calculateJumboWeight(1600, 20, 0.91, 30000),
    remaining_quantity_kg: calculateJumboWeight(1600, 20, 0.91, 30000),
    notes: 'SS MZ20 20µm jumbo roll',
    created_at: '2026-08-20T10:30:00Z',
    updated_at: '2026-08-20T10:30:00Z',
  },
  {
    id: 'ss-jr-007',
    roll_id: 'SS-JR-MZ18-1700-02',
    film: 'MZ18',
    width_mm: 1700,
    length_m: 39000,
    thickness_micron: 18,
    diameter_mm: calculateJumboDiameter(18, 39000), // ~955.16 mm (<1000mm -> VALID)
    core: '6" paper core',
    density: 0.91,
    production_date: '2026-08-21',
    status: 'AVAILABLE',
    remaining_length_m: 39000,
    total_weight_kg: calculateJumboWeight(1700, 18, 0.91, 39000),
    remaining_quantity_kg: calculateJumboWeight(1700, 18, 0.91, 39000),
    notes: '39,000m high-efficiency SS MZ18 jumbo, diameter 955.16mm <= 1000mm',
    created_at: '2026-08-21T07:00:00Z',
    updated_at: '2026-08-21T07:00:00Z',
  },
];

export const INITIAL_JUMBO_ROLLS = INITIAL_SS_JUMBO_ROLLS;
