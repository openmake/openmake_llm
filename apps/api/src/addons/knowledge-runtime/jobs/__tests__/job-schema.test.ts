// apps/api/src/addons/knowledge-runtime/jobs/__tests__/job-schema.test.ts
/**
 * 004 마이그레이션의 CHECK 값 목록과 코드 상수가 같은지 — DB 없이 SQL 파일을 읽어 대조한다.
 * 한쪽만 바꾸면(예: 코드에 새 상태를 더하고 CHECK 를 잊음) 운영 INSERT 가 23514 로 깨지므로 CI 에서 먼저 잡는다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    JOB_ACTOR_KINDS, KNOWLEDGE_JOB_STATES, KNOWLEDGE_WORKER_MODES, REQUIRED_JOB_SCHEMA_VERSION,
} from '../job-schema';

// jobs/__tests__ → apps/api/addons/builtin/knowledge-runtime/migrations
const MIGRATIONS = resolve(__dirname, '../../../../../addons/builtin/knowledge-runtime/migrations');
const SQL = readFileSync(resolve(MIGRATIONS, '004_jobs_actor_cancel_mode.sql'), 'utf8');

/** `ADD CONSTRAINT <이름> CHECK (…);` 안의 따옴표 값 목록 */
function constraintValues(name: string): string[] {
    const m = SQL.match(new RegExp(`${name}\\s+CHECK\\s*\\(([^;]*)\\);`));
    if (!m) throw new Error(`제약 ${name} 을 찾지 못함`);
    return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

describe('004 마이그레이션 ↔ job-schema 상수', () => {
    it('state CHECK 는 KNOWLEDGE_JOB_STATES 와 같고 cancelled 를 포함한다', () => {
        expect(constraintValues('knowledge_ingestion_jobs_state_check')).toEqual([...KNOWLEDGE_JOB_STATES]);
        expect(KNOWLEDGE_JOB_STATES).toContain('cancelled');
    });

    it('actor_kind CHECK 는 JOB_ACTOR_KINDS 와 같다', () => {
        expect(constraintValues('knowledge_ingestion_jobs_actor_kind_check')).toEqual([...JOB_ACTOR_KINDS]);
    });

    it('worker 모드 표의 mode CHECK 는 KNOWLEDGE_WORKER_MODES 와 같다', () => {
        const m = SQL.match(/CREATE TABLE IF NOT EXISTS knowledge_worker_mode \([\s\S]*?mode\s+TEXT[^\n]*CHECK \(mode IN \(([^)]*)\)\)/);
        expect(m).not.toBeNull();
        expect([...(m as RegExpMatchArray)[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])).toEqual([...KNOWLEDGE_WORKER_MODES]);
    });

    it('필수 스키마 버전 키는 add-on 네임스페이스 + 파일 번호다(MigrationRunner 의 versionKey 규칙)', () => {
        expect(REQUIRED_JOB_SCHEMA_VERSION).toBe('addon:knowledge-runtime:004');
    });

    it('additive 다 — 표·열을 지우지 않고 기존 마이그레이션을 고치지 않는다', () => {
        expect(SQL).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
        expect(SQL).toMatch(/INSERT INTO knowledge_worker_mode \(id\) VALUES \(1\) ON CONFLICT \(id\) DO NOTHING;/);
    });
});
