/**
 * 외부 provider 시스템 프롬프트 조립 — external-provider 에서 분리 (파일 크기 가드).
 *
 * 정적 헌법(가드·아티팩트 가이드) → DYNAMIC BOUNDARY → 가변(agent/memory/custom/언어/시간/
 * 반환각/웹검색 grounding/모델ID/지도 넛지) 순으로 systemPromptParts 를 조립한다. prefix 캐시
 * 보존을 위해 정적 콘텐츠를 반드시 앞에 둔다(Cache-aware). 동작·순서는 원본과 동일.
 *
 * @module services/chat-service/external-system-prompt
 */
import type { ChatMessageRequest } from '../chat-service-types';
import type { ResolvedProvider } from '../../providers/provider-router';
import { getExternalProviderSystemGuards } from '../../chat/prompt';
import { getCurrentDate } from '../../utils/datetime';
import { getStyleGuard, normalizeStyle } from '../../chat/style';
import type { StreamFromExternalContext } from './external-provider';

/**
 * 외부 provider 요청의 시스템 프롬프트 본문을 조립해 반환. 비면 '' (호출부가 system 미주입).
 * wantsMap 은 호출부에서 계산해 전달(도구 라우팅에도 재사용되므로).
 */
export function buildExternalSystemPrompt(params: {
    req: ChatMessageRequest;
    resolved: ResolvedProvider;
    ctx: StreamFromExternalContext;
    wantsMap: boolean;
}): string {
    const { req, resolved, ctx, wantsMap } = params;
    const systemPromptParts: string[] = [];

    // ════════════════════════════════════════════════════════════════════
    // 정적 헌법 (CACHE PREFIX) — 모든 요청 공통이라 prefix caching hit 을 극대화한다.
    // 가변 데이터를 이 앞에 두면 prefix 가 매 요청 달라져 vLLM/OpenRouter 캐시가 무효화되므로,
    // 정적 콘텐츠(가드·아티팩트 가이드)를 반드시 시스템 프롬프트 맨 앞에 배치한다. (Cache-aware 원칙)
    // ════════════════════════════════════════════════════════════════════
    // 응답 스타일 가드 (concise/verbose) — 정적 prefix 맨 앞에 prepend. default 면 빈 문자열(overhead 0).
    const styleGuard = getStyleGuard(
        normalizeStyle(ctx.style),
        ctx.resolvedLanguage || req.userLanguagePreference || 'en',
    );
    if (styleGuard) {
        systemPromptParts.push(styleGuard.trim());
    }
    const guards = getExternalProviderSystemGuards(ctx.resolvedLanguage || req.userLanguagePreference || 'en');
    if (guards) {
        systemPromptParts.push(guards.trim());
    }
    // 답변 형식 가드 (구조적 질문) — 정적 prefix. prose/concise 면 빈 문자열이라 미주입.
    if (ctx.answerFormatBlock) {
        systemPromptParts.push(ctx.answerFormatBlock.trim());
    }
    // Artifacts guide (디자인시스템·<artifact> 형식) — 정적.
    if (ctx.artifactGuideBlock) {
        systemPromptParts.push(ctx.artifactGuideBlock.trim());
    }

    // ──────────────────── DYNAMIC BOUNDARY ────────────────────
    // 아래는 요청/사용자/세션별 가변 콘텐츠. prefix 캐시 보존을 위해 반드시 정적 헌법 뒤에 배치한다.
    // system 채널이라 위치가 뒤여도(최근일수록 attention↑) 사용자 맥락(memory/custom)의 우선순위는 유지된다.
    if (ctx.agentSystemMessage) {
        systemPromptParts.push(ctx.agentSystemMessage);
    }
    // Cross-conversation Memory + Custom Instructions (claude.ai Memory/Custom Instructions 동등).
    if (ctx.memoryBlock) {
        systemPromptParts.push(ctx.memoryBlock.trim());
    }
    if (ctx.customInstructionsBlock) {
        systemPromptParts.push(ctx.customInstructionsBlock.trim());
    }

    const langCode = ctx.resolvedLanguage || req.userLanguagePreference;
    if (langCode) {
        const langMap: Record<string, string> = {
            ko: '한국어', en: 'English', ja: '日本語', zh: '中文',
            es: 'Español', fr: 'Français', de: 'Deutsch',
        };
        const langName = langMap[langCode] || langCode;
        // 스크립트 순수성 — qwen 이 한국어 답변에 한자·일본어 문자를 섞는 결함
        // (예: 값→值, 소련→ソ連, 냉각→冷却) 완화. 대상 언어 고유 문자로만 작성하고
        // 외래어·고유명사도 대상 언어로 음차한다.
        systemPromptParts.push(
            `Respond in ${langName}. Write using only ${langName}'s native script — do not mix in Chinese characters (unless ${langName} is Chinese) or Japanese kana (unless ${langName} is Japanese); transliterate foreign terms and proper nouns into ${langName}.`,
        );
    }

    // 시간 컨텍스트 (2026-07-04): 일반 채팅 system 에 현재 날짜가 어디에도 없어, 모델이
    // 학습 컷오프나 검색 스니펫의 기사 날짜를 "오늘"로 오인하는 팩트 결함이 있었다
    // (실사례: 7/4 에 "오늘(6월 19일)" 로 응답). answer-composer 경로에만 있던 temporal
    // context 를 메인 채팅 경로에도 주입한다.
    const todayStr = getCurrentDate();
    systemPromptParts.push(
        langCode && langCode !== 'ko'
            ? `Today's date is ${todayStr}. Interpret "current/today/recent" relative to this date; for time-sensitive facts after your training cutoff, rely only on the provided search results — never guess dates. When you cannot verify precise figures or statistics (population, economic indicators, rankings, dates, counts) — especially recent ones — do NOT state exact numbers as fact; acknowledge the uncertainty or recommend checking an official source or enabling web search.`
            : `오늘 날짜는 ${todayStr} 입니다. "현재/오늘/최근"은 이 날짜를 기준으로 판단하고, 학습 지식 이후의 시의성 정보는 제공된 검색 결과에만 근거하세요. 날짜를 추측해 말하지 마세요. 검증할 수 없는 구체적 수치·통계(인구·경제지표·순위·날짜·건수 등, 특히 최근 값)는 정확한 값을 사실로 단정하지 말고, 불확실성을 밝히거나 공식 출처 확인 또는 웹 검색을 권하세요.`,
    );

    // 반-환각(거짓 전제·미확인 개체) — 로컬 채팅 경로엔 buildSystemPrompt 의 환각방지
    // systemRules 가 실리지 않아, 존재하지 않는 인물/직함 등 거짓 전제 질문에 그럴듯한
    // 세부사항을 날조하던 결함 완화(예: "조선 25대 왕 이현종" → 가짜 전기 생성).
    // 도구 미호출(parametric) 경로에도 적용되도록 tool-error anti-fabrication 과 별개로 상시 주입.
    systemPromptParts.push(
        langCode && langCode !== 'ko'
            ? 'Do not fabricate details about specific people, entities, works, events, or identifiers you cannot verify. If a question assumes a fact that may be false (e.g., a person, title, or work that may not exist), do not invent a plausible-sounding answer — state that it cannot be confirmed and suggest verification or web search when appropriate.'
            : '확실히 알지 못하는 특정 인물·개체·작품·사건·식별자의 세부사항을 지어내지 마세요. 질문이 거짓일 수 있는 전제(예: 존재하지 않을 수 있는 인물·직함·작품)를 담고 있으면 그럴듯한 답을 만들어내지 말고, 사실이라면 근거를 제시하되 확인되지 않으면 "확인되지 않는다"고 명확히 밝히고 필요 시 검증이나 웹 검색을 권하세요.',
    );

    // 웹검색 컨텍스트가 있을 때 grounding + 반-환각 지시를 시스템 프롬프트에 보강한다.
    // enhancedMessage(user turn)에 검색 컨텍스트가 이미 포함된 경로(message-pipeline)에서는
    // 지시문만 추가해 중복 주입을 피하고, 직접 경로(enhancedMessage 미설정)에서는
    // 지시 + 컨텍스트를 함께 넣는다. fast 모드(thinking OFF) 모델이 주입 컨텍스트를
    // 무시하고 단정적 오답을 내는 것을 완화 — 최신 사실이 검색 결과에 없으면 추측 대신
    // 불확실성을 인정하도록 유도 (system 채널이라 응답 절제 가드보다 우선 적용).
    if (req.webSearchContext) {
        const groundingDirective =
            '제공된 웹 검색 결과를 최우선 근거로 삼아 정확히 답변하세요. 검색 결과에 없는 사실' +
            '(특히 최신 인물·직위·날짜 등 시의성 정보)은 추측하지 말고, 확인되지 않으면 모른다고 답하세요.';
        systemPromptParts.push(
            ctx.enhancedMessage
                ? groundingDirective
                : `${groundingDirective}\n\n${req.webSearchContext}`,
        );
    }

    systemPromptParts.push(
        `[현재 사용 중인 모델: ${resolved.fullId}] ` +
        `사용자가 모델/provider 정보를 묻는 경우 위 식별자를 그대로 알려주세요.`,
    );

    // 위치/지도 의도면 카카오 장소 검색 도구를 우선 쓰도록 라우팅 넛지 주입.
    // (qwen 이 web_search/generate_image 로 이탈하는 문제 보정 — generate_image 는 별도로 도구 목록에서 제외)
    if (wantsMap) {
        systemPromptParts.push(
            '사용자가 국내(한국) 장소·위치·지도·길찾기를 묻고 있습니다. 이런 질문에는 반드시 ' +
            '카카오 도구(장소는 search-places, 길찾기는 find-route)를 먼저 호출해 실제 데이터를 ' +
            '얻으세요. 웹 검색이나 이미지 생성으로 좌표·위치를 추측하지 마세요. ' +
            '⚠️ 지도는 시스템이 도구 결과로 자동 표시하니, 당신은 kakaomap 코드 블록이나 좌표(lat/lng) ' +
            '목록을 절대 직접 작성하지 마세요. 사람이 읽을 요약(장소명·주소·거리·소요시간 등)만 작성하세요.',
        );
    }

    return systemPromptParts.join('\n\n');
}
