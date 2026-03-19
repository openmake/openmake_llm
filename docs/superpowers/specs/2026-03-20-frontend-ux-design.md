# Frontend UX Design Spec — AI Status Toast, Mobile FAB, CSS Unification

**Date:** 2026-03-20
**Status:** Approved
**Scope:** Frontend UI/UX improvements for OpenMake LLM

---

## 1. Overview

세 가지 독립적 프론트엔드 개선을 구현한다:

1. **AI 실행 상태 플로팅 토스트** — 스트리밍 응답 중 어떤 에이전트가 왜 선택되었고 어떤 단계에 있는지 사용자에게 실시간 표시
2. **모바일 FAB 메뉴** — 480px 이하 화면에서 우하단 플로팅 액션 버튼으로 사이드바 대체
3. **CSS 변수 완전 통합** — `design-tokens.css` 단일 진실 원본화, 중복 `:root` 블록 제거

---

## 2. AI 실행 상태 플로팅 토스트

### 2.1 목적

현재 스트리밍 응답 중 사용자는 `생각 중...` 외에 아무 정보도 없다. 백엔드가 이미 에이전트 선택 이유, 분류 신뢰도, 실행 단계를 계산하지만 프론트엔드로 전달하지 않는다.

### 2.2 표시 위치 및 형태

- **위치**: 채팅 입력창 바로 위, `position: relative` 컨테이너 안 `position: absolute` 배너
- **크기**: 입력창 전체 너비, 높이 ~36px
- **표시 조건**: 응답 스트리밍 시작 시 나타남 → 응답 완료(또는 오류) 시 자동 사라짐
- **모바일/데스크톱 동일**: 별도 처리 불필요

### 2.3 표시 내용 (상세 수준)

```
⚡ 코딩 에이전트   코드 분석 중...   1/3   ~8s   (신뢰도 94%)
```

| 필드 | 설명 | 예시 |
|------|------|------|
| 에이전트명 | 선택된 에이전트/전략 | `코딩 에이전트`, `리서치 에이전트`, `일반 대화` |
| 현재 단계 | 실행 중인 단계 설명 | `코드 분석 중...` |
| 진행률 | `현재단계/총단계` | `1/3` |
| 예상 시간 | 남은 예상 시간 | `~8s` |
| 분류 신뢰도 | LLM 분류 신뢰도 (선택적) | `(신뢰도 94%)` |

### 2.4 백엔드 → 프론트엔드 데이터 전달

WebSocket 스트리밍 채널에 새 이벤트 타입 추가:

```typescript
// 백엔드: ws-chat-handler.ts에서 전송
interface AgentStatusEvent {
    type: 'agent_status';
    agentName: string;        // "코딩 에이전트"
    reason: string;           // "code-gen 분류 (신뢰도 94%)"
    currentStep: string;      // "코드 분석 중..."
    stepIndex: number;        // 1
    totalSteps: number;       // 3
    estimatedSeconds: number; // 8
}
```

백엔드 전송 시점: ChatService에서 에이전트 선택 직후, 각 에이전트 루프 iteration 시작 시.

### 2.5 프론트엔드 구현

파일: `frontend/web/public/js/modules/chat-status-toast.js` (신규)

- `show(agentStatusEvent)` — 토스트 표시/업데이트
- `hide()` — 토스트 숨김 (fade-out 200ms)
- WebSocket `message` 이벤트에서 `type === 'agent_status'` 감지 → `show()` 호출
- `type === 'done'` 또는 `type === 'error'` 수신 시 → `hide()` 호출

CSS: `frontend/web/public/css/chat-status-toast.css` (신규)
- Neo Brutalism 스타일: `background: rgba(192,97,255,0.1)`, `border: 1.5px solid #c061ff`
- 애니메이션: `fade-in 150ms`, `fade-out 200ms`

---

## 3. 모바일 FAB 메뉴

### 3.1 목적

480px 이하 화면에서 기존 햄버거 버튼 → 전체화면 사이드바 패턴을 대체한다. 현재 사이드바 접근이 2단계 탭(햄버거 → 전체 사이드바)이며 채팅 공간을 가린다.

### 3.2 트리거 조건

- `window.innerWidth <= 480px` 이하일 때만 FAB 활성화
- 데스크톱(481px+)에서는 기존 사이드바 동작 유지

### 3.3 FAB 버튼

- **위치**: 화면 우하단, `position: fixed; bottom: 24px; right: 16px`
- **크기**: 48×48px 원형
- **스타일**: Neo Brutalism — `background: #c061ff; border: 2px solid #000; box-shadow: 3px 3px 0 #000`
- **아이콘**: 햄버거(≡) 기본, 탭 시 ✕로 전환

### 3.4 FAB 팝업 메뉴

FAB 탭 시 FAB 위로 팝업 카드 표시:

```
┌──────────────────┐
│  + 새 대화       │
│  📜 히스토리     │
│  ⚙️ 설정         │
└──────────────────┘
         [✕ FAB]
```

- **위치**: `position: fixed; bottom: 80px; right: 16px`
- **스타일**: `background: #12122a; border: 2px solid #333; border-radius: 8px; box-shadow: 4px 4px 0 #000`
- **메뉴 항목**: 새 대화(현재 채팅 초기화), 히스토리(사이드바 대화 목록), 설정(설정 패널)
- **닫기**: 팝업 외부 탭 시 닫힘

### 3.5 기존 헤더 처리

480px 이하에서:
- 기존 햄버거 버튼이 있는 헤더 영역 숨김 (`display: none`)
- 또는 헤더에서 햄버거 버튼만 숨기고 타이틀 유지 (구현 시 기존 코드 확인 후 결정)

### 3.6 프론트엔드 구현

파일: `frontend/web/public/js/modules/mobile-fab.js` (신규)

- `init()` — resize 이벤트 감지, 480px 기준 FAB 활성화/비활성화
- `toggle()` — 팝업 열기/닫기
- `handleNewChat()` — 새 대화 처리 (기존 채팅 초기화 함수 재사용)
- `handleHistory()` — 히스토리 패널 열기
- `handleSettings()` — 설정 패널 열기

CSS: `frontend/web/public/css/mobile-fab.css` (신규)
- FAB 버튼 및 팝업 스타일
- `@media (min-width: 481px) { .fab-container { display: none; } }` — 데스크톱에서 숨김

---

## 4. CSS 변수 완전 통합

### 4.1 현재 문제

동일한 CSS 변수가 3개 파일에 서로 다른 값으로 정의됨:

| 변수 | design-tokens.css | style.css | feature-cards.css |
|------|-------------------|-----------|-------------------|
| `--bg-app` | `#fdfbf7` (라이트) | `#f0f0f5` | `#F5F0E8` |
| 기타 변수 | 정식 정의 | 일부 재정의 | 일부 재정의 |

CSS 로드 순서에 따라 어떤 값이 적용되는지 예측 불가.

### 4.2 목표 상태

`design-tokens.css` = 모든 CSS 변수의 단일 진실 원본

- `style.css`: CSS 변수 정의 없음, 레이아웃/컴포넌트 스타일만
- `feature-cards.css`: CSS 변수 정의 없음, 카드 컴포넌트 스타일만

### 4.3 구현 절차

1. `design-tokens.css` 현재 변수 목록 추출 (기준 파일)
2. `style.css`의 `:root` 블록에서 변수 추출 → `design-tokens.css`에 없는 것은 추가, 있는 것은 삭제 후 `:root` 블록 제거
3. `feature-cards.css`의 모든 CSS 변수 정의 추출 → 동일 절차 적용
4. 각 파일에서 변수 참조(`var(--xxx)`)는 그대로 유지
5. 라이트 테마 `--bg-app` 기준값: `#fdfbf7` (`design-tokens.css` 원본 채택)

### 4.4 영향 범위

- `design-tokens.css` 수정 (변수 추가 가능)
- `style.css` 수정 (`:root` 블록 제거 또는 축소)
- `feature-cards.css` 수정 (CSS 변수 정의 블록 제거)
- JS/HTML 변경 없음

---

## 5. 구현 범위 밖 (이번 스펙 제외)

- Welcome Screen 4열 레이아웃 (D 옵션 — 미선택)
- 480px 이하 feature cards 1열 변경 (FAB 구현 후 별도 검토)
- 사이드바 내부 컴포넌트 변경

---

## 6. 기술 제약

- **프레임워크 없음**: Vanilla JS ES 모듈 패턴 유지 (`js/modules/` 내 IIFE 또는 ESM)
- **XSS 방어**: 동적으로 렌더링되는 에이전트명/단계 텍스트는 `sanitize.js` 통과 필수
- **디자인 시스템**: Neo Brutalism 2.0 — `#1a1a2e`, `#c061ff`, Space Grotesk + Pretendard, 2px solid border, box-shadow offset
- **CSS 변수**: `var(--xxx)` 참조, 하드코딩 색상 값 금지
- **반응형**: CSS 미디어 쿼리 기반, JS resize 이벤트 보조

---

## 7. 테스트 기준

| 항목 | 검증 방법 |
|------|-----------|
| 토스트 표시/숨김 | WebSocket `agent_status` → `done` 이벤트 시뮬레이션 |
| FAB 480px 임계값 | 브라우저 resize로 481px/479px 전환 확인 |
| FAB 팝업 항목 동작 | 새 대화·히스토리·설정 각각 탭 후 결과 확인 |
| CSS 변수 일관성 | 라이트/다크 테마 전환 시 배경색 일치 확인 |
| XSS 안전성 | 에이전트명에 `<script>` 주입 시 sanitize 통과 확인 |
