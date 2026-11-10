import { STATUSES, type Order, type Status } from '../types';
import { normalizeOrder } from '../storage';
import { formatPhoneDisplay } from '../sms';
import { APPLICATIONS_SHEET_NAME, ORDERS_HEADERS, ORDERS_LAST_COL, ORDERS_SHEET_NAME, getSheetId } from './config';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

function sheetIdOrThrow(): string {
  const id = getSheetId();
  if (!id) throw new Error('스프레드시트 ID가 없습니다. 설정에서 Sheet ID를 입력해 주세요.');
  return id;
}

function sheetsFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
}

async function readError(res: Response): Promise<string> {
  let msg: string;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    msg = body.error?.message || res.statusText || `HTTP ${res.status}`;
  } catch {
    msg = res.statusText || `HTTP ${res.status}`;
  }
  if (res.status === 401) msg += ' [HTTP 401]';
  if (res.status === 429 || res.status === 503) msg += ` [HTTP ${res.status}]`;
  return msg;
}

export function isQuotaError(msg: string): boolean {
  return /\[HTTP (429|503)\]|quota exceeded|rate ?limit|RESOURCE_EXHAUSTED|too many requests|currently unavailable/i.test(msg);
}
export function isAuthError(msg: string): boolean {
  return /\[HTTP 401\]|invalid authentication|invalid credentials|UNAUTHENTICATED/i.test(msg);
}

let metaCache: { id: string; tabs: Map<string, number> } | null = null;
export function invalidateSheetMeta(): void {
  metaCache = null;
}

export async function getSheetTabs(token: string, force = false): Promise<Map<string, number>> {
  const id = sheetIdOrThrow();
  if (!force && metaCache && metaCache.id === id) return metaCache.tabs;
  const res = await sheetsFetch(token, `${id}?fields=sheets.properties(sheetId,title)`);
  if (!res.ok) throw new Error(`스프레드시트를 열 수 없습니다: ${await readError(res)}`);
  const meta = (await res.json()) as { sheets?: { properties?: { sheetId?: number; title?: string } }[] };
  const tabs = new Map<string, number>();
  for (const s of meta.sheets || []) if (s.properties?.title) tabs.set(s.properties.title, s.properties.sheetId ?? 0);
  metaCache = { id, tabs };
  return tabs;
}

/** Orders 탭이 없으면 만들고 머리글을 씀. 만들었으면 true */
export async function ensureOrdersSheet(token: string): Promise<boolean> {
  let tabs = await getSheetTabs(token);
  if (tabs.has(ORDERS_SHEET_NAME)) return false;
  tabs = await getSheetTabs(token, true);
  if (tabs.has(ORDERS_SHEET_NAME)) return false;
  const id = sheetIdOrThrow();
  const res = await sheetsFetch(token, `${id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: ORDERS_SHEET_NAME, gridProperties: { frozenRowCount: 1 } } } }],
    }),
  });
  invalidateSheetMeta();
  if (!res.ok) throw new Error(`${ORDERS_SHEET_NAME} 탭 생성 실패: ${await readError(res)}`);
  const h = await sheetsFetch(token, `${id}/values/${encodeURIComponent(`${ORDERS_SHEET_NAME}!A1`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [[...ORDERS_HEADERS]] }),
  });
  if (!h.ok) throw new Error(`머리글 쓰기 실패: ${await readError(h)}`);
  return true;
}

/** 여러 범위를 읽기 요청 1번으로 */
export async function batchRead(token: string, ranges: string[]): Promise<string[][][]> {
  const id = sheetIdOrThrow();
  const q = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const res = await sheetsFetch(token, `${id}/values:batchGet?${q}`);
  if (!res.ok) throw new Error(`시트 읽기 실패: ${await readError(res)}`);
  const data = (await res.json()) as { valueRanges?: { values?: unknown[][] }[] };
  return ranges.map((_, i) => (data.valueRanges?.[i]?.values || []).map((r) => (r || []).map((c) => String(c ?? ''))));
}

const SEP = ' | ';
const joinList = (a: string[]) => a.join(SEP);
const splitList = (s: string) => String(s || '').split(/\s*\|\s*/).map((x) => x.trim()).filter(Boolean);

export function orderToRow(o: Order): string[] {
  return [
    o.id,
    String(o.seq),
    o.submittedAt,
    o.name,
    String(o.qty || ''),
    o.qtyRaw || '',
    o.phone,
    o.phoneRaw || '',
    o.address,
    joinList(o.notes),
    joinList(o.flags),
    o.status,
    o.memo || '',
    o.tracking || '',
    Object.keys(o.smsSent).length ? JSON.stringify(o.smsSent) : '',
    String(o.updatedAt || 0),
    o.deletedAt ? String(o.deletedAt) : '',
  ];
}

export function rowToOrder(row: string[]): Order | null {
  const id = (row[0] || '').trim();
  if (!id || id === 'id') return null;
  let smsSent: Order['smsSent'] = {};
  try {
    if (row[14]) smsSent = JSON.parse(row[14]) as Order['smsSent'];
  } catch {
    /* ignore */
  }
  return normalizeOrder({
    id,
    seq: Number(row[1]) || 0,
    submittedAt: row[2] || '',
    name: row[3] || '',
    qty: Number(row[4]) || 0,
    qtyRaw: row[5] || undefined,
    phone: row[6] || '',
    phoneRaw: row[7] || undefined,
    address: row[8] || '',
    notes: splitList(row[9]),
    flags: splitList(row[10]),
    status: (row[11] || '접수') as Status,
    memo: row[12] || undefined,
    tracking: row[13] || undefined,
    smsSent,
    updatedAt: Number(row[15]) || 0,
    deletedAt: Number(row[16]) || undefined,
  });
}

export function parseOrdersValues(values: string[][]): Order[] {
  const out: Order[] = [];
  const seen = new Set<string>();
  for (const row of values.slice(1)) {
    const o = rowToOrder(row);
    if (!o || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push(o);
  }
  return out;
}

/** 시트 숫자 칸이 앞 0 을 잃은 전화번호(10xxxxxxxx)도 복원 */
function fixPhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('10')) d = '0' + d;
  return d ? formatPhoneDisplay(d) : raw.trim();
}

/**
 * 「신청목록」 탭(순번, 성함, 타이어요청수량, 연락처, 주소, 응답일시, 상태, 메모, 확인사항)을 주문으로.
 * id 는 seed-{순번} 으로 고정 → 여러 기기에서 처음 가져와도 같은 주문으로 합쳐짐.
 */
export function parseApplicationsValues(values: string[][]): Order[] {
  const hIdx = values.findIndex((r) => r.some((c) => /성함/.test(c)) && r.some((c) => /연락처/.test(c)));
  if (hIdx < 0) return [];
  const h = values[hIdx];
  const col = (re: RegExp) => h.findIndex((c) => re.test(c));
  const c = {
    seq: col(/순번/),
    name: col(/성함|이름/),
    qty: col(/수량/),
    phone: col(/연락처/),
    address: col(/주소/),
    at: col(/응답일시|일시/),
    status: col(/상태/),
    memo: col(/메모/),
    flags: col(/확인사항/),
  };
  const get = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  const split = (s: string) => s.split(/\s*(?:\||\/|·|,|\n)\s*/).map((x) => x.trim()).filter(Boolean);
  const out: Order[] = [];
  values.slice(hIdx + 1).forEach((r, i) => {
    const name = get(r, c.name);
    const phone = get(r, c.phone);
    if (!name && !phone) return;
    const seq = Number(get(r, c.seq)) || i + 1;
    const flags = split(get(r, c.flags));
    const st = get(r, c.status) as Status;
    const qtyRaw = get(r, c.qty);
    out.push(
      normalizeOrder({
        id: `seed-${seq}`,
        seq,
        submittedAt: get(r, c.at),
        name,
        qty: Number((qtyRaw.match(/\d+/) || [''])[0]) || 0,
        qtyRaw,
        phone: fixPhone(phone),
        phoneRaw: phone,
        address: get(r, c.address).replace(/\s*\n\s*/g, ' '),
        notes: split(get(r, c.memo)),
        flags,
        status: STATUSES.includes(st) ? st : flags.length ? '확인필요' : '접수',
        smsSent: {},
        updatedAt: 1, // 가장 오래된 값 — 앱에서 한 번이라도 고치면 그쪽이 이김
      }),
    );
  });
  return out;
}

export async function readApplications(token: string): Promise<Order[]> {
  const tabs = await getSheetTabs(token);
  if (!tabs.has(APPLICATIONS_SHEET_NAME)) return [];
  const [vals] = await batchRead(token, [`${APPLICATIONS_SHEET_NAME}!A:Z`]);
  return parseApplicationsValues(vals);
}

/** A 열의 id → 행 번호 */
async function readIdRows(token: string): Promise<{ rows: Map<string, number>; lastRow: number }> {
  const [vals] = await batchRead(token, [`${ORDERS_SHEET_NAME}!A:A`]);
  const rows = new Map<string, number>();
  vals.forEach((r, i) => {
    const id = String(r[0] || '').trim();
    if (id && id !== 'id' && !rows.has(id)) rows.set(id, i + 1);
  });
  return { rows, lastRow: vals.length };
}

/** 바뀐 주문만 그 행에 덮어쓰고, 없는 주문은 맨 아래 빈 행에 씀 (탭 전체를 지우지 않음) */
export async function patchOrders(token: string, orders: Order[]): Promise<void> {
  if (!orders.length) return;
  const id = sheetIdOrThrow();
  const { rows, lastRow } = await readIdRows(token);
  const data: { range: string; values: string[][] }[] = [];
  if (lastRow === 0) data.push({ range: `${ORDERS_SHEET_NAME}!A1:${ORDERS_LAST_COL}1`, values: [[...ORDERS_HEADERS]] });
  let next = Math.max(lastRow, 1) + 1;
  const appended: string[] = [];
  for (const o of orders) {
    const n = rows.get(o.id) ?? next++;
    if (!rows.has(o.id)) appended.push(o.id);
    data.push({ range: `${ORDERS_SHEET_NAME}!A${n}:${ORDERS_LAST_COL}${n}`, values: [orderToRow(o)] });
  }
  const res = await sheetsFetch(token, `${id}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
  if (!res.ok) throw new Error(`시트 쓰기 실패: ${await readError(res)}`);
  if (appended.length) {
    const after = await readIdRows(token);
    const missing = appended.filter((x) => !after.rows.has(x));
    if (missing.length) throw new Error(`새 주문 ${missing.length}건이 시트에 안 보여서 다시 시도해요`);
  }
}
