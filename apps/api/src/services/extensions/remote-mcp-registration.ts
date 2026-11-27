/**
 * 확장 번들 원격 MCP 관리 등록(P8) — 설치·승인 두 지점이 같은 검사를 쓴다. 플래그는 config/extension-remote-mcp.
 *
 *  ① URL 검사(`checkRemoteMcpUrl`): https 만, SSRF 가드(`security/ssrf-guard` validateOutboundUrl)로 사설·루프백·
 *     링크로컬·메타데이터 주소를 막는다. 호스트 확인(DNS) 실패는 설치 때는 통과(경고 — 오프라인 설치)·승인 때는 거절.
 *     연결 시점의 재검증·주소 고정은 종전대로 런타임의 `createPinnedFetch` 가 한다(DNS rebinding).
 *  ② MCP 서버 정책: §8-3(`services/extensions/mcp-server-policy`, `EXTENSION_MCP_SERVER_POLICY_ENFORCED`)의 게이트를
 *     그대로 쓴다 — 설치는 `collectMcpDrafts` 가 모든 서버에 대해 먼저 부르고, 승인은 `checkMcpServerPolicyAtApproval` 이
 *     같은 게이트로 다시 본다(설치 뒤 정책이 바뀐 경우). 정책 강제 OFF 면 허용(종전 동작).
 *  ③ 등록 기록(`buildRemoteRegistrationMeta` · `readRemoteRegistration`): 번들이 선언한 URL 을 그대로 고정한다.
 *     승인은 저장된 URL 이 이 값과 같은지 본다(`verifyRemoteRegistrationUrl`).
 *
 * @module services/extensions/remote-mcp-registration
 */
import { validateOutboundUrl, type DnsResolver } from '../../security/ssrf-guard';
import { EXTENSION_REMOTE_MCP_CODES, REMOTE_MCP_REGISTRATION_META_KEY } from '../../config/extension-remote-mcp';
import { describeMcpServerBlock, EXTENSION_MCP_SERVER_BLOCKED_CODE } from '../../errors/extension-mcp-server-blocked.error';
import { loadExtensionMcpServerGate, recordMcpServerBlocked, type ExtensionMcpServerPolicyDeps } from './mcp-server-policy';

export type RemoteMcpCheckPhase = 'install' | 'approve';

export type RemoteMcpCheckResult =
    | { allowed: true; /** 설치 때 호스트를 확인하지 못했다(승인에서 다시 본다) */ unresolved?: boolean }
    | { allowed: false; code: string; reason: string };

/** 원격 MCP 검사 입력 — 확장 번들이 선언한 서버 하나 */
export interface ExtensionRemoteMcpInput {
    phase: RemoteMcpCheckPhase;
    userId: string;
    /** 번들 안의 서버 키(정책 판정·감사의 이름) */
    serverKey?: string;
    transportType: string;
    url?: string | null;
    command?: string | null;
    args?: string[] | null;
}

/** 정책 판정 의존성 — 테스트가 조직 층·감사를 바꿔 끼운다(기본은 §8-3 의 기본 의존성) */
export type RemoteMcpPolicyDeps = ExtensionMcpServerPolicyDeps;

/**
 * §8-3 확장 MCP 서버 정책(`EXTENSION_MCP_SERVER_POLICY_ENFORCED`)으로 승인 시점 판정 — 설치 시점은 `collectMcpDrafts` 가
 * 같은 게이트를 이미 부른다(중복 감사 방지로 여기서는 승인만). 강제 OFF 면 게이트가 null 이라 허용(종전 동작).
 * 정책 조회 실패(적용 이력 없음)는 게이트가 `POLICY_UNAVAILABLE` 거절로 돌려준다(fail-closed).
 */
export async function checkMcpServerPolicyAtApproval(input: ExtensionRemoteMcpInput, deps?: RemoteMcpPolicyDeps): Promise<RemoteMcpCheckResult> {
    const gate = await loadExtensionMcpServerGate(input.userId, deps);
    if (!gate) return { allowed: true };
    const verdict = gate.evaluate({ name: input.serverKey, transport: input.transportType, command: input.command, args: input.args, url: input.url });
    if (verdict.allowed) return { allowed: true };
    const detail = await recordMcpServerBlocked(input.userId, 'extension-approve', verdict, deps);
    return { allowed: false, code: EXTENSION_MCP_SERVER_BLOCKED_CODE, reason: describeMcpServerBlock(detail) };
}

const SSRF_BLOCKED_PREFIX = 'SSRF blocked';

/**
 * 네트워크 없는 정적 URL 검사 — 형식·https·URL 자격증명. 설치 미리보기(M1b, 네트워크 없음)도 이것만 쓴다.
 * @returns 통과면 파싱한 URL, 아니면 거절 사유
 */
export function checkRemoteMcpUrlStatic(rawUrl: string | null | undefined): { ok: true; url: URL } | { ok: false; code: string; reason: string } {
    let parsed: URL;
    try { parsed = new URL(String(rawUrl ?? '')); } catch {
        return { ok: false, code: EXTENSION_REMOTE_MCP_CODES.URL_BLOCKED, reason: 'URL 형식이 아닙니다' };
    }
    if (parsed.protocol !== 'https:') {
        return { ok: false, code: EXTENSION_REMOTE_MCP_CODES.URL_INSECURE, reason: `https 만 허용합니다(${parsed.protocol})` };
    }
    if (parsed.username || parsed.password) {
        // URL 에 자격증명을 박는 것은 헤더 주입과 같은 우회다 — 인증은 OAuth 로만
        return { ok: false, code: EXTENSION_REMOTE_MCP_CODES.URL_BLOCKED, reason: 'URL 에 자격증명을 넣을 수 없습니다(인증은 OAuth 로그인)' };
    }
    return { ok: true, url: parsed };
}

/** 원격 MCP 선언 URL 검사 — 정적 검사 + SSRF 가드. 호스트 확인 실패는 설치 때만 통과 */
export async function checkRemoteMcpUrl(rawUrl: string | null | undefined, phase: RemoteMcpCheckPhase, resolver?: DnsResolver): Promise<RemoteMcpCheckResult> {
    const stat = checkRemoteMcpUrlStatic(rawUrl);
    if (!stat.ok) return { allowed: false, code: stat.code, reason: stat.reason };
    const parsed = stat.url;
    try {
        await (resolver ? validateOutboundUrl(parsed.toString(), resolver) : validateOutboundUrl(parsed.toString()));
        return { allowed: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith(SSRF_BLOCKED_PREFIX)) {
            return { allowed: false, code: EXTENSION_REMOTE_MCP_CODES.URL_BLOCKED, reason: '내부·사설 주소로 가는 URL 은 등록할 수 없습니다' };
        }
        if (phase === 'install') return { allowed: true, unresolved: true };
        return { allowed: false, code: EXTENSION_REMOTE_MCP_CODES.URL_UNRESOLVED, reason: `호스트를 확인하지 못했습니다(${parsed.hostname})` };
    }
}

/** URL 검사 → (승인 시점이면) §8-3 정책 순서로 판정(원격 서버용) */
export async function checkExtensionRemoteMcp(input: ExtensionRemoteMcpInput, resolver?: DnsResolver, deps?: RemoteMcpPolicyDeps): Promise<RemoteMcpCheckResult> {
    const url = await checkRemoteMcpUrl(input.url, input.phase, resolver);
    if (!url.allowed) return url;
    if (input.phase === 'approve') {
        const policy = await checkMcpServerPolicyAtApproval(input, deps);
        if (!policy.allowed) return policy;
    }
    return url;
}

export interface RemoteRegistrationMeta {
    /** 번들이 선언한 URL — 저장 URL 은 이 값과 같아야 승인된다 */
    declaredUrl: string;
    urlLocked: true;
    /** 인증 방식 — 원격 MCP 는 OAuth 만(헤더·URL 자격증명 주입 미지원) */
    auth: 'oauth';
    registeredAt: string;
}

export function buildRemoteRegistrationMeta(declaredUrl: string, now: Date = new Date()): Record<string, RemoteRegistrationMeta> {
    return { [REMOTE_MCP_REGISTRATION_META_KEY]: { declaredUrl, urlLocked: true, auth: 'oauth', registeredAt: now.toISOString() } };
}

export function readRemoteRegistration(manifestMeta: unknown): RemoteRegistrationMeta | null {
    const v = (manifestMeta as Record<string, unknown> | null | undefined)?.[REMOTE_MCP_REGISTRATION_META_KEY] as Partial<RemoteRegistrationMeta> | undefined;
    if (!v || typeof v.declaredUrl !== 'string' || v.urlLocked !== true) return null;
    return { declaredUrl: v.declaredUrl, urlLocked: true, auth: 'oauth', registeredAt: String(v.registeredAt ?? '') };
}

/** 저장된 URL 이 선언값과 같은가 — 기록이 없으면(플래그 전 설치분) 비교할 값이 없어 통과 */
export function verifyRemoteRegistrationUrl(storedUrl: string | null | undefined, manifestMeta: unknown): RemoteMcpCheckResult {
    const reg = readRemoteRegistration(manifestMeta);
    if (!reg) return { allowed: true };
    if (storedUrl !== reg.declaredUrl) {
        return { allowed: false, code: EXTENSION_REMOTE_MCP_CODES.URL_MISMATCH, reason: '저장된 URL 이 확장이 선언한 URL 과 다릅니다' };
    }
    return { allowed: true };
}
