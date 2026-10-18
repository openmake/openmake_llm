/**
 * Base 소스는 add-on 소유 코어 테이블(`config/addon-boundary.ts` `ADDON_OWNED_CORE_TABLES` — MCP·스킬)을 SQL 로 직접
 * 읽거나 쓰지 않는다 (2026-10-18). 그 데이터가 필요한 Base 기능은 포트(`runtime-ports/*`)를 거치고, add-on 이 꺼지면 건너뛴다.
 *
 * 검사 대상: `apps/api/src` 의 .ts 중 add-on 코드(`addons/`)·테스트·`evaluation/` 시드 도구 밖. SQL 키워드(FROM·JOIN·INTO·UPDATE·USING)
 * 바로 뒤의 테이블 이름만 본다(반대 방향 검사 `addons-no-base-table-sql.test.ts` 와 같은 규칙).
 * `BASE_SQL_ON_ADDON_TABLES_ALLOWLIST` 는 소유를 옮기는 동안의 남은 지점이고 **줄어들기만 한다**(래칫).
 */
import * as fs from 'fs';
import * as path from 'path';
import { ADDON_OWNED_CORE_TABLES } from '../config/addon-boundary';

const SRC_ROOT = path.resolve(__dirname, '..');
const SKIPPED_DIRS = new Set(['__tests__', 'evaluation', 'node_modules']);
const SQL_TABLE_REF = /\b(?:from|join|into|update|using)\s+([a-z_][a-z0-9_]*)\b/gi;

/** 남은 지점(파일 → 테이블) — 줄어들기만 한다. 비면 지운다 */
const BASE_SQL_ON_ADDON_TABLES_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
    'agents/git-ingest/agent-ingest-service.ts': ['agent_skill_assignments', 'agent_skills'],
    'agents/git-ingest/extension-components.ts': ['agent_skills', 'mcp_servers', 'skill_manifests'],
    'agents/git-ingest/git-ingest-service.ts': ['agent_skills', 'skill_manifests'],
    'agents/git-ingest/mcp-server-ingest-service.ts': ['mcp_servers'],
    'controllers/export.controller.ts': ['agent_skills', 'skill_manifests'],
    'data/db-retention.ts': ['mcp_server_instances'],
    'data/repositories/addon-install-repository.ts': ['mcp_server_catalog'],
    'data/repositories/external-repository.ts': ['mcp_servers'],
    'data/repositories/marketplace-export-repository.ts': ['agent_skills', 'mcp_servers', 'skill_assets'],
    'data/repositories/mcp-admin-monitoring-repository.ts': ['mcp_server_instances', 'mcp_servers'],
    'data/repositories/mcp-catalog-admin-repository.ts': ['mcp_server_catalog'],
    'data/repositories/mcp-catalog-helpers.ts': ['mcp_server_instances', 'mcp_servers'],
    'data/repositories/mcp-catalog-oauth-client-repository.ts': ['mcp_catalog_oauth_clients', 'mcp_servers'],
    'data/repositories/mcp-catalog-repository.ts': ['mcp_server_catalog', 'mcp_server_instances', 'mcp_servers'],
    'data/repositories/mcp-oauth-repository.ts': ['mcp_oauth_credentials'],
    'data/repositories/mcp-server-draft-repository.ts': ['mcp_servers'],
    'data/repositories/skill-asset-repository.ts': ['skill_assets'],
    'data/repositories/skill-assignment-repository.ts': ['agent_skill_assignments', 'agent_skills'],
    'data/repositories/skill-draft-query.ts': ['agent_skills'],
    'data/repositories/skill-manifest-sync.ts': ['skill_manifests'],
    'data/repositories/skill-repository.ts': ['agent_skill_assignments', 'agent_skills', 'skill_manifests'],
    'data/repositories/user-extension-permission-repository.ts': ['mcp_servers'],
    'data/repositories/user-extension-repository.ts': ['agent_skill_assignments', 'agent_skills', 'mcp_servers'],
    'data/user-manager.ts': ['agent_skills', 'skill_manifests'],
    'services/agent-task/procedural-dormancy.ts': ['skill_audit_log'],
};

function baseSources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRS.has(entry.name) && path.relative(SRC_ROOT, full) !== 'addons') out.push(...baseSources(full));
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

/** PURE: 소스 한 개에서 SQL 키워드 뒤에 오는 add-on 소유 테이블(중복 제거·정렬) */
function ownedTableRefs(source: string, owned: ReadonlySet<string>): string[] {
    return [...new Set([...source.matchAll(SQL_TABLE_REF)].map((m) => m[1].toLowerCase()).filter((t) => owned.has(t)))].sort();
}

describe('Base 소스는 add-on 소유 코어 테이블을 SQL 로 직접 쓰지 않는다', () => {
    const owned = new Set(Object.values(ADDON_OWNED_CORE_TABLES).flat());

    it('검사기는 SQL 키워드 뒤의 소유 테이블만 잡는다(자가 점검)', () => {
        expect(ownedTableRefs('SELECT * FROM mcp_servers s JOIN users u ON u.id = s.user_id', owned)).toEqual(['mcp_servers']);
        expect(ownedTableRefs("const mcp_servers = 1; import { agent_skills } from './x';", owned)).toEqual([]);
    });

    it('남은 지점은 허용 목록과 같다 — 늘면 포트를 거치고, 줄었으면 목록에서도 지운다', () => {
        const actual: Record<string, string[]> = {};
        for (const file of baseSources(SRC_ROOT)) {
            const refs = ownedTableRefs(fs.readFileSync(file, 'utf8'), owned);
            if (refs.length > 0) actual[path.relative(SRC_ROOT, file).split(path.sep).join('/')] = refs;
        }
        expect(actual).toEqual(BASE_SQL_ON_ADDON_TABLES_ALLOWLIST);
    });
});
