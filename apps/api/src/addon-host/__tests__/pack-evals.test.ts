/**
 * 팩 eval 세트 합류 (2026-09-19, S3).
 *
 * 계약: 켜진 add-on 의 케이스만, id 는 `<addonId>:<caseId>` 로 네임스페이스, 깨진 팩은 그 팩만 건너뛴다.
 * ⚠️ 현재 내장 팩은 eval 을 동봉하지 않는다(골든셋 기준선 수치를 움직이지 않기 위해) — 기구만 서 있다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const enabled: Array<{ id: string; dir: string; manifest: { components: { evals?: string } } }> = [];
jest.mock('../builtin-registry', () => ({ enabledBuiltinAddons: () => enabled }));

import { loadEnabledPackEvalCases } from '../pack-evals';

function pack(id: string, body: string | null): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omk-pack-eval-${id}-`));
    if (body !== null) fs.writeFileSync(path.join(dir, 'evals.json'), body);
    enabled.push({ id, dir, manifest: { components: { evals: './evals.json' } } });
}

beforeEach(() => { enabled.length = 0; });

describe('loadEnabledPackEvalCases', () => {
    it('케이스 id 를 add-on 으로 네임스페이스하고 태그를 붙인다', () => {
        pack('industry-pack', JSON.stringify({ cases: [{ id: 'mfg-1', category: 'routing-accuracy', query: '공정 불량률' }] }));

        const cases = loadEnabledPackEvalCases();

        expect(cases).toHaveLength(1);
        expect(cases[0].id).toBe('industry-pack:mfg-1');
        expect(cases[0].tags).toContain('addon:industry-pack');
    });

    it('evals 를 선언하지 않은 add-on 은 아무것도 내지 않는다', () => {
        enabled.push({ id: 'plain', dir: os.tmpdir(), manifest: { components: {} } });
        expect(loadEnabledPackEvalCases()).toEqual([]);
    });

    it('깨진 팩은 그 팩만 건너뛰고 나머지는 합류한다(fail-open)', () => {
        pack('broken', '{ not json');
        pack('good', JSON.stringify({ cases: [{ id: 'ok-1', category: 'routing-accuracy', query: 'q' }] }));

        const cases = loadEnabledPackEvalCases();

        expect(cases.map(c => c.id)).toEqual(['good:ok-1']);
    });

    it('파일이 없어도 죽지 않는다', () => {
        pack('missing', null);
        expect(loadEnabledPackEvalCases()).toEqual([]);
    });
});
