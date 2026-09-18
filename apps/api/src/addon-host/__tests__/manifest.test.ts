import * as fs from 'fs';
import * as path from 'path';
import { addonManifestSchema, satisfiesOpenmakeRange, validateInstallableAddonManifest } from '../manifest';
import { builtinAddonIds, builtinAddonDir, invalidBuiltinAddons } from '../builtin-registry';

const APP_VERSION: string = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf-8')).version;

describe('내장 팩 매니페스트', () => {
    it('매니페스트를 못 읽어 빠진 디렉토리가 없다 (빠지면 그 add-on 은 조용히 로드되지 않는다)', () => {
        expect(invalidBuiltinAddons()).toEqual([]);
        expect(builtinAddonIds().length).toBeGreaterThan(0);
    });

    it.each(builtinAddonIds())('%s — 스키마에 맞고 id 가 디렉토리와 같으며 현재 버전과 호환된다', id => {
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

describe('설치형 add-on 매니페스트 (확장 설치 경로)', () => {
    const base = { id: 'com.example.pack', name: 'x', version: '1.0.0', requires: { openmake: '>=1.0.0 <2.0.0' }, scope: 'user', components: { skills: './skills' } };

    it('내장과 같은 스키마를 통과하면 설치를 막지 않는다', () => {
        expect(validateInstallableAddonManifest(JSON.stringify(base), '1.75.0')).toEqual([]);
    });

    it('인프로세스 코드 진입점·system 범위·호환 범위 밖은 거절한다', () => {
        const errors = validateInstallableAddonManifest(JSON.stringify({ ...base, scope: 'system', entry: { chatMode: 'mode#x' } }), '2.0.0');
        expect(errors.some(e => e.startsWith('entry'))).toBe(true);
        expect(errors.some(e => e.startsWith('scope'))).toBe(true);
        expect(errors.some(e => e.startsWith('requires.openmake'))).toBe(true);
    });

    it('깨진 JSON·스키마 위반(server 구성요소)은 사유와 함께 거절한다', () => {
        expect(validateInstallableAddonManifest('{', '1.75.0')).toEqual(['JSON 파싱 실패']);
        expect(validateInstallableAddonManifest(JSON.stringify({ ...base, components: { server: './server' } }), '1.75.0').length).toBeGreaterThan(0);
    });
});
