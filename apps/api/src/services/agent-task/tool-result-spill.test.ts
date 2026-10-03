/**
 * tool-result-spill — 상한을 넘는 도구 결과를 작업 공간 파일로 보관하고 미리보기와 경로를 돌려준다.
 */
jest.mock('../../config/agent-task-context', () => {
    const actual = jest.requireActual('../../config/agent-task-context');
    return { ...actual, TOOL_RESULT_SPILL: { ...actual.TOOL_RESULT_SPILL, ENABLED: true, MAX_FILE_CHARS: 50_000 } };
});

import { spillToolResult } from './tool-result-spill';
import { TOOL_RESULT_SPILL } from '../../config/agent-task-context';
import { viewWindow } from '../task-sandbox/file-view';

function target() {
    const files = new Map<string, string>();
    return { files, writeFile: jest.fn(async (p: string, c: string) => { files.set(p, c); }) };
}

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1} ${'x'.repeat(40)}`).join('\n');

describe('spillToolResult', () => {
    it('상한 이하면 null — 파일을 쓰지 않는다', async () => {
        const t = target();
        expect(await spillToolResult('bash', 'short', { cap: 1000, headRatio: 0.5, target: t })).toBeNull();
        expect(t.writeFile).not.toHaveBeenCalled();
    });

    it('상한을 넘으면 전체를 파일로 쓰고 앞·뒤 미리보기와 경로·view 안내를 돌려준다', async () => {
        const t = target();
        const raw = lines(400);
        const out = (await spillToolResult('bash', raw, { cap: 1000, headRatio: 0.5, target: t }))!;
        const path = [...t.files.keys()].find((p) => p.endsWith('.txt'))!;
        expect(path.startsWith(`${TOOL_RESULT_SPILL.DIR}/bash-`)).toBe(true);
        expect(t.files.get(path)).toBe(raw);
        expect(out).toContain('line 1 ');
        expect(out).toContain('line 400 ');
        expect(out).not.toContain('line 200 ');
        expect(out).toContain(path);
        expect(out).toContain('start_line');
        expect(out.length).toBeLessThan(1000 + 600);
        // 다시 실행하라는 안내는 넣지 않는다(반복 읽기 루프)
        expect(out).not.toContain('다시 호출');
    });

    it('안내의 줄 번호로 view 하면 생략된 구간이 이어서 보인다', async () => {
        const t = target();
        const raw = lines(400);
        const out = (await spillToolResult('bash', raw, { cap: 1000, headRatio: 0.5, target: t }))!;
        const start = Number(/start_line[^0-9]*(\d+)/.exec(out)![1]);
        const path = [...t.files.keys()].find((p) => p.endsWith('.txt'))!;
        const seen = viewWindow(t.files.get(path)!, path, { startLine: start }, 2000);
        // 미리보기 앞부분의 마지막 온전한 줄 다음 줄부터 보인다
        const lastHeadLine = Math.max(...[...out.split('...[')[0].matchAll(/line (\d+) x{40}/g)].map((m) => Number(m[1])));
        expect(seen).toContain(`line ${lastHeadLine + 1} `);
    });

    it('보관 디렉터리를 git 이 무시하게 한다(변경분 diff 에 섞이지 않게)', async () => {
        const t = target();
        await spillToolResult('bash', lines(400), { cap: 1000, headRatio: 0.5, target: t });
        expect(t.files.get(`${TOOL_RESULT_SPILL.DIR}/.gitignore`)).toBe('*\n');
    });

    it('도구 이름의 경로 문자는 파일 이름에서 뺀다', async () => {
        const t = target();
        await spillToolResult('mcp::srv/../x', lines(400), { cap: 1000, headRatio: 0.5, target: t });
        const path = [...t.files.keys()].find((p) => p.endsWith('.txt'))!;
        expect(path.slice(TOOL_RESULT_SPILL.DIR.length + 1)).toMatch(/^[A-Za-z0-9_-]+\.txt$/);
    });

    it('이미 파일인 내용(파일 도구)·너무 큰 결과·쓰기 실패는 null — 호출부가 종전 절단을 쓴다', async () => {
        const t = target();
        expect(await spillToolResult('file_ops', lines(400), { cap: 1000, headRatio: 0.5, target: t })).toBeNull();
        expect(await spillToolResult('bash', 'x'.repeat(60_000), { cap: 1000, headRatio: 0.5, target: t })).toBeNull();
        const bad = { writeFile: jest.fn(async () => { throw new Error('quota'); }) };
        expect(await spillToolResult('bash', lines(400), { cap: 1000, headRatio: 0.5, target: bad })).toBeNull();
    });
});

describe('TOOL_RESULT_SPILL 설정', () => {
    it('기본값은 꺼짐', () => {
        const actual = jest.requireActual('../../config/agent-task-context') as typeof import('../../config/agent-task-context');
        expect(actual.TOOL_RESULT_SPILL.ENABLED).toBe(false);
    });
});
