/**
 * ============================================================
 * DocumentChunker - 문서 텍스트 청킹 유틸리티
 * ============================================================
 *
 * RAG 파이프라인용 텍스트 분할 모듈입니다.
 * 문장 경계를 존중하며 지정된 크기의 청크로 텍스트를 분할합니다.
 *
 * @module documents/chunker
 */

import { RAG_CONFIG } from '../config/runtime-limits';

/**
 * 개별 텍스트 청크 인터페이스
 */
export interface TextChunk {
    /** 청크 텍스트 내용 */
    content: string;
    /** 청크 순서 인덱스 (0-based) */
    index: number;
    /** 원본 텍스트에서의 시작 오프셋 (문자) */
    startOffset: number;
    /** 원본 텍스트에서의 끝 오프셋 (문자) */
    endOffset: number;
    /** 청크 메타데이터 */
    metadata: ChunkMetadata;
}

/**
 * 청크 메타데이터
 */
export interface ChunkMetadata {
    /** 전체 청크 수 */
    totalChunks: number;
    /** 원본 텍스트 전체 길이 (문자) */
    originalLength: number;
    /** 청킹에 사용된 설정 */
    chunkSize: number;
    /** 청킹에 사용된 오버랩 크기 */
    overlap: number;
}

/**
 * 청킹 옵션
 */
export interface ChunkOptions {
    /** 청크 크기 (문자 수, 기본값: RAG_CONFIG.CHUNK_SIZE) */
    chunkSize?: number;
    /** 청크 간 오버랩 (문자 수, 기본값: RAG_CONFIG.CHUNK_OVERLAP) */
    overlap?: number;
    /** 문장 경계 존중 여부 (기본값: true) */
    respectSentenceBoundary?: boolean;
}

// 문장 종결 패턴
const SENTENCE_TERMINATORS = /[.!?。！？]\s+/g;

/**
 * 텍스트를 RAG용 청크로 분할합니다.
 *
 * 문장 경계를 존중하여 지정된 크기의 청크로 분할하며,
 * 인접 청크 간 오버랩을 적용하여 문맥 손실을 최소화합니다.
 *
 * @param text - 분할할 원본 텍스트
 * @param options - 청킹 옵션
 * @returns 분할된 텍스트 청크 배열
 */
export function chunkText(text: string, options?: ChunkOptions): TextChunk[] {
    if (!text || text.trim().length === 0) {
        return [];
    }

    const chunkSize = options?.chunkSize ?? RAG_CONFIG.CHUNK_SIZE;
    const overlap = options?.overlap ?? RAG_CONFIG.CHUNK_OVERLAP;
    const respectSentence = options?.respectSentenceBoundary ?? true;

    // 텍스트 정규화: 연속 공백/줄바꿈 정리
    const normalized = text.replace(/\n{3,}/g, '\n\n').trim();

    // 텍스트가 단일 청크에 들어가는 경우
    if (normalized.length <= chunkSize) {
        return [{
            content: normalized,
            index: 0,
            startOffset: 0,
            endOffset: normalized.length,
            metadata: {
                totalChunks: 1,
                originalLength: normalized.length,
                chunkSize,
                overlap,
            },
        }];
    }

    const chunks: TextChunk[] = [];
    let position = 0;

    while (position < normalized.length) {
        let end = Math.min(position + chunkSize, normalized.length);

        // 문장 경계 존중: 청크 끝을 가장 가까운 문장 종결점으로 조정
        if (respectSentence && end < normalized.length) {
            const searchWindow = normalized.substring(position, end);
            let lastTerminator = -1;
            let match: RegExpExecArray | null;
            SENTENCE_TERMINATORS.lastIndex = 0;

            while ((match = SENTENCE_TERMINATORS.exec(searchWindow)) !== null) {
                // 최소 청크 크기의 50% 이상 채워진 경우에만 문장 경계를 적용
                if (match.index + match[0].length >= chunkSize * 0.5) {
                    lastTerminator = match.index + match[0].length;
                }
            }

            if (lastTerminator > 0) {
                end = position + lastTerminator;
            }
        }

        const content = normalized.substring(position, end).trim();

        if (content.length > 0) {
            chunks.push({
                content,
                index: chunks.length,
                startOffset: position,
                endOffset: end,
                metadata: {
                    totalChunks: 0, // 나중에 업데이트
                    originalLength: normalized.length,
                    chunkSize,
                    overlap,
                },
            });
        }

        // 다음 위치: 현재 끝 - 오버랩
        const step = end - position - overlap;
        position += Math.max(step, 1); // 최소 1자씩 전진 (무한루프 방지)
    }

    // totalChunks 업데이트
    const totalChunks = chunks.length;
    for (const chunk of chunks) {
        chunk.metadata.totalChunks = totalChunks;
    }

    return chunks;
}

/**
 * 문서를 RAG용 청크로 분할하고 소스 메타데이터를 첨부합니다.
 *
 * @param text - 문서 텍스트
 * @param source - 문서 출처 (파일명 또는 URL)
 * @param options - 청킹 옵션
 * @returns 소스 정보가 포함된 청크 배열
 */
export function chunkDocument(
    text: string,
    source: string,
    options?: ChunkOptions
): Array<TextChunk & { source: string }> {
    const chunks = chunkText(text, options);
    return chunks.map(chunk => ({ ...chunk, source }));
}
