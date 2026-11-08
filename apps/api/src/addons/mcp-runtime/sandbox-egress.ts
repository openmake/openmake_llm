/**
 * MCP 샌드박스 egress 준비 — 사용자 MCP 서버 실행 격리 보강(2026-11-08 점검).
 *
 * 사용자 소유 stdio 서버는 bridge 대신 internal 망 + egress 프록시 경유로 실행한다(sandbox-docker effectiveNetwork).
 * spawn 전에 프록시를 비동기로 보장하고 그 망·URL 을 SandboxConfig.egress 에 실어 돌려준다 — buildSandboxedCommand 는 순수 함수로 남는다.
 * 프록시를 보장하지 못하면 MCP_SANDBOX_EGRESS_REQUIRED 로 거부한다(fail-closed).
 *
 * @module mcp/sandbox-egress
 */
import { ensureEgressProxy, type TaskSandboxConfig } from '../../runtime-ports/egress-proxy-port';
import { getTaskSandboxConfig } from '../../config/task-sandbox';
import {
    defaultSandboxConfig, effectiveNetwork, MCP_SANDBOX_EGRESS_REQUIRED_CODE, MCP_SANDBOX_EGRESS_REQUIRED_MESSAGE,
    type SandboxConfig,
} from './sandbox-docker';
import { createLogger } from '../../utils/logger';

const logger = createLogger('McpSandboxEgress');

type SandboxNetworkInput = Parameters<typeof effectiveNetwork>[0];

/** 진행 중인 보장 하나 — 동시에 여러 사용자 서버가 spawn 될 때 docker rm/run 경쟁을 막는다. 결과는 캐시하지 않는다(죽은 프록시 재기동). */
let inflight: Promise<string> | undefined;

function ensureOnce(cfg: TaskSandboxConfig, ensure: typeof ensureEgressProxy): Promise<string> {
    if (!inflight) {
        inflight = ensure(cfg).finally(() => { inflight = undefined; });
    }
    return inflight;
}

/**
 * egress 대상 서버면 프록시를 보장하고 egress 를 실은 설정을, 아니면 undefined 를 돌려준다
 * (undefined 면 buildSandboxedCommand 가 기본 설정으로 종전 판정 — 꺼짐·docker 부재 거부 포함).
 */
export async function prepareSandboxConfig(
    input: SandboxNetworkInput,
    cfg: SandboxConfig = defaultSandboxConfig(),
    ensure: typeof ensureEgressProxy = ensureEgressProxy,
): Promise<SandboxConfig | undefined> {
    if (!cfg.enabled || !cfg.dockerPath) return undefined;
    if (effectiveNetwork(input, cfg) !== 'egress') return undefined;
    const taskCfg: TaskSandboxConfig = { ...getTaskSandboxConfig(), dockerPath: cfg.dockerPath };
    try {
        const proxyUrl = await ensureOnce(taskCfg, ensure);
        return { ...cfg, egress: { network: taskCfg.egressNetwork, proxyUrl } };
    } catch (e) {
        const cause = e instanceof Error ? e.message : String(e);
        logger.warn(`egress 프록시 보장 실패: ${cause}`);
        throw Object.assign(new Error(`${MCP_SANDBOX_EGRESS_REQUIRED_MESSAGE}: ${cause}`), { code: MCP_SANDBOX_EGRESS_REQUIRED_CODE });
    }
}
