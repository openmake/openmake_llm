/**
 * SystemSettingsService — DB overlay 적용·갱신·조회 뷰 검증 (repo mock, 무DB).
 */
import { SystemSettingsService } from '../system-settings-service';
import { applySettingsOverlay, getConfig } from '../../config/env';
import type { SystemSettingsRepository, SystemSettingRow } from '../../data/repositories/system-settings-repo';

const reloadWebhookChannels = jest.fn();
jest.mock('../../monitoring/alerts', () => ({
    getAlertSystem: () => ({ reloadWebhookChannels }),
}));

// 실 DB 접근 차단 — 서비스는 명시 주입 repo 만 쓰지만 default 경로의 getPool 을 막는다
jest.mock('../../data/models/unified-database', () => ({
    getPool: () => {
        throw new Error('테스트에서 실 DB 접근 금지');
    },
}));

function makeRepo(rows: SystemSettingRow[]): jest.Mocked<SystemSettingsRepository> {
    return {
        findAll: jest.fn().mockResolvedValue(rows),
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteKey: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<SystemSettingsRepository>;
}

function row(key: string, value: string | null, isSecret = false): SystemSettingRow {
    return { key, value, isSecret, updatedAt: new Date() };
}

afterEach(() => {
    applySettingsOverlay({});
    jest.clearAllMocks();
});

describe('loadAndApply', () => {
    it('DB 값을 overlay 로 적용하고 소비자 훅을 호출한다', async () => {
        const repo = makeRepo([row('GOOGLE_CSE_ID', 'db-cse-id')]);
        const svc = new SystemSettingsService(repo);
        await svc.loadAndApply();

        expect(getConfig().googleCseId).toBe('db-cse-id');
        expect(reloadWebhookChannels).toHaveBeenCalled();
    });

    it('레지스트리 외 키와 복호화 실패(value=null) 키는 제외한다', async () => {
        const repo = makeRepo([
            row('UNKNOWN_KEY', 'x'),
            row('NAVER_API_HUB_KEY', null, true),
            row('NAVER_CLIENT_ID', 'db-naver-id'),
        ]);
        const svc = new SystemSettingsService(repo);
        await svc.loadAndApply();

        const cfg = getConfig();
        expect(cfg.naverClientId).toBe('db-naver-id');
        // 복호화 실패 키는 overlay 미포함 → env/기본값 유지 (db 값 'null' 문자열 아님)
        const view = svc.describe().find((v) => v.key === 'NAVER_API_HUB_KEY')!;
        expect(view.source).not.toBe('db');
    });
});

describe('update / reset', () => {
    it('허용되지 않은 키는 거부한다', async () => {
        const svc = new SystemSettingsService(makeRepo([]));
        await expect(svc.update({ EVIL_KEY: 'x' }, 'admin-1')).rejects.toThrow('허용되지 않은 설정 키');
        await expect(svc.reset('EVIL_KEY')).rejects.toThrow('허용되지 않은 설정 키');
    });

    it('시크릿 여부를 registry 에서 결정해 저장하고 재시작 필요 키를 보고한다', async () => {
        const repo = makeRepo([]);
        const svc = new SystemSettingsService(repo);
        const result = await svc.update(
            { GOOGLE_CLIENT_SECRET: 'plain-secret', LLM_BASE_URL: 'https://gw.example.com' },
            'admin-1',
        );

        expect(repo.upsert).toHaveBeenCalledWith('GOOGLE_CLIENT_SECRET', 'plain-secret', true, 'admin-1');
        expect(repo.upsert).toHaveBeenCalledWith('LLM_BASE_URL', 'https://gw.example.com', false, 'admin-1');
        expect(result.requiresRestart).toEqual(['LLM_BASE_URL']);
        expect(repo.findAll).toHaveBeenCalled(); // 저장 후 재적재
    });

    it('reset 은 삭제 후 재적재해 env 폴백으로 복귀시킨다', async () => {
        const repo = makeRepo([]);
        const svc = new SystemSettingsService(repo);
        const deleted = await svc.reset('GOOGLE_CSE_ID');
        expect(deleted).toBe(true);
        expect(repo.deleteKey).toHaveBeenCalledWith('GOOGLE_CSE_ID');
        expect(repo.findAll).toHaveBeenCalled();
    });
});

describe('describe', () => {
    it('시크릿 키는 값을 절대 포함하지 않는다 (isSet 만)', async () => {
        const repo = makeRepo([row('GOOGLE_CLIENT_SECRET', 'top-secret', true)]);
        const svc = new SystemSettingsService(repo);
        await svc.loadAndApply();

        for (const view of svc.describe()) {
            if (view.secret) expect(view).not.toHaveProperty('value');
        }
        const secretView = svc.describe().find((v) => v.key === 'GOOGLE_CLIENT_SECRET')!;
        expect(secretView.source).toBe('db');
        expect(secretView.isSet).toBe(true);
    });

    it('출처를 db > env 순으로 판별한다', async () => {
        const original = process.env.GOOGLE_CSE_ID;
        process.env.GOOGLE_CSE_ID = 'env-cse';
        try {
            const repo = makeRepo([row('NAVER_CLIENT_ID', 'db-naver')]);
            const svc = new SystemSettingsService(repo);
            await svc.loadAndApply();

            const views = svc.describe();
            expect(views.find((v) => v.key === 'NAVER_CLIENT_ID')!.source).toBe('db');
            const cse = views.find((v) => v.key === 'GOOGLE_CSE_ID')!;
            expect(cse.source).toBe('env');
            expect(cse.value).toBe('env-cse');
        } finally {
            if (original === undefined) delete process.env.GOOGLE_CSE_ID;
            else process.env.GOOGLE_CSE_ID = original;
        }
    });
});
