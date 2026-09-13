/**
 * ============================================================
 * MCP Module Index — 배럴 내보내기
 * ============================================================
 *
 * 라우트·소켓 핸들러가 `import { getUnifiedMCPClient } from '../mcp'` 로 쓰는 진입점.
 * 나머지 MCP 모듈(tool-router·external-client·web-search 등)은 각 파일에서 직접 import 한다.
 *
 * @module mcp
 */

export { getUnifiedMCPClient } from './unified-client';
