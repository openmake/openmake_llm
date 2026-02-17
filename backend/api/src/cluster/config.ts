import * as fs from 'fs';
import * as path from 'path';
import { ClusterConfig, StaticNode } from './types';
import { SERVER_CONFIG } from '../config/constants';

const DEFAULT_CONFIG: ClusterConfig = {
    name: 'ollama-cluster',
    discoveryPort: 52415,
    dashboardPort: SERVER_CONFIG.DEFAULT_PORT,
    heartbeatInterval: 5000,
    nodeTimeout: 15000,
    nodes: []
};

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
                console.warn(`설정 파일 파싱 실패: ${configPath}`);
            }
        }
    }

    // 환경변수에서 정적 노드 추가
    const envNodes = process.env.OLLAMA_CLUSTER_NODES;
    if (envNodes) {
        const nodes = parseNodesFromEnv(envNodes);
        return { ...DEFAULT_CONFIG, nodes };
    }

    // .env 파일에서 OLLAMA_BASE_URL 사용
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

    // 기본 노드 설정: 환경변수 또는 빈 배열 사용
    const defaultHost = process.env.OLLAMA_DEFAULT_HOST || 'localhost';
    const defaultPort = parseInt(process.env.OLLAMA_DEFAULT_PORT || '11434');
    const defaultNodeName = process.env.OLLAMA_DEFAULT_NODE_NAME || 'primary';

    const defaultWithExample: ClusterConfig = {
        ...DEFAULT_CONFIG,
        nodes: defaultHost !== 'localhost' ? [
            { host: defaultHost, port: defaultPort, name: defaultNodeName }
        ] : [] // 환경변수 미설정 시 빈 배열 (사용자가 직접 설정)
    };

    saveClusterConfig(defaultWithExample, configPath);
    return configPath;
}
