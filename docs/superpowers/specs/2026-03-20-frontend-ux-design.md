# Frontend UX Design Spec — AI Status Toast, Mobile FAB, CSS Unification

**Date:** 2026-03-20
**Status:** Approved
**Scope:** Frontend UI/UX improvements for OpenMake LLM

---

## 1. Overview

세 가지 독립적 프론트엔드 개선을 구현한다:

1. **AI 실행 상태 플로팅 토스트** — 기존 `agentBadge` 영역을 확장해 스트리밍 응답 중 에이전트 정보를 풍부하게 표시
2. **모바일 FAB 메뉴** — 480px 이하 화면에서 우하단 플로팅 액션 버튼으로 `mobileMenuBtn` 대체
3. **CSS 변수 완전 통합** — `design-tokens.css` 단일 진실 원본화, `style.css`와 `animations.css`의 중복 `:root` 블록 제거

---

## 2. AI 실행 상태 플로팅 토스트

### 2.1 목적

현재 스트리밍 응답 중 `agentBadge`가 에이전트 이름과 이유를 작은 배지 형태로만 표시한다. 이를 플로팅 토스트 형태로 확장해 단계 정보와 예상 시간까지 표시한다.

### 2.2 기존 인프라 활용

백엔드는 이미 `agent_selected` 이벤트를 전송한다:

```json
{
  "type": "agent_selected",
  "agent": {
    "type": "coding",
    "name": "코딩 에이전트",
    "emoji": "⚡",
    "phase": "planning",
    "reason": "code-gen 분류 (신뢰도 94%)",
    "confidence": 0.94
  }
}
```

이벤트 흐름: WebSocket → `websocket.js handleMessage()` → `window.showAgentBadge(data.agent)` → `cluster.js showAgentBadge()`

**새 이벤트 타입 추가 없음.** 기존 `agent_selected` 이벤트와 `showAgentBadge()` 함수를 확장한다.

### 2.3 DOM 구조 (기존)

`index.html:126-128`:
```html
<div class="input-container">
    <div id="agentBadge" style="display: none;"></div>
    <div class="chat-input-container">...</div>
</div>
```

`agentBadge` div는 이미 입력창 위에 위치한다. 이 div의 내용물(innerHTML)을 교체한다. 별도 DOM 요소 추가 없음.

### 2.4 표시 내용

`agent.phase` 값에 따라 단계 정보를 파생한다:

| phase 값 | 단계 레이블 | 예상 시간 |
|----------|-------------|-----------|
| `planning` | 분석 중... | ~5s |
| `build` | 생성 중... | ~10s |
| `optimization` | 최적화 중... | ~3s |
| `undefined` | 처리 중... | — |

표시 형식:
```
⚡ 코딩 에이전트   분석 중...   신뢰도 94%
```

- `agent.emoji` + `agent.name` + 단계 레이블 + 신뢰도(`agent.confidence * 100`%, 소수점 없음)
- `agent.reason`은 두 번째 줄로 작게 표시 (`agent.reason`이 빈 문자열이거나 `undefined`이면 생략)

### 2.5 구현 대상

**수정 파일**: `frontend/web/public/js/modules/cluster.js`

`showAgentBadge(agent)` 함수(라인 174~)의 `badgeContainer.innerHTML` 부분을 교체:

```javascript
// 기존: 작은 배지 형태
// 변경: 플로팅 토스트 형태

const phaseLabels = { planning: '분석 중...', build: '생성 중...', optimization: '최적화 중...' };
const phaseStep = phaseLabels[agent.phase] || '처리 중...';
const confidence = agent.confidence ? `신뢰도 ${Math.round(agent.confidence * 100)}%` : '';

badgeContainer.innerHTML = `
    <div class="agent-status-toast">
        <span class="toast-agent-icon">${escapeHtml(agent.emoji || '🤖')}</span>
        <span class="toast-agent-name">${escapeHtml(agent.name || '에이전트')}</span>
        <span class="toast-step">${phaseStep}</span>
        ${confidence ? `<span class="toast-confidence">${confidence}</span>` : ''}
    </div>
`;
badgeContainer.style.display = 'block';
```

**신규 파일**: `frontend/web/public/css/chat-status-toast.css`

토스트 CSS:
```css
.agent-status-toast {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    margin: 4px 0;
    background: rgba(192, 97, 255, 0.1);
    border: 1.5px solid var(--accent-primary);
    border-radius: 6px;
    font-size: 0.85rem;
    animation: toastFadeIn 150ms ease-out;
}
.toast-agent-icon { font-size: 1rem; }
.toast-agent-name { font-weight: 700; color: var(--accent-primary); }
.toast-step { color: var(--text-secondary); }
.toast-confidence { margin-left: auto; font-size: 0.75rem; color: var(--text-muted); }

@keyframes toastFadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
}
```

CSS 파일 링크: `index.html`의 기존 CSS `<link>` 목록에 추가.

### 2.6 토스트 숨김

`chat.js`의 `finishAssistantMessage()` 함수(라인 352~) 말미에 추가한다. 이 함수는 `done`, `error`, `aborted` 이벤트 모두에서 호출되므로 단일 진입점이다. 기존 숨김 코드는 존재하지 않으므로 조건 확인 없이 직접 추가한다:

```javascript
// chat.js: finishAssistantMessage() 말미에 추가
const badge = document.getElementById('agentBadge');
if (badge) badge.style.display = 'none';
```

### 2.7 XSS 방어

`escapeHtml()` (이미 `cluster.js`에 존재)을 모든 동적 텍스트 렌더링에 사용. `agent.name`, `agent.emoji`, `agent.reason` 모두 적용.

---

## 3. 모바일 FAB 메뉴

### 3.1 목적

480px 이하 화면에서 `mobileMenuBtn`(햄버거 버튼)이 `window.sidebar.toggle()`을 호출해 전체화면 사이드바를 연다. FAB로 대체해 새 대화·히스토리·설정에 직접 접근한다.

### 3.2 기존 구조

`index.html:62`:
```html
<button class="mobile-menu-btn" id="mobileMenuBtn" aria-label="Toggle menu">
```

`main.js:462`: `mobileMenuBtn` 클릭 → `window.sidebar.toggle()`

### 3.3 트리거 조건

- `window.innerWidth <= 480` 일 때 FAB 활성화
- FAB 활성화 시 `mobileMenuBtn` 숨김 (`visibility: hidden` 또는 CSS `display: none`)
- 데스크톱(481px+)에서 FAB 숨김, `mobileMenuBtn` 표시 복원
- `ResizeObserver` 사용 (resize 이벤트보다 효율적, 디바운스 불필요)

### 3.4 FAB 버튼

- **위치**: `position: fixed; bottom: 24px; right: 16px; z-index: 1000`
- **크기**: 48×48px 원형
- **스타일**: `background: var(--accent-primary); border: 2px solid #000; border-radius: 50%; box-shadow: 3px 3px 0 #000`
- **아이콘**: 닫힌 상태 ≡, 열린 상태 ✕ (텍스트로 렌더링)

### 3.5 FAB 팝업 메뉴

FAB 탭 시 FAB 위로 팝업:

- **위치**: `position: fixed; bottom: 80px; right: 16px`
- **스타일**: `background: var(--bg-sidebar); border: 2px solid var(--border-default); border-radius: 8px; box-shadow: 4px 4px 0 #000; padding: 8px`
- **메뉴 항목** (순서대로):
  1. **+ 새 대화** → `window.newChat()` 호출
  2. **히스토리** → `window.sidebar.toggle()` 호출 (사이드바에 대화 목록 포함)
  3. **설정** → `window.showSettings()` 호출
- **닫기**: 팝업 외부 클릭 시 닫힘 (`document` click 이벤트로 감지)

### 3.6 기존 mobileMenuBtn 처리

480px 이하 활성화 시:
- `#mobileMenuBtn` → `display: none`
- FAB 활성화 시에도 `window.sidebar.toggle()` 기능은 FAB 히스토리 항목으로 유지

481px 이상 복원 시:
- `#mobileMenuBtn` → `display: ''` (기본값 복원)
- FAB 숨김

### 3.7 구현 대상

**신규 파일**: `frontend/web/public/js/modules/mobile-fab.js`

```javascript
// ES Module
const FAB_BREAKPOINT = 480;

function applyBreakpoint(fabContainer) {
    const isMobile = window.innerWidth <= FAB_BREAKPOINT;
    fabContainer.style.display = isMobile ? 'block' : 'none';
    const menuBtn = document.getElementById('mobileMenuBtn');
    if (menuBtn) menuBtn.style.display = isMobile ? 'none' : '';
}

function init() {
    const fabContainer = createFab();
    document.body.appendChild(fabContainer);

    // 초기 상태 즉시 적용 (ResizeObserver는 최초 콜백을 보장하지 않음)
    applyBreakpoint(fabContainer);

    const observer = new ResizeObserver(() => applyBreakpoint(fabContainer));
    observer.observe(document.body);
}
```

FAB 팝업 열기/닫기 시 이벤트 버블링으로 `document` click이 즉시 감지되는 것을 방지하기 위해 FAB 버튼 클릭 핸들러에 `event.stopPropagation()` 적용 필수:

```javascript
fabBtn.addEventListener('click', function(event) {
    event.stopPropagation();
    toggleMenu();
});
document.addEventListener('click', function() {
    closeMenu(); // 팝업 외부 클릭 시 닫힘
});
```

`main.js`에서 `import { init as initMobileFab } from './modules/mobile-fab.js'` 후 DOMContentLoaded에서 호출.

**신규 파일**: `frontend/web/public/css/mobile-fab.css`

```css
.fab-container { display: none; } /* ResizeObserver가 제어 */
@media (min-width: 481px) { .fab-container { display: none !important; } }

.fab-btn { /* FAB 원형 버튼 스타일 */ }
.fab-menu { /* 팝업 메뉴 스타일 */ }
.fab-menu-item { /* 메뉴 항목 스타일 */ }
```

CSS 파일 링크: `index.html`에 추가.

---

## 4. CSS 변수 완전 통합

### 4.1 현재 문제

실제 파일 현황:

| 파일 | `:root` 블록 | 충돌 여부 |
|------|-------------|---------|
| `css/design-tokens.css` | 있음 (정식 정의) | 기준 |
| `style.css` | 있음 (라인 8) | 충돌 |
| `style.css` | `[data-theme="light"]` (라인 51) | 충돌 |
| `css/animations.css` | 있음 (라인 12) | 충돌 가능 |
| `css/feature-cards.css` | **없음** | 해당 없음 — 수정 불필요 |
| `css/light-theme.css` | **없음** | 해당 없음 — `[data-theme="light"]` 컴포넌트 스타일만 포함, CSS 변수 `:root` 정의 없음, 수정 불필요 |

**`feature-cards.css`는 이미 `var(--xxx)`만 참조한다 — 수정 불필요.**

`style.css:49` 주석이 이미 충돌을 인식하고 있음: "style.css :root above conflicts with design-tokens.css".

### 4.2 목표 상태

- `design-tokens.css`: 모든 CSS 변수의 단일 진실 원본
- `style.css`: `:root` 블록 제거, `[data-theme="light"]` 블록 제거 또는 `design-tokens.css`로 이동
- `animations.css`: `:root` 블록 내용 → `design-tokens.css`로 이동 후 `:root` 블록 제거

### 4.3 구현 절차

1. **`design-tokens.css` 변수 목록 추출** (기준)
2. **`style.css` `:root` 처리**:
   - `design-tokens.css`에 이미 있는 변수 → 삭제
   - 없는 변수 → `design-tokens.css`에 추가 후 삭제
   - `:root` 블록이 비면 블록 자체 제거
3. **`style.css` `[data-theme="light"]` 처리**:
   - `design-tokens.css`의 `[data-theme="light"]` 블록이 있으면 → 변수 병합 후 제거
   - 없으면 → 통째로 `design-tokens.css`로 이동
4. **`animations.css` `:root` 처리**: 동일 절차
5. **라이트 테마 `--bg-app` 기준값**: `#fdfbf7` (`design-tokens.css` 원본 채택)
6. **`var(--xxx)` 참조는 변경하지 않음** — 모든 파일에서 참조 그대로 유지

### 4.4 영향 범위

- 수정: `design-tokens.css`, `style.css`, `animations.css`
- 변경 없음: `feature-cards.css`, 모든 JS 파일, HTML 파일

### 4.5 검증

변경 후 라이트/다크 테마 전환 시 모든 페이지에서 배경색 일관성 확인:
- 라이트: 앱 배경이 `#fdfbf7`로 통일
- 다크: 기존 다크 테마 색상 유지

---

## 5. 구현 범위 밖 (이번 스펙 제외)

- Welcome Screen 4열 레이아웃
- 480px 이하 feature cards 1열 변경
- 사이드바 내부 컴포넌트 변경
- 백엔드 신규 WebSocket 이벤트 타입 추가

---

## 6. 기술 제약

- **프레임워크 없음**: Vanilla JS ES 모듈 (`js/modules/` 내 ESM)
- **XSS 방어**: 동적 렌더링 텍스트는 기존 `escapeHtml()` 함수 사용
- **디자인 시스템**: Neo Brutalism 2.0 — CSS 변수 참조 (`var(--accent-primary)` 등), 하드코딩 색상 금지 (`var()` 불가한 경우 제외)
- **반응형**: FAB은 `ResizeObserver` 기반, CSS `@media` 보조
- **기존 전역 함수 재사용**: `window.newChat()`, `window.sidebar.toggle()`, `window.showSettings()`

---

## 7. 테스트 기준

| 항목 | 검증 방법 |
|------|-----------|
| 토스트 표시 | `agent_selected` 이벤트 수신 시 `agentBadge` 내 `.agent-status-toast` 존재 확인 |
| 토스트 숨김 | 응답 `done` 이벤트 후 `agentBadge` `display: none` 확인 |
| XSS 방어 | `agent.name`에 `<img onerror=alert(1)>` 주입 시 텍스트로만 렌더링 |
| FAB 480px 임계값 | 브라우저 너비 481px: FAB 없음, `mobileMenuBtn` 있음 / 479px: FAB 있음, `mobileMenuBtn` 없음 |
| FAB 새 대화 | FAB → 새 대화 탭 → 채팅 초기화 확인 |
| FAB 히스토리 | FAB → 히스토리 탭 → 사이드바 열림 확인 |
| FAB 설정 | FAB → 설정 탭 → 설정 패널 열림 확인 |
| FAB 팝업 닫기 | 팝업 외부 클릭 시 팝업 닫힘 확인 |
| CSS 변수 일관성 | 라이트 테마에서 모든 배경 영역이 `#fdfbf7` (DevTools로 확인) |
| 다크 테마 유지 | CSS 변경 후 다크 테마 시각적 회귀 없음 |
