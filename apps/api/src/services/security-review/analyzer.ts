/**
 * ============================================================
 * Security Review Analyzer (P-2)
 * ============================================================
 *
 * 코드 보안 분석 코어. LLM 1-pass 분석 → 결정론 후처리(파싱·거짓양성 필터·
 * 신뢰도 게이트·카테고리 정규화·정렬). 후처리는 순수 함수로 분리하여 LLM 없이 단위 테스트.
 *
 * Harness Engineering: 모델의 산출(findings)을 그대로 믿지 않고, 하니스가
 * 결정론적 필터/게이트로 신뢰도 낮은·노이즈성 결과를 제거한다.
 *
 * @module services/security-review/analyzer
 */

import { LLM_TIMEOUTS } from '../../config/timeouts';
import { resolveRoleClientForUser } from '../model-role-resolver';
import {
    SECURITY_REVIEW_CONFIG,
    VULN_CATEGORIES,
    SEVERITY_RANK,
    FALSE_POSITIVE_RULES,
    type VulnCategory,
} from '../../config/security-review';
import {
    buildSecurityReviewSystemPrompt,
    buildSecurityReviewUserMessage,
} from '../../prompts/security-review-system';
import { createLogger } from '../../utils/logger';

const logger = createLogger('SecurityReview');

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

/** 정규화·검증된 보안 finding */
export interface SecurityFinding {
    category: VulnCategory;
    severity: 'critical' | 'high' | 'medium' | 'low';
    line: number | null;
    title: string;
    description: string;
    exploit_scenario: string;
    confidence: number;
}

export interface SecurityReviewResult {
    summary: string;
    findings: SecurityFinding[];
    /** 후처리 통계 — 투명성/디버깅 */
    stats: { raw: number; droppedFalsePositive: number; droppedLowConfidence: number; kept: number };
}

/** category 문자열을 표준 카테고리로 정규화 (미지 → 'other') */
export function normalizeCategory(raw: unknown): VulnCategory {
    if (typeof raw !== 'string') return 'other';
    const c = raw.toLowerCase().trim().replace(/[\s-]+/g, '_');
    return (VULN_CATEGORIES as readonly string[]).includes(c) ? (c as VulnCategory) : 'other';
}

/** finding 이 거짓양성 룰에 매칭되는지 (category+title+description 대상) */
export function isFalsePositive(f: { category?: unknown; title?: unknown; description?: unknown }): boolean {
    const hay = [f.category, f.title, f.description]
        .map((v) => (typeof v === 'string' ? v : ''))
        .join(' ');
    return FALSE_POSITIVE_RULES.some((r) => r.pattern.test(hay));
}

/**
 * LLM raw 출력에서 finding 배열을 관대하게 파싱.
 * 코드펜스/머리말이 섞여도 첫 JSON 객체를 추출. 실패 시 {summary:'', findings:[]}.
 */
export function parseSecurityFindings(raw: string): { summary: string; findings: unknown[] } {
    if (!raw || !raw.trim()) return { summary: '', findings: [] };
    let text = raw.trim();
    // 코드펜스 제거
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    // 첫 { ... 마지막 } 추출 (관대)
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return { summary: '', findings: [] };
    const slice = text.slice(start, end + 1);
    try {
        const obj = JSON.parse(slice) as { summary?: unknown; findings?: unknown };
        const summary = typeof obj.summary === 'string' ? obj.summary : '';
        const findings = Array.isArray(obj.findings) ? obj.findings : [];
        return { summary, findings };
    } catch {
        return { summary: '', findings: [] };
    }
}

/**
 * raw findings 를 정규화·검증·필터·게이트·정렬한다 (순수 함수).
 *
 * @param rawFindings - 파싱된 finding 후보 배열
 * @param opts - minConfidence/maxFindings
 */
export function postProcessFindings(
    rawFindings: unknown[],
    opts: { minConfidence: number; maxFindings: number },
): { findings: SecurityFinding[]; stats: SecurityReviewResult['stats'] } {
    let droppedFalsePositive = 0;
    let droppedLowConfidence = 0;
    const kept: SecurityFinding[] = [];

    for (const item of rawFindings) {
        if (!item || typeof item !== 'object') continue;
        const f = item as Record<string, unknown>;

        if (isFalsePositive(f)) {
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
        const severity = (VALID_SEVERITIES.has(severityRaw) ? severityRaw : 'medium') as SecurityFinding['severity'];
        const lineNum = Number(f.line);

        kept.push({
            category: normalizeCategory(f.category),
            severity,
            line: Number.isInteger(lineNum) && lineNum > 0 ? lineNum : null,
            title: typeof f.title === 'string' ? f.title.slice(0, 200) : '(제목 없음)',
            description: typeof f.description === 'string' ? f.description.slice(0, 2000) : '',
            exploit_scenario: typeof f.exploit_scenario === 'string' ? f.exploit_scenario.slice(0, 2000) : '',
            confidence: conf,
        });
    }

    // 심각도 → 신뢰도 내림차순 정렬 후 상한 적용
    kept.sort((a, b) => (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || (b.confidence - a.confidence));
    const capped = kept.slice(0, opts.maxFindings);

    return {
        findings: capped,
        stats: {
            raw: rawFindings.length,
            droppedFalsePositive,
            droppedLowConfidence,
            kept: capped.length,
        },
    };
}

export interface AnalyzeInput {
    code: string;
    language?: string;
    filename?: string;
    categories?: string[];
    /** 'review' role 사용자 매핑 해석용 (미지정 시 전역/기본 티어) */
    userId?: string;
}

/**
 * 코드 보안 분석 실행 (LLM 1-pass + 결정론 후처리).
 * 입력 가드(빈/초과)는 호출측(MCP 도구)에서 수행하되, 방어적으로 재확인.
 */
export async function analyzeCode(input: AnalyzeInput): Promise<SecurityReviewResult> {
    const empty: SecurityReviewResult = {
        summary: '', findings: [],
        stats: { raw: 0, droppedFalsePositive: 0, droppedLowConfidence: 0, kept: 0 },
    };
    if (!input.code || !input.code.trim()) return empty;

    const categories = input.categories && input.categories.length > 0 ? input.categories : VULN_CATEGORIES;
    const system = buildSecurityReviewSystemPrompt(categories);
    const user = buildSecurityReviewUserMessage(input.code, input.language, input.filename);

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
            { temperature: SECURITY_REVIEW_CONFIG.temperature },
            undefined,
            { format: 'json' },
        );
        raw = response.content ?? '';
    } catch (e) {
        logger.error('보안 분석 LLM 호출 실패:', e);
        return empty;
    }

    const parsed = parseSecurityFindings(raw);
    const { findings, stats } = postProcessFindings(parsed.findings, {
        minConfidence: SECURITY_REVIEW_CONFIG.minConfidence,
        maxFindings: SECURITY_REVIEW_CONFIG.maxFindings,
    });

    return { summary: parsed.summary, findings, stats };
}
