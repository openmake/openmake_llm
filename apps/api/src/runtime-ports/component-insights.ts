/**
 * 구성요소 관측 포트 — 구성요소를 저장·실행하는 add-on 이 "이 구성요소가 실제로 어떻게 동작했는지"(연결 방식·인증·선언 확장)를
 * 다른 add-on 에 내주는 일반 문 (M1 갤러리 판정, 2026-11-27).
 *
 * add-on 끼리는 서로 import 하지 않는다(경계 검사). 관측을 가진 add-on 이 부팅 때 등록하고, 읽는 쪽은 이 포트만 안다.
 * 등록이 없으면(그 add-on 이 꺼짐·빌드에 없음) 빈 결과 — 읽는 쪽은 "관측 없음" 으로 다룬다. 조회 실패도 빈 결과(fail-open).
 * 값은 판정용 사실만 담는다 — 주소·명령·토큰·env 는 싣지 않는다.
 *
 * @module runtime-ports/component-insights
 */

/** MCP 서버 한 대의 관측 — 구성요소 종류 이름(mcpServers)은 확장 번들 매니페스트의 어휘다 */
export interface McpServerInsight {
    serverId: string;
    /** 'stdio' | 'sse' | 'streamable-http' */
    transport: string;
    /** 'none' | 'oauth-not-required' | 'oauth-preregistered' | 'oauth-dynamic' | 'oauth-unknown' */
    authMethod: string;
    protocolEra: 'legacy' | 'modern' | null;
    protocolVersion: string | null;
    /** 서버가 선언한 확장의 분류(예: apps·tasks·skills·auth·events·unknown) — 중복 없음 */
    declaredExtensionKinds: string[];
}

export interface ComponentInsightProviders {
    mcpServers?: (serverIds: readonly string[]) => Promise<ReadonlyMap<string, McpServerInsight>>;
}

const providers: ComponentInsightProviders = {};

export function registerComponentInsightProvider<K extends keyof ComponentInsightProviders>(
    kind: K,
    provider: NonNullable<ComponentInsightProviders[K]> | null,
): void {
    if (provider) providers[kind] = provider;
    else delete providers[kind];
}

/** 등록이 없거나 조회가 실패하면 빈 Map */
export async function getMcpServerInsights(serverIds: readonly string[]): Promise<ReadonlyMap<string, McpServerInsight>> {
    const provider = providers.mcpServers;
    if (!provider || serverIds.length === 0) return new Map();
    try {
        return await provider([...new Set(serverIds)]);
    } catch {
        return new Map();
    }
}

/** 테스트용 — 등록을 모두 지운다 */
export function resetComponentInsightProvidersForTest(): void {
    delete providers.mcpServers;
}
