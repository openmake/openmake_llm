/**
 * Agent Types & Interfaces
 * 산업별 에이전트 타입 정의 (industry-agents.json — 18 카테고리 / 100 에이전트)
 */

import { createLogger } from '../utils/logger';
import { loadAddonAgentCategories } from '../addon-host/pack-data';

const logger = createLogger('Agents');

// 에이전트 페이즈 (작업 단계)
export type AgentPhase = 'planning' | 'build' | 'optimization';

// 에이전트 정보 인터페이스
export interface Agent {
    id: string;
    name: string;
    /** 영어 표시 이름 — 한국어 외 UI 의 에이전트·스킬 칩용(name 은 한국어) */
    nameEn?: string;
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

    // 에이전트 정의는 켜진 add-on 이 싣는다(매니페스트 components.agents) — 없으면 general 만으로 동작한다
    try {
        cachedIndustryData = loadAddonAgentCategories<AgentCategory>();
        return cachedIndustryData;
    } catch (e) {
        logger.error('add-on 에이전트 정의 로드 실패:', e);
        return {};
    }
}

