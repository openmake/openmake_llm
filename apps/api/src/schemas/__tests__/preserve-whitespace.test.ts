/**
 * 긴 텍스트 필드 서식 보존 (2026-09-11).
 *
 * secureTextSchema 의 기본 정제(sanitizeTextInput)는 줄바꿈 외 연속 공백을 한 칸으로 접고 NFKC·trim 을 한다.
 * REST 채팅 메시지·에이전트 작업 목표처럼 사용자가 코드를 붙여 넣는 필드는 모델에 닿기 전에 들여쓰기가
 * 사라졌다(웹 채팅 WS 경로는 이 스키마를 타지 않아 무관). 실제 sanitizer 로 검증한다.
 */
import { secureTextSchema } from '../security.schema';
import { chatRequestSchema } from '../chat.schema';
import { createAgentTaskSchema, createAgentTaskScheduleSchema, createAgentTaskTemplateSchema } from '../agent-task.schema';

const CODE = 'def f():\n    if x:\n\t\treturn 1\n';

describe('secureTextSchema preserveWhitespace', () => {
    it('기본은 연속 공백을 접는다 (짧은 필드용 종전 동작)', () => {
        expect(secureTextSchema({ detectMaliciousPatterns: false }).parse(CODE)).toBe('def f():\n if x:\n return 1');
    });

    it('preserveWhitespace 는 들여쓰기·탭·끝 줄바꿈을 두고 제어문자만 뺀다', () => {
        expect(secureTextSchema({ detectMaliciousPatterns: false, preserveWhitespace: true }).parse(`${CODE}\u0000`)).toBe(CODE);
    });
});

describe('코드가 들어오는 긴 텍스트 필드는 서식을 보존한다', () => {
    it('REST 채팅 메시지·히스토리 본문·도구 호출 인자', () => {
        const args = '{"code": "if x:\\n    y"}';
        const out = chatRequestSchema.parse({
            message: CODE,
            history: [
                { role: 'user', content: CODE },
                { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run', arguments: `  ${args}` } }] },
            ],
        });
        expect(out.message).toBe(CODE);
        expect(out.history?.[0].content).toBe(CODE);
        expect(out.history?.[1].tool_calls?.[0].function.arguments).toBe(`  ${args}`);
    });

    it('에이전트 작업·예약·템플릿 목표', () => {
        expect(createAgentTaskSchema.parse({ goal: CODE }).goal).toBe(CODE);
        expect(createAgentTaskScheduleSchema.parse({ goal: CODE, intervalSeconds: 86_400 }).goal).toBe(CODE);
        expect(createAgentTaskTemplateSchema.parse({ name: 't', goalTemplate: CODE }).goalTemplate).toBe(CODE);
    });

    it('짧은 식별 필드는 종전대로 정제한다 (모델 id 등)', () => {
        expect(chatRequestSchema.parse({ message: 'hi', model: '  qwen   x  ' }).model).toBe('qwen x');
    });
});
