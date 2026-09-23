/**
 * kakao-map add-on — 채팅 턴 통합 (2026-09-19, 종전 chat-service 곳곳에 흩어져 있던 지도 처리를 모았다).
 *
 * 지도 렌더 체인: 의도 판정 → 카카오 도구 강제 포함 → 첫 턴 tool_choice 강제 → 도구 결과의 ```kakaomap 블록을
 * 떼어 결정적 첨부(모델에게는 블록을 뺀 텍스트만 — 큰 경로 JSON 을 보면 qwen 이 블록을 반복 복사한다) →
 * 모델이 지어낸 정적 지도 이미지 HTML 제거. 넛지·프롬프트만으론 부족해 각 단계를 결정적으로 강제한다.
 *
 * @module addons/kakao-map/chat-integration
 */
import type { ChatTurnIntegration } from '../../services/chat-service/turn-integrations';
import { MAP_INTENT_PATTERNS, ROUTE_INTENT_PATTERNS } from './config';
import { KAKAO_MAP_SYSTEM_PROMPT, KAKAO_MAP_USER_LOCATION_HINT } from './prompts';

const PLACE_SEARCH_TOOL = 'search-places';
const ROUTE_TOOL = 'find-route';
const MAP_BLOCK_RE = /```kakaomap\s*\n[\s\S]*?```/g;
/** 길이 상한 절단 전 보존용 — 첫 블록 하나 (개행 요구 없음: 직렬화 전 원문 대상) */
const MAP_BLOCK_RAW_RE = /```kakaomap[\s\S]*?```/;
const MAP_DISPLAY_NOTE_RE = /\[지도 표시용[^\]]*\]\s*/g;

const isMapIntent = (message: string): boolean => MAP_INTENT_PATTERNS.some(re => re.test(message));
const isRouteIntent = (message: string): boolean => ROUTE_INTENT_PATTERNS.some(re => re.test(message));

/** 카카오 지도 계열 호스트의 이미지 URL — 모델이 환각으로 지어내는 정적 지도 이미지 src 대상. */
const MAP_IMG_URL_SRC = String.raw`https?:\/\/(?:[a-z0-9-]+\.)*(?:kakao\.com|kakaocdn\.net|daumcdn\.net)\/[^"'\s)>]*`;
/** 위 URL 을 src 로 갖는 <img> 태그. */
const MAP_IMG_TAG_SRC = String.raw`<img\b[^>]*\bsrc=["']${MAP_IMG_URL_SRC}["'][^>]*\/?>`;

/**
 * 모델이 환각으로 만든 카카오 지도 HTML(<a><img></a>·단독 <img>·마크다운 이미지)을 제거한다 —
 * "kakaomap 블록/좌표 직접 작성 금지" 넛지 하에서 qwen 이 존재하지 않는 lmap.kakao.com
 * 정적 이미지 링크로 우회 환각한 라이브 사례(2026-08-20)의 결정적 후처리. 실제 지도는
 * 아래 kakaomapBlocks 결정적 첨부가 담당하므로 이 HTML 은 저장 히스토리에서 제거해도
 * 정보 손실이 없다. 화면(이미 스트리밍된 본문)은 ws-chat-handler 의 done.cleanedContent
 * 교체가 정리한다 (죽은 인용 마커와 동일 패턴).
 */
export function stripHallucinatedMapHtml(content: string): { content: string; removed: number } {
    let removed = 0;
    const count = () => {
        removed++;
        return '';
    };
    let out = content
        .replace(new RegExp(String.raw`<a\b[^>]*>\s*${MAP_IMG_TAG_SRC}\s*<\/a>`, 'gi'), count)
        .replace(new RegExp(MAP_IMG_TAG_SRC, 'gi'), count)
        .replace(new RegExp(String.raw`!\[[^\]]*\]\(\s*${MAP_IMG_URL_SRC}\s*\)`, 'gi'), count);
    if (removed > 0) {
        // 제거로 비어버린 <center> 래퍼와 직후 <br> 잔재 정리.
        out = out.replace(/<center>\s*<\/center>\s*(?:<br\s*\/?>\s*)*/gi, '');
    }
    return { content: out, removed };
}


export const kakaoMapChatIntegration: ChatTurnIntegration = {
    id: 'kakao-map',
    blockLabel: '카카오 지도 블록',

    detectIntent: isMapIntent,

    // cap/relevance 선택에서 누락돼도 지도 렌더 체인(도구포함→tool_choice강제→블록주입)이 끊기지 않게 한다.
    forceIncludeTools(message) {
        const out: Array<{ nameIncludes: string; reason: string }> = [];
        if (isMapIntent(message)) out.push({ nameIncludes: PLACE_SEARCH_TOOL, reason: '지도 의도' });
        if (isRouteIntent(message)) out.push({ nameIncludes: ROUTE_TOOL, reason: '길찾기 의도' });
        return out;
    },

    // 길찾기면 find-route, 그 외 지도면 search-places. 넛지만으론 qwen 이 web_search/자체아티팩트로 이탈한다.
    forcedFirstTurnTool(message, toolNames) {
        if (isRouteIntent(message)) return toolNames.find(n => n.includes(ROUTE_TOOL));
        return isMapIntent(message) ? toolNames.find(n => n.includes(PLACE_SEARCH_TOOL)) : undefined;
    },

    // (qwen 이 web_search 로 이탈하는 문제 보정 — 구 generate_image 도구는 2026-09-12 오케스트레이터로 대체돼 목록에 없음)
    systemPromptParts(req) {
        if (!isMapIntent(req.message ?? '')) return [];
        return [KAKAO_MAP_SYSTEM_PROMPT];
    },

    userLocationHint: () => KAKAO_MAP_USER_LOCATION_HINT,

    // search-places 출력이 길어 블록이 끝에 있으면 길이 상한에 잘리던 문제 — 원문에서 뽑아 앞에 붙인다.
    preserveFromRawResult(rawText) {
        const m = rawText.match(MAP_BLOCK_RAW_RE);
        return m ? `${m[0]}\n\n` : undefined;
    },

    extractBlocks(toolResult) {
        const blocks = [...toolResult.matchAll(MAP_BLOCK_RE)].map(m => m[0]);
        return { blocks, modelFacing: toolResult.replace(MAP_DISPLAY_NOTE_RE, '').replace(MAP_BLOCK_RE, '') };
    },

    scrubFinalContent: stripHallucinatedMapHtml,
};
