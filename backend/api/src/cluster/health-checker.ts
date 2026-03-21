/**
 * @fileoverview 클러스터 노드 헬스체크 모듈
 *
 * 노드 상태(온라인/오프라인) 확인, 레이턴시 측정, 모델 목록 갱신,
 * 주기적 헬스체크 스케줄링을 담당합니다.
 *
 * @module cluster/health-checker
 */

import { EventEmitter } from 'events';
import { ClusterNode, ClusterEvent } from './types';
import { OllamaClient } from '../ollama/client';

/**
 * 클러스터 노드 헬스체크 담당
 *
 * 주기적으로 모든 노드의 상태를 확인하고 이벤트를 발생시킵니다.
 */
export class HealthChecker {
    /** 헬스체크 타이머 */
    private healthCheckTimer?: NodeJS.Timeout;

    /** 헬스체크 스케줄러 활성 상태 */
    private healthCheckActive: boolean = false;

    constructor(
        private readonly healthCheckIntervalMs: number,
        private readonly emitter: EventEmitter,
        private readonly getNodeEntries: () => Array<{ node: ClusterNode; client: OllamaClient }>
    ) {}

    /**
     * 레이턴시 측정
     *
     * @param client - 측정 대상 Ollama 클라이언트
     * @returns 레이턴시(ms) 또는 Infinity (연결 실패 시)
     */
    async measureLatency(client: OllamaClient): Promise<number> {
        const start = Date.now();
        try {
            await client.isAvailable();
            return Date.now() - start;
        } catch {
            return Infinity;
        }
    }

    /**
     * 노드 상태 업데이트
     *
     * 노드의 온라인/오프라인 상태, 모델 목록, 레이턴시를 갱신합니다.
     * 상태 변경 시 적절한 이벤트를 발생시킵니다.
     *
     * @param node - 업데이트할 노드
     * @param client - 해당 노드의 Ollama 클라이언트
     */
    async updateNodeStatus(node: ClusterNode, client: OllamaClient): Promise<void> {
        const wasOnline = node.status === 'online';
        const isAvailable = await client.isAvailable();

        node.status = isAvailable ? 'online' : 'offline';
        node.lastSeen = isAvailable ? new Date() : node.lastSeen;

        if (isAvailable) {
            // 모델 목록 갱신
            try {
                const response = await client.listModels();
                node.models = response.models.map(m => m.name);
            } catch (e: unknown) {
                console.debug(`[Cluster] ${node.id} 모델 갱신 실패:`, (e instanceof Error ? e.message : String(e)) || e);
            }
            node.latency = await this.measureLatency(client);
        }

        // 상태 변경 이벤트
        if (wasOnline !== isAvailable) {
            if (isAvailable) {
                this.emitter.emit('event', { type: 'node:online', node } as ClusterEvent);
            } else {
                this.emitter.emit('event', { type: 'node:offline', nodeId: node.id } as ClusterEvent);
            }
        } else {
            this.emitter.emit('event', { type: 'node:updated', node } as ClusterEvent);
        }
    }

    /**
     * 모든 노드 헬스체크 수행
     */
    async performHealthCheck(): Promise<void> {
        const entries = this.getNodeEntries();
        await Promise.all(entries.map(({ node, client }) => this.updateNodeStatus(node, client)));
    }

    /**
     * 헬스체크 시작
     */
    start(): void {
        this.healthCheckActive = true;
        this.scheduleNext();
    }

    /**
     * 헬스체크 중지
     */
    stop(): void {
        this.healthCheckActive = false;
        if (this.healthCheckTimer) {
            clearTimeout(this.healthCheckTimer);
            this.healthCheckTimer = undefined;
        }
    }

    /**
     * 다음 헬스체크 스케줄링
     */
    private scheduleNext(): void {
        if (!this.healthCheckActive) {
            return;
        }

        if (this.healthCheckTimer) {
            clearTimeout(this.healthCheckTimer);
        }

        this.healthCheckTimer = setTimeout(async () => {
            try {
                await this.performHealthCheck();
            } finally {
                this.scheduleNext();
            }
        }, this.healthCheckIntervalMs);
    }
}
