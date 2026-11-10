import * as XLSX from 'xlsx';
import { formatPhoneDisplay } from './sms';
import { newId } from './storage';
import type { Order } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

function toDateStr(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  }
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${pad(d.m)}-${pad(d.d)} ${pad(d.H)}:${pad(d.M)}:${pad(Math.floor(d.S))}`;
  }
  return String(v ?? '').trim();
}

export function phoneDigits(p: string): string {
  return (p || '').replace(/\D/g, '');
}

export function parseQty(raw: string): number {
  const m = String(raw || '').match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

/** 주소가 실제 주소처럼 보이지 않으면 이유를 돌려줌 */
export function addressIssue(addr: string): string | null {
  const a = addr.trim();
  if (!a) return '주소 없음';
  if (a.length < 10 || !/\d/.test(a)) return '주소 불완전';
  if (!/(시|도|군|구)\s?/.test(a) || !/(로|길|동|읍|면|리|번지)/.test(a)) return '주소 확인 필요';
  return null;
}

type ColKey = 'name' | 'qty' | 'phone' | 'address' | 'submittedAt';
const COL_MATCH: Record<ColKey, RegExp> = {
  name: /성함|이름|성명/,
  qty: /수량/,
  phone: /연락처|전화|휴대폰|핸드폰/,
  address: /주소/,
  submittedAt: /응답일시|일시|제출|작성/,
};

export type ImportResult = { added: Order[]; skipped: number; total: number };

/** 네이버 폼 엑셀(.xlsx) 가져오기. 같은 연락처+응답일시 는 건너뜀 */
export async function importNaverXlsx(file: File, existing: Order[]): Promise<ImportResult> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' });
  const hIdx = rows.findIndex((r) => r.some((c) => /성함|이름/.test(String(c))) && r.some((c) => /연락처|전화/.test(String(c))));
  if (hIdx < 0) throw new Error('헤더(구매자 성함 / 연락처) 줄을 찾지 못했어요');
  const header = rows[hIdx].map((c) => String(c));
  const col = {} as Record<ColKey, number>;
  (Object.keys(COL_MATCH) as ColKey[]).forEach((k) => {
    col[k] = header.findIndex((h) => COL_MATCH[k].test(h));
  });
  const get = (r: unknown[], k: ColKey) => (col[k] >= 0 ? r[col[k]] : '');

  const seen = new Set(existing.map((o) => `${phoneDigits(o.phone)}|${o.submittedAt}`));
  const phoneCount = new Map<string, number[]>();
  existing.forEach((o) => {
    const d = phoneDigits(o.phone);
    phoneCount.set(d, [...(phoneCount.get(d) || []), o.seq]);
  });
  let seq = existing.reduce((m, o) => Math.max(m, o.seq), 0);
  const parsed = rows
    .slice(hIdx + 1)
    .map((r) => ({
      name: String(get(r, 'name') ?? '').trim(),
      qtyRaw: String(get(r, 'qty') ?? '').trim(),
      phoneRaw: String(get(r, 'phone') ?? '').trim(),
      address: String(get(r, 'address') ?? '').replace(/\s*\n\s*/g, ' ').trim(),
      submittedAt: toDateStr(get(r, 'submittedAt')),
    }))
    .filter((r) => r.name || r.phoneRaw)
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));

  const added: Order[] = [];
  let skipped = 0;
  for (const r of parsed) {
    const digits = phoneDigits(r.phoneRaw);
    const key = `${digits}|${r.submittedAt}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    seq++;
    const flags: string[] = [];
    const issue = addressIssue(r.address);
    if (issue) flags.push(issue);
    if (!/^01\d{8,9}$/.test(digits)) flags.push('연락처 확인 필요');
    const qty = parseQty(r.qtyRaw);
    if (!qty) flags.push('수량 확인 필요');
    const prev = phoneCount.get(digits) || [];
    if (digits && prev.length) {
      flags.push(`동일 연락처 중복 신청(${prev.join(', ')}번)`);
      added
        .filter((a) => phoneDigits(a.phone) === digits)
        .forEach((a) => {
          a.flags.push(`동일 연락처 중복 신청(${seq}번)`);
          a.status = '확인필요';
        });
    }
    phoneCount.set(digits, [...prev, seq]);
    added.push({
      id: newId(),
      seq,
      submittedAt: r.submittedAt,
      name: r.name,
      qty,
      qtyRaw: r.qtyRaw,
      phone: formatPhoneDisplay(r.phoneRaw),
      phoneRaw: r.phoneRaw,
      address: r.address,
      notes: [],
      flags,
      status: flags.length ? '확인필요' : '접수',
      smsSent: {},
      updatedAt: Date.now(),
    });
  }
  return { added, skipped, total: parsed.length };
}

function rowsFor(orders: Order[]) {
  return orders.map((o) => ({
    순번: o.seq,
    성함: o.name,
    타이어요청수량: o.qty,
    연락처: o.phone,
    주소: o.address,
    응답일시: o.submittedAt,
    상태: o.status,
    메모: [...o.flags, ...o.notes, o.memo || ''].filter(Boolean).join(' / '),
    송장번호: o.tracking || '',
  }));
}

function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function exportXlsx(orders: Order[]): void {
  const ws = XLSX.utils.json_to_sheet(rowsFor(orders));
  ws['!cols'] = [{ wch: 5 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 50 }, { wch: 19 }, { wch: 8 }, { wch: 30 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '타이어 공구');
  XLSX.writeFile(wb, `타이어공구-${stamp()}.xlsx`);
}

export function exportCsv(orders: Order[]): void {
  const ws = XLSX.utils.json_to_sheet(rowsFor(orders));
  const csv = '\uFEFF' + XLSX.utils.sheet_to_csv(ws);
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `타이어공구-${stamp()}.csv`);
}

export function exportBackup(orders: Order[], templates: unknown): void {
  const data = { app: 'tire-tool-order-manager', exportedAt: new Date().toISOString(), orders, templates };
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `타이어공구-백업-${stamp()}.json`);
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
