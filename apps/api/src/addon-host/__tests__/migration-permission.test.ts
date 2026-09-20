/**
 * add-on 스키마 적용의 권한 집행 (2026-09-20) — `database:addon` 없이 선언한 migrations 는 적용되지 않는다.
 */
import { selectMigrationTargets } from '../index';
import type { BuiltinAddon } from '../builtin-registry';

const addon = (id: string, migrations: string | undefined, permissions?: string[]): BuiltinAddon => ({
    id, dir: `/packs/${id}`,
    manifest: { id, name: id, version: '1.0.0', requires: { openmake: '>=1.0.0' }, scope: 'system', components: { ...(migrations ? { migrations } : {}) }, ...(permissions ? { permissions } : {}) },
} as unknown as BuiltinAddon);

describe('selectMigrationTargets', () => {
    it('권한이 있는 add-on 만 대상이고, 권한 없이 선언한 것은 denied 로 드러난다', () => {
        const r = selectMigrationTargets([
            addon('with-perm', './migrations', ['database:addon']),
            addon('no-perm', './migrations'),
            addon('other-perm', './migrations', ['network:internet']),
            addon('no-migrations', undefined, ['database:addon']),
        ]);
        expect(r.targets).toEqual([{ id: 'with-perm', dir: '/packs/with-perm/migrations' }]);
        expect(r.denied).toEqual(['no-perm', 'other-perm']);
    });
});
