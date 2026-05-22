/**
 * AGENT.md 매니페스트 검증 — YAML frontmatter (zod) + system_prompt (markdown).
 *
 * SKILL.md 의 manifest-validator.ts 와 별개:
 *   - type: 'agent' 강제
 *   - skill_bindings (배열 of 'skill-id:...' | 'git-url:...')
 *   - system_prompt 최소 길이 10
 *   - tool_bindings / mcp_bundles 부재 (agent 는 skill 을 통해 도구 사용)
 *
 * @module agents/git-ingest/agent-manifest-validator
 */
import * as yaml from 'js-yaml';
import { z } from 'zod';

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

const SKILL_BINDING_PATTERN = /^(skill-id:|git-url:)/;

export const AgentManifestFrontmatterSchema = z.object({
    type: z.literal('agent'),
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    category: z.string().min(1).max(50),
    emoji: z.string().max(10).optional(),
    keywords: z.array(z.string().max(50)).max(30).optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().min(1).max(32000).optional(),
    skill_bindings: z.array(
        z.string().refine(s => SKILL_BINDING_PATTERN.test(s),
            'skill_bindings 항목은 "skill-id:" 또는 "git-url:" prefix 필요')
    ).max(30).optional(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'semver (예: 1.0.0)'),
});

export type AgentManifestFrontmatter = z.infer<typeof AgentManifestFrontmatterSchema>;

export interface ParsedAgentFile {
    frontmatter: unknown;
    system_prompt: string;
    raw_yaml: string;
}

export type ValidateAgentResult =
    | { ok: true; manifest: AgentManifestFrontmatter; system_prompt: string; raw_yaml: string }
    | { ok: false; errors: string[] };

export function parseAgentFile(content: string): ParsedAgentFile {
    const match = FRONTMATTER_PATTERN.exec(content);
    if (!match) throw new Error('frontmatter (---...---) 가 없는 AGENT 파일입니다');
    const rawYaml = match[1] ?? '';
    const promptMd = (match[2] ?? '').trim();
    let parsed: unknown;
    try {
        parsed = yaml.load(rawYaml);
    } catch (e) {
        throw new Error(`YAML 파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('frontmatter 는 YAML 객체여야 합니다');
    }
    return { frontmatter: parsed, system_prompt: promptMd, raw_yaml: rawYaml };
}

export async function validateAgentManifest(parsed: ParsedAgentFile): Promise<ValidateAgentResult> {
    const errors: string[] = [];
    const zodResult = AgentManifestFrontmatterSchema.safeParse(parsed.frontmatter);
    if (!zodResult.success) {
        for (const issue of zodResult.error.issues) {
            errors.push(`${issue.path.join('.')}: ${issue.message}`);
        }
        return { ok: false, errors };
    }
    const manifest = zodResult.data;
    if (!parsed.system_prompt || parsed.system_prompt.length < 10) {
        errors.push('system_prompt 가 비어있거나 너무 짧습니다 (최소 10자)');
    }
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, manifest, system_prompt: parsed.system_prompt, raw_yaml: parsed.raw_yaml };
}
