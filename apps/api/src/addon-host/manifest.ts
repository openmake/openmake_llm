/**
 * Add-on 매니페스트 `openmake-addon.json` — 설치·활성화 단위의 신원과 호환 범위 (Add-on 전환 P2, 2026-09-18).
 *
 * 지금 소비처는 내장 팩 부팅 검증뿐이다. 구성요소(skills·mcp·agents) 해석은 기존 Agent Plugins v1 경로
 * (`agents/git-ingest/extension-manifest-validator.ts` 의 plugin.json)가 맡고, 이 파일은 그 위에 얹는
 * 식별·호환·범위 축만 정의한다. `server`·`ui`·`migrations` 구성요소는 받지 않는다 — 인프로세스 코드
 * 로딩과 add-on 별 스키마는 열지 않았다(strict 로 거절).
 *
 * @module addon-host/manifest
 */
import { z } from 'zod';

const ADDON_ID_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;

export const ADDON_SCOPES = ['system', 'organization', 'user'] as const;

export const addonManifestSchema = z.object({
    id: z.string().min(1).max(120).regex(ADDON_ID_PATTERN),
    name: z.string().min(1).max(120),
    version: z.string().min(1).max(40),
    description: z.string().max(500).optional(),
    requires: z.object({ openmake: z.string().min(1).max(80) }),
    scope: z.enum(ADDON_SCOPES),
    components: z.object({
        skills: z.string().optional(),
        agents: z.string().optional(),
        mcp: z.string().optional(),
        /** MCP 카탈로그 템플릿 목록 JSON (addon-host/pack-catalog.ts) */
        mcpCatalog: z.string().optional(),
        data: z.string().optional(),
    }).strict(),
    permissions: z.array(z.string().min(1).max(80)).max(50).optional(),
    entitlement: z.object({ sku: z.string().min(1).max(120) }).optional(),
}).strict();

export type AddonManifest = z.infer<typeof addonManifestSchema>;

/**
 * `requires.openmake` 범위 판정 — `>=a.b.c <x.y.z` 형태의 비교식 나열만 지원한다(semver 라이브러리 미도입).
 * 해석할 수 없는 식은 불충족으로 본다(조용히 통과시키지 않는다).
 */
export function satisfiesOpenmakeRange(version: string, range: string): boolean {
    const toNums = (v: string): number[] | null => {
        const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    };
    const cmp = (a: number[], b: number[]): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    const current = toNums(version);
    if (!current) return false;
    const tests: Readonly<Record<string, (c: number) => boolean>> = {
        '>=': c => c >= 0, '>': c => c > 0, '<=': c => c <= 0, '<': c => c < 0, '=': c => c === 0,
    };
    const parts = range.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return false;
    return parts.every(part => {
        const m = /^(>=|<=|>|<|=)(\d+\.\d+\.\d+)$/.exec(part);
        const bound = m ? toNums(m[2]) : null;
        return !!m && !!bound && tests[m[1]](cmp(current, bound));
    });
}
