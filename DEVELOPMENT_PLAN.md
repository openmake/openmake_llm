# OpenMake LLM 개발 개선 계획서 (v2)

> 작성일: 2026-03-02  
> 개정일: 2026-03-02 (v2 — 전면 재수립)  
> 기준 버전: v1.5.6  
> 분석 소스: 연구보고서 PDF 2건 + 코드베이스 갭 분석(grep 재검증) + Oracle 아키텍처 자문(2회)

---

## 1. 개요

### 1.1 분석 배경
「개발 방향 연구 보고서」와 「고도화 보고서: Open WebUI 벤치마크 기반 개선안」에서 제시한 개선항목을 실제 코드베이스와 대조하여 갭 분석을 수행하고, Oracle 아키텍처 자문을 통해 우선순위를 재평가하여 실행 가능한 단계별 개발 계획을 수립한다.

### 1.2 분석 방법론
1. **연구보고서 항목 추출** — 2건의 PDF에서 총 20개 핵심 제안항목 분류
2. **코드베이스 전수 검증** — grep/ast-grep으로 전항목 구현 여부를 바이너리(있다/없다) 수준에서 확인
3. **Oracle 아키텍처 자문** — 우선순위 재조정, 과잉 제안 식별, 연구보고서 누락 항목 발견
4. **2차 재검증** — 1차 계획 수립 후 코드베이스 변경사항 재확인, Oracle 2차 자문

### 1.3 v1 → v2 주요 변경사항

| 변경 유형 | 내용 |
|----------|------|
| ✅ **추가** | CI/CD 파이프라인 (Phase 1 W1), Cross-encoder Reranking (Phase 2 W3), OCR 품질 게이트 (Phase 2 W1), RAGAs 평가 루프 (Phase 2 W5), OpenAI 호환 API (Phase 3 W2) |
| 🔄 **수정** | WebSocket Rate Limiting → 이미 구현 확인(`checkChatRateLimit`), 계획에서 제거 |
| ❌ **삭제** | Web Components 전환 → 보류로 이동 (ROI 낮음), 메트릭 대시보드 전용 주 → OTel에 통합 |
| 🔀 **병합** | Mermaid.js + KaTeX → 1주로 병합 (동일 marked.js 확장), HNSW → Phase 2로 이동 (최적화 단계) |

### 1.4 핵심 발견 요약

| 발견 유형 | 내용 |
|----------|------|
| 🔴 **즉시 대응** | SSRF 방어 제로(extract_webpage/firecrawl이 임의 URL 수락), BOLA 불일치(12개 리포지토리 중 일관적 user_id 검증은 3개만) |
| 🟡 **구조적 결함** | vector_embeddings 컬럼 TEXT 폴백 가능(벡터 인덱스 무효화), storeEmbeddings() O(n) round trips, CI/CD 부재(테스트 205개 수동 실행) |
| 🔵 **기능 부재** | BM25/FTS, RRF, Cross-encoder Reranking, N:M 지식베이스, Mermaid/KaTeX, OpenTelemetry, OpenAI 호환 API 미구현 |
| 🟢 **이미 존재** | WebSocket 메시지 Rate Limiting(`checkChatRateLimit`), marked.js/highlight.js/DOMPurify, Winston 로거, Request ID 미들웨어, 66개 테스트 파일 |
| ⚪ **과잉 제안** | SCIM/LDAP/RLS/TipTap/모노레포/사설 npm/Docker — 현재 ROI 낮음 |

---

## 2. 현황 진단 (갭 분석 결과 — 2차 재검증)

### 2.1 즉시 대응 필요 (보안 취약점)

#### SSRF 방어 부재 — 🔴 CRITICAL
- **현황**: `backend/api/src/mcp/web-search.ts`의 `extractWebpageTool`과 `backend/api/src/mcp/firecrawl.ts`의 모든 스크래핑 도구가 사용자 제공 URL을 **검증 없이 직접 요청**
- **검증**: `grep -r "SSRF\|ssrf\|validateUrl\|validateOutbound\|blocked.*IP\|169\.254" backend/` → agent prompt 파일 2건만 매칭, **실제 방어 코드 0건**
- **위험도**: 내부망/메타데이터 엔드포인트(169.254.169.254) 접근, DNS rebinding 악용 가능

#### BOLA 불일치 — 🔴 CRITICAL
- **현황**: 리포지토리별 user_id 검증 현황 (2차 재검증)
  - ✅ memory-repository.ts (8건 — WHERE user_id 검증 확인)
  - ✅ external-repository.ts (5건)
  - ✅ api-key-repository.ts (3건)
  - ⚠️ conversation-repository.ts (2건 — 부분적)
  - ⚠️ research-repository.ts (2건 — 부분적)
  - ❌ skill-repository.ts (**0건** — 소유권 검증 없음)
  - ❌ vector-repository.ts (**0건** — 소유권 검증 없음)
  - ❌ feedback-repository.ts (user_id INSERT만, 접근 필터링 없음)
  - ❌ audit-repository.ts (user_id INSERT만, 접근 필터링 없음)
- **위험도**: 타 사용자의 대화 내역, 문서, 커스텀 에이전트에 대한 무단 접근 가능

#### WebSocket Rate Limiting — ✅ 이미 구현됨 (v1 오류 정정)
- **현황**: `backend/api/src/middlewares/chat-rate-limiter.ts`에 `checkChatRateLimit()` 함수 존재 (225행)
- **검증**: `ws-chat-handler.ts` 117행에서 매 채팅 메시지마다 호출
- **기능**: 사용자별 일일 한도, DB 백업 캐시, role/tier별 차등 제한
- **v1 오류**: 이전 계획에서 "미흡"으로 기재했으나, 실제로는 **완전한 per-message rate limiting이 구현되어 있음**

### 2.2 인프라 결함

#### CI/CD 부재 — 🟡 HIGH
- **현황**: `.github/workflows/` 없음, Jenkinsfile/gitlab-ci.yml 없음
- **검증**: `glob .github/workflows/*` → **0건**
- **영향**: 205개 테스트가 수동 실행만 가능, 머지 전 회귀 테스트 미보장
- **테스트 파일**: 66개 테스트 파일 존재하지만 자동화되지 않음

#### 벡터 스키마 불안정 — 🟡 HIGH
- **현황**: `services/database/init/002-schema.sql`에서 pgvector 미설치 시 embedding 컬럼을 TEXT로 대체
  - 244행: `embedding vector(768)` (정상 경로)
  - 257행: `embedding TEXT` (폴백 경로)
- **인덱스**: IVFFlat만 사용 (`lists = 100`), HNSW 없음
- **영향**: TEXT 폴백 시 벡터 검색 완전 비활성, IVFFlat은 대규모 데이터에서 정확도 저하

#### storeEmbeddings O(n) 성능 — 🟡 MEDIUM
- **현황**: `vector-repository.ts` 114-149행 — 임베딩을 건별 INSERT로 처리
- **코드**: `for (const item of embeddings) { await this.query(INSERT...) }`
- **영향**: 1,000 청크 저장 시 1,000회 DB round trip

### 2.3 핵심 기능 부재

| 항목 | grep 검증 결과 | 현재 상태 |
|------|-------------|---------|
| BM25/FTS 검색 | `tsvector/tsquery/BM25/fulltext/lexical` → **0건** | 벡터 검색만 사용 |
| RRF 점수 융합 | `RRF/reciprocal/rank.*fusion/hybrid.*search/rerank` → **0건** | 미구현 |
| Cross-encoder Reranking | 미구현 | 2차 보고서 신규 제안 |
| N:M 지식베이스 | `collection/knowledge/kb_` → DB 스키마 4건만 (기본 테이블) | 컬렉션/태그/권한 없음 |
| OCR 품질 게이트 | 미구현 | 2차 보고서 신규 제안 |
| RAGAs 평가 루프 | 미구현 | 2차 보고서 신규 제안 |
| OpenAI 호환 API | 미구현 | 2차 보고서 신규 제안 |

### 2.4 UX 개선 필요

| 항목 | grep 검증 결과 | 현재 상태 |
|------|-------------|---------|
| Mermaid.js | `mermaid/Mermaid` → **0건** (frontend/) | 다이어그램 렌더링 불가 |
| KaTeX | `katex/KaTeX` → **0건** (frontend/) | 수식 렌더링 불가 |
| Markdown | marked.js + highlight.js + DOMPurify → **존재** | 기본 렌더링 작동 |

### 2.5 운영 인프라

| 항목 | grep 검증 결과 | 현재 상태 |
|------|-------------|---------|
| OpenTelemetry | `opentelemetry/OTEL/otel/@opentelemetry/prometheus` → **0건** | 분산 추적 없음 |
| Request ID | `middlewares/request-id.ts` → **존재** | 기본 추적 가능 |
| Winston Logger | `utils/logger.ts` → **존재** | 로깅 인프라 있음 |
| Health Check | 존재 | 기본 헬스체크 작동 |

### 2.6 보류/제외 항목

| 항목 | 연구보고서 우선순위 | 재평가 | 사유 |
|------|:---:|:---:|------|
| SCIM 2.0 | P0 | **보류** | 엔터프라이즈 고객 없음. JWT+OAuth로 충분 |
| LDAP/AD | P0 | **보류** | 온프레미스 계약 발생 시 도입 |
| RLS | P1 | **보류** | tenant_id 없음. 22개 테이블 마이그레이션 = 고리스크/저ROI |
| Web Components | P2 | **보류** | Vanilla JS 컴포넌트 30개 미만, 유지보수 비용 측정 후 재검토 |
| TipTap | P2 | **제외** | 200KB+ 번들, 채팅 앱에 과잉. textarea + markdown preview로 충분 |
| 모노레포 재구조화 | P3 | **제외** | 2개 워크스페이스에 4+ 패키지 분리 = 복잡도만 증가 |
| 사설 npm 레지스트리 | P3 | **제외** | 패키지 퍼블리시 하지 않음 |
| Docker/컨테이너화 | P3 | **영구 제외** | 프로젝트 방침. Dockerfile, docker-compose, .dockerignore 등 컨테이너 관련 항목은 개발 계획에서 영구 제외 |

---

## 3. 우선순위 재조정

### 3.1 연구보고서 P0-P3 vs 실제 기반 재평가 (v2)

```
연구보고서 우선순위          →    실제 코드 기반 재평가 (v2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
P0 SCIM 2.0               →    ⬇️ 보류 (On-demand)
P0 LDAP/AD                →    ⬇️ 보류 (On-demand)
P0 SSRF Defense           →    ✅ P0 유지 (즉시 악용 가능)
P0 BOLA Defense           →    ✅ P0 유지 (권한 일관성 결함)
—  CI/CD (보고서 미포함)    →    ⬆️ P0 신규 (205 테스트 수동 = 테스트 미실행과 동일)
P1 Hybrid Search          →    ✅ P1 유지
P1 RRF                    →    ✅ P1 유지
P1 N:M Knowledge Base     →    ✅ P1 유지
P1 RLS                    →    ⬇️ 보류 (멀티테넌시 없음)
—  Cross-encoder (2차)     →    ⬆️ P1 신규 (RAG 품질 최대 개선점)
—  OCR Quality Gate (2차)  →    ⬆️ P1 신규 (Garbage-in 방지)
—  RAGAs Eval (2차)        →    ⬆️ P1 신규 (품질 측정 기반)
—  OpenAI-compat API (2차) →    ⬆️ P2 신규 (에코시스템 연동)
P2 Mermaid.js             →    ✅ P2 유지
P2 KaTeX                  →    ✅ P2 유지
P2 Web Components         →    ⬇️ 보류 (ROI 낮음)
P2 TipTap                 →    ❌ 제외
P3 OpenTelemetry          →    ✅ P2 유지 (P3→P2 상향)
P3 모노레포 재구조화       →    ❌ 제외
P3 사설 npm 레지스트리     →    ❌ 제외
—  WS Rate Limiting        →    ✅ 이미 구현됨 (계획 제외)
```

### 3.2 전체 스코어카드 (v2)

| # | 항목 | 영향도 | 난이도 | 리스크 | 추천 단계 |
|---|------|:-----:|:-----:|:-----:|:-------:|
| — | CI/CD 파이프라인 (신규) | **H** | **L** | **L** | Phase 1 |
| 3 | SSRF Defense | **H** | **L** | **L** | Phase 1 |
| 4 | BOLA Defense | **H** | **M** | **L** | Phase 1 |
| — | 벡터 스키마 안정화 | **H** | **L** | **M** | Phase 1 |
| 5 | Hybrid Search (BM25) + OCR Quality Gate | **H** | **M** | **L** | Phase 2 |
| 6 | RRF 점수 융합 | **H** | **L** | **L** | Phase 2 |
| — | Cross-encoder Reranking + HNSW (신규) | **H** | **M** | **M** | Phase 2 |
| 7 | N:M Knowledge Base + 배치 INSERT | **H** | **M** | **M** | Phase 2 |
| — | RAGAs 평가 루프 (신규) | **M** | **L** | **L** | Phase 2 |
| 10+11 | Mermaid.js + KaTeX (병합) | **M** | **L** | **L** | Phase 3 |
| — | OpenAI 호환 API (신규) | **M** | **M** | **L** | Phase 3 |
| 13 | OpenTelemetry | **M** | **M** | **L** | Phase 3 |
| 1 | SCIM 2.0 | **L** | **H** | **M** | 보류 |
| 2 | LDAP/AD | **L** | **H** | **H** | 보류 |
| 8 | RLS | **L** | **H** | **H** | 보류 |
| 9 | Web Components | **M** | **M** | **M** | 보류 |
| 12 | TipTap | **L** | **M** | **M** | 제외 |

---

## 4. 단계별 개발 로드맵

### 공통 실행 원칙
- **브랜치 전략**: `feat/phase1-security`, `feat/phase2-rag`, `feat/phase3-ux-ecosystem`
- **릴리스 게이트**: 보안 테스트 통과 + 성능 회귀 없음 + `bun test && npm run build && npm run lint` 통과
- **리뷰 기준**: 각 Phase PR에 보안 변경은 반드시 2인 이상 리뷰
- **테스트 원칙**: 보안 PR은 반드시 음성 테스트(공격이 차단됨을 증명) 포함

---

### Phase 1: 보안 + 기반 강화 (4주)

#### Week 1 — CI/CD 파이프라인 구축

**목표**: 모든 코드 변경에 자동 테스트/린트 게이트를 적용한다.

**신규 파일:**
- `scripts/ci-test.sh` (또는 `.github/workflows/ci.yml`)
- `.husky/pre-push` (git hook)

**구현 범위:**
- Bun test runner를 pre-push hook으로 설정
- `npm run build && bun test && npm run lint` 통합 스크립트
- 실패 시 push 차단 (fail-on-red gate)
- 선택: GitHub Actions 워크플로우 추가 (있는 경우)

**성공 기준:**
- `git push` 시 자동으로 205+ 테스트 실행
- 테스트 실패 시 push 차단
- `npm run lint` 오류 시 push 차단

---

#### Week 2 — SSRF 방어 계층 도입

**목표**: 모든 외부 URL 요청에 SSRF 방어 미들웨어를 적용한다.

**신규 파일:**
- `backend/api/src/security/ssrf-guard.ts`

**수정 파일:**
- `backend/api/src/mcp/web-search.ts` — `extractWebpageTool`에 URL 검증 추가
- `backend/api/src/mcp/firecrawl.ts` — 모든 Firecrawl 도구에 URL 검증 추가
- `backend/api/src/utils/firecrawl-client.ts` — HTTP 클라이언트 레벨 방어

**구현 상세:**
```typescript
// backend/api/src/security/ssrf-guard.ts
import { URL } from 'node:url';
import dns from 'node:dns/promises';

const BLOCKED_RANGES = [
  '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',  // RFC 1918
  '127.0.0.0/8',                                       // Loopback
  '169.254.0.0/16',                                    // Link-local / Cloud metadata
  '0.0.0.0/8', '::1/128', 'fc00::/7'                  // Special
];

export async function validateOutboundUrl(rawUrl: string): Promise<URL> {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Blocked scheme');
  const { address } = await dns.lookup(url.hostname);
  if (isBlockedIP(address)) throw new Error('Blocked IP range');
  return url;
}
```

**성공 기준:**
- `169.254.169.254`, `127.0.0.1`, `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x` 요청 100% 차단
- Redirect 체인 중 내부망 IP 유도 시 차단
- SSRF 테스트 케이스 15개+ 추가, 전부 통과

---

#### Week 3 — BOLA 통제 일원화

**목표**: 모든 리소스 접근 엔드포인트에 객체 단위 소유권 검증을 적용한다.

**신규 파일:**
- `backend/api/src/auth/ownership.ts`

**수정 파일:**
- `backend/api/src/data/repositories/skill-repository.ts` — user_id WHERE 추가
- `backend/api/src/data/repositories/vector-repository.ts` — user_id WHERE 추가
- `backend/api/src/data/repositories/feedback-repository.ts` — user_id 필터링 추가
- `backend/api/src/data/repositories/conversation-repository.ts` — user_id 검증 강화
- `backend/api/src/data/repositories/research-repository.ts` — user_id 검증 강화
- `backend/api/src/routes/documents.routes.ts`
- `backend/api/src/routes/agents.routes.ts`
- `backend/api/src/routes/research.routes.ts`

**구현 상세:**
```typescript
// backend/api/src/auth/ownership.ts
export function assertResourceOwnerOrAdmin(
  resourceOwnerId: string,
  requestUserId: string,
  userRole: string
): void {
  if (userRole === 'admin') return;
  if (resourceOwnerId !== requestUserId) {
    throw new ForbiddenError('Resource access denied');
  }
}
```

**성공 기준:**
- 타 사용자 리소스 접근 시 403 일관 응답
- 관리자 role만 예외 허용
- 리포지토리별 최소 1개 음성 테스트 (12개 repo × 1 = 12 테스트 추가)
- BOLA 회귀 테스트 전부 통과

---

#### Week 4 — 벡터 스키마 안정화

**목표**: vector_embeddings를 실제 vector 타입으로 강제하고 TEXT 폴백을 제거한다.

**신규 파일:**
- `services/database/migrations/002_vector_type_migration.sql`

**핵심 SQL:**
```sql
-- services/database/migrations/002_vector_type_migration.sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    -- TEXT → vector(768) 변환
    ALTER TABLE vector_embeddings
      ALTER COLUMN embedding TYPE vector(768)
      USING CASE
        WHEN embedding IS NULL OR embedding = '' THEN NULL
        ELSE embedding::vector
      END;

    RAISE NOTICE '[Migration 002] vector(768) 타입 전환 완료';
  ELSE
    RAISE EXCEPTION '[Migration 002] pgvector 확장 필수 — 설치 후 재실행';
  END IF;
END $$;
```

**주의**: HNSW 인덱스 전환은 Phase 2 W3에서 수행 (최적화 단계).

**성공 기준:**
- `SELECT pg_typeof(embedding) FROM vector_embeddings LIMIT 1` → `vector`
- pgvector 미설치 시 마이그레이션이 명확한 에러와 함께 중단 (TEXT 폴백 불허)
- 마이그레이션 dry-run 스크립트 포함

**Phase 1 게이트:**
- 모든 205+ 기존 테스트 + 신규 보안 테스트 CI에서 green
- 보안 테스트: SSRF 15개+ / BOLA 12개+ 추가 완료

---

### Phase 2: RAG 검색 품질 혁신 (5주)

#### Week 1 — BM25(FTS) 인덱스 + OCR 품질 게이트

**신규 파일:**
- `services/database/migrations/003_hybrid_search_fts.sql`
- `backend/api/src/services/OCRQualityGate.ts`

**핵심 SQL:**
```sql
ALTER TABLE vector_embeddings
  ADD COLUMN IF NOT EXISTS content_tsv tsvector;

UPDATE vector_embeddings
SET content_tsv = to_tsvector('simple', coalesce(content, ''));

CREATE INDEX IF NOT EXISTS idx_embeddings_content_tsv
  ON vector_embeddings USING GIN (content_tsv);

-- 자동 갱신 트리거
CREATE OR REPLACE FUNCTION vector_embeddings_tsv_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.content_tsv := to_tsvector('simple', coalesce(NEW.content, ''));
  RETURN NEW;
END $$;

CREATE TRIGGER trg_vector_embeddings_tsv
BEFORE INSERT OR UPDATE OF content ON vector_embeddings
FOR EACH ROW EXECUTE FUNCTION vector_embeddings_tsv_trigger();
```

**OCR 품질 게이트 구현:**
```typescript
// backend/api/src/services/OCRQualityGate.ts
interface TextQualityMetrics {
  printableCharRatio: number;    // 인쇄 가능 문자 비율 (>0.85 양호)
  unicodeReplacementRatio: number; // U+FFFD 비율 (<0.05 양호)
  tokenDiversity: number;        // 고유 토큰 / 전체 토큰 (>0.3 양호)
}

export function assessTextQuality(text: string): TextQualityMetrics { ... }
export function isTextQualityAcceptable(metrics: TextQualityMetrics): boolean { ... }
```

**성공 기준:**
- `SELECT count(*) FROM vector_embeddings WHERE content_tsv IS NOT NULL` = 전체 행 수
- FTS 쿼리 `content_tsv @@ plainto_tsquery('simple', '검색어')` 정상 동작
- OCR 게이트: 저품질 텍스트(인쇄 불가 문자 >15%) 자동 거부/재처리

---

#### Week 2 — Hybrid Retriever + RRF 구현

**수정 파일:**
- `backend/api/src/data/repositories/vector-repository.ts` — `searchLexical()` 추가
- `backend/api/src/services/RAGService.ts` — `searchHybrid()` + RRF 융합

**RRF 알고리즘:**
```typescript
function reciprocalRankFusion(
  vectorResults: SearchResult[],
  lexicalResults: SearchResult[],
  k: number = 60
): SearchResult[] {
  const scores = new Map<string, number>();

  vectorResults.forEach((r, i) => {
    const current = scores.get(r.id) || 0;
    scores.set(r.id, current + 1 / (k + i + 1));
  });

  lexicalResults.forEach((r, i) => {
    const current = scores.get(r.id) || 0;
    scores.set(r.id, current + 1 / (k + i + 1));
  });

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, score, ...getMetadata(id) }));
}
```

**성공 기준:**
- 동일 질의에서 vector-only 대비 Recall@10 **+15% 이상**
- 검색 p95 latency **300ms 이하**

---

#### Week 3 — Cross-encoder Reranking + HNSW 인덱스

**신규 파일:**
- `backend/api/src/services/Reranker.ts`
- `services/database/migrations/004_hnsw_index.sql`

**수정 파일:**
- `backend/api/src/services/RAGService.ts` — reranking 3단계 파이프라인 통합

**구현 상세:**
```typescript
// backend/api/src/services/Reranker.ts
// ms-marco-MiniLM-L-6-v2 (~80MB) 또는 Ollama 기반 reranker
// Top-20 RRF 결과 → Cross-encoder 스코어링 → Top-5 최종 반환

export class Reranker {
  async rerank(query: string, candidates: SearchResult[], topK: number = 5): Promise<SearchResult[]> {
    // Ollama 또는 ONNX Runtime으로 cross-encoder 추론
    // M4 CPU에서 20 후보 기준 ~50-100ms
  }
}
```

**HNSW 마이그레이션 SQL:**
```sql
-- services/database/migrations/004_hnsw_index.sql
-- 조건부: 메모리 예산 확인 후 실행 (500K 벡터 × 768 dim ≈ 3GB)
DROP INDEX IF EXISTS idx_embeddings_vector;
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw
  ON vector_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);  -- M4 16GB에 맞춘 보수적 설정
```

**성공 기준:**
- 3단계 파이프라인: BM25+Vector → RRF → Cross-encoder 동작 확인
- Reranking 후 MRR@5 **+10% 이상** (vs RRF only)
- Reranking 추가 지연 **100ms 이하**
- HNSW 인덱스 생성 + 검색 동작 확인

---

#### Week 4 — 배치 INSERT + N:M 지식베이스

**수정 파일:**
- `backend/api/src/data/repositories/vector-repository.ts` — 배치 INSERT

**신규 파일:**
- `services/database/migrations/005_kb_nm_schema.sql`
- `backend/api/src/data/repositories/kb-repository.ts`
- `backend/api/src/routes/kb.routes.ts`

**배치 INSERT (Before→After):**
```typescript
// Before: O(n) round trips
for (const item of embeddings) {
  await this.query('INSERT INTO vector_embeddings ...', [item.content, item.embedding]);
}

// After: O(n/200) round trips
const batchSize = 200;
for (let i = 0; i < chunks.length; i += batchSize) {
  const batch = chunks.slice(i, i + batchSize);
  const values = batch.map((_, j) => `($${j*6+1}, $${j*6+2}, $${j*6+3}, $${j*6+4}, $${j*6+5}, $${j*6+6})`).join(',');
  const params = batch.flatMap(c => [c.sourceType, c.sourceId, c.chunkIndex, c.content, c.embeddingValue, JSON.stringify(c.metadata ?? {})]);
  await this.query(`INSERT INTO vector_embeddings (...) VALUES ${values}`, params);
}
```

**N:M Knowledge Base SQL:**
```sql
CREATE TABLE IF NOT EXISTS knowledge_collections (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'team', 'public')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_collection_documents (
  collection_id TEXT NOT NULL REFERENCES knowledge_collections(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (collection_id, document_id)
);
```

**성공 기준:**
- 1,000 청크 저장 시간 **50% 이상 단축**
- 문서 1건이 복수 컬렉션에 연결 가능
- 컬렉션 삭제 시 매핑만 삭제, 문서/임베딩 보존

---

#### Week 5 — RAGAs 평가 루프

**신규 파일:**
- `scripts/eval-rag.ts`
- `backend/api/src/__tests__/rag-pipeline.test.ts`

**구현 범위:**
- RAGAs 프레임워크 기반 자동 평가 파이프라인
- 핵심 메트릭: Faithfulness, Answer Relevance, Context Precision, Context Recall
- 기준 질의셋 30개+ 구성
- 3단계 파이프라인 (BM25+Vector → RRF → Reranker) 자동 벤치마크

**성공 기준:**
- 기준 질의셋에서 nDCG@10, MRR@5, Faithfulness 기준선 확립
- Hybrid+RRF+Reranker > Vector-only 수치적 확인
- 성능 SLA 유지 (p95 < 500ms, reranking 포함)

**Phase 2 게이트:**
- RAGAs 기준선 확립 완료
- Hybrid retrieval이 vector-only 대비 측정 가능한 개선 확인

---

### Phase 3: UX + 에코시스템 (4주)

#### Week 1 — Mermaid.js + KaTeX 렌더링 통합

**수정 파일:**
- `frontend/web/public/js/modules/chat.js` — marked 렌더러 확장
- `frontend/web/public/js/modules/sanitize.js` — SVG/math 허용 태그 추가

**추가 파일:**
- `frontend/web/public/vendor/mermaid.min.js` (ESM 비동기 로드)
- `frontend/web/public/vendor/katex.min.js`
- `frontend/web/public/vendor/katex.min.css`

**Mermaid 구현:**
```javascript
const renderer = {
  code(code, language) {
    if (language === 'mermaid') {
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      requestAnimationFrame(() => mermaid.render(id, code));
      return `<div class="mermaid-container" id="${id}">${sanitizeHTML(code)}</div>`;
    }
    return false;
  }
};
```

**KaTeX 구현:**
- 인라인: `$...$` → `katex.render()`
- 블록: `$$...$$` → `katex.render(displayMode: true)`
- 실패 시 원본 텍스트 fallback

**성공 기준:**
- Mermaid 다이어그램 렌더링 + 다크 모드 전환 시 재렌더링
- KaTeX 대표 수식 20종 렌더링 성공
- XSS 필터 우회 없이 동작
- 모바일/데스크톱 레이아웃 정상

---

#### Week 2 — OpenAI 호환 API 계층

**신규 파일:**
- `backend/api/src/routes/openai-compat.routes.ts`
- `backend/api/src/services/OpenAICompatService.ts`

**구현 범위:**
- `POST /v1/chat/completions` — 스트리밍 SSE + 비스트리밍 JSON
- `GET /v1/models` — 사용 가능한 모델 목록
- 기존 JWT + API Key 인증 재활용
- 응답 포맷: OpenAI API 스펙 준수 (id, object, created, model, choices, usage)

**성공 기준:**
- OpenAI Python SDK (`openai.ChatCompletion.create`) 호환
- 스트리밍 응답 (`stream: true`) 정상 동작
- 기존 API 경로와 충돌 없음

---

#### Week 3 — OpenTelemetry 기본 계측

**신규 파일:**
- `backend/api/src/observability/otel.ts`

**수정 파일:**
- `backend/api/src/server.ts` — OTel SDK 초기화
- `backend/api/src/data/models/unified-database.ts` — DB 쿼리 span
- `backend/api/src/sockets/handler.ts` — WebSocket span

**구현 범위:**
- HTTP 요청 trace → LLM 호출 span → RAG 파이프라인 span → DB 쿼리 span
- 구조화된 Winston 로그와 trace_id 연결
- stdout/파일 익스포터 (Jaeger 등 추가 인프라 불필요)
- 샘플링 비율 10% (M4 16GB 리소스 고려)

**성공 기준:**
- HTTP 요청 → DB 쿼리 → WS 메시지가 단일 trace_id로 연결
- 로그에 trace_id/span_id 자동 포함
- 런타임 오버헤드 < 5% (기존 대비)

---

#### Week 4 — QA + 버퍼 + 문서화

**구현 범위:**
- 전체 파이프라인 E2E 스모크 테스트
- API 문서 갱신 (Swagger/OpenAPI)
- 배포 런북 정비
- Phase 1-3 미완료/오버런 항목 흡수

**성공 기준:**
- E2E 스모크 테스트 10개+ 통과
- 모든 신규 API 엔드포인트 Swagger 문서화
- `npm run build && bun test && npm run lint` 전체 green

---

## 5. 보류 항목 및 트리거 조건

| 항목 | 도입 트리거 | 예상 시점 |
|------|-----------|---------|
| **SCIM 2.0** | 엔터프라이즈 고객(100+ 사용자)이 IdP 자동 프로비저닝 요구 시 | 계약 체결 후 |
| **LDAP/AD** | 온프레미스 고객이 AD/LDAP SSO를 필수 요구 시 | 계약 체결 후 |
| **RLS** | 단일 DB 멀티테넌시(tenant_id 분리)로 전환 시 | SaaS 전환 시 |
| **Web Components** | Vanilla JS 컴포넌트 30개+ 초과, 유지보수 비용 측정 가능 시 | 규모 확대 시 |
| **TipTap** | 사용자 피드백으로 리치 텍스트 편집 수요가 확인될 때 | UX 리서치 후 |
| **모노레포 재구조화** | 패키지 수 4개+, 3명+ 개발자, 독립 배포 필요 시 | 조직 성장 시 |
| **사설 npm 레지스트리** | 내부 공용 라이브러리를 여러 프로젝트에서 재사용 시 | 프로젝트 분화 시 |

---

## 6. 리스크 관리

### Phase 1 리스크

| 리스크 | 영향 | 완화 전략 |
|--------|------|---------|
| SSRF 차단 과도 설정 → 정상 URL 차단 | 중 | Allowlist+Denylist 병행, 차단 로그 모니터링, 단계적 롤아웃 |
| BOLA 적용 중 기존 API 호환성 이슈 | 중 | 관리자 예외 정책 명확화, endpoint별 계약 테스트 |
| 벡터 타입 변환 실패 (잘못된 TEXT 데이터) | 고 | CASE 문으로 NULL/빈문자열 처리, 변환 전 dry-run, pgvector 필수화 |

### Phase 2 리스크

| 리스크 | 영향 | 완화 전략 |
|--------|------|---------|
| Hybrid 검색 지연 증가 | 중 | topK 제한, 병렬 검색, EXPLAIN ANALYZE 튜닝 |
| Cross-encoder 지연 (~100ms) | 중 | bypass 플래그 지원, 지연 민감 경로 우회 |
| HNSW 메모리 사용량 (IVFFlat 대비 2-3×) | 중 | 500K 벡터 미만 시 적용, `ef_construction=64` 보수적 설정, 메모리 벤치마크 선행 |
| N:M 스키마 전환 데이터 정합성 | 중 | 마이그레이션 dry-run + 롤백 SQL 사전 준비 |
| 배치 INSERT 실패 시 복구 복잡도 | 저 | 배치 크기 200, 트랜잭션 재시도 정책 |

### Phase 3 리스크

| 리스크 | 영향 | 완화 전략 |
|--------|------|---------|
| Mermaid/KaTeX XSS 표면 확대 | 고 | sanitize 우선, CSP 유지, 허용 태그 최소화 |
| OpenAI 호환 API 스펙 불완전 | 중 | openai Python SDK 호환 테스트, streaming edge case 확인 |
| OTel 계측 런타임 오버헤드 | 중 | 샘플링 비율 10%, 비핵심 span 축소 |

---

## 7. 성공 지표 (KPI)

### Phase 1 완료 (4주 후)
| 지표 | 목표 |
|------|------|
| CI/CD 자동 테스트 게이트 | **활성화** |
| SSRF 차단 테스트 통과율 | **100%** (15개+) |
| BOLA 권한 회귀 테스트 통과율 | **100%** (12개+) |
| 벡터 컬럼 타입 | `vector(768)` 확인 |
| 전체 테스트 수 | **230개+** (기존 205 + 보안 25+) |

### Phase 2 완료 (9주 후)
| 지표 | 목표 |
|------|------|
| Hybrid+RRF Recall@10 향상 | **+15% 이상** (vs vector-only) |
| Reranking 후 MRR@5 향상 | **+10% 이상** (vs RRF only) |
| RAG 검색 p95 latency (reranking 포함) | **500ms 이하** |
| 임베딩 저장 처리량 향상 | **2배 이상** (1,000 청크 기준) |
| N:M 컬렉션 권한 오류 | **0건** |
| RAGAs 기준선 | **확립** (Faithfulness, Relevance, Context Precision) |
| OCR 저품질 텍스트 인입률 | **<5%** |

### Phase 3 완료 (13주 후)
| 지표 | 목표 |
|------|------|
| Mermaid/KaTeX 렌더링 성공률 | **99% 이상** |
| OpenAI SDK 호환 테스트 통과 | **100%** |
| OTel trace 커버리지 (주요 경로) | **90% 이상** |
| 런타임 오버헤드 (OTel 포함) | **<5%** |
| E2E 스모크 테스트 | **전체 통과** |

---

## 8. 의존성 그래프

```
Phase 1 (순차):
  W1 CI/CD → (모든 후속 작업의 테스트 게이트)
  W2 SSRF → (독립)
  W3 BOLA → (독립)
  W4 벡터 스키마 → Phase 2 W1 BM25 선행 조건 아님 (별도 컬럼)

Phase 2 (순차 의존):
  W1 BM25+OCR → W2 Hybrid+RRF (BM25 필요)
  W2 Hybrid+RRF → W3 Cross-encoder+HNSW (RRF 출력이 reranker 입력)
  W3 Cross-encoder → W5 RAGAs (완전한 파이프라인 필요)
  W4 Batch+N:M → W5 RAGAs (N:M 검색도 벤치마크 대상)

Phase 3 (독립 가능):
  W1 Mermaid+KaTeX → (독립)
  W2 OpenAI API → (독립, 기존 ChatService 활용)
  W3 OTel → (독립)
  W4 QA → (모든 항목 후)
```

---

## 부록: 참고 자료

- 연구보고서 1: 「차세대 엔터프라이즈 AI 운영체제: OpenMake LLM의 기술 아키텍처 고도화 및 비즈니스 상용화 전략 심층 연구 보고서」
- 연구보고서 2: 「OpenMake LLM 고도화 보고서: Open WebUI 벤치마크 기반 개선안」
- 프로젝트 분석 문서: `openmake_llm.md` (v1.5.6 소스 전체 분석 보고서)
- Oracle 아키텍처 자문 (2026-03-02, 1차 + 2차)
- OWASP SSRF Prevention: https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs
- pgvector HNSW: https://github.com/pgvector/pgvector#hnsw
- Reciprocal Rank Fusion: https://dev.to/lpossamai/building-hybrid-search-for-rag
- RAGAs: https://docs.ragas.io/
- Cross-encoder Reranking: https://www.sbert.net/docs/cross_encoder/
- OpenTelemetry Node.js: https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
- OpenAI API Reference: https://platform.openai.com/docs/api-reference/chat
