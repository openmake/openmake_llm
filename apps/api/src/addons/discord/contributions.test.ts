/**
 * discord add-on 기여 — 설정 키·스코프가 Base 레지스트리에 실제로 얹히는지, 봇 중계 목록과 짝이 맞는지.
 */
import { SYSTEM_SETTINGS_REGISTRY } from '../../config/system-settings-registry';
import { ALLOWED_API_KEY_SCOPES, apiKeyHasScope } from '../../config/api-key-scopes';
import { DISCORD_API_KEY_SCOPE, DISCORD_RUNTIME_CONFIG_FETCH_AUDIT_ACTION } from './contributions';
import { AUDIT_ACTIONS, CRITICAL_ACTIONS, isAuditAction } from '../../config/audit-actions';
import { DISCORD_RUNTIME_SETTING_KEYS } from './runtime-keys';

it('discord 그룹 키는 봇 중계 목록과 정확히 일치한다', () => {
    // 한쪽만 늘리면 값이 저장돼도 봇에 닿지 않거나(레지스트리만), 저장이 거부된다(중계 목록만).
    const groupKeys = SYSTEM_SETTINGS_REGISTRY.filter((d) => d.group === 'discord').map((d) => d.key).sort();
    expect(groupKeys).toEqual([...DISCORD_RUNTIME_SETTING_KEYS].sort());
    expect(groupKeys.length).toBeGreaterThan(0);
    // 봇 API 키는 중계 요청 자체의 자격증명이라 어느 쪽에도 없어야 한다(부트스트랩 순환).
    expect(groupKeys).not.toContain('DISCORD_BOT_API_KEY');
});

it('봇 토큰은 시크릿(write-only)으로 등록된다', () => {
    expect(SYSTEM_SETTINGS_REGISTRY.find((d) => d.key === 'DISCORD_BOT_TOKEN')?.secret).toBe(true);
});

it('discord 스코프는 봇 설정 배포 전용 — 추론·브리지 키로는 봇 토큰을 못 받아간다', () => {
    expect(ALLOWED_API_KEY_SCOPES.has(DISCORD_API_KEY_SCOPE)).toBe(true);
    expect(apiKeyHasScope(['chat'], DISCORD_API_KEY_SCOPE)).toBe(false);
    expect(apiKeyHasScope(['bridge'], DISCORD_API_KEY_SCOPE)).toBe(false);
    expect(apiKeyHasScope([DISCORD_API_KEY_SCOPE], 'chat')).toBe(false);
    expect(apiKeyHasScope([DISCORD_API_KEY_SCOPE], DISCORD_API_KEY_SCOPE)).toBe(true);
});

it('감사 action 은 Base 레지스트리에 얹히고 알림 대상은 아니다', () => {
    expect(DISCORD_RUNTIME_CONFIG_FETCH_AUDIT_ACTION).toBe('discord_runtime_config_fetch');
    expect(isAuditAction(DISCORD_RUNTIME_CONFIG_FETCH_AUDIT_ACTION)).toBe(true);
    expect(AUDIT_ACTIONS).toContain(DISCORD_RUNTIME_CONFIG_FETCH_AUDIT_ACTION);
    expect(CRITICAL_ACTIONS[DISCORD_RUNTIME_CONFIG_FETCH_AUDIT_ACTION]).toBeUndefined();
});
