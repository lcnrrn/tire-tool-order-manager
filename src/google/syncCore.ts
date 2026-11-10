import type { Order } from '../types';
import { ORDERS_LAST_COL, ORDERS_SHEET_NAME } from './config';
import { batchRead, ensureOrdersSheet, invalidateSheetMeta, isQuotaError, parseOrdersValues, patchOrders, readApplications, orderToRow } from './sheets';
import { phoneDigits } from '../excel';

/** 마지막으로 시트와 맞춘 주문 id 목록 — 시트에서 사람이 행을 지웠는지 / 이 기기에서 새로 만든 건지 구분용 */
const LS_BASE = 'tire-tool-om-sync-base-v1';

function loadBase(): Set<string> | null {
  try {
    const raw = localStorage.getItem(LS_BASE);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}
function saveBase(list: Order[]): void {
  try {
    localStorage.setItem(LS_BASE, JSON.stringify(list.map((o) => o.id)));
  } catch {
    /* ignore */
  }
}
export function clearSyncBase(): void {
  localStorage.removeItem(LS_BASE);
}

const rowKey = (o: Order) => JSON.stringify(orderToRow(o));
const dupKey = (o: Order) => `${phoneDigits(o.phone)}|${o.submittedAt}`;

export function ordersFingerprint(list: Order[]): string {
  return [...list].sort((a, b) => (a.id < b.id ? -1 : 1)).map(rowKey).join('\n');
}

/**
 * 시트가 기준. 같은 id 는 updatedAt 이 더 큰 쪽이 이김 (같으면 시트).
 * - 이 기기에만 있는 주문: 한 번도 시트와 맞춘 적 없는 id 면 새 주문 → 올림.
 *   예전에 시트에 있었는데 지금 없으면(사람이 시트에서 행을 지움) → 이 기기에서도 뺌.
 * - 같은 연락처+응답일시 가 시트에 이미 있으면 중복으로 보고 올리지 않음.
 */
export function planSync(local: Order[], remote: Order[], base: Set<string> | null) {
  const lmap = new Map(local.map((o) => [o.id, o]));
  const rmap = new Map(remote.map((o) => [o.id, o]));
  const remoteKeys = new Set(remote.filter((o) => !o.deletedAt).map(dupKey));
  const merged: Order[] = [];
  const write: Order[] = [];
  for (const r of remote) {
    const l = lmap.get(r.id);
    if (l && l.updatedAt > r.updatedAt) {
      merged.push(l);
      if (rowKey(l) !== rowKey(r)) write.push(l);
    } else merged.push(r);
  }
  for (const l of local) {
    if (rmap.has(l.id)) continue;
    if (base?.has(l.id)) continue; // 시트에서 지워짐
    if (!l.deletedAt && remoteKeys.has(dupKey(l)) && phoneDigits(l.phone)) continue; // 이미 시트에 같은 신청
    if (l.deletedAt) continue; // 시트에 없던 걸 지운 것 — 올릴 필요 없음
    merged.push(l);
    write.push(l);
  }
  return { merged, write };
}

export type SyncResult = { merged: Order[]; pushed: number; remoteCount: number; seeded: number };

/**
 * 동기화 한 번: Orders 탭 받기 → (비어 있으면 신청목록에서 한 번 가져오기) → 합치기 → 바뀐 것만 쓰기.
 * 빈 로컬 목록이 시트를 지우는 일은 없음 (쓰기는 항상 '바뀐 행만', 행 삭제는 하지 않음).
 */
export async function pullMergePush(token: string, local: Order[]): Promise<SyncResult> {
  let remote: Order[];
  try {
    await ensureOrdersSheet(token);
    const [vals] = await batchRead(token, [`${ORDERS_SHEET_NAME}!A:${ORDERS_LAST_COL}`]);
    remote = parseOrdersValues(vals);
  } catch (e) {
    if (!isQuotaError(e instanceof Error ? e.message : '')) invalidateSheetMeta();
    throw e;
  }
  let seeded = 0;
  let base = loadBase();
  if (remote.length === 0) {
    // 첫 연결: 사람이 보는 「신청목록」 탭을 Orders 로 한 번 복사
    const apps = await readApplications(token);
    if (apps.length) {
      seeded = apps.length;
      const appKeys = new Set(apps.map(dupKey));
      // 이 기기에서 엑셀로 먼저 가져온 같은 신청은 신청목록 쪽(seed-순번)으로 맞춤
      const extra = local.filter((o) => !o.id.startsWith('seed-') && !appKeys.has(dupKey(o)));
      const lmap = new Map(local.map((o) => [o.id, o]));
      const seedList = apps.map((a) => {
        const l = lmap.get(a.id);
        return l && l.updatedAt > a.updatedAt ? l : a;
      });
      const all = [...seedList, ...extra];
      await patchOrders(token, all);
      saveBase(all);
      return { merged: all, pushed: all.length, remoteCount: 0, seeded };
    }
    base = null; // 시트가 비었으면 '시트에서 지워짐' 판단을 하지 않음 (이 기기 것을 올림)
  }
  const { merged, write } = planSync(local, remote, base);
  if (write.length) await patchOrders(token, write);
  saveBase(merged);
  return { merged, pushed: write.length, remoteCount: remote.length, seeded };
}

/** 시트(신청목록)에서 다시 받기: Orders 탭은 그대로 두고, 신청목록에만 있고 Orders 에 없는 신청을 추가 */
export async function pullMissingApplications(token: string, local: Order[]): Promise<number> {
  const apps = await readApplications(token);
  const have = new Set(local.map((o) => o.id));
  const keys = new Set(local.filter((o) => !o.deletedAt).map(dupKey));
  const add = apps.filter((a) => !have.has(a.id) && !keys.has(dupKey(a)));
  if (add.length) await patchOrders(token, add);
  return add.length;
}
