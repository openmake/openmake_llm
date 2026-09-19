/**
 * MCP 런타임이 Base 레지스트리에 얹는 기여 — CLI 명령과 첫 실행 셋업 훅 (2026-09-19).
 * 순수 데이터여야 한다(부팅 초기에 읽힌다) — 실제 코드는 `entry` 참조로 늦게 로드된다.
 *
 * @module addons/mcp-runtime/contributions
 */
import type { AddonContribution } from '../../addon-host/contributions';

export const mcpRuntimeContributions: AddonContribution = {
    cliCommands: [
        { name: 'mcp', description: 'MCP 서버 모드로 실행', entry: 'cli-mcp-server#runMcpServerMode' },
    ],
    firstRunHooks: ['first-run#applySandboxDefault'],
};
