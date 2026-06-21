/**
 * ============================================================
 * security_review MCP Tool (P-2)
 * ============================================================
 *
 * 사용자가 제공한 코드를 보안 관점으로 분석하는 읽기 전용 도구.
 * analyzer(LLM 1-pass + 결정론 후처리) 를 호출하고 결과를 텍스트로 포맷,
 * audit 로그를 남긴다. 부작용 없음(코드 수정/실행 안 함).
 *
 * @module mcp/security-review-tool
 * @see services/security-review/analyzer.ts
 */

import { MCPToolDefinition, MCPToolResult } from './types';
import { SECURITY_REVIEW_CONFIG } from '../config/security-review';
import { analyzeCode, type SecurityFinding } from '../services/security-review/analyzer';
import { createLogger } from '../utils/logger';

const logger = createLogger('SecurityReviewTool');

function textResult(text: string, isError = false): MCPToolResult {
    return { content: [{ type: 'text', text }], isError };
}

function formatFinding(f: SecurityFinding, idx: number): string {
    const loc = f.line ? ` (line ${f.line})` : '';
    return `### ${idx + 1}. [${f.severity.toUpperCase()}] ${f.title}${loc}\n` +
        `- 카테고리: ${f.category} · 신뢰도: ${f.confidence}/10\n` +
        `- 설명: ${f.description}\n` +
        (f.exploit_scenario ? `- 악용 시나리오: ${f.exploit_scenario}\n` : '');
}

export const securityReviewTool: MCPToolDefinition = {
    tool: {
        name: 'security_review',
        description:
            '제공된 코드의 보안 취약점(SQL injection, command injection, XSS, 인증 우회, 취약한 암호, SSRF, 경로 조작, 하드코딩된 시크릿 등)을 ' +
            '분석합니다. 사용자가 코드의 "보안 점검/취약점 검토/security review"를 요청하면 이 도구를 사용하세요. ' +
            '실제 악용 가능한 고신뢰 항목만 보고하며(거짓양성/DoS/스타일 제외), 코드를 수정하지 않는 읽기 전용 분석입니다. ' +
            '분석할 코드를 code 인자로 전달하세요.',
        inputSchema: {
            type: 'object',
            properties: {
                code: { type: 'string', description: '검토할 소스 코드 (필수)' },
                language: { type: 'string', description: '언어 (예: typescript, python). 선택 — 분석 정확도 향상' },
                filename: { type: 'string', description: '파일명 (선택 — 맥락 제공)' },
            },
            required: ['code'],
        },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        if (!SECURITY_REVIEW_CONFIG.enabled) {
            return textResult('보안 리뷰 기능이 비활성화되어 있습니다 (SECURITY_REVIEW_ENABLED=false).', true);
        }

        const code = typeof args.code === 'string' ? args.code : '';
        if (!code.trim()) return textResult('code 인자가 필요합니다 (검토할 소스 코드).', true);

        const byteLen = Buffer.byteLength(code, 'utf8');
        if (byteLen > SECURITY_REVIEW_CONFIG.maxCodeBytes) {
            return textResult(
                `코드가 너무 큽니다 (${byteLen} bytes > ${SECURITY_REVIEW_CONFIG.maxCodeBytes}). ` +
                `더 작은 단위(파일/함수)로 나누어 다시 요청하세요.`,
                true,
            );
        }

        const language = typeof args.language === 'string' ? args.language : undefined;
        const filename = typeof args.filename === 'string' ? args.filename : undefined;

        const result = await analyzeCode({ code, language, filename });

        // audit (fire-and-forget, 실패해도 결과 반환)
        void (async () => {
            try {
                const { getAuditService } = await import('../services/AuditService');
                await getAuditService().logAudit({
                    action: 'security_review',
                    userId: context?.userId ? String(context.userId) : undefined,
                    resourceType: 'code',
                    details: {
                        filename: filename ?? null,
                        language: language ?? null,
                        bytes: byteLen,
                        findings: result.findings.length,
                        stats: result.stats,
                    },
                });
            } catch (e) {
                logger.warn(`security_review audit 실패: ${e instanceof Error ? e.message : String(e)}`);
            }
        })();

        if (result.findings.length === 0) {
            const noteRaw = result.stats.raw > 0
                ? ` (후보 ${result.stats.raw}건 중 거짓양성 ${result.stats.droppedFalsePositive}·저신뢰 ${result.stats.droppedLowConfidence} 제외)`
                : '';
            return textResult(`🔒 보안 리뷰 결과: 고신뢰 취약점이 발견되지 않았습니다.${noteRaw}\n${result.summary}`);
        }

        const body = result.findings.map(formatFinding).join('\n');
        const header = `🔒 보안 리뷰 결과 — 취약점 ${result.findings.length}건${result.summary ? `\n${result.summary}` : ''}\n`;
        return textResult(`${header}\n${body}`);
    },
};
