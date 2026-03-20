# OpenMake LLM 프로젝트 안정화 종합 보고서 (v2)

> 분석일: 2026-03-20
> 분석 도구: Claude Code (4개 병렬 에이전트) + Gemini CLI (보완 검토)
> 상태: Gemini 피드백 반영 완료

---

## 전체 건강도 대시보드

| 분야 | 점수 | 핵심 리스크 | 긴급 항목 |
|------|------|-----------|----------|
| **Frontend** | 72/100 | 전체 SPA innerHTML XSS 패턴, WS 재연결 후 상태 미복구 | 2건 |
| **Backend** | 78/100 | unhandledRejection 무시, 캐시 워밍 재시도 없음 | 4건 |
| **DBA** | 75/100 | 스키마 타입 불일치, FK 누락, 인덱스 부재 | 4건 |
| **Architecture** | 70/100 | DB 실패 시 서버 기동, 라우트 테스트 전무 | 3건 |

---

## P0: 즉시 대응 (이번 주)

### P0-1. [Arch] DB 초기화 실패 시에도 서버가 시작됨
- **파일**: `backend/api/src/server.ts:174`
- **문제**: catch 블록에서 "서버는 계속 시작"으로 처리되어, PostgreSQL 연결 불가 상태에서도 서버 기동 → 모든 API 500 에러
- **영향도**: 치명적
- **수정 방향**: **Fail-Fast** — DB 연결 실패 시 `process.exit(1)`로 즉시 크래시. PM2의 exponential backoff 재시작에 위임

### P0-2. [Arch] JWT_SECRET 기본값이 빈 문자열
- **파일**: `backend/api/src/config/env.ts`
- **문제**: development/test 모드에서 빈 JWT_SECRET → 인증 우회 가능
- **영향도**: 치명적 (보안)
- **수정 방향**: 프로덕션 환경에서 JWT_SECRET이 비어있으면 **앱 기동 자체를 거부** (`throw new Error`). 랜덤 생성 시 PM2 재시작마다 모든 세션이 풀리므로 금지

### P0-3. [DBA] message_feedback.message_id 스키마 타입 불일치 ⚡ Gemini 발견
- **파일**: `backend/api/src/data/models/unified-database.ts`
- **문제**: `conversation_messages.id`는 SERIAL(정수)인데 `message_feedback.message_id`는 TEXT → JOIN 시 타입 에러 또는 인덱스 사용 불가
- **영향도**: 치명적 (기능 장애)
- **수정 방향**: 스키마 타입 통일 (message_id를 실제 참조 타입에 맞게 수정) + 마이그레이션 스크립트

### P0-4. [DBA] message_feedback에 FK 제약 없음
- **파일**: `backend/api/src/data/models/unified-database.ts:216-228`
- **문제**: session_id에 FK 없음 → 세션 삭제 시 고아 레코드 발생
- **영향도**: 높음
- **수정 방향**:
```sql
ALTER TABLE message_feedback
ADD CONSTRAINT message_feedback_session_fk
FOREIGN KEY (session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE;
```

### P0-5. [DBA] agent_feedback.agent_id FK 검증 없음
- **파일**: `backend/api/src/data/models/unified-database.ts:244-254`
- **문제**: agent_id 검증 없이 저장 → 존재하지 않는 에이전트 참조 가능
- **영향도**: 높음
- **수정 방향**:
```sql
ALTER TABLE agent_feedback
ADD CONSTRAINT agent_feedback_agent_fk
FOREIGN KEY (agent_id) REFERENCES custom_agents(id) ON DELETE CASCADE;
```

### P0-6. [Backend] unhandledRejection 로그만 남기고 프로세스 미종료 ⚡ Gemini 발견
- **파일**: `backend/api/src/server.ts:370-373`
- **문제**: 비동기 Promise 에러 발생 시 로그만 남김 → 상태 오염된 프로세스가 계속 요청 처리 (좀비 프로세스)
- **영향도**: 높음 (OWASP A05 보안 설정 오류)
- **수정 방향**: unhandledRejection 발생 시 graceful shutdown 트리거 + PM2에 의해 클린 상태로 재시작

### P0-7. [Frontend] 전체 SPA에 innerHTML XSS 패턴 만연 ⚡ Gemini 발견
- **파일**: `frontend/web/public/js/modules/` 전체 (chat.js, admin.js, settings.js, custom-agents.js 등)
- **문제**: chat.js뿐 아니라 거의 모든 페이지 모듈에서 `element.innerHTML = array.map().join('')` 패턴 사용
- **영향도**: 높음 (OWASP A03 인젝션)
- **수정 방향**: DOMPurify.sanitize() 래퍼 유틸 함수 도입 → 모든 innerHTML 할당 부위를 감싸기. createElement 전환보다 현실적

---

## P1: 단기 (2주 내)

### P1-1. [Frontend] WebSocket 재연결 후 UI 상태 미복구
- **파일**: `frontend/web/public/js/modules/websocket.js:63-75`
- **문제**: 재연결 시 isGenerating, isSending 플래그 미초기화 → 전송 버튼 고정, 중단 버튼 잔류
- **영향도**: 중간 (UX)
- **수정 방향**: ws.onclose에서 isGenerating/isSending 초기화 및 hideAbortButton 호출

### P1-2. [Backend] ws.send() 에러 시 연결 종료 상태 미처리
- **파일**: `backend/api/src/sockets/ws-chat-handler.ts:246`
- **문제**: catch 블록에서 ws.send()가 이미 종료된 연결에 전송 시도 → 미처리 예외
- **영향도**: 중간
- **수정 방향**: ws.send()를 try-catch로 감싸기

### P1-3. [Arch] 헬스체크 엔드포인트 없음
- **파일**: `backend/api/src/routes/setup.ts`
- **문제**: 로드밸런서 연동 시 서버 상태 감지 불가 (PM2는 PID 기반 관리)
- **영향도**: 중간
- **수정 방향**: `/api/health` 엔드포인트 신설 (DB pool, Ollama, 메모리 상태 반환)

### P1-4. [Arch] 23개 라우트 모듈에 통합 테스트 전무
- **파일**: `backend/api/src/routes/` 전체 (23개 파일)
- **문제**: 인증 미들웨어, rate limiter, 입력 검증의 실제 동작이 검증되지 않음
- **수정 방향**: supertest 기반 통합 테스트 인프라 구축, 최소 5개 핵심 라우트 테스트

### P1-5. [Arch] conversation-db.ts 핵심 데이터 레이어 테스트 없음
- **파일**: `backend/api/src/data/conversation-db.ts`
- **문제**: 세션 CRUD, 메시지 저장/조회, 만료 세션 정리 로직 미검증
- **수정 방향**: DB mock 기반 단위 테스트 추가

### P1-6. [Backend] 캐시 워밍 실패 시 재시도 없이 무시
- **파일**: `backend/api/src/server.ts:284-290`
- **문제**: `.catch()`에서 콘솔 로그만 남기고 실패 무시 → 분류 캐시 미초기화 상태에서 서비스 시작
- **수정 방향**: 최대 3회 지수 백오프 재시도 추가

### P1-7. [Backend] as 타입 캐스팅 검증 없음
- **파일**: `backend/api/src/services/chat-strategies/agent-loop-strategy.ts:172-177`
- **코드**:
```typescript
const query = toolArgs.query as string;        // ← 타입 확인 없이 캐스팅
const maxResults = (toolArgs.max_results as number) || 5;
```
- **수정 방향**: typeof 타입 가드로 런타임 검증

### P1-8. [DBA] conversation_messages.agent_id 인덱스 누락
- **파일**: `backend/api/src/data/models/unified-database.ts:98-109`
- **문제**: 에이전트별 메시지 조회 시 풀스캔
- **수정 방향**: `CREATE INDEX idx_messages_agent ON conversation_messages(agent_id)`

### P1-9. [DBA] 감사 통계 9테이블 COUNT UNION ALL
- **파일**: `backend/api/src/data/repositories/audit-repository.ts:114-123`
- **문제**: 9개 테이블 동시 COUNT → 1-4초 응답 지연
- **수정 방향**: 통계 캐싱 (5분 TTL) 또는 별도 통계 테이블

### P1-10. [DBA] 대규모 메모리 감쇠 UPDATE
- **파일**: `backend/api/src/data/repositories/memory-repository.ts:186-194`
- **문제**: 500K+ 행 단일 UPDATE → 락 경쟁, 블로킹
- **수정 방향**: LIMIT 기반 배치 처리 (1000건 단위)

### P1-11. [Frontend] matchMedia/ResizeObserver 리스너 미제거
- **파일**: `frontend/web/public/js/modules/ui.js:338`, `mobile-fab.js:102`
- **문제**: 페이지 전환 시 리스너/옵저버 미정리 → 메모리 누수
- **수정 방향**: cleanup 함수 + observer.disconnect() 추가

### P1-12. [Arch] uncaughtException에서 비동기 cleanup 전 process.exit
- **파일**: `backend/api/src/server.ts:362-373`
- **문제**: server.stop() 내부 비동기 작업 완료 전 프로세스 종료 가능
- **수정 방향**: gracefulShutdown과 동일 패턴으로 통합

### P1-13. [Backend] CSP 헤더 엄격화 ⚡ Gemini 발견
- **파일**: `backend/api/src/middlewares/setup.ts`
- **문제**: Content-Security-Policy 헤더가 느슨하게 적용 → nonce 기반 정책 미적용
- **영향도**: 중간 (OWASP A03)
- **수정 방향**: Helmet CSP 설정에 strict nonce 기반 정책 추가

### P1-14. [Frontend] 접근성(a11y) 동적 피드백 누락 ⚡ Gemini 발견
- **파일**: `frontend/web/public/index.html`, `js/modules/chat.js`
- **문제**: AI 스트리밍 응답 시 스크린 리더가 상태 변화를 감지 못함
- **수정 방향**: `aria-live="polite"` 속성의 숨김 컨테이너 추가

---

## P2: 중기 (1개월 내)

| # | 분야 | 문제 | 파일 |
|---|------|------|------|
| P2-1 | Arch | 테스트 커버리지 CI 게이트 없음 (현재 0% 임계값) | scripts/ci-test.sh |
| P2-2 | Arch | E2E 테스트 1개뿐 (main-flow.spec.ts) | tests/e2e/ |
| P2-3 | Arch | server.ts에 7개+ 스케줄러 분산 → 중앙 관리 모듈 필요 | server.ts |
| P2-4 | Backend | 토큰 생성 속도·DB 쿼리 성능 메트릭 미수집 | ws-chat-handler.ts, retry-wrapper.ts |
| P2-5 | DBA | external_files 정렬 인덱스 누락 | unified-database.ts:363 |
| P2-6 | DBA | user_memories LIKE 풀스캔 | memory-repository.ts:89-133 |
| P2-7 | DBA | 청크 배치 실패 시 개별 INSERT 폴백 (성능 저하) | vector-repository.ts:85-134 |
| P2-8 | Frontend | Mermaid 렌더링 직렬 처리 | ui.js:310 |
| P2-9 | Frontend | 스트리밍 토큰 DOM 반복 조회 | chat.js (appendToken) |
| P2-10 | Arch | @types/bun devDep 잔존 (bun→jest 전환 잔재) | backend/api/package.json |

---

## 잘 되어 있는 부분 (유지 권장)

- **SQL Injection 방어**: 파라미터화 쿼리 95/100 일관 적용
- **DB 트랜잭션 안전**: withTransaction 래퍼 + finally { client.release() }
- **WebSocket**: 하트비트, 좀비 정리, rate limit, AbortController 기반 중단
- **Zod 환경변수 검증** + 프로덕션 superRefine 제약
- **Graceful shutdown**: MCP→DB→OAuth→Analytics→OTel 순차 종료 (30초 타임아웃)
- **서킷 브레이커**: Ollama 노드 OPEN/HALF_OPEN/CLOSED 전환
- **CI 4단계 게이트**: Jest → tsc → File Size Guard(1200줄) → ESLint
- **API Key 로테이션**: 5개 키 풀 라운드로빈 + 실패 시 자동 스와핑 + 지수 백오프
- **에러 클래스 계층**: AppError 표준화 + QuotaExceeded/KeyExhaustion 통합

---

## 실행 로드맵

```
Phase 1 (1주차) — 운영 안전성 + 보안 (P0 전체)
┌─────────────────────────────────────────────────────────────────┐
│ P0-1  DB 실패 시 Fail-Fast (process.exit)                       │
│ P0-2  JWT_SECRET 비어있으면 앱 기동 거부                         │
│ P0-3  message_feedback.message_id 스키마 타입 통일              │
│ P0-4  message_feedback FK 추가                   ← 병렬 가능   │
│ P0-5  agent_feedback FK 추가                                    │
│ P0-6  unhandledRejection → graceful shutdown 트리거             │
│ P0-7  DOMPurify.sanitize() 래퍼 도입 (전체 innerHTML 보호)      │
└─────────────────────────────────────────────────────────────────┘

Phase 2 (2~3주차) — 안정성 + 테스트 (P1 전체)
┌─────────────────────────────────────────────────────────────────┐
│ P1-1   WS 재연결 후 UI 상태 복구                                │
│ P1-2   ws.send() try-catch                                      │
│ P1-3   헬스체크 /api/health                      ← 병렬 가능   │
│ P1-4   라우트 통합 테스트 프레임워크                             │
│ P1-5   conversation-db 단위 테스트                               │
│ P1-6   캐시 워밍 재시도 로직                                     │
│ P1-7   타입 캐스팅 가드 강화                     ← 병렬 가능   │
│ P1-8   agent_id 인덱스 + feedback 복합 인덱스                    │
│ P1-9   감사 통계 캐싱                                            │
│ P1-10  메모리 감쇠 배치 처리                                     │
│ P1-11  리스너/옵저버 cleanup                                     │
│ P1-12  uncaughtException 개선                                    │
│ P1-13  CSP 헤더 엄격화                                           │
│ P1-14  aria-live 접근성 추가                                     │
└─────────────────────────────────────────────────────────────────┘

Phase 3 (4주차~) — 품질 체계화 (P2)
┌─────────────────────────────────────────────────────────────────┐
│ P2-*  커버리지 게이트, E2E 확장,                                │
│       스케줄러 추출, 메트릭 수집, 성능 튜닝                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 구현 완료 현황 (v3)

### P0 전체 완료 ✅
- P0-1: DB Fail-Fast (`process.exit(1)`)
- P0-2: JWT_SECRET test 환경 제외 검증
- P0-3/4: message_feedback FK (TEXT→INTEGER, CASCADE)
- P0-5: agent_feedback 테이블 순서 및 FK
- P0-6: unhandledRejection graceful shutdown
- P0-7: XSS safeSetHTML/purifyHTML 래퍼

### P1 전체 완료 ✅
- P1-1: WebSocket onclose 상태 초기화
- P1-2: ws.send() 안전 래퍼
- P1-3: /api/health 상세 정보 (DB 풀, Ollama, 메모리)
- P1-4: 라우트 통합 테스트 (routes-setup.test.ts)
- P1-5: conversation-db 단위 테스트 (16 케이스)
- P1-6: 캐시 워밍 지수 백오프 3회 재시도
- P1-7: as 캐스트 → typeof 런타임 가드
- P1-8: idx_messages_agent 인덱스 추가
- P1-9: audit stats 5분 TTL 캐시
- P1-10: decayImportance LIMIT 1000 배치
- P1-11: matchMedia/ResizeObserver cleanup 구현
- P1-12: gracefulShutdown 통합 함수
- P1-13: CSP upgrade-insecure-requests
- P1-14: aria-live a11y announcer

### P2 전체 완료 ✅
- P2-1: 커버리지 CI 게이트 (Branch≥20, Funcs≥25, Lines≥25)
- P2-2: E2E 테스트 확장 (api-routes.spec.ts 추가)
- P2-3: schedulers/index.ts 중앙 스케줄러 모듈
- P2-4: 토큰 생성 속도 메트릭 수집
- P2-5: idx_ext_files_created 인덱스
- P2-6: idx_memories_user_importance / pg_trgm GIN 인덱스
- P2-7: 배치 INSERT 개별 폴백 제거
- P2-8: Mermaid Promise.all 병렬 렌더링
- P2-9: appendToken DOM 쿼리 캐시
- P2-10: @types/bun 제거

### 추가 개선 (v3 사이클)
- token-cleanup.test.ts: 만료 토큰/레이트리밋 정리 8 케이스
- token-crypto.test.ts: AES-256-GCM 암호화 8 케이스
- routes-setup.test.ts: Express 라우트 9 케이스
- supertest 의존성 추가

**최종 테스트 현황: 85 스위트 / 2093 테스트, 커버리지 Stmts 41% / Branch 30%**

## 변경 이력

| 버전 | 날짜 | 변경 내용 |
|------|------|----------|
| v1 | 2026-03-20 | Claude Code 4개 에이전트 초기 분석 |
| v2 | 2026-03-20 | Gemini CLI 보완 검토 반영: 스키마 타입 불일치·unhandledRejection·전체 innerHTML XSS 추가, P0 우선순위 재조정, 수정 방향 개선 (Fail-Fast/기동 거부/DOMPurify 래퍼), CSP·a11y 추가 |
| v3 | 2026-03-20 | P0/P1/P2 전체 구현 완료, 추가 테스트(token-cleanup, token-crypto, routes-setup, conversation-db) 작성 |
