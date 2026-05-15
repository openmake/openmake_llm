# Gemini 교차 검증 리포트 (PR #22)

- **검증자**: Gemini CLI 0.42.0 (model: `gemini-3.1-pro-preview`)
- **검증 대상**: PR #22 — 5개 커밋 (range `683e178..dc213b2`) + `docs/REVIEW-2026-05-16.md`
- **모드**: read-only (`--approval-mode plan`)
- **검증일**: 2026-05-16
- **방법론**: Claude Code가 작성한 PR과 검토 리포트에 대해 독립적 4축 교차 검증

---

## 1. Verdict

**APPROVE WITH RECOMMENDATIONS** — 머지 허가, 단 후속 조치 권고.

본 PR은 기존 대비 명확한 개선을 가져오므로 그대로 머지해도 무방합니다. 다만 머지 후 3개의 follow-up 조치 권장.

---

## 2. Q1: 코드 변경의 정합성

### (a) 의도된 동작 구현 ✅
5개 커밋이 리뷰 리포트에 명시된 P0/P1/P2 우선순위 목표를 정확히 달성:
- `token-crypto.ts`: production 환경 키 누락 방지 로직 안착
- `model.routes.ts` ↔ `external-providers.ts`: KNOWN_MODELS 외부화 성공, fallback 로직 유지
- `semantic-cache.ts`: LRU eviction 카운터 정확 구현

### (b) 부수효과/회귀 위험 ✅ 안전
- `token-crypto.ts`: dev/test 환경에서 throw로 부팅 crash 방지 → 기존 테스트 동작 보존
- `chat-renderer.js`: `typeof window.purifyHTML === 'function'` 체크로 ReferenceError 방지

### (c) 더 나은 대안 ⚠️
- `bootstrap.ts`에서 `assertTokenEncryptionKeyForProduction()` 수동 호출은 **Ad-hoc**.
- 권장: Joi/Zod 기반 `env.schema.ts` 패턴으로 부팅 초기 환경변수 일괄 검증.

---

## 3. Q2: 거짓 양성(FP) 분류 검증

리뷰 리포트의 FP 분류는 **전반적으로 매우 타당함**.

| FP | Gemini 판정 | 비고 |
|---|---|---|
| FP-2 (session.js XSS) | ✅ 타당 | 템플릿 리터럴 주입 전 `escapeHtml()` 전역 활용 확인. 서브에이전트가 추적 못한 오탐 맞음 |
| FP-4 (WS rate-limit 미정리) | ✅ 타당 | 핸들러 단의 `delete(key)` 분기로 정리됨 |
| FP-7 (마이그레이션 인덱스 누락) | ✅ **매우 날카로운 검증** | Owner 불일치 환경에서 graceful-skip 패턴 사용. 정적 분석의 한계를 잘 짚음 |

---

## 4. Q3: 추가 발견 사항 ⚠️ Claude가 놓친 이슈 3건

### G1. **HIGH** — `NODE_ENV` 화이트리스트의 staging 누수

**위치**: `backend/api/src/utils/token-crypto.ts:30, 49`

```ts
const isProduction = process.env.NODE_ENV === 'production';
```

**문제**: staging/QA/UAT 등 production 외 환경으로 배포 시 `isProduction === false` → 예외 미발생 → **조용히 평문 토큰 DB 저장 (silent fallback)**.

**제안**: 화이트리스트 → **블랙리스트** 패턴으로 반전.
```ts
const isUnsafeEnvironment = ['development', 'test'].includes(process.env.NODE_ENV ?? '');
// dev/test 가 아니면 키 필수
```

이렇게 하면 staging/UAT/production 모두 키 강제, dev/test만 silent fallback.

### G2. **MEDIUM** — `purifyHTML` Fail-Open 패턴의 맹점

**위치**: `frontend/web/public/js/modules/chat-renderer.js:323-329` (본 PR로 추가된 `safeTrace` 분기)

```js
var safeTrace = (typeof window.purifyHTML === 'function')
    ? window.purifyHTML(thinkingTraceHtml)
    : thinkingTraceHtml;  // ← Fail-Open!
content.insertAdjacentHTML('afterbegin', safeTrace);
```

**문제**: `purify.min.js`가 로드되지 않거나 에러 시 (리포트 §5.2의 vendor 캐시버스터 누락 이슈와 결합), 미살균 HTML을 그대로 DOM에 삽입. 보안 방어벽을 끄고 렌더링 강행.

**제안**: Fail-Closed 패턴.
```js
if (typeof window.purifyHTML !== 'function') {
    console.error('purifyHTML 미로드 — thinking trace 렌더링 차단');
    return; // 또는 textContent 만 표시
}
content.insertAdjacentHTML('afterbegin', window.purifyHTML(thinkingTraceHtml));
```

### G3. **MEDIUM** — `outerHTML` round-trip 의 구조적 비효율

**위치**: `frontend/web/public/js/modules/chat-renderer.js:307-308, 323-329`

**문제**: `existingThinkingTrace.outerHTML` → string → `insertAdjacentHTML(string)` 라운드트립.
- 직렬화/파싱 비용 (브라우저 HTML parser 재호출)
- 엣지 케이스에서 DOM XSS 유발 (예: SVG namespace 변환)

**제안**: DOM Node 자체 참조 보존 + `insertBefore()`.
```js
// 변경 전
var thinkingTraceHtml = existingThinkingTrace ? existingThinkingTrace.outerHTML : '';
// ... renderMarkdown 후
content.insertAdjacentHTML('afterbegin', safeTrace);

// 변경 후
var thinkingTraceNode = existingThinkingTrace ? existingThinkingTrace.cloneNode(true) : null;
// ... renderMarkdown 후
if (thinkingTraceNode) content.insertBefore(thinkingTraceNode, content.firstChild);
```

장점: HTML re-parsing 0회 + XSS 표면 제거 + 더 빠름.

---

## 5. 권고 (Follow-up Actions)

본 PR은 그대로 머지 가능. 단 머지 후 다음 후속 조치 권장:

| 우선순위 | 조치 | 노력 | 효과 |
|---|---|---|---|
| 🔴 즉시 | G1: `NODE_ENV` 체크 화이트리스트 → 블랙리스트 반전 | 15분 | staging 환경 토큰 평문 저장 위험 차단 |
| 🟠 단기 | G3: `outerHTML` → `cloneNode + insertBefore` 리팩터 | 30분 | XSS 표면 제거 + 성능 개선 |
| 🟠 단기 | G2: `purifyHTML` Fail-Closed 패턴 적용 | 15분 | vendor 로드 실패 시 보안 방어벽 유지 |
| 🟡 중기 | env.schema.ts 패턴 도입 (Q1-c) | 2~3시간 | 환경변수 검증 일원화, 부팅 초기 검출 |

---

## 6. Claude vs Gemini 비교

| 항목 | Claude (메인) | Gemini (교차) |
|---|---|---|
| 거짓 양성 식별 | 7건 (FP-1 ~ FP-7) | 모두 동의 |
| 코드 정합성 | OK | OK + env.schema 권장 |
| 신규 발견 | 0건 (자체 검증) | **3건 (G1 HIGH, G2/G3 MEDIUM)** |
| 머지 권고 | 머지 가능 | 머지 가능 + 후속 3건 |

Gemini 단독 강점: **NODE_ENV 화이트리스트의 staging 갭** 발견은 Claude가 놓친 진짜 보안 이슈. 듀얼 검토의 가치를 입증한 케이스.

---

## 부록: Gemini 호출 메타

- 모델 capacity 부족으로 2회 retry 후 성공 (rate limit backoff)
- 작업 디렉토리: `/Volumes/MAC_APP/openmake_llm` (dev 브랜치)
- read-only mode (`--approval-mode plan`) — 파일 수정 금지
- 실행 시간: 약 4분
