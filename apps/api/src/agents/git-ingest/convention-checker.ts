/**
 * 설치 대상(SKILL.md / MCP 서버 정의)의 위험 신호 audit.
 *
 * 2단 구조 — **차단 권한은 정적 룰에만 있다**:
 *   - 정적 룰 (`MCP_INGEST.riskyCommandPatterns`): severity 그대로. error 면 승인 차단.
 *   - LLM audit: 참고용. severity 를 warn 이하로 **강등**해 차단에 관여하지 않는다.
 *
 * 강등 이유(2026-08-24 라이브 실측): MCP 항목이 실제로 설치되기 시작하자 LLM audit 이
 * ① **자기 자신의 시스템 프롬프트**("Ignore previous instructions…")를 검사 대상 스니펫으로
 * 착각해 "프롬프트 인젝션" 으로 신고하고 ② 이미 폐기된 정책('Vanilla JS ES Modules only',
 * Docker 전면 금지)을 인용해 정상 플러그인(design-figma·design-atlassian)을 error 로 막았다.
 * 오탐 하나가 승인 자체를 봉쇄하는 구조라 판정 권한을 정적 룰로 되돌린다.
 * (프롬프트 쪽도 경계 태그 + 현행 정책으로 개정 — prompts/convention-checker-system.ts)
 *
 * @module agents/git-ingest/convention-checker
 */
import type { LLMClient } from '../../llm/client';
import type { ChatMessage } from '../../llm/types';
import { createLogger } from '../../utils/logger';
import { CONVENTION_CHECK_LIMITS } from '../../config/runtime-limits';
import { MCP_INGEST } from '../../config/constants';
import {
    CONVENTION_CHECKER_SYSTEM_PROMPT,
    MCP_SERVER_CHECKER_SYSTEM_PROMPT,
    AUDIT_TARGET_OPEN,
    AUDIT_TARGET_CLOSE,
} from '../../prompts/convention-checker-system';

const logger = createLogger('ConventionChecker');

export interface ConventionFinding {
    severity: 'info' | 'warn' | 'error';
    rule: string;
    message: string;
    snippet?: string;
    /** 'static' = 차단 권한 있는 결정적 룰, 'llm' = 참고용 (차단 불가) */
    source?: 'static' | 'llm';
}

export interface ConventionCheckResult {
    findings: ConventionFinding[];
    tokensUsed: number;
}

/**
 * LLM 이 매긴 severity 를 warn 이하로 강등 — 차단은 정적 룰만 담당한다.
 * (info 는 그대로 둔다: 강등이지 승격이 아니다)
 */
function demoteLlmFinding(f: ConventionFinding): ConventionFinding {
    return {
        ...f,
        severity: f.severity === 'info' ? 'info' : 'warn',
        source: 'llm',
    };
}

/**
 * 승인 차단 여부 — **정적 룰의 error 만** 근거로 삼는다.
 *
 * `source` 가 없는 과거 findings 는 정적 룰로 간주한다(하위 호환): 그 시점엔 LLM findings 도
 * 차단 근거였으므로 기존 draft 의 판정을 임의로 뒤집지 않는다. 다만 LLM 이 낸 것으로 식별되는
 * 룰 이름은 예외로 두어 실측된 오탐(prompt-injection-risk 등)이 계속 막지 않게 한다.
 */
const LLM_ONLY_RULES = new Set([
    'prompt-injection-risk', 'no-docker', 'no-hardcoding',
    'no-prohibited-deps', 'no-vercel-ai-sdk', 'llm-parse-fail', 'llm-audit-fail',
]);

export function isBlockedByConvention(findings: ConventionFinding[] | undefined): boolean {
    if (!Array.isArray(findings)) return false;
    return findings.some(f =>
        f.severity === 'error'
        && f.source !== 'llm'
        && !LLM_ONLY_RULES.has(f.rule),
    );
}

export class ConventionChecker {
    constructor(private llm: Pick<LLMClient, 'chat'>) {}

    async check(
        manifestYaml: string,
        promptBody: string,
        mode: 'skill' | 'mcp-server' = 'skill',
    ): Promise<ConventionCheckResult> {
        // 검사 대상을 경계 태그로 감싼다 — 안쪽 텍스트를 지시가 아닌 데이터로 취급하게 하고,
        // 모델이 자기 지시문을 검사 대상으로 착각하는 오탐을 막는다.
        const target = mode === 'mcp-server'
            ? `## MCP 서버 정의\n\`\`\`json\n${manifestYaml.slice(0, CONVENTION_CHECK_LIMITS.MANIFEST_YAML_MAX_CHARS)}\n\`\`\``
            : `## YAML frontmatter\n\`\`\`yaml\n${manifestYaml.slice(0, CONVENTION_CHECK_LIMITS.MANIFEST_YAML_MAX_CHARS)}\n\`\`\`\n\n## Body\n${promptBody.slice(0, CONVENTION_CHECK_LIMITS.PROMPT_BODY_MAX_CHARS)}`;
        const userContent = `${AUDIT_TARGET_OPEN}\n${target}\n${AUDIT_TARGET_CLOSE}`;
        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: mode === 'mcp-server' ? MCP_SERVER_CHECKER_SYSTEM_PROMPT : CONVENTION_CHECKER_SYSTEM_PROMPT,
            },
            { role: 'user', content: userContent },
        ];
        try {
            const resp = await this.llm.chat(messages);
            const tokensUsed = resp.metrics?.completion_tokens ?? 0;
            const raw = (resp.content ?? '').trim();
            const fence = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
            const candidate = fence ? fence[1] : raw;
            const parsed = JSON.parse(candidate) as { findings?: ConventionFinding[] };
            const findings = (Array.isArray(parsed.findings) ? parsed.findings : []).map(demoteLlmFinding);
            return { findings, tokensUsed };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`convention check LLM parse fail: ${msg}`);
            return {
                findings: [{ severity: 'warn', rule: 'llm-parse-fail', source: 'llm', message: `LLM 응답을 파싱할 수 없어 컨벤션 audit 을 건너뜀: ${msg}` }],
                tokensUsed: 0,
            };
        }
    }

    /**
     * MCP server manifest 전용 검사 (Phase 4).
     *
     * 1단계: 정적 위험 명령 룰 (MCP_INGEST.riskyCommandPatterns) — LLM 호출 없이 즉시 평가.
     *        **이 단계만 차단 권한을 갖는다** (source='static').
     * 2단계: LLM audit — MCP 전용 프롬프트로 호출하고 결과는 warn 이하로 강등(참고용).
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
                    source: 'static',
                });
            }
        }

        try {
            const llmResult = await this.check(manifestYaml, bodyMarkdown, 'mcp-server');
            findings.push(...llmResult.findings);
            return { findings, tokensUsed: llmResult.tokensUsed };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`mcp-server LLM audit fail: ${msg}`);
            findings.push({
                severity: 'warn',
                rule: 'llm-audit-fail',
                source: 'llm',
                message: `LLM 컨벤션 audit 실패 (정적 룰만 적용): ${msg}`,
            });
            return { findings, tokensUsed: 0 };
        }
    }
}
