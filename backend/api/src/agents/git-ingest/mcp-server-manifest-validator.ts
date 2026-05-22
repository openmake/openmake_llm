/**
 * MCPSERVER.md 매니페스트 파서 + 검증기 (Phase 4).
 *
 * 입력: 파일 전체 텍스트 (YAML frontmatter + Markdown body)
 * 출력:
 *   - parseMcpServerFile: { frontmatterYaml, body }
 *   - validateMcpServerManifest: { ok, manifest, raw_yaml, body, errors }
 *
 * Zod refinement:
 *   - transport_type='stdio' ↔ command 필수
 *   - transport_type='sse'|'streamable-http' ↔ url 필수
 *   - required_env 의 모든 키는 env 에도 존재해야 함
 *
 * @module agents/git-ingest/mcp-server-manifest-validator
 */
import * as yaml from 'js-yaml';
import { z } from 'zod';

const SECURITY_DATA_COLLECTION = z.enum(['none', 'telemetry', 'logs']);

export const mcpServerManifestFrontmatterSchema = z.object({
    type: z.literal('mcp-server'),
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    category: z.string().min(1).max(50),
    transport_type: z.enum(['stdio', 'sse', 'streamable-http']),
    command: z.string().min(1).max(1000).optional(),
    args: z.array(z.string().max(500)).max(50).optional(),
    env: z.record(z.string(), z.string().max(2000)).optional(),
    required_env: z.array(z.string().min(1).max(200)).max(50).optional(),
    url: z.string().url().optional(),
    version: z.string().regex(
        /^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?(\+[A-Za-z0-9.-]+)?$/,
        'version 은 semver (예: 1.0.0) 형식이어야 합니다',
    ),
    author: z.string().max(200).optional(),
    license: z.string().max(100).optional(),
    homepage: z.string().url().optional(),
    required_capabilities: z.array(z.string().max(50)).max(20).optional(),
    security_metadata: z.object({
        network_access: z.boolean().optional(),
        filesystem_access: z.boolean().optional(),
        arbitrary_execution: z.boolean().optional(),
        data_collection: SECURITY_DATA_COLLECTION.optional(),
    }).optional(),
}).superRefine((data, ctx) => {
    if (data.transport_type === 'stdio' && !data.command) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'stdio transport 는 command 필수',
            path: ['command'],
        });
    }
    if ((data.transport_type === 'sse' || data.transport_type === 'streamable-http') && !data.url) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${data.transport_type} transport 는 url 필수`,
            path: ['url'],
        });
    }
    if (data.required_env && data.required_env.length > 0) {
        const envKeys = new Set(Object.keys(data.env || {}));
        for (const key of data.required_env) {
            if (!envKeys.has(key)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `required_env '${key}' 가 env 에 정의되지 않음 (placeholder 마커 필요)`,
                    path: ['required_env'],
                });
            }
        }
    }
});

export type McpServerManifestFrontmatter = z.infer<typeof mcpServerManifestFrontmatterSchema>;

export interface ParsedMcpServerFile {
    frontmatterYaml: string;
    body: string;
}

export interface ValidateResult {
    ok: boolean;
    manifest: McpServerManifestFrontmatter;
    raw_yaml: string;
    body: string;
    errors: string[];
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]+?)\n---\s*(\n[\s\S]*)?$/;

export function parseMcpServerFile(text: string): ParsedMcpServerFile {
    const m = text.match(FRONTMATTER_RE);
    if (!m) {
        return { frontmatterYaml: '', body: text };
    }
    return {
        frontmatterYaml: m[1] ?? '',
        body: (m[2] ?? '').replace(/^\n/, ''),
    };
}

export async function validateMcpServerManifest(
    parsed: ParsedMcpServerFile,
): Promise<ValidateResult> {
    const errors: string[] = [];
    let yamlData: unknown;
    try {
        yamlData = yaml.load(parsed.frontmatterYaml);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            ok: false,
            manifest: {} as McpServerManifestFrontmatter,
            raw_yaml: parsed.frontmatterYaml,
            body: parsed.body,
            errors: [`YAML parse fail: ${msg}`],
        };
    }
    const result = mcpServerManifestFrontmatterSchema.safeParse(yamlData);
    if (!result.success) {
        for (const issue of result.error.issues) {
            errors.push(`${issue.path.join('.') || '<root>'}: ${issue.message}`);
        }
        return {
            ok: false,
            manifest: {} as McpServerManifestFrontmatter,
            raw_yaml: parsed.frontmatterYaml,
            body: parsed.body,
            errors,
        };
    }
    return {
        ok: true,
        manifest: result.data,
        raw_yaml: parsed.frontmatterYaml,
        body: parsed.body,
        errors: [],
    };
}
