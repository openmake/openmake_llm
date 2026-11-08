import * as barrel from '../runtime-limits';
import * as context from '../runtime-limits-context';
import * as attach from '../runtime-limits-attach';
import * as search from '../runtime-limits-search';

const CONTEXT_SYMBOLS = [
    'SCRAPE_ABORT_BUFFER_MS', 'HISTORY_SUMMARIZER', 'TRUNCATION', 'CAPACITY', 'MODEL_CONTEXT_DEFAULTS',
    'EXTERNAL_PROVIDER_THROTTLE', 'ROUTER_CONFIDENCE_FALLBACK', 'JUDGE_EVIDENCE_EXCLUDED_TOOLS', 'LANGUAGE_THRESHOLDS',
    'CACHE_CONFIG', 'RETRY_DEFAULTS', 'IDF_NORMALIZATION', 'PHASE_KEYWORDS', 'QUERY_ROW_LIMITS', 'PASSWORD_POLICY',
];
const ATTACH_SYMBOLS = [
    'FILE_ATTACH_LIMITS', 'DOC_EXTRACT_LIMITS', 'LLM_PROMPT_IMAGE_LIMITS', 'PDF_VISION_LIMITS',
    'URL_ANALYZE_LIMITS', 'ATTACH_CACHE_LIMITS',
];
const SEARCH_SYMBOLS = [
    'parseInjectLimit', 'WEB_SEARCH_INJECTION', 'MODEL_SOURCE_SECTION', 'SEARCH_ESCALATION', 'SEARXNG_CATEGORY_SCOPE',
];

describe('runtime-limits 배럴 — context 분할', () => {
    test('배럴은 분할 전 runtime-limits-context 의 26개 심볼을 모두 그대로 내보낸다', () => {
        const all = [...CONTEXT_SYMBOLS, ...ATTACH_SYMBOLS, ...SEARCH_SYMBOLS];
        expect(all).toHaveLength(26);
        for (const name of all) {
            expect(barrel).toHaveProperty(name);
        }
        expect((barrel as Record<string, unknown>).PDF_VISION_LIMITS).toBe(attach.PDF_VISION_LIMITS);
        expect((barrel as Record<string, unknown>).WEB_SEARCH_INJECTION).toBe(search.WEB_SEARCH_INJECTION);
        expect((barrel as Record<string, unknown>).CACHE_CONFIG).toBe(context.CACHE_CONFIG);
    });

    test('각 파일은 자기 묶음 심볼만 내보내고 서로 겹치지 않는다', () => {
        expect(Object.keys(context).sort()).toEqual([...CONTEXT_SYMBOLS].sort());
        expect(Object.keys(attach).sort()).toEqual([...ATTACH_SYMBOLS].sort());
        expect(Object.keys(search).sort()).toEqual([...SEARCH_SYMBOLS].sort());
    });

    test('PDF_VISION_LIMITS.TOTAL_IMAGE_CAP 기본값은 LLM_PROMPT_IMAGE_LIMITS.MAX_PER_REQUEST 를 따른다', () => {
        const saved = process.env.PDF_VISION_TOTAL_IMAGE_CAP;
        delete process.env.PDF_VISION_TOTAL_IMAGE_CAP;
        try {
            jest.isolateModules(() => {
                const fresh = require('../runtime-limits-attach') as typeof attach;
                expect(fresh.PDF_VISION_LIMITS.TOTAL_IMAGE_CAP).toBe(fresh.LLM_PROMPT_IMAGE_LIMITS.MAX_PER_REQUEST);
            });
        } finally {
            if (saved !== undefined) process.env.PDF_VISION_TOTAL_IMAGE_CAP = saved;
        }
    });
});
