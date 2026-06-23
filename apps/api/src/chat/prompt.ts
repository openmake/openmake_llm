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
 * 
 * 프롬프트 생성 파이프라인:
 * detectPromptType() -> getEnhancedBasePrompt() + SYSTEM_PROMPTS[type] -> buildSystemPrompt()
 * 
 * @see chat/context-engineering.ts - 4-Pillar Framework 기반 프롬프트 빌더

 * @see services/ChatService.ts - 이 모듈의 출력을 소비하여 LLM에 전달
 */

import { ModelOptions } from '../llm';
import { PROMPT_TYPE_PRESETS } from '../config/llm-parameters';
import {
    createDynamicMetadata,
    buildAssistantPrompt,
    buildCoderPrompt,
    buildReasoningPrompt
} from './context-engineering-presets';
import { resolvePromptLocale } from './language-policy';
import { resolveBasePromptLang, buildBasePrompt, IDENTITY_GUARD_TEXTS, RESPONSE_DISCIPLINE_TEXTS } from './prompt-locales';
import type { PromptLanguageCode } from './prompt-locales';
export type { PromptLanguageCode } from './prompt-locales';

// Re-export from prompt-templates (values + types separated)
export type { PromptType } from './prompt-templates';
import { detectPromptType } from './prompt-templates';
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

// ============================================================
// 프롬프트 유틸리티 함수
// ============================================================

/**
 * 정체성 가드 — 모든 페르소나 공통으로 prepend 되는 hard guard.
 * qwen 등 distillation 학습 모델이 자신을 Google/OpenAI 등으로 환각하는 것을 방지.
 *
 * 명시적 부정문 + 긍정문 결합 (LLM 정체성 환각에 가장 효과적).
 * 브랜드명은 OMK_BRAND_NAME 환경변수 오버라이드 가능 (default: OpenMake.AI).
 */
function getIdentityGuard(userLanguage: string): string {
    const brand = process.env.OMK_BRAND_NAME || 'OpenMake.AI';
    const locale = resolvePromptLocale(userLanguage);
    // 2026-05-26 v2: 헤더·라벨 제거 — 모델이 응답에 헤더 텍스트를 echo 하는 사고 차단.
    // 본문은 prompt-locales 로 외부화(No-Hardcoding). {brand} 런타임 치환.
    const text = locale === 'ko' ? IDENTITY_GUARD_TEXTS.ko : IDENTITY_GUARD_TEXTS.en;
    return text.replace(/\{brand\}/g, brand);
}

/**
 * 응답 절제 가드 — 모든 페르소나 공통.
 *
 * 인-세션 verbosity (사용자가 묻지 않은 부가 정보를 자동 첨가하는 LLM 경향) 를
 * 시스템 프롬프트 수준에서 차단. 사용자 직접 가치 외 출력 금지.
 *
 * 도입 배경 (2026-05-26): T1~T9 분석 루프에서 식별된 inter-turn verbosity
 * 문제의 시스템 프롬프트 해결책 (claude.ai 의 Concise style 토글 동등).
 * 사용자별 추가 지시는 `users.custom_instructions` 가 별도 prepend.
 */
function getResponseDiscipline(userLanguage: string): string {
    const locale = resolvePromptLocale(userLanguage);
    // 본문은 prompt-locales 로 외부화(No-Hardcoding). ko 외 언어는 en — 기존 동작 동일.
    return locale === 'ko' ? RESPONSE_DISCIPLINE_TEXTS.ko : RESPONSE_DISCIPLINE_TEXTS.en;
}

/**
 * 외부 provider (Gemini/OpenAI/Anthropic 등) 의 system prompt 조립에 사용할 가드 묶음.
 *
 * 도입 (2026-05-26): `streamFromExternalProvider` 가 자체 조립 흐름을 가져서
 * 내부 buildSystemPrompt 를 거치지 않아 Identity Guard + Response Discipline
 * 가 미적용이던 문제 해결. 외부 모델 (Gemini 등) 도 동일 형식 절제 + 정체성
 * 가드 적용.
 */
export function getExternalProviderSystemGuards(userLanguage: string): string {
    return getIdentityGuard(userLanguage) + getResponseDiscipline(userLanguage);
}

/**
 * 시스템 프롬프트를 빌드합니다.
 * includeBase=true이면 정체성 가드 + 공통 기반 프롬프트 + 역할 프롬프트를 조합합니다.
 *
 * @param type - 프롬프트 역할 유형 (기본: 'assistant')
 * @param includeBase - 공통 기반 프롬프트 포함 여부 (기본: true)
 * @returns 조합된 시스템 프롬프트 문자열
 */
export function buildSystemPrompt(type: PromptType = 'assistant', includeBase: boolean = true, userLanguage: string = 'en'): string {
    // Use language-aware prompt builders for supported types
    const promptLocale = resolvePromptLocale(userLanguage);
    if (includeBase) {
        const guard = getIdentityGuard(userLanguage) + getResponseDiscipline(userLanguage);
        let rolePrompt: string;
        switch (type) {
            case 'assistant':
                rolePrompt = buildAssistantPrompt(promptLocale);
                return guard + rolePrompt;
            case 'coder':
                rolePrompt = buildCoderPrompt(promptLocale);
                return guard + rolePrompt;
            case 'reasoning':
                rolePrompt = buildReasoningPrompt(promptLocale);
                return guard + rolePrompt;
            default:
                // Fallback to original static prompts for other types
                return `${guard}${getEnhancedBasePrompt(userLanguage)}

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
 * 프롬프트 역할에 적합한 모델 옵션 프리셋을 반환합니다.
 * reasoning/researcher/consultant -> GEMINI_REASONING, coder/generator -> GEMINI_CODE 등.
 * 
 * @param type - 프롬프트 역할 유형
 * @returns 역할에 최적화된 ModelOptions
 */
export function getPresetForPromptType(type: PromptType): ModelOptions {
    return PROMPT_TYPE_PRESETS[type] || PROMPT_TYPE_PRESETS['assistant'];
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
