/**
 * Model Selector — Cost Tier 통합 테스트 (P2-1)
 * 
 * selectBrandProfileForAutoRouting()가 비용 티어 상한을 적용하여
 * 프로파일을 다운그레이드하는지 검증합니다.
 * 
 * Bun에서 jest.mock이 파일 간 누출될 수 있으므로
 * model-selector.test.ts와 분리합니다.
 */
import { selectBrandProfileForAutoRouting } from '../chat/model-selector';

// getConfig를 economy 티어로 모킹
jest.mock('../config/env', () => ({
    getConfig: jest.fn(() => ({
        // Cost tier: economy
        omkCostTierDefault: 'economy',
        // Engine 매핑 (selectBrandProfileForAutoRouting 내부 사용)
        omkEngineFast: 'gemini-3-flash-preview:cloud',
        omkEngineLlm: 'gpt-oss:120b-cloud',
        omkEnginePro: 'kimi-k2.5:cloud',
        omkEngineCode: 'glm-5:cloud',
        omkEngineVision: 'qwen3.5:397b-cloud',
        // Domain 엔진 (비활성 — 이 테스트에서는 domain override 미사용)
        omkDomainCode: '',
        omkDomainMath: '',
        omkDomainCreative: '',
        omkDomainAnalysis: '',
        omkDomainGeneral: '',
        // model-selector 내 기타 참조 필드
        ollamaDefaultModel: '',
    })),
}));

// logger mock (불필요한 출력 억제)
jest.mock('../utils/logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

describe('selectBrandProfileForAutoRouting - Cost Tier', () => {
    test('economy 티어: code 질문 → _fast로 다운그레이드', async () => {
        const profile = await selectBrandProfileForAutoRouting('Python 함수 작성해줘');
        // premium에서는 openmake_llm_code이지만 economy ceiling이 적용되어 _fast
        expect(profile).toBe('openmake_llm_fast');
    });

    test('economy 티어: vision(이미지) → _vision 유지 (예외)', async () => {
        const profile = await selectBrandProfileForAutoRouting('이미지 분석해줘', true);
        // vision은 모든 티어에서 _vision 유지 (이미지 처리 가능한 유일한 모델)
        expect(profile).toBe('openmake_llm_vision');
    });
});
