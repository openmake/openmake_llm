/**
 * 오케스트레이션 배정 벤치마크 — 라벨링 질의셋으로 2단계 측정.
 *
 * Stage A: 프리필터(detectOrchestrationIntents) 정확도 — 순수 함수, 부작용 0
 * Stage B: 모델의 도구 호출 결정 — LiteLLM 게이트웨이 직접 호출로 tool_calls 만 관측
 *          (앱 경로를 타지 않으므로 토론 실행·작업 생성 같은 부작용이 없다)
 *
 * 사용: node scripts/eval/orchestration-dispatch-benchmark.js [variant]
 *   variant: current(기본, 코드의 실제 문구) | v1 | v2 | v3 — description/가이드 A/B 실험용
 *
 * 2026-08-01 실측 (32건 라벨셋, qwen3.6-35b-a3b):
 *   초판         → 프리필터 재현율 65%, 모델 호출률 50%, 종합 59.4%
 *   패턴 교정 후 → 재현율 100%(오탐 0), 호출률 50%
 *   문구 v1      → 호출률 65%   |  v2(강한 명령형) → 55% (역효과)
 *   문구 v3 채택 → 호출률 70~80%, 종합 87.5% — v1 description + "노출 자체가 신호" 가이드
 *
 * ⚠️ LLM 판단은 확률적이라 실행마다 ±5%p 편차가 있다. 변형 비교는 같은 세션에서 연속 실행할 것.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
require(path.join(ROOT, 'node_modules/dotenv')).config({ path: path.join(ROOT, '.env'), quiet: true });

const { detectOrchestrationIntents } = require(path.join(ROOT, 'apps/api/dist/services/chat-service/external-tool-plan'));
const {
    buildStartDiscussionTool, buildDelegateAgentTaskTool, ORCHESTRATION_PROMPT_GUIDE,
} = require(path.join(ROOT, 'apps/api/dist/services/chat-service/orchestration-dispatch'));

const GW = process.env.LLM_BASE_URL;
const KEY = process.env.LLM_API_KEY;
const MODEL = process.env.LLM_DEFAULT_MODEL;

/** 라벨: discussion | delegate | none (기대 배정) */
const QUERIES = [
    // ── 토론이 유용한 질의 (label: discussion) ──
    ['원격근무와 사무실 근무 중 뭐가 나은지 찬반 토론해줘', 'discussion'],
    ['주 4일제 도입, 찬성과 반대 의견을 모두 들어보고 결론 내줘', 'discussion'],
    ['탄소세 도입에 대해 여러 전문가 관점으로 분석해줘', 'discussion'],
    ['전기차 보조금 확대가 옳은가? 다각도로 검토해줘', 'discussion'],
    ['AI 규제를 강화해야 할까 완화해야 할까? 양쪽 입장을 비교해줘', 'discussion'],
    ['수도권 집중 완화 정책의 찬반 논쟁을 정리해줘', 'discussion'],
    ['원전 확대와 재생에너지 전환 중 어느 쪽이 나은지 토론해줘', 'discussion'],
    ['최저임금 인상의 장단점을 여러 시각에서 논의해줘', 'discussion'],
    ['기본소득 도입에 대한 전문가 의견이 갈리는데 정리해줘', 'discussion'],
    ['부동산 규제 강화가 효과적인지 다양한 관점으로 봐줘', 'discussion'],

    // ── 백그라운드 작업 위임이 맞는 질의 (label: delegate) ──
    ['월별 매출 데이터를 정리해서 엑셀 파일로 만들어줘', 'delegate'],
    ['프로젝트 일정표를 CSV 파일로 생성해줘', 'delegate'],
    ['이 데이터를 분석하는 파이썬 스크립트를 작성하고 실행해줘', 'delegate'],
    ['국가별 인구 통계를 정리한 xlsx 파일을 만들어줘', 'delegate'],
    ['로그 파일을 파싱하는 스크립트를 만들어서 돌려줘', 'delegate'],
    ['백그라운드로 대용량 데이터 변환 작업을 처리해줘', 'delegate'],
    ['샘플 JSON 데이터를 만들어서 파일로 저장해줘', 'delegate'],
    ['시간이 오래 걸려도 되니 전체 파일 목록을 정리해서 저장해줘', 'delegate'],
    ['텍스트 파일로 회의록 템플릿을 생성해줘', 'delegate'],
    ['코드를 실행해서 결과를 파일로 남겨줘', 'delegate'],

    // ── 배정하면 안 되는 질의 (label: none) — 오발동 측정 ──
    ['대한민국의 수도는 어디야?', 'none'],
    ['오늘 날씨 어때?', 'none'],
    ['자바스크립트에서 배열을 정렬하는 방법 알려줘', 'none'],
    ['1부터 100까지 더하면 얼마야?', 'none'],
    ['React useEffect 사용법을 간단히 설명해줘', 'none'],
    ['어제 회의 내용 요약해줘', 'none'],
    ['이 문장을 영어로 번역해줘: 안녕하세요', 'none'],
    ['커피와 차의 카페인 함량 차이가 뭐야?', 'none'],
    ['파이썬 리스트 컴프리헨션 예시 보여줘', 'none'],
    ['좋은 아침 인사말 추천해줘', 'none'],
    ['서울에서 부산까지 거리가 얼마나 돼?', 'none'],
    ['깃 브랜치 전략 중 git flow가 뭐야?', 'none'],
];

/** description 변형 — A/B 대상 */
const VARIANTS = {
    current: null, // 현행(코드의 build*Tool 그대로)
    v1: {
        discussion: '여러 전문가의 서로 다른 관점을 모아 결론을 내야 하는 질문에 사용합니다. '
            + '찬반·장단점·다각도 비교가 요구되면 이 도구로 토론을 실행하세요 — 전문가 3명이 자동 선정되어 '
            + '토론 후 합성된 결론을 반환합니다. 단순 사실 질문·설명 요청에는 사용하지 마세요.',
        delegate: '파일을 만들거나 코드를 실행해야 하는 요청에 사용합니다 — 백그라운드 에이전트가 '
            + '샌드박스에서 작업을 수행하고 산출물을 남깁니다. 엑셀·CSV·스크립트·텍스트 파일 생성 요청이면 '
            + '이 도구로 위임하세요. 즉시 말로 답할 수 있는 질문에는 사용하지 마세요.',
    },
    v3: {
        discussion: '여러 전문가의 서로 다른 관점을 모아 결론을 내야 하는 질문에 사용합니다. '
            + '찬반·장단점·다각도 비교가 요구되면 이 도구로 토론을 실행하세요 — 전문가 3명이 자동 선정되어 '
            + '토론 후 합성된 결론을 반환합니다. 단순 사실 질문·설명 요청에는 사용하지 마세요.',
        delegate: '파일을 만들거나 코드를 실행해야 하는 요청에 사용합니다 — 백그라운드 에이전트가 '
            + '샌드박스에서 작업을 수행하고 산출물을 남깁니다. 엑셀·CSV·스크립트·텍스트 파일 생성 요청이면 '
            + '이 도구로 위임하세요. 즉시 말로 답할 수 있는 질문에는 사용하지 마세요.',
        guide: '\n\n[오케스트레이션 배정]\n'
            + '- 이 턴에 제공된 오케스트레이션 도구는 사용자 요청 유형과 이미 일치한다고 판단되어 노출된 것입니다. '
            + '해당 도구가 다루는 작업이면 그 도구로 처리하고, 결과를 사용자에게 정리해 전달하세요.\n'
            + '- start_discussion 은 관점이 갈리는 주제의 결론을 만들 때, delegate_agent_task 는 파일 산출·코드 실행이 '
            + '필요할 때 사용합니다.\n'
            + '- 도구가 다루지 않는 요청이면 평소처럼 직접 답하세요.',
    },
    v2: {
        discussion: '찬반이 갈리거나 관점에 따라 답이 달라지는 주제를 다룰 때 반드시 이 도구를 먼저 호출하세요. '
            + '전문가 3명이 토론해 합성 결론을 돌려줍니다. 사용자가 "짧게"를 요구해도, 논쟁적 주제라면 '
            + '토론 결과를 받아 요약해 답하는 편이 정확합니다. 사실 확인·용어 설명에는 쓰지 마세요.',
        delegate: '산출물(파일)이 필요한 요청이면 반드시 이 도구로 위임하세요 — 직접 본문에 내용을 적는 것으로는 '
            + '파일이 만들어지지 않습니다. 엑셀/CSV/스크립트/문서 생성, 코드 실행, 장시간 처리가 대상입니다. '
            + '설명·질의응답에는 쓰지 마세요.',
    },
};

function buildTools(variant, intents) {
    const tools = [];
    const d = buildStartDiscussionTool();
    const g = buildDelegateAgentTaskTool();
    if (variant) {
        d.function.description = variant.discussion;
        g.function.description = variant.delegate;
    }
    if (intents.discussion) tools.push(d);
    if (intents.taskDelegate) tools.push(g);
    return tools;
}

async function askModel(message, tools) {
    const res = await fetch(`${GW}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
            model: MODEL,
            messages: [
                { role: 'system', content: '당신은 유능한 AI 어시스턴트입니다.' + (global.__GUIDE__ || ORCHESTRATION_PROMPT_GUIDE) },
                { role: 'user', content: message },
            ],
            tools,
            tool_choice: 'auto',
            max_tokens: 120,
            chat_template_kwargs: { enable_thinking: false },
        }),
    });
    const d = await res.json().catch(() => ({}));
    const call = d.choices?.[0]?.message?.tool_calls?.[0]?.function?.name ?? null;
    return call;
}

(async () => {
    const variantName = process.argv[2] || 'current';
    const variant = VARIANTS[variantName];
    if (variant && variant.guide) global.__GUIDE__ = variant.guide;
    console.log(`\n=== 배정 벤치마크 (variant=${variantName}, n=${QUERIES.length}) ===\n`);

    const rows = [];
    for (const [q, label] of QUERIES) {
        const intents = detectOrchestrationIntents(q);
        const exposedNames = [];
        if (intents.discussion) exposedNames.push('start_discussion');
        if (intents.taskDelegate) exposedNames.push('delegate_agent_task');

        let called = null;
        if (exposedNames.length > 0) {
            try { called = await askModel(q, buildTools(variant, intents)); } catch { called = 'ERR'; }
        }
        rows.push({ q, label, exposed: exposedNames, called });
        process.stdout.write('.');
    }
    console.log('\n');

    // ── Stage A: 프리필터 정확도 ──
    const expectedTool = { discussion: 'start_discussion', delegate: 'delegate_agent_task', none: null };
    let aHit = 0, aMiss = 0, aFalse = 0;
    for (const r of rows) {
        const want = expectedTool[r.label];
        if (want === null) { if (r.exposed.length > 0) aFalse++; }
        else if (r.exposed.includes(want)) aHit++;
        else aMiss++;
    }
    const labeled = rows.filter(r => r.label !== 'none').length;
    console.log('── Stage A: 프리필터(노출 게이트) ──');
    console.log(`재현율: ${aHit}/${labeled} (${(100 * aHit / labeled).toFixed(1)}%)  |  미탐 ${aMiss}건`);
    console.log(`오탐(none 인데 노출): ${aFalse}/${rows.filter(r => r.label === 'none').length}건`);
    if (aMiss > 0) {
        console.log('  미탐 질의:');
        rows.filter(r => r.label !== 'none' && !r.exposed.includes(expectedTool[r.label]))
            .forEach(r => console.log(`   - [${r.label}] ${r.q}`));
    }
    if (aFalse > 0) {
        console.log('  오탐 질의:');
        rows.filter(r => r.label === 'none' && r.exposed.length > 0)
            .forEach(r => console.log(`   - ${r.q} → ${r.exposed.join(',')}`));
    }

    // ── Stage B: 모델 호출률 (노출된 것 중) ──
    const exposedRows = rows.filter(r => r.exposed.length > 0);
    const correctCall = exposedRows.filter(r => r.called === expectedTool[r.label]).length;
    const noCall = exposedRows.filter(r => r.called === null).length;
    const wrongCall = exposedRows.filter(r => r.called && r.called !== expectedTool[r.label]).length;
    console.log('\n── Stage B: 모델 호출 결정 (노출된 턴 한정) ──');
    console.log(`노출 ${exposedRows.length}건 중 정호출 ${correctCall} (${(100 * correctCall / exposedRows.length).toFixed(1)}%) | 미호출 ${noCall} | 오호출 ${wrongCall}`);
    if (noCall > 0) {
        console.log('  미호출(튜닝 반례):');
        exposedRows.filter(r => r.called === null).forEach(r => console.log(`   - [${r.label}] ${r.q}`));
    }

    console.log('\n── 종합 (프리필터×모델 = 최종 배정 정확도) ──');
    const finalOk = rows.filter(r => (r.called ?? null) === expectedTool[r.label]).length;
    console.log(`${finalOk}/${rows.length} (${(100 * finalOk / rows.length).toFixed(1)}%)\n`);
})();
