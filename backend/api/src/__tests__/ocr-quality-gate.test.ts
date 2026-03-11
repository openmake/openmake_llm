import {
    assessTextQuality,
    isTextQualityAcceptable,
    assessAndGate,
    type TextQualityMetrics,
} from '../domains/rag/OCRQualityGate';

describe('OCRQualityGate', () => {
    // ============================================================
    // assessTextQuality - 메트릭 계산
    // ============================================================

    describe('assessTextQuality', () => {
        test('empty string returns zero metrics', () => {
            const m = assessTextQuality('');
            expect(m.printableCharRatio).toBe(0);
            expect(m.unicodeReplacementRatio).toBe(0);
            expect(m.tokenDiversity).toBe(0);
            expect(m.avgWordLength).toBe(0);
            expect(m.totalChars).toBe(0);
        });

        test('normal English text returns high printable ratio', () => {
            const m = assessTextQuality('The quick brown fox jumps over the lazy dog.');
            expect(m.printableCharRatio).toBe(1.0);
            expect(m.unicodeReplacementRatio).toBe(0);
            expect(m.totalChars).toBe(44);
        });

        test('Korean text returns high printable ratio', () => {
            const m = assessTextQuality('안녕하세요. 오늘 날씨가 좋습니다.');
            expect(m.printableCharRatio).toBe(1.0);
            expect(m.unicodeReplacementRatio).toBe(0);
        });

        test('text with control characters has low printable ratio', () => {
            // ASCII control chars 0x01-0x08, 0x0B, 0x0E-0x1F are non-printable
            const controlChars = String.fromCharCode(0x01, 0x02, 0x03, 0x04, 0x05);
            const text = 'hello' + controlChars;
            const m = assessTextQuality(text);
            expect(m.printableCharRatio).toBe(5 / 10); // 5 printable / 10 total
        });

        test('text with U+FFFD has high replacement ratio', () => {
            const replacements = '\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD';
            const text = 'hello' + replacements;
            const m = assessTextQuality(text);
            expect(m.unicodeReplacementRatio).toBe(5 / 10);
            // U+FFFD is >= U+00A0, so it's "printable"
            expect(m.printableCharRatio).toBe(1.0);
        });

        test('repeated tokens produce low diversity', () => {
            const text = 'foo foo foo foo foo foo foo foo foo foo';
            const m = assessTextQuality(text);
            // 10 tokens, 1 unique → diversity = 0.1
            expect(m.tokenDiversity).toBe(0.1);
        });

        test('unique tokens produce high diversity', () => {
            const text = 'alpha beta gamma delta epsilon zeta eta theta';
            const m = assessTextQuality(text);
            // 8 unique tokens / 8 total = 1.0
            expect(m.tokenDiversity).toBe(1.0);
        });

        test('average word length is calculated correctly', () => {
            const text = 'ab cdef gh'; // lengths: 2, 4, 2 → avg = 8/3
            const m = assessTextQuality(text);
            expect(m.avgWordLength).toBeCloseTo(8 / 3, 5);
        });

        test('tabs and newlines count as printable', () => {
            const text = 'line1\tvalue1\nline2\tvalue2\r\n';
            const m = assessTextQuality(text);
            expect(m.printableCharRatio).toBe(1.0);
        });

        test('mixed quality text', () => {
            // 10 normal + 5 control chars
            const normal = 'abcdefghij';
            const control = String.fromCharCode(1, 2, 3, 4, 5);
            const m = assessTextQuality(normal + control);
            expect(m.totalChars).toBe(15);
            expect(m.printableCharRatio).toBeCloseTo(10 / 15, 5);
        });
    });

    // ============================================================
    // isTextQualityAcceptable - 합격 판정
    // ============================================================

    describe('isTextQualityAcceptable', () => {
        const goodMetrics: TextQualityMetrics = {
            printableCharRatio: 0.95,
            unicodeReplacementRatio: 0.01,
            tokenDiversity: 0.5,
            avgWordLength: 5,
            totalChars: 100,
        };

        test('good metrics pass', () => {
            expect(isTextQualityAcceptable(goodMetrics)).toBe(true);
        });

        test('low printable ratio fails', () => {
            expect(isTextQualityAcceptable({ ...goodMetrics, printableCharRatio: 0.7 })).toBe(false);
        });

        test('high replacement ratio fails', () => {
            expect(isTextQualityAcceptable({ ...goodMetrics, unicodeReplacementRatio: 0.1 })).toBe(false);
        });

        test('low token diversity fails', () => {
            expect(isTextQualityAcceptable({ ...goodMetrics, tokenDiversity: 0.1 })).toBe(false);
        });

        test('text too short fails', () => {
            expect(isTextQualityAcceptable({ ...goodMetrics, totalChars: 5 })).toBe(false);
        });

        test('custom thresholds override defaults', () => {
            const relaxed = { minPrintableCharRatio: 0.5, minTokenDiversity: 0.05 };
            const borderline: TextQualityMetrics = {
                printableCharRatio: 0.6,
                unicodeReplacementRatio: 0.01,
                tokenDiversity: 0.1,
                avgWordLength: 5,
                totalChars: 100,
            };
            expect(isTextQualityAcceptable(borderline)).toBe(false);
            expect(isTextQualityAcceptable(borderline, relaxed)).toBe(true);
        });

        test('boundary: exactly at threshold passes', () => {
            const boundary: TextQualityMetrics = {
                printableCharRatio: 0.85,
                unicodeReplacementRatio: 0.05,
                tokenDiversity: 0.3,
                avgWordLength: 5,
                totalChars: 10,
            };
            expect(isTextQualityAcceptable(boundary)).toBe(true);
        });

        test('boundary: just below threshold fails', () => {
            const belowBoundary: TextQualityMetrics = {
                printableCharRatio: 0.849,
                unicodeReplacementRatio: 0.05,
                tokenDiversity: 0.3,
                avgWordLength: 5,
                totalChars: 10,
            };
            expect(isTextQualityAcceptable(belowBoundary)).toBe(false);
        });
    });

    // ============================================================
    // assessAndGate - 종합 평가
    // ============================================================

    describe('assessAndGate', () => {
        test('good text passes with no reasons', () => {
            const result = assessAndGate('The quick brown fox jumps over the lazy dog on a fine sunny day');
            expect(result.acceptable).toBe(true);
            expect(result.reasons).toHaveLength(0);
            expect(result.metrics.printableCharRatio).toBe(1.0);
        });

        test('text with only control chars is rejected', () => {
            const badText = String.fromCharCode(1, 2, 3, 4, 5, 6, 7, 8, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25);
            const result = assessAndGate(badText);
            expect(result.acceptable).toBe(false);
            expect(result.reasons.length).toBeGreaterThan(0);
        });

        test('very short text is rejected', () => {
            const result = assessAndGate('hi');
            expect(result.acceptable).toBe(false);
            expect(result.reasons.some(r => r.includes('텍스트 길이 부족'))).toBe(true);
        });

        test('heavily repeated text is rejected for low diversity', () => {
            // 100+ repeated "aaa " tokens → diversity very low
            const repeated = Array(50).fill('aaa').join(' ');
            const result = assessAndGate(repeated);
            expect(result.acceptable).toBe(false);
            expect(result.reasons.some(r => r.includes('토큰 다양성 부족'))).toBe(true);
        });

        test('text with many U+FFFD is rejected', () => {
            // 10 normal chars + 40 replacement chars = 50 total
            const normal = 'abcdefghij';
            const replacements = '\uFFFD'.repeat(40);
            const text = normal + ' ' + replacements;
            const result = assessAndGate(text);
            expect(result.acceptable).toBe(false);
            expect(result.reasons.some(r => r.includes('U+FFFD'))).toBe(true);
        });

        test('Korean OCR text with good quality passes', () => {
            const koText = '대한민국은 민주공화국이다. 대한민국의 주권은 국민에게 있고, 모든 권력은 국민으로부터 나온다.';
            const result = assessAndGate(koText);
            expect(result.acceptable).toBe(true);
        });

        test('custom thresholds are applied', () => {
            const text = Array(50).fill('aaa').join(' '); // low diversity
            const strict = assessAndGate(text);
            expect(strict.acceptable).toBe(false);

            const relaxed = assessAndGate(text, { minTokenDiversity: 0.01 });
            expect(relaxed.acceptable).toBe(true);
        });

        test('empty string is rejected', () => {
            const result = assessAndGate('');
            expect(result.acceptable).toBe(false);
        });

        test('returns correct metrics in assessment', () => {
            const text = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
            const result = assessAndGate(text);
            expect(result.metrics.totalChars).toBe(text.length);
            expect(result.metrics.tokenDiversity).toBe(1.0);
            expect(result.metrics.printableCharRatio).toBe(1.0);
        });
    });
});
