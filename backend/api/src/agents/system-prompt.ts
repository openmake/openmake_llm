/**
 * ============================================================
 * 시스템 프롬프트 생성 모듈
 * ============================================================
 *
 * 에이전트 선택 결과에 따른 시스템 프롬프트를 생성한다.
 *
 * @module agents/system-prompt
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentSelection, AgentPhase } from './types';
import { AGENTS } from './agent-data';

// ========================================
// 시스템 프롬프트 생성
// ========================================

/**
 * 에이전트 선택 결과에 따른 시스템 프롬프트 생성
 *
 * 선택된 에이전트의 정보를 기반으로 LLM에 전달할 시스템 프롬프트를 조합한다.
 * 프롬프트 파일 로드 순서:
 *
 * 1. 카테고리별 하위 폴더: prompts/{category}/{agent-id}.md (우선)
 * 2. 루트 폴더: prompts/{agent-id}.md (폴백 - 하위 호환성)
 *
 * 생성되는 프롬프트 구조:
 * - 역할 정의 (에이전트 이름 + 설명)
 * - 전문 분야 (키워드 목록)
 * - 작업 페이즈 (planning/build/optimization)
 * - 응답 지침 (4가지 기본 규칙)
 * - 상세 지침 (프롬프트 파일이 있는 경우 추가)
 *
 * @param selection - routeToAgent() 결과의 에이전트 선택 정보
 * @returns {string} - 조합된 시스템 프롬프트 문자열
 */
export function getAgentSystemMessage(selection: AgentSelection): string {
    const agent = AGENTS[selection.primaryAgent];
    if (!agent) {
        return getDefaultSystemPrompt();
    }

    // 프롬프트 파일 로드 시도
    // 🆕 1. 카테고리별 하위 폴더 확인 (우선)
    let promptPath = '';

    if (agent.category) {
        const categoryPath = path.join(__dirname, 'prompts', agent.category, `${agent.id}.md`);
        if (fs.existsSync(categoryPath)) {
            promptPath = categoryPath;
        }
    }

    // 🆕 2. 루트 폴더 확인 (폴백 - 하위 호환성)
    if (!promptPath) {
        const rootPath = path.join(__dirname, 'prompts', `${agent.id}.md`);
        if (fs.existsSync(rootPath)) {
            promptPath = rootPath;
        }
    }

    let customPrompt = '';

    try {
        if (promptPath && fs.existsSync(promptPath)) {
            customPrompt = fs.readFileSync(promptPath, 'utf-8');
            console.log(`[Agent System] 프롬프트 로드 성공: ${agent.name} (${promptPath})`);
        }
    } catch (e) {
        console.warn(`[Agent System] 프롬프트 로드 실패: ${agent.name}`, e);
    }

    // 시스템 프롬프트 조합
    const basePrompt = `# ${agent.emoji} ${agent.name}

## 역할
당신은 **${agent.name}** 전문가입니다.
${agent.description}

## 전문 분야
${agent.keywords.map(k => `- ${k}`).join('\n')}

## 작업 페이즈
현재 **${getPhaseLabel(selection.phase)}** 단계에서 작업하고 있습니다.

## 응답 지침
1. 전문 분야에 맞는 정확하고 실용적인 답변을 제공합니다.
2. 구체적인 예시와 함께 설명합니다.
3. 필요한 경우 추가 질문을 통해 요구사항을 명확히 합니다.
4. 한국어로 친절하고 전문적으로 응답합니다.
`;

    if (customPrompt) {
        return `${basePrompt}\n\n## 상세 지침\n${customPrompt}`;
    }

    return basePrompt;
}

/**
 * 작업 페이즈를 한국어 레이블로 변환
 *
 * @param phase - 작업 페이즈 (선택적, 기본값: 'planning')
 * @returns {string} - 한국어 레이블 (기획/분석, 구현/개발, 최적화/개선)
 */
export function getPhaseLabel(phase?: AgentPhase): string {
    const labels: Record<AgentPhase, string> = {
        planning: '기획/분석',
        build: '구현/개발',
        optimization: '최적화/개선'
    };
    return labels[phase || 'planning'];
}

/**
 * 기본 범용 시스템 프롬프트 반환
 *
 * 매칭되는 전문 에이전트가 없을 때 사용되는 범용 AI 어시스턴트 프롬프트.
 *
 * @returns {string} - 범용 AI 어시스턴트 시스템 프롬프트
 */
export function getDefaultSystemPrompt(): string {
    return `# 🤖 범용 AI 어시스턴트

당신은 다양한 분야의 질문에 도움을 줄 수 있는 범용 AI 어시스턴트입니다.

## 응답 지침
1. 정확하고 도움이 되는 답변을 제공합니다.
2. 모르는 내용은 솔직하게 인정합니다.
3. 한국어로 친절하게 응답합니다.
`;
}
