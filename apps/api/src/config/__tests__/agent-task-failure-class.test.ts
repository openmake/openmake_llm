/**
 * 실패 분류표(131) — 운영 실측 error 값과 마이그레이션 백필 CASE 가 같은 결과를 내야 한다.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { classifyAgentTaskFailure, AGENT_TASK_FAILURE_CLASSES } from '../agent-task-failure-class';

const SAMPLES: Array<[string | null, string]> = [
    ['goal_incomplete', 'goal_incomplete'],
    ['max_turns_exhausted', 'max_turns'],
    ['Request was aborted.', 'llm_error'],
    ['Request timed out.', 'timeout'],
    ['Connection error.', 'llm_error'],
    ['server restarted', 'interrupted'],
    ['interrupted_local_device', 'interrupted'],
    ['500 litellm.InternalServerError: InternalServerError: OpenAIException - boom', 'llm_error'],
    ['timeout', 'timeout'],
    ['token_limit', 'token_limit'],
    ['샌드박스 생성 실패', 'unknown'],
    [null, 'unknown'],
];

describe('classifyAgentTaskFailure', () => {
    it.each(SAMPLES)('%s → %s', (error, cls) => {
        expect(classifyAgentTaskFailure(error)).toBe(cls);
    });

    it('분류 결과는 선언된 목록 안에 있다', () => {
        for (const [e] of SAMPLES) expect(AGENT_TASK_FAILURE_CLASSES).toContain(classifyAgentTaskFailure(e));
    });

    it('마이그레이션 131 백필이 모든 분류 값을 다룬다(표와 SQL 동기화)', () => {
        const sql = readFileSync(join(__dirname, '../../../../../db/migrations/131_agent_task_priority_failure_class.sql'), 'utf8');
        for (const cls of AGENT_TASK_FAILURE_CLASSES) expect(sql).toContain(`'${cls}'`);
    });
});
