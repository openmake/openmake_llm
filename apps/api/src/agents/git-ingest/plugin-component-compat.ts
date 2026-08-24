/**
 * 외부 플러그인 구성요소 → openmake 등가물 정규화 (순수 함수, LLM 미사용).
 *
 * Claude Code 플러그인의 `commands/*.md`(슬래시 명령)와 `agents/*.md`(서브에이전트)는
 * 이 환경에 대응 개념이 있는데도 설치되지 않고 무시돼 왔다. 형식만 다를 뿐 내용은
 * 각각 스킬 지침 / 에이전트 시스템 프롬프트라, **프론트매터를 등가 규격으로 옮겨** 기존
 * ingest 파이프라인(스킬 draft / Custom Agent)에 그대로 태운다.
 *
 * 대응 관계:
 *   commands/&lt;name&gt;.md  → 스킬 (`/name` 슬래시 호출 — openmake 는 슬래시가 스킬 매칭)
 *   agents/&lt;name&gt;.md    → Custom Agent (`user_agents.system_prompt`)
 *
 * 변환은 프론트매터 보강뿐이고 **본문은 손대지 않는다** — 도구명·`$ARGUMENTS` 안내는
 * 하류 skill-compat 이 담당한다 (본문 재작성 금지 원칙 동일).
 *
 * @module agents/git-ingest/plugin-component-compat
 */
import * as yaml from 'js-yaml';

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
/** 본문에서 description 을 유도할 때 쓰는 최대 길이 (스킬 스키마 상한 1024 이내) */
const DERIVED_DESCRIPTION_MAX = 300;

export interface ParsedComponentFile {
    frontmatter: Record<string, unknown>;
    body: string;
}

/** `---` 프론트매터 분리 (없으면 frontmatter={} + 전체 본문). 파싱 실패도 관용. */
export function splitFrontmatter(raw: string): ParsedComponentFile {
    const m = FRONTMATTER_PATTERN.exec(raw);
    if (!m) return { frontmatter: {}, body: raw.trim() };
    let fm: unknown;
    try {
        fm = yaml.load(m[1] ?? '');
    } catch {
        return { frontmatter: {}, body: raw.trim() };
    }
    if (typeof fm !== 'object' || fm === null) return { frontmatter: {}, body: (m[2] ?? '').trim() };
    return { frontmatter: fm as Record<string, unknown>, body: (m[2] ?? '').trim() };
}

/** 경로 → 구성요소 이름 (`commands/foo/bar.md` → `bar`). */
export function componentNameFromPath(path: string): string {
    const base = path.slice(path.lastIndexOf('/') + 1);
    return base.replace(/\.md$/i, '').trim();
}

/** 본문에서 설명 유도 — 첫 헤딩을 건너뛴 첫 문단 (프론트매터에 description 이 없을 때). */
export function deriveDescription(body: string, fallback: string): string {
    const line = body
        .split('\n')
        .map(l => l.trim())
        .find(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('---') && !l.startsWith('>'));
    const text = (line ?? '').replace(/[*`_]/g, '').trim();
    if (!text) return fallback;
    return text.length > DERIVED_DESCRIPTION_MAX ? text.slice(0, DERIVED_DESCRIPTION_MAX) : text;
}

/** YAML 프론트매터 + 본문 → 파일 문자열. */
function serialize(frontmatter: Record<string, unknown>, body: string): string {
    const y = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true }).trimEnd();
    return `---\n${y}\n---\n\n${body}\n`;
}

/**
 * `commands/<name>.md` → SKILL.md 규격 문자열.
 *
 * commands 는 **name 프론트매터가 없고 파일명이 곧 명령 이름**이며(`/new-sdk-app`),
 * description 도 없을 수 있어 스킬 스키마를 그대로는 통과하지 못한다. 두 필드만
 * 보강하고 나머지 원문 키(`argument-hint`·`allowed-tools` 등)는 유지한다 —
 * 하류 skill-compat 이 그 키들을 보존·안내한다.
 */
export function commandFileToSkillMarkdown(path: string, raw: string): { content: string; name: string } {
    const { frontmatter, body } = splitFrontmatter(raw);
    const name = typeof frontmatter.name === 'string' && frontmatter.name.trim()
        ? frontmatter.name.trim()
        : componentNameFromPath(path);
    const description = typeof frontmatter.description === 'string' && frontmatter.description.trim()
        ? frontmatter.description.trim()
        : deriveDescription(body, `${name} 명령`);
    return {
        name,
        content: serialize({ ...frontmatter, name, description }, body),
    };
}

export interface NormalizedPluginAgent {
    name: string;
    description: string;
    systemPrompt: string;
    /** 이 환경이 사용하지 않는 원문 필드 (model/tools/color/effort 등) — 보존·안내용 */
    upstreamFields: Record<string, unknown>;
}

/** Custom Agent 로 옮길 때 이 환경이 사용하지 않는 프론트매터 키 */
const AGENT_CONSUMED_KEYS = new Set(['name', 'description']);

/**
 * `agents/<name>.md` → Custom Agent 입력.
 *
 * 본문이 곧 시스템 프롬프트다. `model`·`tools`·`color`·`effort`·`initialPrompt` 는
 * 이 환경에 대응 개념이 없거나(색상) 직교 축이 담당하므로(모델 선택) 적용하지 않고
 * 보존만 한다 — 무엇이 무시됐는지 설치 리포트로 알린다.
 */
export function agentFileToCustomAgent(path: string, raw: string): NormalizedPluginAgent {
    const { frontmatter, body } = splitFrontmatter(raw);
    const name = typeof frontmatter.name === 'string' && frontmatter.name.trim()
        ? frontmatter.name.trim()
        : componentNameFromPath(path);
    const description = typeof frontmatter.description === 'string' && frontmatter.description.trim()
        ? frontmatter.description.trim()
        : deriveDescription(body, `${name} 에이전트`);
    const upstreamFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(frontmatter)) {
        if (!AGENT_CONSUMED_KEYS.has(k)) upstreamFields[k] = v;
    }
    return { name, description, systemPrompt: body, upstreamFields };
}
