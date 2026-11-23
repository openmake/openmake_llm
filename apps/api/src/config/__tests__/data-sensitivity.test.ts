/**
 * 데이터 민감도 분류(하네스 P0-2) — 결정적 패턴으로 등급을 매기고, 걸린 패턴 이름만 남긴다(값은 남기지 않는다).
 */
import { classifySensitivity, sensitivityAtLeast } from '../data-sensitivity';

describe('classifySensitivity', () => {
    it('평범한 질문은 normal', () => {
        expect(classifySensitivity(['오늘 날씨 알려줘', undefined, null])).toEqual({ level: 'normal', matched: [] });
        expect(classifySensitivity([])).toEqual({ level: 'normal', matched: [] });
    });

    it('대외비·confidential 표시는 confidential', () => {
        expect(classifySensitivity(['[대외비] 3분기 실적 요약해줘']).level).toBe('confidential');
        expect(classifySensitivity(['This document is CONFIDENTIAL. Summarize it.']).matched).toEqual(['marking_en']);
        expect(classifySensitivity(['사내 한정 자료입니다']).level).toBe('confidential');
    });

    it('자격증명·주민번호·카드번호는 restricted — confidential 보다 우선', () => {
        expect(classifySensitivity(['대외비\nkey: sk-abcdefghijklmnop1234']).level).toBe('restricted');
        expect(classifySensitivity(['-----BEGIN RSA PRIVATE KEY-----\nMIIE']).matched).toEqual(['private_key']);
        expect(classifySensitivity(['주민번호 900101-1234567']).matched).toEqual(['resident_id']);
        expect(classifySensitivity(['카드 1234 5678 9012 3456']).matched).toEqual(['card_number']);
    });

    it('전화번호·날짜 같은 숫자 꼴은 걸리지 않는다', () => {
        expect(classifySensitivity(['010-1234-5678 로 연락', '2026-11-24 회의']).level).toBe('normal');
    });

    it('여러 텍스트(본문·첨부)를 함께 본다', () => {
        expect(classifySensitivity(['요약해줘', '첨부: internal use only']).level).toBe('confidential');
    });
});

describe('sensitivityAtLeast', () => {
    it('등급 순서 normal < confidential < restricted', () => {
        expect(sensitivityAtLeast('restricted', 'confidential')).toBe(true);
        expect(sensitivityAtLeast('confidential', 'confidential')).toBe(true);
        expect(sensitivityAtLeast('normal', 'confidential')).toBe(false);
    });
});
