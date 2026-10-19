/**
 * SAP VA05 Orders File Parser & Validator
 * Supports factory Planning Sheet (.xlsm/.xlsx) + SAP VA05 + .csv\n * Canonical headers: Sales Order #, Item #, Film Code, Width (mm), Length (m), Core ID, TS / MTS, Bal QtY, Order Qty
 * Strict Implementation of SRS Sections 11, 12, 13, 14
 */

import * as XLSX from 'xlsx';
import { VA05Order, ImportBatch } from '../types';
import { lookupFilmSpecs } from './stuffing/filmDensities';

export interface ParseResult {
  batch: ImportBatch;
  orders: VA05Order[];
  errors: string[];
  warnings: string[];
}

/**
 * Robust column getter supporting exact and normalized (case/punctuation-insensitive) column aliases
 */
export function getColumnValue(row: Record<string, any>, aliases: string[]): any {
  if (!row || typeof row !== 'object') return '';

  // 1. Direct exact key match
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null) {
      const val = String(row[alias]).trim();
      if (val !== '') return row[alias];
    }
  }

  // 2. Case-insensitive and punctuation/whitespace-insensitive match
  const rowKeys = Object.keys(row);
  for (const alias of aliases) {
    const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
    const matchedKey = rowKeys.find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanAlias);
    if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null) {
      const val = String(row[matchedKey]).trim();
      if (val !== '') return row[matchedKey];
    }
  }

  return '';
}

/**
 * Extracts numeric gauge/thickness for physical weight calculations
 * WITHOUT modifying or mutating the original source film/material code string.
 */
export function extractGaugeFromCodeOrDesc(
  rawCode: string,
  rawDesc: string = '',
  rowThickness?: number
): number {
  if (rowThickness && rowThickness > 0 && !isNaN(rowThickness)) {
    return rowThickness;
  }

  const combined = `${rawCode} ${rawDesc}`.trim();

  // Match gauge after separator (e.g. MZ10S-18 -> 18, TH21-20 -> 20, TNIT-23 -> 23, MZ10MB-15 -> 15)
  const matchSuffixHyphen = rawCode.match(/[-_/](\d{2,3})$/);
  if (matchSuffixHyphen) {
    return parseInt(matchSuffixHyphen[1], 10);
  }

  // Match trailing digits (e.g. MZ(111)18 -> 18, TNO20 -> 20, MZ18 -> 18, MATTWL15 -> 15, THOW25 -> 25)
  const matchTrailingDigits = rawCode.match(/(\d{2})$/);
  if (matchTrailingDigits) {
    return parseInt(matchTrailingDigits[1], 10);
  }

  // Match explicit gauge in description (e.g. "18 MIC", "18 MICRON", "18U", "18µ")
  const matchMicron = combined.match(/(\d{2,3})\s*(?:MIC|MICRON|U|UM|µ|MU)\b/i);
  if (matchMicron) {
    return parseInt(matchMicron[1], 10);
  }

  return 20; // Standard fallback gauge
}

/**
 * Normalized Film Grade resolver.
 * CRITICAL RULE: Preserves the source Material/Film code EXACTLY character-for-character
 * (letters, numbers, hyphens, parentheses, spaces, suffixes) without truncation or synthesis.
 */
export function extractNormalizedFilmGrade(
  materialRaw: string,
  materialDesc: string = '',
  rowThickness?: number
): { film: string; thickness: number; density: number; description: string } {
  const film = (materialRaw || '').trim() || (materialDesc || '').trim() || 'TNO20';
  const specs = lookupFilmSpecs(film);
  const thickness = specs?.thickness || extractGaugeFromCodeOrDesc(film, materialDesc, rowThickness);
  // Density ONLY from Film Specs Master DB (or explicit row later). Never invent 0.91.
  const density = specs?.density && specs.density > 0 ? specs.density : 0;
  const description = (materialDesc || '').trim() || `${film} BOPP Film ${thickness}µ`;

  return {
    film,
    thickness,
    density,
    description,
  };
}

export async function parseVA05File(
  file: File,
  uploadedBy: string = 'Planner'
): Promise<ParseResult> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  return parseVA05RawRows(rawRows, file.name, uploadedBy);
}

/**
 * Helper to format SAP date fields (handles Excel numeric serial dates or string dates)
 */
export function formatSAPDate(val: any): string {
  if (val === undefined || val === null || val === '') return '';
  if (typeof val === 'number') {
    // Excel serial date (days since 1899-12-30)
    if (val > 20000 && val < 60000) {
      const date = new Date(Math.round((val - 25569) * 86400 * 1000));
      return date.toISOString().split('T')[0];
    }
    return String(val);
  }
  const str = String(val).trim();
  const num = Number(str);
  if (!isNaN(num) && num > 20000 && num < 60000) {
    const date = new Date(Math.round((num - 25569) * 86400 * 1000));
    return date.toISOString().split('T')[0];
  }
  return str;
}

export function parseVA05RawRows(
  rawRows: any[],
  filename: string = 'VA05_Import.xlsx',
  uploadedBy: string = 'Planner'
): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const validOrders: VA05Order[] = [];
  const duplicateKeys = new Set<string>();

  const batchId = `batch-${Date.now()}`;
  const dateStr = new Date().toISOString().slice(0, 10);
  const batchNumber = `VA05-${dateStr}-${Math.floor(100 + Math.random() * 900)}`;

  let duplicateCount = 0;
  let zeroBalanceCount = 0;

  rawRows.forEach((row, idx) => {
    const rowNum = idx + 2;

    // Column resolution — FACTORY PLANNING SHEET headers are PRIMARY (canonical upload format).
    // Legacy SAP VA05 / SHEET.xlsx aliases remain as fallbacks.
    // Factory headers: Sales Order # | Item # | Film Code | Width (mm) | Length (m) |
    //   Core ID | TS / MTS | Bal QtY | Order Qty | Customer | Created On | Delivery Date | ...
    const so = String(
      getColumnValue(row, [
        // Factory planning sheet
        'Sales Order #', 'Sales Order#', 'Sales Order',
        // Legacy VA05 / exports
        'Sales Document', 'SO#', 'SO', 'SO no', 'SO No', 'SO Number', 'SOno',
        'Sales_Doc', 'Sales Doc', 'SD Document', 'Document', 'Sales Doc.', 'ClientCode'
      ])
    ).trim();

    const rawItem = getColumnValue(row, [
      // Factory
      'Item    #', 'Item #', 'Item#',
      // Legacy
      'Sales Document Item', 'Sales Item', 'Item Number', 'Item_Number', 'Item', 'Line', 'Pos', 'Sales'
    ]);
    const item = parseInt(String(rawItem || '10'), 10);

    const customer = String(
      getColumnValue(row, [
        'Customer', 'Ship to Party', 'Sold to Party', 'Customer Name',
        'Ship-to party', 'Sold-to party', 'Name', 'Party Name'
      ]) || 'Unknown Customer'
    ).trim();

    // Film Code — factory primary; preserve EXACT characters from source
    const rawMaterial = String(
      getColumnValue(row, [
        'Film Code', 'Film', 'Film Grade',
        'Material', 'Material Code', 'Material Number', 'Material#', 'Material_Number',
        'Material entered', 'Material Entered', 'Grade', 'Item Code'
      ])
    ).trim();

    const materialDesc = String(
      getColumnValue(row, [
        'Codes For Summary', 'Material Description', 'Description',
        'Material Desc', 'Material Text', 'Item Description', 'Short Text'
      ])
    ).trim();

    const parsedThickness = parseFloat(
      String(getColumnValue(row, ['Thickness', 'Thickness (micron)', 'Micron', 'Gauge', 'THK', 'Thickness(um)', 'Thickness (um)', 'Thickness(µm)']))
    );

    const filmCode = rawMaterial || materialDesc || 'TNO20';
    const thickness = extractGaugeFromCodeOrDesc(filmCode, materialDesc, isNaN(parsedThickness) ? undefined : parsedThickness);

    const parsedDensity = parseFloat(String(getColumnValue(row, ['Density', 'Specific Gravity', 'Film Density']) || ''));
    const specsLookup = lookupFilmSpecs(filmCode);
    // Priority: sheet Density column → Film Specs Master DB → 0 (missing = must add in Film Specs)
    const density = (!isNaN(parsedDensity) && parsedDensity > 0)
      ? parsedDensity
      : (specsLookup?.density && specsLookup.density > 0 ? specsLookup.density : 0);

    const width = parseFloat(String(getColumnValue(row, [
      // Factory (may include newline in header: "Width\n(mm)")
      'Width  (mm)', 'Width (mm)', 'Width\n(mm)', 'Width(mm)', 'Width mm', 'Width',
      'Size', 'Slit Width'
    ]) || '0'));
    const length = parseFloat(String(getColumnValue(row, [
      'Length  (m)', 'Length (m)', 'Length(m)', 'Length m', 'Length',
      'Reel Length', 'Standard Length'
    ]) || '19500'));
    const coreVal = parseInt(String(getColumnValue(row, [
      'Core ID', 'CoreId', 'Core', 'Core (inch)', 'Core Size', 'Core Dia'
    ]) || '6'), 10);
    const core = coreVal === 3 ? 3 : 6;

    const treatmentRaw = String(getColumnValue(row, [
      'TS / MTS', 'TS/MTS', 'TS', 'MTS', 'Treatment Side', 'Treatment', 'Corona Treatment', 'Corona'
    ]) || 'OS').toUpperCase();
    const treatmentSide = (treatmentRaw.includes('IN') || treatmentRaw.includes('IS') ? 'IS' : 'OS') as 'OS' | 'IS';

    const balanceQty = parseFloat(String(getColumnValue(row, [
      // Factory
      'Bal QtY', 'Bal Qty', 'Bal. Qty', 'BalQty',
      // Legacy
      'Balance Qty', 'Balance Quantity', 'Remaining Qty',
      'Open Qty', 'Open Quantity', 'Balance (KG)', 'Balance KG', 'Order', 'Quantity'
    ]) || '0'));
    const orderedQty = parseFloat(String(getColumnValue(row, [
      'Order Qty', 'OrderQty', 'Ordered Qty', 'Order Quantity',
      'Target Qty', 'Target Quantity', 'Order', 'Balance Qty', 'Bal Qty', 'Bal QtY'
    ]) || balanceQty || '0'));

    if (!so) {
      errors.push(`Row ${rowNum}: Missing Sales Document / SO#.`);
      return;
    }
    if (width <= 0 || isNaN(width)) {
      errors.push(`Row ${rowNum} (SO: ${so}): Invalid or missing slit width (${width} mm).`);
      return;
    }
    if (length <= 0 || isNaN(length)) {
      errors.push(`Row ${rowNum} (SO: ${so}): Invalid or missing Length (${length}).`);
      return;
    }

    if (balanceQty <= 0) {
      zeroBalanceCount++;
      return;
    }

    const uniqueKey = `${so}-${item}-${width}-${length}`;
    if (duplicateKeys.has(uniqueKey)) {
      duplicateCount++;
      warnings.push(`Row ${rowNum}: Duplicate SO/Item ${so}-${item} detected and merged.`);
      return;
    }
    duplicateKeys.add(uniqueKey);

    const order: VA05Order = {
      id: `ord-${batchId}-${idx + 1}`,
      import_batch_id: batchId,
      sales_order: so,
      item_number: isNaN(item) ? 10 : item,
      customer,
      material: filmCode,
      film: filmCode,
      material_description: materialDesc || `${filmCode} BOPP Film ${thickness}µ`,
      width_mm: width,
      length_m: length,
      thickness_micron: thickness,
      density,
      core,
      treatment_side: treatmentSide,
      ordered_qty: orderedQty,
      balance_qty: balanceQty,
      remaining_qty: balanceQty,
      produced_qty: 0,
      unit: String(getColumnValue(row, ['Unit', 'Sales Unit', 'UoM', 'Base Unit', 'Unit of Measure']) || 'KG'),
      plant: String(getColumnValue(row, ['Plant', 'Plnt', 'Manufacturing Plant']) || '3100'),
      priority: false,
      status: 'PENDING',
      delivery_date: formatSAPDate(getColumnValue(row, [
        'Delivery Date', 'Deliv. Date', 'Req. Deliv. Date', 'Req/Com Date', 'First Deliv. Date', 'Schedule Date'
      ])),
      customer_reference: String(getColumnValue(row, [
        'PO #', 'PO#', 'PO Number', 'Purchase Order',
        'Customer Reference (Header)', 'Cust Ref', 'Customer Ref', 'Cust. Ref.', 'Reference'
      ]) || ''),
      created_on: formatSAPDate(getColumnValue(row, ['Created On', 'Doc. Date', 'Document Date', 'Creation Date'])),
      sales_person: String(getColumnValue(row, [
        'Sales Person', 'Sales person Name', 'Salesperson', 'Representative'
      ]) || ''),
      ship_to_city: String(getColumnValue(row, [
        'Destination', 'Ship to Party City', 'City', 'Ship-to City', 'Destination City', 'Party City'
      ]) || ''),
      payment_term: String(getColumnValue(row, [
        'Payment terms', 'Payment Terms', 'Paymentterms', 'Payment Term Desc.', 'Payment Term', 'Terms'
      ]) || ''),
      approval_status: String(getColumnValue(row, ['Approval Status', 'Status', 'Appr. Status']) || ''),
      delivery_block: String(getColumnValue(row, ['Delivery Block Description', 'Delivery Block', 'Block']) || ''),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    validOrders.push(order);
  });

  const filmsDetected = Array.from(new Set(validOrders.map(o => o.film)));
  const totalRemainingKg = validOrders.reduce((sum, o) => sum + o.remaining_qty, 0);

  const batch: ImportBatch = {
    id: batchId,
    batch_number: batchNumber,
    filename,
    total_rows: rawRows.length,
    valid_rows: validOrders.length,
    invalid_rows: errors.length,
    duplicate_rows: duplicateCount,
    zero_balance_rows: zeroBalanceCount,
    films_detected: filmsDetected,
    total_orders: validOrders.length,
    total_remaining_kg: Math.round(totalRemainingKg * 100) / 100,
    uploaded_by: uploadedBy,
    uploaded_at: new Date().toISOString(),
    errors: errors.slice(0, 10),
  };

  return {
    batch,
    orders: validOrders,
    errors,
    warnings,
  };
}
