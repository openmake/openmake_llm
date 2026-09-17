import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildLongContextFixture, LONG_CONTEXT_FIXTURES, FIXTURE_CHARS_PER_TOKEN } from '../long-context-fixtures';
import { loadGoldenDataset, REAL_ONLY_TAG } from '../dataset-loader';
import { buildCaseAttachments } from '../real-response-generator';

describe('long-context-fixtures', () => {
    it('같은 id 는 항상 같은 문자열(결정적)', () => {
        expect(buildLongContextFixture('long-8k')).toBe(buildLongContextFixture('long-8k'));
    });

    it.each(Object.values(LONG_CONTEXT_FIXTURES))('$id — 목표 크기 근처이고 needle 이 지정 위치 ±5% 에 한 번씩', (def) => {
        const text = buildLongContextFixture(def.id);
        const target = Math.round(def.approxTokens * FIXTURE_CHARS_PER_TOKEN);
        expect(text.length).toBeGreaterThanOrEqual(target);
        expect(text.length).toBeLessThan(target * 1.05);
        for (const n of def.needles) {
            const at = text.indexOf(n.sentence);
            expect(at).toBeGreaterThanOrEqual(0);
            expect(text.indexOf(n.sentence, at + 1)).toBe(-1);
            expect(Math.abs(at / text.length - n.position)).toBeLessThan(0.05);
        }
    });

    it('모르는 id 는 예외', () => {
        expect(() => buildLongContextFixture('nope')).toThrow(/알 수 없는 contextFixture/);
    });
});

describe('golden-dataset 첨부 케이스(F26.5)', () => {
    const ds = loadGoldenDataset();
    const attached = ds.cases.filter((c) => c.attachments?.length || c.contextFixture);

    it('장문 10건·멀티모달 10건, 전부 real-only', () => {
        expect(attached.filter((c) => c.contextFixture)).toHaveLength(10);
        expect(attached.filter((c) => c.attachments?.length)).toHaveLength(10);
        expect(attached.every((c) => c.tags?.includes(REAL_ONLY_TAG))).toBe(true);
    });

    it('장문 케이스의 정답이 픽스처 needle 문장에 실제로 들어 있다(라벨 오타 방지)', () => {
        for (const c of attached.filter((x) => x.contextFixture)) {
            const needles = LONG_CONTEXT_FIXTURES[c.contextFixture!].needles.map((n) => n.sentence).join(' ');
            for (const ans of c.mustContain ?? []) expect(needles).toContain(ans);
        }
    });

    it('buildCaseAttachments — 이미지는 base64, 장문은 첨부 파일 컨텍스트, 첨부 없으면 빈 객체', () => {
        const img = attached.find((c) => c.attachments?.length === 8)!;
        const req = buildCaseAttachments(img);
        expect(req.images).toHaveLength(8);
        expect(Buffer.from(req.images![0], 'base64').subarray(1, 4).toString()).toBe('PNG');
        const long = buildCaseAttachments(attached.find((c) => c.contextFixture === 'long-8k')!);
        expect(long.fileContext).toContain('long-8k.txt');
        expect(long.fileContext).toContain('KX-4827-Q');
        expect(buildCaseAttachments({ id: 'x', category: 'response-pattern', query: 'q' })).toEqual({});
        expect(buildCaseAttachments(undefined)).toEqual({});
    });

    it('로더 — 없는 이미지·모르는 픽스처·real-only 누락을 거부', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-'));
        const f = path.join(dir, 'ds.json');
        fs.writeFileSync(f, JSON.stringify({ version: 't', description: '', cases: [
            { id: 'a', category: 'response-pattern', query: 'q', mustContain: ['x'], tags: ['real-only'], attachments: [{ kind: 'image', fixture: 'missing.png' }] },
            { id: 'b', category: 'response-pattern', query: 'q', mustContain: ['x'], tags: ['real-only'], contextFixture: 'long-1m' },
            { id: 'c', category: 'response-pattern', query: 'q', mustContain: ['x'], contextFixture: 'long-8k' },
        ] }));
        expect(() => loadGoldenDataset(f)).toThrow(/a: 이미지 픽스처 없음[\s\S]*b: 알 수 없는 contextFixture[\s\S]*c: 첨부 케이스는 tags 에 real-only/);
    });
});
