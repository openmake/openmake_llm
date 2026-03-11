/**
 * ============================================================
 * OCRQualityGate - OCR 텍스트 품질 분석 및 게이트
 * ============================================================
 *
 * OCR로 추출된 텍스트의 품질을 정량적으로 평가합니다.
 * RAG 파이프라인에서 저품질 텍스트를 사전 차단하여
 * 임베딩 및 검색 품질을 보장합니다.
 *
 * @module services/OCRQualityGate
 */

import { createLogger } from '../../utils/logger';

const logger = createLogger('OCRQualityGate');

/**
 * 텍스트 품질 측정 메트릭
 */
export interface TextQualityMetrics {
    /** 인쇄 가능 문자 비율 (0.0~1.0). >0.85 양호 */
    printableCharRatio: number;
    /** U+FFFD (유니코드 대체 문자) 비율 (0.0~1.0). <0.05 양호 */
    unicodeReplacementRatio: number;
    /** 고유 토큰 / 전체 토큰 비율 (0.0~1.0). >0.3 양호 */
    tokenDiversity: number;
    /** 평균 단어 길이. 2~15 범위가 정상 */
    avgWordLength: number;
    /** 전체 문자 수 */
    totalChars: number;
}

/**
 * OCR 품질 임계값
 */
export interface QualityThresholds {
    /** 인쇄 가능 문자 비율 최소값 (기본: 0.85) */
    minPrintableCharRatio: number;
    /** 유니코드 대체 문자 비율 최대값 (기본: 0.05) */
    maxUnicodeReplacementRatio: number;
    /** 토큰 다양성 최소값 (기본: 0.3) */
    minTokenDiversity: number;
    /** 최소 텍스트 길이 (기본: 10) */
    minTextLength: number;
}

/**
 * 품질 평가 결과
 */
export interface QualityAssessment {
    /** 품질 통과 여부 */
    acceptable: boolean;
    /** 품질 메트릭 */
    metrics: TextQualityMetrics;
    /** 거부 사유 (통과 시 빈 배열) */
    reasons: string[];
}

/** 기본 임계값 */
const DEFAULT_THRESHOLDS: QualityThresholds = {
    minPrintableCharRatio: 0.85,
    maxUnicodeReplacementRatio: 0.05,
    minTokenDiversity: 0.3,
    minTextLength: 10,
};

/**
 * 인쇄 가능 문자 판별 (ASCII 제어 문자 제외, 공백/탭/줄바꿈은 허용)
 *
 * 인쇄 가능 범위:
 * - U+0009 (Tab), U+000A (LF), U+000D (CR)
 * - U+0020 ~ U+007E (ASCII printable)
 * - U+00A0 이상 (다국어 문자 — 한국어, 일본어, 중국어 등)
 */
function isPrintableChar(code: number): boolean {
    if (code === 0x09 || code === 0x0A || code === 0x0D) return true;
    if (code >= 0x20 && code <= 0x7E) return true;
    if (code >= 0x00A0) return true;
    return false;
}

/**
 * 텍스트 품질 메트릭을 계산합니다.
 *
 * @param text - 분석할 텍스트
 * @returns 텍스트 품질 메트릭
 */
export function assessTextQuality(text: string): TextQualityMetrics {
    if (text.length === 0) {
        return {
            printableCharRatio: 0,
            unicodeReplacementRatio: 0,
            tokenDiversity: 0,
            avgWordLength: 0,
            totalChars: 0,
        };
    }

    // 1. 인쇄 가능 문자 비율
    let printableCount = 0;
    let replacementCount = 0;

    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (isPrintableChar(code)) {
            printableCount++;
        }
        // U+FFFD = Unicode Replacement Character (OCR 실패 마커)
        if (code === 0xFFFD) {
            replacementCount++;
        }
    }

    const printableCharRatio = printableCount / text.length;
    const unicodeReplacementRatio = replacementCount / text.length;

    // 2. 토큰 다양성 (공백 기반 단순 토크나이징)
    const tokens = text
        .split(/\s+/)
        .filter(t => t.length > 0);

    const totalTokens = tokens.length;
    const uniqueTokens = new Set(tokens.map(t => t.toLowerCase())).size;
    const tokenDiversity = totalTokens > 0 ? uniqueTokens / totalTokens : 0;

    // 3. 평균 단어 길이
    const totalWordLength = tokens.reduce((sum, t) => sum + t.length, 0);
    const avgWordLength = totalTokens > 0 ? totalWordLength / totalTokens : 0;

    return {
        printableCharRatio,
        unicodeReplacementRatio,
        tokenDiversity,
        avgWordLength,
        totalChars: text.length,
    };
}

/**
 * 텍스트 품질이 허용 가능한지 판정합니다.
 *
 * @param metrics - assessTextQuality()의 결과
 * @param thresholds - 커스텀 임계값 (선택)
 * @returns true: 품질 통과, false: 저품질 거부
 */
export function isTextQualityAcceptable(
    metrics: TextQualityMetrics,
    thresholds?: Partial<QualityThresholds>,
): boolean {
    const t = { ...DEFAULT_THRESHOLDS, ...thresholds };

    if (metrics.totalChars < t.minTextLength) return false;
    if (metrics.printableCharRatio < t.minPrintableCharRatio) return false;
    if (metrics.unicodeReplacementRatio > t.maxUnicodeReplacementRatio) return false;
    if (metrics.tokenDiversity < t.minTokenDiversity) return false;

    return true;
}

/**
 * 텍스트 품질을 종합 평가합니다.
 * 메트릭 계산 + 합격 판정 + 거부 사유를 한 번에 반환합니다.
 *
 * @param text - 분석할 텍스트
 * @param thresholds - 커스텀 임계값 (선택)
 * @returns 품질 평가 결과
 */
export function assessAndGate(
    text: string,
    thresholds?: Partial<QualityThresholds>,
): QualityAssessment {
    const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
    const metrics = assessTextQuality(text);
    const reasons: string[] = [];

    if (metrics.totalChars < t.minTextLength) {
        reasons.push(`텍스트 길이 부족 (${metrics.totalChars}자 < 최소 ${t.minTextLength}자)`);
    }
    if (metrics.printableCharRatio < t.minPrintableCharRatio) {
        reasons.push(
            `인쇄 불가 문자 비율 과다 (printableCharRatio=${metrics.printableCharRatio.toFixed(3)} < ${t.minPrintableCharRatio})`
        );
    }
    if (metrics.unicodeReplacementRatio > t.maxUnicodeReplacementRatio) {
        reasons.push(
            `유니코드 대체 문자(U+FFFD) 과다 (ratio=${metrics.unicodeReplacementRatio.toFixed(3)} > ${t.maxUnicodeReplacementRatio})`
        );
    }
    if (metrics.tokenDiversity < t.minTokenDiversity) {
        reasons.push(
            `토큰 다양성 부족 (diversity=${metrics.tokenDiversity.toFixed(3)} < ${t.minTokenDiversity})`
        );
    }

    const acceptable = reasons.length === 0;

    if (!acceptable) {
        logger.warn(`[OCR 품질 게이트] 저품질 텍스트 거부 (${metrics.totalChars}자): ${reasons.join('; ')}`);
    }

    return { acceptable, metrics, reasons };
}
