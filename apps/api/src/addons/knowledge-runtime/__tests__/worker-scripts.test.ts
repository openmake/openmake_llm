/**
 * 운영 스크립트 — 문법(bash -n)과 DB 에 붙기 전 거절(사용법·접속 정보). 실 DB 동작은 knowledge-worker-mode.db.test.ts.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// __tests__ → 저장소 루트
const ROOT = resolve(__dirname, '../../../../../..');
const MODE = resolve(ROOT, 'scripts/knowledge-worker-mode.sh');
const DRILL = resolve(ROOT, 'scripts/knowledge-worker-rollback-drill.sh');

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

describe('scripts/knowledge-worker-rollback-drill.sh', () => {
    it('문법 오류가 없다', () => {
        expect(spawnSync('bash', ['-n', DRILL]).status).toBe(0);
    });

    it('방향이 없거나 모르면 2 와 사용법', () => {
        for (const args of [[], ['sideways']]) {
            const r = run(DRILL, args);
            expect(r.status).toBe(2);
            expect(r.stderr).toContain('knowledge-worker-rollback-drill.sh to-inprocess');
        }
    });

    it('dry-run to-inprocess — ① 모드 → ② worker 정지 → ③ lease·generation → ④ API 재시작·헬스 → worker 등록 삭제 순서', () => {
        const r = run(DRILL, ['to-inprocess'], { DRILL_DRY_RUN: '1' });
        expect(r.status).toBe(0);
        const order = [
            '① DB 모드 → inprocess',
            `[dry-run] ${MODE} set inprocess`,
            '② 별도 worker 정지',
            '[dry-run] KNOWLEDGE_WORKER_MODE=inprocess pm2 stop "openmake-knowledge-worker"',
            '③ 살아 있는 lease 0 대기',
            '④ API 재시작(KNOWLEDGE_WORKER_MODE=inprocess)',
            '[dry-run] KNOWLEDGE_WORKER_MODE=inprocess pm2 restart "openmake-llm" --update-env',
            '[dry-run] http://127.0.0.1:52416/api/health 의 knowledge 가 mode=inprocess',
            '[dry-run] KNOWLEDGE_WORKER_MODE=inprocess pm2 delete "openmake-knowledge-worker"',
            '.env 의 KNOWLEDGE_WORKER_MODE=inprocess',
        ];
        let from = 0;
        for (const line of order) {
            const at = r.stdout.indexOf(line, from);
            expect({ line, found: at >= 0 }).toEqual({ line, found: true });
            from = at + line.length;
        }
    });

    it('dry-run to-external — 앱 이름·헬스 주소·재시작 명령을 환경변수로 받는다', () => {
        const r = run(DRILL, ['to-external'], {
            DRILL_DRY_RUN: '1',
            KNOWLEDGE_WORKER_APP: 'custom-worker',
            KNOWLEDGE_API_HEALTH_URL: 'http://127.0.0.1:9999/api/health',
            KNOWLEDGE_DRILL_RESTART_API_CMD: 'echo restart-api',
        });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('① DB 모드 → external');
        expect(r.stdout).toContain('[dry-run] KNOWLEDGE_WORKER_MODE=external echo restart-api');
        expect(r.stdout).toContain('pm2 start ecosystem.config.js --only "custom-worker"');
        expect(r.stdout).toContain('[dry-run] http://127.0.0.1:9999/api/health 의 knowledge 가 mode=external');
    });
});
