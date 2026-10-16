/**
 * `migrate:addons` CLI 출력 — 권한 없어 건너뛴 add-on·적용 결과를 줄로 만들고, 하나라도 실패하면 ok=false(종료 코드 1).
 */
import { summarizeAddonMigrations } from '../../../data/migrations/runner';

describe('summarizeAddonMigrations', () => {
    it('적용 건수와 파일 이름을 add-on 별로 적고 ok', () => {
        expect(summarizeAddonMigrations([], [
            { id: 'alpha', applied: ['001_a.sql', '002_b.sql'] },
            { id: 'beta', applied: [] },
        ])).toEqual({
            ok: true,
            lines: [
                '  + alpha: 2건 적용 (001_a.sql, 002_b.sql)',
                '  + beta: 0건 적용',
                'Add-on migrations: 2 add-on, failed 0',
            ],
        });
    });

    it('권한(database:addon) 없이 마이그레이션을 선언한 add-on 은 건너뜀으로 알린다', () => {
        expect(summarizeAddonMigrations(['gamma'], []).lines[0]).toBe("  ! gamma: 'database:addon' 권한이 없어 건너뜀");
    });

    it('하나라도 실패하면 ok=false 이고 사유를 적는다', () => {
        const out = summarizeAddonMigrations([], [
            { id: 'alpha', applied: [], error: 'relation "users" does not exist' },
            { id: 'beta', applied: ['001_x.sql'] },
        ]);
        expect(out.ok).toBe(false);
        expect(out.lines).toContain('  x alpha: relation "users" does not exist');
        expect(out.lines[out.lines.length - 1]).toBe('Add-on migrations: 2 add-on, failed 1');
    });
});
