/**
 * Factory planning sheet export with FULL template styling
 * (colors, borders, merges, fonts) via ExcelJS + embedded sample xlsx.
 *
 * exceljs is loaded dynamically so the app still boots if the package
 * is missing; download then shows an install hint.
 */
import { FACTORY_PLAN_TEMPLATE_XLSX_B64 } from './factoryPlanTemplateB64';

export interface FactoryLineRow {
  sales_order: string | number;
  item_number: string | number;
  customer: string;
  length_m: number;
  core: string | number;
  treatment_side: string;
  width_mm: number;
  reels: number;
  weight_kg: number;
  size_mm: number;
  ups: number;
  deckle_mm: number;
  wt_pack_kg: number;
  tot_wt_kg: number;
  is_future?: boolean;
}

export interface FactorySheetMeta {
  plan_title: string;
  machine_code: string;
  machine_name: string;
  film: string;
  thickness_micron: number;
  density: number;
  length_m: number;
  reps: number;
  deckle_mm: number;
  utilized_web_mm?: number;
  allowed_trim_mm: number;
  time_per_pack_min?: number;
  rejection_material?: string;
  doc_ref?: string;
  rev_no?: number;
  issue_date?: string;
  lines: FactoryLineRow[];
  /** Operator shift instructions e.g. AFTER PACK 264: CHANGE SIZE ... */
  change_instructions?: string;
}

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin =
    typeof atob === 'function'
      ? atob(b64)
      : Buffer.from(b64, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function loadExcelJS(): Promise<any> {
  try {
    // Prefer browser build when available
    const mod: any = await import('exceljs');
    return mod?.default ?? mod;
  } catch (e: any) {
    throw new Error(
      'exceljs package is not installed. Run: pnpm add exceljs   (or npm install exceljs) then restart the dev server.\n' +
        (e?.message || String(e))
    );
  }
}

function setValue(cell: any, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') {
    cell.value = null;
    return;
  }
  if (typeof value === 'string' && value.startsWith('=')) {
    cell.value = { formula: value.slice(1) };
    return;
  }
  cell.value = value;
}


/** Match sub-header light blue (FILM/LENGTH rows) — no purple title bar */
const FACTORY_HEADER_LIGHT_BLUE = 'FFBDD7EE';

function applyTitleBannerLightBlue(ws: any): void {
  // Template title strip is row 1 (plan name + machine labels)
  for (let col = 1; col <= 18; col++) {
    const cell = ws.getCell(1, col);
    try {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: FACTORY_HEADER_LIGHT_BLUE },
      };
      // Keep text readable on light blue
      const prev = cell.font || {};
      cell.font = {
        ...prev,
        bold: prev.bold !== false,
        color: { argb: 'FF1F4E79' },
      };
    } catch {
      /* ignore */
    }
  }
}

export function fillFactorySheetExcelJs(ws: any, meta: FactorySheetMeta): void {
  setValue(ws.getCell('A1'), meta.plan_title);
  setValue(ws.getCell('H1'), meta.machine_code);
  setValue(ws.getCell('I1'), meta.machine_name);
  setValue(ws.getCell('O1'), '=C6-L31');
  setValue(ws.getCell('R1'), Number(meta.thickness_micron) || 0);

  setValue(ws.getCell('B2'), meta.film || '');
  setValue(ws.getCell('K2'), '=C6*R1*R2*B3*B5/1000000');
  setValue(ws.getCell('O2'), '=K2-I31');
  setValue(ws.getCell('R2'), Number(meta.density) || 0);

  setValue(ws.getCell('B3'), Number(meta.length_m) || 0);
  setValue(ws.getCell('K3'), '=1.174*(R1*B3)^0.5');
  setValue(ws.getCell('O3'), '=IF(K2=0,0,O2/K2)');
  setValue(ws.getCell('R3'), Number(meta.allowed_trim_mm) || 25);

  if (meta.time_per_pack_min != null) {
    setValue(ws.getCell('K4'), Number(meta.time_per_pack_min));
  }
  setValue(ws.getCell('O4'), '=L31');
  const upsTotal = (meta.lines || [])
    .filter((l) => !l.is_future)
    .reduce((s, l) => s + (Number(l.ups) || 0), 0);
  setValue(ws.getCell('R4'), upsTotal);

  setValue(ws.getCell('B5'), Number(meta.reps) || 1);
  setValue(ws.getCell('K5'), '=B5*B3');
  setValue(ws.getCell('O5'), '=C6-R3-L31');
  if (meta.rejection_material) setValue(ws.getCell('R5'), meta.rejection_material);

  const utilized =
    meta.utilized_web_mm != null && meta.utilized_web_mm > 0
      ? meta.utilized_web_mm
      : (meta.lines || [])
          .filter((l) => !l.is_future)
          .reduce((s, l) => s + (Number(l.deckle_mm) || 0), 0);
  if (utilized) setValue(ws.getCell('A6'), utilized);
  setValue(ws.getCell('C6'), Number(meta.deckle_mm) || 0);

  const docLine = `Doc Ref: ${meta.doc_ref || 'CPAK/QR/PL/01'}                   Rev No: ${meta.rev_no ?? 0}                                            Issue Date: ${meta.issue_date || ''}`;
  setValue(ws.getCell('P6'), docLine);

  for (let r = 9; r <= 30; r++) {
    for (const col of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
      const cell = ws.getCell(r, col);
      cell.value = col >= 12 ? 0 : null;
    }
  }

  const lines = meta.lines || [];
  const maxBody = 22;
  for (let i = 0; i < Math.min(lines.length, maxBody); i++) {
    const line = lines[i];
    const r = 9 + i;
    const fut = !!line.is_future;
    setValue(ws.getCell(r, 1), String(line.sales_order || '').replace(/^SO#/i, ''));
    setValue(ws.getCell(r, 2), line.item_number as any);
    setValue(ws.getCell(r, 3), line.customer || '');
    setValue(ws.getCell(r, 4), Number(line.length_m) || 0);
    setValue(ws.getCell(r, 5), line.core as any);
    setValue(ws.getCell(r, 6), line.treatment_side || '');
    setValue(ws.getCell(r, 7), Number(line.width_mm) || 0);
    // FUTURE SHIFT: still export reels + total weight (UI shows them);
    // only UPS / DECKLE / WT/PACK stay blank like the on-screen sheet.
    setValue(ws.getCell(r, 8), Number(line.reels) || 0);
    setValue(ws.getCell(r, 9), Number(line.weight_kg) || 0);
    setValue(ws.getCell(r, 10), Number(line.size_mm || line.width_mm) || 0);
    if (!fut) {
      setValue(ws.getCell(r, 11), Number(line.ups) || 0);
      setValue(ws.getCell(r, 12), Number(line.deckle_mm) || 0);
      setValue(ws.getCell(r, 14), Number(line.wt_pack_kg) || 0);
    } else {
      setValue(ws.getCell(r, 11), '');  // UPS → FUTURE SHIFT on UI
      setValue(ws.getCell(r, 12), '');  // DECKLE → "-"
      setValue(ws.getCell(r, 14), '');  // WT/PACK → "-"
    }
    setValue(ws.getCell(r, 13), Number(line.reels) || 0);
    setValue(ws.getCell(r, 15), Number(line.tot_wt_kg) || 0);
  }

  setValue(ws.getCell('H31'), '=SUM(H9:H30)');
  setValue(ws.getCell('I31'), '=SUM(I9:I29)');
  setValue(ws.getCell('J31'), 'TOTAL');
  setValue(ws.getCell('K31'), '=SUM(K9:K30)');
  setValue(ws.getCell('L31'), '=SUM(L9:L30)');
  setValue(ws.getCell('M31'), '=SUM(M9:M30)');
  setValue(ws.getCell('N31'), '=SUM(N9:N29)');
  setValue(ws.getCell('O31'), '=SUM(O9:O29)');
  const shortId = String(meta.plan_title || '').replace(/^[^0-9A-Za-z]*/, '').slice(0, 24);
  setValue(ws.getCell('P31'), shortId || meta.plan_title);

  // Dynamic size-change / FUTURE SHIFT operator instructions (UI footer line)
  const instr = (meta.change_instructions || '').trim();
  if (instr) {
    try {
      // Prefer a wide merge under the data table (row 32)
      try { ws.mergeCells('A32:O33'); } catch { /* already merged */ }
      const cell = ws.getCell('A32');
      cell.value = instr;
      cell.alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
      if (cell.font) {
        cell.font = { ...(cell.font || {}), bold: true, size: 9 };
      } else {
        cell.font = { bold: true, size: 9 };
      }
    } catch {
      setValue(ws.getCell('A32'), instr);
    }
  }

  // Title strip: light blue (same family as FILM/LENGTH header cells), never purple
  applyTitleBannerLightBlue(ws);
}

function copyWorksheet(src: any, dst: any): void {
  src.columns?.forEach((col: any, idx: number) => {
    if (!col) return;
    const c = dst.getColumn(idx + 1);
    if (col.width != null) c.width = col.width;
    if (col.hidden != null) c.hidden = col.hidden;
  });

  src.eachRow({ includeEmpty: true }, (row: any, rowNumber: number) => {
    const newRow = dst.getRow(rowNumber);
    if (row.height != null) newRow.height = row.height;
    if (row.hidden != null) newRow.hidden = row.hidden;
    row.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
      const target = newRow.getCell(colNumber);
      target.value = cell.value;
      if (cell.style) {
        try {
          target.style = JSON.parse(JSON.stringify(cell.style));
        } catch {
          target.style = cell.style;
        }
      }
      if (cell.numFmt) target.numFmt = cell.numFmt;
    });
    newRow.commit();
  });

  const merges: string[] = src.model?.merges || [];
  for (const m of merges) {
    try {
      dst.mergeCells(m);
    } catch {
      /* ignore */
    }
  }

  if (src.views) {
    try {
      dst.views = JSON.parse(JSON.stringify(src.views));
    } catch {
      dst.views = src.views;
    }
  }
}

export async function writeFactoryPlansExcelJs(metas: FactorySheetMeta[]): Promise<Uint8Array> {
  const ExcelJS = await loadExcelJS();

  const list =
    metas && metas.length
      ? metas
      : [
          {
            plan_title: 'EMPTY',
            machine_code: 'SS',
            machine_name: 'SECONDARY SLITTER',
            film: '',
            thickness_micron: 0,
            density: 0.91,
            length_m: 0,
            reps: 1,
            deckle_mm: 1700,
            allowed_trim_mm: 25,
            lines: [] as FactoryLineRow[],
          },
        ];

  const templateBuf = b64ToArrayBuffer(FACTORY_PLAN_TEMPLATE_XLSX_B64);
  const out = new ExcelJS.Workbook();
  out.creator = 'Plannex';
  out.created = new Date();

  for (let i = 0; i < list.length; i++) {
    const tmp = new ExcelJS.Workbook();
    await tmp.xlsx.load(templateBuf);
    const src = tmp.worksheets[0];
    fillFactorySheetExcelJs(src, list[i]);

    const name = `Plan${i + 1}`.slice(0, 31);
    const dst = out.addWorksheet(name);
    copyWorksheet(src, dst);
  }

  const buf = await out.xlsx.writeBuffer();
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf as ArrayBuffer);
}
