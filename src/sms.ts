import type { Order, SmsKind } from './types';

const LS_SMS = 'tire-tool-om-sms-templates-v1';

export type SmsTemplates = Record<SmsKind, string>;

export const DEFAULT_SMS: SmsTemplates = {
  접수: '안녕하세요 {{이름}}님, 타이어 신청이 접수되었습니다. 수량: 타이어 {{수량}}개. 착불로 발송 예정입니다. 감사합니다.',
  발송: '안녕하세요 {{이름}}님, 신청하신 타이어 {{수량}}개가 착불로 발송되었습니다. 송장번호: {{송장번호}}',
};

export function getSmsTemplates(): SmsTemplates {
  try {
    const raw = localStorage.getItem(LS_SMS);
    if (raw) {
      const o = JSON.parse(raw) as Partial<SmsTemplates>;
      return {
        접수: (o.접수 || '').trim() || DEFAULT_SMS.접수,
        발송: (o.발송 || '').trim() || DEFAULT_SMS.발송,
      };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SMS };
}

export function setSmsTemplates(t: SmsTemplates): void {
  localStorage.setItem(LS_SMS, JSON.stringify({ 접수: t.접수.trim() || DEFAULT_SMS.접수, 발송: t.발송.trim() || DEFAULT_SMS.발송 }));
}

export function resetSmsTemplates(): void {
  localStorage.removeItem(LS_SMS);
}

/** 송장번호가 없으면 「송장번호: {{송장번호}}」 구절을 깔끔하게 제거 */
function stripTracking(body: string): string {
  return body
    .replace(/[ \t]*[(\[]?\s*(택배\s*)?송장\s*번호\s*(는|:|：)?\s*\{\{송장번호\}\}\s*(입니다)?[.)\]]?/g, '')
    .replace(/\{\{송장번호\}\}/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function fillTemplate(tpl: string, o: Pick<Order, 'name' | 'qty' | 'address' | 'tracking'>): string {
  const tn = (o.tracking || '').trim();
  let body = tn ? tpl.replaceAll('{{송장번호}}', tn) : stripTracking(tpl);
  body = body
    .replaceAll('{{이름}}', (o.name || '').trim())
    .replaceAll('{{수량}}', String(o.qty || ''))
    .replaceAll('{{주소}}', (o.address || '').trim());
  return body.trim();
}

export function buildSmsBody(kind: SmsKind, o: Order): string {
  return fillTemplate(getSmsTemplates()[kind], o);
}

const isIOS =
  typeof navigator !== 'undefined' &&
  typeof document !== 'undefined' &&
  /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) &&
  'ontouchend' in document;

/** sms: URI — iPhone 은 번호&body= , 그 외는 번호?body= */
export function buildSmsLink(phone: string, body?: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits) return '#';
  if (body && body.trim()) return `sms:${digits}${isIOS ? '&' : '?'}body=${encodeURIComponent(body.trim())}`;
  return `sms:${digits}`;
}

export function formatPhoneDisplay(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return phone.trim();
}
