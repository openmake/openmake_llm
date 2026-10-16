/**
 * Add-on 소스는 Base 소유 테이블을 SQL 로 직접 읽거나 쓰지 않는다 (설계 3차 §3 C2, 로드맵 작업 7).
 *
 * Base 테이블 목록은 손으로 적지 않고 코어 스키마(`db/init/002-schema.sql`·`db/migrations/*.sql`)의 CREATE TABLE 에서 읽는다 —
 * 새 코어 테이블도 자동으로 포함된다(SQL 주석 `--` 은 지우고 읽는다).
 * 검사 대상: `apps/api/src/addons/**` 의 .ts(테스트·`evaluation/` 시드 도구 제외). SQL 키워드(FROM·JOIN·INTO·UPDATE·USING)
 * 바로 뒤의 테이블 이름만 본다. Base 테이블을 읽는 add-on 코드는 `runtime-ports/base-data-port.ts` 를 거친다(포트는 addons 밖이라 대상이 아니다).
 *
 * 예외(래칫 — 줄어들기만 한다): 스킬 스키마(agent_skills·agent_skill_assignments·skill_manifests·skill_tool_bindings·skill_mcp_bundles·skill_audit_log)는 Base 코어 자산이고 스킬 런타임 add-on 이 그 위의 판단을 가져갔다
 * (`runtime-ports/skill-runtime.ts` 머리글). 이 묶음 밖이라 그 add-on 디렉터리에서 그 테이블만 허용한다.
 * 같은 DB·같은 풀의 코드 경계이며 물리 SQL 권한 격리를 주장하지 않는다.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const ADDONS_ROOT = path.join(REPO_ROOT, 'apps', 'api', 'src', 'addons');
const SKIPPED_DIRS = new Set(['__tests__', 'evaluation']);
const SQL_TABLE_REF = /\b(?:from|join|into|update|using)\s+([a-z_][a-z0-9_]*)\b/gi;
const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi;

/** add-on 디렉터리 이름 → 그 디렉터리에서만 허용하는 Base 테이블(래칫) */
const SHARED_SCHEMA_EXCEPTIONS: Readonly<Record<string, readonly string[]>> = {
    'skill-runtime': ['agent_skill_assignments', 'agent_skills', 'skill_audit_log', 'skill_manifests', 'skill_mcp_bundles', 'skill_tool_bindings'],
};

function coreTableNames(): Set<string> {
    const migrations = path.join(REPO_ROOT, 'db', 'migrations');
    const files = [
        path.join(REPO_ROOT, 'db', 'init', '002-schema.sql'),
        ...fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).map((f) => path.join(migrations, f)),
    ];
    const names = new Set<string>();
    for (const file of files) {
        const sql = fs.readFileSync(file, 'utf8').replace(/--.*$/gm, '');
        for (const m of sql.matchAll(CREATE_TABLE)) names.add(m[1].toLowerCase());
    }
    return names;
}

function addonSources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRS.has(entry.name)) out.push(...addonSources(full));
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

/** PURE: 소스 한 개에서 SQL 키워드 뒤에 오는 Base 테이블 이름(나온 순서대로) */
function baseTableRefs(source: string, tables: ReadonlySet<string>): string[] {
    return [...source.matchAll(SQL_TABLE_REF)].map((m) => m[1].toLowerCase()).filter((name) => tables.has(name));
}

describe('add-on 소스는 Base 테이블을 SQL 로 직접 쓰지 않는다', () => {
    const tables = coreTableNames();

    it('Base 테이블 목록을 코어 스키마에서 읽는다(SQL 주석 속 문장은 제외)', () => {
        for (const t of ['conversation_sessions', 'conversation_messages', 'users', 'user_memories', 'organizations', 'organization_members']) {
            expect(tables.has(t)).toBe(true);
        }
        expect(tables.has('if')).toBe(false);
    });

    it('검사기는 SQL 키워드 뒤의 Base 테이블만 잡는다(자가 점검)', () => {
        expect(baseTableRefs('SELECT 1 FROM conversation_sessions cs JOIN users u ON u.id = cs.user_id', tables))
            .toEqual(['conversation_sessions', 'users']);
        expect(baseTableRefs("import { users } from './users'; const from = 1;", tables)).toEqual([]);
        expect(baseTableRefs('DELETE FROM some_addon_table t USING another_addon_table a', tables)).toEqual([]);
    });

    it('apps/api/src/addons/** 에 Base 테이블 SQL 이 없다(스킬 스키마 예외 제외)', () => {
        const violations: string[] = [];
        for (const file of addonSources(ADDONS_ROOT)) {
            const rel = path.relative(ADDONS_ROOT, file).split(path.sep).join('/');
            const allowed = new Set(SHARED_SCHEMA_EXCEPTIONS[rel.split('/')[0]] ?? []);
            for (const table of baseTableRefs(fs.readFileSync(file, 'utf8'), tables)) {
                if (!allowed.has(table)) violations.push(`${rel}: ${table}`);
            }
        }
        expect(violations).toEqual([]);
    });
});
