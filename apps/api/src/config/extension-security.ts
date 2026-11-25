/**
 * @module config/extension-security
 * @description 확장(스킬·MCP·플러그인) 설치·업데이트 보안 옵션 — 전부 opt-in(기본 OFF = 종전 동작, 2026-11-25).
 *
 * Base 원칙: 동작 계약(기본 동작)을 바꾸는 결함 수정은 옵션으로 넣는다. 운영 기능 프로필
 * (`scripts/setup/profiles/ops-features.env`)이 켠다. 호출 시점에 읽는다(테스트·재시작 없는 env 주입 대비 getter).
 */
export const EXTENSION_SECURITY = {
    /**
     * 업데이트 승인 이어받기를 이름이 아니라 **내용 지문**(설명·본문·번들)으로 판정 — 내용이 바뀐 스킬·에이전트는 재승인.
     * 기본 OFF(종전: 같은 이름이면 이어받음). `EXTENSION_APPROVAL_FINGERPRINT=true`.
     */
    get APPROVAL_FINGERPRINT(): boolean {
        return process.env.EXTENSION_APPROVAL_FINGERPRINT === 'true';
    },
    /**
     * 확장의 `agents/*.md` 로 만든 Custom Agent 를 승인 대기(pending)로 설치 — 승인함에서 승인해야 쓸 수 있다.
     * 기본 OFF(종전: 설치 즉시 활성). `EXTENSION_AGENT_APPROVAL_REQUIRED=true`.
     */
    get AGENT_APPROVAL_REQUIRED(): boolean {
        return process.env.EXTENSION_AGENT_APPROVAL_REQUIRED === 'true';
    },
} as const;
