/**
 * 감사 action 레지스트리 — 등록 누락·심각도 회귀 방지.
 *
 * logAudit 의 action 파라미터가 AuditAction union 이라 미등록 문자열은 tsc 가 잡는다.
 * 여기서는 (1) 알림 대상 목록이 레지스트리에서 그대로 파생되는지,
 * (2) 소스에 리터럴로 적힌 action 이 전부 등록돼 있는지(타입 단언 우회 방어)를 본다.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
    AUDIT_ACTION_SEVERITY,
    AUDIT_ACTIONS,
    CRITICAL_ACTIONS,
    isAuditAction,
} from '../audit-actions';

const SRC_ROOT = path.resolve(__dirname, '../..');

function listSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listSourceFiles(full));
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
    }
    return out;
}

describe('audit action registry', () => {
    it('기존 알림 대상(action → 심각도)을 그대로 유지한다', () => {
        // 레지스트리 도입 전 AuditService.CRITICAL_ACTIONS 의 값 — 이름·심각도가 바뀌면 안 된다.
        expect(CRITICAL_ACTIONS).toEqual(expect.objectContaining({
            'user.deleted': 'critical',
            'user.role_changed': 'critical',
            'user.active_changed': 'warning',
            'user.email_changed': 'warning',
            'org.policy_changed': 'warning',
            'config.exported': 'warning',
            'config.imported': 'critical',
            'quota.overage_decided': 'warning',
            'quota.grant_manual': 'warning',
            'password.changed': 'warning',
            'consent.withdrawn': 'warning',
            'minor_pending_registered': 'warning',
            'export.requested': 'warning',
            'api_key.delete': 'warning',
            'api_key.rotate': 'warning',
            'system_settings.updated': 'warning',
            'system_settings.reset': 'warning',
            'setup.completed': 'warning',
            'chat.context_overflow': 'info',
            'api_key.create': 'info',
            'api_key.update': 'info',
            'user.register': 'info',
            'consent.granted': 'info',
            'login.failed': 'info',
        }));
    });

    it('CRITICAL_ACTIONS 는 심각도가 있는 action 만 담는다', () => {
        const withSeverity = Object.entries(AUDIT_ACTION_SEVERITY).filter(([, s]) => s !== null);
        expect(Object.keys(CRITICAL_ACTIONS).sort()).toEqual(withSeverity.map(([a]) => a).sort());
        expect(CRITICAL_ACTIONS['mcp_tool_call']).toBeUndefined();
        // 성공 로그인은 로그인마다 쌓인다 — 감사 기록만 남기고 알림은 보내지 않는다(login.failed 는 'info').
        expect(AUDIT_ACTION_SEVERITY['login.succeeded']).toBeNull();
        expect(isAuditAction('login.succeeded')).toBe(true);
        expect(CRITICAL_ACTIONS['login.succeeded']).toBeUndefined();
    });

    it('AUDIT_ACTIONS 는 레지스트리 전체를 정렬해 중복 없이 담는다', () => {
        expect(AUDIT_ACTIONS).toEqual([...new Set(Object.keys(AUDIT_ACTION_SEVERITY))].sort());
        expect(isAuditAction('user.deleted')).toBe(true);
        expect(isAuditAction('user.delete')).toBe(false);
        expect(isAuditAction(undefined)).toBe(false);
    });

    it('소스의 logAudit 호출에 리터럴로 적힌 action 은 모두 등록돼 있다', () => {
        const found = new Set<string>();
        for (const file of listSourceFiles(SRC_ROOT)) {
            const text = fs.readFileSync(file, 'utf8');
            // logAudit({ ... action: 'x' ... }) — 호출 시작부터 400자 안의 action 리터럴(삼항 포함)
            for (const call of text.matchAll(/logAudit\(\{[\s\S]{0,400}?\}/g)) {
                const actionExpr = /\baction:\s*([^,\n]+)/.exec(call[0]);
                if (!actionExpr) continue;
                for (const lit of actionExpr[1].matchAll(/'([^']+)'/g)) found.add(lit[1]);
            }
        }
        expect(found.size).toBeGreaterThan(30);
        expect([...found].filter((a) => !isAuditAction(a))).toEqual([]);
    });
});
