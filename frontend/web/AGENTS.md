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
| `public/service-worker.js` | `vanilla-js-frontend` |
