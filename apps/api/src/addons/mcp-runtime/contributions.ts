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
    settings: [
        // MCP-3 전송·엔드포인트 퇴역 안내(기본 OFF) — 응답에 transportNotice 를 붙일 뿐 연결 동작은 바꾸지 않는다.
        { key: 'MCP_TRANSPORT_DEPRECATION_NOTICES', group: 'agent', secret: false, requiresRestart: false, validate: 'boolean' },
        // MCP-3 카탈로그 이전 판 이관(기본 OFF) — 부팅 때 관리자가 고치지 않은 행만 팩의 지금 판으로 바꾼다.
        { key: 'MCP_CATALOG_SUPERSEDE_MIGRATE', group: 'agent', secret: false, requiresRestart: true, validate: 'boolean' },
        // MCP-4 CIMD(기본 OFF) — 공개 HTTPS origin 이 있을 때만, CIMD 를 광고하는 인가 서버에 동적 등록 없이 로그인한다.
        { key: 'MCP_OAUTH_CIMD_ENABLED', group: 'agent', secret: false, requiresRestart: false, validate: 'boolean' },
    ],
};
