/**
 * 첫 실행 셋업 훅 — MCP 샌드박스 secure-by-default (2026-09-19 add-on 으로 이동).
 *
 * MCP_SANDBOX_ENABLED 미설정 + docker·런타임 이미지 가용일 때만 `.env` 영속 + 즉시 반영.
 * 전 경로 fail-open(셋업을 죽이지 않음) — 미적용이면 다음 부팅의 sandboxBootAdvisory 경고가 OFF 상태를 다시 드러낸다.
 *
 * @module addons/mcp-runtime/first-run
 */
import { ensureSandboxDefaultOnSetup } from './sandbox-bootstrap';

export function applySandboxDefault(envPath: string): { label: string; applied: boolean; reason: string } {
    const r = ensureSandboxDefaultOnSetup(envPath);
    return { label: 'MCP 샌드박스 기본 활성화', applied: r.applied, reason: r.reason };
}
