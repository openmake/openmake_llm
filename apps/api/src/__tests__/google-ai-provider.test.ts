/**
 * Google AI(Gemini API) 외부 provider — NVIDIA NIM 등과 같은 "OpenAI 호환 주소 + API 키" 방식으로 붙는다.
 * provider id 는 `gemini`(어댑터의 thinking 분기가 이미 이 id 를 본다). 등록·채팅·게이트웨이 편입에 필요한 곳이 모두 맞물렸는지 본다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { EXTERNAL_PROVIDER_CATALOG, getProviderCatalogEntry } from '../config/external-providers';
import { normalizeToFullId } from '../services/chat-service/provider-gate';
import { isChatCapableModel, isRoleAssignableModel } from '../config/role-model-filter';
import { OpenAICompatProvider } from '../providers/openai-compat-provider';

const ROOT = path.resolve(__dirname, '../../../..');
const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';

describe('카탈로그', () => {
    const entry = getProviderCatalogEntry('gemini');

    it('gemini 항목이 등록 가능한 상태로 있다', () => {
        expect(entry).toBeDefined();
        expect(entry).toMatchObject({
            id: 'gemini', sdkType: 'openai-compatible', enabled: true,
            defaultBaseUrl: GOOGLE_BASE, validatePath: '/models', authMethods: ['api_key'],
        });
        expect(entry!.keyUrl).toMatch(/^https:\/\/aistudio\.google\.com\//);
        expect(entry!.logo).toBe('/images/providers/gemini.svg');
    });

    it('로고 파일이 있다', () => {
        expect(fs.existsSync(path.join(ROOT, 'apps/web/public', entry!.logo))).toBe(true);
    });

    it('목록 조회가 실패해도 채팅을 시작할 폴백 모델이 있다', () => {
        expect(entry!.fallbackModels!.length).toBeGreaterThan(0);
        for (const m of entry!.fallbackModels!) expect(m.id).toMatch(/^gemini-/);
    });

    it('정렬 순서가 다른 provider 와 겹치지 않는다', () => {
        const orders = EXTERNAL_PROVIDER_CATALOG.map((p) => p.sortOrder);
        expect(new Set(orders).size).toBe(orders.length);
    });
});

describe('채팅 경로', () => {
    it('gemini: 접두사를 외부 모델로 인식한다(로컬 모델로 바꾸지 않는다)', () => {
        expect(normalizeToFullId('gemini:gemini-2.5-flash', 'qwen')).toBe('gemini:gemini-2.5-flash');
    });
});

describe('모델 목록', () => {
    it("Google 이 주는 'models/…' 접두사를 떼어 모델 id 로 쓴다", async () => {
        const provider = new OpenAICompatProvider({ providerId: 'gemini', apiKey: 'AIza-test', baseUrl: GOOGLE_BASE });
        const client = (provider as unknown as { catalogClient: { models: { list: jest.Mock } } }).catalogClient;
        client.models.list = jest.fn().mockResolvedValue({ data: [{ id: 'models/gemini-2.5-flash' }, { id: 'gemini-2.5-pro' }] });
        const models = await provider.listModels();
        expect(models.map((m) => m.id)).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
        expect(models[0].fullId).toBe('gemini:gemini-2.5-flash');
        expect(models[0].displayName).toBe('gemini-2.5-flash');
    });
});

describe('역할 배정 목록 필터', () => {
    it('채팅 모델은 남긴다', () => {
        expect(isChatCapableModel({ modelId: 'gemini:gemini-2.5-flash' })).toBe(true);
        expect(isRoleAssignableModel({ modelId: 'gemini:gemini-2.5-pro' })).toBe(true);
    });

    it.each(['gemini:gemini-embedding-001', 'gemini:imagen-4.0-generate-001', 'gemini:veo-3.0-generate-001', 'gemini:lyria-realtime-exp', 'gemini:gemini-2.5-flash-preview-tts', 'gemini:aqa'])(
        '채팅이 아닌 모델(%s)은 역할 드롭다운에서 뺀다', (modelId) => {
            expect(isChatCapableModel({ modelId })).toBe(false);
        });
});

describe('게이트웨이 편입', () => {
    it('LiteLLM 설정에 gemini/* 경로가 Google 주소로 있다', () => {
        const yaml = fs.readFileSync(path.join(ROOT, 'scripts/vllm/litellm.config.yaml'), 'utf8');
        const block = yaml.slice(yaml.indexOf('model_name: gemini/*'));
        expect(yaml).toContain('model_name: gemini/*');
        expect(block.slice(0, 300)).toContain(`api_base: ${GOOGLE_BASE}`);
    });

    it('운영 프로필의 LLM_GATEWAY_PROVIDERS 에 gemini 가 있다', () => {
        const env = fs.readFileSync(path.join(ROOT, 'scripts/setup/profiles/ops-features.env'), 'utf8');
        const line = env.split('\n').find((l) => l.startsWith('LLM_GATEWAY_PROVIDERS=')) ?? '';
        expect(line.split('=')[1].split(',')).toContain('gemini');
    });
});
