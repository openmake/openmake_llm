/**
 * 채팅 완료 시점 처리 — done 페이로드의 cleanedContent 계산.
 *
 * ws-chat-handler 에서 분리 (파일 크기 가드 600줄). 판정 로직은 그대로 옮겼다.
 *
 * @module sockets/ws-chat-completion
 */
import { hasScriptMixing } from '../services/chat-service/script-purity';
import { citationMarkersWereCleaned, mapHtmlWasCleaned } from '../services/chat-service/external-deterministic-append';

/**
 * done 에 동봉할 cleanedContent.
 *
 * 클라이언트가 token 단위로 누적한 raw 본문을 backend 의 최종 본문으로 reset 하기 위함.
 * 다음 경우에만 값을 반환하고(그 외 undefined = 변경 없음):
 *   - 아티팩트가 있으면 placeholder 적용 본문으로 교체
 *   - 스크립트 순수성 교정이 실제로 적용된 턴 (스트리밍 화면엔 한자 혼입이 남아 있다)
 *   - 죽은 인용 마커 제거가 적용된 턴 ([출처 N] 수집 목록 밖 번호)
 *   - 지도 환각 HTML 제거가 적용된 턴 (가짜 카카오 이미지 링크가 코드 텍스트로 노출)
 */
export function resolveCleanedContent(params: {
    artifactCount: number;
    finalResponse: string | undefined;
    streamedResponse: string;
}): string | undefined {
    const { artifactCount, finalResponse, streamedResponse } = params;
    if (artifactCount > 0) return finalResponse;
    if (!finalResponse) return undefined;
    const changed = (hasScriptMixing(streamedResponse) && !hasScriptMixing(finalResponse))
        || citationMarkersWereCleaned(streamedResponse, finalResponse)
        || mapHtmlWasCleaned(streamedResponse, finalResponse);
    return changed ? finalResponse : undefined;
}
