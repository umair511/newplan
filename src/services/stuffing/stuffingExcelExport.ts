/**
 * Excel File Generator for Container Stuffing Master & Summary Plan
 * Produces authentic formatted .xlsx workbook matching DARU TRADING Excel specifications
 */

import * as XLSX from 'xlsx';
import { FinalPlan } from '../../types/stuffing';
import { expandOrdersForStuffingMaster } from './stuffingCalculator';

export function exportStuffingPlanToExcel(plan: FinalPlan, filename: string = 'Container_Stuffing_Plan_DARU_TRADING.xlsx'): void {
  const wb = XLSX.utils.book_new();

  // ==========================================
  // SHEET 1: PHYSICAL PALLETS MANIFEST (PALLET-CENTRIC)
  // ==========================================
  const palletRows: any[][] = [];
  palletRows.push([`${plan.client_name || 'DARU TRADING'} - PHYSICAL PALLETS STUFFING MANIFEST`]);
  palletRows.push([`Generated On: ${new Date(plan.generated_at).toLocaleString()}`, '', `Total Containers: ${plan.containers.length}`]);
  palletRows.push([]);

  palletRows.push([
    'CONTAINER',
    'PALLET #',
    'ITEM / SR NO',
    'FILM',
    'SIZE (mm)',
    'LENGTH (m)',
    'CORE',
    'ROLL DIA (mm)',
    'PER REEL WT (kg)',
    'REELS IN PALLET',
    'SUBTOTAL WT (kg)',
    'TIER POSITION',
    'PALLET TOTAL REELS',
    'PALLET TOTAL WT (kg)',
    'PALLET DIMENSIONS',
    'CONTAINER POSITION',
    'PALLET TYPE'
  ]);

  plan.containers.forEach((container) => {
    const pallets = container.physical_pallets || [];
    pallets.forEach((p) => {
      const isMixed = p.is_mixed;
      const palletType = isMixed ? (p.mixed_type === 'mixed_film' ? 'Mixed Film' : 'Mixed Size') : 'Homogeneous';
      p.items.forEach((item, idx) => {
        palletRows.push([
          idx === 0 ? container.name : '',
          idx === 0 ? `Pallet #${p.pallet_number}` : '',
          item.item,
          item.film,
          item.size,
          item.length ?? '',
          item.core ? `${item.core}"` : '',
          item.dia ?? '',
          item.per_reel_wt ?? '',
          item.reels,
          item.weight,
          item.tier_position || item.tier_desc || (idx === 0 ? 'Tier 1 (Bottom)' : 'Tier 2 (Top)'),
          idx === 0 ? p.total_reels : '',
          idx === 0 ? p.total_weight : '',
          idx === 0 ? p.dims_str : '',
          idx === 0 ? (p.position_desc || `Row ${p.row_index} / Bay ${p.bay_index}`) : '',
          idx === 0 ? palletType : ''
        ]);
      });
    });

    // Subtotal row for container
    palletRows.push([
      `${container.name} TOTAL`,
      `${container.physical_pallets?.length || container.total_pallets} Pallets`,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      container.total_reels,
      container.total_weight,
      '',
      container.total_reels,
      container.total_weight,
      '',
      `${container.row_lengths.max_length} mm utilized`,
      ''
    ]);
    palletRows.push([]); // Gap
  });

  const wsPallets = XLSX.utils.aoa_to_sheet(palletRows);
  XLSX.utils.book_append_sheet(wb, wsPallets, 'Physical Pallets');

  // ==========================================
  // SHEET 2: STUFFING MASTER
  // ==========================================
  const stuffingMasterRows: any[][] = [];

  // Title / Client Header
  stuffingMasterRows.push([`${plan.client_name || 'DARU TRADING'} - CONTAINER STUFFING MASTER PLAN`]);
  stuffingMasterRows.push([`Generated On: ${new Date(plan.generated_at).toLocaleString()}`, '', `Total Containers: ${plan.containers.length}`]);
  stuffingMasterRows.push([]); // Empty row

  plan.containers.forEach((container) => {
    // Container Section Header
    stuffingMasterRows.push([
      container.name.toUpperCase(),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      `PALLET DETAILS FOR ${container.name.toUpperCase()}`
    ]);

    // Table Header Row 1
    stuffingMasterRows.push([
      'ITEM',
      'PLY/PLAIN PALLET',
      'Pallet Width',
      'Height',
      'ITEM',
      'Film',
      'Size (mm)',
      'Length (m)',
      'Core',
      'Per Reel Wt.',
      'Planned Reels',
      'Planned Weight (kg)',
      'Dia (mm)',
      "Pallet Dimensions '(L*W*H)'",
      'Reels/Pallet',
      'Total Pallet',
      'Pallets for Packing',
      'Packing Mode',
      'Excess/Less',
      'ROW1',
      'ROW2',
      'ROW3',
      'Size (mm)',
      'Total Pallet',
      'Pallet Width',
      'Loaded In Container'
    ]);

    // Data rows (Expand mixed pallet configurations into separate rows with corresponding dimensions)
    const expandedOrders = expandOrdersForStuffingMaster(container.orders);
    const maxDataRows = Math.max(expandedOrders.length, container.stuffing_grid.length, container.pallet_packing_details.length);

    for (let r = 0; r < maxDataRows; r++) {
      const order = expandedOrders[r];
      const grid = container.stuffing_grid[r];
      const pallet = container.pallet_packing_details[r];

      const rowData: any[] = [];

      if (order) {
        rowData.push(
          order.item,
          order.pallet_length,
          order.pallet_width,
          order.pallet_height,
          order.item,
          order.film,
          order.size,
          order.length,
          order.core,
          order.per_reel_wt,
          order.planned_reels,
          order.planned_weight,
          order.dia,
          order.pallet_dims_str,
          order.reels_per_pallet,
          order.total_pallets,
          order.total_pallets,
          order.packing_mode,
          order.excess_less
        );
      } else {
        // Pad empty order columns (19 columns)
        for (let k = 0; k < 19; k++) rowData.push('');
      }

      // Stuffing grid columns
      if (grid) {
        rowData.push(grid.row1 || '', grid.row2 || '', grid.row3 || '');
      } else {
        rowData.push('', '', '');
      }

      // Pallet details columns
      if (pallet) {
        rowData.push(pallet.size, pallet.total_pallet, pallet.pallet_width, pallet.loaded_in_container);
      } else {
        rowData.push('', '', '', '');
      }

      stuffingMasterRows.push(rowData);
    }

    // Totals row for this container
    stuffingMasterRows.push([
      'Total',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      container.total_reels,
      container.total_weight,
      '',
      '',
      '',
      container.total_pallets,
      container.total_pallets,
      '',
      '',
      container.row_lengths.row1,
      container.row_lengths.row2,
      container.row_lengths.row3 ?? '',
      'TOTAL',
      container.total_pallets,
      '',
      container.loaded_pallets
    ]);

    stuffingMasterRows.push([]); // Gap between containers
  });

  const wsStuffing = XLSX.utils.aoa_to_sheet(stuffingMasterRows);
  XLSX.utils.book_append_sheet(wb, wsStuffing, 'Stuffing Master');

  // ==========================================
  // SHEET 2: SUMMARY SHEET
  // ==========================================
  const summaryRows: any[][] = [];

  summaryRows.push([`SUMMARY - ${plan.client_name || 'DARU TRADING'}`]);
  summaryRows.push([]);

  // Build header row with dynamic container columns
  const summaryHeader = [
    'ITEM',
    'Formula',
    'Film',
    'Size (mm)',
    'Length (m)',
    'CORE',
    'DIA',
    'Order Qty (kg)',
    'Per Reel Weight (kg)',
    'Reels+10%',
  ];

  plan.containers.forEach((c) => {
    summaryHeader.push(c.name);
  });

  summaryHeader.push('Excess/Less (kg)', 'Total Planned (kg)');
  summaryRows.push(summaryHeader);

  // Data rows
  plan.summary.forEach((item) => {
    const row: any[] = [
      item.item,
      item.formula,
      item.film,
      item.size,
      item.length,
      item.core,
      item.dia,
      item.order_qty,
      item.per_reel_wt,
      item.required_reels_buffer,
    ];

    // Distribute weights across containers
    plan.containers.forEach((c) => {
      const matchInContainer = c.orders.find((o) => o.item === item.item);
      if (matchInContainer) {
        row.push(matchInContainer.planned_weight);
      } else {
        row.push('-');
      }
    });

    row.push(item.excess_less, item.planned_weight);
    summaryRows.push(row);
  });

  // Grand Total Row
  const totalRow: any[] = ['TOTAL', '', '', '', '', '', '', plan.totals.total_order_qty, '', ''];
  plan.containers.forEach((c) => {
    totalRow.push(c.total_weight);
  });
  totalRow.push(plan.totals.excess_less_total, plan.totals.total_planned_weight);
  summaryRows.push(totalRow);

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // ==========================================
  // SHEET 3: ORDER 1ST (RAW BACKLOG)
  // ==========================================
  const order1stRows: any[][] = [];
  order1stRows.push([plan.client_name || 'DARU TRADING']);
  order1stRows.push(['Film', 'Size', 'Length', 'CORE', 'DIA', 'Order Qty', 'Item #']);

  plan.summary.forEach((item) => {
    order1stRows.push([
      item.film,
      item.size,
      item.length,
      item.core,
      item.dia,
      item.order_qty,
      item.item,
    ]);
  });

  const wsOrder1st = XLSX.utils.aoa_to_sheet(order1stRows);
  XLSX.utils.book_append_sheet(wb, wsOrder1st, 'Order 1st');

  // Write and trigger download in browser
  XLSX.writeFile(wb, filename);
}
