import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// 나중에 다른 주소(예: GitHub Pages 하위 경로)에 올릴 때는 base / start_url / scope 를 함께 바꾸세요.
const BASE = '/tire-tool-order-manager/';

export default defineConfig({
  base: BASE,
  // Google OAuth 는 http://localhost:5173 만 허용돼 있어서 개발·미리보기 모두 5173 포트 사용
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
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
