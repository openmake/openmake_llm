/**
 * GET /ready — 쓰기 없는 준비 확인(운영 배포 스모크가 채팅 대신 쓴다): LLM 노드 + DB + 기본 모델이 노드 목록에 있는지.
 */
import express from 'express';
import request from 'supertest';

let dbQuery = jest.fn(async () => ({ rows: [{ '?column?': 1 }] }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({ query: (...a: unknown[]) => dbQuery(...(a as [])) }) }));
let defaultModel = 'qwen3.8-27b';
jest.mock('../../config/env', () => {
    const actual = jest.requireActual('../../config/env');
    return { ...actual, getConfig: () => ({ ...actual.getConfig(), llmDefaultModel: defaultModel }) };
});
let backgroundOk = true;
jest.mock('../../services/agent-task/background-liveness', () => ({ getBackgroundLiveness: () => ({ ok: backgroundOk, loops: {} }) }));

import { createHealthController, defaultModelListed } from '../health.controller';
import type { ClusterManager } from '../../cluster/manager';

function app(stats: { onlineNodes: number; uniqueModels: string[] }) {
    const cluster = { getStats: () => ({ totalNodes: 1, totalModels: stats.uniqueModels.length, ...stats }) } as unknown as ClusterManager;
    const a = express();
    a.use('/', createHealthController(cluster));
    return a;
}

beforeEach(() => {
    defaultModel = 'qwen3.8-27b';
    backgroundOk = true;
    dbQuery = jest.fn(async () => ({ rows: [] }));
});

describe('defaultModelListed (PURE)', () => {
    it('로컬 모델은 목록에 있는지로', () => {
        expect(defaultModelListed('qwen3.8-27b', ['qwen3.8-27b', 'bge-m3'])).toBe(true);
        expect(defaultModelListed('qwen3.8-27x', ['qwen3.8-27b'])).toBe(false);
        expect(defaultModelListed('local-llm:qwen3.8-27b', ['qwen3.8-27b'])).toBe(true);
    });
    it('외부 provider 모델이나 목록을 못 받은 경우는 판정하지 않는다(null)', () => {
        expect(defaultModelListed('openrouter:some/model', ['qwen3.8-27b'])).toBeNull();
        expect(defaultModelListed('qwen3.8-27b', [])).toBeNull();
    });
});

describe('GET /ready', () => {
    it('노드·DB·기본 모델이 모두 맞으면 200', async () => {
        const res = await request(app({ onlineNodes: 1, uniqueModels: ['qwen3.8-27b'] })).get('/ready');
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ ready: true, dbConnected: true, defaultModel: { id: 'qwen3.8-27b', listed: true } });
    });

    it('기본 모델이 노드 목록에 없으면 503 (이름·키 설정 실수)', async () => {
        defaultModel = 'qwen-typo';
        const res = await request(app({ onlineNodes: 1, uniqueModels: ['qwen3.8-27b'] })).get('/ready');
        expect(res.status).toBe(503);
        expect(res.body.data.defaultModel).toEqual({ id: 'qwen-typo', listed: false });
    });

    it('외부 provider 기본 모델은 노드 목록으로 막지 않는다', async () => {
        defaultModel = 'openrouter:some/model';
        const res = await request(app({ onlineNodes: 1, uniqueModels: ['qwen3.8-27b'] })).get('/ready');
        expect(res.status).toBe(200);
        expect(res.body.data.defaultModel.listed).toBeNull();
    });

    it('LLM 노드가 없거나 DB 가 안 되면 503', async () => {
        expect((await request(app({ onlineNodes: 0, uniqueModels: [] })).get('/ready')).status).toBe(503);
        dbQuery = jest.fn(async () => { throw new Error('db down'); });
        expect((await request(app({ onlineNodes: 1, uniqueModels: ['qwen3.8-27b'] })).get('/ready')).status).toBe(503);
    });

    it('백그라운드 루프(소유권 점검·스케줄·watchdog)가 멈췄으면 503 이고 background 를 함께 돌려준다', async () => {
        backgroundOk = false;
        const res = await request(app({ onlineNodes: 1, uniqueModels: ['qwen3.8-27b'] })).get('/ready');
        expect(res.status).toBe(503);
        expect(res.body.data.background).toEqual({ ok: false, loops: {} });
    });

    it('아무것도 쓰지 않는다 — DB 에는 SELECT 1 만', async () => {
        await request(app({ onlineNodes: 1, uniqueModels: ['qwen3.8-27b'] })).get('/ready');
        expect(dbQuery).toHaveBeenCalledTimes(1);
        expect(dbQuery).toHaveBeenCalledWith('SELECT 1');
    });
});
