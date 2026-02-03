# Frontend (Vanilla JS) — AI Skill Guide

> 이 파일은 `frontend/web/` 작업 시 AI 에이전트가 참조하는 스킬 가이드입니다.

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

## Primary Skills (항상 참고)

| Skill | When |
|-------|------|
| `@frontend-components-standards` | 재사용 가능 컴포넌트 설계 |
| `@frontend-css-standards` | CSS 방법론, 토큰, 네이밍 |
| `@frontend-accessibility-standards` | WCAG 접근성, ARIA, 키보드 |
| `@frontend-responsive-design-standards` | 반응형, 모바일 퍼스트 |
| `@frontend-design` | 고품질 UI 인터페이스 |

## JavaScript Skills

| Skill | When |
|-------|------|
| `@modern-javascript-patterns` | ES6+ (async/await, destructuring, spread) |
| `@javascript-mastery` | JS 33개 핵심 개념 |
| `@clean-code` | 읽기 좋은 코드 작성 |
| `@state-management` | 프론트엔드 상태 관리 전략 |

## UI/UX Skills

| Skill | When |
|-------|------|
| `@frontend-design` | UI 디자인 원칙, 타이포그래피, 색상 |
| `@web-design-guidelines` | 웹 디자인 가이드라인 |
| `@i18n-localization` | 다국어 지원, 한국어/영어 전환 |
| `@scroll-experience` | 스크롤 기반 인터랙션 |
| `@canvas-design` | Canvas/SVG 비주얼 디자인 |

## Testing Skills

| Skill | When |
|-------|------|
| `@playwright-testing` | E2E 테스트, 브라우저 자동화 |
| `@testing-frontend` | 프론트엔드 테스팅 패턴 |
| `@e2e-testing-patterns` | Playwright/Cypress 패턴 |
| `@testing-anti-patterns` | 테스트 안티패턴 방지 |

## Security Skills

| Skill | When |
|-------|------|
| `@frontend-security-coder` | XSS, CSRF 방어 |
| `@software-security-appsec` | OWASP 프론트엔드 보안 |

## Performance Skills

| Skill | When |
|-------|------|
| `@web-performance-optimization` | 로딩 속도, Core Web Vitals |
| `@performance-analysis` | 병목 식별, 프로파일링 |

## File → Skill Mapping

| File(s) | Primary Skill |
|---------|---------------|
| `public/app.js` | `@modern-javascript-patterns` |
| `public/style.css` | `@frontend-css-standards` |
| `public/css/design-tokens.css` | `@frontend-css-standards` |
| `public/css/light-theme.css` | `@frontend-css-standards` |
| `public/index.html` | `@frontend-accessibility-standards` |
| `public/js/components/` | `@frontend-components-standards` |
| `public/js/components/unified-sidebar.js` | `@frontend-components-standards` |
