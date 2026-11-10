import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// 공개 페이지는 일반 웹페이지 — 관리 앱 PWA 매니페스트 링크를 빼서 '홈 화면 앱'으로 설치되지 않게
const stripManifestFromOpen = {
  name: 'strip-manifest-from-open',
  enforce: 'post' as const,
  writeBundle(opts: { dir?: string }) {
    const f = resolve(opts.dir || 'dist', 'open/index.html');
    if (!existsSync(f)) return;
    writeFileSync(f, readFileSync(f, 'utf8').replace(/\s*<link rel="manifest"[^>]*>/g, ''));
  },
};

// 나중에 다른 주소(예: GitHub Pages 하위 경로)에 올릴 때는 base / start_url / scope 를 함께 바꾸세요.
const BASE = '/tire-tool-order-manager/';

export default defineConfig({
  base: BASE,
  // Google OAuth 는 http://localhost:5173 만 허용돼 있어서 개발·미리보기 모두 5173 포트 사용
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  // 관리 앱(index.html) + 공개 읽기 전용 페이지(open/index.html → …/open/)
  build: { rollupOptions: { input: { main: resolve(__dirname, 'index.html'), open: resolve(__dirname, 'open/index.html') } } },
  plugins: [
    react(),
    stripManifestFromOpen,
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        globIgnores: ['open/**'],
        // 공개 페이지(/open/)와 공개 목록 JSON 은 관리 앱 서비스워커가 가로채지 않음
        navigateFallbackDenylist: [/\/open\//],
      },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '타이어 공구 주문관리',
        short_name: '타이어 공구',
        description: '타이어 공동구매 신청 관리 · 문자 발송',
        theme_color: '#07090c',
        background_color: '#07090c',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'ko',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
