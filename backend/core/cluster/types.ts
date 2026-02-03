// 클러스터 노드 타입 정의

export interface ClusterNode {
    id: string;
    name: string;
    host: string;
    port: number;
    status: 'online' | 'offline' | 'busy' | 'unknown';
    models: string[];
    resources: NodeResources;
    lastSeen: Date;
    latency?: number; // ms
}

export interface NodeResources {
    cpuUsage?: number;      // 0-100%
    memoryTotal?: number;   // bytes
    memoryUsed?: number;    // bytes
    gpuName?: string;
    gpuMemory?: number;     // bytes
}

export interface ClusterConfig {
    name: string;
    discoveryPort: number;
    dashboardPort: number;
    heartbeatInterval: number;  // ms
    nodeTimeout: number;        // ms
    nodes: StaticNode[];
}

export interface StaticNode {
    host: string;
    port: number;
    name?: string;
}

export interface ClusterStats {
    totalNodes: number;
    onlineNodes: number;
    totalModels: number;
    uniqueModels: string[];
}

export interface InferenceRequest {
    id: string;
    model: string;
    prompt: string;
    options?: Record<string, unknown>;
    timestamp: Date;
}

export interface NodeMessage {
    type: 'heartbeat' | 'discover' | 'announce' | 'status';
    nodeId: string;
    payload: unknown;
    timestamp: number;
}

// 이벤트 타입
export type ClusterEvent =
    | { type: 'node:online'; node: ClusterNode }
    | { type: 'node:offline'; nodeId: string }
    | { type: 'node:updated'; node: ClusterNode }
    | { type: 'model:available'; model: string; nodes: string[] };
