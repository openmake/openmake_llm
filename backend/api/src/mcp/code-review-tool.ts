/**
 * ============================================================
 * code_review MCP Tool (P-1)
 * ============================================================
 *
 * 제공된 코드를 다각도(버그/성능/유지보수/에러처리/재사용)로 검토하는 읽기 전용 도구.
 * 보안 취약점은 security_review 가 담당. 코드를 수정하지 않는다.
 *
 * @module mcp/code-review-tool
 * @see services/code-review/reviewer.ts
 */

import { MCPToolDefinition, MCPToolResult } from './types';
import { CODE_REVIEW_CONFIG } from '../config/code-review';
import { reviewCode, type ReviewFinding } from '../services/code-review/reviewer';
import { createLogger } from '../utils/logger';

const logger = createLogger('CodeReviewTool');

function textResult(text: string, isError = false): MCPToolResult {
    return { content: [{ type: 'text', text }], isError };
}

function formatFinding(f: ReviewFinding, idx: number): string {
    const loc = f.line ? ` (line ${f.line})` : '';
    return `### ${idx + 1}. [${f.severity.toUpperCase()}/${f.dimension}] ${f.title}${loc}\n` +
        `- 신뢰도: ${f.confidence}/10\n` +
        `- 설명: ${f.description}\n` +
        (f.suggestion ? `- 개선: ${f.suggestion}\n` : '');
}

export const codeReviewTool: MCPToolDefinition = {
    tool: {
        name: 'code_review',
        description:
            '제공된 코드를 다각도(버그/정확성, 성능, 유지보수성, 에러 처리, 중복·단순화)로 검토합니다. ' +
            '사용자가 코드의 "리뷰/검토/코드 리뷰/개선점 봐줘"를 요청하면 이 도구를 사용하세요. ' +
            '실제 가치 있는 고신뢰 항목만 보고하며(스타일/네이밍 취향 제외), 코드를 수정하지 않는 읽기 전용 분석입니다. ' +
            '보안 취약점 점검은 security_review 도구를 사용하세요. 검토할 코드를 code 인자로 전달하세요.',
        inputSchema: {
            type: 'object',
            properties: {
                code: { type: 'string', description: '리뷰할 소스 코드 (필수)' },
                language: { type: 'string', description: '언어 (예: typescript, python). 선택' },
                filename: { type: 'string', description: '파일명 (선택 — 맥락 제공)' },
            },
            required: ['code'],
        },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        if (!CODE_REVIEW_CONFIG.enabled) {
            return textResult('코드 리뷰 기능이 비활성화되어 있습니다 (CODE_REVIEW_ENABLED=false).', true);
        }

        const code = typeof args.code === 'string' ? args.code : '';
        if (!code.trim()) return textResult('code 인자가 필요합니다 (리뷰할 소스 코드).', true);

        const byteLen = Buffer.byteLength(code, 'utf8');
        if (byteLen > CODE_REVIEW_CONFIG.maxCodeBytes) {
            return textResult(
                `코드가 너무 큽니다 (${byteLen} bytes > ${CODE_REVIEW_CONFIG.maxCodeBytes}). ` +
                `더 작은 단위(파일/함수)로 나누어 다시 요청하세요.`,
                true,
            );
        }

        const language = typeof args.language === 'string' ? args.language : undefined;
        const filename = typeof args.filename === 'string' ? args.filename : undefined;

        const result = await reviewCode({ code, language, filename });

        void (async () => {
            try {
                const { getAuditService } = await import('../services/AuditService');
                await getAuditService().logAudit({
                    action: 'code_review',
                    userId: context?.userId ? String(context.userId) : undefined,
                    resourceType: 'code',
                    details: { filename: filename ?? null, language: language ?? null, bytes: byteLen, findings: result.findings.length, stats: result.stats },
                });
            } catch (e) {
                logger.warn(`code_review audit 실패: ${e instanceof Error ? e.message : String(e)}`);
            }
        })();

        if (result.findings.length === 0) {
            const note = result.stats.raw > 0
                ? ` (후보 ${result.stats.raw}건 중 노이즈 ${result.stats.droppedFalsePositive}·저신뢰 ${result.stats.droppedLowConfidence} 제외)`
                : '';
            return textResult(`✅ 코드 리뷰: 고신뢰 개선 항목이 발견되지 않았습니다.${note}\n${result.summary}`);
        }

        const body = result.findings.map(formatFinding).join('\n');
        const header = `🔎 코드 리뷰 결과 — ${result.findings.length}건${result.summary ? `\n${result.summary}` : ''}\n`;
        return textResult(`${header}\n${body}`);
    },
};
