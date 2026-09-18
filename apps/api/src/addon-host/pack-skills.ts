/**
 * 팩 스킬 — 매니페스트 `components.skills` 가 가리키는 정적 스킬 정의와 그 설치 (Add-on 전환 P2, 2026-09-19).
 *
 * 팩이 무엇이든 설치 경로는 이 하나다: 정의를 읽어 시스템 스킬로 upsert 하고, `assignToAgent` 가 있으면
 * 그 에이전트에 배정한다. 팩별 시더 코드를 두지 않는다 — 새 팩은 `skills.json` 만 싣는다.
 *
 * @module addon-host/pack-skills
 */
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { builtinAddonDir, type BuiltinAddonId } from './builtin-registry';
import { addonManifestSchema } from './manifest';

const packSkillSchema = z.object({
    /** agent_skills.id — 팩이 정한 결정적 id (재설치 시 같은 행을 갱신) */
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    /** 영어 표시 이름 — 한국어 외 UI 의 스킬 칩용 */
    nameEn: z.string().min(1).max(200).optional(),
    description: z.string().max(2000),
    category: z.string().min(1).max(80),
    /** agent_skills.source_path — 팩을 끌 때 보관 대상을 고르는 기준이기도 하다(builtin-registry) */
    sourcePath: z.string().min(1).max(500),
    /** 이 에이전트의 페르소나 스킬로 배정 (우선순위 0) */
    assignToAgent: z.string().min(1).max(120).optional(),
    content: z.string().min(1),
}).strict();

export type PackSkillDef = z.infer<typeof packSkillSchema>;

const cache = new Map<string, PackSkillDef[]>();

/** 팩의 스킬 정의 — 매니페스트에 `components.skills` 가 없으면 빈 배열. 형식이 어긋나면 throw. */
export function loadPackSkills(id: BuiltinAddonId): PackSkillDef[] {
    const cached = cache.get(id);
    if (cached) return cached;
    const dir = builtinAddonDir(id);
    const manifest = addonManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, 'openmake-addon.json'), 'utf-8')));
    const rel = manifest.components.skills;
    const skills = rel ? z.array(packSkillSchema).parse(JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf-8'))) : [];
    cache.set(id, skills);
    return skills;
}

/** 설치에 필요한 저장소 표면 — SkillRepository 가 만족한다. */
interface PackSkillStore {
    upsertSystemSkill(id: string, input: {
        name: string; description?: string; content: string; category?: string; isPublic?: boolean; sourcePath?: string;
    }): Promise<unknown>;
    assignSkillToAgent(agentId: string, skillId: string, priority?: number): Promise<void>;
}

/** 팩 스킬을 시스템 스킬로 upsert + 배정. 한 건의 실패가 나머지를 막지 않는다. */
export async function installPackSkills(id: BuiltinAddonId, store: PackSkillStore): Promise<{ installed: number; failed: string[] }> {
    let installed = 0;
    const failed: string[] = [];
    for (const skill of loadPackSkills(id)) {
        try {
            await store.upsertSystemSkill(skill.id, {
                name: skill.name,
                description: skill.description,
                content: skill.content,
                category: skill.category,
                isPublic: true,
                sourcePath: skill.sourcePath,
            });
            if (skill.assignToAgent) await store.assignSkillToAgent(skill.assignToAgent, skill.id, 0);
            installed++;
        } catch (err) {
            failed.push(`${skill.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return { installed, failed };
}
