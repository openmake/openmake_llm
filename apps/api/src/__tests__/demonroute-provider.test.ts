/**
 * Demon Route 외부 provider (#1420) — OpenAI 호환 주소 + API 키 방식. provider-gate 의 KNOWN_FULLID_PREFIXES 에
 * 'demonroute' 가 빠지면 `demonroute:<model>` 이 로컬 모델로 오분류돼 `local-llm:demonroute:...` 로 바뀐다.
 * 그 누락과, 카탈로그 항목이 실측 전 보수값으로 들어갔는지 본다.
 */
import { getProviderCatalogEntry } from '../config/external-providers';
import { normalizeToFullId } from '../services/chat-service/provider-gate';
import { parseFullModelId } from '../providers/i-provider';

const FULL_ID = 'demonroute:huihui-ai/Huihui-gemma-4-31B-it-abliterated-v2';

describe('Demon Route', () => {
    it('KNOWN_FULLID_PREFIXES 누락 시 local-llm 으로 오분류 — demonroute: 접두사를 외부 provider 로 둔다', () => {
        expect(normalizeToFullId(FULL_ID, 'qwen')).toBe(FULL_ID);
        expect(parseFullModelId(FULL_ID)).toEqual({
            providerId: 'demonroute',
            modelId: 'huihui-ai/Huihui-gemma-4-31B-it-abliterated-v2',
        });
    });

    it('카탈로그 항목이 키 검증 가능한 OpenAI 호환 provider 로 있고, 실측 전 폴백 모델은 streaming 외 capability·무료 표시가 꺼져 있다', () => {
        const entry = getProviderCatalogEntry('demonroute');
        expect(entry).toMatchObject({
            sdkType: 'openai-compatible', enabled: true,
            defaultBaseUrl: 'https://api.demonroute.com/v1', validatePath: '/models', authMethods: ['api_key'],
        });
        expect(entry!.fallbackModels!.length).toBeGreaterThan(0);
        for (const m of entry!.fallbackModels!) {
            expect(m.id).toMatch(/^[^/:]+\/[^/:]+$/);
            expect(m.isFree).toBe(false);
            expect(m.capabilities).toEqual({ streaming: true, toolCalling: false, vision: false, thinking: false });
        }
    });
});
