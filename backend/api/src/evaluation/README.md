# OpenMake LLM 평가 시스템 (PoC)

회귀 검출 + 라우팅 정확도 측정용 골든셋 기반 평가 도구.

## 디렉토리 구조

```
evaluation/
├── README.md                            # 본 문서
├── types.ts                             # GoldenCase, Summary 타입
├── golden-dataset.json                  # 시드 골든셋 (12건)
├── dataset-loader.ts                    # Zod 검증 + 의미 검증
├── router-evaluator.ts                  # 키워드 라우팅 정확도 평가
├── response-evaluator.ts                # mustContain/mustNotContain 평가
├── semantic-augmented-evaluator.ts      # strict + relaxed 이중 평가
├── real-response-generator.ts           # ChatService 호출 래퍼 (--real)
├── run-evaluation.ts                    # CLI: eval:routing
├── run-augmented-evaluation.ts          # CLI: eval:augmented
└── run-response-evaluation.ts           # CLI: eval:response
```

## 빠른 시작

```bash
cd backend/api

# 1) 라우팅 정확도 (키워드 라우터 평가, 빠름, LLM 비용 0)
npm run eval:routing

# 2) 응답 패턴 (mock generator, LLM 비용 0)
npm run eval:response

# 3) Augmented (Semantic Router 임베딩 호출 발생, 100건 임베딩 + 케이스별 1건)
npm run eval:augmented

# 4) 라우팅 + 응답 묶음
npm run eval:all

# 5) 100% 통과 강제 모드 (CI에서 회귀 즉시 실패)
npm run eval:routing:strict
```

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `OMK_EVAL_PASS_THRESHOLD` | `0.5` | eval:routing 통과 임계값 |
| `OMK_EVAL_AUGMENTED_THRESHOLD` | `0.5` | eval:augmented relaxed 임계값 |
| `OMK_EVAL_RESPONSE_THRESHOLD` | `0.5` | eval:response 통과 임계값 |
| `OMK_EVAL_REAL_TIMEOUT_MS` | `60000` | --real 모드 케이스당 timeout (ms) |
| `OMK_EVAL_REAL_MAX_TOKENS` | `2000` | --real 모드 케이스당 추정 토큰 한도 |
| `OMK_EVAL_REAL_DEFAULT_LIMIT` | `5` | --real 모드 기본 케이스 수 (--limit 미지정 시) |
| `OMK_SEMANTIC_ROUTER_ENABLED` | `(eval:augmented가 강제 true)` | semantic 인덱스 활성화 |
| `OMK_EMBEDDING_MODEL` | `nomic-embed-text` | Ollama 임베딩 모델 |

## 출력

각 CLI는 콘솔에 요약 + `backend/api/logs/{evaluator}-{ISO}-{commit}.json` 파일에 전체 결과 저장.

```json
{
  "meta": {
    "gitCommit": "7fa11f8",
    "nodeVersion": "v22.x",
    "generatedAt": "2026-04-24T12:00:00.000Z"
  },
  "datasetVersion": "0.3.0",
  "totalCases": 8,
  "passedCases": 4,
  "passRate": 0.5,
  "results": [...]
}
```

## 골든셋 작성 가이드

`golden-dataset.json`은 Zod로 검증됩니다. 잘못된 케이스는 로드 시 명확한 에러 throw.

### routing-accuracy
```json
{
  "id": "routing-XXX",
  "category": "routing-accuracy",
  "query": "사용자 입력",
  "expectedAgentIds": ["software-engineer", "backend-developer"],
  "language": "ko",
  "tags": ["coding"]
}
```

- `expectedAgentId` (단일) 또는 `expectedAgentIds` (배열) 둘 다 가능 → 합집합으로 평가
- `expectedCategory` / `expectedCategories`도 동일
- 둘 중 하나는 반드시 명시

### response-pattern
```json
{
  "id": "response-XXX",
  "category": "response-pattern",
  "query": "사용자 입력",
  "mustContain": ["반드시 포함될 substring"],
  "mustNotContain": ["절대 포함되어선 안 될 substring"]
}
```

## 메트릭 해석

### eval:routing
- **통과율**: `expectedAgentIds` 합집합에 키워드 top-1이 포함된 비율
- 이 PoC의 베이스라인은 약 50%

### eval:augmented (가장 가치 있는 메트릭)
- **Strict (top-1)**: 키워드 라우터 절대 정확도
- **Relaxed (top-3)**: Semantic 후보에 정답이 포함된 비율
- **Uplift**: 키워드 실패 + Semantic 성공 = **Semantic Router 본격 통합의 ROI**

### eval:response
- mock 모드는 `MOCK_RESPONSE_RULES` 룰셋 검증 (평가기 자체 동작 확인)
- `--real` 모드는 ChatService를 직접 호출하여 실제 LLM 응답 평가
  - **경고**: 실제 LLM 비용 발생, Ollama API 키 필요 (`.env` 의 `OLLAMA_API_KEY_*`)
  - 운영 사고 방지 4중 가드:
    1. `--real` 명시적 플래그가 있어야만 활성 (기본은 `--mock`)
    2. `--limit N` 또는 `OMK_EVAL_REAL_DEFAULT_LIMIT` (기본 5건)
    3. `OMK_EVAL_REAL_TIMEOUT_MS` (기본 60s) — `AbortController`로 강제 중단
    4. `OMK_EVAL_REAL_MAX_TOKENS` (기본 2000) — `onToken` 누적 char 수의
       보수적 토큰 추정(`chars/3`)이 한도 초과 시 즉시 abort
  - 토큰 추정은 휴리스틱 (정확한 prompt_eval_count/eval_count는 ChatService
    외부로 노출되지 않음). 영문 ~4 char/token이 일반적이므로 `/3`은 빨리
    abort 하는 안전 측 추정.

```bash
# --real 모드 사용 예
ts-node src/evaluation/run-response-evaluation.ts --real            # 처음 5건
ts-node src/evaluation/run-response-evaluation.ts --real --limit 3  # 처음 3건
OMK_EVAL_REAL_TIMEOUT_MS=30000 OMK_EVAL_REAL_MAX_TOKENS=1000 \
  ts-node src/evaluation/run-response-evaluation.ts --real --limit 1
```

## CI 통합 (후속)

```yaml
# 예시 — GitHub Actions
- name: Routing regression check
  run: |
    cd backend/api
    OMK_EVAL_PASS_THRESHOLD=0.5 npm run eval:routing
```

PR마다 `evaluation-{timestamp}-{commit}.json`을 아티팩트로 업로드하면
commit 사이의 통과율 변동을 추적 가능.

## PoC 상태 (마지막 업데이트)

| 항목 | 상태 | 비고 |
|---|---|---|
| 골든셋 50건 (routing 30 + response 20) | ✅ v0.4.0 | 한·영 균형 |
| CI 통합 (Gate 5/6) | ✅ | `.github/workflows/ci.yml` |
| Semantic 임베딩 디스크 캐시 | ✅ | `OMK_SEMANTIC_DISK_CACHE_ENABLED=true` (기본) |
| Auto 토론 알림 메타 이벤트 | ✅ | `onSystemEvent({type:'auto-discussion-activated'})` |
| Promptfoo 통합 | ❌ | 외부 의존성 검토 후 |
| LLM-as-Judge | ❌ | response-pattern 한계 명확해질 때 |
| Admin UI | ❌ | DB 통합 후 |
| JUnit XML 출력 | ❌ | CI 정식 통합 단계 |
| eval:response --real | ✅ | 4중 비용 가드 적용 (timeout, max-tokens, --limit, --real 플래그) |

## 베이스라인 측정값 (v0.4.0)

- `eval:routing`: **50% 통과** (15/30 — Semantic Router 통합으로 개선 예상)
- `eval:response` (mock): **100% 통과** (20/20)

## 후속 작업 우선순위

1. **eval:response --real** — ChatService wrapping + 토큰 비용 가드 (60s timeout, 케이스당 토큰 한도)
2. **Phase 2.5 Prompt DB Registry** — 프롬프트 핫스왑 인프라
3. **운영 오분류 케이스 점진 추가** — 베이스라인 통과율 50%를 지속 향상
4. **Semantic Router 본격 통합** — keyword confidence 낮을 때 자동 fallback (현재는 shadow only)
