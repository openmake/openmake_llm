/**
 * 부팅 시 등록되는 기본 훅 (F13.5) — 동작 무변경, 관측만.
 * 느린 도구 호출(SLOW_TOOL_WARN_MS 초과)을 경고 로그로 남긴다. 레퍼런스 구현이기도 하다.
 * @module mcp/default-hooks
 */
import { registerToolHook } from './tool-hooks';
import { MCP_EXTERNAL_TOOL_LIMITS } from '../config/timeouts';
import { createLogger } from '../utils/logger';

const logger = createLogger('ToolHooks');

registerToolHook({
    id: 'audit-timing',
    post: (result, ctx) => {
        const ms = Date.now() - ctx.startedAt;
        if (ms >= MCP_EXTERNAL_TOOL_LIMITS.SLOW_TOOL_WARN_MS) {
            logger.warn(`느린 도구 호출: ${ctx.name} ${ms}ms${result.isError ? ' (오류)' : ''}${ctx.userId ? ` user=${ctx.userId}` : ''}`);
        }
    },
});
