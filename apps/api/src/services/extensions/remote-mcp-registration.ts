/**
 * 확장 번들 원격 MCP 관리 등록(P8) — 설치·승인 두 지점이 같은 검사를 쓴다. 플래그는 config/extension-remote-mcp.
 *
 *  ① URL 검사(`checkRemoteMcpUrl`): https 만, SSRF 가드(`security/ssrf-guard` validateOutboundUrl)로 사설·루프백·
 *     링크로컬·메타데이터 주소를 막는다. 호스트 확인(DNS) 실패는 설치 때는 통과(경고 — 오프라인 설치)·승인 때는 거절.
 *     연결 시점의 재검증·주소 고정은 종전대로 런타임의 `createPinnedFetch` 가 한다(DNS rebinding).
 *  ② MCP 서버 정책 훅(`checkExtensionMcpServerPolicy`): §8-3 의 URL·명령 매처 정책이 꽂히는 **일반 자리**다.
 *     등록이 없으면 언제나 허용(동작 변화 0). 훅이 예외를 던지면 거절(fail-closed — 켜진 정책을 확인하지 못한 것).
 *     정책은 원격·stdio 모두 받는다(input.transportType 으로 구분).
 *  ③ 등록 기록(`buildRemoteRegistrationMeta` · `readRemoteRegistration`): 번들이 선언한 URL 을 그대로 고정한다.
 *     승인은 저장된 URL 이 이 값과 같은지 본다(`verifyRemoteRegistrationUrl`).
 *
 * @module services/extensions/remote-mcp-registration
 */
import { validateOutboundUrl, type DnsResolver } from '../../security/ssrf-guard';
import { EXTENSION_REMOTE_MCP_CODES, REMOTE_MCP_REGISTRATION_META_KEY } from '../../config/extension-remote-mcp';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ExtensionRemoteMcp');

export type RemoteMcpCheckPhase = 'install' | 'approve';

export type RemoteMcpCheckResult =
    | { allowed: true; /** 설치 때 호스트를 확인하지 못했다(승인에서 다시 본다) */ unresolved?: boolean }
    | { allowed: false; code: string; reason: string };

/** MCP 서버 정책 훅 입력 — 확장 번들이 선언한 서버 하나 */
export interface ExtensionMcpServerPolicyInput {
    phase: RemoteMcpCheckPhase;
    userId: string;
    /** 확장 이름(설치 시점) */
    extensionName?: string;
    /** 확장 원본 URL(설치 시점 — 승인 때는 manifest_meta.gitUrl) */
    sourceUrl?: string;
    /** 번들 안의 서버 키 */
    serverKey?: string;
    transportType: string;
    url?: string | null;
    command?: string | null;
    args?: string[] | null;
}

export type ExtensionMcpServerPolicyDecision = { allowed: true } | { allowed: false; reason: string };
export type ExtensionMcpServerPolicyHook = (input: ExtensionMcpServerPolicyInput) => ExtensionMcpServerPolicyDecision | Promise<ExtensionMcpServerPolicyDecision>;

let policyHook: ExtensionMcpServerPolicyHook | null = null;

/** §8-3 MCP 서버 매처 정책을 꽂는다(null = 해제). 부팅 시 1회. */
export function setExtensionMcpServerPolicyHook(hook: ExtensionMcpServerPolicyHook | null): void {
    policyHook = hook;
}

/** 정책 훅 판정 — 등록이 없으면 허용, 훅 실패는 거절(fail-closed) */
export async function checkExtensionMcpServerPolicy(input: ExtensionMcpServerPolicyInput): Promise<RemoteMcpCheckResult> {
    if (!policyHook) return { allowed: true };
    try {
        const d = await policyHook(input);
        return d.allowed ? { allowed: true } : { allowed: false, code: EXTENSION_REMOTE_MCP_CODES.POLICY_BLOCKED, reason: d.reason };
    } catch (e) {
        logger.warn(`MCP 서버 정책 훅 실패 → 거절: ${e instanceof Error ? e.message : String(e)}`);
        return { allowed: false, code: EXTENSION_REMOTE_MCP_CODES.POLICY_UNAVAILABLE, reason: 'MCP 서버 정책을 확인하지 못했습니다' };
    }
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

/** URL 검사 → 정책 훅 순서로 판정(원격 서버용) */
export async function checkExtensionRemoteMcp(input: ExtensionMcpServerPolicyInput, resolver?: DnsResolver): Promise<RemoteMcpCheckResult> {
    const url = await checkRemoteMcpUrl(input.url, input.phase, resolver);
    if (!url.allowed) return url;
    const policy = await checkExtensionMcpServerPolicy(input);
    if (!policy.allowed) return policy;
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
