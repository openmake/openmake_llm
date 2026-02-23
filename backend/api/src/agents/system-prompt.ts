/**
 * ============================================================
 * 시스템 프롬프트 생성 모듈
 * ============================================================
 *
 * 에이전트 선택 결과에 따른 시스템 프롬프트를 생성한다.
 * 스킬 주입 우선순위:
 *   1. DB 스킬 (agent_skills 테이블) - skill-seeder로 자동 등록된 전문 지침
 *   2. 파일 기반 프롬프트 (prompts/{category}/{id}.md) - DB 스킬 없을 때 폴백
 *
 * DB 스킬이 존재하면 파일 기반 로딩을 건너뛰어 콘텐츠 중복을 방지한다.
 *
 * @module agents/system-prompt
 */
import * as fs from 'fs';
import * as path from 'path';
import { AgentSelection, AgentPhase } from './types';
import { AGENTS } from './agent-data';
import { createLogger } from '../utils/logger';
import { getSkillManager } from './skill-manager';
const logger = createLogger('AgentSystem');

// ========================================
// 시스템 프롬프트 생성
// ========================================

/**
 * 에이전트 선택 결과에 따른 시스템 프롬프트 생성
 *
 * 스킬 주입 우선순위:
 * 1. DB 스킬 (skill-seeder로 자동 등록된 전문 지침) - 있으면 파일 로딩 생략
 * 2. 파일 기반 프롬프트 (DB 스킬 없을 때 폴백)
 *    - 카테고리별 하위 폴더: prompts/{category}/{agent-id}.md (우선)
 *    - 루트 폴더: prompts/{agent-id}.md (폴백 - 하위 호환성)
 *
 * @param selection - routeToAgent() 결과의 에이전트 선택 정보
 * @param userId - 사용자 ID (개인 스킬 포함 여부 결정)
 * @returns {Promise<string>} - 조합된 시스템 프롬프트 문자열
 */
export async function getAgentSystemMessage(selection: AgentSelection, userId?: string): Promise<string> {
    const agent = AGENTS[selection.primaryAgent];
    if (!agent) {
        return getDefaultSystemPrompt();
    }

    // 시스템 프롬프트 기본 구조 생성
    const basePrompt = `# ${agent.emoji} ${agent.name}
## 역할
당신은 **${agent.name}** 전문가입니다.
${agent.description}
${agent.keywords.map(k => `- ${k}`).join('\n')}
현재 **${getPhaseLabel(selection.phase)}** 단계에서 작업하고 있습니다.
## 응답 지침
1. 전문 분야에 맞는 정확하고 실용적인 답변을 제공합니다.
2. 구체적인 예시와 함께 설명합니다.
3. 필요한 경우 추가 질문을 통해 요구사항을 명확히 합니다.
4. 한국어로 친절하고 전문적으로 응답합니다.
`;

    let result = basePrompt;

    // 1. DB 스킬 주입 시도 (최우선 - skill-seeder로 자동 등록된 전문 지침)
    let hasDbSkills = false;
    try {
        const skillPrompt = await getSkillManager().buildSkillPrompt(agent.id, userId);
        if (skillPrompt) {
            result += skillPrompt;
            hasDbSkills = true;
            logger.info(`DB 스킬 주입됨: ${agent.name} (${agent.id})`);
        }
    } catch (e) {
        logger.warn(`DB 스킬 주입 실패: ${agent.name}`, e);
    }

    // 2. 파일 기반 프롬프트 로딩 (DB 스킬 없을 때만 - 중복 방지)
    if (!hasDbSkills) {
        let promptPath = '';
        // 1단계: 카테고리별 하위 폴더 확인 (우선)
        if (agent.category) {
            const categoryPath = path.join(__dirname, 'prompts', agent.category, `${agent.id}.md`);
            if (fs.existsSync(categoryPath)) {
                promptPath = categoryPath;
            }
        }

        // 2단계: 루트 폴더 확인 (폴백 - 하위 호환성)
        if (!promptPath) {
            const rootPath = path.join(__dirname, 'prompts', `${agent.id}.md`);
            if (fs.existsSync(rootPath)) {
                promptPath = rootPath;
            }
        }

        try {
            if (promptPath && fs.existsSync(promptPath)) {
                const customPrompt = fs.readFileSync(promptPath, 'utf-8');
                if (customPrompt) {
                    result += `\n\n## 상세 지침\n${customPrompt}`;
                    logger.info(`파일 프롬프트 로드 성공: ${agent.name} (${promptPath})`);
                }
            }
        } catch (e) {
            logger.warn(`파일 프롬프트 로드 실패: ${agent.name}`, e);
        }
    }
    return result;
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
당신은 다양한 분야의 질문에 도움을 줌 수 있는 범용 AI 어시스턴트입니다.

## 응답 지침
1. 정확하고 도움이 되는 답변을 제공합니다.
2. 모르는 내용은 솔직하게 인정합니다.
3. 한국어로 친절하게 응답합니다.
`;
}
