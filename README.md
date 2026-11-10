# 타이어 공구 주문관리

네이버 폼으로 받은 타이어 공동구매 신청을 신청 순서대로 관리하고, 휴대폰 문자 앱으로 접수/발송 문자를 보내는 모바일 우선 PWA.

- 개발: `npm install && npm run dev`
- 빌드: `npm run build` → `dist/`
- 미리보기: `npm run preview` → http://localhost:5173/tire-tool-order-manager/ (Google OAuth 허용 주소)
- 배포: `main` 에 push 하면 GitHub Actions 가 GitHub Pages 로 배포 → https://lcnrrn.github.io/tire-tool-order-manager/

데이터는 브라우저 localStorage(`tire-tool-om-*`)에 저장됩니다. 처음엔 빈 목록이며, 구글 시트에 연결하면 `Orders` 탭(없으면 `신청목록` 탭에서 복사)을 불러옵니다. 고객 개인정보는 코드에 넣지 않습니다.
다른 기기로 옮길 때는 설정 → 백업 파일 저장/불러오기를 사용하세요.
배포 경로는 `vite.config.ts` 의 `BASE` (현재 `/tire-tool-order-manager/`).
