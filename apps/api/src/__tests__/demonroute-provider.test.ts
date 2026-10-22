/**
 * Demon Route 외부 provider (#1420) — OpenAI 호환 주소 + API 키 방식. 모델 ID 가 허깅페이스식 `org/model`
 * 이라 fullId 가 `demonroute:huihui-ai/...` 처럼 `/` 를 품는다(orcarouter 와 같은 모양). 접두사가 외부로
 * 인식되고 첫 콜론에서만 갈리는지, 카탈로그 항목이 실측 전 보수값으로 들어갔는지 본다.
 */
import { getProviderCatalogEntry } from '../config/external-providers';
import { normalizeToFullId } from '../services/chat-service/provider-gate';
import { parseFullModelId } from '../providers/i-provider';

const FULL_ID = 'demonroute:huihui-ai/Huihui-gemma-4-31B-it-abliterated-v2';

describe('Demon Route', () => {
    it('demonroute: 접두사 + org/model ID 를 외부 모델로 두고, 첫 콜론에서만 provider·model 로 가른다', () => {
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
