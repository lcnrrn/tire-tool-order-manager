import { STATUSES, type Order, type Status } from './types';

const LS_ORDERS = 'tire-tool-om-orders-v2';

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const uniq = (a: unknown): string[] =>
  Array.isArray(a) ? [...new Set(a.map((x) => String(x).trim()).filter(Boolean))] : [];

export function normalizeOrder(raw: Partial<Order> & Record<string, unknown>): Order {
  const status = STATUSES.includes(raw.status as Status) ? (raw.status as Status) : '접수';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    seq: Number(raw.seq) || 0,
    submittedAt: String(raw.submittedAt || ''),
    name: String(raw.name || ''),
    qty: Number(raw.qty) || 0,
    qtyRaw: raw.qtyRaw ? String(raw.qtyRaw) : undefined,
    phone: String(raw.phone || ''),
    phoneRaw: raw.phoneRaw ? String(raw.phoneRaw) : undefined,
    address: String(raw.address || ''),
    notes: uniq(raw.notes),
    flags: uniq(raw.flags),
    status,
    memo: raw.memo ? String(raw.memo) : undefined,
    tracking: raw.tracking ? String(raw.tracking) : undefined,
    smsSent: raw.smsSent && typeof raw.smsSent === 'object' ? { ...(raw.smsSent as Order['smsSent']) } : {},
    updatedAt: Number(raw.updatedAt) || 0,
    deletedAt: Number(raw.deletedAt) || undefined,
  };
}

/** 처음엔 빈 목록. 개인정보는 앱 코드에 넣지 않고 구글 시트(또는 엑셀 가져오기)에서만 채움 */
export function loadOrders(): Order[] {
  try {
    const raw = localStorage.getItem(LS_ORDERS);
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) return arr.map((o) => normalizeOrder(o as Partial<Order> & Record<string, unknown>));
    }
  } catch {
    /* ignore */
  }
  return [];
}

export function saveOrders(orders: Order[]): void {
  try {
    localStorage.setItem(LS_ORDERS, JSON.stringify(orders));
  } catch {
    /* ignore */
  }
}

/** 화면에 보이는(삭제 안 된) 주문 */
export const live = (list: Order[]) => list.filter((o) => !o.deletedAt);
