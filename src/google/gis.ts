import { getClientId, SHEETS_SCOPE } from './config';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

let gisLoadPromise: Promise<void> | null = null;

export function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('GIS 스크립트 로드 실패')));
      if (window.google?.accounts?.oauth2) resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoadPromise = null;
      reject(new Error('Google Identity Services 스크립트를 불러오지 못했습니다.'));
    };
    document.head.appendChild(script);
  });

  return gisLoadPromise;
}

const LS_TOKEN = 'tire-tool-om-google-token-v1';

/** 저장된 액세스 토큰 (만료 60초 전까지만 유효로 봄) */
export function getStoredToken(): string | null {
  try {
    const raw = localStorage.getItem(LS_TOKEN);
    if (!raw) return null;
    const t = JSON.parse(raw) as { token?: string; exp?: number };
    if (t.token && typeof t.exp === 'number' && t.exp - 60_000 > Date.now()) return t.token;
  } catch {
    /* ignore */
  }
  return null;
}

export function storedTokenExpiry(): number {
  try {
    const t = JSON.parse(localStorage.getItem(LS_TOKEN) || '{}') as { exp?: number };
    return typeof t.exp === 'number' ? t.exp : 0;
  } catch {
    return 0;
  }
}

function storeToken(token: string, expiresIn?: number): void {
  try {
    localStorage.setItem(LS_TOKEN, JSON.stringify({ token, exp: Date.now() + (expiresIn || 3600) * 1000 }));
  } catch {
    /* ignore */
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(LS_TOKEN);
  } catch {
    /* ignore */
  }
}

/**
 * 토큰 요청. GIS가 이미 로드돼 있으면 await 없이 바로(동기적으로) 팝업을 열어
 * 사용자 탭(제스처) 안에서 실행되도록 함 — Safari/iOS 팝업 차단 회피.
 */
export function requestAccessToken(opts?: {
  prompt?: '' | 'none' | 'consent' | 'select_account';
  hint?: string | null;
}): Promise<string> {
  const clientId = getClientId();
  if (!clientId) {
    return Promise.reject(new Error('Google Client ID가 없습니다. 설정에서 Client ID를 입력해 주세요.'));
  }
  const run = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (!oauth2) {
        reject(new Error('Google 로그인 라이브러리를 사용할 수 없습니다.'));
        return;
      }
      const hint = opts?.hint || undefined;
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope: SHEETS_SCOPE,
        ...(hint ? { login_hint: hint, hint } : {}),
        callback: (response) => {
          if (response.error) {
            reject(new Error(response.error_description || response.error || 'Google 인증에 실패했습니다.'));
            return;
          }
          if (!response.access_token) {
            reject(new Error('액세스 토큰을 받지 못했습니다.'));
            return;
          }
          storeToken(response.access_token, response.expires_in);
          resolve(response.access_token);
        },
        error_callback: (err) => {
          reject(new Error(err.message || err.type || 'Google 인증이 취소되었습니다.'));
        },
      });
      client.requestAccessToken({ prompt: opts?.prompt ?? 'consent', ...(hint ? { login_hint: hint, hint } : {}) });
    });
  if (window.google?.accounts?.oauth2) return run();
  return loadGisScript().then(run);
}

export function revokeAccessToken(token: string): void {
  clearStoredToken();
  try {
    window.google?.accounts?.oauth2?.revoke(token);
  } catch {
    /* ignore */
  }
}

/** Decode email from access token via tokeninfo (best-effort). */
export async function fetchTokenEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return data.email || null;
  } catch {
    return null;
  }
}
