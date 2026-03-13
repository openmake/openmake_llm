/**
 * @module rag/chunker
 * @description 문서 텍스트를 청크로 분할하는 모듈
 *
 * 단락(\n\n) → 문장(. ) → 문자 경계 순으로 분할 전략을 적용합니다.
 * 청크 간 오버랩을 두어 문맥 유실을 최소화합니다.
 */

import { createLogger } from '../utils/logger';
import { getConfig } from '../config';

const logger = createLogger('Chunker');

export interface TextChunk {
    /** 청크 순서 인덱스 (0부터 시작) */
    index: number;
    /** 청크 텍스트 */
    text: string;
    /** 대략적 토큰 수 (문자 수 / 4 근사치) */
    tokenCount: number;
}

/**
 * 텍스트를 청크로 분할합니다.
 *
 * 분할 전략: 단락(\n\n) → 문장(. ) → 문자 경계 순으로 시도
 *
 * @param text - 분할할 원본 텍스트
 * @param chunkSize - 청크 최대 크기 (문자 수)
 * @param chunkOverlap - 청크 간 오버랩 크기 (문자 수)
 * @returns 분할된 청크 배열
 */
export function chunkText(
    text: string,
    chunkSize?: number,
    chunkOverlap?: number
): TextChunk[] {
    const config = getConfig();
    const maxSize = chunkSize ?? config.chunkSize;
    const overlap = chunkOverlap ?? config.chunkOverlap;

    if (!text || text.trim().length === 0) {
        return [];
    }

    const trimmed = text.trim();

    // 텍스트가 청크 크기보다 작으면 단일 청크로 반환
    if (trimmed.length <= maxSize) {
        return [{
            index: 0,
            text: trimmed,
            tokenCount: estimateTokenCount(trimmed),
        }];
    }

    const chunks: TextChunk[] = [];
    let startPos = 0;

    while (startPos < trimmed.length) {
        let endPos = Math.min(startPos + maxSize, trimmed.length);

        // 텍스트 끝에 도달한 경우
        if (endPos >= trimmed.length) {
            const chunkText = trimmed.substring(startPos).trim();
            if (chunkText.length > 0) {
                chunks.push({
                    index: chunks.length,
                    text: chunkText,
                    tokenCount: estimateTokenCount(chunkText),
                });
            }
            break;
        }

        // 최적 분할 지점 탐색
        const splitPos = findBestSplitPoint(trimmed, startPos, endPos);
        const chunkContent = trimmed.substring(startPos, splitPos).trim();

        if (chunkContent.length > 0) {
            chunks.push({
                index: chunks.length,
                text: chunkContent,
                tokenCount: estimateTokenCount(chunkContent),
            });
        }

        // 오버랩을 적용하여 다음 시작 위치 결정
        startPos = Math.max(splitPos - overlap, startPos + 1);
    }

    logger.debug(`텍스트 분할 완료: ${trimmed.length}자 → ${chunks.length}개 청크`);
    return chunks;
}

/**
 * 최적의 분할 지점을 찾습니다.
 * 우선순위: 단락 경계(\n\n) → 문장 경계(. ) → 문자 경계
 */
function findBestSplitPoint(text: string, start: number, end: number): number {
    const searchRegion = text.substring(start, end);
    const searchStart = Math.floor(searchRegion.length * 0.5);

    // 1차: 단락 경계 (\n\n)
    const lastParagraph = searchRegion.lastIndexOf('\n\n', searchRegion.length);
    if (lastParagraph > searchStart) {
        return start + lastParagraph + 2;
    }

    // 2차: 문장 경계 (. , ? , ! )
    for (let i = searchRegion.length - 1; i >= searchStart; i--) {
        const char = searchRegion[i];
        if ((char === '.' || char === '?' || char === '!') && i + 1 < searchRegion.length && searchRegion[i + 1] === ' ') {
            return start + i + 2;
        }
    }

    // 3차: 줄바꿈 경계
    const lastNewline = searchRegion.lastIndexOf('\n', searchRegion.length);
    if (lastNewline > searchStart) {
        return start + lastNewline + 1;
    }

    // 4차: 공백 경계
    const lastSpace = searchRegion.lastIndexOf(' ', searchRegion.length);
    if (lastSpace > searchStart) {
        return start + lastSpace + 1;
    }

    // 최후: 문자 경계
    return end;
}

/**
 * 텍스트의 토큰 수를 근사적으로 추정합니다.
 * 한국어/영어 혼합 텍스트를 고려하여 문자 수 / 3으로 추정합니다.
 */
function estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 3);
}
