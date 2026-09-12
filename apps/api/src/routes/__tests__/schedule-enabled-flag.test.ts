/**
 * 스케줄 생성 시 `enabled` 가 조용히 무시되던 회귀 테스트.
 *
 * 2026-09-13 라이브: `POST /api/agent-task-schedules` 에 `enabled:false` 를 보냈는데
 * 응답 스케줄이 `enabled:true` 로 생성됐다 — 스키마가 그 필드를 몰라 zod strip 이 걷어냈다.
 * 요청과 다른 상태로 만들어지면 사용자가 끄려던 예약이 실제로 실행된다.
 */
import { createAgentTaskScheduleSchema } from '../../schemas/agent-task.schema';

describe('createAgentTaskScheduleSchema', () => {
    const base = { goal: '매일 리포트', cron: '0 5 * * *' };

    it('enabled:false 를 보존한다 (strip 금지)', () => {
        const parsed = createAgentTaskScheduleSchema.parse({ ...base, enabled: false });
        expect(parsed.enabled).toBe(false);
    });

    it('enabled:true 도 보존한다', () => {
        expect(createAgentTaskScheduleSchema.parse({ ...base, enabled: true }).enabled).toBe(true);
    });

    it('미지정이면 undefined — 호출부가 기본값(활성)을 적용한다', () => {
        expect(createAgentTaskScheduleSchema.parse(base).enabled).toBeUndefined();
    });

    it('cron/intervalSeconds 동시 지정은 거부(기존 계약 유지)', () => {
        expect(() => createAgentTaskScheduleSchema.parse({ ...base, intervalSeconds: 3600 })).toThrow();
    });
});
