import { useCallback, useEffect, useRef, useState } from 'react';
import type { Order } from '../types';
import { getClientId, getSheetId, hasGoogleConfig } from '../google/config';
import { clearStoredToken, fetchTokenEmail, getStoredToken, loadGisScript, requestAccessToken, revokeAccessToken } from '../google/gis';
import { ordersFingerprint, pullMergePush, pullMissingApplications } from '../google/syncCore';
import { isAuthError, isQuotaError } from '../google/sheets';

const LS_SIGNED = 'tire-tool-om-google-signed';
const LS_EMAIL = 'tire-tool-om-google-email';
const LS_DIRTY = 'tire-tool-om-sync-dirty';
const LS_LAST_SYNC = 'tire-tool-om-last-sync';
const DEBOUNCE_MS = 2000;
const POLL_MS = 60000;
const SOFT_SKIP_MS = 15000;
const TIMEOUT_MS = 25000;
const RETRY_DELAYS_MS = [5000, 15000, 30000, 60000];

export type SyncStatus = 'idle' | 'connecting' | 'syncing' | 'retrying' | 'error';

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

export function useGoogleSync({ orders, replaceOrders, onToast }: { orders: Order[]; replaceOrders: (o: Order[]) => void; onToast: (m: string) => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(() => lsGet(LS_EMAIL));
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number>(() => Number(lsGet(LS_LAST_SYNC)) || 0);
  const [dirty, setDirty] = useState<boolean>(() => Boolean(lsGet(LS_DIRTY)));
  const [signed, setSigned] = useState<boolean>(() => lsGet(LS_SIGNED) === '1');

  const tokenRef = useRef<string | null>(null);
  const ordersRef = useRef(orders);
  const syncedFpRef = useRef<string | null>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const debounceRef = useRef<number | null>(null);
  const retryRef = useRef<{ n: number; timer: number | null }>({ n: 0, timer: null });
  const lastDoneRef = useRef(0);
  const replaceRef = useRef(replaceOrders);
  const toastRef = useRef(onToast);
  const reconnectingRef = useRef(false);
  replaceRef.current = replaceOrders;
  toastRef.current = onToast;

  const dropToken = useCallback((msg: string) => {
    clearStoredToken();
    tokenRef.current = null;
    setToken(null);
    setLastError(msg);
    setStatus('error');
  }, []);

  const syncOnce = useCallback((reason: 'open' | 'edit' | 'poll' | 'manual', toastMsg?: string): Promise<boolean> => {
    const run = async (): Promise<boolean> => {
      const t = tokenRef.current;
      if (!t) return false;
      if (!navigator.onLine) {
        setLastError('오프라인 — 연결되면 자동 저장');
        setStatus('error');
        return false;
      }
      if (reason !== 'poll') setStatus('syncing');
      const startedDirty = lsGet(LS_DIRTY);
      const local = ordersRef.current;
      try {
        let timer = 0;
        const res = await Promise.race([
          pullMergePush(t, local),
          new Promise<never>((_, rej) => {
            timer = window.setTimeout(() => rej(new Error('응답이 너무 늦어요 (시간 초과)')), TIMEOUT_MS);
          }),
        ]).finally(() => window.clearTimeout(timer));
        const fp = ordersFingerprint(res.merged);
        // 받는 동안 또 고쳤으면 덮지 않고 다음 회차에 올림
        if (ordersRef.current === local && fp !== ordersFingerprint(local)) {
          ordersRef.current = res.merged;
          replaceRef.current(res.merged);
        }
        syncedFpRef.current = fp;
        if (lsGet(LS_DIRTY) === startedDirty && ordersFingerprint(ordersRef.current) === fp) {
          lsSet(LS_DIRTY, null);
          setDirty(false);
        }
        const now = Date.now();
        lastDoneRef.current = now;
        retryRef.current.n = 0;
        lsSet(LS_LAST_SYNC, String(now));
        setLastSyncAt(now);
        setLastError(null);
        setStatus('idle');
        if (res.seeded) toastRef.current(`시트 「신청목록」에서 ${res.seeded}건을 가져왔어요`);
        else if (toastMsg) toastRef.current(toastMsg);
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : '동기화 실패';
        if (isAuthError(msg)) {
          dropToken('구글 로그인 만료 — 화면을 탭하면 다시 연결해요');
        } else if (isQuotaError(msg)) {
          const n = retryRef.current.n++;
          const delay = RETRY_DELAYS_MS[Math.min(n, RETRY_DELAYS_MS.length - 1)];
          setLastError('구글 시트가 잠깐 바빠서 곧 다시 저장할게요');
          setStatus('retrying');
          if (retryRef.current.timer) window.clearTimeout(retryRef.current.timer);
          retryRef.current.timer = window.setTimeout(() => {
            retryRef.current.timer = null;
            void syncOnce('edit');
          }, delay);
        } else {
          setLastError(msg);
          setStatus('error');
          if (reason !== 'poll') toastRef.current(`동기화 실패: ${msg}`);
        }
        return false;
      }
    };
    const p = queueRef.current.then(run, run);
    queueRef.current = p.catch(() => undefined);
    return p;
  }, [dropToken]);

  // 로컬 수정 감지 → 표시 + 2초 뒤 저장
  useEffect(() => {
    ordersRef.current = orders;
    if (!signed) return;
    const fp = ordersFingerprint(orders);
    if (syncedFpRef.current === null || fp === syncedFpRef.current) return;
    lsSet(LS_DIRTY, lsGet(LS_DIRTY) || String(Date.now()));
    setDirty(true);
    if (!tokenRef.current) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void syncOnce('edit');
    }, DEBOUNCE_MS);
  }, [orders, signed, syncOnce]);

  const adoptToken = useCallback(async (t: string, toastMsg: string) => {
    tokenRef.current = t;
    setToken(t);
    lsSet(LS_SIGNED, '1');
    setSigned(true);
    if (!lsGet(LS_EMAIL)) {
      const mail = await fetchTokenEmail(t);
      if (mail) {
        setEmail(mail);
        lsSet(LS_EMAIL, mail);
      }
    }
    return syncOnce('open', toastMsg);
  }, [syncOnce]);

  const connect = useCallback(async () => {
    if (!getClientId() || !getSheetId()) {
      toastRef.current('Client ID와 Sheet ID를 입력해 주세요');
      return false;
    }
    setStatus('connecting');
    setLastError(null);
    try {
      const t = await requestAccessToken({ prompt: 'consent' });
      const mail = await fetchTokenEmail(t);
      if (mail) {
        setEmail(mail);
        lsSet(LS_EMAIL, mail);
      }
      return await adoptToken(t, '구글 시트 연결됨');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '연결 실패';
      setLastError(msg);
      setStatus('error');
      toastRef.current(msg);
      return false;
    }
  }, [adoptToken]);

  const reconnect = useCallback(async () => {
    if (reconnectingRef.current) return false;
    reconnectingRef.current = true;
    setStatus('connecting');
    try {
      const t = await requestAccessToken({ prompt: '', hint: lsGet(LS_EMAIL) });
      return await adoptToken(t, '다시 연결됨');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '재연결 실패';
      setLastError(msg);
      setStatus('error');
      return false;
    } finally {
      reconnectingRef.current = false;
    }
  }, [adoptToken]);

  const disconnect = useCallback(() => {
    const t = tokenRef.current;
    if (t) revokeAccessToken(t);
    tokenRef.current = null;
    setToken(null);
    setEmail(null);
    setSigned(false);
    lsSet(LS_SIGNED, null);
    lsSet(LS_EMAIL, null);
    setStatus('idle');
    setLastError(null);
    toastRef.current('구글 시트 연결을 해제했어요 (이 기기 목록은 그대로)');
  }, []);

  const syncNow = useCallback(async () => {
    if (!tokenRef.current) return signed ? reconnect() : connect();
    return syncOnce('manual', '동기화 완료');
  }, [signed, reconnect, connect, syncOnce]);

  /** 「신청목록」 탭에서 Orders 에 빠진 신청만 다시 가져오기 */
  const refetchApplications = useCallback(async () => {
    const t = tokenRef.current;
    if (!t) {
      toastRef.current('먼저 구글 시트에 연결해 주세요');
      return;
    }
    setStatus('syncing');
    try {
      await queueRef.current;
      const n = await pullMissingApplications(t, ordersRef.current);
      await syncOnce('manual', n ? `신청목록에서 ${n}건을 새로 가져왔어요` : '신청목록에 새로 가져올 신청이 없어요');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '가져오기 실패';
      setLastError(msg);
      setStatus('error');
      toastRef.current(msg);
    }
  }, [syncOnce]);

  // 시작: 저장된 토큰이 있으면 바로 동기화
  useEffect(() => {
    if (lsGet(LS_SIGNED) !== '1' || !hasGoogleConfig()) return;
    void loadGisScript().catch(() => undefined);
    const st = getStoredToken();
    if (st) void adoptToken(st, '');
    else {
      setLastError('구글 로그인 만료 — 화면을 탭하면 다시 연결해요');
      setStatus('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 토큰 만료: 첫 탭에서 재연결 (iOS 는 탭 안에서만 팝업 허용)
  useEffect(() => {
    if (!signed || token) return;
    const onTap = (ev: MouseEvent) => {
      if ((ev.target as HTMLElement | null)?.closest?.('.no-auto-login')) return;
      void reconnect();
    };
    document.addEventListener('click', onTap, { capture: true, once: true });
    return () => document.removeEventListener('click', onTap, { capture: true });
  }, [signed, token, reconnect]);

  // 주기 확인 + 앱으로 돌아올 때
  useEffect(() => {
    if (!token) return;
    const soft = () => {
      if (Date.now() - lastDoneRef.current < SOFT_SKIP_MS) return;
      if (!getStoredToken()) return dropToken('구글 로그인 만료 — 화면을 탭하면 다시 연결해요');
      void syncOnce('poll');
    };
    const id = window.setInterval(soft, POLL_MS);
    const onVis = () => document.visibilityState === 'visible' && soft();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', soft);
    // 닫기 직전 남은 저장
    const onHide = () => {
      if (document.visibilityState === 'hidden' && debounceRef.current) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
        void syncOnce('edit');
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('online', soft);
    };
  }, [token, syncOnce, dropToken]);

  return { connected: Boolean(token), signed, email, status, lastError, lastSyncAt, dirty, connect, disconnect, syncNow, refetchApplications };
}
