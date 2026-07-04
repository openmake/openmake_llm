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

// 매직넘버 금지 — env 오버라이드 지원(미설정 시 기본값).
const DEFAULT_CONFIG: ClusterConfig = {
    name: 'llm-cluster',
    discoveryPort: parseInt(process.env.CLUSTER_DISCOVERY_PORT || '52415', 10),
    dashboardPort: SERVER_CONFIG.DEFAULT_PORT,
    heartbeatInterval: parseInt(process.env.CLUSTER_HEARTBEAT_INTERVAL_MS || '5000', 10),
    nodeTimeout: parseInt(process.env.CLUSTER_NODE_TIMEOUT_MS || '15000', 10),
    nodes: []
};

// 클러스터 정적 노드 설정 파일명.
const CONFIG_FILENAME = '.llm-cluster.json';

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

    // .env 의 LLM_BASE_URL 사용 — vLLM/LiteLLM 표준 endpoint.
    // 다중 노드는 설정 파일 nodes[] 로 지정.
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
        } catch {
            // URL 파싱 실패 — DEFAULT_CONFIG (빈 nodes) 폴백
        }
    }

    return DEFAULT_CONFIG;
}

export function saveClusterConfig(config: ClusterConfig, filePath?: string): void {
    const targetPath = filePath || path.resolve(process.cwd(), CONFIG_FILENAME);
    fs.writeFileSync(targetPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function createDefaultConfigFile(): string {
    const configPath = path.resolve(process.cwd(), CONFIG_FILENAME);

    // 기본 노드 설정 우선순위:
    //   1. LLM_BASE_URL (vLLM/LiteLLM, 2026-05 마이그레이션 후 표준)
    //   2. 빈 배열 (사용자가 직접 설정)
    let defaultHost = 'localhost';
    let defaultPort = 8001;
    const defaultNodeName = 'llm-proxy';

    const llmBaseUrl = process.env.LLM_BASE_URL;
    if (llmBaseUrl) {
        try {
            const url = new URL(llmBaseUrl);
            defaultHost = url.hostname;
            defaultPort = parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80);
        } catch {
            // 파싱 실패 — localhost 기본값 유지
        }
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
