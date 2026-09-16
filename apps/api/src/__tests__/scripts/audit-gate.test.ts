/**
 * npm audit 게이트(F28.8) — 새 high 권고·만료된 허용·해소돼 남은 허용 항목 판정.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { evaluateAudit } = require('../../../../../scripts/audit-gate.cjs') as {
    evaluateAudit: (audit: unknown, allowlist: unknown[], opts?: { level?: string; now?: Date }) => {
        ok: boolean; failures: Array<{ id: string }>; expired: Array<{ id: string }>; allowed: Array<{ id: string }>; unused: string[];
    };
};

const audit = {
    vulnerabilities: {
        sharp: { via: [{ source: 1, name: 'sharp', severity: 'high', title: 'libvips', url: 'https://github.com/advisories/GHSA-aaaa' }] },
        kordoc: { via: ['sharp'] },
        qs: { via: [{ source: 2, name: 'qs', severity: 'moderate', title: 'proto', url: 'https://github.com/advisories/GHSA-mod' }] },
        pdfjs: { via: [{ source: 3, name: 'pdfjs-dist', severity: 'critical', title: 'js exec', url: 'https://github.com/advisories/GHSA-crit' }] },
    },
};
const now = new Date('2026-09-17T00:00:00Z');

describe('evaluateAudit', () => {
    it('허용 목록에 없는 high·critical 은 실패, moderate 는 무시, 문자열 via 는 전이 경로라 건너뛴다', () => {
        const r = evaluateAudit(audit, [], { now });
        expect(r.ok).toBe(false);
        expect(r.failures.map((f) => f.id).sort()).toEqual(['GHSA-aaaa', 'GHSA-crit']);
    });

    it('만료 전 허용은 통과, 만료된 허용은 실패', () => {
        const allow = [{ id: 'GHSA-aaaa', reason: 'r', expires: '2026-10-01' }, { id: 'GHSA-crit', reason: 'r', expires: '2026-09-16' }];
        const r = evaluateAudit(audit, allow, { now });
        expect(r.allowed.map((a) => a.id)).toEqual(['GHSA-aaaa']);
        expect(r.expired.map((a) => a.id)).toEqual(['GHSA-crit']);
        expect(r.ok).toBe(false);
    });

    it('level critical 이면 high 는 보지 않고, 해소된 허용 항목은 unused 로 알린다', () => {
        const r = evaluateAudit(audit, [{ id: 'GHSA-crit', reason: 'r', expires: '2027-01-01' }, { id: 'GHSA-gone', reason: 'r', expires: '2027-01-01' }], { level: 'critical', now });
        expect(r.ok).toBe(true);
        expect(r.unused).toEqual(['GHSA-gone']);
    });
});
