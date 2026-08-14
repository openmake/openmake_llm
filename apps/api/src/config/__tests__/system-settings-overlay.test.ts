/**
 * system_settings overlay — config 해석 우선순위(DB > env > 기본값) 검증.
 */
import { applySettingsOverlay, getConfig, resetConfig, loadConfig } from '../env';
import { SYSTEM_SETTINGS_REGISTRY, SETTING_DEFS_BY_KEY } from '../system-settings-registry';
import { ADMIN_SYNCED_PROVIDER_KEYS } from '../external-providers';

describe('applySettingsOverlay', () => {
    const ORIGINAL_CSE = process.env.GOOGLE_CSE_ID;

    afterEach(() => {
        applySettingsOverlay({});
        if (ORIGINAL_CSE === undefined) delete process.env.GOOGLE_CSE_ID;
        else process.env.GOOGLE_CSE_ID = ORIGINAL_CSE;
        resetConfig();
    });

    it('overlay 값이 process.env 보다 우선한다 (DB > env)', () => {
        process.env.GOOGLE_CSE_ID = 'env-cse-id';
        resetConfig();
        expect(getConfig().googleCseId).toBe('env-cse-id');

        applySettingsOverlay({ GOOGLE_CSE_ID: 'db-cse-id' });
        expect(getConfig().googleCseId).toBe('db-cse-id');
    });

    it('overlay 를 비우면 env 값으로 복귀한다 (DELETE = env 폴백)', () => {
        process.env.GOOGLE_CSE_ID = 'env-cse-id';
        applySettingsOverlay({ GOOGLE_CSE_ID: 'db-cse-id' });
        expect(getConfig().googleCseId).toBe('db-cse-id');

        applySettingsOverlay({});
        expect(getConfig().googleCseId).toBe('env-cse-id');
    });

    it('applySettingsOverlay 는 캐시를 무효화해 이후 getConfig 호출에 즉시 반영된다', () => {
        const before = getConfig();
        applySettingsOverlay({ GOOGLE_CSE_ID: 'fresh-value' });
        const after = getConfig();
        expect(after).not.toBe(before);
        expect(after.googleCseId).toBe('fresh-value');
    });
});

describe('system-settings-registry', () => {
    it('키가 중복 없이 정의되어 있다', () => {
        const keys = SYSTEM_SETTINGS_REGISTRY.map((d) => d.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(SETTING_DEFS_BY_KEY.size).toBe(keys.length);
    });

    it('모든 레지스트리 키가 loadConfig 의 safeParse 입력에 배선되어 있다', () => {
        // 배선 누락(과거 NAVER_API_HUB_* 실버그) 회귀 방지 — overlay 로 넣은 값이
        // 실제 config 에 도달하는지 키마다 확인한다. 값 검증이 있는 키는 형식을 맞춘다.
        // 예외: ADMIN_SYNCED_PROVIDER_KEYS — config 소비자가 아니라 저장 시 관리자 본인
        // BYOK(user_external_api_keys) 행으로 연동되는 키 (admin-system-settings.routes).
        const wiringTargets = SYSTEM_SETTINGS_REGISTRY.filter(
            (def) => !(def.key in ADMIN_SYNCED_PROVIDER_KEYS),
        );
        const sample: Record<string, string> = {};
        for (const def of wiringTargets) {
            if (def.key === 'NAVER_API_DAILY_LIMIT') sample[def.key] = '777';
            else if (def.key.startsWith('OPERATOR_WEBHOOK') || def.key === 'OAUTH_REDIRECT_URI' || def.key === 'LLM_BASE_URL')
                sample[def.key] = 'https://example.com/wired';
            else if (def.key === 'VAPID_SUBJECT') sample[def.key] = 'mailto:wired@example.com';
            else sample[def.key] = `wired-${def.key.toLowerCase()}`;
        }
        applySettingsOverlay(sample);
        try {
            const cfg = loadConfig();
            const flat = JSON.stringify(cfg);
            for (const def of wiringTargets) {
                expect(flat).toContain(sample[def.key]);
            }
        } finally {
            applySettingsOverlay({});
        }
    });

    it('검증 스키마가 잘못된 형식을 거부한다', () => {
        const url = SETTING_DEFS_BY_KEY.get('OPERATOR_WEBHOOK_URL')!;
        expect(url.validate.safeParse('http://insecure.example.com').success).toBe(false);
        expect(url.validate.safeParse('https://hooks.slack.com/services/x').success).toBe(true);

        const limit = SETTING_DEFS_BY_KEY.get('NAVER_API_DAILY_LIMIT')!;
        expect(limit.validate.safeParse('abc').success).toBe(false);
        expect(limit.validate.safeParse('25000').success).toBe(true);

        const anyKey = SETTING_DEFS_BY_KEY.get('GOOGLE_CLIENT_ID')!;
        expect(anyKey.validate.safeParse('').success).toBe(false);
    });
});
