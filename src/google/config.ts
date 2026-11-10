const LS_CLIENT_ID = 'tire-tool-om-google-client-id';
const LS_SHEET_ID = 'tire-tool-om-google-sheet-id';

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
/** 앱이 읽고 쓰는 탭 (기준 데이터) */
export const ORDERS_SHEET_NAME = 'Orders';
/** 사람이 보는 원본 신청 목록 — 읽기만 함 (Orders 가 비어 있을 때 한 번 가져옴) */
export const APPLICATIONS_SHEET_NAME = '신청목록';

export const ORDERS_HEADERS = [
  'id', 'seq', 'submittedAt', 'name', 'qty', 'qtyRaw', 'phone', 'phoneRaw', 'address',
  'notes', 'flags', 'status', 'memo', 'tracking', 'smsSent', 'updatedAt', 'deletedAt',
] as const;
export const ORDERS_LAST_COL = 'Q';

export const DEFAULT_CLIENT_ID = '489719252286-lol6b863pne0iahgbhf8j2lng6ovfiv1.apps.googleusercontent.com';
export const DEFAULT_SHEET_ID = '1A1hKUv1xiFor4Sz8hOwetau_tvRjYmHM_eolsIt9xN4';

function ls(k: string): string {
  try {
    return localStorage.getItem(k)?.trim() || '';
  } catch {
    return '';
  }
}

export function getClientId(): string {
  return ls(LS_CLIENT_ID) || DEFAULT_CLIENT_ID;
}
export function getSheetId(): string {
  return ls(LS_SHEET_ID) || DEFAULT_SHEET_ID;
}
export function setClientIdOverride(v: string): void {
  const t = v.trim();
  if (t && t !== DEFAULT_CLIENT_ID) localStorage.setItem(LS_CLIENT_ID, t);
  else localStorage.removeItem(LS_CLIENT_ID);
}
export function setSheetIdOverride(v: string): void {
  // 시트 URL 을 붙여 넣어도 ID 만 꺼냄
  const m = v.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  const t = (m ? m[1] : v).trim();
  if (t && t !== DEFAULT_SHEET_ID) localStorage.setItem(LS_SHEET_ID, t);
  else localStorage.removeItem(LS_SHEET_ID);
}
export function hasGoogleConfig(): boolean {
  return Boolean(getClientId() && getSheetId());
}
export function sheetUrl(): string {
  return `https://docs.google.com/spreadsheets/d/${getSheetId()}/edit`;
}
