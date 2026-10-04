import { digestToolCall, findToolCallArgs } from './tool-digest';
import { foldOldToolResults } from './context-fold';
import type { ChatMessage } from '../../llm/types';

describe('digestToolCall', () => {
    it('bash — 명령과 종료 코드, 실패면 마지막 출력 줄을 남긴다', () => {
        const ok = digestToolCall('bash', { command: 'npm test' }, '[stdout]\nall good\n[exit=0 1200ms]');
        expect(ok).toContain('npm test');
        expect(ok).toContain('exit=0');
        expect(ok).toContain('성공');
        const fail = digestToolCall('bash', { command: 'npm run build' }, 'Error: [stdout]\ncompiling\n[stderr]\nTS2304: Cannot find name foo\n[exit=2 900ms]');
        expect(fail).toContain('npm run build');
        expect(fail).toContain('exit=2');
        expect(fail).toContain('오류');
        expect(fail).toContain('TS2304: Cannot find name foo');
    });

    it('bash — 시간 초과를 구분한다', () => {
        expect(digestToolCall('bash', { command: 'sleep 999' }, 'Error: [exit=-1 TIMEOUT 60000ms]')).toContain('시간 초과');
    });

    it('긴 명령은 상한까지만 싣고 한 줄로 만든다', () => {
        const d = digestToolCall('bash', { command: `echo ${'a'.repeat(500)}\necho b` }, '[exit=0 1ms]')!;
        expect(d.includes('\n')).toBe(false);
        expect(d.length).toBeLessThan(300);
    });

    it('파일 편집·보기 — 명령과 경로, 성패', () => {
        expect(digestToolCall('str_replace_editor', { command: 'view', path: 'src/a.ts', start_line: 120 }, 'content'))
            .toEqual(expect.stringMatching(/view src\/a\.ts.*120.*성공/));
        const fail = digestToolCall('str_replace_editor', { command: 'str_replace', path: 'src/a.ts' }, 'Error: old_str 를 찾을 수 없습니다: src/a.ts — old_str 는');
        expect(fail).toContain('str_replace src/a.ts');
        expect(fail).toContain('오류');
        expect(fail).toContain('old_str 를 찾을 수 없습니다');
        expect(digestToolCall('file_ops', { op: 'write', path: 'out/report.md' }, '기록됨: out/report.md')).toEqual(expect.stringMatching(/write out\/report\.md.*성공/));
    });

    it('검색 — 질의와 결과 유무', () => {
        expect(digestToolCall('grep_code', { pattern: 'TODO', path: 'src' }, '(일치 없음: TODO)')).toEqual(expect.stringMatching(/TODO.*src.*일치 없음/));
        expect(digestToolCall('grep_code', { pattern: 'TODO' }, 'a.ts:1:TODO x')).toContain('성공');
        expect(digestToolCall('web_search', { query: '서울 날씨' }, '결과…')).toContain('서울 날씨');
    });

    it('브라우저 — 액션 순서와 이동 주소', () => {
        const d = digestToolCall('browser', { actions: [{ type: 'goto', url: 'https://example.com/a' }, { type: 'click', selector: '#x' }, { type: 'extractText' }] }, '{"ok":true}');
        expect(d).toContain('goto https://example.com/a');
        expect(d).toContain('click');
        expect(d).toContain('extractText');
    });

    it('데이터 래퍼(<tool_output>)로 감싼 오류도 오류로 읽는다', () => {
        expect(digestToolCall('web_search', { query: 'q' }, '<tool_output>\nError: 502\n</tool_output>\n안내')).toContain('오류');
    });

    it('모르는 도구·인자 없음은 null', () => {
        expect(digestToolCall('plan_view', {}, 'x')).toBeNull();
        expect(digestToolCall('bash', undefined, '[exit=0 1ms]')).toBeNull();
    });
});

describe('findToolCallArgs', () => {
    it('tool_call_id 로 앞선 assistant 의 호출 인자를 찾는다', () => {
        const c: ChatMessage[] = [
            { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'bash', arguments: { command: 'ls' } } }] },
            { role: 'tool', content: 'x', tool_name: 'bash', tool_call_id: 'c1' },
        ];
        expect(findToolCallArgs(c, 1)).toEqual({ command: 'ls' });
        expect(findToolCallArgs([{ role: 'tool', content: 'x', tool_name: 'bash', tool_call_id: 'zz' }], 0)).toBeUndefined();
    });
});

describe('접힌 스텁', () => {
    it('도구별 한 줄(명령·성패)을 스텁 첫 줄에 싣는다', () => {
        const c: ChatMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'goal' }];
        for (let t = 0; t < 4; t++) {
            c.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${t}`, type: 'function', function: { name: 'bash', arguments: { command: `make step${t}` } } }] });
            c.push({ role: 'tool', content: `Error: [stdout]\n${'y'.repeat(600)}\n[stderr]\nstep${t} failed badly\n[exit=3 10ms]`, tool_name: 'bash', tool_call_id: `c${t}` });
        }
        foldOldToolResults(c, { keepTurns: 2, minChars: 100, headChars: 40, minBatchSavedChars: 0 });
        const first = c.filter((m) => m.role === 'tool')[0].content.split('\n')[0];
        expect(first).toContain('make step0');
        expect(first).toContain('exit=3');
        expect(first).toContain('step0 failed badly');
    });
});
