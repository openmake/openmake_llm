/**
 * 확장 번들 원격 MCP 관리 등록 포트(P8) — MCP 런타임 add-on 의 승인·연결 경로가 Base 의 같은 검사를 부르는 길.
 *
 * 판정·기록은 Base(services/extensions/remote-mcp-registration)에 있고 add-on 은 이 포트만 안다(Base 내부 직접 import 금지).
 * 플래그(EXTENSION_REMOTE_MCP_ENABLED)가 꺼져 있으면 호출부가 아무 것도 하지 않는다 — 종전 동작.
 *
 * @module runtime-ports/extension-remote-mcp
 */
export { extensionRemoteMcpEnabled, EXTENSION_REMOTE_MCP_CODES } from '../config/extension-remote-mcp';
export {
    checkExtensionRemoteMcp,
    checkExtensionMcpServerPolicy,
    readRemoteRegistration,
    verifyRemoteRegistrationUrl,
    type RemoteMcpCheckResult,
    type ExtensionMcpServerPolicyInput,
} from '../services/extensions/remote-mcp-registration';
