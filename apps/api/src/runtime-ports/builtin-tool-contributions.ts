/**
 * 내장 도구 기여 레지스트리 — add-on 이 Base 의 내장 도구 목록에 도구를 더하는 유일한 통로
 * (Add-on 전환 P1, 2026-09-19).
 *
 * Base 의 `mcp/tools.ts` 는 자기 도구만 알고, add-on 의 도구(`load_skill`·`create_skill`·MCP 메타 도구 등)는
 * 부팅 때 여기에 등록된다. 도구 목록을 상수 배열이 아니라 `getBuiltInTools()` 로 읽는 이유가 이것이다 —
 * 등록은 add-on 부팅 시점이라 import 시점 스냅샷으로는 잡히지 않는다.
 *
 * ⚠️ 이름 충돌은 **먼저 등록된 쪽이 이긴다**(Base 도구가 언제나 먼저). add-on 이 Base 도구를 덮어쓰지 못한다.
 *
 * @module runtime-ports/builtin-tool-contributions
 */
import type { MCPToolDefinition } from '../mcp/types';
import { createLogger } from '../utils/logger';

const logger = createLogger('BuiltinToolContributions');

const contributions = new Map<string, MCPToolDefinition[]>();

/**
 * add-on 이 제공하는 내장 도구를 등록한다. 같은 addonId 로 다시 부르면 그 add-on 의 기여를 교체한다.
 */
export function contributeBuiltInTools(addonId: string, tools: MCPToolDefinition[]): void {
    contributions.set(addonId, tools);
    logger.debug(`add-on '${addonId}' 내장 도구 ${tools.length}개 기여`);
}

/** 테스트 정리용 */
export function resetBuiltInToolContributions(): void {
    contributions.clear();
}

/** 등록된 기여 도구 — 등록 순서대로 평탄화 */
export function contributedBuiltInTools(): MCPToolDefinition[] {
    return [...contributions.values()].flat();
}
