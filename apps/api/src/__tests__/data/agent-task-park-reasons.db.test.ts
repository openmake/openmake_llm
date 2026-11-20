/**
 * 목록용 주차 사유 일괄 조회(getParkReasons) — 실 DB(TEST_DATABASE_URL) 전용.
 * paused 이고 마지막 이벤트가 주차 표식인 작업만 사유가 나온다(getParkReason 과 같은 판정).
 */
import { Pool } from 'pg';
import { AgentTaskParkRepository } from '../../data/repositories/agent-task-park-repository';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

describeOrSkip('AgentTaskParkRepository.getParkReasons (실 DB)', () => {
    let pool: Pool;
    const ids: string[] = [];
    beforeAll(() => { pool = new Pool({ connectionString: CONN, max: 1 }); });
    afterAll(async () => {
        if (ids.length) await pool.query('DELETE FROM agent_tasks WHERE id = ANY($1)', [ids]);
        await pool.end();
    });
    const make = async (status: string, reasons: Array<string | null>) => {
        const id = `t-park-reasons-${Date.now()}-${ids.length}`;
        ids.push(id);
        await pool.query('INSERT INTO agent_tasks (id, goal, status) VALUES ($1, $2, $3)', [id, 'g', status]);
        for (const r of reasons) {
            await pool.query('INSERT INTO agent_task_events (task_id, from_status, to_status, reason) VALUES ($1, $2, $2, $3)', [id, status, r]);
        }
        return id;
    };

    it('paused + 마지막 이벤트가 주차 표식인 작업만 사유를 돌려준다', async () => {
        const device = await make('paused', ['hitl_parked', 'device_wait']);
        const approval = await make('paused', ['device_wait', null]);
        const running = await make('running', ['device_wait']);
        const none = await make('paused', []);
        const got = await new AgentTaskParkRepository(pool).getParkReasons([device, approval, running, none]);
        expect(got).toEqual(new Map([[device, 'device_wait']]));
    });
});
