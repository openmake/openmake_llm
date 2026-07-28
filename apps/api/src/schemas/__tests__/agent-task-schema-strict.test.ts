/**
 * 에이전트 작업 스키마 계약 테스트 — 조용한 무시 금지 (2026-07-26).
 *
 * 배경: `approvalPolicy` 를 생성(POST /api/agent-tasks)에 실어 보내면 비-strict 객체가
 * 미선언 키를 strip 해 조용히 사라졌다. 요청은 200 이고 작업도 만들어지므로, 증상은
 * "정책을 none 으로 줬는데 첫 도구에서 승인 대기" 로만 보여 원인이 드러나지 않았다.
 * 잘못 놓인 옵션과 오타는 400 으로 즉시 알린다.
 */
import { createAgentTaskSchema, executeAgentTaskSchema } from '../agent-task.schema';

const messages = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) =>
    (r.error?.issues ?? []).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');

describe('createAgentTaskSchema — 잘못 놓인 옵션 거절', () => {
    it('정상 입력은 그대로 통과한다', () => {
        const r = createAgentTaskSchema.safeParse({ goal: '보고서 작성', maxTurns: 5, executor: 'sandbox' });
        expect(r.success).toBe(true);
    });

    it('approvalPolicy 는 execute 로 안내하며 거절한다 (조용히 버리지 않음)', () => {
        const r = createAgentTaskSchema.safeParse({ goal: 'g', approvalPolicy: 'none' });
        expect(r.success).toBe(false);
        expect(messages(r)).toContain('/execute');
    });

    it('오타 키도 거절한다 — 설정만 안 먹는 증상으로 숨지 않게', () => {
        const r = createAgentTaskSchema.safeParse({ goal: 'g', maxTurn: 3 });
        expect(r.success).toBe(false);
        expect(messages(r)).toContain('maxTurn');
    });
});

describe('executeAgentTaskSchema — 실행 옵션 계약', () => {
    it('빈 본문을 허용한다 (프론트는 기본 정책이면 {} 를 보낸다)', () => {
        expect(executeAgentTaskSchema.safeParse({}).success).toBe(true);
    });

    it('allowedSkills 를 선언한다 — 빠지면 검증된 body 치환 때 통째로 사라진다', () => {
        const r = executeAgentTaskSchema.safeParse({ approvalPolicy: 'none', allowedSkills: ['a', 'b'] });
        expect(r.success).toBe(true);
        expect(r.success && r.data.allowedSkills).toEqual(['a', 'b']);
    });

    it('상한 초과 allowedSkills 는 잘라내지 않고 거절한다', () => {
        const r = executeAgentTaskSchema.safeParse({ allowedSkills: Array.from({ length: 51 }, (_, i) => `s${i}`) });
        expect(r.success).toBe(false);
    });

    it('잘못된 승인 정책 값은 거절한다', () => {
        expect(executeAgentTaskSchema.safeParse({ approvalPolicy: 'auto' }).success).toBe(false);
    });

    it('미선언 키도 거절한다', () => {
        expect(executeAgentTaskSchema.safeParse({ approvalPolicyy: 'none' }).success).toBe(false);
    });
});
