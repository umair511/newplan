/**
 * Film Compatibility Master Data & Business Rules for Secondary Slitter (SS)
 * 
 * CORE BUSINESS LOGIC:
 * Incompatible films must remain isolated, but explicitly compatible films
 * may and should be optimized together when combined planning produces a better feasible result.
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
export const DEFAULT_FILM_COMPATIBILITY_RULES: FilmCompatibilityRule[] = [
  {
    id: 'COMPAT-001',
    film_a: 'MZ10S-18',
    film_b: 'MZ18',
    is_compatible: true,
    preference: 'PREFER_COMBINED',
    thickness_micron: 18,
    description: 'MZ10S-18 (High SIT Metallized 18µ) ↔ MZ18 (Standard Metallized 18µ)',
    notes: 'Approved compatible metallized 18µ group. Allows shared upstream PS01 jumbo manufacturing and combined SS slitting when beneficial.',
    created_at: '2026-08-22T00:00:00Z',
    updated_at: '2026-08-22T00:00:00Z',
  },
  {
    id: 'COMPAT-002',
    film_a: 'MZ10S-20',
    film_b: 'MZ20',
    is_compatible: true,
    preference: 'PREFER_COMBINED',
    thickness_micron: 20,
    description: 'MZ10S-20 (High SIT Metallized 20µ) ↔ MZ20 (Standard Metallized 20µ)',
    notes: 'Approved compatible metallized 20µ group. Allows shared upstream PS01 jumbo manufacturing and combined SS slitting when beneficial.',
    created_at: '2026-08-22T00:00:00Z',
    updated_at: '2026-08-22T00:00:00Z',
  },
];

/**
 * Check if two film grades are explicitly compatible
 */
export function areFilmsCompatible(
  filmA: string | undefined | null,
  filmB: string | undefined | null,
  rules: FilmCompatibilityRule[] = DEFAULT_FILM_COMPATIBILITY_RULES
): boolean {
  if (!filmA || !filmB) return false;
  const fA = filmA.trim().toUpperCase();
  const fB = filmB.trim().toUpperCase();
  if (fA === fB) return true;

  const match = rules.find(
    r =>
      r.is_compatible &&
      ((r.film_a.toUpperCase() === fA && r.film_b.toUpperCase() === fB) ||
        (r.film_a.toUpperCase() === fB && r.film_b.toUpperCase() === fA))
  );

  return !!match;
}

/**
 * Get all compatible film codes for a given film grade (including itself)
 */
export function getCompatibleFilmsFor(
  film: string,
  rules: FilmCompatibilityRule[] = DEFAULT_FILM_COMPATIBILITY_RULES
): string[] {
  if (!film) return [];
  const normalized = film.trim().toUpperCase();
  const compatible = new Set<string>([film]);

  for (const r of rules) {
    if (!r.is_compatible) continue;
    const fA = r.film_a.trim().toUpperCase();
    const fB = r.film_b.trim().toUpperCase();
    if (fA === normalized) {
      compatible.add(r.film_b);
    } else if (fB === normalized) {
      compatible.add(r.film_a);
    }
  }

  return Array.from(compatible);
}

/**
 * Get the preference for a pair of films
 */
export function getFilmPairPreference(
  filmA: string,
  filmB: string,
  rules: FilmCompatibilityRule[] = DEFAULT_FILM_COMPATIBILITY_RULES
): 'PREFER_COMBINED' | 'PREFER_SEPARATE' | 'NEUTRAL' {
  if (!filmA || !filmB || filmA.toUpperCase() === filmB.toUpperCase()) return 'PREFER_COMBINED';

  const match = rules.find(
    r =>
      r.is_compatible &&
      ((r.film_a.toUpperCase() === filmA.toUpperCase() && r.film_b.toUpperCase() === filmB.toUpperCase()) ||
        (r.film_a.toUpperCase() === filmB.toUpperCase() && r.film_b.toUpperCase() === filmA.toUpperCase()))
  );

  return match ? match.preference : 'PREFER_SEPARATE';
}

/**
 * Get the compatibility group representation for a specific film
 */
export function getCompatibleGroupForFilm(
  film: string,
  rules: FilmCompatibilityRule[] = DEFAULT_FILM_COMPATIBILITY_RULES
): FilmCompatibilityGroup {
  const compatibleFilms = getCompatibleFilmsFor(film, rules);
  const isMulti = compatibleFilms.length > 1;
  const groupName = isMulti ? compatibleFilms.join(' + ') : film;
  const groupId = isMulti ? `GROUP-${compatibleFilms.sort().join('_')}` : `SINGLE-${film}`;

  // Find gauge from rules if available
  let thickness = 18;
  const matchedRule = rules.find(r => compatibleFilms.includes(r.film_a) || compatibleFilms.includes(r.film_b));
  if (matchedRule) {
    thickness = matchedRule.thickness_micron;
  } else {
    const match = film.match(/(\d{2})$/);
    if (match) thickness = parseInt(match[1], 10);
  }

  return {
    group_id: groupId,
    group_name: groupName,
    primary_film: compatibleFilms[0] || film,
    films: compatibleFilms,
    thickness_micron: thickness,
    preference: isMulti ? 'PREFER_COMBINED' : 'NEUTRAL',
    is_combined_eligible: isMulti,
  };
}

/**
 * Partition all available films into distinct compatible film groups
 */
export function getAllCompatibleGroups(
  availableFilms: string[],
  rules: FilmCompatibilityRule[] = DEFAULT_FILM_COMPATIBILITY_RULES
): FilmCompatibilityGroup[] {
  const visited = new Set<string>();
  const groups: FilmCompatibilityGroup[] = [];

  for (const film of availableFilms) {
    const norm = film.trim();
    if (visited.has(norm)) continue;

    const group = getCompatibleGroupForFilm(norm, rules);
    group.films.forEach(f => visited.add(f));
    groups.push(group);
  }

  return groups;
}
