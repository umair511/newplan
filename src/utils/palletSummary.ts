import { PalletSlotInfo } from '../types/stuffing';

/**
 * Generates the compact composition summary for a pallet card or stuffing grid slot.
 *
 * Case A (Mixed size, single film):
 *   MIXED PALLET
 *   12 Reels
 *   CMZ10S-25
 *   1000×3 + 960×3
 *   720×3 + 750×3
 *
 * Case B (Mixed film):
 *   MIXED PALLET
 *   12 Reels
 *   CMZ10S-25: 780×6
 *   CTH21L-40: 960×6
 */
export function formatCompactPalletSummary(pallet: PalletSlotInfo): string[] {
  if (!pallet.is_mixed || !pallet.items || pallet.items.length === 0) {
    return [];
  }

  const uniqueFilms = Array.from(new Set(pallet.items.map(i => i.film)));

  if (uniqueFilms.length > 1) {
    // Mixed film case: group each film and list sizes and reel quantities
    return uniqueFilms.map(f => {
      const itemsForFilm = pallet.items.filter(i => i.film === f);
      const parts = itemsForFilm.map(i => `${i.size}×${i.reels}`).join(' + ');
      return `${f}: ${parts}`;
    });
  } else {
    // Mixed size case: show film code on first line, then slit size × reels combinations
    const film = uniqueFilms[0] || pallet.primary_film;
    const lines: string[] = [film];
    const sizeParts = pallet.items.map(i => `${i.size}×${i.reels}`);
    for (let i = 0; i < sizeParts.length; i += 2) {
      lines.push(sizeParts.slice(i, i + 2).join(' + '));
    }
    return lines;
  }
}
