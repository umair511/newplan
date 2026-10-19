"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INITIAL_JUMBO_ROLLS = exports.DEFAULT_METALLIZER_SETTINGS = void 0;
exports.calculateJumboDiameter = calculateJumboDiameter;
exports.calculateJumboWeight = calculateJumboWeight;
exports.DEFAULT_METALLIZER_SETTINGS = {
    id: 'msl-settings-01',
    machine_name: 'Metallizer Slitter',
    physical_ups: 6,
    preferred_ups: 3,
    max_planning_ups: 6,
    max_jumbo_width_mm: 3650,
    max_jumbo_diameter_mm: 1250,
    min_trim_mm: 20,
    max_trim_mm: 30,
    core: '10-inch steel core',
    density: 0.91,
    package_multiples: [1, 2, 3, 4, 5, 6],
    thickness_micron_default: 18,
    updated_at: '2026-08-21T00:00:00Z',
};
/**
 * EXACT HARD RULE FORMULA:
 * Diameter (mm) = 1.14 * SQRT(Thickness (µm) * Length (m))
 * (Thickness is used directly in microns, e.g. 18)
 */
function calculateJumboDiameter(thicknessMicron, lengthM) {
    if (thicknessMicron <= 0 || lengthM <= 0)
        return 0;
    return Number((1.14 * Math.sqrt(thicknessMicron * lengthM)).toFixed(2));
}
/**
 * Universal Weight Formula:
 * Weight (kg) = (Width (mm) * Thickness (µm) * Density (g/cm³) * Length (m)) / 1,000,000
 */
function calculateJumboWeight(widthMm, thicknessMicron, density, lengthM) {
    return Number(((widthMm * thicknessMicron * density * lengthM) / 1000000).toFixed(2));
}
exports.INITIAL_JUMBO_ROLLS = [
    {
        id: 'jr-001',
        roll_id: 'JR-MZ18-3000-01',
        film: 'MZ18',
        width_mm: 3000,
        length_m: 39000,
        thickness_micron: 18,
        diameter_mm: calculateJumboDiameter(18, 39000), // ~955.16 mm
        core: '10-inch steel core',
        density: 0.91,
        production_date: '2026-08-20',
        status: 'AVAILABLE',
        remaining_length_m: 39000,
        total_weight_kg: calculateJumboWeight(3000, 18, 0.91, 39000),
        remaining_quantity_kg: calculateJumboWeight(3000, 18, 0.91, 39000),
        notes: 'Prime MZ18 mother jumbo roll from Metallizer Chamber 1',
        created_at: '2026-08-20T08:00:00Z',
        updated_at: '2026-08-20T08:00:00Z',
    },
    {
        id: 'jr-002',
        roll_id: 'JR-MZ18-2450-01',
        film: 'MZ18',
        width_mm: 2450,
        length_m: 58500,
        thickness_micron: 18,
        diameter_mm: calculateJumboDiameter(18, 58500), // ~1169.88 mm
        core: '10-inch steel core',
        density: 0.91,
        production_date: '2026-08-20',
        status: 'AVAILABLE',
        remaining_length_m: 58500,
        total_weight_kg: calculateJumboWeight(2450, 18, 0.91, 58500),
        remaining_quantity_kg: calculateJumboWeight(2450, 18, 0.91, 58500),
        notes: 'Triple-pack MZ18 jumbo roll (3 x 19500m)',
        created_at: '2026-08-20T08:30:00Z',
        updated_at: '2026-08-20T08:30:00Z',
    },
    {
        id: 'jr-003',
        roll_id: 'JR-MZ18-1950-01',
        film: 'MZ18',
        width_mm: 1950,
        length_m: 19500,
        thickness_micron: 18,
        diameter_mm: calculateJumboDiameter(18, 19500), // ~675.39 mm
        core: '10-inch steel core',
        density: 0.91,
        production_date: '2026-08-20',
        status: 'AVAILABLE',
        remaining_length_m: 19500,
        total_weight_kg: calculateJumboWeight(1950, 18, 0.91, 19500),
        remaining_quantity_kg: calculateJumboWeight(1950, 18, 0.91, 19500),
        notes: 'Single-pack 19500m 10" core MZ18 jumbo',
        created_at: '2026-08-20T09:00:00Z',
        updated_at: '2026-08-20T09:00:00Z',
    },
    {
        id: 'jr-004',
        roll_id: 'JR-MZ18-3050-01',
        film: 'MZ18',
        width_mm: 3050,
        length_m: 39000,
        thickness_micron: 18,
        diameter_mm: calculateJumboDiameter(18, 39000),
        core: '10-inch steel core',
        density: 0.91,
        production_date: '2026-08-20',
        status: 'AVAILABLE',
        remaining_length_m: 39000,
        total_weight_kg: calculateJumboWeight(3050, 18, 0.91, 39000),
        remaining_quantity_kg: calculateJumboWeight(3050, 18, 0.91, 39000),
        notes: 'Metallizer slitter feed jumbo (MZ18 grade)',
        created_at: '2026-08-20T09:30:00Z',
        updated_at: '2026-08-20T09:30:00Z',
    },
    {
        id: 'jr-005',
        roll_id: 'JR-MZ18-2700-01',
        film: 'MZ18',
        width_mm: 2700,
        length_m: 39000,
        thickness_micron: 18,
        diameter_mm: calculateJumboDiameter(18, 39000),
        core: '10-inch steel core',
        density: 0.91,
        production_date: '2026-08-20',
        status: 'AVAILABLE',
        remaining_length_m: 39000,
        total_weight_kg: calculateJumboWeight(2700, 18, 0.91, 39000),
        remaining_quantity_kg: calculateJumboWeight(2700, 18, 0.91, 39000),
        notes: 'Matched for 3 x 895mm MZ18 3-ups combos',
        created_at: '2026-08-20T10:00:00Z',
        updated_at: '2026-08-20T10:00:00Z',
    },
    {
        id: 'jr-006',
        roll_id: 'JR-MZ20-3200-01',
        film: 'MZ20',
        width_mm: 3200,
        length_m: 30000,
        thickness_micron: 20,
        diameter_mm: calculateJumboDiameter(20, 30000), // ~883.04 mm
        core: '10-inch steel core',
        density: 0.91,
        production_date: '2026-08-20',
        status: 'AVAILABLE',
        remaining_length_m: 30000,
        total_weight_kg: calculateJumboWeight(3200, 20, 0.91, 30000),
        remaining_quantity_kg: calculateJumboWeight(3200, 20, 0.91, 30000),
        notes: 'MZ20 20µm jumbo roll',
        created_at: '2026-08-20T10:30:00Z',
        updated_at: '2026-08-20T10:30:00Z',
    },
    {
        id: 'jr-007',
        roll_id: 'JR-MZ18-3600-01',
        film: 'MZ18',
        width_mm: 3600,
        length_m: 60000,
        thickness_micron: 18,
        diameter_mm: calculateJumboDiameter(18, 60000), // ~1185.50 mm (<1250mm -> VALID)
        core: '10-inch steel core',
        density: 0.91,
        production_date: '2026-08-21',
        status: 'AVAILABLE',
        remaining_length_m: 60000,
        total_weight_kg: calculateJumboWeight(3600, 18, 0.91, 60000),
        remaining_quantity_kg: calculateJumboWeight(3600, 18, 0.91, 60000),
        notes: '60,000m high-efficiency MZ18 jumbo, diameter 1185.5mm <= 1250mm',
        created_at: '2026-08-21T07:00:00Z',
        updated_at: '2026-08-21T07:00:00Z',
    },
];
