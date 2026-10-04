/**
 * 에이전트 작업 진행 이벤트 기록 — 사용자별 순번·시각을 붙여 잠깐 보관하고, 재연결한 클라이언트에 놓친 것만 다시 준다.
 */
import { AgentTaskProgressLog, replayAgentTaskProgress, sequenceAgentTaskProgress } from '../agent-task-progress-log';

const ev = (taskId: string, progress: number) => ({ type: 'agent_task_progress', taskId, status: 'running', progress, currentTurn: 1 });

describe('AgentTaskProgressLog', () => {
    it('이벤트에 순번(증가)과 시각을 붙인다', () => {
        const log = new AgentTaskProgressLog({ startSeq: 100, maxEvents: 10, ttlMs: 60_000 });
        const a = log.append('u1', ev('t1', 10), 1000);
        const b = log.append('u1', ev('t1', 20), 1001);
        expect(a).toMatchObject({ taskId: 't1', progress: 10, seq: 101, ts: 1000 });
        expect(b.seq).toBe(102);
    });

    it('afterSeq 뒤의 이벤트만, 그 사용자 것만 돌려준다', () => {
        const log = new AgentTaskProgressLog({ startSeq: 100, maxEvents: 10, ttlMs: 60_000 });
        const a = log.append('u1', ev('t1', 10), 1000);
        log.append('u2', ev('t9', 50), 1000);
        const c = log.append('u1', ev('t1', 30), 1002);
        const r = log.replay('u1', a.seq, 1003);
        expect(r.gap).toBe(false);
        expect(r.events.map((e) => e.seq)).toEqual([c.seq]);
    });

    it('놓친 이벤트가 없으면 빈 목록, 빈틈 없음', () => {
        const log = new AgentTaskProgressLog({ startSeq: 100, maxEvents: 10, ttlMs: 60_000 });
        const a = log.append('u1', ev('t1', 10), 1000);
        expect(log.replay('u1', a.seq, 1001)).toEqual({ events: [], gap: false });
    });

    it('상한을 넘어 밀려난 이벤트가 재생 범위에 있었으면 빈틈(gap)이다', () => {
        const log = new AgentTaskProgressLog({ startSeq: 100, maxEvents: 2, ttlMs: 60_000 });
        const a = log.append('u1', ev('t1', 10), 1000);
        log.append('u1', ev('t1', 20), 1001);
        log.append('u1', ev('t1', 30), 1002);
        log.append('u1', ev('t1', 40), 1003); // seq 102 가 밀려남
        const r = log.replay('u1', a.seq, 1004);
        expect(r.gap).toBe(true);
        expect(r.events.map((e) => e.progress)).toEqual([30, 40]);
    });

    it('밀려난 이벤트를 이미 다 받았으면 빈틈이 아니다', () => {
        const log = new AgentTaskProgressLog({ startSeq: 100, maxEvents: 2, ttlMs: 60_000 });
        log.append('u1', ev('t1', 10), 1000);
        const b = log.append('u1', ev('t1', 20), 1001);
        log.append('u1', ev('t1', 30), 1002);
        log.append('u1', ev('t1', 40), 1003);
        expect(log.replay('u1', b.seq, 1004).gap).toBe(false);
    });

    it('보관 시간이 지난 이벤트는 버리고, 재생 범위에 있었으면 빈틈이다', () => {
        const log = new AgentTaskProgressLog({ startSeq: 100, maxEvents: 10, ttlMs: 1000 });
        const a = log.append('u1', ev('t1', 10), 1000);
        log.append('u1', ev('t1', 20), 1500);
        log.append('u1', ev('t1', 30), 2400);
        const r = log.replay('u1', a.seq, 2600); // 20(1500) 은 만료
        expect(r.gap).toBe(true);
        expect(r.events.map((e) => e.progress)).toEqual([30]);
    });

    it('서버가 재시작됐으면(클라이언트 순번이 시작 순번보다 앞) 빈틈이다', () => {
        const log = new AgentTaskProgressLog({ startSeq: 5000, maxEvents: 10, ttlMs: 60_000 });
        expect(log.replay('u1', 4200, 1000)).toEqual({ events: [], gap: true });
    });

    it('순번을 모르는 클라이언트(afterSeq 없음)는 빈틈으로 보지 않고 아무것도 재생하지 않는다', () => {
        const log = new AgentTaskProgressLog({ startSeq: 100, maxEvents: 10, ttlMs: 60_000 });
        log.append('u1', ev('t1', 10), 1000);
        expect(log.replay('u1', undefined, 1001)).toEqual({ events: [], gap: false });
    });

    it('보관할 이벤트가 없어진 사용자는 정리된다', () => {
        const log = new AgentTaskProgressLog({ startSeq: 100, maxEvents: 10, ttlMs: 1000 });
        log.append('u1', ev('t1', 10), 1000);
        log.sweep(5000);
        expect(log.userCount()).toBe(0);
    });
});

describe('replayAgentTaskProgress — 재연결한 소켓에 놓친 진행 이벤트를 보낸다', () => {
    const socket = () => { const sent: Array<Record<string, unknown>> = []; return { sent, send: (s: string) => { sent.push(JSON.parse(s)); } }; };

    it('놓친 이벤트를 순서대로 보낸다', () => {
        const log = new AgentTaskProgressLog({ startSeq: 100, maxEvents: 10, ttlMs: 60_000 });
        const a = log.append('u1', ev('t1', 10));
        log.append('u1', ev('t1', 20));
        log.append('u1', ev('t1', 30));
        const ws = socket();
        replayAgentTaskProgress(ws, 'u1', a.seq, log);
        expect(ws.sent.map((m) => [m.type, m.progress])).toEqual([['agent_task_progress', 20], ['agent_task_progress', 30]]);
    });

    it('빈틈이 있으면 먼저 agent_task_resync 를 보내 다시 읽게 한다', () => {
        const log = new AgentTaskProgressLog({ startSeq: 5000, maxEvents: 10, ttlMs: 60_000 });
        log.append('u1', ev('t1', 10));
        const ws = socket();
        replayAgentTaskProgress(ws, 'u1', 4000, log);
        expect(ws.sent.map((m) => m.type)).toEqual(['agent_task_resync', 'agent_task_progress']);
    });

    it('로그인하지 않은 연결·형식이 틀린 순번은 아무것도 보내지 않는다', () => {
        const log = new AgentTaskProgressLog({ startSeq: 100, maxEvents: 10, ttlMs: 60_000 });
        log.append('u1', ev('t1', 10));
        const ws = socket();
        replayAgentTaskProgress(ws, undefined, 100, log);
        replayAgentTaskProgress(ws, 'u1', 'abc', log);
        replayAgentTaskProgress(ws, 'u1', -1, log);
        expect(ws.sent).toEqual([]);
    });
});

describe('sequenceAgentTaskProgress — 소켓으로 나가는 필드', () => {
    it('대기 사유(waitReason)를 싣는다 — 채팅 카드가 기기 연결 대기를 승인 대기와 구분한다', () => {
        const log = new AgentTaskProgressLog({ startSeq: 100, maxEvents: 10, ttlMs: 60_000 });
        const out = sequenceAgentTaskProgress({ userId: 'u1', taskId: 't1', status: 'paused', progress: 10, currentTurn: 2, waitReason: 'device_wait' }, log);
        expect(out).toMatchObject({ type: 'agent_task_progress', status: 'paused', waitReason: 'device_wait' });
        expect(sequenceAgentTaskProgress({ userId: 'u1', taskId: 't1', status: 'running', progress: 10, currentTurn: 2 }, log)).not.toHaveProperty('waitReason');
    });
});
