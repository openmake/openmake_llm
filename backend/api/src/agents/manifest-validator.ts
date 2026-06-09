/**
 * Skill manifest YAML frontmatter 파싱 + Zod 검증 + sha256 checksum.
 *
 * 단계:
 *   1. parseSkillFile()   — `---...---\nbody` 분리, YAML 객체 변환
 *   2. validateManifest() — Zod 스키마 검증 + 도구 존재 검증 + prompt_md 길이 검증
 *
 * checksum 은 prompt_md 의 sha256 — manifest_yaml 의 normalization 이슈 회피 (P5-D8).
 *
 */
import * as yaml from 'js-yaml';
import { createHash } from 'crypto';
import { SkillManifestFrontmatterSchema, type SkillManifestFrontmatter } from '../schemas/skill-manifest.schema';
import { createLogger } from '../utils/logger';

const logger = createLogger('ManifestValidator');

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

export interface ParsedSkillFile {
    frontmatter: SkillManifestFrontmatter;
    prompt_md: string;
    raw_yaml: string;
}

export interface ValidateOptions {
    availableToolNames: Set<string>;
}

export type ValidateResult =
    | { ok: true; manifest: SkillManifestFrontmatter; prompt_md: string; raw_yaml: string; checksum: string }
    | { ok: false; errors: string[] };

export function parseSkillFile(content: string): ParsedSkillFile {
    const match = FRONTMATTER_PATTERN.exec(content);
    if (!match) {
        throw new Error('frontmatter (---...---) 가 없는 .SKILL 파일입니다');
    }
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
    return {
        frontmatter: parsed as SkillManifestFrontmatter,
        prompt_md: promptMd,
        raw_yaml: rawYaml,
    };
}

export async function validateManifest(
    parsed: ParsedSkillFile,
    options: ValidateOptions,
): Promise<ValidateResult> {
    const errors: string[] = [];

    const zodResult = SkillManifestFrontmatterSchema.safeParse(parsed.frontmatter);
    if (!zodResult.success) {
        for (const issue of zodResult.error.issues) {
            errors.push(`${issue.path.join('.')}: ${issue.message}`);
        }
        return { ok: false, errors };
    }

    const manifest = zodResult.data;

    if (!parsed.prompt_md || parsed.prompt_md.length < 10) {
        errors.push('prompt_md 가 비어있거나 너무 짧습니다 (최소 10자)');
    }

    const unknownTools = manifest.tool_bindings
        .map(b => b.tool_name)
        .filter(name => !options.availableToolNames.has(name));
    if (unknownTools.length > 0) {
        errors.push(`존재하지 않는 도구: ${unknownTools.join(', ')}`);
    }

    if (errors.length > 0) {
        return { ok: false, errors };
    }

    const checksum = createHash('sha256').update(parsed.prompt_md).digest('hex');
    logger.debug(`manifest 검증 통과: ${manifest.name} v${manifest.version} (checksum=${checksum.slice(0, 8)})`);
    return {
        ok: true,
        manifest,
        prompt_md: parsed.prompt_md,
        raw_yaml: parsed.raw_yaml,
        checksum,
    };
}
