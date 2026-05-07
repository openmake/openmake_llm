---
name: vanilla-js-frontend
description: OpenMake LLM의 Vanilla JS 프론트엔드 패턴. ES 모듈, IIFE 컴포넌트, 중앙 상태 관리, XSS 방어 (sanitize.js), SPA Router, CSS Design Tokens, 캐시 버스터. frontend/web/ 디렉토리 작업 시 필수. Use when working with frontend JavaScript, CSS, components, pages, state management, or security.
---

# Vanilla JS Frontend Patterns — OpenMake LLM

프레임워크 없는 순수 JavaScript 프론트엔드의 아키텍처와 패턴.

## ⚠️ 핵심 규칙

**React, Vue, Angular 등 프레임워크 도입 절대 금지. Vanilla JS만 사용.**

## 디렉토리 구조

```
frontend/web/public/
├── app.js                    # 메인 앱 (WebSocket, Chat, Auth 초기화)
├── index.html                # SPA 엔트리 포인트
├── style.css                 # 글로벌 스타일
├── service-worker.js         # PWA 서비스 워커
├── manifest.json             # PWA 매니페스트
├── js/
│   ├── spa-router.js         # History API 기반 SPA 라우터
│   ├── main.js               # 모듈 초기화
│   ├── nav-items.js          # 네비게이션 설정
│   ├── modules/
│   │   ├── auth.js           # 인증 (authFetch, isLoggedIn)
│   │   ├── chat.js           # 채팅 모듈
│   │   ├── websocket.js      # WebSocket 관리
│   │   ├── state.js          # 중앙 상태 관리 (AppState)
│   │   ├── settings.js       # 설정
│   │   ├── ui.js             # UI 유틸리티
│   │   ├── utils.js          # 헬퍼 함수
│   │   ├── sanitize.js       # XSS 방어 (HTML sanitizer)
│   │   ├── guide.js          # 가이드 모듈
│   │   └── pages/            # 22개 페이지 모듈
│   │       ├── admin.js, canvas.js, research.js, ...
│   └── components/
│       ├── unified-sidebar.js # 3-State 사이드바 (IIFE)
│       ├── sidebar.js
│       ├── admin-panel.js
│       ├── install-prompt.js
│       └── offline-indicator.js
├── css/
│   ├── design-tokens.css     # 201개 CSS 변수 (컬러, 스페이싱, 타이포)
│   ├── light-theme.css       # 라이트 테마 오버라이드
│   ├── glassmorphism.css     # 글래스모피즘 스타일
│   ├── animations.css        # 애니메이션
│   ├── components.css        # 컴포넌트 스타일
│   ├── layout.css            # 레이아웃
│   └── pages/                # 페이지별 CSS
```

## 패턴 1: 컴포넌트 (IIFE + window 전역)

```javascript
// unified-sidebar.js — IIFE 패턴
(function () {
    'use strict';
    
    var STATES = { FULL: 'full', ICON: 'icon', HIDDEN: 'hidden' };
    
    function UnifiedSidebar() {
        // 내부 상태
        var state = STATES.FULL;
        
        function init() { /* DOM 생성 + 이벤트 바인딩 */ }
        function toggle() { /* 상태 전환 */ }
        
        return { init, toggle, getState: () => state };
    }
    
    window.UnifiedSidebar = UnifiedSidebar;
})();
```

## 패턴 2: 중앙 상태 관리 (state.js)

```javascript
const AppState = {
    ws: null, chatHistory: [], currentChatId: null,
    auth: { currentUser: null, authToken: null, isGuestMode: false },
    // ...
};

function getState(key) { /* 점 표기법 지원: 'auth.currentUser' */ }
function setState(key, value) { /* 리스너 알림 포함 */ }
function subscribe(key, callback) { /* 상태 변경 구독 */ }

export { getState, setState, subscribe };
```

## 패턴 3: XSS 방어 (sanitize.js) ⚠️ 필수

```javascript
// 모든 사용자 입력을 DOM에 삽입하기 전에 sanitize 필수!

import { sanitizeHTML, escapeHTML } from './sanitize.js';

// 안전한 HTML 렌더링 (Markdown 결과 등)
element.innerHTML = sanitizeHTML(userContent);

// 순수 텍스트 표시
element.textContent = escapeHTML(userInput);
```

**허용 태그**: p, br, b, i, em, strong, h1-h6, ul, ol, li, table, code, pre, a, img 등
**위험 URL 차단**: `javascript:`, `data:`, `vbscript:` 스킴 자동 차단

### innerHTML 사용 시 반드시 sanitize 거치기
```javascript
// ✅ 올바름
element.innerHTML = sanitizeHTML(markdownRendered);

// ❌ XSS 취약
element.innerHTML = userInput;
```

## 패턴 4: SPA Router (History API)

```javascript
// spa-router.js — History API 기반
window.Router = {
    navigate(path) { history.pushState(null, '', path); loadPage(path); },
    getCurrentPath() { return location.pathname; }
};

// 라우트 → 페이지 모듈 매핑
const ROUTES = {
    '/': () => import('./modules/pages/chat.js'),
    '/admin': () => import('./modules/pages/admin.js'),
    // ...
};
```

## 패턴 5: CSS Design Tokens

```css
/* design-tokens.css — 201개 변수 */
:root {
    /* Colors */
    --color-primary: #6366f1;
    --color-bg-primary: #0f0f23;
    --color-text-primary: #e2e8f0;
    
    /* Spacing */
    --spacing-xs: 4px;
    --spacing-sm: 8px;
    
    /* Typography */
    --font-family-base: 'Inter', sans-serif;
    --font-size-base: 14px;
    
    /* Shadows, Borders, etc. */
}
```

**규칙**: 하드코딩된 색상/간격 금지. 항상 CSS 변수 사용.

## 패턴 6: 캐시 버스터

```html
<!-- index.html -->
<script src="js/main.js?v=42"></script>
<link rel="stylesheet" href="css/design-tokens.css?v=42">
```

**규칙**: 파일 수정 시 HTML과 JS의 `?v=N` 동기화 필수.

## 패턴 7: 인증 (authFetch)

```javascript
// auth.js
async function authFetch(url, options = {}) {
    options.credentials = 'include';  // HttpOnly Cookie 자동 포함
    const res = await fetch(url, options);
    if (res.status === 401) { redirectToLogin(); }
    return res;
}
window.authFetch = authFetch;
window.isLoggedIn = () => !!getState('auth.currentUser');
```

## 코딩 규칙

| 규칙 | 상세 |
|------|------|
| **프레임워크 금지** | React, Vue, Angular, Svelte 등 절대 금지 |
| **번들러 금지** | Webpack, Vite, Rollup 등 미사용. `<script>` 직접 로드 |
| **innerHTML → sanitize** | 사용자/AI 콘텐츠는 반드시 `sanitizeHTML()` 거치기 |
| **CSS 변수** | 색상/간격/폰트는 design-tokens.css 변수만 사용 |
| **캐시 버스터** | 파일 수정 시 `?v=N` 동기화 |
| **인라인 이벤트 금지** | `onclick=""` 대신 JS에서 `addEventListener` |
| **전역 접근** | 컴포넌트는 `window.ComponentName`으로 등록 |
| **ES 모듈** | modules/ 내 파일은 `import/export` 사용 |

## 체크리스트

프론트엔드 수정 시:
- [ ] Vanilla JS만 사용 (프레임워크/번들러 도입 금지)
- [ ] 사용자 입력 → DOM 삽입 시 `sanitizeHTML()` / `escapeHTML()` 적용
- [ ] CSS 변수 사용 (하드코딩 금지)
- [ ] 캐시 버스터 `?v=N` 동기화
- [ ] 모바일 반응형 확인 (MOBILE_BREAKPOINT: 768px)
- [ ] Playwright E2E 테스트 통과
