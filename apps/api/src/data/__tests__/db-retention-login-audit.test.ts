/**
 * db-retention — 성공 로그인 감사 기록(login.succeeded) 보존 스윕.
 * 로그인마다 한 행이 쌓이므로 이 action 행만 기간이 지나면 지운다. 다른 action 의 감사 기록은 지우지 않는다.
 */
const mockQuery = jest.fn();
jest.mock('../models/unified-database', () => ({
    getUnifiedDatabase: () => ({ getPool: () => ({ query: mockQuery }) }),
}));

import { startDbRetention } from '../db-retention';

const ENV_KEY = 'AUDIT_LOGIN_SUCCESS_RETENTION_DAYS';

async function runOnce(): Promise<Array<[string, unknown[] | undefined]>> {
    const spy = jest.spyOn(global, 'setInterval');
    startDbRetention();
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
    for (const r of spy.mock.results) clearInterval(r.value as NodeJS.Timeout);
    spy.mockRestore();
    return mockQuery.mock.calls.map((c) => [String(c[0]), c[1] as unknown[] | undefined]);
}

function auditDeletes(calls: Array<[string, unknown[] | undefined]>): Array<[string, unknown[] | undefined]> {
    return calls.filter(([sql]) => /DELETE\s+FROM\s+audit_logs/i.test(sql) && /'login\.succeeded'/.test(sql));
}

function authzDeniedDeletes(calls: Array<[string, unknown[] | undefined]>): Array<[string, unknown[] | undefined]> {
    return calls.filter(([sql]) => /DELETE\s+FROM\s+audit_logs/i.test(sql) && /'security\.authz_denied'/.test(sql));
}

describe('db-retention — login.succeeded 보존', () => {
    const saved = process.env[ENV_KEY];

    beforeEach(() => {
        mockQuery.mockReset();
        mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });
        delete process.env[ENV_KEY];
    });

    afterAll(() => {
        if (saved === undefined) delete process.env[ENV_KEY];
        else process.env[ENV_KEY] = saved;
    });

    it('기본 90일이 지난 login.succeeded 행만 지운다', async () => {
        const deletes = auditDeletes(await runOnce());
        expect(deletes).toHaveLength(1);
        expect(deletes[0][0]).toMatch(/action\s*=\s*'login\.succeeded'/);
        expect(deletes[0][0]).toMatch(/timestamp\s*<\s*NOW\(\)/);
        expect(deletes[0][1]).toEqual(['90']);
    });

    it('환경 변수로 기간을 바꾼다', async () => {
        process.env[ENV_KEY] = '30';
        const deletes = auditDeletes(await runOnce());
        expect(deletes).toHaveLength(1);
        expect(deletes[0][1]).toEqual(['30']);
    });

    it('0 이면 지우지 않는다', async () => {
        process.env[ENV_KEY] = '0';
        expect(auditDeletes(await runOnce())).toHaveLength(0);
    });

    it('PII 익명화(기존 정책)는 그대로 전체 action 에 적용된다', async () => {
        const calls = await runOnce();
        const anonymize = calls.filter(([sql]) => /UPDATE\s+audit_logs/i.test(sql));
        expect(anonymize).toHaveLength(1);
        expect(anonymize[0][0]).not.toMatch(/action\s*=/);
    });
});

describe('db-retention — security.authz_denied 보존(S10)', () => {
    const KEY = 'AUDIT_AUTHZ_DENIED_RETENTION_DAYS';
    // login.succeeded 기간(ENV_KEY)도 비운다 — CI env 가 0 이면 "DELETE 문장 2개" 기대가 깨진다.
    const saved = { [KEY]: process.env[KEY], [ENV_KEY]: process.env[ENV_KEY] };

    beforeEach(() => {
        mockQuery.mockReset();
        mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });
        delete process.env[KEY];
        delete process.env[ENV_KEY];
    });

    afterEach(() => {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    });

    it('기본 30일이 지난 security.authz_denied 행만 지운다', async () => {
        const deletes = authzDeniedDeletes(await runOnce());
        expect(deletes).toHaveLength(1);
        expect(deletes[0][0]).toMatch(/action\s*=\s*'security\.authz_denied'/);
        expect(deletes[0][0]).toMatch(/timestamp\s*<\s*NOW\(\)/);
        expect(deletes[0][1]).toEqual(['30']);
    });

    it('환경 변수로 기간을 바꾸고, 0 이면 지우지 않는다', async () => {
        process.env[KEY] = '7';
        expect(authzDeniedDeletes(await runOnce())[0][1]).toEqual(['7']);
        mockQuery.mockClear();
        process.env[KEY] = '0';
        expect(authzDeniedDeletes(await runOnce())).toHaveLength(0);
    });

    it('audit_logs 를 지우는 문장은 login.succeeded·security.authz_denied 두 action 뿐이다', async () => {
        const all = (await runOnce()).filter(([sql]) => /DELETE\s+FROM\s+audit_logs/i.test(sql));
        expect(all).toHaveLength(2);
    });
});
