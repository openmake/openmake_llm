/**
 * LLM 응답에서 JSON을 추출하는 유틸리티
 *
 * 3단계 파싱 전략:
 * 1. ```json 코드블록 내 JSON 추출
 * 2. Greedy 매칭 (가장 바깥 {} 블록)
 * 3. Non-greedy 폴백 (가장 짧은 {} 블록)
 *
 * @module utils/json-parser
 */
import { createLogger } from './logger';

const logger = createLogger('JsonParser');

/**
 * LLM 응답 텍스트에서 JSON 객체를 추출합니다.
 * 3단계 파싱을 통해 다양한 LLM 출력 형식에 대응합니다.
 *
 * @param response - LLM의 원시 응답 문자열
 * @returns {Record<string, unknown> | null} - 파싱된 JSON 객체, 실패 시 null
 */
export function extractJSONFromResponse(response: string): Record<string, unknown> | null {
    // 1단계: ```json 코드블록 내 JSON 추출 시도
    const codeBlockMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
        try {
            return JSON.parse(codeBlockMatch[1]);
        } catch {
            // 코드블록 내 파싱 실패 시 다음 단계로
        }
    }

    // 2단계: Greedy 매칭 (중첩 브레이스 대응 — 가장 바깥 {} 블록)
    const greedyMatch = response.match(/\{[\s\S]*\}/);
    if (greedyMatch) {
        try {
            return JSON.parse(greedyMatch[0]);
        } catch {
            // greedy 실패 시 non-greedy 시도
        }
    }

    // 3단계: Non-greedy 폴백 (가장 짧은 {} 블록)
    const lazyMatch = response.match(/\{[\s\S]*?\}/);
    if (lazyMatch) {
        try {
            return JSON.parse(lazyMatch[0]);
        } catch {
            logger.info('JSON 파싱 실패, 응답 일부:', response.substring(0, 200));
        }
    }

    return null;
}
