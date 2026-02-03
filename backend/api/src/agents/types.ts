/**
 * Agent Types & Interfaces
 * 96개 산업별 에이전트 타입 정의
 */

import * as fs from 'fs';
import * as path from 'path';

// 에이전트 페이즈 (작업 단계)
export type AgentPhase = 'planning' | 'build' | 'optimization';

// 에이전트 정보 인터페이스
export interface Agent {
    id: string;
    name: string;
    description: string;
    keywords: string[];
    emoji?: string;
    category?: string;
}

// 에이전트 카테고리 인터페이스
export interface AgentCategory {
    icon: string;
    name: string;
    color: string;
    agents: Agent[];
}

// 에이전트 선택 결과 인터페이스
export interface AgentSelection {
    primaryAgent: string;
    category?: string;
    phase?: AgentPhase;
    reason?: string;
    confidence?: number;
    matchedKeywords?: string[];
}

// 에이전트 메트릭 인터페이스
export interface AgentMetrics {
    requestCount: number;
    successCount: number;
    failureCount: number;
    totalResponseTime: number;
    avgResponseTime: number;
    lastUsed?: Date;
}

// 활성 요청 인터페이스
export interface ActiveRequest {
    requestId: string;
    agentType: string;
    startTime: Date;
    message: string;
}

// 산업 에이전트 데이터 타입
export type IndustryAgentsData = Record<string, AgentCategory>;

// 캐시된 데이터
let cachedIndustryData: IndustryAgentsData | null = null;

// 에이전트 데이터 로드
export function getIndustryAgentsData(): IndustryAgentsData {
    if (cachedIndustryData) {
        return cachedIndustryData;
    }

    try {
        const jsonPath = path.join(__dirname, 'industry-agents.json');
        const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
        cachedIndustryData = JSON.parse(jsonContent) as IndustryAgentsData;
        return cachedIndustryData;
    } catch (e) {
        console.error('[Agents] Failed to load industry-agents.json:', e);
        return {};
    }
}

// 전체 에이전트 ID 목록 추출
export function getAllAgentIds(): string[] {
    const data = getIndustryAgentsData();
    const ids: string[] = [];
    for (const category of Object.values(data)) {
        for (const agent of category.agents) {
            ids.push(agent.id);
        }
    }
    return ids;
}

// 카테고리별 에이전트 맵 생성
export function getAgentsByCategory(): Map<string, Agent[]> {
    const data = getIndustryAgentsData();
    const map = new Map<string, Agent[]>();
    for (const [categoryId, category] of Object.entries(data)) {
        const agentsWithCategory = category.agents.map(agent => ({
            ...agent,
            emoji: category.icon,
            category: categoryId
        }));
        map.set(categoryId, agentsWithCategory);
    }
    return map;
}

// 에이전트 ID로 에이전트 찾기
export function findAgentById(agentId: string): Agent | null {
    const data = getIndustryAgentsData();
    for (const [categoryId, category] of Object.entries(data)) {
        const agent = category.agents.find(a => a.id === agentId);
        if (agent) {
            return {
                ...agent,
                emoji: category.icon,
                category: categoryId
            };
        }
    }
    return null;
}
