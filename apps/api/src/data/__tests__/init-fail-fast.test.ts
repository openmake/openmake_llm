/**
 * DB 초기화 Fail-Fast 회귀 가드.
 *
 * 초기화 실패를 `.catch` 가 삼키면 ensureReady() 가 항상 resolve 해 server.ts 의
 * "DB 초기화 실패 — Fail-Fast" 가 절대 실행되지 않는다(스키마 없는 채로 요청을 받는다).
 *  ① ensureReady() 는 초기화 실패를 그대로 reject 한다.
 *  ② 아무도 await 하기 전의 초기화 promise 가 unhandledRejection 을 내지 않는다.
 */

const initSchemaMock = jest.fn();

jest.mock('pg', () => ({
    Pool: jest.fn().mockImplementation(() => ({ on: jest.fn(), query: jest.fn(), end: jest.fn() })),
}));
jest.mock('../models/schema-initializer', () => ({
    initSchema: (...args: unknown[]) => initSchemaMock(...args),
}));
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import * as unifiedDatabase from '../models/unified-database';
import { getConversationDB } from '../conversation-db';
import { getUserManager } from '../user-manager';

/** 생성만 하고 한 틱 기다린다 — 그 사이 unhandledRejection 이 났는지 센다 */
async function unhandledDuring(create: () => unknown): Promise<{ created: unknown; unhandled: unknown[] }> {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
        const created = create();
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        return { created, unhandled };
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
}

describe('DB 초기화 Fail-Fast', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('UnifiedDatabase.ensureReady 는 스키마 초기화 실패를 reject 한다(unhandledRejection 없이)', async () => {
        initSchemaMock.mockRejectedValueOnce(new Error('schema boom'));

        const { created, unhandled } = await unhandledDuring(() => new unifiedDatabase.UnifiedDatabase());

        expect(unhandled).toEqual([]);
        await expect((created as unifiedDatabase.UnifiedDatabase).ensureReady()).rejects.toThrow('schema boom');
    });

    it('UnifiedDatabase.ensureReady 는 초기화가 성공하면 resolve 한다', async () => {
        initSchemaMock.mockResolvedValueOnce(undefined);
        await expect(new unifiedDatabase.UnifiedDatabase().ensureReady()).resolves.toBeUndefined();
    });

    it('ConversationDB.ensureReady 는 초기화 실패를 reject 한다(unhandledRejection 없이)', async () => {
        jest.spyOn(unifiedDatabase, 'getPool').mockImplementation(() => { throw new Error('pool boom'); });
        const Ctor = getConversationDB().constructor as new () => { ensureReady(): Promise<void> };

        const { created, unhandled } = await unhandledDuring(() => new Ctor());

        expect(unhandled).toEqual([]);
        await expect((created as { ensureReady(): Promise<void> }).ensureReady()).rejects.toThrow('pool boom');
    });

    it('UserManager.ensureReady 는 초기화 실패를 reject 한다(unhandledRejection 없이)', async () => {
        jest.spyOn(unifiedDatabase, 'getPool').mockImplementation(() => { throw new Error('admin boom'); });
        const Ctor = getUserManager().constructor as new () => { ensureReady(): Promise<void> };

        const { created, unhandled } = await unhandledDuring(() => new Ctor());

        expect(unhandled).toEqual([]);
        await expect((created as { ensureReady(): Promise<void> }).ensureReady()).rejects.toThrow('admin boom');
    });
});
