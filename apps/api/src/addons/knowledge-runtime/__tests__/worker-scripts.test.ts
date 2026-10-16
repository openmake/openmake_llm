/**
 * 운영 스크립트 — 문법(bash -n)과 DB 에 붙기 전 거절(사용법·접속 정보). 실 DB 동작은 knowledge-worker-mode.db.test.ts.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// __tests__ → 저장소 루트
const ROOT = resolve(__dirname, '../../../../../..');
const MODE = resolve(ROOT, 'scripts/knowledge-worker-mode.sh');

/** PATH 만 넘긴다 — DATABASE_URL·KNOWLEDGE_PSQL 이 없는 상태 */
function run(script: string, args: string[], env: Record<string, string> = {}) {
    return spawnSync('bash', [script, ...args], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' });
}

describe('scripts/knowledge-worker-mode.sh', () => {
    it('문법 오류가 없다', () => {
        expect(spawnSync('bash', ['-n', MODE]).status).toBe(0);
    });

    it('하위 명령이 없거나 모르는 것·모르는 모드는 2 로 끝나고 사용법을 보인다(DB 에 붙기 전)', () => {
        for (const args of [[], ['drop'], ['set'], ['set', 'both']]) {
            const r = run(MODE, args);
            expect(r.status).toBe(2);
            expect(r.stderr).toContain('knowledge-worker-mode.sh show');
        }
    });

    it('접속 정보(DATABASE_URL·KNOWLEDGE_PSQL)가 없으면 2 와 안내', () => {
        const r = run(MODE, ['show']);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('DATABASE_URL 이 필요하다');
    });
});
