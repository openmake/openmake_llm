/**
 * ============================================================
 * Cluster Config - 클러스터 설정 로더/세이버
 * ============================================================
 * 파일/환경변수 기반 클러스터 설정 로딩과 기본 설정 파일 생성을
 * 담당합니다.
 *
 * @module cluster/config
 */

import * as fs from 'fs';
import * as path from 'path';
import { ClusterConfig, StaticNode } from './types';
import { SERVER_CONFIG } from '../config/constants';
import { createLogger } from '../utils/logger';

const logger = createLogger('ClusterConfig');

const DEFAULT_CONFIG: ClusterConfig = {
    name: 'llm-cluster',
    discoveryPort: 52415,
    dashboardPort: SERVER_CONFIG.DEFAULT_PORT,
    heartbeatInterval: 5000,
    nodeTimeout: 15000,
    nodes: []
};

// 파일명은 *후방 호환* 위해 유지 — 운영 환경에 .ollama-cluster.json 이 이미 존재할 수 있음.
// 신규 생성 시에도 동일 이름 사용 — 향후 일괄 rename 마이그레이션이 필요하면 별도 PR.
const CONFIG_FILENAME = '.ollama-cluster.json';

export function loadClusterConfig(): ClusterConfig {
    // 설정 파일 찾기: 현재 디렉토리 -> 홈 디렉토리
    const configPaths = [
        path.resolve(process.cwd(), CONFIG_FILENAME),
        path.resolve(__dirname, '../../', CONFIG_FILENAME),
        path.resolve(process.env.HOME || process.env.USERPROFILE || '', CONFIG_FILENAME)
    ];

    for (const configPath of configPaths) {
        if (fs.existsSync(configPath)) {
            try {
                const content = fs.readFileSync(configPath, 'utf-8');
                const fileConfig = JSON.parse(content) as Partial<ClusterConfig>;
                return { ...DEFAULT_CONFIG, ...fileConfig };
            } catch (e) {
                logger.warn(`설정 파일 파싱 실패: ${configPath}`, e);
            }
        }
    }

    // 환경변수에서 정적 노드 추가
    const envNodes = process.env.OLLAMA_CLUSTER_NODES;
    if (envNodes) {
        const nodes = parseNodesFromEnv(envNodes);
        return { ...DEFAULT_CONFIG, nodes };
    }

    // .env 파일에서 OLLAMA_BASE_URL 사용 (legacy — Ollama 시절 호환)
    const baseUrl = process.env.OLLAMA_BASE_URL;
    if (baseUrl) {
        try {
            const url = new URL(baseUrl);
            const node: StaticNode = {
                host: url.hostname,
                port: parseInt(url.port) || 11434,
                name: 'primary'
            };
            return { ...DEFAULT_CONFIG, nodes: [node] };
        } catch (e) {
            // URL 파싱 실패
        }
    }

    // .env 의 LLM_BASE_URL 사용 — vLLM/LiteLLM 마이그레이션 (2026-05) 이후 표준 endpoint.
    // OLLAMA_* 가 모두 미설정인 운영 환경에서 cluster nodes 0개로 503 폭발하는 것을 막음.
    const llmBaseUrl = process.env.LLM_BASE_URL;
    if (llmBaseUrl) {
        try {
            const url = new URL(llmBaseUrl);
            const node: StaticNode = {
                host: url.hostname,
                port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
                name: 'llm-proxy',
            };
            return { ...DEFAULT_CONFIG, nodes: [node] };
        } catch (e) {
            // URL 파싱 실패 — DEFAULT_CONFIG (빈 nodes) 폴백
        }
    }

    return DEFAULT_CONFIG;
}

function parseNodesFromEnv(envNodes: string): StaticNode[] {
    // 형식: "host1:port1,host2:port2,..."
    return envNodes.split(',').map(nodeStr => {
        const [host, portStr] = nodeStr.trim().split(':');
        return {
            host,
            port: parseInt(portStr) || 11434
        };
    }).filter(n => n.host);
}

export function saveClusterConfig(config: ClusterConfig, filePath?: string): void {
    const targetPath = filePath || path.resolve(process.cwd(), CONFIG_FILENAME);
    fs.writeFileSync(targetPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function createDefaultConfigFile(): string {
    const configPath = path.resolve(process.cwd(), CONFIG_FILENAME);

    // 기본 노드 설정 우선순위:
    //   1. LLM_BASE_URL (vLLM/LiteLLM, 2026-05 마이그레이션 후 표준)
    //   2. OLLAMA_DEFAULT_HOST/PORT (legacy 호환)
    //   3. 빈 배열 (사용자가 직접 설정)
    let defaultHost = 'localhost';
    let defaultPort = 8001;
    let defaultNodeName = 'llm-proxy';

    const llmBaseUrl = process.env.LLM_BASE_URL;
    if (llmBaseUrl) {
        try {
            const url = new URL(llmBaseUrl);
            defaultHost = url.hostname;
            defaultPort = parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80);
        } catch {
            // 파싱 실패 시 legacy 폴백으로
        }
    } else if (process.env.OLLAMA_DEFAULT_HOST) {
        defaultHost = process.env.OLLAMA_DEFAULT_HOST;
        defaultPort = parseInt(process.env.OLLAMA_DEFAULT_PORT || '11434');
        defaultNodeName = process.env.OLLAMA_DEFAULT_NODE_NAME || 'primary';
    }

    const defaultWithExample: ClusterConfig = {
        ...DEFAULT_CONFIG,
        nodes: defaultHost !== 'localhost' ? [
            { host: defaultHost, port: defaultPort, name: defaultNodeName }
        ] : [] // env 미설정 시 빈 배열 (사용자가 직접 설정)
    };

    saveClusterConfig(defaultWithExample, configPath);
    return configPath;
}
