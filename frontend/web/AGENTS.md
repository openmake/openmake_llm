# Frontend (Vanilla JS) — AI Skill Guide

> 이 파일은 `frontend/web/` 작업 시 AI 에이전트가 참조하는 스킬 가이드입니다.
> 모든 `@skill` 참조는 `.claude/skills/` 또는 OpenCode 에 설치된 실제 스킬입니다.

## Tech Context

- **Framework**: Vanilla JavaScript (React/Vue/Angular 등 프레임워크 추가 금지)
- **Styling**: CSS (design-tokens.css + style.css + light-theme.css)
- **Build**: 번들러 없음, 직접 로드 (`<script>`, `<link>`)
- **E2E**: Playwright

## Coding Rules

1. Vanilla JS만 사용 — React, Vue 등 프레임워크 금지
2. CSS 변수는 `css/design-tokens.css`에서 관리
3. 캐시 버스터 (`?v=N`) 사용 시 HTML과 JS 파일 동기화 필수
4. 인라인 `onclick` 대신 JS에서 동적 바인딩

## Installed Skills Reference

### Project Skills (`.claude/skills/`)

| Skill | Directory | Domain |
|-------|-----------|--------|
| `vanilla-js-frontend` | `.claude/skills/vanilla-js-frontend/` | IIFE 컴포넌트, AppState, sanitizeHTML, SPA 라우터, 디자인 토큰 |

### OpenCode Skills (Built-in & Installed)

| Skill | Domain |
|-------|--------|
| `frontend-ui-ux` | 디자인 목업 없이 고품질 UI/UX 구현 |
| `dev-browser` | 브라우저 자동화 — 네비게이션, 폼 입력, 스크린샷 |
| `code-review-expert` | 코드 리뷰 — 품질, 보안, 성능, 유지보수성 |
| `insecure-defaults` | XSS, CSRF 등 프론트엔드 보안 감사 |
| `verification-before-completion` | 작업 완료 전 빌드/테스트 확인 |
| `test-driven-development` | TDD Red-Green-Refactor 사이클 |
| `systematic-debugging` | 버그, 테스트 실패 시 체계적 디버깅 |

## Skill Usage Guide

### Primary Skills (항상 참고)

| Skill | When |
|-------|------|
| `vanilla-js-frontend` | 컴포넌트 설계, IIFE 패턴, AppState 관리, sanitizeHTML XSS 방어, CSS 디자인 토큰 |
| `frontend-ui-ux` | UI 디자인 원칙, 타이포그래피, 색상, 반응형, 접근성 |

### JavaScript & State

| Skill | When |
|-------|------|
| `vanilla-js-frontend` | ES6+ 패턴, IIFE 컴포넌트, `window.*` 글로벌 등록, 중앙 AppState (`state.js`) |

### UI/UX & Design

| Skill | When |
|-------|------|
| `frontend-ui-ux` | UI 디자인, 타이포그래피, 색상 체계, 반응형, 모바일 퍼스트, 접근성 |
| `vanilla-js-frontend` | CSS 변수 (`design-tokens.css`), glassmorphism, 애니메이션 |

### Testing

| Skill | When |
|-------|------|
| `dev-browser` | E2E 테스트, Playwright 브라우저 자동화 |
| `test-driven-development` | TDD 사이클, 프론트엔드 테스팅 패턴 |
| `systematic-debugging` | Flaky 테스트, 디버깅 |

### Security

| Skill | When |
|-------|------|
| `vanilla-js-frontend` | XSS 방어 (`sanitizeHTML`), innerHTML 안전 사용 |
| `insecure-defaults` | OWASP 프론트엔드 보안, CSRF 방어 |

### Performance

| Skill | When |
|-------|------|
| `vanilla-js-frontend` | 번들 없는 로딩 최적화, 캐시 버스터 동기화 |

## File → Skill Mapping

| File(s) | Primary Skill |
|---------|---------------|
| `public/app.js` | `vanilla-js-frontend` |
| `public/style.css` | `vanilla-js-frontend` |
| `public/css/design-tokens.css` | `vanilla-js-frontend` |
| `public/css/light-theme.css` | `vanilla-js-frontend` |
| `public/index.html` | `frontend-ui-ux` |
| `public/js/components/` | `vanilla-js-frontend` |
| `public/js/components/unified-sidebar.js` | `vanilla-js-frontend` |
| `public/js/modules/sanitize.js` | `vanilla-js-frontend` |
| `public/js/modules/state.js` | `vanilla-js-frontend` |
| `public/js/spa-router.js` | `vanilla-js-frontend` |
| `public/js/modules/pages/*.js` | `vanilla-js-frontend` |

---

## MCP 토글 시스템 (프론트엔드 찡임 범위)

> 전체 MCP 아키텍처 도해는 `backend/api/AGENTS.md` → "MCP 통합 아키텍처" 섹션 참조.

### 프론트엔드 MCP 관련 파일

| 파일 | 역할 |
|------|------|
| `js/modules/settings.js` | `MCP_TOOL_CATALOG` 정의, `loadMCPSettings`, `saveMCPSettings`, `toggleMCPModule` |
| `js/modules/pages/settings.js` | 설정 전용 페이지 `toolCatalog` (백엔드 `builtInTools`와 동기화 필수) |
| `js/modules/state.js` | `thinkingEnabled`, `webSearchEnabled`, `ragEnabled`, `mcpToolsEnabled` 상태 |
| `js/modules/modes.js` | 채팅 입력창 토글 버튼 (🧠 🌐 🎯 🔬) → AppState 직접 토글 |
| `js/modules/chat.js` | `sendMessage()` — AppState → WebSocket 페이로드 조립 |
| `js/modules/websocket.js` | WebSocket 연결 관리, 수신 메시지 라우팅 |
| `js/settings-standalone.js` | `settings.html` 전용 독립 JS (인라인 스크립트에서 추출) |

### 토글 상태 키 맵핑

| AppState 키 | localStorage 키 | 채팅 입력창 버튼 | WS 페이로드 키 |
|-------------|-----------------|------------------|-----------------|
| `thinkingEnabled` | `mcpSettings.thinking` | 🧠 `thinkingModeBtn` | `thinkingMode` |
| `webSearchEnabled` | `mcpSettings.webSearch` + `mcpSettings.enabledTools.web_search` | 🌐 `webSearchBtn` | `webSearch` |
| `ragEnabled` | `mcpSettings.rag` | (설정 페이지만) | `ragEnabled` |
| `discussionMode` | (비저장) | 🎯 `discussionModeBtn` | `discussionMode` |
| `deepResearchMode` | (비저장) | 🔬 `deepResearchBtn` | `deepResearchMode` |
| `mcpToolsEnabled` | `mcpSettings.enabledTools` | (설정 페이지만) | `enabledTools` |

### 수정 시 주의사항

1. **도구 목록 변경 시 2곳 동시 수정** — `settings.js`의 `MCP_TOOL_CATALOG`과 `pages/settings.js`의 `toolCatalog` 동기화 필수
2. **상태 키 `thinkingEnabled` 단일 사용** — `thinkingMode` 키는 삭제됨. 설정과 채팅 모두 `thinkingEnabled` 사용
3. **localStorage `mcpSettings` 단일 키** — MCP 토글 상태 저장에 이 키만 사용 (키 충돌 방지)
4. **WS 페이로드 `thinkingMode` 키는 유지** — 백엔드가 이 이름을 기대하므로 변경 금지. 값만 `thinkingEnabled`에서 읽음
5. **🌐 웹 검색 양방향 동기화** — `webSearchEnabled`와 `mcpToolsEnabled.web_search`는 `syncWebSearchState()` 함수로 양방향 동기화됨. 어느 한쪽을 변경하면 다른 쪽도 자동 반영. 채팅 🌐 버튼, 설정 페이지 웹검색 토글, MCP 도구 목록의 `web_search` 토글 모두 동일한 상태를 공유
