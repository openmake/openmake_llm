/**
 * ============================================================
 * Slash Command — 스킬 명시 호출 (P-4)
 * ============================================================
 *
 * 사용자가 `/skill-slug ...` 로 시작하는 메시지를 보내면, 해당 active 스킬을
 * 찾아 그 내용을 컨텍스트로 주입한 메시지로 변환한다(Claude Code 의 명시적 skill 호출 UX).
 *
 * 안전 원칙:
 * - 비슬래시 메시지는 파서가 즉시 null → DB 조회 없이 passthrough (정상 흐름 무영향/무비용).
 * - 슬래시라도 **실제 active 스킬과 정확히 매칭될 때만** 증강. 미매칭(예: "/path/to/x")은 원문 그대로.
 * - 어떤 오류도 throw 하지 않고 원문 반환(graceful) — 채팅 흐름을 깨지 않는다.
 *
 * @module chat/slash-command
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('SlashCommand');

/** 기능 플래그 (기본 ON — 사용자가 '/' 를 입력해야만 동작하므로 opt-in 성격) */
const SLASH_COMMANDS_ENABLED = process.env.SLASH_COMMANDS_ENABLED !== 'false';
/** 주입할 스킬 content 최대 길이 */
const SLASH_SKILL_CONTENT_MAX = Number(process.env.SLASH_SKILL_CONTENT_MAX ?? 8_000);

/** 슬래시 명령 파싱 결과 */
export interface ParsedSlashCommand {
    slug: string;
    rest: string;
}

/** 매칭에 필요한 최소 스킬 형태 */
export interface SlashSkill {
    name: string;
    content: string;
}

// 유니코드 문자 허용 (2026-07-04): 한글 등 비ASCII 스킬명의 slug 가 빈 문자열이 되어
// 슬래시 호출이 불가능하던 결함 수정 — \p{L}\p{N} 로 전체 언어 문자 수용.
const COMMAND_PATTERN = /^\/([\p{L}\p{N}][\p{L}\p{N}_-]{0,63})\s*([\s\S]*)$/iu;

/**
 * 메시지에서 선행 슬래시 명령을 파싱 (순수). 명령이 아니면 null.
 */
export function parseSlashCommand(message: string): ParsedSlashCommand | null {
    if (!message) return null;
    const trimmed = message.trimStart();
    if (!trimmed.startsWith('/')) return null;
    const m = COMMAND_PATTERN.exec(trimmed);
    if (!m) return null;
    return { slug: m[1].toLowerCase(), rest: (m[2] ?? '').trim() };
}

/** 스킬 이름 → slug (소문자, 문자/숫자 외 → '-'. 한글 등 유니코드 문자 보존) */
export function slugify(name: string): string {
    return name.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

/** 명령 slug 가 스킬과 정확히 매칭되는지 */
export function matchesSlug(skillName: string, slug: string): boolean {
    return slugify(skillName) === slug || skillName.toLowerCase() === slug;
}

/**
 * 외부 생태계(Claude Code) 스킬의 인자 자리표시자를 슬래시 명령 인자로 치환 (순수).
 *
 * `$ARGUMENTS` = 전체 인자, `$1`..`$9` = 공백 분리 토큰, `@$1` = 파일 참조 표기의
 * `@` 제거(이 환경엔 저장소 파일 참조가 없다). 자리표시자가 없으면 원문 그대로다.
 *
 * ⚠️ `$1` 은 금액(`$1,500`)·소수(`$1.5`)·여러 자리 수(`$19`)와 형태가 겹친다. 뒤에
 * 숫자·쉼표·마침표가 오면 자리표시자로 보지 않는다 — 본문 산문을 깨뜨리는 오탐을
 * 막기 위함이다(도구명 치환에서 평문 동사를 배제한 것과 같은 이유).
 *
 * @returns 치환된 본문과 자리표시자 소비 여부
 */
const ARG_PLACEHOLDER = /\$([1-9])(?![\d,.])/g;

export function substituteSkillArguments(content: string, rest: string): { content: string; consumed: boolean } {
    if (!/\$ARGUMENTS\b/.test(content) && !new RegExp(ARG_PLACEHOLDER.source).test(content)) {
        return { content, consumed: false };
    }
    const tokens = rest.trim().length > 0 ? rest.trim().split(/\s+/) : [];
    const replaced = content
        // '@$1' → '$1' 치환 후 남는 '@' 제거 (Claude Code 파일 참조 표기)
        .replace(/@(\$(?:ARGUMENTS\b|[1-9](?![\d,.])))/g, '$1')
        .replace(/\$ARGUMENTS\b/g, () => rest.trim())
        .replace(ARG_PLACEHOLDER, (_m, d: string) => tokens[Number(d) - 1] ?? '');
    return { content: replaced, consumed: true };
}

/** 스킬 + 나머지 텍스트 → 증강 메시지 (순수) */
export function buildAugmentedMessage(skill: SlashSkill, rest: string): string {
    const safeName = skill.name.replace(/[<>"&]/g, '');
    // 외부 스킬의 `$ARGUMENTS`/`$1` 을 실제 인자로 치환 — 치환됐으면 본문 뒤 중복 첨부는 생략
    const substituted = substituteSkillArguments(skill.content, rest);
    const content = substituted.content.length > SLASH_SKILL_CONTENT_MAX
        ? substituted.content.slice(0, SLASH_SKILL_CONTENT_MAX) + '\n... (truncated)'
        : substituted.content;
    const body = substituted.consumed
        ? (rest ? `위 스킬 지침을 요청 "${rest}" 에 적용해 주세요.` : '위 스킬 지침에 따라 진행해 주세요.')
        : (rest || '위 스킬 지침에 따라 진행해 주세요.');
    return `[슬래시 명령: 스킬 "${safeName}" 적용]\n<skill_context name="${safeName}">\n${content}\n</skill_context>\n\n${body}`;
}

export interface ApplySlashDeps {
    userId?: string;
    /** slug 로 active 스킬을 찾는 함수 (없으면 기본 구현 — skill-manager) */
    findSkillBySlug?: (slug: string, userId?: string) => Promise<SlashSkill | null>;
    onSkillApplied?: (skillName: string) => void;
    /** 강제 on/off (테스트용). 기본 SLASH_COMMANDS_ENABLED */
    enabled?: boolean;
}

export function mergeActivatedSkillNames(...groups: string[][]): string[] {
    return [...new Set(groups.flatMap((names) => names.map((name) => name.trim()).filter(Boolean)))];
}

/** 기본 스킬 해석기 — active 스킬을 검색해 slug 정확 매칭.
 *  검색어는 slug 의 '-' 를 공백으로 복원 — 스킬 이름은 공백 구분이라 하이픈 그대로는
 *  ILIKE 검색이 매칭되지 않음 (다단어 스킬명 slash 호출이 불가능하던 결함, 2026-07-04).
 *  하이픈 이름(확장 스킬 등)은 공백 복원 검색이 name ILIKE 를 놓치므로 원 slug 로도 검색.
 *  userId 를 전달해야 본인 소유 비공개 스킬이 검색됨 — 미전달 시 public 전용이라
 *  확장 설치 스킬(전부 비공개)의 슬래시 호출이 불가능하던 결함 (2026-08-16). */
async function defaultFindSkillBySlug(slug: string, userId?: string): Promise<SlashSkill | null> {
    const { getSkillManager } = await import('../agents/skill-manager');
    const manager = getSkillManager();
    for (const { search, limit } of buildSlugSearchAttempts(slug)) {
        const result = await manager.searchSkills({ search, status: 'active', limit, userId });
        const matched = result.skills.find((s) => matchesSlug(s.name, slug));
        if (matched) return { name: matched.name, content: matched.content };
    }
    return null;
}

/**
 * slug → DB 검색어 후보들 (순서대로 시도, 첫 매치에서 종료).
 *
 * `searchSkills` 는 검색어를 **문자열 그대로** ILIKE 하므로, 이름에 슬러그화 과정에서
 * 사라지는 문자(`&`·`:`·`(` 등)가 있으면 공백 복원도 원 slug 도 매칭되지 않는다
 * — 예: "Nginx Log Error Analysis **&** Reporting" ↔ "nginx log error analysis reporting"
 * (2026-08-24 실측: 슬래시 호출이 조용히 무시되고 일반 에이전트가 답했다).
 * 마지막 폴백으로 **첫 토큰만** 넓게 검색한 뒤 `matchesSlug` 로 정확 필터한다
 * (필터가 정확 일치라 후보를 넓혀도 오탐이 없다).
 */
export function buildSlugSearchAttempts(slug: string): Array<{ search: string; limit: number }> {
    const spaced = slug.replace(/-/g, ' ');
    const attempts: Array<{ search: string; limit: number }> = [{ search: spaced, limit: 10 }];
    if (slug !== spaced) attempts.push({ search: slug, limit: 10 });
    const firstToken = slug.split('-')[0];
    if (firstToken && firstToken !== slug) attempts.push({ search: firstToken, limit: 50 });
    return attempts;
}

/**
 * 슬래시 명령을 적용해 (필요 시) 증강된 메시지를 반환. 절대 throw 하지 않음.
 * - 비슬래시/비활성 → 원문 그대로 (DB 조회 없음)
 * - 매칭 스킬 없음 → 원문 그대로
 * - 매칭 → 스킬 컨텍스트가 주입된 메시지
 */
export async function applySlashCommand(message: string, deps: ApplySlashDeps = {}): Promise<string> {
    const enabled = deps.enabled ?? SLASH_COMMANDS_ENABLED;
    if (!enabled) return message;

    const parsed = parseSlashCommand(message);
    if (!parsed) return message;

    try {
        const find = deps.findSkillBySlug ?? defaultFindSkillBySlug;
        const skill = await find(parsed.slug, deps.userId);
        if (!skill) return message; // 미매칭 — 원문 유지(일반 텍스트로 취급)
        logger.info(`슬래시 명령 적용: /${parsed.slug} → 스킬 "${skill.name}"`);
        deps.onSkillApplied?.(skill.name);
        return buildAugmentedMessage(skill, parsed.rest);
    } catch (e) {
        logger.warn(`슬래시 명령 처리 실패 (원문 유지): ${e instanceof Error ? e.message : String(e)}`);
        return message;
    }
}
