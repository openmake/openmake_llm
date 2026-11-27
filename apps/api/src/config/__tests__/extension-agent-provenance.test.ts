/**
 * EXTENSION_AGENT_BUNDLE_PROVENANCE(P8, opt-in) — 기본 OFF, env·system_settings 로 켠다.
 * 승인 대기 설치 플래그(EXTENSION_AGENT_APPROVAL_REQUIRED)와 독립이다 — 그쪽만 켜도 이 플래그는 꺼진 채다.
 */
import { resetConfig } from '../env';
import { extensionAgentBundleProvenanceEnabled, EXTENSION_AGENT_PROVENANCE_FLAG } from '../extension-agent-provenance';
import { SETTING_DEFS_BY_KEY } from '../system-settings-registry';

const KEYS = [EXTENSION_AGENT_PROVENANCE_FLAG, 'EXTENSION_AGENT_APPROVAL_REQUIRED'] as const;
const saved: Record<string, string | undefined> = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
afterEach(() => {
    for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
    resetConfig();
});

describe('EXTENSION_AGENT_BUNDLE_PROVENANCE', () => {
    it('기본 OFF', () => {
        delete process.env[EXTENSION_AGENT_PROVENANCE_FLAG];
        resetConfig();
        expect(extensionAgentBundleProvenanceEnabled()).toBe(false);
    });

    it('승인 대기 플래그만 켜도 꺼진 채다(운영 프로필이 이미 켠 플래그와 분리)', () => {
        delete process.env[EXTENSION_AGENT_PROVENANCE_FLAG];
        process.env.EXTENSION_AGENT_APPROVAL_REQUIRED = 'true';
        resetConfig();
        expect(extensionAgentBundleProvenanceEnabled()).toBe(false);
    });

    it("'true' 면 켜진다", () => {
        process.env[EXTENSION_AGENT_PROVENANCE_FLAG] = 'true';
        resetConfig();
        expect(extensionAgentBundleProvenanceEnabled()).toBe(true);
    });

    it('system_settings 레지스트리에 실시간 불리언으로 등록돼 있다', () => {
        const def = SETTING_DEFS_BY_KEY.get(EXTENSION_AGENT_PROVENANCE_FLAG);
        expect(def).toBeDefined();
        expect(def?.requiresRestart).toBe(false);
        expect(def?.validate.safeParse('true').success).toBe(true);
        expect(def?.validate.safeParse('yes').success).toBe(false);
    });
});
