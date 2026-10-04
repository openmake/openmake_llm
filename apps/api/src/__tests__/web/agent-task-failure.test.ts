/** 웹 실패 사유 문구(apps/web/lib/agent-task-failure.ts) — 서버 분류 7종마다 원인 라벨과 다음 행동 문구가 5개 언어에 있다. */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
import { readFileSync } from 'fs';
import { join } from 'path';
import { AGENT_TASK_FAILURE_CLASSES, classifyAgentTaskFailure } from '../../config/agent-task-failure-class';

const lib = require('../../../../web/lib/agent-task-failure') as {
    FAILURE_CLASSES: readonly string[];
    failureClassOf: (error: string | undefined, serverClass?: string | null) => string;
    failureLabelKey: (error: string, serverClass?: string | null) => string | null;
    failureNextKey: (error: string, serverClass?: string | null) => string;
};

const LOCALES = ['ko', 'en', 'ja', 'zh', 'de'];
const messages = (locale: string): Record<string, unknown> =>
    (JSON.parse(readFileSync(join(__dirname, '../../../../web/messages', `${locale}.json`), 'utf8')) as { agentTasks: Record<string, unknown> }).agentTasks;
const at = (obj: Record<string, unknown>, key: string): unknown =>
    key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);

describe('web agent-task-failure', () => {
    it('웹의 분류 목록은 서버 분류표와 같다', () => {
        expect([...lib.FAILURE_CLASSES]).toEqual([...AGENT_TASK_FAILURE_CLASSES]);
    });

    it('서버가 준 분류를 그대로 쓰고, 모르는 값이면 오류 코드로 정한다', () => {
        expect(lib.failureClassOf('500 Internal Server Error', 'llm_error')).toBe('llm_error');
        expect(lib.failureClassOf('max_turns_exhausted', null)).toBe('max_turns');
        expect(lib.failureClassOf('server restarted', undefined)).toBe('interrupted');
        expect(lib.failureClassOf('hitl_park_expired', 'bogus')).toBe('timeout');
        expect(lib.failureClassOf('뭔가 이상함', null)).toBe('unknown');
        expect(lib.failureClassOf(undefined)).toBe('unknown');
    });

    it('서버가 코드로 남기는 사유는 웹도 같은 분류로 읽는다', () => {
        for (const code of ['goal_incomplete', 'max_turns_exhausted', 'token_limit', 'timeout', 'hitl_park_expired', 'interrupted', 'interrupted_local_device', 'server restarted', 'sandbox_unavailable']) {
            expect(lib.failureClassOf(code, null)).toBe(classifyAgentTaskFailure(code));
        }
    });

    it('알려진 코드는 코드별 라벨, 자유 문구는 분류 라벨, 분류도 없으면 원문(null)', () => {
        expect(lib.failureLabelKey('hitl_park_expired', 'timeout')).toBe('errorReason.hitl_park_expired');
        expect(lib.failureLabelKey('aborted', 'llm_error')).toBe('errorReason.aborted');
        expect(lib.failureLabelKey('server restarted', 'interrupted')).toBe('errorReason.interrupted');
        expect(lib.failureLabelKey('Connection error.', 'llm_error')).toBe('errorReason.llm_error');
        expect(lib.failureLabelKey('Request timed out.', 'timeout')).toBe('errorReason.timeout');
        expect(lib.failureLabelKey('뭔가 이상함', 'unknown')).toBeNull();
        expect(lib.failureLabelKey('뭔가 이상함', null)).toBeNull();
    });

    it.each(LOCALES)('%s: 분류 7종의 라벨과 다음 행동 문구가 모두 있다', (locale) => {
        const m = messages(locale);
        const samples: Record<string, string> = {
            goal_incomplete: 'goal_incomplete', max_turns: 'max_turns_exhausted', timeout: 'timeout', token_limit: 'token_limit',
            llm_error: 'Connection error.', interrupted: 'interrupted', unknown: '뭔가 이상함',
        };
        for (const cls of AGENT_TASK_FAILURE_CLASSES) {
            const label = lib.failureLabelKey(samples[cls], cls);
            if (label !== null) expect(typeof at(m, label)).toBe('string');
            const next = at(m, lib.failureNextKey(samples[cls], cls));
            expect(typeof next).toBe('string');
            expect((next as string).length).toBeGreaterThan(0);
        }
    });

    it.each(LOCALES)('%s: 실행 환경을 받지 못한 실패는 코드별 라벨과 따로 둔 다음 행동 문구를 쓴다', (locale) => {
        const m = messages(locale);
        expect(lib.failureLabelKey('sandbox_unavailable', 'interrupted')).toBe('errorReason.sandbox_unavailable');
        expect(lib.failureNextKey('sandbox_unavailable', 'interrupted')).toBe('errorReason.next.sandbox_unavailable');
        expect(lib.failureNextKey('interrupted', 'interrupted')).toBe('errorReason.next.interrupted');
        for (const key of ['errorReason.sandbox_unavailable', 'errorReason.next.sandbox_unavailable']) {
            expect(typeof at(m, key)).toBe('string');
            expect((at(m, key) as string).length).toBeGreaterThan(0);
        }
    });
});
