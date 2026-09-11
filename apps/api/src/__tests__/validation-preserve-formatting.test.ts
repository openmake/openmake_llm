/**
 * validate 정제 — 서식 보존 필드 (2026-09-11).
 *
 * 기본 정제(sanitizeTextInput)는 줄바꿈 외 연속 공백을 한 칸으로 접는다. 스킬 본문 저장
 * (POST/PUT /api/agents/skills)이 이 경로를 타서 코드 블록 들여쓰기가 저장할 때마다 사라졌다 —
 * 웹 편집·재작성 제안 적용 모두 해당. 실제 sanitizer 로 검증한다(목킹 없음).
 */
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate, validateWithSecurity } from '../middlewares/validation';

const schema = z.object({ name: z.string(), content: z.string() });
const CODE = 'def f():\n    if x:\n\t\treturn 1\n';

function run(mw: (req: Request, res: Response, next: NextFunction) => unknown, body: unknown) {
    const req = { headers: { 'content-type': 'application/json' }, body } as unknown as Request;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() } as unknown as Response;
    const next = jest.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    return req.body as { name: string; content: string };
}

describe('validate 정제 — 서식 보존 필드', () => {
    it('기본 정제는 연속 공백을 접는다 (짧은 필드용 종전 동작)', () => {
        const out = run(validate(schema), { name: '  a   b  ', content: CODE });
        expect(out.name).toBe('a b');
        expect(out.content).toBe('def f():\n if x:\n return 1');
    });

    it('preserveFormattingFields 필드는 들여쓰기·탭·끝 줄바꿈을 그대로 두고 제어문자만 뺀다', () => {
        const out = run(validateWithSecurity(schema, { preserveFormattingFields: ['content'] }), { name: '  a   b  ', content: `${CODE}\u0000` });
        expect(out.content).toBe(CODE);
        expect(out.name).toBe('a b'); // 지정하지 않은 필드는 종전대로 정제
    });

    it('지정한 키 안쪽의 배열·객체 문자열까지 보존한다 (히스토리·첨부·도구 인자·환경변수)', () => {
        const nested = z.object({ history: z.array(z.object({ content: z.string() })), env: z.record(z.string(), z.string()) });
        const out = run(validateWithSecurity(nested, { preserveFormattingFields: ['history', 'env'] }),
            { history: [{ content: CODE }], env: { PASS: ' a  b ' } }) as unknown as z.infer<typeof nested>;
        expect(out).toEqual({ history: [{ content: CODE }], env: { PASS: ' a  b ' } });
    });
});
