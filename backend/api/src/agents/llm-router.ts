/**
 * ============================================================
 * LLM 기반 에이전트 라우터 - 의미론적 질문 분석 및 에이전트 선택
 * ============================================================
 *
 * 사용자 질문 전체를 LLM으로 분석하여 가장 적합한 전문가 에이전트를
 * 선택하는 의미론적 라우팅 모듈. 키워드 매칭이 아닌 질문의 맥락과
 * 숨겨진 의도까지 파악하여 최적의 에이전트를 결정한다.
 *
 * @module agents/llm-router
 * @description
 * - LLM 기반 의미론적 에이전트 라우팅 (3단계 분석: 의도 -> 도메인 -> 전문성)
 * - 에이전트 요약 정보 생성 및 LLM 프롬프트 포맷팅
 * - JSON 응답 파싱 (코드블록 -> greedy -> non-greedy 3단계 추출)
 * - 타임아웃 기반 폴백 처리 (Promise.race)
 * - 입력 검증 및 새니타이징 (프롬프트 인젝션 방어)
 *
 * @see {@link module:agents/index} - 키워드 폴백 라우팅 및 통합 라우터
 * @see {@link module:agents/monitor} - 라우팅 성능 모니터링
 */

import { OllamaClient } from '../ollama/client';
import { sanitizePromptInput, validatePromptInput } from '../utils/input-sanitizer';
import { Agent, AgentCategory } from './types';
import industryData from './industry-agents.json';

/**
 * LLM 라우팅 결과 인터페이스
 *
 * LLM이 분석한 에이전트 선택 결과를 담는 구조체.
 * 신뢰도와 대안 에이전트 목록을 포함하여 폴백 판단에 활용된다.
 *
 * @interface LLMRoutingResult
 */
export interface LLMRoutingResult {
    /** 선택된 에이전트의 고유 ID (예: 'software-engineer') */
    agentId: string;
    /** LLM이 판단한 선택 신뢰도 (0.0 ~ 1.0, 0.3 미만이면 폴백) */
    confidence: number;
    /** LLM이 제공한 선택 이유 (한 문장) */
    reasoning: string;
    /** 대안 에이전트 ID 목록 (최대 2개) */
    alternativeAgents: string[];
}

/**
 * 에이전트 요약 정보 (LLM 프롬프트 구성용)
 *
 * LLM에게 전달할 에이전트 목록을 간결하게 표현하는 구조체.
 * industry-agents.json에서 추출하여 카테고리별로 그룹화된다.
 *
 * @interface AgentSummary
 */
interface AgentSummary {
    /** 에이전트 고유 ID */
    id: string;
    /** 에이전트 표시 이름 (한국어) */
    name: string;
    /** 소속 카테고리명 */
    category: string;
    /** 에이전트 역할 설명 */
    description: string;
}

/** 전역 OllamaClient 싱글톤 인스턴스 (라우팅 전용) */
let routerClient: OllamaClient | null = null;

/**
 * 라우팅 전용 OllamaClient 싱글톤 반환
 *
 * 라우팅 요청마다 새 클라이언트를 생성하지 않고 단일 인스턴스를 재사용한다.
 * 첫 호출 시 lazy initialization으로 생성된다.
 *
 * @returns {OllamaClient} - 라우팅 전용 Ollama 클라이언트 인스턴스
 */
function getRouterClient(): OllamaClient {
    if (!routerClient) {
        routerClient = new OllamaClient();
    }
    return routerClient;
}

/**
 * 모든 에이전트의 간결한 요약 목록 생성
 *
 * industry-agents.json에서 전체 에이전트를 순회하며
 * LLM 프롬프트에 포함할 요약 정보를 추출한다.
 *
 * @returns {AgentSummary[]} - 전체 에이전트 요약 배열 (카테고리 정보 포함)
 */
export function getAgentSummaries(): AgentSummary[] {
    const summaries: AgentSummary[] = [];

    for (const [categoryId, category] of Object.entries(industryData as Record<string, AgentCategory>)) {
        for (const agent of category.agents) {
            summaries.push({
                id: agent.id,
                name: agent.name,
                category: category.name,
                description: agent.description
            });
        }
    }

    return summaries;
}

/**
 * 에이전트 목록을 LLM 프롬프트용 마크다운 문자열로 변환
 *
 * 에이전트를 카테고리별로 그룹화하여 LLM이 이해하기 쉬운
 * 마크다운 형식으로 포맷팅한다. 각 에이전트는 ID, 이름, 설명을 포함한다.
 *
 * @param summaries - 에이전트 요약 배열 (getAgentSummaries() 결과)
 * @returns {string} - 카테고리별로 그룹화된 마크다운 문자열
 */
function formatAgentListForPrompt(summaries: AgentSummary[]): string {
    // 카테고리별로 그룹화
    const byCategory = new Map<string, AgentSummary[]>();

    for (const agent of summaries) {
        const existing = byCategory.get(agent.category) || [];
        existing.push(agent);
        byCategory.set(agent.category, existing);
    }

    let result = '';
    for (const [category, agents] of byCategory) {
        result += `\n### ${category}\n`;
        for (const agent of agents) {
            result += `- **${agent.id}**: ${agent.name} - ${agent.description}\n`;
        }
    }

    return result;
}

/**
 * LLM 응답에서 JSON 객체 추출 (3단계 파싱 전략)
 *
 * LLM 응답은 JSON 외에 설명 텍스트를 포함할 수 있으므로,
 * 3단계 전략으로 JSON을 추출한다:
 *
 * 1단계: ```json 코드블록 내 JSON 추출 시도
 * 2단계: Greedy 매칭 (가장 바깥 {} 블록 — 중첩 브레이스 대응)
 * 3단계: Non-greedy 폴백 (가장 짧은 {} 블록)
 *
 * @param response - LLM의 원시 응답 문자열
 * @returns {Record<string, unknown> | null} - 파싱된 JSON 객체, 실패 시 null
 */
function extractJSONFromResponse(response: string): Record<string, unknown> | null {
    // 1단계: ```json 코드블록 내 JSON 추출 시도
    const codeBlockMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
        try {
            return JSON.parse(codeBlockMatch[1]);
        } catch {
            // 코드블록 내 파싱 실패 시 다음 단계로
        }
    }

    // 2단계: Greedy 매칭 (중첩 브레이스 대응 — 가장 바깥 {} 블록)
    const greedyMatch = response.match(/\{[\s\S]*\}/);
    if (greedyMatch) {
        try {
            return JSON.parse(greedyMatch[0]);
        } catch {
            // greedy 실패 시 non-greedy 시도
        }
    }

    // 3단계: Non-greedy 폴백 (가장 짧은 {} 블록)
    const lazyMatch = response.match(/\{[\s\S]*?\}/);
    if (lazyMatch) {
        try {
            return JSON.parse(lazyMatch[0]);
        } catch (e) {
            console.log('[LLM Router] JSON 파싱 실패, 응답:', response.substring(0, 200));
            return null;
        }
    }

    return null;
}

/**
 * LLM 기반 에이전트 라우팅 (메인 라우팅 함수)
 *
 * 사용자 메시지를 LLM으로 분석하여 최적의 에이전트를 선택한다.
 * 처리 흐름:
 *
 * 1. 입력 전처리: 긴 메시지 잘라내기 (MAX_ROUTING_INPUT=10000자)
 * 2. 입력 검증: validatePromptInput으로 유효성 검사
 * 3. 입력 새니타이징: sanitizePromptInput으로 프롬프트 인젝션 방어
 * 4. LLM 호출: temperature=0.1 (결정적 응답), num_predict=200 (짧은 응답)
 * 5. 타임아웃 처리: Promise.race로 지정 시간 초과 시 null 반환
 * 6. 응답 파싱: extractJSONFromResponse로 JSON 추출
 * 7. 결과 검증: agent_id 존재 여부 확인
 *
 * @param message - 사용자 입력 메시지
 * @param timeout - LLM 응답 대기 타임아웃 (밀리초, 기본값: 5000)
 * @returns {Promise<LLMRoutingResult | null>} - 라우팅 결과, 실패/타임아웃 시 null
 */
export async function routeWithLLM(
    message: string,
    timeout: number = 5000
): Promise<LLMRoutingResult | null> {
    const client = getRouterClient();
    const summaries = getAgentSummaries();
    const agentList = formatAgentListForPrompt(summaries);

    const systemPrompt = `당신은 AI 에이전트 라우터입니다. 사용자 질문을 분석하여 가장 적합한 전문가를 선택하세요.

## 분석 단계 (반드시 순서대로 수행):
1. **핵심 의도 파악**: 사용자가 원하는 것이 무엇인가?
2. **도메인 식별**: 어떤 분야와 관련된 질문인가?
3. **전문성 유형**: 어떤 종류의 전문가가 필요한가?

## 규칙:
1. 키워드가 아닌 **질문 전체 맥락**을 분석하세요
2. 질문의 **숨겨진 의도**도 파악하세요
3. 가장 적합한 전문가 **1명**을 선택하세요
4. 확신이 없어도 가장 근접한 전문가를 선택하세요

## 사용 가능한 전문가 목록:
${agentList}

## 응답 형식 (반드시 JSON만 출력):
{
  "agent_id": "선택한 에이전트 ID",
  "confidence": 0.0-1.0 사이의 신뢰도,
  "reasoning": "선택 이유 (한 문장)",
  "alternatives": ["대안1 ID", "대안2 ID"]
}`;

    // 🔧 라우팅 목적으로는 메시지 앞부분만 필요 — 긴 문서 입력은 잘라내기
    const MAX_ROUTING_INPUT = 10000;
    const routingInput = message.length > MAX_ROUTING_INPUT ? message.slice(0, MAX_ROUTING_INPUT) : message;

    // Sanitize user input before embedding in prompt
    const validation = validatePromptInput(routingInput);
    if (!validation.valid) {
        console.log('[LLM Router] 입력 검증 실패:', validation.error);
        return null;
    }
    const sanitizedMessage = sanitizePromptInput(routingInput);

    const userPrompt = `<user_message>
${sanitizedMessage}
</user_message>

위 질문에 가장 적합한 전문가를 선택하고 JSON 형식으로만 응답하세요.`;

    try {
        // 타임아웃 설정
        const timeoutPromise = new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), timeout);
        });

        const routingPromise = (async () => {
            const response = await client.chat([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ], {
                temperature: 0.1,  // 결정적인 응답을 위해 낮은 온도
                num_predict: 200   // 짧은 응답만 필요
            });

            return response.content;
        })();

        const result = await Promise.race([routingPromise, timeoutPromise]);

        if (!result) {
            console.log('[LLM Router] 타임아웃 - 폴백 사용');
            return null;
        }

        const parsed = extractJSONFromResponse(result);

        if (parsed && parsed.agent_id) {
            console.log(`[LLM Router] 선택: ${parsed.agent_id} (신뢰도: ${parsed.confidence})`);
            console.log(`[LLM Router] 이유: ${parsed.reasoning}`);

            return {
                agentId: String(parsed.agent_id),
                confidence: Number(parsed.confidence) || 0.85,
                reasoning: String(parsed.reasoning || ''),
                alternativeAgents: Array.isArray(parsed.alternatives) ? parsed.alternatives as string[] : []
            };
        }

        console.log('[LLM Router] 유효하지 않은 응답 형식');
        return null;

    } catch (error) {
        console.error('[LLM Router] 오류:', error);
        return null;
    }
}

/**
 * 에이전트 ID가 유효한지 확인
 *
 * industry-agents.json의 전체 에이전트를 순회하여 해당 ID가 존재하는지 검증한다.
 * 'general' ID는 기본 에이전트로 항상 유효하다.
 *
 * @param agentId - 검증할 에이전트 ID
 * @returns {boolean} - 유효한 에이전트 ID이면 true
 */
export function isValidAgentId(agentId: string): boolean {
    for (const [, category] of Object.entries(industryData as Record<string, AgentCategory>)) {
        for (const agent of category.agents) {
            if (agent.id === agentId) {
                return true;
            }
        }
    }
    return agentId === 'general';
}
