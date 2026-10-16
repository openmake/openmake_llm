/**
 * 운영 스크립트 — 문법(bash -n)과 DB 에 붙기 전 거절(사용법·접속 정보), 롤백 훈련의 순서·.env 확인·인스턴스 앱 이름·
 * 종료 코드·복구 안내(가짜 psql 로 DB 없이). 실 DB 동작은 knowledge-worker-mode.db.test.ts.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// __tests__ → 저장소 루트
const ROOT = resolve(__dirname, '../../../../../..');
const MODE = resolve(ROOT, 'scripts/knowledge-worker-mode.sh');
const DRILL = resolve(ROOT, 'scripts/knowledge-worker-rollback-drill.sh');

/** PATH 만 넘긴다 — DATABASE_URL·KNOWLEDGE_PSQL 이 없는 상태 */
function run(script: string, args: string[], env: Record<string, string> = {}) {
    return spawnSync('bash', [script, ...args], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' });
}

const TMP = mkdtempSync(join(tmpdir(), 'knowledge-drill-'));
/** 훈련이 읽을 설정 파일 — 저장소 루트 .env 대신 쓴다 */
function envFile(name: string, body: string): string {
    const file = join(TMP, name);
    writeFileSync(file, body);
    return file;
}
const EMPTY_ENV = envFile('empty.env', '');

/** 가짜 psql — set 은 generation 9 를 돌려주고, lease 는 0, generation 조회는 FAKE_GEN_NOW(기본 9) */
const FAKE_PSQL = join(TMP, 'fake-psql.sh');
writeFileSync(FAKE_PSQL, [
    'sql="$(cat)"',
    'case "$sql" in',
    '    *RETURNING*) echo "mode|${FAKE_MODE:-inprocess}|generation 9" ;;',
    '    *lease_expires_at*) echo 0 ;;',
    '    *"SELECT generation"*) echo "${FAKE_GEN_NOW:-9}" ;;',
    'esac',
].join('\n'));
/** DB 없이 실제 경로(dry-run 아님)를 돌린다 — 명령은 ':' , 헬스는 닫힌 포트·대기 0 */
const LIVE = {
    KNOWLEDGE_PSQL: `bash ${FAKE_PSQL}`,
    KNOWLEDGE_DRILL_RESTART_API_CMD: ':',
    KNOWLEDGE_DRILL_STOP_WORKER_CMD: ':',
    KNOWLEDGE_DRILL_START_WORKER_CMD: ':',
    KNOWLEDGE_DRILL_DELETE_WORKER_CMD: ':',
    KNOWLEDGE_API_HEALTH_URL: 'http://127.0.0.1:1/api/health',
    KNOWLEDGE_HEALTH_WAIT_SEC: '0',
};

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

    it('dry-run to-inprocess — 시작 전 .env 확인 → ① 모드 → ② worker 정지 → ③ lease·generation → ④ .env 확인·API 재시작·헬스 → worker 등록 삭제 순서', () => {
        const r = run(DRILL, ['to-inprocess'], { DRILL_DRY_RUN: '1', KNOWLEDGE_DRILL_ENV_FILE: EMPTY_ENV });
        expect(r.status).toBe(0);
        const order = [
            '시작 전 확인',
            `[dry-run] ${EMPTY_ENV} 의 KNOWLEDGE_WORKER_MODE 가 inprocess 인지 확인(다르면 7 로 멈춘다)`,
            '① DB 모드 → inprocess',
            `[dry-run] ${MODE} set inprocess`,
            '② 별도 worker 정지',
            '[dry-run] KNOWLEDGE_WORKER_MODE=inprocess pm2 stop "openmake-knowledge-worker"',
            '③ 살아 있는 lease 0 대기',
            '④ API 재시작(KNOWLEDGE_WORKER_MODE=inprocess)',
            `[dry-run] ${EMPTY_ENV} 의 KNOWLEDGE_WORKER_MODE 가 inprocess 인지 확인`,
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

    it('앱 이름 기본값은 OMK_INSTANCE(셸 > .env)로 -<인스턴스> 를 붙이고, 명시한 앱 이름이 이긴다', () => {
        const staging = envFile('staging.env', 'OMK_INSTANCE=staging\nKNOWLEDGE_WORKER_HEARTBEAT_STALE_MS=12345\n');
        const fromFile = run(DRILL, ['to-inprocess'], { DRILL_DRY_RUN: '1', KNOWLEDGE_DRILL_ENV_FILE: staging });
        expect(fromFile.stdout).toContain('pm2 stop "openmake-knowledge-worker-staging"');
        expect(fromFile.stdout).toContain('pm2 restart "openmake-llm-staging" --update-env');
        expect(fromFile.stdout).toContain('heartbeat 가 12345ms 안인지');
        const shell = run(DRILL, ['to-external'], {
            DRILL_DRY_RUN: '1', KNOWLEDGE_DRILL_ENV_FILE: staging, OMK_INSTANCE: 'blue', KNOWLEDGE_API_APP: 'my-api',
            KNOWLEDGE_WORKER_HEARTBEAT_STALE_MS: '777',
        });
        expect(shell.stdout).toContain('pm2 restart "my-api" --update-env');
        expect(shell.stdout).toContain('--only "openmake-knowledge-worker-blue"');
        expect(shell.stdout).toContain('heartbeat 가 777ms 안인지');
    });

    it('.env 의 KNOWLEDGE_WORKER_MODE 가 목표와 다르면 아무것도 바꾸기 전에 7 과 안내(값이 없으면 inprocess 로 본다)', () => {
        const r = run(DRILL, ['to-external'], { KNOWLEDGE_DRILL_ENV_FILE: EMPTY_ENV });
        expect(r.status).toBe(7);
        expect(r.stderr).toContain('KNOWLEDGE_WORKER_MODE 가 inprocess 다(목표 external)');
        expect(r.stderr).toContain('.env 를 KNOWLEDGE_WORKER_MODE=external 로 바꾼 뒤');
        expect(r.stdout).not.toContain('① DB 모드');
        expect(r.stderr).not.toContain('복구:');
        const back = run(DRILL, ['to-inprocess'], { KNOWLEDGE_DRILL_ENV_FILE: envFile('ext.env', 'KNOWLEDGE_WORKER_MODE=external\n') });
        expect(back.status).toBe(7);
    });

    it('① 이 실패하면 3 — 아무것도 바뀌지 않았으므로 복구 안내가 없다', () => {
        const r = run(DRILL, ['to-inprocess'], { KNOWLEDGE_DRILL_ENV_FILE: EMPTY_ENV });
        expect(r.status).toBe(3);
        expect(r.stderr).toContain('DB 모드 전환 실패');
        expect(r.stderr).not.toContain('복구:');
    });

    it('generation 은 set 의 출력에서 읽는다 — 뒤 조회가 다르면 5 와 복구 안내', () => {
        const ok = run(DRILL, ['to-inprocess'], { ...LIVE, KNOWLEDGE_DRILL_ENV_FILE: EMPTY_ENV });
        expect(ok.stdout).toContain('mode|inprocess|generation 9');
        expect(ok.stdout).toContain('generation 9 확인');
        const raced = run(DRILL, ['to-inprocess'], { ...LIVE, KNOWLEDGE_DRILL_ENV_FILE: EMPTY_ENV, FAKE_GEN_NOW: '10' });
        expect(raced.status).toBe(5);
        expect(raced.stderr).toContain('기대 9, 지금 10');
        expect(raced.stderr).toContain('복구: 원인을 고친 뒤 to-inprocess 를 다시 실행한다');
    });

    it('① 뒤 실패는 문서의 종료 코드로 끝나고 복구 안내 한 줄을 남긴다 — 헬스 6 · 단계 명령 8', () => {
        const health = run(DRILL, ['to-inprocess'], { ...LIVE, KNOWLEDGE_DRILL_ENV_FILE: EMPTY_ENV });
        expect(health.status).toBe(6);
        expect(health.stderr.match(/^복구:/gm)).toHaveLength(1);
        const extEnv = envFile('ext2.env', 'KNOWLEDGE_WORKER_MODE=external\n');
        const restart = run(DRILL, ['to-external'], {
            ...LIVE, FAKE_MODE: 'external', KNOWLEDGE_DRILL_ENV_FILE: extEnv, KNOWLEDGE_DRILL_RESTART_API_CMD: 'exit 42',
        });
        expect(restart.status).toBe(8);
        expect(restart.stderr).toContain('API 재시작 명령 실패');
        expect(restart.stderr).toContain('복구: DB 모드는 이미 external 이다');
    });

    it('dry-run to-external — 앱 이름·헬스 주소·재시작 명령을 환경변수로 받는다', () => {
        const r = run(DRILL, ['to-external'], {
            DRILL_DRY_RUN: '1',
            KNOWLEDGE_DRILL_ENV_FILE: EMPTY_ENV,
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
