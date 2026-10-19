/**
 * Film Compatibility Master Data & Business Rules
 *
 * CORE BUSINESS LOGIC:
 * Incompatible films must remain isolated, but explicitly compatible films
 * may and should be optimized together when combined planning produces a better feasible result.
 *
 * Compatibility is a PERMISSION + PREFERENCE, not a blind merge.
 * The optimizer evaluates both:
 * - Option A: Separate Planning
 * - Option B: Combined Planning
 * and selects the best feasible result according to the locked optimization priority hierarchy.
 */
export interface FilmCompatibilityRule {
    id: string;
    film_a: string;
    film_b: string;
    is_compatible: boolean;
    preference: 'PREFER_COMBINED' | 'PREFER_SEPARATE' | 'NEUTRAL';
    thickness_micron: number;
    description: string;
    notes?: string;
    created_at: string;
    updated_at: string;
}
export interface FilmCompatibilityGroup {
    group_id: string;
    group_name: string;
    primary_film: string;
    films: string[];
    thickness_micron: number;
    preference: 'PREFER_COMBINED' | 'PREFER_SEPARATE' | 'NEUTRAL';
    is_combined_eligible: boolean;
}
/**
 * Authoritative Master Rules for Film Compatibility
 */
export declare const DEFAULT_FILM_COMPATIBILITY_RULES: FilmCompatibilityRule[];
/**
 * Check if two film grades are explicitly compatible
 */
export declare function areFilmsCompatible(filmA: string | undefined | null, filmB: string | undefined | null, rules?: FilmCompatibilityRule[]): boolean;
/**
 * Get all compatible film codes for a given film grade (including itself)
 */
export declare function getCompatibleFilmsFor(film: string, rules?: FilmCompatibilityRule[]): string[];
/**
 * Get the preference for a pair of films
 */
export declare function getFilmPairPreference(filmA: string, filmB: string, rules?: FilmCompatibilityRule[]): 'PREFER_COMBINED' | 'PREFER_SEPARATE' | 'NEUTRAL';
/**
 * Get the compatibility group representation for a specific film
 */
export declare function getCompatibleGroupForFilm(film: string, rules?: FilmCompatibilityRule[]): FilmCompatibilityGroup;
/**
 * Partition all available films into distinct compatible film groups
 */
export declare function getAllCompatibleGroups(availableFilms: string[], rules?: FilmCompatibilityRule[]): FilmCompatibilityGroup[];
