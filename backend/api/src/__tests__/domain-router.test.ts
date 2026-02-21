/**
 * Domain Router 테스트 (P2-2)
 */
import {
    QUERY_TYPE_TO_DOMAIN,
    applyDomainEngineOverride,
    resolveDomainEngine,
    type DomainKey,
} from '../chat/domain-router';
import type { QueryType } from '../chat/model-selector-types';

// getConfig 모킹
jest.mock('../config/env', () => ({
    getConfig: jest.fn(() => ({
        omkDomainCode: 'test-code-model:cloud',
        omkDomainMath: 'test-math-model:cloud',
        omkDomainCreative: '',
        omkDomainAnalysis: 'test-analysis-model:cloud',
        omkDomainGeneral: '',
    })),
}));

describe('DomainRouter', () => {
    describe('QUERY_TYPE_TO_DOMAIN', () => {
        it('code → code, math → math, creative → creative, analysis → analysis', () => {
            expect(QUERY_TYPE_TO_DOMAIN['code']).toBe('code');
            expect(QUERY_TYPE_TO_DOMAIN['math']).toBe('math');
            expect(QUERY_TYPE_TO_DOMAIN['creative']).toBe('creative');
            expect(QUERY_TYPE_TO_DOMAIN['analysis']).toBe('analysis');
        });

        it('chat → general, translation → general, korean → general', () => {
            expect(QUERY_TYPE_TO_DOMAIN['chat']).toBe('general');
            expect(QUERY_TYPE_TO_DOMAIN['translation']).toBe('general');
            expect(QUERY_TYPE_TO_DOMAIN['korean']).toBe('general');
        });

        it('document → analysis (분석 도메인으로 매핑)', () => {
            expect(QUERY_TYPE_TO_DOMAIN['document']).toBe('analysis');
        });

        it('모든 9개 QueryType이 매핑되어 있음', () => {
            const allQueryTypes: QueryType[] = ['code', 'analysis', 'creative', 'vision', 'korean', 'math', 'chat', 'document', 'translation'];
            for (const qt of allQueryTypes) {
                expect(QUERY_TYPE_TO_DOMAIN[qt]).toBeDefined();
            }
        });
    });

    describe('resolveDomainEngine', () => {
        it('OMK_DOMAIN_CODE 설정 시 code → 해당 엔진 반환', () => {
            const engine = resolveDomainEngine('code');
            expect(engine).toBe('test-code-model:cloud');
        });

        it('미설정(빈 문자열) 시 → null 반환', () => {
            const engine = resolveDomainEngine('creative');
            expect(engine).toBeNull();
        });

        it('math → OMK_DOMAIN_MATH 반환', () => {
            const engine = resolveDomainEngine('math');
            expect(engine).toBe('test-math-model:cloud');
        });

        it('general 도메인 미설정 시 null', () => {
            const engine = resolveDomainEngine('chat');
            expect(engine).toBeNull();
        });
    });

    describe('applyDomainEngineOverride', () => {
        it('도메인 엔진 있을 때 → overridden=true, engine=새 값', () => {
            const result = applyDomainEngineOverride('original-model:cloud', 'code');
            expect(result.overridden).toBe(true);
            expect(result.engine).toBe('test-code-model:cloud');
            expect(result.domain).toBe('code');
        });

        it('도메인 엔진 없을 때 → overridden=false, engine=원본', () => {
            const result = applyDomainEngineOverride('original-model:cloud', 'creative');
            expect(result.overridden).toBe(false);
            expect(result.engine).toBe('original-model:cloud');
            expect(result.domain).toBe('creative');
        });

        it('chat 쿼리 → general 도메인', () => {
            const result = applyDomainEngineOverride('original-model:cloud', 'chat');
            expect(result.domain).toBe('general');
        });

        it('document → analysis 도메인으로 오버라이드', () => {
            const result = applyDomainEngineOverride('original-model:cloud', 'document');
            expect(result.overridden).toBe(true);
            expect(result.engine).toBe('test-analysis-model:cloud');
            expect(result.domain).toBe('analysis');
        });

        it('같은 엔진이면 overridden=false', () => {
            const result = applyDomainEngineOverride('test-code-model:cloud', 'code');
            expect(result.overridden).toBe(false);
            expect(result.engine).toBe('test-code-model:cloud');
        });

        it('domain 필드 항상 포함', () => {
            const allQueryTypes: QueryType[] = ['code', 'analysis', 'creative', 'vision', 'korean', 'math', 'chat', 'document', 'translation'];
            for (const qt of allQueryTypes) {
                const result = applyDomainEngineOverride('some-model', qt);
                expect(result.domain).toBeDefined();
                expect(typeof result.domain).toBe('string');
            }
        });
    });
});
