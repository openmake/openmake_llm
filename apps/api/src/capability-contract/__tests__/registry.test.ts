/**
 * Capability Registry (P02) — 원자적 등록·중복·소유권·revision.
 */
import { CapabilityRegistry, checkCapabilityOwnership, validateCapabilityDefinition } from '../registry';
import { CapabilityRegistryError } from '../errors';
import type { CapabilityDefinition, CapabilityHandler, CapabilityOwner } from '../types';

const def = (id: string, over: Partial<CapabilityDefinition> = {}): CapabilityDefinition => ({
    id, contractVersion: 1, assignable: true, plannable: true,
    display: { label: id, group: id.split('.')[0], order: 0 }, plannerHint: 'hint',
    inputSchema: { type: 'object', properties: {} }, settingsSchema: { type: 'object', properties: {} },
    execution: { mode: 'sync', timeoutMs: 1000, supportsCancellation: true }, output: { mimeTypes: ['text/plain'] },
    ...over,
});
const handler: CapabilityHandler = { execute: async () => ({ ok: true, text: '', media: [] }) };
const ownerA: CapabilityOwner = { addonId: 'a', addonVersion: '1.0.0', source: 'builtin' };
const ownerB: CapabilityOwner = { addonId: 'b', addonVersion: '1.0.0', source: 'builtin' };

describe('CapabilityRegistry', () => {
    it('commit 전에는 게시되지 않고, commit 이 revision 을 올린다', () => {
        const r = new CapabilityRegistry();
        const tx = r.beginRegistration(ownerA);
        tx.register(def('image.generate'), handler);
        expect(r.has('image.generate')).toBe(false);
        expect(r.revision).toBe(0);
        tx.commit(['image.generate']);
        expect(r.get('image.generate')?.owner).toEqual(ownerA);
        expect(r.revision).toBe(1);
    });

    it('rollback 은 임시 등록만 버리고 다른 소유자의 게시에 영향이 없다', () => {
        const r = new CapabilityRegistry();
        const a = r.beginRegistration(ownerA); a.register(def('text.reason'), handler); a.commit();
        const b = r.beginRegistration(ownerB); b.register(def('music.generate'), handler); b.rollback();
        expect(r.has('music.generate')).toBe(false);
        expect(r.has('text.reason')).toBe(true);
        expect(() => b.register(def('x.y'), handler)).toThrow(CapabilityRegistryError);
    });

    it('T06: 같은 ID 를 다른 소유자가 등록하면 조용히 덮어쓰지 않고 실패한다', () => {
        const r = new CapabilityRegistry();
        const a = r.beginRegistration(ownerA); a.register(def('image.generate'), handler); a.commit();
        const b = r.beginRegistration(ownerB);
        expect(() => b.register(def('image.generate'), handler)).toThrow(/이미 'a' 가 소유/);
        expect(r.get('image.generate')?.owner.addonId).toBe('a');
    });

    it('같은 트랜잭션 안의 중복 ID·잘못된 ID·handler 없음은 거절', () => {
        const r = new CapabilityRegistry();
        const tx = r.beginRegistration(ownerA);
        tx.register(def('image.generate'), handler);
        expect(() => tx.register(def('image.generate'), handler)).toThrow(/중복/);
        expect(() => tx.register(def('Image.Generate'), handler)).toThrow(/문법/);
        expect(() => tx.register(def('image.edit'), {} as CapabilityHandler)).toThrow(/handler/);
    });

    it('manifest 선언(expected)과 등록 결과가 다르면 게시하지 않는다', () => {
        const r = new CapabilityRegistry();
        const tx = r.beginRegistration(ownerA);
        tx.register(def('image.generate'), handler);
        expect(() => tx.commit(['image.generate', 'image.edit'])).toThrow(/불일치|다릅니다/);
        expect(r.has('image.generate')).toBe(false);
    });

    it('unregisterOwner 는 그 소유자 것만 회수하고 revision 을 올린다', () => {
        const r = new CapabilityRegistry();
        const a = r.beginRegistration(ownerA); a.register(def('image.generate'), handler); a.register(def('image.edit'), handler); a.commit();
        const b = r.beginRegistration(ownerB); b.register(def('music.generate'), handler); b.commit();
        expect(r.unregisterOwner('a').sort()).toEqual(['image.edit', 'image.generate']);
        expect(r.has('music.generate')).toBe(true);
        expect(r.revision).toBe(3);
        expect(r.snapshot().entries.map(e => e.definition.id)).toEqual(['music.generate']);
    });

    it('스키마 상한 — $ref·과도한 깊이는 거절', () => {
        expect(() => validateCapabilityDefinition(def('a.b', { inputSchema: { $ref: '#/x' } }))).toThrow(/\$ref/);
        const deep: Record<string, unknown> = {}; let cur = deep;
        for (let i = 0; i < 8; i++) { const n: Record<string, unknown> = {}; cur.properties = n; cur = n; }
        expect(() => validateCapabilityDefinition(def('a.b', { inputSchema: deep }))).toThrow(/깊이/);
    });
});

describe('checkCapabilityOwnership (T29)', () => {
    it('같은 ID 두 add-on 은 양쪽 거절, Base 예약 ID 는 그 add-on 만, 나머지는 통과', () => {
        const { rejected } = checkCapabilityOwnership([
            { addonId: 'img-a', provides: ['image.generate', 'image.edit'] },
            { addonId: 'img-b', provides: ['image.generate'] },
            { addonId: 'txt', provides: ['text.reason'] },
            { addonId: 'ok', provides: ['knowledge.retrieve'] },
        ], new Set(['text.reason']));
        expect([...rejected.keys()].sort()).toEqual(['img-a', 'img-b', 'txt']);
        expect(rejected.get('txt')).toMatch(/Base 예약/);
        expect(rejected.get('img-a')).toMatch(/함께 선언/);
    });
});
