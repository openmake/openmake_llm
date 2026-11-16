/**
 * 호스트 패턴 판정(browserHostMatches)의 차등 테스트 — 선형 판정이 옛 정규식 판정과 같은 답을 내는지 본다(설계 2026-11-16 D3).
 * 옛 구현은 이 테스트 안에만 둔다. 입력은 고정 시드 무작위, 옛 구현이 폭주하지 않는 크기(길이 0~8)다.
 */
import { browserHostMatches } from '@openmake/config';

/** 옛 구현 — `*` 는 `.*`, 나머지 메타 문자는 이스케이프한 `^…$` 정규식 */
function oldHostMatches(host: string, pattern: string): boolean {
    const p = pattern.trim().toLowerCase();
    if (!p) return false;
    const re = new RegExp(`^${p.split('*').map((s) => s.replace(/[.+^${}()|[\]\\?]/g, '\\$&')).join('.*')}$`);
    return re.test(host.toLowerCase());
}

/** 글자 집합 — 메타 문자·줄 끝 글자·JS 공백·대소문자 접기가 갈리는 글자·보충 문자와 짝 없는 반쪽 */
const ALPHABET = [
    'a', 'b', 'A', '.', '*', '*', '\n', ' ', '　', '\\', '[', ']', '?', '-', '/', '}', '(', ')', '|', '^', '$', '+',
    '\r', ' ', ' ', '﻿', 'İ', 'ſ', 'K', 'Σ', '😀', '\ud83d', '\ude00',
];

/** mulberry32 — 고정 시드 */
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('browserHostMatches 차등(옛 정규식 판정과 같다)', () => {
    it('고정 시드 무작위 입력 6000쌍에서 결과가 전부 같다', () => {
        const next = rng(20261116);
        const pick = () => ALPHABET[Math.floor(next() * ALPHABET.length)];
        const word = (max: number) => Array.from({ length: Math.floor(next() * (max + 1)) }, pick).join('');
        const diffs: Array<{ host: string; pattern: string }> = [];
        let matched = 0;
        for (let i = 0; i < 6000; i++) {
            const pattern = word(8);
            // 절반은 패턴에서 만든 호스트(별표를 0~3 글자로 바꾼다) — 맞는 쌍이 충분히 나오게
            const host = next() < 0.5 ? pattern.split('*').join(word(3)) : word(8);
            const want = oldHostMatches(host, pattern);
            if (want) matched++;
            if (browserHostMatches(host, pattern) !== want) diffs.push({ host, pattern });
        }
        expect(diffs).toEqual([]);
        expect(matched).toBeGreaterThan(500);
    });

    it('별표가 많은 패턴도 바로 끝난다(옛 판정이면 끝나지 않는 꼴)', () => {
        const started = Date.now();
        expect(browserHostMatches('a'.repeat(2000), '*a'.repeat(40) + '*b')).toBe(false);
        expect(browserHostMatches('a'.repeat(2000) + 'b', '*a'.repeat(40) + '*b')).toBe(true);
        expect(Date.now() - started).toBeLessThan(2000);
    });
});
