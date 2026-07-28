/**
 * context-xml-helpers.ts 단위 테스트
 * xmlTag, systemRulesSection, contextSection, examplesSection, thinkingSection 검증
 */

import {
    xmlTag,
    systemRulesSection,
    contextSection,
    examplesSection,
    thinkingSection,
} from '../chat/context-xml-helpers';

// ===== xmlTag =====

describe('xmlTag', () => {
    test('기본 태그 래핑', () => {
        const result = xmlTag('user', 'hello world');
        expect(result).toBe('<user>\nhello world\n</user>');
    });

    test('기본값은 escapeContent=true — XML 특수문자 이스케이프', () => {
        const result = xmlTag('context', '<script>alert("xss")</script>');
        expect(result).toContain('&lt;script&gt;');
        expect(result).not.toContain('<script>');
    });

    test('escapeContent=false — 이스케이프 없음', () => {
        const result = xmlTag('system', '<b>bold</b>', undefined, false);
        expect(result).toContain('<b>bold</b>');
    });

    test('attributes 포함', () => {
        const result = xmlTag('tag', 'content', { type: 'system', id: '1' });
        expect(result).toContain('type="system"');
        expect(result).toContain('id="1"');
        expect(result).toMatch(/^<tag /);
    });

    test('attributes 없으면 속성 없는 태그', () => {
        const result = xmlTag('simple', 'text');
        expect(result).toMatch(/^<simple>/);
    });

    test('& 이스케이프', () => {
        const result = xmlTag('q', 'a&b');
        expect(result).toContain('&amp;');
    });

    test('따옴표 이스케이프', () => {
        const result = xmlTag('q', '"double" \'single\'');
        expect(result).toContain('&quot;');
        expect(result).toContain('&apos;');
    });

    test('빈 content 처리', () => {
        const result = xmlTag('empty', '');
        expect(result).toBe('<empty>\n\n</empty>');
    });

    test('닫는 태그 형식', () => {
        const result = xmlTag('test', 'content');
        expect(result).toMatch(/<\/test>$/);
    });
});

// ===== systemRulesSection =====

describe('systemRulesSection', () => {
    test('번호가 매겨진 규칙 목록 생성', () => {
        const rules = ['규칙 A', '규칙 B', '규칙 C'];
        const result = systemRulesSection(rules);
        expect(result).toContain('1. 규칙 A');
        expect(result).toContain('2. 규칙 B');
        expect(result).toContain('3. 규칙 C');
    });

    test('<system_rules> 태그로 래핑', () => {
        const result = systemRulesSection(['규칙 1']);
        expect(result).toMatch(/^<system_rules>/);
        expect(result).toMatch(/<\/system_rules>$/);
    });

    test('내부 콘텐츠 이스케이프 없음 (escapeContent=false)', () => {
        // 신뢰할 수 있는 내부 콘텐츠이므로 이스케이프하지 않음
        const rules = ['<strong>중요</strong> 규칙'];
        const result = systemRulesSection(rules);
        expect(result).toContain('<strong>중요</strong>');
    });

    test('빈 배열 처리', () => {
        const result = systemRulesSection([]);
        expect(result).toContain('<system_rules>');
        expect(result).toContain('</system_rules>');
    });

    test('단일 규칙', () => {
        const result = systemRulesSection(['단 하나의 규칙']);
        expect(result).toContain('1. 단 하나의 규칙');
        expect(result).not.toContain('2.');
    });
});

// ===== contextSection =====

describe('contextSection', () => {
    test('<context> 태그로 래핑', () => {
        const result = contextSection('some context data');
        expect(result).toMatch(/^<context>/);
        expect(result).toMatch(/<\/context>$/);
    });

    test('사용자 입력 이스케이프 적용', () => {
        const result = contextSection('<injected>malicious</injected>');
        expect(result).toContain('&lt;injected&gt;');
        expect(result).not.toContain('<injected>');
    });

    test('일반 텍스트 그대로 포함', () => {
        const result = contextSection('정상 컨텍스트 데이터');
        expect(result).toContain('정상 컨텍스트 데이터');
    });

    test('& 문자 이스케이프', () => {
        const result = contextSection('key=value&other=data');
        expect(result).toContain('&amp;');
    });
});

// ===== examplesSection =====

describe('examplesSection', () => {
    test('<examples> 태그로 래핑', () => {
        const examples = [{ input: '질문', output: '답변' }];
        const result = examplesSection(examples);
        expect(result).toMatch(/^<examples>/);
        expect(result).toMatch(/<\/examples>$/);
    });

    test('예시 번호 포함', () => {
        const examples = [
            { input: '입력 1', output: '출력 1' },
            { input: '입력 2', output: '출력 2' },
        ];
        const result = examplesSection(examples);
        expect(result).toContain('### 예시 1');
        expect(result).toContain('### 예시 2');
    });

    test('입력/출력 모두 포함', () => {
        const examples = [{ input: '사용자 질문', output: 'AI 답변' }];
        const result = examplesSection(examples);
        expect(result).toContain('입력: 사용자 질문');
        expect(result).toContain('출력: AI 답변');
    });

    test('내부 콘텐츠 이스케이프 없음 (few-shot 예시는 신뢰됨)', () => {
        const examples = [{ input: '<b>bold</b>', output: '<em>em</em>' }];
        const result = examplesSection(examples);
        expect(result).toContain('<b>bold</b>');
    });

    test('빈 배열 처리', () => {
        const result = examplesSection([]);
        expect(result).toContain('<examples>');
        expect(result).toContain('</examples>');
    });

    test('여러 예시 사이 구분선(\n\n)', () => {
        const examples = [
            { input: 'q1', output: 'a1' },
            { input: 'q2', output: 'a2' },
        ];
        const result = examplesSection(examples);
        expect(result).toContain('\n\n');
    });
});

// ===== thinkingSection =====

describe('thinkingSection', () => {
    test('<thinking> 태그로 시작', () => {
        const result = thinkingSection();
        expect(result).toContain('<thinking>');
        expect(result).toContain('</thinking>');
    });

    test('4가지 분석 단계 포함', () => {
        const result = thinkingSection();
        expect(result).toContain('1.');
        expect(result).toContain('2.');
        expect(result).toContain('3.');
        expect(result).toContain('4.');
    });

    test('문제 분석 항목 포함', () => {
        const result = thinkingSection();
        expect(result).toContain('문제 분석');
    });

    test('항상 동일한 결과 반환 (순수함수 형태)', () => {
        expect(thinkingSection()).toBe(thinkingSection());
    });
});
