/**
 * ADMIN_SYNCED_PROVIDER_KEYS — admin system-settings ↔ 관리자 BYOK 연동 매핑 일관성 가드.
 * 매핑 키가 registry(화이트리스트)에 없으면 저장 자체가 400이라 연동이 죽고,
 * providerId 가 카탈로그에 없으면 upsert 시 조용히 skip 되므로 정합을 테스트로 고정한다.
 */
import { ADMIN_SYNCED_PROVIDER_KEYS, getProviderCatalogEntry } from '../config/external-providers';
import { SETTING_DEFS_BY_KEY } from '../config/system-settings-registry';

describe('ADMIN_SYNCED_PROVIDER_KEYS 일관성', () => {
    const entries = Object.entries(ADMIN_SYNCED_PROVIDER_KEYS);

    it('매핑이 비어 있지 않다 (openrouter·ollama-cloud·nvidia)', () => {
        expect(entries.length).toBeGreaterThanOrEqual(3);
    });

    it.each(entries)('설정 키 %s 는 registry 에 secret 으로 등록돼 있다', (settingKey) => {
        const def = SETTING_DEFS_BY_KEY.get(settingKey);
        expect(def).toBeDefined();
        expect(def!.secret).toBe(true);
    });

    it.each(entries)('%s → providerId %s 는 카탈로그에 존재하고 api_key 등록을 지원한다', (_settingKey, providerId) => {
        const entry = getProviderCatalogEntry(providerId);
        expect(entry).toBeDefined();
        expect(entry!.authMethods).toContain('api_key');
        // upsert 시 baseUrl 폴백으로 쓰는 기본 endpoint 가 있어야 모델 목록 노출 게이트를 통과한다
        expect(entry!.defaultBaseUrl).toBeTruthy();
    });
});
