/**
 * ============================================================
 * Code Review Reviewer (P-1)
 * ============================================================
 *
 * 코드 리뷰 코어. LLM 1-pass 다각도 리뷰 → 결정론 후처리(파싱·차원 정규화·
 * 스타일 nitpick 거짓양성 필터·신뢰도 게이트·정렬·상한). 후처리는 순수 함수.
 *
 * @module services/code-review/reviewer
 */

import { LLM_TIMEOUTS } from '../../config/timeouts';
import { resolveRoleClientForUser } from '../model-role-resolver';
import {
    CODE_REVIEW_CONFIG,
    REVIEW_DIMENSIONS,
    REVIEW_SEVERITY_RANK,
    REVIEW_FALSE_POSITIVE_RULES,
    type ReviewDimension,
} from '../../config/code-review';
import { buildCodeReviewSystemPrompt, buildCodeReviewUserMessage } from '../../prompts/code-review-system';
import { createLogger } from '../../utils/logger';

const logger = createLogger('CodeReview');

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

export interface ReviewFinding {
    dimension: ReviewDimension;
    severity: 'critical' | 'high' | 'medium' | 'low';
    line: number | null;
    title: string;
    description: string;
    suggestion: string;
    confidence: number;
}

export interface CodeReviewResult {
    summary: string;
    findings: ReviewFinding[];
    stats: { raw: number; droppedFalsePositive: number; droppedLowConfidence: number; kept: number };
}

/** dimension 정규화 (미지 → 'other') */
export function normalizeDimension(raw: unknown): ReviewDimension {
    if (typeof raw !== 'string') return 'other';
    const d = raw.toLowerCase().trim().replace(/[\s-]+/g, '_');
    return (REVIEW_DIMENSIONS as readonly string[]).includes(d) ? (d as ReviewDimension) : 'other';
}

/** 스타일/취향 nitpick 거짓양성 여부 */
export function isReviewNoise(f: { title?: unknown; description?: unknown; suggestion?: unknown }): boolean {
    const hay = [f.title, f.description, f.suggestion]
        .map((v) => (typeof v === 'string' ? v : ''))
        .join(' ');
    return REVIEW_FALSE_POSITIVE_RULES.some((r) => r.pattern.test(hay));
}

/** LLM raw 출력에서 findings 관대 파싱 */
export function parseReviewFindings(raw: string): { summary: string; findings: unknown[] } {
    if (!raw || !raw.trim()) return { summary: '', findings: [] };
    let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return { summary: '', findings: [] };
    text = text.slice(start, end + 1);
    try {
        const obj = JSON.parse(text) as { summary?: unknown; findings?: unknown };
        return {
            summary: typeof obj.summary === 'string' ? obj.summary : '',
            findings: Array.isArray(obj.findings) ? obj.findings : [],
        };
    } catch {
        return { summary: '', findings: [] };
    }
}

/** raw findings 정규화·검증·필터·게이트·정렬 (순수 함수) */
export function postProcessReview(
    rawFindings: unknown[],
    opts: { minConfidence: number; maxFindings: number },
): { findings: ReviewFinding[]; stats: CodeReviewResult['stats'] } {
    let droppedFalsePositive = 0;
    let droppedLowConfidence = 0;
    const kept: ReviewFinding[] = [];

    for (const item of rawFindings) {
        if (!item || typeof item !== 'object') continue;
        const f = item as Record<string, unknown>;

        if (isReviewNoise(f)) {
            droppedFalsePositive++;
            continue;
        }

        const confidence = Number(f.confidence);
        const conf = Number.isFinite(confidence) ? Math.max(1, Math.min(10, Math.round(confidence))) : 0;
        if (conf < opts.minConfidence) {
            droppedLowConfidence++;
            continue;
        }

        const severityRaw = typeof f.severity === 'string' ? f.severity.toLowerCase().trim() : '';
        const severity = (VALID_SEVERITIES.has(severityRaw) ? severityRaw : 'medium') as ReviewFinding['severity'];
        const lineNum = Number(f.line);

        kept.push({
            dimension: normalizeDimension(f.dimension),
            severity,
            line: Number.isInteger(lineNum) && lineNum > 0 ? lineNum : null,
            title: typeof f.title === 'string' ? f.title.slice(0, 200) : '(제목 없음)',
            description: typeof f.description === 'string' ? f.description.slice(0, 2000) : '',
            suggestion: typeof f.suggestion === 'string' ? f.suggestion.slice(0, 2000) : '',
            confidence: conf,
        });
    }

    kept.sort((a, b) => (REVIEW_SEVERITY_RANK[b.severity] - REVIEW_SEVERITY_RANK[a.severity]) || (b.confidence - a.confidence));
    const capped = kept.slice(0, opts.maxFindings);

    return {
        findings: capped,
        stats: { raw: rawFindings.length, droppedFalsePositive, droppedLowConfidence, kept: capped.length },
    };
}

export interface ReviewInput {
    code: string;
    language?: string;
    filename?: string;
    /** 'review' role 사용자 매핑 해석용 (미지정 시 전역/기본 티어) */
    userId?: string;
}

const EMPTY: CodeReviewResult = {
    summary: '', findings: [],
    stats: { raw: 0, droppedFalsePositive: 0, droppedLowConfidence: 0, kept: 0 },
};

export async function reviewCode(input: ReviewInput): Promise<CodeReviewResult> {
    if (!input.code || !input.code.trim()) return { ...EMPTY };

    const system = buildCodeReviewSystemPrompt();
    const user = buildCodeReviewUserMessage(input.code, input.language, input.filename);

    // 'review' role 해석 (사용자 매핑 → 전역 env → 로컬 default) + 전용 timeout 파생
    const resolved = await resolveRoleClientForUser('review', input.userId);
    const client = resolved.client.derive({ timeout: LLM_TIMEOUTS.REPORT_GENERATION_TIMEOUT_MS });
    let raw = '';
    try {
        const response = await client.chat(
            [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
            { temperature: CODE_REVIEW_CONFIG.temperature },
            undefined,
            { format: 'json' },
        );
        raw = response.content ?? '';
    } catch (e) {
        logger.error('코드 리뷰 LLM 호출 실패:', e);
        return { ...EMPTY };
    }

    const parsed = parseReviewFindings(raw);
    const { findings, stats } = postProcessReview(parsed.findings, {
        minConfidence: CODE_REVIEW_CONFIG.minConfidence,
        maxFindings: CODE_REVIEW_CONFIG.maxFindings,
    });
    return { summary: parsed.summary, findings, stats };
}
