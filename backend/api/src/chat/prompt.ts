/**
 * ============================================================
 * System Prompt - 시스템 프롬프트 생성 및 에이전트 역할 페르소나 정의
 * ============================================================
 * 
 * 12개 역할별 시스템 프롬프트(PromptType)를 정의하고,
 * 질문 분석 기반 자동 역할 감지, 프롬프트 캐싱, 사용자 설정 적용 기능을 제공합니다.
 * 이 모듈은 ChatService의 핵심 입력인 시스템 프롬프트를 생성하는 파이프라인의 최종 단계입니다.
 * 
 * @module chat/prompt
 * @description
 * - 12개 역할별 시스템 프롬프트 정의 (assistant, reasoning, coder, reviewer, explainer, 
 *   generator, agent, writer, researcher, translator, consultant, security)
 * - getEnhancedBasePrompt(): 공통 기반 프롬프트 (지식 기준일, 인식적 구배, 언어 규칙, 안전 가드레일)
 * - detectPromptType(): 가중치 기반 스코어링으로 질문에 최적화된 역할 자동 감지
 * - buildSystemPrompt(): 기반 프롬프트 + 역할 프롬프트 조합
 * - getToolCallingPrompt(): 에이전트용 도구 목록 포맷팅
 * - PromptCache: TTL 기반 프롬프트 캐싱 (5분, 최대 50개)
 * - UserPromptConfig: 사용자 커스텀 설정 (temperature, 접두/접미사 등) 적용
 * 
 * 프롬프트 생성 파이프라인:
 * detectPromptType() -> getEnhancedBasePrompt() + SYSTEM_PROMPTS[type] -> buildSystemPrompt()
 * 
 * @see chat/context-engineering.ts - 4-Pillar Framework 기반 프롬프트 빌더

 * @see services/ChatService.ts - 이 모듈의 출력을 소비하여 LLM에 전달
 */

import { ModelOptions, ToolDefinition } from '../ollama/types';
import { LLM_TEMPERATURES, LLM_TOP_P, MODEL_PRESETS } from '../config/llm-parameters';
import {
    createDynamicMetadata,
    buildAssistantPrompt,
    buildCoderPrompt,
    buildReasoningPrompt
} from './context-engineering-presets';
import { resolvePromptLocale } from './language-policy';
import { resolveBasePromptLang, buildBasePrompt } from './prompt-locales';
import type { PromptLanguageCode } from './prompt-locales';
export type { PromptLanguageCode } from './prompt-locales';

// Re-export types from prompt-types
export type { UserPromptConfig } from './prompt-types';
import type { UserPromptConfig } from './prompt-types';

// Re-export from prompt-templates (values + types separated)
export { SYSTEM_PROMPTS, PromptCache, detectPromptType } from './prompt-templates';
export type { PromptType } from './prompt-templates';
import { SYSTEM_PROMPTS, PromptCache, detectPromptType } from './prompt-templates';
import { getLocalizedSystemPrompt } from './prompt-templates';
import type { PromptType } from './prompt-templates';

/**
 * 동적 메타데이터를 포함한 공통 기반 프롬프트를 생성합니다.
 * 
 * 모든 역할별 프롬프트에 공통으로 적용되는 기반 규칙을 포함합니다:
 * 1. 지식 기준 시점 및 환각 방지 (Knowledge Cutoff)
 * 2. 인식적 구배 (Epistemic Gradient) - 확실성 수준 구분
 * 3. 언어 및 보안 절대 규칙 (한국어/영어 일관성)
 * 4. 안전 및 윤리 가드레일 (Jailbreak 방어, PII 보호)
 * 5. 소프트 인터락 (답변 전 사고 프로세스)
 * 6. 응답 품질 지침 (서술형 스타일)
 * 7. 마크다운 형식 지침
 * 
 * @returns 공통 기반 시스템 프롬프트 문자열 (metadata + system_rules + instruction 섹션)
 */

export function getEnhancedBasePrompt(userLanguage: string = 'en'): string {
    const lang = resolveBasePromptLang(userLanguage);
    const metadata = createDynamicMetadata('', 'en');
    return buildBasePrompt(lang, metadata);
}

export const COMMON_BASE_PROMPT = getEnhancedBasePrompt('en');

// ============================================================
// Gemini 최적화 파라미터 설정
// ============================================================

export const GEMINI_PARAMS = {
    NON_REASONING: {
        temperature: LLM_TEMPERATURES.GEMINI_NON_REASONING,
        top_p: LLM_TOP_P.GEMINI_DEFAULT,
        do_sample: false
    },
    REASONING: {
        temperature: LLM_TEMPERATURES.GEMINI_REASONING,
        top_p: LLM_TOP_P.GEMINI_REASONING,
        do_sample: true
    },
    KOREAN: {
        temperature: LLM_TEMPERATURES.GEMINI_KOREAN,
        top_p: LLM_TOP_P.GEMINI_DEFAULT
    },
    ANTI_DEGENERATION: {
        presence_penalty: LLM_TOP_P.ANTI_DEGENERATION_PRESENCE_PENALTY
    },
    CODE: {
        temperature: LLM_TEMPERATURES.GEMINI_CODE,
        top_p: LLM_TOP_P.GEMINI_DEFAULT
    }
};

export const promptCache = new PromptCache();

// ============================================================
// 🆕 사용자 설정을 적용한 프롬프트 생성
// ============================================================

/**
 * 사용자 설정을 적용한 시스템 프롬프트를 생성합니다.
 * 캐시된 기본 프롬프트에 사용자 접두/접미사를 추가합니다.
 * 
 * @param type - 프롬프트 역할 유형 (기본: 'assistant')
 * @param config - 사용자 커스텀 설정
 * @returns 사용자 설정이 적용된 시스템 프롬프트
 */
export function buildSystemPromptWithConfig(
    type: PromptType = 'assistant',
    config: UserPromptConfig = {},
    userLanguage: string = 'en'
): string {
    // 커스텀 접두사
    let prompt = config.customPrefix ? `${config.customPrefix}\n\n` : '';

    // 기본 프롬프트 (캐시 또는 생성)
    let basePrompt = promptCache.get(type, true, userLanguage);
    if (!basePrompt) {
        basePrompt = buildSystemPrompt(type, true, userLanguage);
        promptCache.set(type, true, basePrompt, userLanguage);
    }
    prompt += basePrompt;

    // 커스텀 접미사
    if (config.customSuffix) {
        prompt += `\n\n${config.customSuffix}`;
    }

    return prompt;
}

/**
 * 사용자 설정을 적용한 모델 옵션 프리셋을 반환합니다.
 * 
 * @param type - 프롬프트 역할 유형
 * @param config - 사용자 커스텀 설정 (temperature, maxTokens 오버라이드)
 * @returns 사용자 설정이 반영된 ModelOptions
 */
export function getPresetWithUserConfig(
    type: PromptType,
    config: UserPromptConfig = {}
): ModelOptions {
    const basePreset = getPresetForPromptType(type);

    return {
        ...basePreset,
        ...(config.temperature !== undefined && { temperature: config.temperature }),
        ...(config.maxTokens !== undefined && { num_predict: config.maxTokens })
    };
}

// ============================================================
// 프롬프트 유틸리티 함수
// ============================================================

/**
 * 시스템 프롬프트를 빌드합니다.
 * includeBase=true이면 공통 기반 프롬프트(COMMON_BASE_PROMPT) + 역할 프롬프트를 조합합니다.
 * 
 * @param type - 프롬프트 역할 유형 (기본: 'assistant')
 * @param includeBase - 공통 기반 프롬프트 포함 여부 (기본: true)
 * @returns 조합된 시스템 프롬프트 문자열
 */
export function buildSystemPrompt(type: PromptType = 'assistant', includeBase: boolean = true, userLanguage: string = 'en'): string {
    // Use language-aware prompt builders for supported types
    const promptLocale = resolvePromptLocale(userLanguage);
    if (includeBase) {
        let rolePrompt: string;
        switch (type) {
            case 'assistant':
                rolePrompt = buildAssistantPrompt(promptLocale);
                return rolePrompt;
            case 'coder':
                rolePrompt = buildCoderPrompt(promptLocale);
                return rolePrompt;
            case 'reasoning':
                rolePrompt = buildReasoningPrompt(promptLocale);
                return rolePrompt;
            default:
                // Fallback to original static prompts for other types
                return `${getEnhancedBasePrompt(userLanguage)}

## 🤖 ${getRoleLabel(userLanguage)}: ${getPromptTypeDescription(type, userLanguage)}

${getLocalizedSystemPrompt(type, userLanguage)}`;
        }
    }
    return getLocalizedSystemPrompt(type, userLanguage);
}

/**
 * 기반 프롬프트가 포함된 전체 시스템 프롬프트를 반환합니다.
 * buildSystemPrompt(type, true)의 단축 함수입니다.
 * 
 * @param type - 프롬프트 역할 유형 (기본: 'assistant')
 * @returns 전체 시스템 프롬프트
 */
export function getSystemPrompt(type: PromptType = 'assistant', userLanguage: string = 'en'): string {
    return buildSystemPrompt(type, true, userLanguage);
}

/**
 * 역할별 특화 프롬프트만 반환합니다 (기반 프롬프트 미포함).
 * 
 * @param type - 프롬프트 역할 유형
 * @returns 역할 특화 프롬프트 문자열
 */
export function getModeSpecificPrompt(type: PromptType): string {
    return SYSTEM_PROMPTS[type];
}

/**
 * 프롬프트 역할에 적합한 모델 옵션 프리셋을 반환합니다.
 * reasoning/researcher/consultant -> GEMINI_REASONING, coder/generator -> GEMINI_CODE 등.
 * 
 * @param type - 프롬프트 역할 유형
 * @returns 역할에 최적화된 ModelOptions
 */
export function getPresetForPromptType(type: PromptType): ModelOptions {
    switch (type) {
        case 'reasoning':
        case 'researcher':
        case 'consultant':
            return MODEL_PRESETS.GEMINI_REASONING;
        case 'coder':
        case 'generator':
            return MODEL_PRESETS.GEMINI_CODE;
        case 'reviewer':
        case 'security':
            return {
                ...MODEL_PRESETS.GEMINI_CODE,
                temperature: LLM_TEMPERATURES.REVIEWER,
                repeat_penalty: 1.15
            };
        case 'explainer':
        case 'writer':
        case 'translator':
            return {
                ...MODEL_PRESETS.GEMINI_DEFAULT,
                temperature: LLM_TEMPERATURES.EXPLAINER
            };
        case 'agent':
            return MODEL_PRESETS.GEMINI_REASONING;
        case 'assistant':
        default:
            return MODEL_PRESETS.GEMINI_REASONING;
    }
}

/**
 * 해당 역할이 Thinking 모드를 사용해야 하는지 판단합니다.
 * 현재 reasoning, reviewer 역할만 Thinking 모드가 활성화됩니다.
 * 
 * @param type - 프롬프트 역할 유형
 * @returns Thinking 모드 활성화 여부
 */
export function shouldUseThinking(type: PromptType): boolean {
    return ['reasoning', 'reviewer'].includes(type);
}

/**
 * 질문에 대한 전체 프롬프트 설정을 한 번에 반환합니다.
 * detectPromptType() + getSystemPrompt() + getPresetForPromptType() + shouldUseThinking()을 조합합니다.
 * 
 * @param question - 사용자 질문 텍스트
 * @returns 역할 유형, 시스템 프롬프트, 모델 옵션, Thinking 모드 여부
 */
export function getPromptConfig(question: string, userLanguage?: string): {
    type: PromptType;
    systemPrompt: string;
    options: ModelOptions;
    enableThinking: boolean;
} {
    const type = detectPromptType(question);
    const language = userLanguage || 'en';
    return {
        type,
        systemPrompt: getSystemPrompt(type, language),
        options: getPresetForPromptType(type),
        enableThinking: shouldUseThinking(type)
    };
}

/**
 * 에이전트 역할에 도구 목록을 포맷팅하여 시스템 프롬프트를 생성합니다.
 * agent 역할 프롬프트 + 도구 정의(이름, 설명, 파라미터)를 마크다운 형식으로 조합합니다.
 * 
 * @param tools - 사용 가능한 도구 정의 배열
 * @returns 도구 목록이 포함된 에이전트 시스템 프롬프트
 */
export function getToolCallingPrompt(tools: ToolDefinition[]): string {
    const toolDefs = tools.map(t => {
        const params = t.function.parameters?.properties
            ? Object.entries(t.function.parameters.properties)
                .map(([k, v]: [string, { type: string; description?: string }]) => `      - \`${k}\` (${v.type}): ${v.description}`)
                .join('\n')
            : '      (no parameters)';
        const required = t.function.parameters?.required?.join(', ') || 'none';
        return `### ${t.function.name}\n${t.function.description}\n- **Required**: ${required}\n- **Parameters**:\n${params}`;
    }).join('\n\n');

    return `${SYSTEM_PROMPTS.agent}\n\n## 📦 Available Tools\n\n${toolDefs}`;
}

/**
 * 한국어 1.2B 소형 모델용 파라미터를 반환합니다.
 * 낮은 temperature(0.1)로 일관된 한국어 출력을 보장합니다.
 * 
 * @returns 한국어 소형 모델 최적화 옵션
 */
export function getKorean1_2BParams(): ModelOptions {
    return {
        ...MODEL_PRESETS.GEMINI_DEFAULT,
        temperature: LLM_TEMPERATURES.GEMINI_KOREAN
    };
}

/**
 * 반복 퇴화(Degeneration) 방지 파라미터를 적용합니다.
 * repeat_penalty를 1.5로 설정하여 동일 토큰 반복을 억제합니다.
 * 
 * @param baseOptions - 기본 모델 옵션
 * @returns repeat_penalty가 강화된 모델 옵션
 */
export function getAntiDegenerationParams(baseOptions: ModelOptions): ModelOptions {
    return {
        ...baseOptions,
        repeat_penalty: 1.5
    };
}

/**
 * 사용 가능한 모든 프롬프트 역할 유형을 배열로 반환합니다.
 * 
 * @returns 12개 PromptType 배열
 */
export function getAllPromptTypes(): PromptType[] {
    return Object.keys(SYSTEM_PROMPTS) as PromptType[];
}

function getRoleLabel(userLanguage: string = 'en'): string {
    const labels: Record<PromptLanguageCode, string> = {
        ko: '현재 역할',
        en: 'Current Role',
        ja: '現在の役割',
        zh: '当前角色',
        es: 'Rol Actual',
        de: 'Aktuelle Rolle',
        fr: 'Rôle actuel',
    };
    const language = resolveBasePromptLang(userLanguage);
    return labels[language];
}

/**
 * 프롬프트 역할 유형 설명을 사용자 언어로 반환합니다.
 *
 * @param type - 프롬프트 역할 유형
 * @param userLanguage - 사용자 언어 코드
 * @returns 역할에 대한 언어별 설명 문자열
 */
export function getPromptTypeDescription(type: PromptType, userLanguage: string = 'en'): string {
    const descriptions: Record<PromptLanguageCode, Record<PromptType, string>> = {
        ko: {
            assistant: '기본 어시스턴트 - 일반 대화 및 질문 답변',
            reasoning: '추론 전문가 - 복잡한 문제 해결 및 분석',
            coder: '코드 전문가 - 프로덕션 수준 코드 작성',
            reviewer: '코드 리뷰어 - 철저한 코드 분석 및 개선 제안',
            explainer: '기술 교육자 - 쉽고 명확한 개념 설명',
            generator: '프로젝트 생성기 - 프로젝트 스캐폴딩 및 초기화',
            agent: 'AI 에이전트 - 도구 호출 및 자동화',
            writer: '글쓰기 전문가 - 창의적/논리적 콘텐츠 작성',
            researcher: '정보 분석가 - 객관적 리서치 및 데이터 요약',
            translator: '번역 전문가 - 다국어 번역 및 현지화',
            consultant: '전문 컨설턴트 - 전략 수립 및 솔루션 제안',
            security: '보안 전문가 - 시스템 취약점 분석 및 강화'
        },
        en: {
            assistant: 'General Assistant - Everyday conversation and question answering',
            reasoning: 'Reasoning Specialist - Complex problem solving and analysis',
            coder: 'Code Specialist - Production-grade code implementation',
            reviewer: 'Code Reviewer - Thorough code analysis and improvement guidance',
            explainer: 'Technical Educator - Clear and accessible concept explanation',
            generator: 'Project Generator - Project scaffolding and initialization',
            agent: 'AI Agent - Tool calling and automation',
            writer: 'Writing Specialist - Creative and logical content writing',
            researcher: 'Research Analyst - Objective research and data summarization',
            translator: 'Translation Specialist - Multilingual translation and localization',
            consultant: 'Professional Consultant - Strategy planning and solution proposal',
            security: 'Security Specialist - System vulnerability analysis and hardening'
        },
        ja: {
            assistant: '基本アシスタント - 一般会話と質問応答',
            reasoning: '推論スペシャリスト - 複雑な問題解決と分析',
            coder: 'コードスペシャリスト - 本番レベルのコード実装',
            reviewer: 'コードレビュアー - 徹底したコード分析と改善提案',
            explainer: '技術教育者 - 分かりやすく明確な概念説明',
            generator: 'プロジェクト生成担当 - スキャフォールディングと初期化',
            agent: 'AIエージェント - ツール呼び出しと自動化',
            writer: 'ライティング専門家 - 創造的かつ論理的な文章作成',
            researcher: 'リサーチアナリスト - 客観的な調査とデータ要約',
            translator: '翻訳専門家 - 多言語翻訳とローカライズ',
            consultant: '専門コンサルタント - 戦略立案とソリューション提案',
            security: 'セキュリティ専門家 - システム脆弱性分析と強化'
        },
        zh: {
            assistant: '基础助手 - 通用对话与问答',
            reasoning: '推理专家 - 复杂问题求解与分析',
            coder: '代码专家 - 生产级代码实现',
            reviewer: '代码审查员 - 深度代码分析与改进建议',
            explainer: '技术讲解者 - 清晰易懂的概念说明',
            generator: '项目生成器 - 项目脚手架与初始化',
            agent: 'AI 代理 - 工具调用与自动化',
            writer: '写作专家 - 创意与逻辑内容创作',
            researcher: '研究分析师 - 客观调研与数据总结',
            translator: '翻译专家 - 多语言翻译与本地化',
            consultant: '专业顾问 - 战略制定与解决方案建议',
            security: '安全专家 - 系统漏洞分析与加固'
        },
        es: {
            assistant: 'Asistente general - Conversación general y respuesta a preguntas',
            reasoning: 'Especialista en razonamiento - Resolución y análisis de problemas complejos',
            coder: 'Especialista en código - Implementación de código de nivel producción',
            reviewer: 'Revisor de código - Análisis exhaustivo y propuestas de mejora',
            explainer: 'Educador técnico - Explicación clara y accesible de conceptos',
            generator: 'Generador de proyectos - Estructura inicial e inicialización',
            agent: 'Agente de IA - Llamado de herramientas y automatización',
            writer: 'Especialista en redacción - Escritura creativa y lógica',
            researcher: 'Analista de investigación - Investigación objetiva y resumen de datos',
            translator: 'Especialista en traducción - Traducción multilingüe y localización',
            consultant: 'Consultor profesional - Planificación estratégica y propuesta de soluciones',
            security: 'Especialista en seguridad - Análisis y refuerzo de vulnerabilidades del sistema'
        },
        de: {
            assistant: 'Allgemeiner Assistent - Allgemeine Konversation und Fragenbeantwortung',
            reasoning: 'Spezialist für Schlussfolgerung - Komplexe Problemlösung und Analyse',
            coder: 'Code-Spezialist - Produktionsreife Code-Implementierung',
            reviewer: 'Code-Reviewer - Gründliche Codeanalyse und Verbesserungsvorschläge',
            explainer: 'Technischer Erklärer - Klare und verständliche Konzepterklärung',
            generator: 'Projektgenerator - Projekt-Scaffolding und Initialisierung',
            agent: 'KI-Agent - Tool-Aufrufe und Automatisierung',
            writer: 'Schreibspezialist - Kreatives und logisches Verfassen von Inhalten',
            researcher: 'Research-Analyst - Objektive Recherche und Datenzusammenfassung',
            translator: 'Übersetzungsspezialist - Mehrsprachige Übersetzung und Lokalisierung',
            consultant: 'Professioneller Berater - Strategieplanung und Lösungsvorschläge',
            security: 'Sicherheitsspezialist - Analyse und Härtung von Systemschwachstellen'
        },
        fr: {
            assistant: 'Assistant général - Conversation courante et réponse aux questions',
            reasoning: 'Spécialiste du raisonnement - Résolution et analyse de problèmes complexes',
            coder: 'Spécialiste du code - Implémentation de code de niveau production',
            reviewer: 'Réviseur de code - Analyse approfondie et suggestions d\'amélioration',
            explainer: 'Éducateur technique - Explication claire et accessible des concepts',
            generator: 'Générateur de projets - Scaffolding et initialisation de projets',
            agent: 'Agent IA - Appel d\'outils et automatisation',
            writer: 'Spécialiste de la rédaction - Rédaction créative et logique',
            researcher: 'Analyste de recherche - Recherche objective et synthèse de données',
            translator: 'Spécialiste de la traduction - Traduction multilingue et localisation',
            consultant: 'Consultant professionnel - Planification stratégique et proposition de solutions',
            security: 'Spécialiste en sécurité - Analyse et renforcement des vulnérabilités système'
        },
    };

    const language = resolveBasePromptLang(userLanguage);
    return descriptions[language][type];
}
