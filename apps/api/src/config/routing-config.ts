/**
 * ============================================================
 * Routing Config - LLM 라우팅 설정값 (No-Hardcoding Policy)
 * ============================================================
 *
 * LLM 분류기, 에이전트 라우터, 복잡도 평가기의 설정값을 외부화합니다.
 * 환경변수 오버라이드를 지원합니다.
 *
 * @module config/routing-config
 */

// ── LLM Router 설정 ──────────────────────────────────────────

/** LLM 라우터 temperature (결정적 응답용) (env: OMK_ROUTER_TEMPERATURE) */
export const ROUTER_TEMPERATURE =
    Number(process.env.OMK_ROUTER_TEMPERATURE ?? '0.1');

/** LLM 라우터 최대 예측 토큰 수 (env: OMK_ROUTER_NUM_PREDICT) */
export const ROUTER_NUM_PREDICT =
    Number(process.env.OMK_ROUTER_NUM_PREDICT ?? '200');

// ── Agent 라우팅 경량화 (선분류·캐시) — 2026-07-04 ───────────
// LLM 라우팅은 채팅당 ~2-3s + ~2.7k 토큰 고정 비용. 아래 3단계로 호출을 절감:
// 캐시 히트 → 키워드 선분류(고신뢰) → 短문장 직행, 그 외에만 LLM 라우팅.
//
// ⚠️ 이 LLM 라우팅은 레포에 유일하게 남은 **앞단 판단형** LLM 호출이다
// (CLAUDE.md "LLM 판단 경계" 참고). 유지/제거는 실측으로 결정한다 —
// **A/B 대조군에 새 플래그가 필요 없다**: `OMK_AGENT_KEYWORD_PRECLASSIFY_CONFIDENCE=0`
// 으로 두면 키워드 결과가 항상 채택돼 LLM 라우팅 호출이 0 이 된다(폴백 경로와 동일 동작).
// 비교 지표는 TTFT 와 응답 품질이되, 에이전트 선택이 스킬 바인딩(=도구 노출)까지
// 결정하므로(agents/system-prompt.ts) 품질 쪽에 "도구 사용 여부"를 반드시 포함할 것.
// 실측 2026-08-02(2일, 라우팅 54회): 短문장 직행 63% · LLM 호출 26% · 키워드 7% · 캐시 4%.
//
// ── A/B 대조군 실측 (2026-08-02, 골든셋 routing-accuracy 21건) ──────────────
//   방법: OMK_AGENT_ROUTE_CACHE_ENABLED=false 로 캐시를 끄고 별도 프로세스 2개로 실행.
//         A = 현재(임계 0.7), B = OMK_AGENT_KEYWORD_PRECLASSIFY_CONFIDENCE=0(LLM 0회).
//
//              정확도        라우팅 소요(합계)   LLM 발동
//     A(LLM)   18/21  86%    34,413ms           17/21
//     B(키워드) 20/21  95%       294ms            0/21
//
//   → LLM 라우팅이 **더 느리고 더 부정확**했다(117배 느리고 정확도 9%p 낮음).
//     차이 4건 중 3건은 키워드가 이겼다. LLM 은 과하게 구체적인 에이전트를 고르는
//     경향을 보였다(routing-015 product-manager↔ui-ux-designer, routing-016 physicist↔general).
//     반대로 키워드가 general 로 놓친 1건(routing-023 nutritionist)은 LLM 이 잡았다.
//   운영 측 비용: [ChatTiming] prep 기준 요청의 22.2% 에서 발동, 발동 시 p90 1,955ms.
//
//   스킬 바인딩(도구 노출) 축도 같이 쟀다 — 양쪽 모두 21/21 주입되어 **LLM 라우팅이
//   있어야 스킬이 붙는다는 가정은 성립하지 않았다**. 다만 라우팅이 틀리면 그 에이전트의
//   스킬이 통째로 잘못 붙는다(오답 시 관련 없는 컨텍스트 1,600~2,600자 주입, 반대로
//   general 로 뭉개면 필요한 스킬을 놓침). 잘못된 스킬 주입: A 3건 / B 1건.
//
// ── 운영 트래픽 성격 (2026-08-02, 라우팅 129회) ─────────────────────────────
//   경로: 短문장 직행 48% · 키워드 폴백 15% · 키워드 선분류 14% · LLM 라우팅 10% · 캐시 10%
//   (재측정: scripts/analyze-agent-routing.sh — 첫 집계는 '키워드 폴백' 경로를 세지 못해
//    비율이 어긋났다. LLM 발동 건수·성격 분해는 아래 그대로 유효하다.)
//   LLM 발동 14건을 키워드 결과와 대조하면:
//     · 키워드와 **같은 답** 5건 — 키워드가 이미 정답을 냈는데 신뢰도가 임계(0.7) 미달이라
//       LLM 을 또 부른 순수 낭비 (건당 약 2초)
//     · LLM 이 개선 4건 — 키워드가 general(0.3, 무매칭) 로 뭉갠 질의를 구체 에이전트로 승격
//     · LLM 이 헛짚음 5건 — 예: "일본 금리 정책 검색해줘" → real-estate-analyst(신뢰도 0.95)
//   즉 14건 중 9건(64%)에서 값을 하지 못했고, 갈리는 지점은 **키워드 신뢰도**였다:
//     0.35~0.67 구간(9건)은 LLM 이 무익, 0.30(무매칭 5건)에서만 개선이 나왔다.
//
//   → 제거보다 **임계 조정**이 먼저다. AGENT_KEYWORD_PRECLASSIFY_CONFIDENCE 를
//     0.7 → 0.35 로 낮추면 낭비 구간을 걷어내고 무매칭 질의에만 LLM 이 남는다(코드 변경 0).
//
// ── 임계 0.35 적용 결과 (2026-08-22 검토, 적용은 2026-08-02) ─────────────────
//   운영 `.env` 에 OMK_AGENT_KEYWORD_PRECLASSIFY_CONFIDENCE=0.35 적용됨(기본값 0.7 은
//   그대로 — 아래 상수의 fallback 은 미설정 배포용). 일일 집계 3일치(08-19~21, 라우팅
//   473회 / LLM 발동 103건, scripts/daily-routing-report.sh):
//
//                        조정 전(08-02)      조정 후(08-19~21)
//     순수 낭비           36% (5/14)         7~8% (8/103)
//     무매칭에서 발동      36% (5/14)         78~85%
//     LLM 발동 비중        10%                20~22%
//
//   → **의도대로 동작한다.** 낭비 구간(키워드가 이미 정답을 냈는데 신뢰도 미달로 LLM 을
//     또 부르던 0.35~0.67)이 사라지고, 이제 사실상 "키워드가 무엇이든 매칭하면 채택,
//     무매칭(0.3)이면 LLM" 게이트로 수렴했다. 발동 비중이 되레 는 것은 임계 탓이 아니라
//     트래픽 성격 변화다(URL·첨부 PDF 질의 증가 — 키워드가 못 잡는 부류).
//   비용: prep p50 은 69ms 로 무변(대다수 요청은 영향 없음), 발동분만 p90 ~2.3s.
//
//   남은 LLM 발동 60건 성격: 일반 텍스트 29 · 첨부/PDF 16 · URL 단독 13 · 테스트 2.
//   법령 URL(law.go.kr→labor-lawyer 등)·직장내 성희롱 질의→labor-lawyer 처럼 키워드가
//   general 로 뭉갤 질의를 구체 에이전트로 승격하는 값을 하고 있어 **제거는 반려**.
//   다만 일반 콘텐츠 사이트 URL 단독(brunch·arca·chatgpt/share)은 도메인만 보고 임의로
//   content-writer 를 고르는 경향이라, 더 줄이려면 'URL 단독 질의 LLM 스킵'이 다음 후보다
//   (13/60 = 22%, 건당 ~2s — 이득이 크지 않아 measure-first 대상으로만 남긴다).
//
//   ⚠️ 표본 한계: 위 조정 전 수치(A/B 21건·운영 14건)는 여전히 작고 당일 테스트 질의가
//   섞여 있다. 조정 후 3일치는 운영 트래픽이라 편향은 덜하나 기간이 짧다.

/** 라우팅 결과 LRU 캐시 사용 여부 (env: OMK_AGENT_ROUTE_CACHE_ENABLED, 기본 true) */
export const AGENT_ROUTE_CACHE_ENABLED =
    (process.env.OMK_AGENT_ROUTE_CACHE_ENABLED ?? 'true') === 'true';

/** 키워드 라우터 선분류 채택 임계 신뢰도 — 이상이면 LLM 라우팅 스킵
 *  (env: OMK_AGENT_KEYWORD_PRECLASSIFY_CONFIDENCE, 기본 0.7, 1 초과 값 = 사실상 비활성) */
export const AGENT_KEYWORD_PRECLASSIFY_CONFIDENCE =
    Number(process.env.OMK_AGENT_KEYWORD_PRECLASSIFY_CONFIDENCE ?? '0.7');

/** 短문장 직행 길이 상한 — 이 길이 이하 + 키워드 신호 없음이면 'general' 직행
 *  (env: OMK_AGENT_SHORT_QUERY_MAX_CHARS, 기본 30, 0 = 비활성) */
export const AGENT_SHORT_QUERY_MAX_CHARS =
    Number(process.env.OMK_AGENT_SHORT_QUERY_MAX_CHARS ?? '30');

/** 短문장 직행 시 "키워드 신호 없음"으로 간주할 신뢰도 상한 — 키워드 라우터의
 *  무매칭 기본값(general 0.3) 이하 (env: OMK_AGENT_SHORT_QUERY_KEYWORD_CEILING, 기본 0.3) */
export const AGENT_SHORT_QUERY_KEYWORD_CEILING =
    Number(process.env.OMK_AGENT_SHORT_QUERY_KEYWORD_CEILING ?? '0.3');

// ── URL 단독 질의 LLM 스킵 (2026-08-22) ──────────────────────
// 위 실측에서 남은 LLM 발동 60건 중 13건이 "URL 하나만 붙여넣은" 질의였다. 본문이
// 없으니 LLM 이 볼 수 있는 건 도메인 문자열뿐이고, 실제로 brunch·arca·chatgpt/share
// 같은 일반 콘텐츠 사이트는 근거 없이 content-writer 로 뭉쳤다(건당 ~2s 낭비).
//
// ⚠️ 단, 같은 13건 중 6건은 법령 포털(law.go.kr·easylaw.go.kr)이었고 LLM 이 법률
// 에이전트로 올바로 승격했다. 일괄 스킵하면 이 값까지 잃는다 — 키워드 라우터는
// 호스트명에서 신호를 전혀 못 잡는 것을 실측으로 확인했다(law/easylaw 모두 general 0.3).
// 그래서 스킵과 함께 **도메인 힌트 맵**을 둔다: 알려진 도메인은 LLM 없이 결정적으로
// 해당 에이전트로 보내고(0ms), 모르는 도메인만 general 로 보낸다.
// 힌트가 LLM 보다 나은 이유 — 같은 답을 2초 없이 내고, 도메인당 답이 고정된다.

/** URL 단독 질의에서 LLM 라우팅을 건너뛸지 (env: OMK_AGENT_URL_ONLY_SKIP, 기본 true) */
export const AGENT_URL_ONLY_SKIP =
    (process.env.OMK_AGENT_URL_ONLY_SKIP ?? 'true') === 'true';

/**
 * URL 단독 질의의 도메인 → 에이전트 힌트. 키는 호스트 접미사(서브도메인 무관 매칭).
 * 실측(2026-08-19~21) 에서 LLM 이 반복해서 같은 답을 낸 도메인만 넣는다 —
 * 추측으로 채우면 잘못된 스킬을 결정적으로 주입하게 되므로 근거 있는 것만.
 * env `OMK_AGENT_URL_DOMAIN_HINTS` 로 오버라이드 (형식: "domain=agentId,domain=agentId").
 */
export const AGENT_URL_DOMAIN_HINTS: Record<string, string> = (() => {
    const base: Record<string, string> = {
        // 국가법령정보센터·찾기쉬운 생활법령 — 법령 원문 링크. LLM 은 labor/corporate 로
        // 갈렸는데 둘 다 특정 분야 포털이 아니라, 분야 중립인 compliance-officer 로 둔다.
        'law.go.kr': 'compliance-officer',
        'easylaw.go.kr': 'compliance-officer',
    };
    const raw = process.env.OMK_AGENT_URL_DOMAIN_HINTS;
    if (!raw) return base;
    const parsed: Record<string, string> = {};
    for (const pair of raw.split(',')) {
        const [domain, agentId] = pair.split('=').map((s) => s.trim());
        if (domain && agentId) parsed[domain.toLowerCase()] = agentId;
    }
    return Object.keys(parsed).length > 0 ? parsed : base;
})();

// ── Complexity Assessor 설정 ─────────────────────────────────

/** GV 건너뛰기 임계값 - 이 점수 미만이면 Generate-Verify 생략 (env: OMK_GV_SKIP_THRESHOLD) */
export const GV_SKIP_THRESHOLD =
    Number(process.env.OMK_GV_SKIP_THRESHOLD ?? process.env.OMK_A2A_SKIP_THRESHOLD ?? '0.3');

/** 복잡도 시작 점수 */
export const COMPLEXITY_NEUTRAL_SCORE = 0.5;

/** 복잡도 시그널 가중치 */
export const COMPLEXITY_WEIGHTS = {
    /** 매우 짧은 쿼리 (< 30자) 감점 */
    VERY_SHORT_PENALTY: -0.3,
    /** 짧은 쿼리 (< 50자) 감점 */
    SHORT_PENALTY: -0.1,
    /** chat 타입 감점 */
    CHAT_TYPE_PENALTY: -0.2,
    /** 낮은 신뢰도 감점 */
    LOW_CONFIDENCE_PENALTY: -0.1,
    /** 긴 쿼리 (> 200자) 가점 */
    LONG_QUERY_BONUS: 0.2,
    /** 여러 패턴 매칭 가점 */
    MULTIPLE_PATTERNS_BONUS: 0.2,
    /** 코드 블록 포함 가점 */
    CODE_BLOCK_BONUS: 0.3,
    /** 이미지 포함 가점 */
    HAS_IMAGES_BONUS: 0.2,
    /** 문서 포함 가점 */
    HAS_DOCUMENTS_BONUS: 0.2,
    /** 긴 대화 이력 가점 */
    LONG_HISTORY_BONUS: 0.1,
    /** 복잡한 쿼리 타입 가점 */
    COMPLEX_TYPE_BONUS: 0.1,
    /** 쿼리 길이 임계값 - 매우 짧음 */
    VERY_SHORT_THRESHOLD: 30,
    /** 쿼리 길이 임계값 - 짧음 */
    SHORT_THRESHOLD: 50,
    /** 쿼리 길이 임계값 - 김 */
    LONG_THRESHOLD: 200,
    /** 패턴 매칭 최소 개수 */
    MIN_PATTERN_COUNT: 3,
    /** 대화 이력 최소 길이 */
    MIN_HISTORY_LENGTH: 5,
    /** 낮은 신뢰도 임계값 */
    LOW_CONFIDENCE_THRESHOLD: 0.2,
} as const;

// ── Tail 라우팅 게이트 (Stage 1) ─────────────────────────────
// 목표: "복잡한 질문"이 아니라 "모델이 틀릴 것 같고(errorScore) 외부로 검증 가능한(verifiability)"
// 소수 질문만 골라낸다. 아래 값은 셰도우 실측(routing_shadow_decisions Q4)으로 교정할 출발점 —
// "정답 가중치"가 아니라 데이터로 수렴시킬 초기값이다. 감으로 켜지 말 것.

/** tail 판정 임계값 — errorScore 가 이 값 이상이어야 tail 후보 (env: OMK_TAIL_THRESHOLD) */
export const TAIL_THRESHOLD =
    Number(process.env.OMK_TAIL_THRESHOLD ?? '0.55');

/** tail 라우팅 트래픽 상한 (0~1) — 셰도우 관측 후 실제 라우팅 활성화 시 비용 통제용 (env: OMK_TAIL_TRAFFIC_CAP) */
export const TAIL_TRAFFIC_CAP =
    Number(process.env.OMK_TAIL_TRAFFIC_CAP ?? '0.15');

/** 오류가능성(errorScore) 시작 점수 — 대부분 trunk 쪽으로 낮게 시작 */
export const ERROR_LIKELIHOOD_NEUTRAL = 0.30;

/** 오류가능성 시그널 가중치 (감점=모델이 잘함, 가점=틀리기 쉬움) */
export const ERROR_LIKELIHOOD_WEIGHTS = {
    /** 표준 알고리즘/교과서 패턴 — 실측상 단발 만점 → 라우팅 낭비 */
    TEXTBOOK_ALGO: -0.25,
    /** 매우 짧은/인사성 쿼리 */
    VERY_SHORT: -0.20,
    /** 주관 질문("네 생각은") — 검증 수단 없음 */
    SUBJECTIVE: -0.15,
    /** 다중 제약 동시충족 — 단발이 조건 일부 흘림 */
    MULTI_CONSTRAINT: 0.25,
    /** 검증가능 팩트 주장(버전·API·수치) — 실측 유일 교정 사례 유형 */
    VERIFIABLE_FACT: 0.20,
    /** novelty/OOD (프로젝트 고유어·비표준 스펙) — 교과서 밖에서만 틀림 */
    NOVELTY_OOD: 0.20,
    /**
     * 낮은 분류 신뢰도 — 모델도 헷갈림의 프록시.
     * 2026-07-18 judge 라벨 Q4 실측(n=66)으로 강등: fail 60.6% ≈ baseline 54.2%
     * (변별력 없음). 신호 자체는 계속 발동·적재해 후속 관측은 유지한다.
     */
    LOW_CONFIDENCE: 0.05,
    /** 정확 수치 계산 요구 */
    NUMERIC_EXACT: 0.10,
    /** 매우 짧음 길이 임계값 */
    VERY_SHORT_THRESHOLD: 20,
    /** 낮은 신뢰도 임계값 */
    LOW_CONFIDENCE_THRESHOLD: 0.5,
} as const;

/**
 * Tail 게이트 regex 패턴 — 인라인 금지(No-Hardcoding #6), 여기서 관리.
 * 축 A(오류예측)와 축 B(검증가능성)가 공유한다.
 */
export const TAIL_GATE_PATTERNS = {
    // 축 A
    textbook_algo: /피보나치|정렬|이진\s?탐색|팰린드롬|괄호\s?검사|fizzbuzz|링크드\s?리스트|\bBFS\b|\bDFS\b|two\s?sum|해시맵|스택|큐/i,
    subjective: /어떻게\s?생각|네\s?의견|추천해\s?줘|조언|골라\s?줘|어때\??$/,
    multi_constraint: /(하되|한\s?채|유지하(면서|되)|동시에|반드시).*(그리고|또한|,|하고)|조건.*(모두|전부)/,
    verifiable_fact: /버전|version|\d+\.\d+|지원하(나|는가)|호환|출시|최신|스펙|정확히\s?몇|몇\s?개|얼마/i,
    novelty_ood: /우리\s?(프로젝트|코드|시스템)|이\s?(레포|코드베이스)|사내|커스텀|비표준|엣지\s?케이스/i,
    numeric_exact: /정확히|합계|총합|계산해|나머지|소수점|반올림/,
    // 축 B
    executable_produce: /함수|function|def\s|클래스|class\s|구현|작성해|짜줘|코드|스크립트|정규식|regex|쿼리|\bSQL\b/i,
    executable_pure_hint: /반환|리턴|return|입력|출력|테스트|검증|알고리즘|파싱|변환|계산/i,
    executable_exclude: /브라우저|프론트|배포|인프라|네트워크|파일\s?업로드|서버\s?설정|\bUI\b/i,
    factual_entity: /\b[A-Z][a-zA-Z0-9.+-]{2,}\b|\d+\.\d+|20\d\d년?/,
    factual_exclude: /내\s?생각|어떻게\s?생각|추천해|조언|의견/,
    decomposable: /비교|분석|조사|정리해|장단점|트레이드오프|영향|원인|왜\s.*(는|한)가|각각|종합/,
    decomposable_multi: /(그리고|또한|더불어|,).*(하되|하고|반면|대신)/,
} as const;

// ── Keyword Router 설정 ──────────────────────────────────────

/** 카테고리 직접 매칭 부스트 점수 (env: OMK_CATEGORY_BOOST) */
export const CATEGORY_BOOST =
    Number(process.env.OMK_CATEGORY_BOOST ?? '3');

/** 확장 키워드 감쇠 계수 (env: OMK_EXPANDED_DAMPING) */
export const EXPANDED_DAMPING =
    Number(process.env.OMK_EXPANDED_DAMPING ?? '0.3');

// Vector cache (L1.5) / embedding 인프라는 2026-05-19 제거됨.
// 사유: 단일 모델 환경에서 LLM classifier 자동 우회로 호출 0건 — dead code.
// 재도입 시: VECTOR_CACHE_* 환경변수 + embedding 모델 + LLMClient.embed() 복원 필요.
