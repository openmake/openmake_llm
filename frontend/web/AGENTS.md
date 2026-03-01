# Frontend (Vanilla JS) — AI Skill Guide

> 이 파일은 `frontend/web/` 작업 시 AI 에이전트가 참조하는 스킬 가이드입니다.
> 모든 `@skill` 참조는 `.claude/skills/` 또는 OpenCode 에 설치된 실제 스킬입니다.

## Tech Context

- **Framework**: Vanilla JavaScript (React/Vue/Angular 등 프레임워크 추가 금지)
- **Styling**: CSS (design-tokens.css + style.css + light-theme.css)
- **Build**: 번들러 없음, ES Module (`<script type="module">`) 직접 로드 + `scripts/validate-modules.sh` 정합성 검증
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
| `vanilla-js-frontend` | ES Module 패턴, `export default` 페이지 모듈, `window.*` 글로벌 등록, 중앙 AppState (`state.js`) |

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
| `js/modules/settings.js` | `MCP_TOOL_CATALOG` (6카테고리 15도구) 마스터 정의, `VIRTUAL_TOOL_MAP`, `loadMCPSettings`, `saveMCPSettings`, `toggleMCPTool`, `setAllMCPTools`, 양방향 동기화 함수들 |
| `js/modules/pages/settings.js` | 설정 전용 페이지 — `window.MCP_TOOL_CATALOG` 참조 (자체 카탈로그 없음), `window.toggleMCPTool`/`window.setAllMCPTools` 위임 |
| `js/modules/state.js` | `thinkingEnabled`, `webSearchEnabled`, `ragEnabled`, `discussionMode`, `deepResearchMode`, `mcpToolsEnabled` 상태 |
| `js/modules/modes.js` | 채팅 입력창 토글 버튼 (🧠 🌐 🎯 🔬) → AppState + `enabledTools` 양방향 동기화 + `saveMCPSettings()` |
| `js/modules/chat.js` | `sendMessage()` — AppState → WebSocket 페이로드 조립 |
| `js/modules/websocket.js` | WebSocket 연결 관리, 수신 메시지 라우팅 |
| `js/settings-standalone.js` | `settings.html` 전용 독립 JS (인라인 스크립트에서 추출) |

### 토글 상태 키 맵핑

| AppState 키 | localStorage 키 | 채팅 입력창 버튼 | WS 페이로드 키 | 기본값 |
|-------------|-----------------|------------------|-----------------|--------|
| `thinkingEnabled` | `mcpSettings.enabledTools.sequential_thinking` | 🧠 `thinkingModeBtn` | `thinkingMode` | `true` |
| `webSearchEnabled` | `mcpSettings.enabledTools.web_search` | 🌐 `webSearchBtn` | `webSearch` | `false` |
| `ragEnabled` | `mcpSettings.enabledTools.rag` | (없음) | `ragEnabled` | `false` |
| `discussionMode` | `mcpSettings.enabledTools.discussion_mode` | 🎯 `discussionModeBtn` | `discussionMode` | `false` |
| `deepResearchMode` | `mcpSettings.enabledTools.deep_research` | 🔬 `deepResearchBtn` | `deepResearchMode` | `false` |
| `mcpToolsEnabled` | `mcpSettings.enabledTools` | (설정 페이지만) | `enabledTools` | `{}` |

### 수정 시 주의사항

1. **도구 목록은 `settings.js`의 `MCP_TOOL_CATALOG` 단일 소스** — `pages/settings.js`는 `window.MCP_TOOL_CATALOG`을 참조하므로 별도 수정 불필요
2. **상태 키 `thinkingEnabled` 단일 사용** — `thinkingMode` 키는 삭제됨. 설정과 채팅 모두 `thinkingEnabled` 사용
3. **localStorage `mcpSettings` 단일 키** — MCP 토글 상태 저장에 이 키만 사용 (키 충돌 방지)
4. **WS 페이로드 `thinkingMode` 키는 유지** — 백엔드가 이 이름을 기대하므로 변경 금지. 값만 `thinkingEnabled`에서 읽음
5. **모든 가상 도구 양방향 동기화** — `VIRTUAL_TOOL_MAP`이 `sequential_thinking`, `web_search`, `discussion_mode`, `deep_research`, `rag` 5개 가상 도구의 AppState ↔ `enabledTools` ↔ 채팅 버튼 동기화를 관리. `modes.js`의 토글 함수와 `settings.js`의 `toggleMCPTool()` 양쪽 모두 `enabledTools` + `saveMCPSettings()` 호출
6. **AI 모델 설정 섹션에 토글 없음** — Sequential Thinking, 웹 검색, RAG 토글은 MCP 도구 섹션으로 통합됨. AI 모델 카드는 모델 선택 드롭다운만 포함

---

## ES Module 아키텍처 (전면 전환 완료)

### 로딩 방식
- **모든 `<script>` 태그는 `type="module"` 필수** (vendor UMD 제외: `chart.umd.min.js` 등)
- **SPA Router**: `import()` 동적 로딩으로 페이지 모듈 로드 (`loadModule()` 함수)
- **페이지 모듈**: `export default { getHTML, init, cleanup }` 패턴 사용
- **빌드 검증**: `scripts/validate-modules.sh`가 정합성 자동 검증

### 파일 유형별 규칙

| 파일 유형 | 패턴 | export 사용 | import 사용 |
|-----------|------|------------|------------|
| `js/modules/*.js` (ES Module) | export + window.* | ✅ 필수 | ✅ 가능 |
| `js/modules/pages/*.js` (페이지 모듈) | export default | ✅ 필수 | ❌ 금지 (window.* 사용) |
| `js/components/*.js` (컴포넌트) | export + window.* | ✅ 필수 | ✅ 가능 |
| `js/spa-router.js` | export + window.* | ✅ | ✅ |
| Vendor (`js/vendor/*.js`) | UMD/classic | ❌ | ❌ |
| HTML inline `<script type="module">` | window.* for onclick | ❌ | ❌ |

### onclick 핸들러와 window.* 규칙
HTML의 `onclick="funcName()"` 속성은 전역 스코프에서 실행됩니다.
모듈 내 함수는 `window.funcName = funcName;`으로 명시적 노출이 필요합니다.
페이지 모듈의 `getHTML()` 반환 HTML에 onclick이 있으면 반드시 `window.*` 등록 필수.
