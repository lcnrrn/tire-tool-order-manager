import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownUp, Cloud, CloudOff, RefreshCw, Link2, Check, Copy, Download, FileSpreadsheet, MessageSquare, Pencil, Phone, Plus, Search, Settings, Trash2, Truck, Upload, X, AlertTriangle,
} from 'lucide-react';
import { STATUSES, type Order, type SmsKind, type Status } from './types';
import { loadOrders, saveOrders, newId, normalizeOrder, live } from './storage';
import { useGoogleSync, type SyncStatus } from './hooks/useGoogleSync';
import { DEFAULT_CLIENT_ID, DEFAULT_SHEET_ID, getClientId, getSheetId, setClientIdOverride, setSheetIdOverride, sheetUrl } from './google/config';
import { clearSyncBase } from './google/syncCore';
import { buildSmsBody, buildSmsLink, formatPhoneDisplay, getSmsTemplates, setSmsTemplates, resetSmsTemplates, DEFAULT_SMS, fillTemplate, type SmsTemplates } from './sms';
import { exportBackup, exportCsv, exportXlsx, importNaverXlsx, phoneDigits, parseQty } from './excel';

type Tab = '전체' | Status;
const TABS: Tab[] = ['전체', ...STATUSES];

function fmtSent(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export default function App() {
  const [orders, setOrders] = useState<Order[]>(() => loadOrders());
  const [tab, setTab] = useState<Tab>('전체');
  const [query, setQuery] = useState('');
  const [desc, setDesc] = useState(false);
  const [editing, setEditing] = useState<Order | 'new' | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => saveOrders(orders), [orders]);

  const notify = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  };

  const update = (id: string, patch: Partial<Order>) =>
    setOrders((list) => list.map((o) => (o.id === id ? { ...o, ...patch, updatedAt: Date.now() } : o)));

  const sync = useGoogleSync({ orders, replaceOrders: setOrders, onToast: notify });
  const alive = useMemo(() => live(orders), [orders]);

  const stats = useMemo(
    () => ({
      total: alive.length,
      tires: alive.reduce((s, o) => s + (o.qty || 0), 0),
      check: alive.filter((o) => o.status === '확인필요').length,
      unsent: alive.filter((o) => !o.smsSent.접수).length,
    }),
    [alive],
  );

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { 전체: alive.length, 접수: 0, 확인필요: 0, 발송대기: 0, 발송완료: 0 };
    alive.forEach((o) => c[o.status]++);
    return c;
  }, [alive]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qd = q.replace(/\D/g, '');
    return alive
      .filter((o) => tab === '전체' || o.status === tab)
      .filter((o) => {
        if (!q) return true;
        return (
          o.name.toLowerCase().includes(q) ||
          o.address.toLowerCase().includes(q) ||
          (qd.length >= 2 && phoneDigits(o.phone).includes(qd)) ||
          o.phone.includes(q)
        );
      })
      .sort((a, b) => (desc ? b.seq - a.seq : a.seq - b.seq));
  }, [alive, tab, query, desc]);

  const visibleTires = visible.reduce((s, o) => s + (o.qty || 0), 0);

  const onSms = (o: Order, kind: SmsKind) => {
    const patch: Partial<Order> = { smsSent: { ...o.smsSent, [kind]: new Date().toISOString() } };
    if (kind === '발송' && o.status === '발송대기') patch.status = '발송완료';
    update(o.id, patch);
    notify(`${o.name}님 ${kind} 문자 — 문자 앱을 열었어요`);
  };

  const onImport = async (file: File) => {
    try {
      const r = await importNaverXlsx(file, orders);
      if (r.added.length) setOrders((list) => [...list, ...r.added]);
      notify(`가져오기: 새 신청 ${r.added.length}건 추가${r.skipped ? ` · 이미 있는 ${r.skipped}건 건너뜀` : ''}`);
    } catch (e) {
      notify(`가져오기 실패: ${(e as Error).message}`);
    }
  };

  const saveEdit = (o: Order) => {
    const next = { ...o, updatedAt: Date.now() };
    setOrders((list) => (list.some((x) => x.id === o.id) ? list.map((x) => (x.id === o.id ? next : x)) : [...list, next]));
    setEditing(null);
    notify('저장했어요');
  };

  const remove = (o: Order) => {
    if (!confirm(`#${o.seq} ${o.name}님 신청을 삭제할까요?`)) return;
    update(o.id, { deletedAt: Date.now() });
    notify('삭제했어요');
  };

  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <div>
            <div className="eyebrow">TIRE GROUP BUY</div>
            <h1>타이어 공구 주문관리</h1>
          </div>
          <div className="top-actions">
            <SyncPill status={sync.status} connected={sync.connected} signed={sync.signed} dirty={sync.dirty} onClick={() => (sync.connected ? void sync.syncNow() : setShowSettings(true))} />
            <button className="icon-btn" aria-label="엑셀 가져오기" title="네이버 폼 엑셀 가져오기" onClick={() => fileRef.current?.click()}>
              <Upload size={20} />
            </button>
            <button className="icon-btn" aria-label="내보내기" title="엑셀/CSV 내보내기" onClick={() => setShowExport(true)}>
              <Download size={20} />
            </button>
            <button className="icon-btn" aria-label="설정" title="문자 템플릿 · 백업" onClick={() => setShowSettings(true)}>
              <Settings size={20} />
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
              e.target.value = '';
            }}
          />
        </div>

        <div className="stats">
          <Stat label="전체 신청" value={`${stats.total}건`} onClick={() => setTab('전체')} />
          <Stat label="타이어 총 수량" value={`${stats.tires}개`} />
          <Stat label="확인필요" value={`${stats.check}건`} tone={stats.check ? 'warn' : undefined} onClick={() => setTab('확인필요')} />
          <Stat label="문자 미발송" sub="접수 문자 기준" value={`${stats.unsent}건`} tone={stats.unsent ? 'accent' : undefined} />
        </div>

        <div className="search">
          <Search size={18} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름 · 연락처 · 주소 검색" inputMode="search" />
          {query && (
            <button className="clear" aria-label="지우기" onClick={() => setQuery('')}>
              <X size={16} />
            </button>
          )}
        </div>

        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'on' : ''} ${t === '확인필요' && counts[t] ? 'has-warn' : ''}`} onClick={() => setTab(t)}>
              {t} <span className="cnt">{counts[t]}</span>
            </button>
          ))}
        </nav>
      </header>

      <div className="list-head">
        <span>
          {visible.length}건 · 타이어 {visibleTires}개
        </span>
        <button className="sort" onClick={() => setDesc((d) => !d)}>
          <ArrowDownUp size={14} /> {desc ? '최근 신청 먼저' : '신청 순서대로'}
        </button>
      </div>

      <main className="list">
        {visible.map((o) => (
          <OrderCard
            key={o.id}
            o={o}
            onStatus={(s) => update(o.id, { status: s })}
            onTracking={(t) => update(o.id, { tracking: t || undefined })}
            onSms={(k) => onSms(o, k)}
            onUnsend={(k) => {
              const next = { ...o.smsSent };
              delete next[k];
              update(o.id, { smsSent: next });
            }}
            onCopy={async () => {
              const ok = await copyText(`${o.address}\n${formatPhoneDisplay(o.phone)}`);
              notify(ok ? '주소 + 연락처를 복사했어요' : '복사에 실패했어요');
            }}
            onEdit={() => setEditing(o)}
            onDelete={() => remove(o)}
          />
        ))}
        {!visible.length && alive.length > 0 && <div className="empty">조건에 맞는 신청이 없어요</div>}
        {!alive.length && (
          <div className="empty onboard">
            <p><b>아직 이 기기에 신청 목록이 없어요</b></p>
            <p className="muted small">구글 시트에 연결하면 「신청목록」 탭의 신청을 불러와요. 네이버 폼 엑셀을 직접 가져올 수도 있어요.</p>
            <div className="stack">
              {sync.signed && !sync.connected ? (
                <button className="btn primary" onClick={() => void sync.syncNow()}><Cloud size={18} /> 구글 시트 다시 연결</button>
              ) : !sync.connected ? (
                <button className="btn primary" onClick={() => void sync.connect()}><Cloud size={18} /> 구글 시트 연결</button>
              ) : (
                <button className="btn primary" onClick={() => void sync.syncNow()}><RefreshCw size={18} /> 지금 동기화</button>
              )}
              <button className="btn" onClick={() => fileRef.current?.click()}><Upload size={18} /> 네이버 폼 엑셀 가져오기</button>
            </div>
          </div>
        )}
      </main>

      <button className="fab" onClick={() => setEditing('new')} aria-label="신청 추가">
        <Plus size={26} />
      </button>

      {editing && (
        <EditModal
          order={editing === 'new' ? null : editing}
          nextSeq={alive.reduce((m, o) => Math.max(m, o.seq), 0) + 1}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
        />
      )}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onSaved={() => notify('문자 템플릿을 저장했어요')}
          sync={sync}
          onToast={notify}
          onBackup={() => exportBackup(orders, getSmsTemplates())}
          onRestore={(list) => {
            const now = Date.now();
            // 백업 내용이 시트보다 새것으로 저장되도록 수정 시각을 지금으로
            setOrders(list.map((o) => ({ ...o, updatedAt: now })));
            notify(`백업에서 ${live(list).length}건을 불러왔어요`);
          }}
        />
      )}
      {showExport && (
        <Modal title="내보내기" onClose={() => setShowExport(false)}>
          <p className="muted">
            현재 보이는 목록 {visible.length}건 ({tab}
            {query ? ` · "${query}" 검색` : ''})을 내보내요.
          </p>
          <div className="stack">
            <button className="btn primary" onClick={() => { exportXlsx(visible); setShowExport(false); }}>
              <FileSpreadsheet size={18} /> 엑셀(.xlsx)로 저장
            </button>
            <button className="btn" onClick={() => { exportCsv(visible); setShowExport(false); }}>
              <Download size={18} /> CSV로 저장
            </button>
          </div>
        </Modal>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Stat({ label, value, sub, tone, onClick }: { label: string; value: string; sub?: string; tone?: 'warn' | 'accent'; onClick?: () => void }) {
  return (
    <button type="button" className={`stat ${tone || ''}`} onClick={onClick} disabled={!onClick}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </button>
  );
}

function OrderCard(props: {
  o: Order;
  onStatus: (s: Status) => void;
  onTracking: (t: string) => void;
  onSms: (k: SmsKind) => void;
  onUnsend: (k: SmsKind) => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { o } = props;
  const [tracking, setTracking] = useState(o.tracking || '');
  useEffect(() => setTracking(o.tracking || ''), [o.tracking]);
  const warn = o.status === '확인필요' || o.flags.length > 0;

  return (
    <article className={`card ${warn ? 'warn' : ''} st-${o.status}`}>
      <div className="card-top">
        <span className="seq">#{o.seq}</span>
        <h2 className="name">{o.name || '(이름 없음)'}</h2>
        <span className="qty">타이어 {o.qty || '?'}개</span>
      </div>

      <div className="field">
        <a className="phone" href={`tel:${phoneDigits(o.phone)}`}>
          <Phone size={15} /> {formatPhoneDisplay(o.phone)}
        </a>
      </div>
      <div className="field addr">{o.address || <span className="muted">(주소 없음)</span>}</div>
      <div className="field when">접수 {o.submittedAt || '-'}</div>

      {(o.flags.length > 0 || o.status === '확인필요') && (
        <div className="flags">
          <AlertTriangle size={15} />
          <span>{o.flags.length ? o.flags.join(' · ') : '확인필요'}</span>
        </div>
      )}
      {(o.notes.length > 0 || o.memo) && <div className="notes">📝 {[...o.notes, o.memo].filter(Boolean).join(' · ')}</div>}

      <div className="row2">
        <label className="status-sel">
          <span>상태</span>
          <select value={o.status} onChange={(e) => props.onStatus(e.target.value as Status)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="track">
          <Truck size={15} />
          <input
            value={tracking}
            placeholder="송장번호"
            inputMode="numeric"
            onChange={(e) => setTracking(e.target.value)}
            onBlur={() => tracking.trim() !== (o.tracking || '') && props.onTracking(tracking.trim())}
          />
        </label>
      </div>

      <div className="sms-row">
        {(['접수', '발송'] as SmsKind[]).map((k) => {
          const sent = o.smsSent[k];
          const body = buildSmsBody(k, { ...o, tracking: tracking.trim() || o.tracking });
          return (
            <div key={k} className="sms-cell">
              <a
                className={`btn sms ${sent ? 'sent' : k === '접수' ? 'primary' : ''}`}
                href={buildSmsLink(o.phone, body)}
                onClick={() => props.onSms(k)}
                title={body}
              >
                {sent ? <Check size={17} /> : <MessageSquare size={17} />} {k} 문자
              </a>
              {sent ? (
                <button className="sent-tag" onClick={() => props.onUnsend(k)} title="보냄 표시 취소">
                  보냄 {fmtSent(sent)} <X size={12} />
                </button>
              ) : (
                <span className="sent-tag off">미발송</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="tool-row">
        <button className="btn ghost grow" onClick={props.onCopy}>
          <Copy size={16} /> 주소+연락처 복사
        </button>
        <button className="btn ghost" onClick={props.onEdit} aria-label="수정">
          <Pencil size={16} />
        </button>
        <button className="btn ghost danger" onClick={props.onDelete} aria-label="삭제">
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function nowStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function EditModal({ order, nextSeq, onClose, onSave }: { order: Order | null; nextSeq: number; onClose: () => void; onSave: (o: Order) => void }) {
  const [f, setF] = useState({
    seq: String(order?.seq ?? nextSeq),
    name: order?.name ?? '',
    qty: String(order?.qty ?? 4),
    phone: order?.phone ?? '',
    address: order?.address ?? '',
    submittedAt: order?.submittedAt ?? nowStr(),
    status: order?.status ?? ('접수' as Status),
    tracking: order?.tracking ?? '',
    memo: order?.memo ?? '',
    flags: (order?.flags ?? []).join(', '),
  });
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return alert('성함을 입력해 주세요');
    onSave(
      normalizeOrder({
        ...(order ?? { id: newId(), notes: [], smsSent: {}, updatedAt: 0 }),
        seq: Number(f.seq) || nextSeq,
        name: f.name.trim(),
        qty: parseQty(f.qty),
        phone: formatPhoneDisplay(f.phone),
        address: f.address.replace(/\s*\n\s*/g, ' ').trim(),
        submittedAt: f.submittedAt.trim(),
        status: f.status,
        tracking: f.tracking.trim() || undefined,
        memo: f.memo.trim() || undefined,
        flags: f.flags.split(',').map((s) => s.trim()).filter(Boolean),
      } as Order),
    );
  };

  return (
    <Modal title={order ? `#${order.seq} 신청 수정` : '신청 추가'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="grid2">
          <label>순번<input value={f.seq} onChange={set('seq')} inputMode="numeric" /></label>
          <label>타이어 수량<input value={f.qty} onChange={set('qty')} inputMode="numeric" /></label>
        </div>
        <label>성함<input value={f.name} onChange={set('name')} autoFocus={!order} /></label>
        <label>연락처<input value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="010-0000-0000" /></label>
        <label>주소 (착불 받을 곳)<textarea value={f.address} onChange={set('address')} rows={3} /></label>
        <div className="grid2">
          <label>상태
            <select value={f.status} onChange={set('status')}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label>송장번호<input value={f.tracking} onChange={set('tracking')} inputMode="numeric" /></label>
        </div>
        <label>응답일시<input value={f.submittedAt} onChange={set('submittedAt')} /></label>
        <label>확인 사항 (쉼표로 구분)<input value={f.flags} onChange={set('flags')} placeholder="예: 주소 불완전" /></label>
        <label>메모<input value={f.memo} onChange={set('memo')} /></label>
        <div className="stack">
          <button className="btn primary" type="submit"><Check size={18} /> 저장</button>
          <button className="btn ghost" type="button" onClick={onClose}>취소</button>
        </div>
      </form>
    </Modal>
  );
}

const SAMPLE = { name: '홍길동', qty: 4, address: '서울시 ○○구 ○○로 1', tracking: '' };

type Sync = ReturnType<typeof useGoogleSync>;

function fmtTime(ms: number): string {
  if (!ms) return '없음';
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function SyncPill({ status, connected, signed, dirty, onClick }: { status: SyncStatus; connected: boolean; signed: boolean; dirty: boolean; onClick: () => void }) {
  let label = '시트 미연결';
  let tone = 'off';
  if (status === 'syncing' || status === 'connecting') { label = '동기화 중'; tone = 'busy'; }
  else if (status === 'retrying') { label = '잠시 후 저장'; tone = 'busy'; }
  else if (connected && status === 'error') { label = '동기화 오류'; tone = 'err'; }
  else if (connected) { label = dirty ? '저장 대기' : '시트 저장됨'; tone = dirty ? 'busy' : 'ok'; }
  else if (signed) { label = '다시 연결'; tone = 'err'; }
  return (
    <button className={`sync-pill ${tone}`} onClick={onClick} title="구글 시트 동기화">
      {connected ? <Cloud size={15} /> : <CloudOff size={15} />}
      <span>{label}</span>
    </button>
  );
}

function GoogleSection({ sync }: { sync: Sync }) {
  const [clientId, setClientId] = useState(getClientId());
  const [sheetId, setSheetId] = useState(getSheetId());
  const changed = clientId.trim() !== getClientId() || sheetId.trim() !== getSheetId();
  const saveIds = () => {
    const sheetChanged = sheetId.trim() !== getSheetId();
    setClientIdOverride(clientId);
    setSheetIdOverride(sheetId);
    setClientId(getClientId());
    setSheetId(getSheetId());
    if (sheetChanged) clearSyncBase();
  };
  return (
    <section className="settings-sec no-auto-login">
      <h4>구글 시트 동기화</h4>
      <div className={`gs-status ${sync.connected ? 'ok' : ''}`}>
        {sync.connected ? <Cloud size={16} /> : <CloudOff size={16} />}
        <span>
          {sync.connected ? `연결됨${sync.email ? ` · ${sync.email}` : ''}` : sync.signed ? '로그인 만료 — 다시 연결이 필요해요' : '연결 안 됨'}
        </span>
      </div>
      <p className="muted small">
        마지막 동기화: {fmtTime(sync.lastSyncAt)}{sync.dirty ? ' · 아직 시트에 안 올라간 변경 있음' : ''}
        {sync.lastError ? <><br />⚠️ {sync.lastError}</> : null}
      </p>
      <p className="muted small">
        앱은 시트의 <code>Orders</code> 탭을 읽고 씁니다 (처음 연결 때 없으면 만들어요). Orders 가 비어 있으면 <code>신청목록</code> 탭의 신청을 한 번 복사해 와요. 신청목록 탭은 바꾸지 않아요.
      </p>
      <label className="inline">
        OAuth Client ID
        <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={DEFAULT_CLIENT_ID} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </label>
      <label className="inline">
        스프레드시트 ID (또는 시트 주소)
        <input value={sheetId} onChange={(e) => setSheetId(e.target.value)} placeholder={DEFAULT_SHEET_ID} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </label>
      <div className="stack">
        {changed && <button className="btn" onClick={saveIds}><Check size={18} /> ID 저장</button>}
        {!sync.connected ? (
          <button className="btn primary" disabled={changed} onClick={() => void (sync.signed ? sync.syncNow() : sync.connect())}>
            <Cloud size={18} /> {sync.signed ? '다시 연결' : '구글 시트 연결'}
          </button>
        ) : (
          <>
            <button className="btn primary" onClick={() => void sync.syncNow()} disabled={sync.status === 'syncing'}>
              <RefreshCw size={18} /> 지금 동기화
            </button>
            <button className="btn" onClick={() => void sync.refetchApplications()}>
              <Download size={18} /> 신청목록 탭에서 빠진 신청 다시 받기
            </button>
          </>
        )}
        <a className="btn ghost" href={sheetUrl()} target="_blank" rel="noreferrer"><Link2 size={18} /> 시트 열기</a>
        {sync.signed && <button className="btn ghost danger" onClick={sync.disconnect}>연결 해제</button>}
      </div>
    </section>
  );
}

const PUBLIC_URL = `${typeof location !== 'undefined' ? location.origin : ''}${import.meta.env.BASE_URL}open/`;

function PublicLinkSection({ onToast }: { onToast: (m: string) => void }) {
  return (
    <section className="settings-sec no-auto-login">
      <h4>공개 신청 현황 링크</h4>
      <p className="muted small">다른 분들께 보여 줄 읽기 전용 페이지예요. 순번·성함·연락처 뒷 4자리·타이어 수량만 보이고 주소는 안 보여요. (공개 목록 파일을 갱신해야 내용이 바뀌어요)</p>
      <div className="public-link">{PUBLIC_URL}</div>
      <div className="stack">
        <button className="btn" onClick={async () => onToast((await copyText(PUBLIC_URL)) ? '공개 링크를 복사했어요' : '복사에 실패했어요')}>
          <Copy size={18} /> 공개 링크 복사
        </button>
        <a className="btn ghost" href={PUBLIC_URL} target="_blank" rel="noreferrer"><Link2 size={18} /> 공개 페이지 열기</a>
      </div>
    </section>
  );
}

function SettingsModal(props: { sync: Sync; onClose: () => void; onSaved: () => void; onToast: (m: string) => void; onBackup: () => void; onRestore: (o: Order[]) => void }) {
  const [t, setT] = useState<SmsTemplates>(() => getSmsTemplates());
  const [sampleTn, setSampleTn] = useState('');
  const restoreRef = useRef<HTMLInputElement>(null);

  return (
    <Modal title="설정" onClose={props.onClose}>
      <GoogleSection sync={props.sync} />
      <PublicLinkSection onToast={props.onToast} />
      <section className="settings-sec">
        <h4>문자 템플릿</h4>
        <p className="muted small">
          쓸 수 있는 자리표시: <code>{'{{이름}}'}</code> <code>{'{{수량}}'}</code> <code>{'{{주소}}'}</code> <code>{'{{송장번호}}'}</code> — 송장번호가 비어 있으면 「송장번호: …」 부분은 자동으로 빠져요.
        </p>
        {(['접수', '발송'] as SmsKind[]).map((k) => (
          <label key={k} className="tpl">
            <span>{k} 문자</span>
            <textarea rows={4} value={t[k]} onChange={(e) => setT({ ...t, [k]: e.target.value })} />
            <span className="preview">{fillTemplate(t[k] || DEFAULT_SMS[k], { ...SAMPLE, tracking: sampleTn })}</span>
          </label>
        ))}
        <label className="inline">
          미리보기 송장번호
          <input value={sampleTn} onChange={(e) => setSampleTn(e.target.value)} placeholder="비우면 송장 구절 제거" />
        </label>
        <div className="stack">
          <button className="btn primary" onClick={() => { setSmsTemplates(t); props.onSaved(); }}>
            <Check size={18} /> 템플릿 저장
          </button>
          <button className="btn ghost" onClick={() => { resetSmsTemplates(); setT({ ...DEFAULT_SMS }); props.onSaved(); }}>
            기본 문구로 되돌리기
          </button>
        </div>
      </section>

      <section className="settings-sec">
        <h4>백업 · 옮기기</h4>
        <p className="muted small">목록은 이 기기에도 저장돼요. 구글 시트에 연결하면 아이폰·맥이 시트로 함께 맞춰지고, 백업 파일은 시트 없이 옮길 때 쓰세요.</p>
        <div className="stack">
          <button className="btn" onClick={props.onBackup}><Download size={18} /> 백업 파일 저장 (.json)</button>
          <button className="btn" onClick={() => restoreRef.current?.click()}><Upload size={18} /> 백업 파일 불러오기</button>
          <input
            ref={restoreRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                const data = JSON.parse(await file.text()) as { orders?: unknown[]; templates?: SmsTemplates };
                if (!Array.isArray(data.orders)) throw new Error('형식 오류');
                if (!confirm(`백업의 ${data.orders.length}건으로 지금 목록을 바꿀까요?`)) return;
                if (data.templates) { setSmsTemplates(data.templates); setT(getSmsTemplates()); }
                props.onRestore(data.orders.map((o) => normalizeOrder(o as Order)));
              } catch {
                alert('백업 파일을 읽지 못했어요');
              }
            }}
          />
        </div>
      </section>
    </Modal>
  );
}
