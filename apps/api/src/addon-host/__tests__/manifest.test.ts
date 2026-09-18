import * as fs from 'fs';
import * as path from 'path';
import { addonManifestSchema, satisfiesOpenmakeRange } from '../manifest';
import { BUILTIN_ADDON_IDS, builtinAddonDir } from '../builtin-registry';

const APP_VERSION: string = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf-8')).version;

describe('내장 팩 매니페스트', () => {
    it.each([...BUILTIN_ADDON_IDS])('%s — 스키마에 맞고 id 가 디렉토리와 같으며 현재 버전과 호환된다', id => {
        const manifest = addonManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(builtinAddonDir(id), 'openmake-addon.json'), 'utf-8')));
        expect(manifest.id).toBe(id);
        expect(manifest.scope).toBe('system');
        expect(satisfiesOpenmakeRange(APP_VERSION, manifest.requires.openmake)).toBe(true);
        for (const rel of Object.values(manifest.components)) {
            expect(fs.existsSync(path.join(builtinAddonDir(id), rel as string))).toBe(true);
        }
    });

    it('인프로세스 코드·스키마 구성요소는 거절한다', () => {
        const base = { id: 'x', name: 'x', version: '1.0.0', requires: { openmake: '>=1.0.0' }, scope: 'user' };
        expect(addonManifestSchema.safeParse({ ...base, components: { skills: './skills' } }).success).toBe(true);
        for (const key of ['server', 'ui', 'migrations']) {
            expect(addonManifestSchema.safeParse({ ...base, components: { [key]: './x' } }).success).toBe(false);
        }
    });
});

describe('satisfiesOpenmakeRange', () => {
    it.each([
        ['1.73.1', '>=1.0.0 <2.0.0', true],
        ['2.0.0', '>=1.0.0 <2.0.0', false],
        ['1.73.1', '>=1.74.0', false],
        ['1.73.1', '=1.73.1', true],
        ['1.73.1', '^1.0.0', false],   // 미지원 식은 불충족
        ['1.73.1', '', false],
        ['garbage', '>=1.0.0', false],
    ])('%s ∈ "%s" → %s', (v, r, expected) => expect(satisfiesOpenmakeRange(v, r)).toBe(expected));
});
