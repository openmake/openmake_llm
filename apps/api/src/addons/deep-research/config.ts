/**
 * add-on 설정 (L2) — 종전 config/runtime-limits.ts 에서 옮겼다(2026-09-19). env 이름은 그대로다.
 *
 * @module addons/deep-research/config
 */

import { LLM_TIMEOUTS } from '../../config/timeouts';
import { parseInjectLimit } from '../../config/runtime-limits';

/**
 * Deep Research 기본 검색/소스 파라미터
 */
export const RESEARCH_DEFAULTS = {
    /** 최대 검색 결과 수 */
    MAX_SEARCH_RESULTS: 200,
    /** 최대 전체 소스 수 */
    MAX_TOTAL_SOURCES: 50,
    /** 루프당 최대 스크래핑 수 (env: DEEP_RESEARCH_MAX_SCRAPE_PER_LOOP) */
    MAX_SCRAPE_PER_LOOP: parseInt(process.env.DEEP_RESEARCH_MAX_SCRAPE_PER_LOOP || '15', 10),
    /** 스크래핑 동시 배치 크기 (jsdom CPU 부하 제어) */
    SCRAPE_BATCH_SIZE: 3,
    /** 청크 크기 (소스 개수 기준) */
    CHUNK_SIZE: 6,
    /** 검색 fan-out 동시실행 수 (env: RESEARCH_SEARCH_CONCURRENCY) */
    SEARCH_CONCURRENCY: parseInt(process.env.RESEARCH_SEARCH_CONCURRENCY || '5', 10),
    /**
     * 합성 병렬 동시실행 수 (env: RESEARCH_SYNTHESIS_CONCURRENCY).
     *
     * 로컬 단일 GPU 에서는 동시성을 높여도 이득이 없다 — 같은 청크(30,490자·12,826 토큰, 상한 800)를
     * 동시 5건으로 돌리면 건당 110초, 동시 3건이면 **76초**다(2026-09-13 실측). 6청크 기준 총 시간도
     * 3 쪽이 짧고(2배치×76초), 개별 타임아웃 여유까지 커진다. 외부 provider 는 `synthesisConcurrency()`
     * 가 external hint 와 min 을 취하므로 이 값이 상한이 된다.
     */
    SYNTHESIS_CONCURRENCY: parseInt(process.env.RESEARCH_SYNTHESIS_CONCURRENCY || '3', 10),
    /**
     * 청크 요약 1건의 출력 상한 (토큰). 중간 산출물이라 길 필요가 없다.
     *
     * 상한이 없던 동안 모델이 1,400+ 토큰을 써서 로컬 qwen3.8-27b(~10.7 tok/s)로 단일 123.5초
     * ·동시 5건 최대 129.7초가 걸렸고, 청크 타임아웃(120초)에 **6/6 전멸** → "모든 청크 요약 실패"
     * → 보고서 없이 종료했다(2026-09-13 라이브 실측: 상한 800 이면 72.9초로 통과).
     * env: DEEP_RESEARCH_CHUNK_SUMMARY_MAX_TOKENS
     */
    CHUNK_SUMMARY_MAX_TOKENS: parseInt(process.env.DEEP_RESEARCH_CHUNK_SUMMARY_MAX_TOKENS || '800', 10),
    /**
     * 주제 분해 출력 상한 (토큰) — 유일하게 **JSON 을 파싱하는** 단계라 절단되면 그대로 실패한다.
     *
     * 상한이 없던 동안은 60초 타임아웃을 넘겨 실패했고(분해 타임아웃 120초로 상향), 이어서 500 으로
     * 조인 동안은 `finish_reason=length` 로 배열이 잘려 greedy `/\[[\s\S]*\]/` 가 중첩
     * `searchQueries` 의 닫는 `]` 까지만 잡아 "Expected ',' or '}'" 파싱 실패 → 템플릿 폴백으로
     * 엉뚱한 검색어가 나갔다(2026-09-13 라이브). 같은 프롬프트 실측: 상한 없음 741 토큰·67.4초,
     * 상한 1500 이면 826 토큰·67.1초로 `stop` — 소요는 상한과 무관하므로 실측 최대 위로 둔다.
     * env: DEEP_RESEARCH_DECOMPOSE_MAX_TOKENS
     */
    DECOMPOSE_MAX_TOKENS: parseInt(process.env.DEEP_RESEARCH_DECOMPOSE_MAX_TOKENS || '1500', 10),
    /** 청크 병합(findings) 출력 상한 (토큰). env: DEEP_RESEARCH_MERGE_MAX_TOKENS */
    MERGE_MAX_TOKENS: parseInt(process.env.DEEP_RESEARCH_MERGE_MAX_TOKENS || '1500', 10),
    /** 추가 탐색 필요 판단 출력 상한 (토큰) — yes/no 한 마디면 충분. env: DEEP_RESEARCH_NEED_MORE_MAX_TOKENS */
    NEED_MORE_MAX_TOKENS: parseInt(process.env.DEEP_RESEARCH_NEED_MORE_MAX_TOKENS || '120', 10),
    /** 전체 합성을 실행하기 위한 최소 콘텐츠 길이 (문자). 이 미만이면 경량 합성 */
    MIN_CONTENT_FOR_FULL_SYNTHESIS: 1000,
    /** 보고서 생성 진행률 추정용 예상 출력 글자 수 (라이브 관측 ~20K자 기준, progress 표시 전용) */
    REPORT_EXPECTED_CHARS: 20000,
    /** 검색 쿼리 최대 단어 수 (초과 시 잘림) */
    SEARCH_QUERY_MAX_WORDS: 10,
    /**
     * LLM 분해 결과를 채택하기 위한 최소 유효 서브토픽 수. 미만이면 고정 8개 템플릿으로 폴백.
     * 2026-09-05 (gpt-researcher 대조): 종전 8 — 7개가 와도 통째로 버리고 템플릿으로 갈아끼웠다.
     * 이제 1개라도 유효하면 모델의 분해를 존중한다(템플릿은 파싱 실패·0개일 때만).
     */
    MIN_SUBTOPICS: 1,
    /**
     * 추가 탐색 필요 여부(needsMore) LLM 판정을 건너뛰고 무조건 계속하는 소스 비율 —
     * 누적 소스 < config.maxTotalSources × 이 값 이면 LLM 을 묻지 않는다.
     * (2026-09-05 정정: 종전엔 config 가 아니라 이 모듈 상수 MAX_TOTAL_SOURCES 에 곱해 호출자 override 가 무시됐다)
     */
    NEED_MORE_SKIP_RATIO: 0.6,
    /** 계층적 병합 전환 임계값 (청크 요약 수가 이 값 초과 시 재귀 병합) */
    MAP_REDUCE_THRESHOLD: 8,
    /** 계층적 병합 최대 깊이 (비용/지연 제어) */
    MAX_HIERARCHY_DEPTH: 2,
} as const;

/**
 * DeepResearchStrategy에서 사용하는 파라미터 (chat-strategies/deep-research-strategy.ts)
 * RESEARCH_DEFAULTS보다 공격적인 설정 (WebSocket 스트리밍 기반 deep 모드)
 */
export const RESEARCH_STRATEGY_PARAMS = {
    /** 최대 반복 루프 수 */
    MAX_LOOPS: 5,
    /** 최대 검색 결과 수 */
    MAX_SEARCH_RESULTS: 360,
    /** 최대 전체 소스 수 — 합성·보고서 입력 규모를 좌우(과다 시 보고서 생성 지연). env override 가능. */
    MAX_TOTAL_SOURCES: Number(process.env.DEEP_RESEARCH_MAX_TOTAL_SOURCES) || 50,
    /** 전체 콘텐츠 스크래핑 활성화 */
    SCRAPE_FULL_CONTENT: true,
    /** 루프당 최대 스크래핑 수 */
    MAX_SCRAPE_PER_LOOP: 15,
    /** 청크 크기 (소스 개수 기준) */
    CHUNK_SIZE: 10,
} as const;

/**
 * Deep Research depth별 반복 루프 횟수
 */
export const RESEARCH_DEPTH_LOOPS: Record<string, number> = {
    quick: 1,
    standard: 2,
    deep: 4,
};

/** 관리자 전체 조회(/admin/conversations 리서치 탭, ?viewAll=true) 기본 목록 상한.
 *  RESEARCH_LIST_ALL_DEFAULT 로 오버라이드(기본 200). */
export const RESEARCH_SESSION_LIST_ALL_DEFAULT =
    parseInt(process.env.RESEARCH_LIST_ALL_DEFAULT || '', 10) || 200;

/**
 * Deep Research 인용 검증 (A3)
 *
 * 보고서 본문의 각 주장 문장이 유효한 소스 인덱스를 가리키는 인용 마커
 * (`[출처 N]` / `[Source N]` / `[N]`)를 동반하는지 **결정적(LLM 비용 0)**으로 측정.
 *
 * 측정 범위 = "인용 마커의 존재 + 소스 범위 유효성"뿐.
 * 인용된 소스가 실제로 주장을 뒷받침하는지(groundedness)는 **측정하지 않는다** (LLM-as-judge 영역, A3 범위 밖).
 *
 * services/deep-research/citation-verifier.ts 및 evaluation/citation-evaluator.ts 에서 공유.
 */
export const DEEP_RESEARCH_CITATION = {
    /** 목표 인용 커버리지 (0.0~1.0). 미달 시 경고/플래그 */
    TARGET_COVERAGE: parseFloat(process.env.DEEP_RESEARCH_CITATION_TARGET || '0.95'),
    /** 주장 문장으로 인정할 최소 길이 (헤더/불릿 스캐폴딩 잔여 제거용) */
    MIN_CLAIM_CHARS: 15,
    /** 보고서 step 에 기록할 미인용 문장 샘플 최대 개수 */
    MAX_UNCITED_SAMPLES: 10,
    /** enforce 모드: true 면 미달 시 메타 플래그(본문은 변형하지 않음). 기본 measure-only */
    ENFORCE: process.env.DEEP_RESEARCH_CITATION_ENFORCE === 'true',
    /** SECTION_HEADERS.references 외, 모델이 변형해 쓰는 참고자료 섹션 헤더 보조 목록 */
    EXTRA_REFERENCE_HEADERS: ['참고문헌', '주', '출처', '각주', 'Sources', 'Bibliography', 'Citations'],
} as const;

/**
 * Deep Research 전용 Tavily 보강 — 일반 검색에는 쓰지 않는다 (무료 월 1,000 크레딧 절약).
 * advanced 는 쿼리당 2 크레딧이지만 정제 본문(content)이 실려 와 스크랩 실패를 줄인다.
 */
export const RESEARCH_TAVILY = {
    /** 쿼리당 Tavily 결과 수. 0 = 비활성. env: RESEARCH_TAVILY_MAX_RESULTS */
    MAX_RESULTS: parseInjectLimit(process.env.RESEARCH_TAVILY_MAX_RESULTS, 5),
    /** 검색 깊이 basic(1크레딧)/advanced(2크레딧). env: RESEARCH_TAVILY_DEPTH */
    SEARCH_DEPTH: (process.env.RESEARCH_TAVILY_DEPTH === 'basic' ? 'basic' : 'advanced') as 'basic' | 'advanced',
} as const;

/**
 * 외부 LLM(Anthropic/OpenAI-compat) 경로에서 노출하지 않는 MCP 도구 목록.
 *
 * 본 도구들은 MCP 사양상 등록되어 있으나, 실제 처리는 로컬 LLM 경로의
 * AgentLoopStrategy 가 가로채서 LLMClient.chat(비전 모델) 으로 위임한다
 * (mcp/tools.ts visionOcrTool/analyzeImageTool 핸들러는 안내 문구만 반환하는 stub).
 *
 * 외부 LLM 경로(streamFromExternalProvider)에는 그런 가로채기 레이어가 없어
 * 호출 시 stub 응답만 받게 되므로 토큰 낭비 + 잘못된 답변을 유발한다.
 * 또한 GPT-4o/Claude/Gemini 등 외부 vision 모델은 native 멀티모달이라 별도 OCR 도구가 불필요하다.
 *
 * services/ChatService.ts streamFromExternalProvider 에서 참조한다.
 */
/**
 * 채팅 경로의 외부 provider 실패 → 로컬 기본 모델 폴백 정책.
 *
 * 역할(role) 경로에는 4xx 강등이 있었으나 채팅에는 없어, 기본 모델을 외부로 둔 사용자가
 * 구독 한도(429)·세션 만료(401)를 만나면 대화가 통째로 실패했다(2026-07-26 점검).
 * 스트리밍 도중 교체는 답변이 섞이므로, 폴백은 "첫 토큰 이전"에만 수행한다.
 */
/**
 * 외부 모델 가용성 프로브 (services/model-availability-probe).
 * provider 카탈로그를 최소 요청으로 찔러 실사용 가능 모델만 남기는 점검의 한도.
 */
/**
 * 딥리서치 컨텍스트 (스킬 지식 + MCP 근거 수집).
 * 리서치는 웹검색 전용 파이프라인이라 도구·스킬이 없었다(2026-07-26 점검) — 이 상수들이
 * 도구폭주(전체 카탈로그 전달 시 vLLM 문법 컴파일 101s 실측) 없이 붙이기 위한 상한이다.
 */
export const RESEARCH_CONTEXT = {
    /** MCP 근거 수집 단계 게이트 — RESEARCH_MCP_EVIDENCE=false 로 opt-out */
    MCP_EVIDENCE_ENABLED: process.env.RESEARCH_MCP_EVIDENCE !== 'false',
    /** LLM 에 노출할 관련 도구 상한 (목표 관련성 top-K). RESEARCH_MCP_TOOL_BUDGET */
    MCP_TOOL_BUDGET: parseInt(process.env.RESEARCH_MCP_TOOL_BUDGET || '8', 10),
    /** 1회 수집에서 실행할 도구 호출 상한. RESEARCH_MCP_MAX_CALLS */
    MCP_MAX_CALLS: parseInt(process.env.RESEARCH_MCP_MAX_CALLS || '3', 10),
    /** 수집 턴의 출력 토큰 상한 (도구 호출 인자만 필요). RESEARCH_MCP_MAX_TOKENS */
    MCP_MAX_TOKENS: parseInt(process.env.RESEARCH_MCP_MAX_TOKENS || '1024', 10),
    MCP_MIN_RESULT_CHARS: parseInt(process.env.RESEARCH_MCP_MIN_RESULT_CHARS || '40', 10),
    /** 도구 결과 본문 캡 — 합성 컨텍스트 팽창 방지 */
    MCP_RESULT_CHAR_CAP: parseInt(process.env.RESEARCH_MCP_RESULT_CHAR_CAP || '8000', 10),
    /** 리서치에 부적합해 제외하는 도구 (웹검색은 파이프라인이 이미 수행) */
    MCP_EXCLUDED_TOOLS: (process.env.RESEARCH_MCP_EXCLUDED_TOOLS
        || 'web_search,web_scrape,web_crawl,web_map,extract_webpage,research_topic')
        .split(',').map((s) => s.trim()).filter(Boolean),
} as const;

/** 리서치 입력 절단 상한 */
export const RESEARCH_TRUNCATION = {
    /** Deep Research 소스 콘텐츠 최대 길이 */
    CONTENT_MAX: 5000,
} as const;

/** 리서치 단계별 LLM temperature */
export const RESEARCH_TEMPERATURES = {
    /** 리서치 주제 분해 (DeepResearchService) */
    PLAN: Number(process.env.LLM_TEMP_RESEARCH_PLAN) || 0.3,
    /** 리서치 청크 합성 (DeepResearchService) */
    SYNTHESIS: Number(process.env.LLM_TEMP_RESEARCH_SYNTHESIS) || 0.35,
    /** 리서치 최종 보고서 / 병합 (DeepResearchService) */
    REPORT: Number(process.env.LLM_TEMP_RESEARCH_REPORT) || 0.4,
    /** 리서치 사실 확인 (DeepResearchService) */
    FACT_CHECK: Number(process.env.LLM_TEMP_RESEARCH_FACT_CHECK) || 0.1,
} as const;

/** 리서치 단계별 LLM 호출 타임아웃(ms) */
export const RESEARCH_TIMEOUTS = {
    /**
     * Deep Research 주제 분해 타임아웃 (ms). 출력 상한(DECOMPOSE_MAX_TOKENS)과 짝 — 상한이 바인딩되는
     * 최악의 경우(1500 토큰 × 보수 7 tok/s ≈ 214초)를 덮는다. 라이브 실측은 826 토큰·67초라 평상시엔
     * 닿지 않으며, 타임아웃은 실패 경로에서만 작동한다. env: DEEP_RESEARCH_DECOMPOSE_TIMEOUT_MS
     */
    DECOMPOSE_MS: Number(process.env.DEEP_RESEARCH_DECOMPOSE_TIMEOUT_MS) || 240000,
    /** Deep Research 추가정보 필요 판단 LLM 호출 타임아웃 (ms). env override: DEEP_RESEARCH_NEED_MORE_TIMEOUT_MS */
    NEED_MORE_MS: Number(process.env.DEEP_RESEARCH_NEED_MORE_TIMEOUT_MS) || 30000,
    /**
     * Deep Research 청크 합성 개별 타임아웃 (ms) — 전역 LLM_TIMEOUT과 독립.
     *
     * 소요의 지배 요인은 프리필이 아니라 **디코드**다 — 같은 상한(800 토큰)에서 프롬프트를 절반으로
     * 줄여도 110초 → 89초에 그쳤다(2026-09-13 실측, 동시 5건). 즉 800 토큰 ÷ ~10.7 tok/s ≈ 75초가
     * 바닥이고 프리필은 그 위에 얹힌다. 180초는 이 바닥 대비 여유가 1.6배뿐이라 실제 라이브에서
     * 동시 5건이 **전멸**했다(추정 입력 1.4K~13K 토큰인데도 180.0초 정확히 abort — 문자 기반 입력
     * 추정이 웹 스크래핑 텍스트를 과소평가한다). 품질(상한)을 깎는 대신 여유를 준다.
     * env: DEEP_RESEARCH_CHUNK_TIMEOUT_MS
     */
    SYNTHESIS_PER_CHUNK_MS: Number(process.env.DEEP_RESEARCH_CHUNK_TIMEOUT_MS) || 300000,
    /**
     * Deep Research 청크 병합 타임아웃 (ms) — 청크 요약 6건을 합치므로 프리필이 청크보다 크고
     * 출력 상한도 1500 토큰(≈140초)이다. 240초로는 마진이 없어 같은 라이브에서 함께 실패했다.
     * env: DEEP_RESEARCH_MERGE_TIMEOUT_MS
     */
    SYNTHESIS_MERGE_MS: Number(process.env.DEEP_RESEARCH_MERGE_TIMEOUT_MS) || 400000,
    /**
     * 최종 보고서 생성 타임아웃 — 전용 env(DEEP_RESEARCH_REPORT_TIMEOUT_MS)가 없으면 Base 의 장문 보고서 생성 타임아웃을 따른다.
     */
    REPORT_GENERATION_MS: Number(process.env.DEEP_RESEARCH_REPORT_TIMEOUT_MS) || LLM_TIMEOUTS.REPORT_GENERATION_TIMEOUT_MS,
} as const;
