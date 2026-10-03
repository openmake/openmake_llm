import { endsWithActionAnnouncement, pickNoToolNudge } from './turn-stall';
import { AGENT_TASK_TURN_LOOP } from '../../config/agent-task-turn-loop';
import { AGENT_TASK_INCOMPLETE_MARKER } from '../../prompts/agent-task-prompt';

describe('endsWithActionAnnouncement — 짧은 응답이 다음 행동 예고로 끝나는가', () => {
    it('다음 행동을 예고하고 끝난 짧은 응답을 잡는다', () => {
        expect(endsWithActionAnnouncement('파일을 확인했습니다. 이제 테스트를 실행하겠습니다.')).toBe(true);
        expect(endsWithActionAnnouncement('다음으로 설정 파일을 수정할게요')).toBe(true);
        expect(endsWithActionAnnouncement('구조는 파악했습니다.\n먼저 로그를 살펴보겠습니다:')).toBe(true);
        expect(endsWithActionAnnouncement("The config looks fine. Now I'll run the tests.")).toBe(true);
        expect(endsWithActionAnnouncement('Let me now check the logs')).toBe(true);
    });

    it('완료 보고나 맺음 인사는 잡지 않는다', () => {
        expect(endsWithActionAnnouncement('작업을 완료했습니다. 결과는 report.md 에 있습니다.')).toBe(false);
        expect(endsWithActionAnnouncement('정리했습니다. 필요하시면 더 도와드리겠습니다.')).toBe(false);
        expect(endsWithActionAnnouncement('이제 테스트를 실행하겠습니다. 실행 결과 12건 모두 통과했습니다.')).toBe(false);
        expect(endsWithActionAnnouncement('I will be happy to help further.')).toBe(false);
        expect(endsWithActionAnnouncement('')).toBe(false);
    });

    it('긴 응답은 실질 답변으로 보고 잡지 않는다', () => {
        const long = `${'분석 결과입니다. '.repeat(60)}이제 테스트를 실행하겠습니다.`;
        expect(long.length).toBeGreaterThan(AGENT_TASK_TURN_LOOP.STALL_MAX_CHARS);
        expect(endsWithActionAnnouncement(long)).toBe(false);
    });
});

describe('pickNoToolNudge — 도구 호출 없이 끝난 턴을 재촉할지', () => {
    const announce = '이제 테스트를 실행하겠습니다.';
    const base = { firstTurn: false, content: announce, artifactCount: 0, canAct: true, stallNudges: 0 };

    it('첫 턴은 종전대로 산출물이 없으면 한 번 재촉한다(기록 없음)', () => {
        const r = pickNoToolNudge({ ...base, firstTurn: true, content: '계획: 1. 조사 2. 정리' });
        expect(r?.nudge).toContain('<artifact>');
        expect(r?.note).toBeUndefined();
    });

    it('첫 턴 이후에는 행동 예고로 끝난 짧은 응답만 재촉하고 기록을 남긴다', () => {
        const r = pickNoToolNudge(base);
        expect(r?.nudge).toContain('예고');
        expect(r?.note).toContain(`1/${AGENT_TASK_TURN_LOOP.STALL_NUDGE_MAX}`);
        expect(pickNoToolNudge({ ...base, content: '작업을 완료했습니다.' })).toBeNull();
    });

    it('상한만큼 재촉한 뒤에는 더 재촉하지 않는다', () => {
        expect(pickNoToolNudge({ ...base, stallNudges: AGENT_TASK_TURN_LOOP.STALL_NUDGE_MAX })).toBeNull();
    });

    it('산출물이 있거나, 수행 불가를 선언했거나, 더 행동할 수 없는 턴이면 재촉하지 않는다', () => {
        expect(pickNoToolNudge({ ...base, artifactCount: 1 })).toBeNull();
        expect(pickNoToolNudge({ ...base, firstTurn: true, artifactCount: 1 })).toBeNull();
        expect(pickNoToolNudge({ ...base, content: `${AGENT_TASK_INCOMPLETE_MARKER} ${announce}` })).toBeNull();
        expect(pickNoToolNudge({ ...base, firstTurn: true, content: `${AGENT_TASK_INCOMPLETE_MARKER} 불가` })).toBeNull();
        expect(pickNoToolNudge({ ...base, canAct: false })).toBeNull();
    });
});
