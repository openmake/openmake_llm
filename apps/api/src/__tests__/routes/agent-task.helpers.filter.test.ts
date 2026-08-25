/**
 * filterTaskList — GET /api/agent-tasks 의 CLI 용 부가 필터(executor/deviceId/status).
 * toPublicTask.resumable — resume 라우트 허용 범위(failed/cancelled + checkpoint)와 일치.
 * 둘 다 순수 함수라 DB 없이 검증한다.
 */
import { filterTaskList, toPublicTask } from '../../routes/agent-task.helpers';

const rows = [
    { id: 'a', executor: 'local', device_id: 'dev-1', status: 'failed' },
    { id: 'b', executor: 'local', device_id: 'dev-2', status: 'completed' },
    { id: 'c', executor: null, device_id: null, status: 'failed' },
    { id: 'd', executor: 'local', device_id: 'dev-1', status: 'cancelled' },
];

describe('filterTaskList', () => {
    test('필터 없음 → 전부 통과', () => {
        expect(filterTaskList(rows, {}).map(r => r.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    test('executor=local 은 샌드박스(executor null) 작업을 뺀다', () => {
        expect(filterTaskList(rows, { executor: 'local' }).map(r => r.id)).toEqual(['a', 'b', 'd']);
    });

    test('deviceId 는 그 디바이스 작업만', () => {
        expect(filterTaskList(rows, { executor: 'local', deviceId: 'dev-1' }).map(r => r.id)).toEqual(['a', 'd']);
    });

    test('status 는 콤마 목록', () => {
        expect(filterTaskList(rows, { status: 'failed,cancelled' }).map(r => r.id)).toEqual(['a', 'c', 'd']);
    });

    test('빈 문자열·비문자열 쿼리는 필터로 취급하지 않는다', () => {
        expect(filterTaskList(rows, { executor: '', deviceId: ['x'], status: 42 }).length).toBe(4);
    });
});


describe('toPublicTask.resumable', () => {
    const cp = { conversation: [{ role: 'user', content: 'x' }], completedTurn: 1 };
    test('failed + checkpoint → resumable', () => {
        expect(toPublicTask({ id: 't', status: 'failed', checkpoint: cp }).resumable).toBe(true);
    });
    test('cancelled + checkpoint → resumable (resume 라우트 허용 범위와 일치)', () => {
        expect(toPublicTask({ id: 't', status: 'cancelled', checkpoint: cp }).resumable).toBe(true);
    });
    test('checkpoint 없음 / completed → 불가', () => {
        expect(toPublicTask({ id: 't', status: 'failed', checkpoint: null }).resumable).toBe(false);
        expect(toPublicTask({ id: 't', status: 'completed', checkpoint: cp }).resumable).toBe(false);
    });
});
