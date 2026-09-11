/**
 * agent_skills ↔ skill_manifests 동기화 헬퍼 (2026-08-29).
 *
 * 시스템 프롬프트 주입의 SoT 는 `skill_manifests` (skill-manager.buildManifestPrompt JOIN) 라
 * agent_skills 행만 만들면 배정해도 주입되지 않는다. git-ingest 는 2026-08-16 부터 manifest 를
 * 함께 만들었지만 `SkillRepository.createSkill`·`upsertSystemSkill`·skill-creator 는 아니어서
 * 21건이 누락돼 있었다(111 마이그레이션이 백필). 앞으로는 모든 생성/갱신 경로가 이 헬퍼를 탄다.
 *
 * fail-soft: 호출측이 try/catch 로 감싼다 — manifest 실패가 스킬 생성 자체를 되돌리지 않는다.
 *
 * @module data/repositories/skill-manifest-sync
 */
import { createHash } from 'crypto';

export const DEFAULT_SKILL_MANIFEST_VERSION = '1.0.0';

/**
 * `skill_manifests.version`(TEXT) 의 **최신 버전 정렬 키** (`ORDER BY` 절에 그대로 붙인다).
 *
 * `MAX(version)` / `ORDER BY version DESC` 는 사전순이라 '10.0.0' < '2.0.0', '1.30.0' < '1.4.0' 으로
 * 뒤집힌다 (운영엔 이미 1.26.0·1.30.0·1.36.0 과 4버전 스킬이 있다). 숫자 토큰 int[] 비교
 * ('v' 접두·비숫자 무시, 빈 문자열은 `{}`) → 정식 릴리스가 prerelease('-' 뒤) 보다 우선 → 원문 순.
 * 컬럼 참조는 bare `version` 이라 `FROM skill_manifests` 단독/상관 서브쿼리 안에서만 쓴다.
 */
export const SKILL_VERSION_LATEST_ORDER_SQL =
    "ARRAY(SELECT m[1]::int FROM regexp_matches(split_part(version, '-', 1), '\\d+', 'g') AS m) DESC, " +
    "(split_part(version, '-', 2) = '') DESC, version DESC";

export interface SkillManifestRow {
    id: string;
    name: string;
    description?: string | null;
    category?: string | null;
    content: string;
    version?: string;
    createdBy?: string | null;
    isPublic?: boolean;
    /** 재생성 3키 밖의 기존 yaml 블록(triggers·tool_bindings 등) — extractPreservedManifestYaml 결과 */
    preservedYaml?: string;
}

type QueryFn = (sql: string, params: unknown[]) => Promise<unknown>;

/** 재생성 시 행 값으로 다시 쓰는 키 — 나머지 최상위 블록은 보존한다 */
const REGENERATED_MANIFEST_KEYS = new Set(['name', 'description', 'category']);

/**
 * 기존 manifest_yaml 에서 재생성 대상 키와 fence 를 뺀 최상위 블록만 추출한다.
 * 종전엔 본문 수정이 yaml 을 3키로 다시 써서 triggers 가 사라졌다 — 트리거로 게이트하던 스킬이
 * 그 순간부터 모든 턴에 주입되는 잠복 결함 (2026-09-11 발견, presentation-designer 가 해당).
 */
export function extractPreservedManifestYaml(yaml: string | null | undefined): string {
    if (!yaml) return '';
    const kept: string[] = [];
    let keep = false;
    for (const line of yaml.split(/\r?\n/)) {
        if (/^---\s*$/.test(line)) { keep = false; continue; }
        const top = /^([A-Za-z_][\w-]*):/.exec(line);
        if (top) keep = !REGENERATED_MANIFEST_KEYS.has(top[1]);
        if (keep && line.trim() !== '') kept.push(line);
    }
    return kept.join('\n');
}

/** 022/111 과 같은 fence 형식 — 소비처(buildManifestPrompt)는 `^name:`·`^category:`·`^triggers:` 멀티라인 정규식으로 읽는다 */
export function buildManifestYaml(row: Pick<SkillManifestRow, 'name' | 'description' | 'category' | 'preservedYaml'>): string {
    const line = (v: string | null | undefined) => (v ?? '').replace(/\r?\n/g, ' ');
    const preserved = row.preservedYaml ? `${row.preservedYaml}\n` : '';
    return `---\nname: ${line(row.name)}\ndescription: ${line(row.description)}\ncategory: ${row.category || 'general'}\n${preserved}---\n`;
}

export function skillContentChecksum(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

/**
 * manifest 행 upsert — (id, version) 충돌 시 본문·yaml·checksum 을 갱신한다.
 * 갱신 대상 version 은 호출측이 정한다(기본 1.0.0 — 이 환경은 버전을 올리지 않고 덮어쓴다).
 */
export async function upsertSkillManifest(query: QueryFn, row: SkillManifestRow): Promise<void> {
    await query(
        `INSERT INTO skill_manifests
           (id, version, manifest_yaml, prompt_md, checksum, signature, created_by, is_public, created_at)
         VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, NOW())
         ON CONFLICT (id, version) DO UPDATE
           SET manifest_yaml = EXCLUDED.manifest_yaml,
               prompt_md = EXCLUDED.prompt_md,
               checksum = EXCLUDED.checksum,
               is_public = EXCLUDED.is_public`,
        [
            row.id,
            row.version || DEFAULT_SKILL_MANIFEST_VERSION,
            buildManifestYaml(row),
            row.content,
            skillContentChecksum(row.content),
            row.createdBy ?? null,
            row.isPublic ?? false,
        ],
    );
}
