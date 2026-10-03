/**
 * 에이전트 작업 과제 묶음(golden-agent-tasks.json)의 정의 검증 — 실제 실행(eval:agent-tasks)은 모델·샌드박스가 필요해
 * 여기서는 하지 않는다. 과제 정의가 실행기가 읽는 모양인지, 함정 과제가 노리는 상황이 과제 자료에 실제로 들어 있는지만 본다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseTrajectorySpec } from '../trajectory-evaluator';
import { createHash } from 'crypto';
import { FILE_VIEW_MAX_CHARS, MAX_TOOL_RESULT_CHARS, TOOL_RESULT_TRUNCATION } from '../../config/runtime-limits';
import { judgeExpectedAnswer } from '../agent-task-dataset';

interface GoldenFile { name: string; type?: string; content: string }
interface GoldenCase { id: string; goal: string; maxTurns: number; spec: unknown; note?: string; trap?: string; files?: GoldenFile[]; expectedAnswer?: { includes: string[] } }
interface GoldenSet { version: string; variants: Array<{ id: string; dropRules: string[] }>; cases: GoldenCase[] }

const dataset = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../golden-agent-tasks.json'), 'utf8')) as GoldenSet;
const byTrap = (trap: string): GoldenCase => {
    const found = dataset.cases.filter((c) => c.trap === trap);
    expect(found).toHaveLength(1);
    return found[0];
};
const file = (c: GoldenCase, name: string): string => {
    const f = c.files?.find((x) => x.name === name);
    if (!f) throw new Error(`${c.id}: ${name} 없음`);
    return f.content;
};

describe('golden-agent-tasks.json — 과제 정의', () => {
    it('과제 id 는 겹치지 않고, 기대 과정(spec)의 id 와 같다', () => {
        const ids = dataset.cases.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const c of dataset.cases) expect((c.spec as { id: string }).id).toBe(c.id);
    });

    it.each(dataset.cases.map((c) => [c.id, c] as const))('%s: 목표·턴 상한·기대 과정·첨부가 실행기가 읽는 모양이다', (_id, c) => {
        expect(c.goal.trim().length).toBeGreaterThan(0);
        expect(Number.isInteger(c.maxTurns) && c.maxTurns > 0).toBe(true);
        const spec = parseTrajectorySpec(c.spec); // 모르는 필드·잘못된 정규식은 던진다
        // 네트워크 없이 샌드박스 안에서 끝나는 과제다 — 검색·브라우저는 금지로 적혀 있어야 한다
        expect(spec.forbiddenTools).toEqual(expect.arrayContaining(['browser', 'web_search']));
        for (const f of c.files ?? []) {
            expect(f.name).toMatch(/^[A-Za-z0-9_][A-Za-z0-9._-]*$/);
            expect(typeof f.content).toBe('string');
            expect(f.content.length).toBeGreaterThan(0);
        }
    });

    it('기준 조건(baseline)이 첫 조건이다 — 관문은 첫 조건으로 판정한다', () => {
        expect(dataset.variants[0]).toEqual({ id: 'baseline', dropRules: [] });
    });
});

describe('golden-agent-tasks.json — 함정 과제', () => {
    it('함정 유형 여섯 가지가 하나씩 있다', () => {
        expect(dataset.cases.filter((c) => c.trap).map((c) => c.trap).sort())
            .toEqual(['answer-mid-long-output', 'answer-mid-slow-output', 'error-after-long-output', 'repeated-failing-call', 'tail-of-large-file', 'whitespace-str-replace']);
    });

    /**
     * 답이 긴 출력의 가운데에 있는 과제 — 스크립트의 상수를 읽어 출력을 그대로 다시 만들고, 답 줄이 앞·뒤 절단으로 남는
     * 구간 밖에 있는지와 정답 문자열(expectedAnswer)이 스크립트가 실제로 찍는 값인지 본다.
     */
    const midOutput = (c: GoldenCase, name: string): { total: number; answerAt: number; answerLine: string; script: string; value: string; marker: string } => {
        const script = file(c, name);
        const total = Number(/^TOTAL = (\d+)$/m.exec(script)?.[1]);
        const target = Number(/^TARGET = (\d+)$/m.exec(script)?.[1]);
        const salt = /^SALT = "([a-z-]+)"$/m.exec(script)?.[1];
        // 줄 양식은 base64 로 들어 있다 — 소스를 읽고 처음부터 걸러 받는 지름길을 막는다(속을 볼 수 없는 도구의 출력을 흉내)
        const tpl = (key: string): string | undefined => {
            const b64 = new RegExp(`^${key} = "([A-Za-z0-9+/=]+)"$`, 'm').exec(script)?.[1];
            return b64 ? Buffer.from(b64, 'base64').toString('utf8') : undefined;
        };
        const okLine = tpl('OK_LINE');
        const hitLine = tpl('HIT_LINE');
        expect(total > 0 && target > 0 && Boolean(salt) && Boolean(okLine) && Boolean(hitLine)).toBe(true);
        const value = parseInt(createHash('sha1').update(`${salt}-${target}`).digest('hex').slice(0, 6), 16) % 9000 + 1000;
        const fill = (tpl: string, i: number): string => tpl.replace('{i}', String(i).padStart(5, '0')).replace('{v}', String(value));
        let out = '';
        let answerAt = -1;
        for (let i = 1; i <= total; i++) {
            if (i === target) answerAt = out.length;
            out += `${fill(i === target ? hitLine! : okLine!, i)}\n`;
        }
        return { total: out.length, answerAt, answerLine: fill(hitLine!, target), script, value: String(value), marker: /=([A-Za-z]+)/.exec(hitLine!.replace(okLine!.split('=')[0], ''))?.[1] ?? '' };
    };

    it.each([
        ['answer-mid-long-output', 'audit.py'],
        ['answer-mid-slow-output', 'sync.py'],
    ])('긴 출력의 가운데에 답 (%s) — 답 줄이 앞·뒤 절단으로 남는 구간 밖에 있고, 정답 문자열이 그 줄에 있다', (trap, name) => {
        const c = byTrap(trap);
        const o = midOutput(c, name);
        const head = Math.floor(MAX_TOOL_RESULT_CHARS * TOOL_RESULT_TRUNCATION.HEAD_RATIO);
        // 상한의 몇 배가 넘는 출력이고, 답은 남는 앞부분·뒷부분 어디에도 걸리지 않는다(상한 전체를 한쪽에 줘도 안 보인다)
        expect(o.total).toBeGreaterThan(MAX_TOOL_RESULT_CHARS * 4);
        expect(o.answerAt).toBeGreaterThan(Math.max(head, MAX_TOOL_RESULT_CHARS));
        expect(o.answerAt).toBeLessThan(o.total - MAX_TOOL_RESULT_CHARS);
        // 샌드박스 실행 출력 상한(기본 256KB) 안이라 실행 단계에서 잘리지 않는다
        expect(o.total).toBeLessThan(200 * 1024);
        // 정답은 스크립트를 읽어서는 알 수 없고(해시로 계산) 실제 출력의 답 줄에만 있다
        expect(c.expectedAnswer?.includes.length).toBeGreaterThan(0);
        expect(judgeExpectedAnswer(c.expectedAnswer!, o.answerLine)).toBe(true);
        expect(c.expectedAnswer!.includes.some((x) => x.includes(o.value))).toBe(true);
        expect(o.script).not.toContain(o.value);
        // 소스에는 답 줄을 가려낼 낱말(답 줄에만 있는 값)이 평문으로 없다
        expect(o.marker.length).toBeGreaterThan(3);
        expect(o.script).not.toContain(o.marker);
        expect(c.goal).not.toContain(o.marker);
    });

    it('긴 출력의 가운데에 답(느린 실행) — 다시 실행하면 그만큼 기다려야 한다', () => {
        const script = file(byTrap('answer-mid-slow-output'), 'sync.py');
        const total = Number(/^TOTAL = (\d+)$/m.exec(script)?.[1]);
        const every = Number(/^PAUSE_EVERY = (\d+)$/m.exec(script)?.[1]);
        const pause = Number(/^PAUSE_SECONDS = (\d+)$/m.exec(script)?.[1]);
        const seconds = Math.floor(total / every) * pause;
        expect(seconds).toBeGreaterThanOrEqual(15);
        expect(seconds).toBeLessThanOrEqual(40); // 샌드박스 실행 제한(기본 120초)에 한참 못 미친다
    });

    it('긴 출력 뒤 오류 — 스크립트의 출력이 도구 결과 상한을 넘고, 오류는 맨 끝에 나온다', () => {
        const c = byTrap('error-after-long-output');
        const script = file(c, 'build.py');
        const lines = Number(/range\((\d+)\)/.exec(script)?.[1]);
        const lineChars = 'step 0000: compiled module ok'.length + 1;
        expect(lines * lineChars).toBeGreaterThan(MAX_TOOL_RESULT_CHARS * 2);
        // 오류를 내는 줄이 긴 출력을 찍는 반복문보다 뒤에 있다
        expect(script.indexOf('sys.exit')).toBeGreaterThan(script.indexOf('range('));
        // 고칠 대상(설정 파일)에는 스크립트가 찾는 키가 없다
        expect(script).toContain("'region'");
        expect(JSON.parse(file(c, 'settings.json'))).not.toHaveProperty('region');
    });

    it('큰 파일의 뒤쪽 줄 — 답이 한 번에 보이는 구간 밖(뒤쪽)에 있다', () => {
        const c = byTrap('tail-of-large-file');
        const log = file(c, 'server.log');
        const answerAt = log.lastIndexOf('ERROR');
        expect(log.length).toBeGreaterThan(FILE_VIEW_MAX_CHARS * 2);
        expect(answerAt).toBeGreaterThan(FILE_VIEW_MAX_CHARS);
        expect(log.slice(answerAt)).toContain('code=E4521');
        // 앞쪽에도 ERROR 줄이 있어 첫 구간만 읽으면 틀린 답이 나온다
        expect(log.indexOf('ERROR')).toBeLessThan(FILE_VIEW_MAX_CHARS);
        expect(log.slice(0, FILE_VIEW_MAX_CHARS)).not.toContain('E4521');
    });

    it('같은 실패 호출 반복 — 샌드박스에서 고칠 수 없는 실패이고, 실행 도구 호출 상한이 낮다', () => {
        const c = byTrap('repeated-failing-call');
        expect(file(c, 'report.py')).toMatch(/^import acme_internal_sdk$/m);
        const spec = parseTrajectorySpec(c.spec);
        expect(spec.maxCalls?.bash).toBeLessThanOrEqual(6);
        expect(spec.maxCalls?.python_execute).toBeLessThanOrEqual(6);
    });

    it('공백이 다른 문자열 치환 — 대상 줄이 탭으로 들여쓰이고 줄 끝에 공백이 있다', () => {
        const c = byTrap('whitespace-str-replace');
        const target = file(c, 'settings.py').split('\n').find((l) => l.includes('TIMEOUT'));
        expect(target).toBeDefined();
        expect(target!.startsWith('\t')).toBe(true);
        expect(target).toMatch(/[ \t]+$/);
        expect(parseTrajectorySpec(c.spec).maxCalls?.str_replace_editor).toBeDefined();
    });
});
