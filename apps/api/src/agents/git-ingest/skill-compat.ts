/**
 * 외부 생태계 SKILL.md → openmake_llm 적응 (순수 함수, LLM 미사용).
 *
 * 하는 일:
 *   1. 스키마가 인식하지 않아 버려지던 frontmatter 필드 보존 (`allowed-tools`, `model` 등)
 *   2. Claude Code 도구 이름 → 이 환경 도구 이름 매핑표 산출
 *   3. 본문의 외부 관용구 감지 (`$ARGUMENTS`, `$1`, `@file`, `` `Bash` ``, "Read tool")
 *   4. 위 결과를 본문 앞 **호환 안내 노트**로 조립 (본문 원문은 재작성하지 않는다)
 *
 * 본문을 정규식으로 재작성하지 않는 이유: 도구 이름 상당수가 일반 영어 단어
 * (Read/Write/Edit/Task)라 치환 오탐이 스킬 지침 자체를 훼손한다. 대신 모델이
 * 읽는 컨텍스트 맨 앞에 대응표를 붙여 "없는 도구를 호출하는" 실패를 막는다.
 *
 * @module agents/git-ingest/skill-compat
 */
import {
    SKILL_COMPAT,
    CLAUDE_TOOL_ALIASES,
    KNOWN_FOREIGN_FRONTMATTER_KEYS,
    ALLOWED_TOOLS_KEYS,
} from '../../config/skill-compat';
import { SkillManifestFrontmatterSchema } from '../../schemas/skill-manifest.schema';

/** 이 프로젝트 스키마가 인식하는 frontmatter 키 (Zod shape 에서 파생 — 하드코딩 회피) */
const KNOWN_SCHEMA_KEYS: ReadonlySet<string> = new Set(Object.keys(SkillManifestFrontmatterSchema.shape));

export interface ToolMapping {
    /** 원문 도구 이름 (Claude Code) */
    from: string;
    /** 이 환경의 등가 도구 (없으면 null) */
    to: string | null;
}

export interface SkillCompatResult {
    /** 적응된 본문 (변경 없으면 원문 그대로) */
    content: string;
    /** 적응이 실제로 일어났는지 */
    adapted: boolean;
    /** manifest_meta.compat 로 영속할 메타 (adapted=false 면 null) */
    compat: SkillCompatMeta | null;
    /** 사용자/도구 응답에 노출할 한 줄 요약들 */
    notes: string[];
}

export interface SkillCompatMeta {
    /** 스키마가 버리던 원문 frontmatter 필드 (추적·후속 마이그레이션용) */
    upstreamFrontmatter: Record<string, unknown>;
    /** 도구 이름 대응표 */
    toolMappings: ToolMapping[];
    /** 본문에서 감지된 외부 관용구 마커 */
    markers: string[];
    /** 본문 앞에 붙인 안내 노트 원문 */
    note: string;
    /** 사람이 읽는 요약 (dedupe 재사용 시 복원용) */
    notes: string[];
}

/** frontmatter 원문에서 이 프로젝트가 인식하지 않는 키만 추출. */
export function collectForeignFrontmatter(frontmatter: unknown): Record<string, unknown> {
    if (typeof frontmatter !== 'object' || frontmatter === null) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(frontmatter as Record<string, unknown>)) {
        if (!KNOWN_SCHEMA_KEYS.has(k)) out[k] = v;
    }
    return out;
}

/** frontmatter 의 허용 도구 목록 필드 → 도구 이름 배열 (문자열/배열 양쪽 수용). */
export function extractDeclaredTools(frontmatter: Record<string, unknown>): string[] {
    for (const key of ALLOWED_TOOLS_KEYS) {
        const raw = frontmatter[key];
        if (raw === undefined || raw === null) continue;
        const list = Array.isArray(raw)
            ? raw.map(v => String(v))
            : String(raw).split(',');
        const names = list
            // "Bash(git:*)" 같은 인자 한정 표기에서 도구 이름만 취함
            .map(s => s.trim().replace(/\(.*$/, '').trim())
            .filter(Boolean);
        if (names.length > 0) return [...new Set(names)];
    }
    return [];
}

/** 도구 이름 목록 → 대응표. 매핑표에 없는 이름은 결과에서 제외(이 환경 도구일 수 있음). */
export function mapClaudeTools(names: readonly string[]): ToolMapping[] {
    const out: ToolMapping[] = [];
    for (const name of names) {
        if (!(name in CLAUDE_TOOL_ALIASES)) continue;
        out.push({ from: name, to: CLAUDE_TOOL_ALIASES[name] ?? null });
    }
    return out;
}

/** 본문에서 백틱/“tool” 접미로 명시된 Claude 도구 이름 (일반 단어 오탐 방지). */
export function detectBodyToolNames(promptMd: string): string[] {
    const found = new Set<string>();
    for (const name of Object.keys(CLAUDE_TOOL_ALIASES)) {
        const re = new RegExp(`(\`${name}\`)|(\\b${name}\\s+(tool|도구))`, 'i');
        if (re.test(promptMd)) found.add(name);
    }
    return [...found];
}

/** 본문의 외부 관용구 마커 감지. */
export function detectBodyMarkers(promptMd: string): string[] {
    const markers: string[] = [];
    if (/\$ARGUMENTS\b/.test(promptMd)) markers.push('$ARGUMENTS');
    if (/@\$\d/.test(promptMd)) markers.push('@$N');
    else if (/(^|\s)\$\d\b/.test(promptMd)) markers.push('$N');
    if (/!`[^`]+`/.test(promptMd)) markers.push('!`command`');
    if (/(^|\s)@[\w./-]+\.(md|txt|json|ya?ml|ts|js|py)\b/.test(promptMd)) markers.push('@file');
    if (/\.claude\/|CLAUDE\.md/.test(promptMd)) markers.push('.claude/');
    return markers;
}

/** 대응표·마커 → 본문 앞에 붙일 안내 노트 (없으면 빈 문자열). */
export function buildCompatNote(mappings: readonly ToolMapping[], markers: readonly string[]): string {
    const lines: string[] = [];
    const mapped = mappings.filter(m => m.to);
    const unsupported = mappings.filter(m => !m.to);

    if (mapped.length > 0) {
        const pairs = mapped.map(m => `\`${m.from}\` → \`${m.to}\``).join(', ');
        lines.push(`- 도구 이름 대응: ${pairs}`);
    }
    if (unsupported.length > 0) {
        const names = unsupported.map(m => `\`${m.from}\``).join(', ');
        lines.push(`- 이 환경에 대응 도구 없음: ${names} — 해당 단계는 다른 방법으로 수행하거나 건너뛰세요.`);
    }
    if (markers.includes('$ARGUMENTS') || markers.includes('$N') || markers.includes('@$N')) {
        lines.push('- `$ARGUMENTS`/`$1` 은 사용자가 이 스킬과 함께 보낸 요청 내용을 가리킵니다 (슬래시 명령으로 호출하면 자동 치환됩니다).');
    }
    if (markers.includes('@file')) {
        lines.push('- `@파일명` 표기는 사용자가 첨부한 파일을 의미합니다 — 저장소에서 파일을 읽으려 하지 마세요.');
    }
    if (markers.includes('!`command`')) {
        lines.push('- `` !`명령` `` 형태의 자동 셸 주입은 이 환경에 없습니다 — 필요하면 에이전트 작업에서 `bash` 로 직접 실행하세요.');
    }
    if (markers.includes('.claude/')) {
        // ⚠️ "무시하라"로 뭉뚱그리면 안 된다 — `.claude/` 는 읽을 설정 경로일 때도 있고
        // 스킬이 만들어내는 산출물 경로일 때도 있다(예: hookify 가 규칙 파일을 생성).
        // 후자까지 무시시키면 스킬이 아무 결과도 내지 못한다.
        lines.push('- `.claude/` · `CLAUDE.md` 는 이 환경에 없습니다. **읽으라는 지침이면 건너뛰고**, 스킬이 **만들어내는 파일 경로**면 `.claude/` 를 뗀 작업 디렉토리 기준 경로에 생성하세요 (그 파일이 원래 자동 실행되는 훅·설정이었다면 이 환경에서는 실행되지 않고 참고용으로만 남습니다).');
    }

    if (lines.length === 0) return '';
    const note = ['> **[openmake 호환 안내]** 이 스킬은 외부 생태계(Claude Code 등) 형식으로 작성되었습니다.', ...lines.map(l => `> ${l}`)].join('\n');
    return note.length > SKILL_COMPAT.noteMaxChars
        ? note.slice(0, SKILL_COMPAT.noteMaxChars) + '\n> …'
        : note;
}

/**
 * SKILL.md 를 이 환경에 맞게 적응.
 *
 * 적응할 것이 없으면 `adapted=false` + 원문 그대로 반환 — 이 환경에서 만든
 * 스킬이나 외부 관용구가 없는 스킬은 무변경(기존 동작 보존).
 */
export function adaptSkillContent(input: {
    frontmatter: unknown;
    promptMd: string;
}): SkillCompatResult {
    const unchanged: SkillCompatResult = {
        content: input.promptMd,
        adapted: false,
        compat: null,
        notes: [],
    };
    if (!SKILL_COMPAT.enabled) return unchanged;

    const foreign = collectForeignFrontmatter(input.frontmatter);
    const declared = extractDeclaredTools(foreign);
    const bodyTools = detectBodyToolNames(input.promptMd);
    const mappings = mapClaudeTools([...new Set([...declared, ...bodyTools])]);
    const markers = detectBodyMarkers(input.promptMd);

    const note = buildCompatNote(mappings, markers);
    if (!note) {
        // 보존할 frontmatter 만 있고 안내할 것이 없는 경우 — 본문은 그대로 두되 메타는 남긴다
        if (Object.keys(foreign).length === 0) return unchanged;
        const preserveNotes = [`upstream frontmatter 보존: ${Object.keys(foreign).map(k => KNOWN_FOREIGN_FRONTMATTER_KEYS[k] ?? k).join(', ')}`];
        return {
            content: input.promptMd,
            adapted: true,
            compat: { upstreamFrontmatter: foreign, toolMappings: [], markers: [], note: '', notes: preserveNotes },
            notes: preserveNotes,
        };
    }

    const notes: string[] = [];
    const mapped = mappings.filter(m => m.to);
    const unsupported = mappings.filter(m => !m.to);
    if (mapped.length > 0) notes.push(`도구 이름 ${mapped.length}종 대응 안내 추가 (${mapped.map(m => `${m.from}→${m.to}`).join(', ')})`);
    if (unsupported.length > 0) notes.push(`대응 도구 없음 표시: ${unsupported.map(m => m.from).join(', ')}`);
    if (markers.length > 0) notes.push(`외부 관용구 안내: ${markers.join(', ')}`);
    if (Object.keys(foreign).length > 0) {
        notes.push(`upstream frontmatter 보존: ${Object.keys(foreign).map(k => KNOWN_FOREIGN_FRONTMATTER_KEYS[k] ?? k).join(', ')}`);
    }

    return {
        content: `${note}\n\n${input.promptMd}`,
        adapted: true,
        compat: { upstreamFrontmatter: foreign, toolMappings: mappings, markers, note, notes },
        notes,
    };
}
