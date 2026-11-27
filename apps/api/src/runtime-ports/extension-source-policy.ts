/**
 * 확장 원본 정책 포트(M2) — add-on 의 설치 경로(MCP 서버 ingest 등)가 Base 의 단일 원본 검사를 부르는 길.
 *
 * 검사·정책 해석은 Base(services/extensions/source-policy)에 있고, add-on 은 이 포트만 안다(설계 D2 — Base 내부 직접 import 금지).
 * 강제 OFF(EXTENSION_SOURCE_POLICY_ENFORCED) 면 아무 것도 하지 않는다. 거절은 403 `EXTENSION_SOURCE_BLOCKED` 예외.
 *
 * @module runtime-ports/extension-source-policy
 */
import { assertExtensionSourceAllowed } from '../services/extensions/source-policy';

export { EXTENSION_SOURCE_BLOCKED_CODE } from '../config/extension-source-policy';

/** git 원본 설치 전 검사 — 네트워크·파일 작업 **전에** 부른다 */
export function assertInstallSourceAllowed(req: { url: string; ref?: string | null; userId?: string }): Promise<void> {
    return assertExtensionSourceAllowed({ ...req, action: 'install', gitFirst: true });
}
