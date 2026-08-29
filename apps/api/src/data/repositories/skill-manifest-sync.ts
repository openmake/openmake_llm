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

export interface SkillManifestRow {
    id: string;
    name: string;
    description?: string | null;
    category?: string | null;
    content: string;
    version?: string;
    createdBy?: string | null;
    isPublic?: boolean;
}

type QueryFn = (sql: string, params: unknown[]) => Promise<unknown>;

/** 022/111 과 같은 fence 형식 — 소비처(buildManifestPrompt)는 `^name:`·`^category:` 멀티라인 정규식만 읽는다 */
export function buildManifestYaml(row: Pick<SkillManifestRow, 'name' | 'description' | 'category'>): string {
    const line = (v: string | null | undefined) => (v ?? '').replace(/\r?\n/g, ' ');
    return `---\nname: ${line(row.name)}\ndescription: ${line(row.description)}\ncategory: ${row.category || 'general'}\n---\n`;
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
