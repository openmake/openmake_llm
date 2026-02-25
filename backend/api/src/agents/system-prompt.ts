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
import { getLanguageTemplate, type SupportedLanguageCode } from '../chat/language-policy';
const logger = createLogger('AgentSystem');

type PromptLanguageCode = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'de';

interface AgentPromptTemplate {
    role: string;
    expertIs: string;
    workingOn: string;
    guidelines: string;
    guidelineItems: [string, string, string];
    detailGuidance: string;
}

const AGENT_PROMPT_TEMPLATES: Record<PromptLanguageCode, AgentPromptTemplate> = {
    ko: {
        role: '역할',
        expertIs: '당신은 **{agent}** 전문가입니다.',
        workingOn: '현재 **{phase}** 단계에서 작업하고 있습니다.',
        guidelines: '응답 지침',
        guidelineItems: [
            '전문 분야에 맞는 정확하고 실용적인 답변을 제공합니다.',
            '구체적인 예시와 함께 설명합니다.',
            '필요한 경우 추가 질문을 통해 요구사항을 명확히 합니다.'
        ],
        detailGuidance: '상세 지침'
    },
    en: {
        role: 'Role',
        expertIs: 'You are an expert in **{agent}**.',
        workingOn: 'You are currently working in the **{phase}** phase.',
        guidelines: 'Response Guidelines',
        guidelineItems: [
            'Provide accurate and practical answers aligned with your specialty.',
            'Explain with concrete examples whenever helpful.',
            'When needed, ask follow-up questions to clarify requirements.'
        ],
        detailGuidance: 'Detailed Instructions'
    },
    ja: {
        role: '役割',
        expertIs: 'あなたは **{agent}** の専門家です。',
        workingOn: '現在 **{phase}** フェーズで作業しています。',
        guidelines: '応答ガイドライン',
        guidelineItems: [
            '専門分野に沿った正確で実用的な回答を提供してください。',
            '必要に応じて、具体例を添えて説明してください。',
            '必要な場合は、追加質問で要件を明確にしてください。'
        ],
        detailGuidance: '詳細ガイド'
    },
    zh: {
        role: '角色',
        expertIs: '您是 **{agent}** 领域的专家。',
        workingOn: '当前您正在 **{phase}** 阶段工作。',
        guidelines: '回复指南',
        guidelineItems: [
            '提供符合专业领域的准确且实用的回答。',
            '在有帮助时，结合具体示例进行说明。',
            '在必要时，通过补充提问明确需求。'
        ],
        detailGuidance: '详细说明'
    },
    es: {
        role: 'Rol',
        expertIs: 'Usted es especialista en **{agent}**.',
        workingOn: 'Actualmente está trabajando en la fase de **{phase}**.',
        guidelines: 'Guías de Respuesta',
        guidelineItems: [
            'Proporcione respuestas precisas y prácticas, acordes con su especialidad.',
            'Explique con ejemplos concretos cuando sea útil.',
            'Si es necesario, formule preguntas de seguimiento para aclarar los requisitos.'
        ],
        detailGuidance: 'Instrucciones Detalladas'
    },
    de: {
        role: 'Rolle',
        expertIs: 'Sie sind ein Experte fur **{agent}**.',
        workingOn: 'Sie arbeiten derzeit in der Phase **{phase}**.',
        guidelines: 'Antwortleitlinien',
        guidelineItems: [
            'Geben Sie prazise und praxisnahe Antworten im Rahmen Ihres Fachgebiets.',
            'Erlautern Sie Inhalte bei Bedarf mit konkreten Beispielen.',
            'Stellen Sie bei Bedarf Ruckfragen, um Anforderungen zu klaren.'
        ],
        detailGuidance: 'Detaillierte Hinweise'
    }
};

const DEFAULT_SYSTEM_PROMPTS: Record<PromptLanguageCode, string> = {
    ko: `# 🤖 범용 AI 어시스턴트
당신은 다양한 분야의 질문에 도움을 줌 수 있는 범용 AI 어시스턴트입니다.

## 응답 지침
1. 정확하고 도움이 되는 답변을 제공합니다.
2. 모르는 내용은 솔직하게 인정합니다.
3. 사용자가 사용한 언어로 친절하게 응답합니다.
`,
    en: `# 🤖 General AI Assistant
You are a general AI assistant who can help with questions across many domains.

## Response Guidelines
1. Provide accurate and helpful answers.
2. Honestly acknowledge what you do not know.
3. Respond politely in the language used by the user.
`,
    ja: `# 🤖 汎用AIアシスタント
あなたは、さまざまな分野の質問を支援できる汎用AIアシスタントです。

## 応答ガイドライン
1. 正確で役立つ回答を提供してください。
2. わからない内容は正直に認めてください。
3. ユーザーが使用した言語で丁寧に回答してください。
`,
    zh: `# 🤖 通用 AI 助手
您是一名能够帮助处理多领域问题的通用 AI 助手。

## 回复指南
1. 提供准确且有帮助的回答。
2. 对不了解的内容请如实说明。
3. 使用用户所使用的语言进行礼貌回复。
`,
    es: `# 🤖 Asistente de IA General
Usted es un asistente de IA general que puede ayudar con preguntas de diversos ambitos.

## Guías de Respuesta
1. Proporcione respuestas precisas y utiles.
2. Reconozca con honestidad lo que no sabe.
3. Responda amablemente en el idioma utilizado por el usuario.
`,
    de: `# 🤖 Allgemeiner KI-Assistent
Sie sind ein allgemeiner KI-Assistent, der bei Fragen aus vielen Bereichen helfen kann.

## Antwortleitlinien
1. Geben Sie genaue und hilfreiche Antworten.
2. Geben Sie ehrlich zu, wenn Sie etwas nicht wissen.
3. Antworten Sie hoflich in der vom Nutzer verwendeten Sprache.
`
};

function resolvePromptLanguage(languageCode: string): PromptLanguageCode {
    const normalized = (languageCode || 'en').toLowerCase().split('-')[0];
    if (normalized === 'ko' || normalized === 'en' || normalized === 'ja' || normalized === 'zh' || normalized === 'es' || normalized === 'de') {
        return normalized;
    }
    return 'en';
}

function applyPromptPlaceholders(template: string, values: Record<string, string>): string {
    return Object.entries(values).reduce((acc, [key, value]) => acc.replace(new RegExp(`\\{${key}\\}`, 'g'), value), template);
}

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
 * @returns {Promise<{ prompt: string; skillNames: string[] }>} - 조합된 프롬프트와 활성 스킬 이름 목록
 */
export async function getAgentSystemMessage(selection: AgentSelection, userId?: string, languageCode: string = 'en'): Promise<{ prompt: string; skillNames: string[] }> {
    const agent = AGENTS[selection.primaryAgent];
    if (!agent) {
        return { prompt: getDefaultSystemPrompt(languageCode), skillNames: [] };
    }

    // 언어별 응답 지침 생성
    const languageTemplate = getLanguageTemplate(languageCode as SupportedLanguageCode);
    const promptLanguage = resolvePromptLanguage(languageCode);
    const promptTemplate = AGENT_PROMPT_TEMPLATES[promptLanguage];
    
    // 시스템 프롬프트 기본 구조 생성
    const basePrompt = `# ${agent.emoji} ${agent.name}
## ${promptTemplate.role}
${applyPromptPlaceholders(promptTemplate.expertIs, { agent: agent.name })}
${agent.description}
${agent.keywords.map(k => `- ${k}`).join('\n')}
${applyPromptPlaceholders(promptTemplate.workingOn, { phase: getPhaseLabel(selection.phase, languageCode) })}
## ${promptTemplate.guidelines}
1. ${promptTemplate.guidelineItems[0]}
2. ${promptTemplate.guidelineItems[1]}
3. ${promptTemplate.guidelineItems[2]}
4. ${languageTemplate.languageRule}
`;

    let result = basePrompt;

    // 1. DB 스킬 주입 시도 (최우선 - skill-seeder로 자동 등록된 전문 지침)
    let hasDbSkills = false;
    const skillNames: string[] = [];
    try {
        const skills = await getSkillManager().getSkillsForAgent(agent.id, userId);
        if (skills.length > 0) {
            for (const s of skills) skillNames.push(s.name);
            const skillPrompt = await getSkillManager().buildSkillPrompt(agent.id, userId);
            if (skillPrompt) {
                result += skillPrompt;
                hasDbSkills = true;
                logger.info(`DB 스킬 주입됨: ${agent.name} (${agent.id}) [${skillNames.join(', ')}]`);
            }
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
                    result += `\n\n## ${promptTemplate.detailGuidance}\n${customPrompt}`;
                    logger.info(`파일 프롬프트 로드 성공: ${agent.name} (${promptPath})`);
                }
            }
        } catch (e) {
            logger.warn(`파일 프롬프트 로드 실패: ${agent.name}`, e);
        }
    }
    return { prompt: result, skillNames };
}

/**
 * 작업 페이즈를 한국어 레이블로 변환
 *
 * @param phase - 작업 페이즈 (선택적, 기본값: 'planning')
 * @returns {string} - 한국어 레이블 (기획/분석, 구현/개발, 최적화/개선)
 */
export function getPhaseLabel(phase?: AgentPhase, languageCode: string = 'ko'): string {
    const promptLanguage = resolvePromptLanguage(languageCode);
    const labels: Record<PromptLanguageCode, Record<AgentPhase, string>> = {
        ko: {
            planning: '기획/분석',
            build: '구현/개발',
            optimization: '최적화/개선'
        },
        en: {
            planning: 'Planning/Analysis',
            build: 'Implementation/Development',
            optimization: 'Optimization/Improvement'
        },
        ja: {
            planning: '企画/分析',
            build: '実装/開発',
            optimization: '最適化/改善'
        },
        zh: {
            planning: '规划/分析',
            build: '实现/开发',
            optimization: '优化/改进'
        },
        es: {
            planning: 'Planificacion/Analisis',
            build: 'Implementacion/Desarrollo',
            optimization: 'Optimizacion/Mejora'
        },
        de: {
            planning: 'Planung/Analyse',
            build: 'Implementierung/Entwicklung',
            optimization: 'Optimierung/Verbesserung'
        }
    };
    return labels[promptLanguage][phase || 'planning'];
}

/**
 * 기본 범용 시스템 프롬프트 반환
 *
 * 매칭되는 전문 에이전트가 없을 때 사용되는 범용 AI 어시스턴트 프롬프트.
 *
 * @returns {string} - 범용 AI 어시스턴트 시스템 프롬프트
 */
export function getDefaultSystemPrompt(languageCode: string = 'en'): string {
    const promptLanguage = resolvePromptLanguage(languageCode);
    return DEFAULT_SYSTEM_PROMPTS[promptLanguage];
}
