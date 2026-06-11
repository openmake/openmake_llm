/**
 * Deep Research - 인용 검증기 (A3)
 *
 * 보고서 본문의 각 주장 문장이 **유효한 소스 인덱스를 가리키는 인용 마커**를 동반하는지
 * 결정적(LLM 비용 0)으로 측정한다. 런타임(report-generator)과 오프라인 평가
 * (evaluation/citation-evaluator)가 **동일 함수를 공유**한다.
 *
 * 측정 대상:
 *   - coverage: 인용을 가진 주장 문장 비율
 *   - invalidCitations: 소스 범위(1..sourceCount) 밖을 가리키는 인용 번호
 *
 * 측정하지 않는 것:
 *   - groundedness(인용된 소스가 실제로 주장을 뒷받침하는지) → LLM-as-judge 영역, A3 범위 밖.
 *
 * @module services/deep-research/citation-verifier
 */

import { SECTION_HEADERS } from '../deep-research-prompts';
import { DEEP_RESEARCH_CITATION } from '../../config/runtime-limits';

/** 인용 검증 결과 */
export interface CitationReport {
    /** 인용 커버리지 (citedClaims / totalClaims). 평가 불가(fallback/빈 보고서) 시 null */
    coverage: number | null;
    /** 평가 대상 주장 문장 수 */
    totalClaims: number;
    /** 인용을 가진 주장 문장 수 */
    citedClaims: number;
    /** 본문에서 발견된 총 인용 마커 수 */
    citationCount: number;
    /** 소스 범위(1..sourceCount) 밖을 가리키는 인용 번호 (중복 제거) */
    invalidCitations: number[];
    /** 인용 없는 주장 문장 샘플 (최대 MAX_UNCITED_SAMPLES) */
    uncitedSamples: string[];
    /** 측정이 스킵되었는지 (fallback/빈 보고서) */
    skipped: boolean;
    /** 스킵 사유 */
    skipReason?: string;
    /** 목표 커버리지 충족 여부 (coverage >= TARGET). skipped 면 null */
    meetsTarget: boolean | null;
}

/**
 * 인용 마커 정규식
 * - `[출처 9]`, `[Source 9]`, `[참고 9]`, `[9]`, `[ 9 ]` 매칭 (실제 보고서 형식 혼재 대응)
 * - 쉼표 병기 `[출처 1, 출처 3]`, `[Source 1, 3]`, `[1, 2]` 도 한 그룹으로 매칭 —
 *   괄호당 단일 번호만 인정하면 병기 인용 문장이 미인용으로 오집계된다 (2026-06-11 실측).
 */
const CITATION_RE = /\[\s*(?:출처|참고|각주|source|ref)?\s*\d+(?:\s*,\s*(?:출처|참고|각주|source|ref)?\s*\d+)*\s*\]/gi;
const CITATION_NUM_RE = /\d+/g;

/**
 * 참고자료(References) 섹션 헤더 후보 — SECTION_HEADERS.references(전 언어) + 보조 목록.
 * 이 섹션 이하는 `[N] Title - URL` 형식이 본문 인용과 동일 토큰이므로 반드시 제외해야
 * 커버리지가 부풀려지지 않는다.
 */
function buildReferenceHeaderSet(): string[] {
    const fromSections = Object.values(SECTION_HEADERS).map(h => h.references);
    return [...fromSections, ...DEEP_RESEARCH_CITATION.EXTRA_REFERENCE_HEADERS]
        .map(s => s.trim())
        .filter(Boolean);
}

/**
 * References 섹션 이하를 제거한 본문을 반환.
 * `## 참고 자료`, `## References`, `## 4. 참고문헌`, `## 주` 등 헤더 라인부터 끝까지 절단.
 *
 * 매칭은 **공백 정규화 후 정확 일치**다. `startsWith`를 쓰면 `'주요 발견사항'`(Findings 헤더)이
 * `'주'`에 걸려 본문이 요약에서 잘리는 회귀가 발생하므로 금지. 정규화는 `참고 자료`/`참고자료`
 * 같은 공백 변형만 흡수한다.
 */
function stripReferencesSection(text: string): string {
    const norm = (s: string): string => s.replace(/\s+/g, '');
    const refHeaders = new Set(buildReferenceHeaderSet().map(norm));
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // 마크다운 헤더 라인만 검사: #, ##, ### + (선택) "4." 류 번호
        const m = line.match(/^#{1,4}\s*\d*\.?\s*(.+?)\s*$/);
        if (!m) continue;
        if (refHeaders.has(norm(m[1]))) {
            return lines.slice(0, i).join('\n');
        }
    }
    return text;
}

/**
 * 마크다운 스캐폴딩(헤더/테이블/코드블록/blockquote)을 제거하고 본문 라인만 남긴다.
 * 불릿/번호 리스트는 주장일 수 있으므로 마커만 떼고 텍스트는 보존한다.
 */
function stripScaffolding(text: string): string {
    const lines = text.split('\n');
    const out: string[] = [];
    let inCodeBlock = false;

    for (const raw of lines) {
        const line = raw.trim();
        if (line.startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
        if (inCodeBlock) continue;
        if (!line) continue;
        if (line.startsWith('#')) continue;          // 헤더
        if (line.startsWith('>')) continue;          // blockquote
        if (line.startsWith('|')) continue;          // 테이블 행
        if (/^[-=|:\s]+$/.test(line)) continue;       // 테이블 구분선/수평선
        // 불릿/번호 마커 제거 (텍스트는 유지)
        out.push(line.replace(/^(?:[-*•]\s+|\d+\.\s+)/, ''));
    }
    return out.join('\n');
}

/**
 * 본문을 주장 문장 단위로 분리.
 * - 종결 문장부호(. ! ? 。) 뒤 공백/줄끝 또는 줄바꿈을 경계로 사용.
 * - 한국어 종결('...다.', '...요.')은 마침표에 포함되므로 동일 처리.
 * - MIN_CLAIM_CHARS 미만 조각은 스캐폴딩 잔여로 보고 제외.
 *
 * 주의: 약어(U.S., e.g.)·소수점은 드물게 과분할될 수 있어 문장 경계는 **근사**다.
 */
function splitClaims(text: string): string[] {
    return text
        .split(/(?<=[.!?。])\s+|\n+/)
        .map(s => s.trim())
        .filter(s => s.length >= DEEP_RESEARCH_CITATION.MIN_CLAIM_CHARS);
}

/** 한 문장에서 인용 번호를 모두 추출 (쉼표 병기 그룹은 번호 단위로 전개) */
function extractCitationNumbers(sentence: string): number[] {
    const nums: number[] = [];
    for (const match of sentence.matchAll(CITATION_RE)) {
        for (const n of match[0].match(CITATION_NUM_RE) ?? []) {
            nums.push(parseInt(n, 10));
        }
    }
    return nums;
}

/**
 * 보고서가 fallback/빈 산출물인지 판정 (커버리지 0%로 오탐하지 않기 위함).
 * report-generator 의 실패 메시지(`...실패`, `reportFailed`)와 극단적으로 짧은 본문을 검출.
 */
function isFallbackReport(bodyText: string, claimCount: number): boolean {
    if (claimCount === 0) return true;
    const t = bodyText.trim();
    // 실패/빈 결과 메시지 휴리스틱 (다국어). 길이 임계값은 쓰지 않는다 —
    // 짧지만 정상인 보고서를 0%로 오탐하지 않기 위함.
    if (/(리서치 실패|연구 실패|보고서.*실패|합성.*실패|research failed|report (generation )?failed|no sources)/i.test(t)) {
        return true;
    }
    return false;
}

/**
 * 보고서 본문의 인용 커버리지를 측정한다.
 *
 * @param reportText - 최종 보고서 마크다운 (report-generator 의 summary/content)
 * @param sourceCount - 유효 소스 수 (인용 번호는 1..sourceCount 범위여야 유효)
 * @returns CitationReport
 */
export function verifyCitations(reportText: string, sourceCount: number): CitationReport {
    const emptyReport = (skipReason: string): CitationReport => ({
        coverage: null,
        totalClaims: 0,
        citedClaims: 0,
        citationCount: 0,
        invalidCitations: [],
        uncitedSamples: [],
        skipped: true,
        skipReason,
        meetsTarget: null,
    });

    if (!reportText || !reportText.trim()) {
        return emptyReport('빈 보고서');
    }

    const bodyOnly = stripReferencesSection(reportText);
    const cleaned = stripScaffolding(bodyOnly);
    const claims = splitClaims(cleaned);

    if (isFallbackReport(cleaned, claims.length)) {
        return emptyReport('fallback/빈 보고서 — 커버리지 측정 생략');
    }

    let citedClaims = 0;
    let citationCount = 0;
    const invalid = new Set<number>();
    const uncited: string[] = [];

    for (const claim of claims) {
        const nums = extractCitationNumbers(claim);
        if (nums.length > 0) {
            citedClaims++;
            citationCount += nums.length;
            for (const n of nums) {
                if (n < 1 || n > sourceCount) invalid.add(n);
            }
        } else if (uncited.length < DEEP_RESEARCH_CITATION.MAX_UNCITED_SAMPLES) {
            uncited.push(claim);
        }
    }

    const totalClaims = claims.length;
    const coverage = totalClaims > 0 ? citedClaims / totalClaims : null;

    return {
        coverage,
        totalClaims,
        citedClaims,
        citationCount,
        invalidCitations: Array.from(invalid).sort((a, b) => a - b),
        uncitedSamples: uncited,
        skipped: false,
        meetsTarget: coverage === null ? null : coverage >= DEEP_RESEARCH_CITATION.TARGET_COVERAGE,
    };
}
