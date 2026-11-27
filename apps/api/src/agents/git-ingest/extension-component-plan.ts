/**
 * 확장 구성요소 **고르기** — 설치(extension-components)와 설치 미리보기(M1b, extension-install-preview)가 공유한다.
 * DB·LLM 을 쓰지 않는다. 상한 초과·항목 단위 사유는 ctx.warnings 에 남긴다(설치와 미리보기가 같은 경고를 낸다).
 *
 * @module agents/git-ingest/extension-component-plan
 */
import { discoverMarkdownComponents, findMcpConfigPath } from './extension-discovery';
import { parseMcpJsonFile, type NormalizedMcpServer } from './extension-manifest-validator';
import { ADDON_PERMISSIONS, hasAddonPermission } from '../../config/addon-permissions';
import { EXTENSION_INGEST } from '../../config/constants';
import { PLUGIN_COMPONENT_LIMITS } from '../../config/skill-compat';
import type { ComponentContext } from './extension-components';

/** 설치할 `commands/<name>.md` 경로(상한 적용) — 설치·미리보기 공용. 상한 초과는 ctx.warnings 에 남긴다. */
export function planCommandPaths(ctx: Pick<ComponentContext, 'tree' | 'root' | 'commandPaths' | 'warnings'>): string[] {
    const commandPaths = discoverMarkdownComponents(ctx.tree.entries, ctx.root, 'commands', ctx.commandPaths);
    if (commandPaths.length > PLUGIN_COMPONENT_LIMITS.maxCommands) {
        ctx.warnings.push(`COMMANDS_TRUNCATED: ${commandPaths.length}개 중 ${PLUGIN_COMPONENT_LIMITS.maxCommands}개만 설치`);
        return commandPaths.slice(0, PLUGIN_COMPONENT_LIMITS.maxCommands);
    }
    return commandPaths;
}

/** 설치할 `agents/<name>.md` 경로(상한 적용) — 설치·미리보기 공용. */
export function planAgentPaths(ctx: Pick<ComponentContext, 'tree' | 'root' | 'warnings'>): string[] {
    const agentPaths = discoverMarkdownComponents(ctx.tree.entries, ctx.root, 'agents');
    if (agentPaths.length > PLUGIN_COMPONENT_LIMITS.maxAgents) {
        ctx.warnings.push(`AGENTS_TRUNCATED: ${agentPaths.length}개 중 ${PLUGIN_COMPONENT_LIMITS.maxAgents}개만 설치`);
        return agentPaths.slice(0, PLUGIN_COMPONENT_LIMITS.maxAgents);
    }
    return agentPaths;
}

/**
 * 설치할 MCP 서버 항목(상한 적용) — 설치·미리보기 공용. plugin.json `mcpServers` 우선, 없으면 `mcpServers` 문자열 경로 →
 * 루트 `mcp.json`/`.mcp.json`. 항목 단위 사유는 ctx.warnings 에 남긴다.
 */
export async function planMcpEntries(
    ctx: Pick<ComponentContext, 'fetcher' | 'owner' | 'repo' | 'sha' | 'tree' | 'root' | 'mcpServersPath' | 'warnings'>,
    manifestServers: NormalizedMcpServer[],
): Promise<NormalizedMcpServer[]> {
    let mcpEntries: NormalizedMcpServer[] = manifestServers;
    if (mcpEntries.length === 0) {
        // plugin.json `mcpServers` 문자열 경로 우선, 없으면 루트 mcp.json/.mcp.json
        const mcpJsonPath = findMcpConfigPath(ctx.tree.entries, ctx.root, ctx.mcpServersPath);
        if (ctx.mcpServersPath && !mcpJsonPath) {
            ctx.warnings.push(`MCP_CONFIG_NOT_FOUND: plugin.json 이 가리키는 ${ctx.mcpServersPath} 이(가) 저장소에 없음`);
        }
        if (mcpJsonPath) {
            const mcpRaw = await ctx.fetcher.fetchFile(ctx.owner, ctx.repo, ctx.sha, mcpJsonPath, EXTENSION_INGEST.manifestMaxBytes);
            const parsedMcp = parseMcpJsonFile(mcpRaw);
            // 항목 단위 — 일부 실패해도 나머지는 설치된다 (upstream 의 빈 url placeholder 등)
            if (parsedMcp.errors.length > 0) {
                ctx.warnings.push(`MCP_ENTRIES_SKIPPED: ${parsedMcp.errors.join('; ')}`);
            }
            if (parsedMcp.warnings.length > 0) {
                ctx.warnings.push(`MCP_FIELDS_IGNORED: ${parsedMcp.warnings.join('; ')}`);
            }
            mcpEntries = parsedMcp.servers;
        }
    }
    if (mcpEntries.length > EXTENSION_INGEST.maxMcpServersPerExtension) {
        ctx.warnings.push(`MCP_SERVERS_TRUNCATED: ${mcpEntries.length}개 중 ${EXTENSION_INGEST.maxMcpServersPerExtension}개만 설치`);
        mcpEntries = mcpEntries.slice(0, EXTENSION_INGEST.maxMcpServersPerExtension);
    }
    return mcpEntries;
}

/**
 * add-on 권한 집행 판정 — 허용 권한이 정해진 설치만(deny by default, legacy_unreviewed 는 undefined 라 종전 동작).
 * 네트워크 권한이 없으면 stdio 서버는 `--network none` 샌드박스로 저장하고, 원격(HTTP) 서버는 성립할 수 없어 제외한다.
 * 설치·미리보기 공용.
 */
export function mcpNetworkDecision(ctx: Pick<ComponentContext, 'addonPermissions' | 'blockedPermissions'>): { networkAllowed: boolean; networkNeedsReview: boolean } {
    const enforcePermissions = ctx.addonPermissions !== undefined;
    const networkAllowed = !enforcePermissions || hasAddonPermission(ctx.addonPermissions, ADDON_PERMISSIONS.NETWORK_INTERNET);
    // 요청은 했지만 승인 범위 밖(재승인 필요)인지, 처음부터 요청하지 않았는지 — 안내 문구만 다르다
    const networkNeedsReview = !networkAllowed && !!ctx.blockedPermissions?.includes(ADDON_PERMISSIONS.NETWORK_INTERNET);
    return { networkAllowed, networkNeedsReview };
}
