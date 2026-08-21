/**
 * LLM 기반 CLAUDE.md 컨벤션 audit.
 *
 * 입력: SKILL.md 의 YAML frontmatter + Markdown body
 * 출력: ConventionFinding[] — severity('info'|'warn'|'error') + rule + message
 *
 * @module agents/git-ingest/convention-checker
 */
import type { LLMClient } from '../../llm/client';
import type { ChatMessage } from '../../llm/types';
import { createLogger } from '../../utils/logger';
import { CONVENTION_CHECK_LIMITS } from '../../config/runtime-limits';
import { MCP_INGEST } from '../../config/constants';
import { CONVENTION_CHECKER_SYSTEM_PROMPT } from '../../prompts/convention-checker-system';

const logger = createLogger('ConventionChecker');

export interface ConventionFinding {
    severity: 'info' | 'warn' | 'error';
    rule: string;
    message: string;
    snippet?: string;
}

export interface ConventionCheckResult {
    findings: ConventionFinding[];
    tokensUsed: number;
}

const SYSTEM_PROMPT = CONVENTION_CHECKER_SYSTEM_PROMPT;

export class ConventionChecker {
    constructor(private llm: Pick<LLMClient, 'chat'>) {}

    async check(manifestYaml: string, promptBody: string): Promise<ConventionCheckResult> {
        const userContent = `## YAML frontmatter\n\`\`\`yaml\n${manifestYaml.slice(0, CONVENTION_CHECK_LIMITS.MANIFEST_YAML_MAX_CHARS)}\n\`\`\`\n\n## Body\n${promptBody.slice(0, CONVENTION_CHECK_LIMITS.PROMPT_BODY_MAX_CHARS)}`;
        const messages: ChatMessage[] = [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent },
        ];
        try {
            const resp = await this.llm.chat(messages);
            const tokensUsed = resp.metrics?.completion_tokens ?? 0;
            const raw = (resp.content ?? '').trim();
            const fence = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
            const candidate = fence ? fence[1] : raw;
            const parsed = JSON.parse(candidate) as { findings?: ConventionFinding[] };
            const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
            return { findings, tokensUsed };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`convention check LLM parse fail: ${msg}`);
            return {
                findings: [{ severity: 'warn', rule: 'llm-parse-fail', message: `LLM 응답을 파싱할 수 없어 컨벤션 audit 을 건너뜀: ${msg}` }],
                tokensUsed: 0,
            };
        }
    }

    /**
     * MCP server manifest 전용 검사 (Phase 4).
     *
     * 1단계: 정적 위험 명령 룰 (MCP_INGEST.riskyCommandPatterns) — LLM 호출 없이 즉시 평가
     * 2단계: 기존 LLM 기반 컨벤션 audit 재활용 (실패 시 정적 룰 결과는 보존)
     */
    async checkMcpServer(
        manifestYaml: string,
        bodyMarkdown: string,
        execSpec: { command?: string; args?: string[] },
    ): Promise<ConventionCheckResult> {
        const findings: ConventionFinding[] = [];

        const joined = [
            execSpec.command || '',
            ...(execSpec.args || []),
        ].join(' ');

        for (const rule of MCP_INGEST.riskyCommandPatterns) {
            if (rule.pattern.test(joined)) {
                findings.push({
                    severity: rule.severity,
                    rule: rule.rule,
                    message: rule.message,
                    snippet: joined.slice(0, 60),
                });
            }
        }

        try {
            const llmResult = await this.check(manifestYaml, bodyMarkdown);
            findings.push(...llmResult.findings);
            return { findings, tokensUsed: llmResult.tokensUsed };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`mcp-server LLM audit fail: ${msg}`);
            findings.push({
                severity: 'warn',
                rule: 'llm-audit-fail',
                message: `LLM 컨벤션 audit 실패 (정적 룰만 적용): ${msg}`,
            });
            return { findings, tokensUsed: 0 };
        }
    }
}
