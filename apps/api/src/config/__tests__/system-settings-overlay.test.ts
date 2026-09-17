/**
 * system_settings overlay — config 해석 우선순위(DB > env > 기본값) 검증.
 */
import { applySettingsOverlay, getConfig, resetConfig, loadConfig } from '../env';
import { SYSTEM_SETTINGS_REGISTRY, SETTING_DEFS_BY_KEY } from '../system-settings-registry';
import { ADMIN_SYNCED_PROVIDER_KEYS } from '../external-providers';
import { DISCORD_RUNTIME_SETTING_KEYS } from '../discord-runtime';

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
    it('discord 그룹 키는 봇 중계 목록과 정확히 일치한다', () => {
        // 한쪽만 늘리면 값이 저장돼도 봇에 닿지 않거나(레지스트리만), 저장이 거부된다(중계 목록만).
        const groupKeys = SYSTEM_SETTINGS_REGISTRY.filter((d) => d.group === 'discord').map((d) => d.key).sort();
        expect(groupKeys).toEqual([...DISCORD_RUNTIME_SETTING_KEYS].sort());
        // 봇 API 키는 중계 요청 자체의 자격증명이라 어느 쪽에도 없어야 한다(부트스트랩 순환).
        expect(groupKeys).not.toContain('DISCORD_BOT_API_KEY');
    });

    it('키가 중복 없이 정의되어 있다', () => {
        const keys = SYSTEM_SETTINGS_REGISTRY.map((d) => d.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(SETTING_DEFS_BY_KEY.size).toBe(keys.length);
    });

    it('모든 레지스트리 키가 loadConfig 의 safeParse 입력에 배선되어 있다', () => {
        // 배선 누락(과거 NAVER_API_HUB_* 실버그) 회귀 방지 — overlay 로 넣은 값이
        // 실제 config 에 도달하는지 키마다 확인한다. 값 검증이 있는 키는 형식을 맞춘다.
        // 예외 ①: ADMIN_SYNCED_PROVIDER_KEYS — config 소비자가 아니라 저장 시 관리자 본인
        // BYOK(user_external_api_keys) 행으로 연동되는 키 (admin-system-settings.routes).
        // 예외 ②: DISCORD_RUNTIME_SETTING_KEYS — 이 프로세스가 아니라 **별도 프로세스(Discord 봇)**가
        // GET /api/integrations/discord/runtime-config 로 받아가는 중계 키라 EnvConfig 에 없다.
        // (아래 별도 테스트가 "discord 그룹 = 중계 키 목록" 을 고정해 조용한 누락을 막는다.)
        const wiringTargets = SYSTEM_SETTINGS_REGISTRY.filter(
            (def) => !(def.key in ADMIN_SYNCED_PROVIDER_KEYS)
                && !(DISCORD_RUNTIME_SETTING_KEYS as readonly string[]).includes(def.key),
        );
        const sample: Record<string, string> = {};
        for (const def of wiringTargets) {
            if (def.key === 'NAVER_API_DAILY_LIMIT') sample[def.key] = '777';
            else if (def.key === 'LLM_HOURLY_TOKEN_LIMIT') sample[def.key] = '778';
            else if (def.key === 'LLM_WEEKLY_TOKEN_LIMIT') sample[def.key] = '779';
            // enum·정수 키(F25 쿼터) — 문자열 샘플은 스키마에 걸린다
            else if (def.key === 'QUOTA_FAIL_MODE') sample[def.key] = 'closed';
            else if (def.key === 'QUOTA_EXCEEDED_ACTION') sample[def.key] = 'degrade';
            else if (def.key === 'USER_MONTHLY_COST_BUDGET_MICROS') sample[def.key] = '780';
            else if (def.key === 'MCP_TOOL_LIST_STALE_MS') sample[def.key] = '781';
            else if (def.key === 'AGENT_TASK_QUEUE_PRIORITY_MAX') sample[def.key] = '782';
            else if (def.key === 'AGENT_TASK_HITL_PARK_ON_TIMEOUT') sample[def.key] = 'true';
            else if (def.key === 'LLM_PREFIX_CACHE_SALT_MODE') sample[def.key] = 'user';
            else if (def.key === 'LLM_PRIORITY_ENABLED') sample[def.key] = 'true';
            // SLO 목표(F24.8) — 백분율·정수
            else if (def.key === 'SLO_CHAT_AVAILABILITY_TARGET') sample[def.key] = '97.51';
            else if (def.key === 'SLO_AGENT_TASK_SUCCESS_TARGET') sample[def.key] = '97.52';
            else if (def.key === 'SLO_EVAL_PASS_TARGET') sample[def.key] = '97.53';
            else if (def.key === 'SLO_CHAT_TTFT_P95_MS') sample[def.key] = '783';
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

        const slo = SETTING_DEFS_BY_KEY.get('SLO_CHAT_AVAILABILITY_TARGET')!;
        expect(slo.validate.safeParse('99.5').success).toBe(true);
        expect(slo.validate.safeParse('100').success).toBe(false);
        expect(slo.validate.safeParse('0').success).toBe(false);
        expect(slo.validate.safeParse('0.99').success).toBe(true); // 0.99% — 형식은 유효(의미는 관리자 책임, UI 설명에 백분율 명시)
        expect(slo.validate.safeParse('abc').success).toBe(false);

        const anyKey = SETTING_DEFS_BY_KEY.get('GOOGLE_CLIENT_ID')!;
        expect(anyKey.validate.safeParse('').success).toBe(false);
    });
});
