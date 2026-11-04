/**
 * 오케스트레이션 셰도우 이중 기록 실 DB 검증(PR-H1-1) — TEST_DATABASE_URL 없으면 skip.
 *
 * recorder 와 지표 저장소는 실제로 로드하고, Base 풀 제공자(unified-database 의 getPool)만 TEST_DATABASE_URL 풀로 대체한다.
 * 풀은 연결 1개·유휴 종료 없음이라 TEMP 표(086·087·110·196 열 구조)가 같은 연결에서 실제 표를 가린다 — 실제 표는 건드리지 않는다.
 *  ① recordOrchestrationDispatch 가 구 열과 중립 열에 같은 값을 쓴다(fire-and-forget 이라 폴링 대기)
 *  ② getOrchestrationToggleRecall 이 두 별칭을 같은 값으로 집계하고, 구 열만 true 인 행(롤백 창)도 센다
 */
import type { Pool } from 'pg';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

jest.mock('../../../data/models/unified-database', () => {
    const { Pool: PgPool } = require('pg');
    const pool = process.env.TEST_DATABASE_URL
        ? new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 1, idleTimeoutMillis: 0 })
        : null;
    return { __esModule: true, __pool: pool, getPool: () => pool };
});
jest.mock('../../../data/retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

import { recordOrchestrationDispatch } from '../orchestration-shadow-recorder';
import { RoutingMetricsRepository } from '../../../data/repositories/routing-metrics-repository';

const testPool = (): Pool => (jest.requireMock('../../../data/models/unified-database') as { __pool: Pool }).__pool;
const MODE = 'mode-db-test';

async function waitForRows(requestId: string, n: number): Promise<Array<{ legacy: boolean; neutral: boolean }>> {
    for (let i = 0; i < 50; i++) {
        const r = await testPool().query(
            `SELECT discussion_intent AS legacy, addon_tool_intent AS neutral FROM orchestration_dispatch_decisions WHERE request_id = $1`,
            [requestId],
        );
        if ((r.rowCount ?? 0) >= n) return r.rows;
        await new Promise((res) => setTimeout(res, 20));
    }
    throw new Error(`적재 대기 시간 초과: ${requestId}`);
}

describeOrSkip('orchestration-shadow-recorder — 이중 기록 실 DB (TEMP 표)', () => {
    beforeAll(async () => {
        await testPool().query(`CREATE TEMP TABLE orchestration_dispatch_decisions (
            id BIGSERIAL PRIMARY KEY,
            request_id TEXT,
            user_id TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            query_length INTEGER NOT NULL DEFAULT 0,
            discussion_intent BOOLEAN NOT NULL DEFAULT false,
            task_delegate_intent BOOLEAN NOT NULL DEFAULT false,
            tools_exposed TEXT[] NOT NULL DEFAULT '{}',
            tool_called TEXT,
            tool_success BOOLEAN,
            user_mode TEXT NOT NULL DEFAULT 'none',
            query_preview TEXT,
            spawn_intent BOOLEAN NOT NULL DEFAULT false,
            addon_tool_intent BOOLEAN NOT NULL DEFAULT false
        )`);
    });

    afterAll(async () => {
        await testPool().end();
    });

    it('구 열과 중립 열에 같은 값을 쓰고, 지표가 두 별칭을 같은 값으로 집계한다', async () => {
        recordOrchestrationDispatch({
            requestId: 'h1-db-1', userId: 'guest', queryLength: 5, userMode: MODE, message: '질문',
            telemetry: { addonToolIntent: true, taskDelegateIntent: false, exposed: ['tool_a'] },
        });
        recordOrchestrationDispatch({
            requestId: 'h1-db-2', userId: 'guest', queryLength: 5, userMode: MODE,
            telemetry: { addonToolIntent: false, taskDelegateIntent: true, exposed: [] },
        });
        expect(await waitForRows('h1-db-1', 1)).toEqual([{ legacy: true, neutral: true }]);
        expect(await waitForRows('h1-db-2', 1)).toEqual([{ legacy: false, neutral: false }]);

        // 롤백 창에 구 코드가 쓴 행 — 중립 열은 기본값 false
        await testPool().query(
            `INSERT INTO orchestration_dispatch_decisions (request_id, user_mode, discussion_intent) VALUES ('h1-db-3', $1, true)`,
            [MODE],
        );

        const rows = await new RoutingMetricsRepository(testPool()).getOrchestrationToggleRecall(1);
        const row = rows.find((r) => r.user_mode === MODE);
        expect(row).toMatchObject({ turns: '3', addon_tool_intent_turns: '2', discussion_intent_turns: '2', task_delegate_intent_turns: '1' });
    });
});
