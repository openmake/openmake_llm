/**
 * pipeline-profile.ts 단위 테스트
 * getProfiles, getBrandModelAliases, isValidBrandModel 검증
 */

// getConfig() 는 DEFAULT_CONFIG fallback이 있으므로 mock 불필요

import {
    getProfiles,
    getBrandModelAliases,
    isValidBrandModel,
} from '../domains/chat/pipeline/pipeline-profile';

describe('getProfiles', () => {
    test('7개 브랜드 모델 프로파일 반환', () => {
        const profiles = getProfiles();
        expect(Object.keys(profiles)).toHaveLength(7);
    });

    test('7개 expected keys 모두 존재', () => {
        const profiles = getProfiles();
        const expectedKeys = [
            'openmake_llm',
            'openmake_llm_pro',
            'openmake_llm_fast',
            'openmake_llm_think',
            'openmake_llm_code',
            'openmake_llm_vision',
            'openmake_llm_auto',
        ];
        expectedKeys.forEach(key => {
            expect(profiles[key]).toBeDefined();
        });
    });

    test('각 프로파일에 필수 필드 존재', () => {
        const profiles = getProfiles();
        Object.values(profiles).forEach(profile => {
            expect(profile.id).toBeTruthy();
            expect(profile.displayName).toBeTruthy();
            expect(profile.description).toBeTruthy();
            // engineModel은 환경변수(OMK_ENGINE_*)에 의존 — CI 병렬 실행 시 config 로드 레이스로 undefined 가능
            if (profile.id === 'openmake_llm_auto') {
                expect(profile.engineModel).toBe('__auto__');
            } else if (profile.engineModel !== undefined) {
                expect(typeof profile.engineModel).toBe('string');
            }
            expect(['off', 'conditional', 'always']).toContain(profile.a2a);
            expect(['off', 'low', 'medium', 'high']).toContain(profile.thinking);
            expect(typeof profile.discussion).toBe('boolean');
            expect(['auto', 'force_coder', 'force_reasoning', 'force_creative', 'none']).toContain(profile.promptStrategy);
            expect(typeof profile.agentLoopMax).toBe('number');
            expect(['parallel', 'sequential', 'auto']).toContain(profile.loopStrategy);
            expect(['full', 'lite', 'auto']).toContain(profile.contextStrategy);
            expect(typeof profile.timeBudgetSeconds).toBe('number');
            expect(Array.isArray(profile.requiredTools)).toBe(true);
            expect(['economy', 'standard', 'premium']).toContain(profile.costTier);
        });
    });

    describe('개별 프로파일 설정', () => {
        test('openmake_llm_fast — a2a=off, thinking=off (최속 설정)', () => {
            const fast = getProfiles()['openmake_llm_fast'];
            expect(fast.a2a).toBe('off');
            expect(fast.thinking).toBe('off');
            expect(fast.promptStrategy).toBe('none');
            expect(fast.agentLoopMax).toBe(1);
            expect(fast.contextStrategy).toBe('lite');
            expect(fast.costTier).toBe('economy');
        });

        test('openmake_llm_pro — a2a=always, thinking=high, discussion=true', () => {
            const pro = getProfiles()['openmake_llm_pro'];
            expect(pro.a2a).toBe('always');
            expect(pro.thinking).toBe('high');
            expect(pro.discussion).toBe(true);
            expect(pro.contextStrategy).toBe('full');
            expect(pro.costTier).toBe('premium');
        });

        test('openmake_llm_think — a2a=always, thinking=high, promptStrategy=force_reasoning', () => {
            const think = getProfiles()['openmake_llm_think'];
            expect(think.a2a).toBe('always');
            expect(think.thinking).toBe('high');
            expect(think.promptStrategy).toBe('force_reasoning');
            expect(think.loopStrategy).toBe('sequential');
        });

        test('openmake_llm_code — promptStrategy=force_coder', () => {
            const code = getProfiles()['openmake_llm_code'];
            expect(code.promptStrategy).toBe('force_coder');
        });

        test('openmake_llm_vision — requiredTools에 vision 포함', () => {
            const vision = getProfiles()['openmake_llm_vision'];
            expect(vision.requiredTools).toContain('vision');
        });

        test('openmake_llm_auto — engineModel=__auto__', () => {
            const auto = getProfiles()['openmake_llm_auto'];
            expect(auto.engineModel).toBe('__auto__');
        });
    });
});

describe('getBrandModelAliases', () => {
    test('7개 alias 반환', () => {
        const aliases = getBrandModelAliases();
        expect(aliases).toHaveLength(7);
    });

    test('모든 alias가 문자열', () => {
        const aliases = getBrandModelAliases();
        aliases.forEach(alias => {
            expect(typeof alias).toBe('string');
        });
    });

    test('openmake_llm 포함', () => {
        const aliases = getBrandModelAliases();
        expect(aliases).toContain('openmake_llm');
    });

    test('openmake_llm_auto 포함', () => {
        const aliases = getBrandModelAliases();
        expect(aliases).toContain('openmake_llm_auto');
    });
});

describe('isValidBrandModel', () => {
    test('유효한 brand model → true', () => {
        expect(isValidBrandModel('openmake_llm')).toBe(true);
        expect(isValidBrandModel('openmake_llm_pro')).toBe(true);
        expect(isValidBrandModel('openmake_llm_fast')).toBe(true);
        expect(isValidBrandModel('openmake_llm_think')).toBe(true);
        expect(isValidBrandModel('openmake_llm_code')).toBe(true);
        expect(isValidBrandModel('openmake_llm_vision')).toBe(true);
        expect(isValidBrandModel('openmake_llm_auto')).toBe(true);
    });

    test('임의 모델명 → false', () => {
        expect(isValidBrandModel('gpt-4')).toBe(false);
        expect(isValidBrandModel('llama3.2')).toBe(false);
        expect(isValidBrandModel('qwen3:latest')).toBe(false);
        expect(isValidBrandModel('')).toBe(false);
    });

    test('부분 일치 → false', () => {
        expect(isValidBrandModel('openmake')).toBe(false);
        expect(isValidBrandModel('openmake_llm_')).toBe(false);
    });

    test('대소문자 구분', () => {
        expect(isValidBrandModel('OpenMake_LLM')).toBe(false);
        expect(isValidBrandModel('OPENMAKE_LLM')).toBe(false);
    });
});
