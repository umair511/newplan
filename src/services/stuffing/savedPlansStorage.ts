/**
 * Storage & Search Service for Automated Container Stuffing & Optimization Engine (ACSOE)
 * Manages Saved Stuffing Plans, Search by Customer / Sales Order #, and Local Persistence
 */

import { SavedStuffingPlan, OrderInput } from '../../types/stuffing';

const STORAGE_KEY = 'acsoe_saved_stuffing_plans_v2';

export const SEED_SAVED_PLANS: SavedStuffingPlan[] = [
  {
    id: 'plan_factory_vpp_20ft_000',
    plan_name: 'FACTORY VPP (1+1) - 20ft Container Master Stuffing Plan',
    customer: 'FACTORY VPP EXPORT',
    sales_order: 'SO-4500955',
    po_ref: 'PO 26-VPP-20FT',
    container_type: '20ft',
    packing_mode: 'VPP',
    total_containers: 1,
    total_weight: 9474,
    total_pallets: 16,
    items_count: 6,
    orders: [
      { item: 10, film: 'TC20-20', size: 110, length: 3600, core: 3, dia: 315, qty: 6054.05, customer: 'FACTORY VPP EXPORT', po_ref: 'PO 26-VPP-20FT', packing_mode: 'VPP', container_type: '20ft' },
      { item: 20, film: 'TC20-20', size: 118, length: 4000, core: 3, dia: 332, qty: 1443.19, customer: 'FACTORY VPP EXPORT', po_ref: 'PO 26-VPP-20FT', packing_mode: 'VPP', container_type: '20ft' },
      { item: 30, film: 'TC20A-23', size: 342, length: 3000, core: 6, dia: 308, qty: 579.80, customer: 'FACTORY VPP EXPORT', po_ref: 'PO 26-VPP-20FT', packing_mode: 'VPP', container_type: '20ft' },
      { item: 40, film: 'TC20A-23', size: 342, length: 3000, core: 6, dia: 308, qty: 386.54, customer: 'FACTORY VPP EXPORT', po_ref: 'PO 26-VPP-20FT', packing_mode: 'VPP', container_type: '20ft' },
      { item: 50, film: 'TC20A-23', size: 325, length: 3300, core: 3, dia: 323, qty: 606.08, customer: 'FACTORY VPP EXPORT', po_ref: 'PO 26-VPP-20FT', packing_mode: 'VPP', container_type: '20ft' },
      { item: 60, film: 'TC20A-23', size: 325, length: 3300, core: 3, dia: 323, qty: 404.05, customer: 'FACTORY VPP EXPORT', po_ref: 'PO 26-VPP-20FT', packing_mode: 'VPP', container_type: '20ft' },
    ],
    created_at: '2026-08-25T08:00:00.000Z',
    updated_at: '2026-08-25T08:00:00.000Z',
    notes: 'Reverse-Engineered Factory 20ft VPP Stuffing Plan: 16 Pallets (1098 Reels, 9,473.71 kg) in 1x20ft with 2-row 1+1 vertical layout (ROW1: 5,150mm, ROW2: 5,220mm).'
  },
  {
    id: 'plan_propack_factory_000',
    plan_name: 'PROPACK SAL - Factory Stuffing Master Plan (40ft HC)',
    customer: 'PROPACK SAL',
    sales_order: 'SO-4500806',
    po_ref: 'PO 26-806',
    container_type: '40ft_HC',
    packing_mode: 'HPP',
    total_containers: 1,
    total_weight: 23365,
    total_pallets: 23,
    items_count: 9,
    orders: [
      { item: 10, film: 'TH21-20', size: 675, length: 9750, core: 3, dia: 518, qty: 2000, customer: 'PROPACK SAL', po_ref: 'PO 26-806', packing_mode: 'HPP', custom_reels_per_pallet: 8, container_type: '40ft_HC' },
      { item: 20, film: 'MZ10S-20', size: 675, length: 9350, core: 3, dia: 508, qty: 2000, customer: 'PROPACK SAL', po_ref: 'PO 26-806', packing_mode: 'HPP', custom_reels_per_pallet: 8, container_type: '40ft_HC' },
      { item: 30, film: 'TH21-20', size: 855, length: 9750, core: 3, dia: 518, qty: 1000, customer: 'PROPACK SAL', po_ref: 'PO 26-806', packing_mode: 'HPP', custom_reels_per_pallet: 8, container_type: '40ft_HC' },
      { item: 40, film: 'MZ10S-20', size: 855, length: 9350, core: 3, dia: 508, qty: 1000, customer: 'PROPACK SAL', po_ref: 'PO 26-806', packing_mode: 'HPP', custom_reels_per_pallet: 8, container_type: '40ft_HC' },
      { item: 50, film: 'TH21-20', size: 895, length: 9750, core: 3, dia: 518, qty: 5094, customer: 'PROPACK SAL', po_ref: 'PO 26-806', packing_mode: 'HPP', custom_reels_per_pallet: 8, container_type: '40ft_HC' },
      { item: 60, film: 'MZ10S-20', size: 895, length: 9350, core: 3, dia: 508, qty: 5173, customer: 'PROPACK SAL', po_ref: 'PO 26-806', packing_mode: 'HPP', custom_reels_per_pallet: 8, container_type: '40ft_HC' },
      { item: 70, film: 'TH21-20', size: 895, length: 9750, core: 3, dia: 518, qty: 1918, customer: 'PROPACK SAL', po_ref: 'PO 26-806', packing_mode: 'HPP', custom_reels_per_pallet: 6, container_type: '40ft_HC' },
      { item: 80, film: 'MZ10S-20', size: 895, length: 9350, core: 3, dia: 508, qty: 2127, customer: 'PROPACK SAL', po_ref: 'PO 26-806', packing_mode: 'HPP', custom_reels_per_pallet: 6, container_type: '40ft_HC' },
      { item: 90, film: 'OLC217-38', size: 653, length: 5100, core: 3, dia: 517, qty: 4000, customer: 'PROPACK SAL', po_ref: 'PO 26-806', packing_mode: 'HPP', custom_reels_per_pallet: 8, container_type: '40ft_HC' },
    ],
    created_at: '2026-08-20T08:00:00.000Z',
    updated_at: '2026-08-20T08:00:00.000Z',
    notes: 'Reverse-Engineered Factory Stuffing Plan: 23 Pallets (176 Reels, 23,365 kg) in 1x40ft HC with 2-row layout (ROW1: 10,201mm, ROW2: 0mm, ROW3: 10,974mm).'
  },
  {
    id: 'plan_daru_001',
    plan_name: 'DARU TRADING - Export Order 2x40ft HC',
    customer: 'DARU TRADING',
    sales_order: 'SO-4500891',
    po_ref: 'PO-DARU-2026-08',
    container_type: '40ft_HC',
    packing_mode: 'HPP',
    total_containers: 2,
    total_weight: 47250,
    total_pallets: 52,
    items_count: 8,
    orders: [
      { item: 10, film: 'TH21-25', size: 950, length: 15500, core: 6, dia: 0, qty: 6500, customer: 'DARU TRADING', po_ref: 'SO-4500891' },
      { item: 20, film: 'TH21-25', size: 1050, length: 15500, core: 6, dia: 0, qty: 9500, customer: 'DARU TRADING', po_ref: 'SO-4500891' },
      { item: 30, film: 'TH21-25', size: 1080, length: 15500, core: 6, dia: 0, qty: 6500, customer: 'DARU TRADING', po_ref: 'SO-4500891' },
      { item: 40, film: 'TH21-25', size: 1120, length: 15500, core: 6, dia: 0, qty: 5500, customer: 'DARU TRADING', po_ref: 'SO-4500891' },
      { item: 50, film: 'TH21-30', size: 1050, length: 12900, core: 6, dia: 0, qty: 5000, customer: 'DARU TRADING', po_ref: 'SO-4500891' },
      { item: 60, film: 'TH21-30', size: 1080, length: 12900, core: 6, dia: 0, qty: 10000, customer: 'DARU TRADING', po_ref: 'SO-4500891' },
      { item: 70, film: 'TH21-30', size: 1100, length: 12900, core: 6, dia: 0, qty: 5000, customer: 'DARU TRADING', po_ref: 'SO-4500891' },
      { item: 80, film: 'TH21-30', size: 1120, length: 12900, core: 6, dia: 0, qty: 2500, customer: 'DARU TRADING', po_ref: 'SO-4500891' },
    ],
    created_at: '2026-08-20T10:30:00.000Z',
    updated_at: '2026-08-20T10:30:00.000Z',
    notes: 'Standard 40ft HC HPP 3-row layout with 1070/1170mm pallet lengths.'
  },
  {
    id: 'plan_bat_002',
    plan_name: 'BAT Sudan - Cigarette Overwrap Shipment',
    customer: 'BAT Sudan (British American Tobacco)',
    sales_order: 'SO-4500912',
    po_ref: 'PO-BAT-SD-771',
    container_type: '20ft',
    packing_mode: 'VPP',
    total_containers: 2,
    total_weight: 11330.52,
    total_pallets: 18,
    items_count: 3,
    orders: [
      { item: 10, film: 'TC20-20', size: 120, length: 2400, core: 3, dia: 0, qty: 3200, customer: 'BAT Sudan', po_ref: 'SO-4500912', packing_mode: 'VPP', container_type: '20ft' },
      { item: 20, film: 'TC20-20', size: 245, length: 2400, core: 3, dia: 0, qty: 4500, customer: 'BAT Sudan', po_ref: 'SO-4500912', packing_mode: 'VPP', container_type: '20ft' },
      { item: 30, film: 'TC20A-23', size: 350, length: 2200, core: 3, dia: 0, qty: 3800, customer: 'BAT Sudan', po_ref: 'SO-4500912', packing_mode: 'VPP', container_type: '20ft' },
    ],
    created_at: '2026-08-21T14:15:00.000Z',
    updated_at: '2026-08-21T14:15:00.000Z',
    notes: 'BAT Sudan 20ft VPP Pinwheel Stuffing Plan: 18 Pallets across 2x20ft containers adhering to factory envelope limits (5750 x 2320 x 2280 mm). C1: 12 pallets (ROW1: 5,400mm, ROW2: 5,500mm), C2: 6 pallets (ROW1: 3,300mm, ROW2: 3,300mm).'
  },
  {
    id: 'plan_global_003',
    plan_name: 'Global Packaging Service - 20ft VPP Order',
    customer: 'Global Packaging Service',
    sales_order: 'SO-450945',
    po_ref: 'SO-450945',
    container_type: '20ft',
    packing_mode: 'VPP',
    total_containers: 1,
    total_weight: 12072.42,
    total_pallets: 10,
    items_count: 13,
    orders: [
      { item: 10, film: 'CTH21L-40', size: 840, length: 3200, core: 3, dia: 0, qty: 587, customer: 'Global Packaging Service', po_ref: 'SO-450945' },
      { item: 20, film: 'CTH21L-40', size: 920, length: 3200, core: 3, dia: 0, qty: 643, customer: 'Global Packaging Service', po_ref: 'SO-450945' },
      { item: 30, film: 'CTH21L-40', size: 960, length: 3200, core: 3, dia: 0, qty: 671, customer: 'Global Packaging Service', po_ref: 'SO-450945' },
      { item: 40, film: 'CMZ10S-25', size: 645, length: 5125, core: 3, dia: 0, qty: 902, customer: 'Global Packaging Service', po_ref: 'SO-450945' },
      { item: 50, film: 'CMZ10S-25', size: 720, length: 5125, core: 3, dia: 0, qty: 756, customer: 'Global Packaging Service', po_ref: 'SO-450945' },
      { item: 60, film: 'CMZ10S-25', size: 750, length: 5125, core: 3, dia: 0, qty: 1049, customer: 'Global Packaging Service', po_ref: 'SO-450945' },
      { item: 70, film: 'CMZ10S-25', size: 760, length: 5125, core: 3, dia: 0, qty: 1063, customer: 'Global Packaging Service', po_ref: 'SO-450945' },
      { item: 80, film: 'CMZ10S-25', size: 780, length: 5125, core: 3, dia: 0, qty: 1091, customer: 'Global Packaging Service', po_ref: 'SO-450945' },
      { item: 90, film: 'CMZ10S-25', size: 900, length: 5125, core: 3, dia: 0, qty: 944, customer: 'Global Packaging Service', po_ref: 'SO-450945' },
      { item: 100, film: 'CMZ10S-25', size: 960, length: 5125, core: 3, dia: 0, qty: 1007, customer: 'Global Packaging Service', po_ref: 'SO-450945' },
      { item: 110, film: 'CMZ10S-25', size: 1000, length: 5125, core: 3, dia: 0, qty: 1049, customer: 'Global Packaging Service', po_ref: 'SO-450945' },
      { item: 120, film: 'CMZ10S-25', size: 1050, length: 5125, core: 3, dia: 0, qty: 1469, customer: 'Global Packaging Service', po_ref: 'SO-450945' },
      { item: 130, film: 'CMZ10S-25', size: 1200, length: 5125, core: 3, dia: 0, qty: 839, customer: 'Global Packaging Service', po_ref: 'SO-450945' },
    ],
    created_at: '2026-08-22T09:00:00.000Z',
    updated_at: '2026-08-22T09:00:00.000Z',
    notes: 'Global Packaging Service 20ft VPP skid loading: 10 pallets in 1x20ft container (ROW1: 5,200mm, ROW2: 5,400mm) adhering to factory envelope (5750 x 2320 x 2280 mm).'
  },
  {
    id: 'plan_petpak_004',
    plan_name: 'PETPAK GLOBAL - 3x40ft HC BOPET Export',
    customer: 'PETPAK GLOBAL EXPORTS',
    sales_order: 'SO-4501005',
    po_ref: 'PO-PETPAK-552',
    container_type: '40ft_HC',
    packing_mode: 'HPP',
    total_containers: 3,
    total_weight: 78500,
    total_pallets: 80,
    items_count: 6,
    orders: [
      { item: 10, film: 'PTN01-12', size: 1000, length: 18000, core: 6, dia: 0, qty: 12000, customer: 'PETPAK GLOBAL', po_ref: 'SO-4501005' },
      { item: 20, film: 'PTN01-12', size: 1150, length: 18000, core: 6, dia: 0, qty: 14000, customer: 'PETPAK GLOBAL', po_ref: 'SO-4501005' },
      { item: 30, film: 'PVTN01-12', size: 1050, length: 18000, core: 6, dia: 0, qty: 10000, customer: 'PETPAK GLOBAL', po_ref: 'SO-4501005' },
      { item: 40, film: 'PVTN01-12', size: 1200, length: 18000, core: 6, dia: 0, qty: 15000, customer: 'PETPAK GLOBAL', po_ref: 'SO-4501005' },
      { item: 50, film: 'PMZV00-12', size: 980, length: 18000, core: 6, dia: 0, qty: 8500, customer: 'PETPAK GLOBAL', po_ref: 'SO-4501005' },
      { item: 60, film: 'PMZV00-12', size: 1080, length: 18000, core: 6, dia: 0, qty: 9500, customer: 'PETPAK GLOBAL', po_ref: 'SO-4501005' },
    ],
    created_at: '2026-08-23T11:45:00.000Z',
    updated_at: '2026-08-23T11:45:00.000Z',
    notes: 'Large 3-container BOPET multi-item order.'
  },
  {
    id: 'plan_now_plastics_001',
    plan_name: 'NOW PLASTIC HPP + VPP PLAN',
    customer: 'NOW PLASTICS UK',
    sales_order: 'SO-4500980',
    po_ref: 'PO 8504',
    container_type: '40ft_HC',
    packing_mode: 'HPP',
    total_containers: 1,
    total_weight: 21785.46,
    total_pallets: 25,
    items_count: 3,
    orders: [
      { item: 10, film: 'TH21-25', size: 1290, length: 15500, core: 6, dia: 731, qty: 10000, customer: 'NOW PLASTICS UK', po_ref: 'PO 8504', packing_mode: 'HPP', container_type: '40ft_HC' },
      { item: 20, film: 'TH21-30', size: 1200, length: 12900, core: 6, dia: 730, qty: 10000, customer: 'NOW PLASTICS UK', po_ref: 'PO 8504', packing_mode: 'HPP', container_type: '40ft_HC' },
      { item: 30, film: 'STN02-12', size: 520, length: 8000, core: 6, dia: 364, qty: 1600, customer: 'NOW PLASTICS UK', po_ref: 'PO 8504', packing_mode: 'VPP', container_type: '40ft_HC' },
    ],
    created_at: '2026-08-26T10:00:00.000Z',
    updated_at: '2026-08-26T10:00:00.000Z',
    notes: 'NOW PLASTICS 40ft HC Sectional Plan: 23 HPP 765 Ply pallets (Items 10 & 20) across Rows 1, 2, 3 + 2 VPP pallets (Item 30) in Rows 1 & 3.'
  },
  {
    id: 'plan_nurscon_850mm_ply',
    plan_name: 'NURSCON 850mm ply',
    customer: 'NURSCON',
    sales_order: 'SO-4500998',
    po_ref: 'PO 26-NURSCON-850',
    container_type: '40ft_HC',
    packing_mode: 'HPP',
    total_containers: 2,
    total_weight: 40025.04,
    total_pallets: 48,
    items_count: 3,
    orders: [
      { item: 10, film: 'MT21D-20', size: 900, length: 24200, core: 6, dia: 817, qty: 8781.70, customer: 'NURSCON', po_ref: 'PO 26-NURSCON-850', packing_mode: 'HPP', container_type: '40ft_HC' },
      { item: 20, film: 'MT21D-20', size: 962, length: 24200, core: 6, dia: 817, qty: 9386.67, customer: 'NURSCON', po_ref: 'PO 26-NURSCON-850', packing_mode: 'HPP', container_type: '40ft_HC' },
      { item: 30, film: 'MT21D-20', size: 1120, length: 24200, core: 6, dia: 817, qty: 21856.67, customer: 'NURSCON', po_ref: 'PO 26-NURSCON-850', packing_mode: 'HPP', container_type: '40ft_HC' },
    ],
    created_at: '2026-08-27T08:00:00.000Z',
    updated_at: '2026-08-27T08:00:00.000Z',
    notes: 'NURSCON 850mm ply Factory Pinwheel Stuffing Plan: 2x40ft HC (48 Pallets total, 24 per container). ROW1 (rotated 90°): 11,530mm (11 pallets), ROW2: 0mm (center corridor), ROW3 (standard 850mm): 11,050mm (13 pallets).'
  }
];

export function getSavedPlans(): SavedStuffingPlan[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_SAVED_PLANS));
      return SEED_SAVED_PLANS;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Ensure seed plans exist in stored plans
      const missingSeeds = SEED_SAVED_PLANS.filter(s => !parsed.some((p: SavedStuffingPlan) => p.id === s.id || p.plan_name === s.plan_name));
      if (missingSeeds.length > 0) {
        const merged = [...parsed, ...missingSeeds];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        return merged;
      }
      return parsed;
    }
    return SEED_SAVED_PLANS;
  } catch (err) {
    console.error('Failed to read saved plans from storage', err);
    return SEED_SAVED_PLANS;
  }
}

export function savePlan(plan: Omit<SavedStuffingPlan, 'id' | 'created_at' | 'updated_at'> & { id?: string }): SavedStuffingPlan {
  const currentPlans = getSavedPlans();
  const now = new Date().toISOString();
  
  if (plan.id) {
    // Update existing
    const index = currentPlans.findIndex(p => p.id === plan.id);
    if (index >= 0) {
      const updated: SavedStuffingPlan = {
        ...currentPlans[index],
        ...plan,
        id: plan.id,
        updated_at: now,
      };
      currentPlans[index] = updated;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentPlans));
      return updated;
    }
  }

  // Create new
  const newId = `plan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const newPlan: SavedStuffingPlan = {
    ...plan,
    id: newId,
    created_at: now,
    updated_at: now,
  };

  const updatedPlans = [newPlan, ...currentPlans];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedPlans));
  return newPlan;
}

export function deleteSavedPlan(id: string): boolean {
  const currentPlans = getSavedPlans();
  const filtered = currentPlans.filter(p => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  return true;
}

export function searchSavedPlans(
  query: string,
  filterContainer?: string,
  filterMode?: string
): SavedStuffingPlan[] {
  const all = getSavedPlans();
  if (!query && !filterContainer && !filterMode) return all;

  const q = (query || '').toLowerCase().trim();

  return all.filter(plan => {
    // Text query match: customer, sales_order, po_ref, plan_name, film codes in orders
    const matchesQuery = !q || (
      plan.customer.toLowerCase().includes(q) ||
      plan.sales_order.toLowerCase().includes(q) ||
      (plan.po_ref && plan.po_ref.toLowerCase().includes(q)) ||
      plan.plan_name.toLowerCase().includes(q) ||
      plan.orders.some(o => o.film.toLowerCase().includes(q))
    );

    // Container type filter
    const matchesContainer = !filterContainer || filterContainer === 'ALL' || plan.container_type === filterContainer;

    // Packing mode filter
    const matchesMode = !filterMode || filterMode === 'ALL' || plan.packing_mode === filterMode;

    return matchesQuery && matchesContainer && matchesMode;
  });
}
