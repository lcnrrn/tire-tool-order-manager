export const STATUSES = ['접수', '확인필요', '발송대기', '발송완료'] as const;
export type Status = (typeof STATUSES)[number];
export type SmsKind = '접수' | '발송';

export type Order = {
  id: string;
  seq: number;
  submittedAt: string;
  name: string;
  qty: number;
  qtyRaw?: string;
  phone: string;
  phoneRaw?: string;
  address: string;
  notes: string[];
  flags: string[];
  status: Status;
  memo?: string;
  tracking?: string;
  /** 템플릿별 문자 보낸 시각 (ISO). 없으면 미발송 */
  smsSent: Partial<Record<SmsKind, string>>;
  /** 마지막 수정 시각(ms) — 동기화 때 더 최근 것이 이김 */
  updatedAt: number;
  /** 삭제 표시(ms). 시트에 행은 남기고 화면에서만 숨김 → 다른 기기에서 되살아나지 않음 */
  deletedAt?: number;
};
