/**
 * ============================================================
 * Discussion Engine - 멀티 에이전트 토론 오케스트레이션 시스템
 * ============================================================
 * 
 * 여러 전문가 에이전트가 주어진 주제에 대해 다라운드 토론을 진행하고,
 * 교차 검토와 팩트체킹을 거쳐 최종 합성 답변을 생성하는 토론 엔진입니다.
 * 컨텍스트 엔지니어링(문서, 대화 히스토리, 메모리, 이미지)을 지원합니다.
 * 
 * @module agents/discussion-engine
 * @description
 * - 5단계 토론 플로우: 전문가 선택 -> 라운드별 토론 -> 교차 검토 -> 사실 검증 -> 최종 합성
 * - 의도 기반 에이전트 선택: 주제 분석 + LLM 라우팅으로 최적 전문가 패널 구성
 * - Deep Thinking 모드: 문제 분해, 다각적 분석, 근거 제시, 반론 고려 프로세스
 * - 우선순위 기반 컨텍스트 구성: 메모리 > 대화 히스토리 > 문서 > 웹 검색 > 이미지
 * - 토큰 제한 관리: 각 컨텍스트 항목별 최대 토큰 할당 + 전체 제한
 * - 실시간 진행 상황 콜백 (onProgress)
 * 
 * 토론 플로우:
 * 1. selectExpertAgents() - 주제에 적합한 전문가 에이전트 2~10명 선택
 * 2. generateAgentOpinion() x N라운드 - 각 전문가가 순차적으로 의견 제시
 * 3. performCrossReview() - 모든 의견의 장단점, 공통점, 차이점 분석
 * 4. (선택) 웹 검색 사실 검증
 * 5. synthesizeFinalAnswer() - 모든 의견과 교차 검토를 종합하여 최종 답변 생성
 * 
 * @see agents/index.ts - 에이전트 정의 및 라우팅
 * @see agents/llm-router.ts - LLM 기반 에이전트 선택
 */

import { getAgentById, Agent, getRelatedAgentsForDiscussion } from './index';
import { sanitizePromptInput } from '../utils/input-sanitizer';
import type { DiscussionConfig, DiscussionProgress, AgentOpinion, DiscussionResult } from './discussion-types';
import { createContextBuilder } from './discussion-context';
import { createLogger } from '../utils/logger';
import { resolvePromptLocale, type PromptLocaleCode } from '../chat/language-policy';

const logger = createLogger('Discussion');

const DISCUSSION_SYSTEM_PROMPTS: Record<PromptLocaleCode, {
    deepThinking: string;
    contextReferenceTitle: string;
    contextReferenceBody: string;
    agentOpinion: (agentName: string, includeDocumentRule: boolean, includeWebRule: boolean) => string;
    crossReview: string;
    finalSynthesis: string;
}> = {
    ko: {
        deepThinking: [
            '## 🧠 Deep Thinking 프로세스 (필수)',
            '분석 전에 반드시 다음 사고 과정을 거쳐야 합니다:',
            '',
            '1. **문제 분해**: 주제의 핵심 요소들을 분리하세요.',
            '2. **다각적 분석**: 기술적, 비즈니스적, 리스크 관점에서 각각 검토하세요.',
            '3. **근거 제시**: 주장에는 반드시 논리적 근거나 사례를 포함하세요.',
            '4. **반론 고려**: 자신의 의견에 대한 반론도 고려하세요.',
            '5. **실행 가능성**: 실제로 적용 가능한 구체적 제안을 하세요.',
            '',
            '응답 시작 전 "💭 Thinking:"으로 핵심 고려사항을 먼저 정리하세요.',
        ].join('\n'),
        contextReferenceTitle: '## 📋 참조 컨텍스트',
        contextReferenceBody: '아래 컨텍스트를 반드시 고려하여 의견을 제시하세요:',
        agentOpinion: (agentName, includeDocumentRule, includeWebRule) => [
            `당신은 **${agentName}** 전문가입니다.`,
            '',
            '## 토론 지침',
            '1. 전문 분야의 관점에서 주제를 **심층적으로** 분석하세요.',
            '2. 구체적이고 실용적인 의견을 제시하세요.',
            '3. 다른 전문가들의 의견이 있다면 보완하거나 다른 시각을 제공하세요.',
            '4. 응답은 300-500자 내외로 충분히 심도있게 작성하세요.',
            `5. ${includeDocumentRule ? '**참조 문서의 내용을 분석에 반영하세요.**' : ''}`,
            `6. ${includeWebRule ? '**웹 검색 결과를 근거로 활용하세요.**' : ''}`,
        ].join('\n'),
        crossReview: [
            '# 🔍 교차 검토 전문가',
            '',
            '당신은 여러 전문가의 의견을 검토하고 종합하는 역할입니다.',
            '',
            '## 검토 지침',
            '1. 각 전문가 의견의 장단점을 분석하세요.',
            '2. 의견들 간의 공통점과 차이점을 파악하세요.',
            '3. 상충되는 의견이 있다면 이유를 설명하세요.',
            '4. 200자 내외로 간결하게 요약하세요.',
        ].join('\n'),
        finalSynthesis: [
            '# 💡 종합 분석가',
            '',
            '당신은 여러 전문가의 의견을 종합하여 최종 답변을 생성하는 역할입니다.',
            '',
            '## 합성 지침',
            '1. 모든 전문가 의견의 핵심을 포함하세요.',
            '2. 논리적인 구조로 정리하세요.',
            '3. 실행 가능한 결론을 제시하세요.',
            '4. 마크다운 형식으로 깔끔하게 작성하세요.',
        ].join('\n'),
    },
    en: {
        deepThinking: [
            '## 🧠 Deep Thinking Process (Required)',
            'Before analyzing, you must go through the following reasoning process:',
            '',
            '1. **Problem Decomposition**: Break down the core elements of the topic.',
            '2. **Multi-perspective Analysis**: Evaluate from technical, business, and risk perspectives.',
            '3. **Evidence**: Support claims with logical evidence or examples.',
            '4. **Counterarguments**: Consider possible counterarguments to your own view.',
            '5. **Practicality**: Provide concrete, actionable suggestions.',
            '',
            'Before your main response, start with "💭 Thinking:" and summarize key considerations.',
        ].join('\n'),
        contextReferenceTitle: '## 📋 Reference Context',
        contextReferenceBody: 'Please provide your opinion while considering the following context:',
        agentOpinion: (agentName, includeDocumentRule, includeWebRule) => [
            `You are an expert in **${agentName}**.`,
            '',
            '## Discussion Guidelines',
            '1. Analyze the topic **in depth** from your domain perspective.',
            '2. Provide concrete and practical opinions.',
            '3. If there are other expert opinions, complement them or add a different viewpoint.',
            '4. Write a sufficiently deep response in about 300-500 characters.',
            `5. ${includeDocumentRule ? '**Incorporate referenced document content into your analysis.**' : ''}`,
            `6. ${includeWebRule ? '**Use web search results as supporting evidence.**' : ''}`,
        ].join('\n'),
        crossReview: [
            '# 🔍 Cross-Review Expert',
            '',
            'You review and synthesize opinions from multiple experts.',
            '',
            '## Review Guidelines',
            '1. Analyze strengths and weaknesses of each expert opinion.',
            '2. Identify commonalities and differences among opinions.',
            '3. If there are conflicting opinions, explain the reasons.',
            '4. Summarize concisely in about 200 characters.',
        ].join('\n'),
        finalSynthesis: [
            '# 💡 Synthesis Analyst',
            '',
            'You synthesize multiple expert opinions into a final answer.',
            '',
            '## Synthesis Guidelines',
            '1. Include key points from all expert opinions.',
            '2. Organize the answer with a logical structure.',
            '3. Provide actionable conclusions.',
            '4. Write clearly using markdown format.',
        ].join('\n'),
    },
    ja: {
        deepThinking: [
            '## 🧠 Deep Thinking プロセス（必須）',
            '分析の前に、必ず次の思考プロセスを踏んでください:',
            '',
            '1. **問題分解**: トピックの主要要素を分解してください。',
            '2. **多面的分析**: 技術・ビジネス・リスクの観点でそれぞれ検討してください。',
            '3. **根拠提示**: 主張には論理的根拠または事例を含めてください。',
            '4. **反論検討**: 自分の意見への反論も考慮してください。',
            '5. **実行可能性**: 実際に適用できる具体的提案を示してください。',
            '',
            '回答前に「💭 Thinking:」で重要な考慮事項を先に整理してください。',
        ].join('\n'),
        contextReferenceTitle: '## 📋 参照コンテキスト',
        contextReferenceBody: '以下のコンテキストを必ず考慮して意見を提示してください:',
        agentOpinion: (agentName, includeDocumentRule, includeWebRule) => [
            `あなたは **${agentName}** の専門家です。`,
            '',
            '## 討論ガイドライン',
            '1. 専門分野の観点からテーマを**深く**分析してください。',
            '2. 具体的で実用的な意見を提示してください。',
            '3. 他の専門家の意見があれば補完するか別の視点を示してください。',
            '4. 回答は300-500文字程度で十分に深く作成してください。',
            `5. ${includeDocumentRule ? '**参照文書の内容を分析に反映してください。**' : ''}`,
            `6. ${includeWebRule ? '**Web検索結果を根拠として活用してください。**' : ''}`,
        ].join('\n'),
        crossReview: [
            '# 🔍 クロスレビュー専門家',
            '',
            'あなたは複数の専門家意見を検討し、統合する役割です。',
            '',
            '## レビュー指針',
            '1. 各専門家意見の長所と短所を分析してください。',
            '2. 意見間の共通点と相違点を把握してください。',
            '3. 対立する意見があれば理由を説明してください。',
            '4. 200文字程度で簡潔に要約してください。',
        ].join('\n'),
        finalSynthesis: [
            '# 💡 総合分析者',
            '',
            'あなたは複数の専門家意見を統合して最終回答を生成する役割です。',
            '',
            '## 統合ガイドライン',
            '1. すべての専門家意見の要点を含めてください。',
            '2. 論理的な構造で整理してください。',
            '3. 実行可能な結論を提示してください。',
            '4. Markdown形式で分かりやすく作成してください。',
        ].join('\n'),
    },
    zh: {
        deepThinking: [
            '## 🧠 深度思考流程（必需）',
            '在分析之前，必须经过以下思考过程：',
            '',
            '1. **问题拆解**：拆分主题的核心要素。',
            '2. **多角度分析**：从技术、业务、风险角度分别评估。',
            '3. **依据说明**：主张必须包含逻辑依据或案例。',
            '4. **反方观点**：考虑对自己观点的反驳。',
            '5. **可执行性**：提出可实际落地的具体建议。',
            '',
            '在正式回答前，请先以“💭 Thinking:”整理关键考虑点。',
        ].join('\n'),
        contextReferenceTitle: '## 📋 参考上下文',
        contextReferenceBody: '请务必结合以下上下文提出意见：',
        agentOpinion: (agentName, includeDocumentRule, includeWebRule) => [
            `你是 **${agentName}** 领域专家。`,
            '',
            '## 讨论指引',
            '1. 从专业视角对主题进行**深入**分析。',
            '2. 提出具体且实用的观点。',
            '3. 如有其他专家意见，请补充或提供不同视角。',
            '4. 回复约300-500字，确保有足够深度。',
            `5. ${includeDocumentRule ? '**请将参考文档内容纳入分析。**' : ''}`,
            `6. ${includeWebRule ? '**请将网页搜索结果作为依据。**' : ''}`,
        ].join('\n'),
        crossReview: [
            '# 🔍 交叉评审专家',
            '',
            '你的角色是审阅并综合多位专家意见。',
            '',
            '## 评审指引',
            '1. 分析各专家意见的优缺点。',
            '2. 识别意见间的共性与差异。',
            '3. 若有冲突意见，请说明原因。',
            '4. 用约200字简洁总结。',
        ].join('\n'),
        finalSynthesis: [
            '# 💡 综合分析师',
            '',
            '你的角色是综合多位专家意见并生成最终回答。',
            '',
            '## 综合指引',
            '1. 包含所有专家意见的核心要点。',
            '2. 以逻辑清晰的结构组织内容。',
            '3. 给出可执行的结论。',
            '4. 使用Markdown格式清晰呈现。',
        ].join('\n'),
    },
    es: {
        deepThinking: [
            '## 🧠 Proceso de Deep Thinking (Obligatorio)',
            'Antes de analizar, debes seguir el siguiente proceso de pensamiento:',
            '',
            '1. **Descomposición del problema**: separa los elementos clave del tema.',
            '2. **Análisis multilateral**: revisa perspectivas técnicas, de negocio y de riesgo.',
            '3. **Fundamentación**: incluye evidencia lógica o ejemplos en cada afirmación.',
            '4. **Contraargumentos**: considera objeciones a tu propia postura.',
            '5. **Aplicabilidad**: propone acciones concretas y aplicables.',
            '',
            'Antes de la respuesta principal, inicia con "💭 Thinking:" y resume consideraciones clave.',
        ].join('\n'),
        contextReferenceTitle: '## 📋 Contexto de referencia',
        contextReferenceBody: 'Presenta tu opinión considerando el siguiente contexto:',
        agentOpinion: (agentName, includeDocumentRule, includeWebRule) => [
            `Eres un experto en **${agentName}**.`,
            '',
            '## Guía de debate',
            '1. Analiza el tema **en profundidad** desde tu especialidad.',
            '2. Ofrece opiniones concretas y prácticas.',
            '3. Si hay opiniones de otros expertos, complétalas o aporta otra perspectiva.',
            '4. Escribe una respuesta suficientemente profunda en unas 300-500 letras.',
            `5. ${includeDocumentRule ? '**Incorpora el contenido del documento de referencia en tu análisis.**' : ''}`,
            `6. ${includeWebRule ? '**Usa resultados de búsqueda web como evidencia de apoyo.**' : ''}`,
        ].join('\n'),
        crossReview: [
            '# 🔍 Experto en revisión cruzada',
            '',
            'Tu función es revisar y sintetizar opiniones de varios expertos.',
            '',
            '## Guía de revisión',
            '1. Analiza fortalezas y debilidades de cada opinión.',
            '2. Identifica similitudes y diferencias entre opiniones.',
            '3. Si hay opiniones en conflicto, explica por qué.',
            '4. Resume de forma concisa en unas 200 letras.',
        ].join('\n'),
        finalSynthesis: [
            '# 💡 Analista de síntesis',
            '',
            'Tu función es sintetizar varias opiniones expertas en una respuesta final.',
            '',
            '## Guía de síntesis',
            '1. Incluye los puntos clave de todas las opiniones expertas.',
            '2. Organiza con una estructura lógica.',
            '3. Presenta conclusiones accionables.',
            '4. Redacta claramente en formato markdown.',
        ].join('\n'),
    },
    de: {
        deepThinking: [
            '## 🧠 Deep-Thinking-Prozess (Pflicht)',
            'Vor der Analyse müssen Sie den folgenden Denkprozess durchlaufen:',
            '',
            '1. **Problemzerlegung**: Zerlegen Sie die Kernelemente des Themas.',
            '2. **Mehrperspektivische Analyse**: Prüfen Sie technische, geschäftliche und Risikoperspektiven.',
            '3. **Belege**: Untermauern Sie Aussagen mit logischen Belegen oder Beispielen.',
            '4. **Gegenargumente**: Berücksichtigen Sie Gegenargumente zu Ihrer eigenen Sicht.',
            '5. **Umsetzbarkeit**: Machen Sie konkrete, praktisch umsetzbare Vorschläge.',
            '',
            'Beginnen Sie vor der Hauptantwort mit "💭 Thinking:" und fassen Sie zentrale Überlegungen zusammen.',
        ].join('\n'),
        contextReferenceTitle: '## 📋 Referenzkontext',
        contextReferenceBody: 'Bitte geben Sie Ihre Meinung unter Berücksichtigung des folgenden Kontexts ab:',
        agentOpinion: (agentName, includeDocumentRule, includeWebRule) => [
            `Sie sind Experte für **${agentName}**.`,
            '',
            '## Diskussionsleitlinien',
            '1. Analysieren Sie das Thema **tiefgehend** aus Ihrer Fachperspektive.',
            '2. Geben Sie konkrete und praxisnahe Einschätzungen.',
            '3. Falls andere Expertenmeinungen vorliegen, ergänzen Sie diese oder bieten Sie eine andere Sicht.',
            '4. Verfassen Sie eine ausreichend tiefgehende Antwort mit etwa 300-500 Zeichen.',
            `5. ${includeDocumentRule ? '**Berücksichtigen Sie Inhalte aus Referenzdokumenten in Ihrer Analyse.**' : ''}`,
            `6. ${includeWebRule ? '**Nutzen Sie Websuchergebnisse als Beleggrundlage.**' : ''}`,
        ].join('\n'),
        crossReview: [
            '# 🔍 Cross-Review-Experte',
            '',
            'Ihre Rolle ist es, Meinungen mehrerer Experten zu prüfen und zusammenzuführen.',
            '',
            '## Prüfleitlinien',
            '1. Analysieren Sie Stärken und Schwächen jeder Expertenmeinung.',
            '2. Ermitteln Sie Gemeinsamkeiten und Unterschiede zwischen den Meinungen.',
            '3. Falls es widersprüchliche Meinungen gibt, erläutern Sie die Gründe.',
            '4. Fassen Sie prägnant in etwa 200 Zeichen zusammen.',
        ].join('\n'),
        finalSynthesis: [
            '# 💡 Synthese-Analyst',
            '',
            'Ihre Rolle ist es, mehrere Expertenmeinungen zu einer finalen Antwort zu synthetisieren.',
            '',
            '## Syntheseleitlinien',
            '1. Beziehen Sie die Kernpunkte aller Expertenmeinungen ein.',
            '2. Strukturieren Sie die Antwort logisch.',
            '3. Geben Sie umsetzbare Schlussfolgerungen.',
            '4. Schreiben Sie klar im Markdown-Format.',
        ].join('\n'),
    },
    fr: {
        deepThinking: [
            '## 🧠 Processus de réflexion approfondie (obligatoire)',
            'Avant l\'analyse, vous devez suivre le processus de réflexion suivant :',
            '',
            '1. **Décomposition du problème** : Décomposez les éléments clés du sujet.',
            '2. **Analyse multi-perspective** : Examinez les perspectives techniques, commerciales et de risque.',
            '3. **Preuves** : Étayez vos affirmations avec des preuves logiques ou des exemples.',
            '4. **Contre-arguments** : Considérez les contre-arguments à votre propre point de vue.',
            '5. **Faisabilité** : Faites des propositions concrètes et pratiquement réalisables.',
            '',
            'Avant la réponse principale, commencez par "💭 Thinking:" et résumez les réflexions clés.',
        ].join('\n'),
        contextReferenceTitle: '## 📋 Contexte de référence',
        contextReferenceBody: 'Veuillez donner votre avis en tenant compte du contexte suivant :',
        agentOpinion: (agentName, includeDocumentRule, includeWebRule) => [
            `Vous êtes expert en **${agentName}**.`,
            '',
            '## Directives de discussion',
            '1. Analysez le sujet **en profondeur** depuis votre perspective d\'expertise.',
            '2. Fournissez des évaluations concrètes et pratiques.',
            '3. Si d\'autres avis d\'experts existent, complétez-les ou proposez un autre point de vue.',
            '4. Rédigez une réponse suffisamment approfondie d\'environ 300 à 500 caractères.',
            `5. ${includeDocumentRule ? '**Intégrez le contenu des documents de référence dans votre analyse.**' : ''}`,
            `6. ${includeWebRule ? '**Utilisez les résultats de recherche web comme base de preuves.**' : ''}`,
        ].join('\n'),
        crossReview: [
            '# 🔍 Expert en révision croisée',
            '',
            'Votre rôle est d\'examiner et de synthétiser les avis de plusieurs experts.',
            '',
            '## Directives de révision',
            '1. Analysez les forces et faiblesses de chaque avis d\'expert.',
            '2. Identifiez les points communs et les différences entre les avis.',
            '3. S\'il y a des avis contradictoires, expliquez-en les raisons.',
            '4. Résumez de manière concise en environ 200 caractères.',
        ].join('\n'),
        finalSynthesis: [
            '# 💡 Analyste de synthèse',
            '',
            'Votre rôle est de synthétiser les avis de plusieurs experts en une réponse finale.',
            '',
            '## Directives de synthèse',
            '1. Intégrez les points clés de tous les avis d\'experts.',
            '2. Structurez la réponse de manière logique.',
            '3. Fournissez des conclusions exploitables.',
            '4. Rédigez clairement en format Markdown.',
        ].join('\n'),
    },
};

const DISCUSSION_LABELS: Record<PromptLocaleCode, {
    discussionTopic: string;
    previousOpinions: string;
    provideOpinion: string;
    expertOpinions: string;
    crossReviewRequest: string;
    question: string;
    expertOpinionsSection: string;
    crossReviewResult: string;
    synthesisRequest: string;
}> = {
    ko: {
        discussionTopic: '## 토론 주제',
        previousOpinions: '## 이전 전문가 의견',
        provideOpinion: '당신의 전문가 의견을 제시해주세요:',
        expertOpinions: '## 전문가 의견들',
        crossReviewRequest: '교차 검토 결과를 제시해주세요:',
        question: '## 질문',
        expertOpinionsSection: '## 전문가 의견',
        crossReviewResult: '## 교차 검토 결과',
        synthesisRequest: '위 내용을 종합하여 최종 답변을 작성해주세요:',
    },
    en: {
        discussionTopic: '## Discussion Topic',
        previousOpinions: '## Previous Expert Opinions',
        provideOpinion: 'Please provide your expert opinion:',
        expertOpinions: '## Expert Opinions',
        crossReviewRequest: 'Please provide your cross-review:',
        question: '## Question',
        expertOpinionsSection: '## Expert Opinions',
        crossReviewResult: '## Cross-Review Result',
        synthesisRequest: 'Please synthesize the above into a final answer:',
    },
    ja: {
        discussionTopic: '## 討論トピック',
        previousOpinions: '## これまでの専門家意見',
        provideOpinion: 'あなたの専門家意見を提示してください:',
        expertOpinions: '## 専門家意見一覧',
        crossReviewRequest: 'クロスレビュー結果を提示してください:',
        question: '## 質問',
        expertOpinionsSection: '## 専門家意見',
        crossReviewResult: '## クロスレビュー結果',
        synthesisRequest: '上記内容を総合して最終回答を作成してください:',
    },
    zh: {
        discussionTopic: '## 讨论主题',
        previousOpinions: '## 之前的专家意见',
        provideOpinion: '请提供你的专家意见：',
        expertOpinions: '## 专家意见列表',
        crossReviewRequest: '请给出交叉评审结果：',
        question: '## 问题',
        expertOpinionsSection: '## 专家意见',
        crossReviewResult: '## 交叉评审结果',
        synthesisRequest: '请综合以上内容给出最终答案：',
    },
    es: {
        discussionTopic: '## Tema de discusión',
        previousOpinions: '## Opiniones previas de expertos',
        provideOpinion: 'Por favor, proporciona tu opinión experta:',
        expertOpinions: '## Opiniones de expertos',
        crossReviewRequest: 'Por favor, presenta tu revisión cruzada:',
        question: '## Pregunta',
        expertOpinionsSection: '## Opiniones de expertos',
        crossReviewResult: '## Resultado de revisión cruzada',
        synthesisRequest: 'Por favor, sintetiza lo anterior en una respuesta final:',
    },
    de: {
        discussionTopic: '## Diskussionsthema',
        previousOpinions: '## Bisherige Expertenmeinungen',
        provideOpinion: 'Bitte geben Sie Ihre Expertenmeinung ab:',
        expertOpinions: '## Expertenmeinungen',
        crossReviewRequest: 'Bitte geben Sie Ihr Cross-Review an:',
        question: '## Frage',
        expertOpinionsSection: '## Expertenmeinungen',
        crossReviewResult: '## Cross-Review-Ergebnis',
        synthesisRequest: 'Bitte fassen Sie das Obige zu einer finalen Antwort zusammen:',
    },
    fr: {
        discussionTopic: '## Sujet de discussion',
        previousOpinions: '## Avis précédents des experts',
        provideOpinion: 'Veuillez fournir votre avis d\'expert :',
        expertOpinions: '## Avis des experts',
        crossReviewRequest: 'Veuillez présenter votre révision croisée :',
        question: '## Question',
        expertOpinionsSection: '## Avis des experts',
        crossReviewResult: '## Résultat de la révision croisée',
        synthesisRequest: 'Veuillez synthétiser ce qui précède en une réponse finale :',
    },
};

const DISCUSSION_PROGRESS_MESSAGES: Record<PromptLocaleCode, {
    selectingExperts: string;
    agentOpining: (agentEmoji: string, agentName: string) => string;
    crossReviewing: string;
    factChecking: string;
    synthesizing: string;
    complete: string;
    connectionError: string;
}> = {
    ko: {
        selectingExperts: '토론 참여 전문가를 선택하고 있습니다...',
        agentOpining: (agentEmoji, agentName) => `${agentEmoji} ${agentName}이(가) 의견을 제시하고 있습니다...`,
        crossReviewing: '전문가 의견을 교차 검토하고 있습니다...',
        factChecking: '웹 검색으로 사실을 검증하고 있습니다...',
        synthesizing: '전문가 의견을 종합하여 최종 답변을 생성하고 있습니다...',
        complete: '멀티 에이전트 토론이 완료되었습니다.',
        connectionError: 'AI 모델 서버에 연결할 수 없어 토론을 완료하지 못했습니다.',
    },
    en: {
        selectingExperts: 'Selecting expert participants...',
        agentOpining: (agentEmoji, agentName) => `${agentEmoji} ${agentName} is providing opinion...`,
        crossReviewing: 'Cross-reviewing expert opinions...',
        factChecking: 'Verifying facts with web search...',
        synthesizing: 'Synthesizing expert opinions into final answer...',
        complete: 'Multi-agent discussion completed.',
        connectionError: 'Could not complete discussion due to AI model server connection failure.',
    },
    ja: {
        selectingExperts: '討論に参加する専門家を選択しています...',
        agentOpining: (agentEmoji, agentName) => `${agentEmoji} ${agentName} が意見を提示しています...`,
        crossReviewing: '専門家意見をクロスレビューしています...',
        factChecking: 'Web検索で事実を検証しています...',
        synthesizing: '専門家意見を統合して最終回答を生成しています...',
        complete: 'マルチエージェント討論が完了しました。',
        connectionError: 'AIモデルサーバーへの接続に失敗したため、討論を完了できませんでした。',
    },
    zh: {
        selectingExperts: '正在选择参与讨论的专家...',
        agentOpining: (agentEmoji, agentName) => `${agentEmoji} ${agentName} 正在提供意见...`,
        crossReviewing: '正在交叉评审专家意见...',
        factChecking: '正在通过网页搜索验证事实...',
        synthesizing: '正在综合专家意见生成最终答案...',
        complete: '多智能体讨论已完成。',
        connectionError: '由于无法连接 AI 模型服务器，讨论未能完成。',
    },
    es: {
        selectingExperts: 'Seleccionando expertos participantes...',
        agentOpining: (agentEmoji, agentName) => `${agentEmoji} ${agentName} está aportando su opinión...`,
        crossReviewing: 'Revisando de forma cruzada las opiniones de expertos...',
        factChecking: 'Verificando hechos con búsqueda web...',
        synthesizing: 'Sintetizando opiniones expertas en una respuesta final...',
        complete: 'La discusión multiagente se completó.',
        connectionError: 'No se pudo completar la discusión por fallo de conexión con el servidor del modelo de IA.',
    },
    de: {
        selectingExperts: 'Auswahl der teilnehmenden Experten läuft...',
        agentOpining: (agentEmoji, agentName) => `${agentEmoji} ${agentName} gibt gerade eine Stellungnahme ab...`,
        crossReviewing: 'Expertenmeinungen werden per Cross-Review geprüft...',
        factChecking: 'Fakten werden per Websuche verifiziert...',
        synthesizing: 'Expertenmeinungen werden zur finalen Antwort synthetisiert...',
        complete: 'Die Multi-Agenten-Diskussion ist abgeschlossen.',
        connectionError: 'Die Diskussion konnte wegen eines Verbindungsfehlers zum KI-Modellserver nicht abgeschlossen werden.',
    },
    fr: {
        selectingExperts: 'Sélection des experts participants en cours...',
        agentOpining: (agentEmoji, agentName) => `${agentEmoji} ${agentName} est en train de donner son avis...`,
        crossReviewing: 'Révision croisée des avis d\'experts en cours...',
        factChecking: 'Vérification des faits par recherche web en cours...',
        synthesizing: 'Synthèse des avis d\'experts pour la réponse finale en cours...',
        complete: 'La discussion multi-agents est terminée.',
        connectionError: 'La discussion n\'a pas pu être terminée en raison d\'un échec de connexion au serveur du modèle IA.',
    },
};

const DISCUSSION_ERROR_MESSAGES: Record<PromptLocaleCode, {
    discussionFailureSummary: string;
    connectionErrorDetail: string;
    discussionSummary: (expertCount: number, roundCount: number) => string;
}> = {
    ko: {
        discussionFailureSummary: '토론 실패: 모든 전문가 에이전트의 응답 생성에 실패했습니다.',
        connectionErrorDetail: [
            '⚠️ AI 모델 서버에 연결할 수 없어 토론을 진행할 수 없습니다.',
            '',
            '**가능한 원인:**',
            '- Cloud 모델 서버(Ollama Cloud)에 접속할 수 없습니다.',
            '- API 키가 만료되었거나 할당량이 초과되었을 수 있습니다.',
            '- 네트워크 연결 상태를 확인해주세요.',
            '',
            '잠시 후 다시 시도해주세요.',
        ].join('\n'),
        discussionSummary: (expertCount, roundCount) => `${expertCount}명의 전문가가 ${roundCount}라운드 토론을 진행했습니다.`,
    },
    en: {
        discussionFailureSummary: 'Discussion failed: failed to generate responses from all expert agents.',
        connectionErrorDetail: [
            '⚠️ Discussion cannot proceed because the AI model server is unreachable.',
            '',
            '**Possible causes:**',
            '- Unable to connect to the cloud model server (Ollama Cloud).',
            '- API key may be expired or quota may be exceeded.',
            '- Please check your network connection.',
            '',
            'Please try again shortly.',
        ].join('\n'),
        discussionSummary: (expertCount, roundCount) => `${expertCount} experts completed a ${roundCount}-round discussion.`,
    },
    ja: {
        discussionFailureSummary: '討論失敗: すべての専門家エージェントで応答生成に失敗しました。',
        connectionErrorDetail: [
            '⚠️ AIモデルサーバーに接続できないため、討論を進行できません。',
            '',
            '**考えられる原因:**',
            '- クラウドモデルサーバー（Ollama Cloud）に接続できません。',
            '- APIキーの有効期限切れ、またはクォータ超過の可能性があります。',
            '- ネットワーク接続状態を確認してください。',
            '',
            'しばらくしてから再試行してください。',
        ].join('\n'),
        discussionSummary: (expertCount, roundCount) => `${expertCount}人の専門家が${roundCount}ラウンドの討論を行いました。`,
    },
    zh: {
        discussionFailureSummary: '讨论失败：所有专家智能体都未能生成响应。',
        connectionErrorDetail: [
            '⚠️ 由于无法连接 AI 模型服务器，讨论无法继续。',
            '',
            '**可能原因：**',
            '- 无法连接云端模型服务器（Ollama Cloud）。',
            '- API Key 可能已过期或配额已超限。',
            '- 请检查网络连接状态。',
            '',
            '请稍后重试。',
        ].join('\n'),
        discussionSummary: (expertCount, roundCount) => `${expertCount} 位专家完成了 ${roundCount} 轮讨论。`,
    },
    es: {
        discussionFailureSummary: 'Fallo en la discusión: no se pudieron generar respuestas de ningún agente experto.',
        connectionErrorDetail: [
            '⚠️ No se puede continuar la discusión porque no hay conexión con el servidor del modelo de IA.',
            '',
            '**Posibles causas:**',
            '- No se puede acceder al servidor de modelos en la nube (Ollama Cloud).',
            '- La API key puede haber expirado o superado su cuota.',
            '- Verifica el estado de tu conexión de red.',
            '',
            'Inténtalo de nuevo en unos minutos.',
        ].join('\n'),
        discussionSummary: (expertCount, roundCount) => `${expertCount} expertos realizaron una discusión de ${roundCount} rondas.`,
    },
    de: {
        discussionFailureSummary: 'Diskussion fehlgeschlagen: Für alle Expertenagenten konnte keine Antwort erzeugt werden.',
        connectionErrorDetail: [
            '⚠️ Die Diskussion kann nicht fortgesetzt werden, da keine Verbindung zum KI-Modellserver besteht.',
            '',
            '**Mögliche Ursachen:**',
            '- Verbindung zum Cloud-Modellserver (Ollama Cloud) nicht möglich.',
            '- Der API-Schlüssel ist möglicherweise abgelaufen oder das Kontingent wurde überschritten.',
            '- Bitte prüfen Sie Ihre Netzwerkverbindung.',
            '',
            'Bitte versuchen Sie es in Kürze erneut.',
        ].join('\n'),
        discussionSummary: (expertCount, roundCount) => `${expertCount} Experten haben eine Diskussion mit ${roundCount} Runden durchgeführt.`,
    },
    fr: {
        discussionFailureSummary: 'Échec de la discussion : impossible de générer des réponses pour tous les agents experts.',
        connectionErrorDetail: [
            '⚠️ La discussion ne peut pas se poursuivre car il n\'y a pas de connexion au serveur du modèle IA.',
            '',
            '**Causes possibles :**',
            '- Impossible d\'accéder au serveur de modèles cloud (Ollama Cloud).',
            '- La clé API a peut-être expiré ou dépassé son quota.',
            '- Veuillez vérifier l\'état de votre connexion réseau.',
            '',
            'Veuillez réessayer dans quelques instants.',
        ].join('\n'),
        discussionSummary: (expertCount, roundCount) => `${expertCount} experts ont mené une discussion de ${roundCount} tours.`,
    },
};

// Re-export all types so consumers importing from discussion-engine don't break
export type { DiscussionProgress, AgentOpinion, DiscussionResult, ContextPriority, TokenLimits, DiscussionConfig } from './discussion-types';

// ========================================
// Discussion Engine
// ========================================

/**
 * 토론 엔진 팩토리 함수
 * 
 * LLM 응답 생성 함수와 설정을 받아 토론 실행 객체를 생성합니다.
 * 반환된 객체의 startDiscussion()으로 토론을 시작합니다.
 * 
 * @param generateResponse - LLM 응답 생성 함수 (시스템 프롬프트, 사용자 메시지 -> 응답)
 * @param config - 토론 설정 (참여자 수, 라운드 수, 교차 검토, 컨텍스트 등)
 * @param onProgress - 진행 상황 콜백 (SSE 스트리밍 등에 활용)
 * @returns startDiscussion(), selectExpertAgents() 메서드를 가진 토론 엔진 객체
 */
export function createDiscussionEngine(
    generateResponse: (systemPrompt: string, userMessage: string) => Promise<string>,
    config: DiscussionConfig = {},
    onProgress?: (progress: DiscussionProgress) => void
) {
    const {
        maxAgents = 10,  // 🆕 제한 완화: 기본 10명으로 증가 (0 = 무제한)
        maxRounds = 2,
        enableCrossReview = true,
        enableFactCheck = false,
        enableDeepThinking = true,  // 🆕 기본 Deep Thinking 활성화
        userLanguage,
        // 🆕 컨텍스트 엔지니어링 필드 추출
        documentContext,
        webSearchContext,
    } = config;

    const locale = resolvePromptLocale(userLanguage || 'en');
    const localizedPrompts = DISCUSSION_SYSTEM_PROMPTS[locale];
    const localizedLabels = DISCUSSION_LABELS[locale];
    const localizedProgressMessages = DISCUSSION_PROGRESS_MESSAGES[locale];
    const localizedErrorMessages = DISCUSSION_ERROR_MESSAGES[locale];
    
    // 🆕 컨텍스트 빌더 생성 (우선순위, 토큰 제한, 메모이제이션 포함)
    const contextBuilder = createContextBuilder(config);
    const buildFullContext = contextBuilder.buildFullContext;

    /**
     * 🆕 개선된 전문가 에이전트 선택 (의도 기반 + 컨텍스트 반영)
     */
    async function selectExpertAgents(topic: string): Promise<Agent[]> {
        logger.info(`토론 주제: "${topic.substring(0, 50)}..."`);

        // 🆕 컨텍스트를 포함하여 더 정확한 에이전트 선택
        const fullContext = buildFullContext();
        const agentLimit = maxAgents === 0 ? 20 : maxAgents;
        
        // 🆕 컨텍스트를 전달하여 에이전트 선택 정확도 향상
        const experts = await getRelatedAgentsForDiscussion(topic, agentLimit, fullContext);

        logger.info(`선택된 전문가: ${experts.map(e => `${e.emoji} ${e.name}`).join(', ')}`);
        if (fullContext) {
            logger.info(`컨텍스트 적용됨 (${fullContext.length}자)`);
        }

        // 최소 2명 보장
        if (experts.length < 2) {
            const fallbackAgents = ['business-strategist', 'data-analyst', 'project-manager', 'general'];
            for (const id of fallbackAgents) {
                if (experts.length >= 2) break;
                const agent = getAgentById(id);
                if (agent && !experts.find(e => e.id === id)) {
                    experts.push(agent);
                }
            }
        }

        return experts;
    }

    /**
     * 에이전트별 의견 생성
     * 🆕 컨텍스트 엔지니어링 적용: 문서, 대화 기록, 웹 검색 결과 반영
     */
    async function generateAgentOpinion(
        agent: Agent,
        topic: string,
        previousOpinions: AgentOpinion[]
    ): Promise<AgentOpinion | null> {
        try {
            // 🆕 Deep Thinking 모드에 따른 프롬프트 차별화
            const thinkingInstructions = enableDeepThinking ? `
${localizedPrompts.deepThinking}` : '';

            // 🆕 컨텍스트 기반 추가 지침
            const contextInstructions = buildFullContext() ? `
${localizedPrompts.contextReferenceTitle}
${localizedPrompts.contextReferenceBody}
${buildFullContext()}
` : '';

            const systemPrompt = `# ${agent.emoji} ${agent.name}

${localizedPrompts.agentOpinion(agent.name, Boolean(documentContext), Boolean(webSearchContext))}
${agent.description}
${thinkingInstructions}
${contextInstructions}
`;

            let contextMessage = `${localizedLabels.discussionTopic}\n<topic>${sanitizePromptInput(topic)}</topic>\n\n`;

            if (previousOpinions.length > 0) {
                contextMessage += `${localizedLabels.previousOpinions}\n`;
                for (const op of previousOpinions) {
                    contextMessage += `\n### ${op.agentEmoji} ${op.agentName}\n${op.opinion}\n`;
                }
                contextMessage += `\n---\n\n${localizedLabels.provideOpinion}`;
            } else {
                contextMessage += `\n${localizedLabels.provideOpinion}`;
            }

            const response = await generateResponse(systemPrompt, contextMessage);

            return {
                agentId: agent.id,
                agentName: agent.name,
                agentEmoji: agent.emoji || '🤖',
                opinion: response,
                confidence: 0.8,
                timestamp: new Date()
            };
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error(`❌ ${agent.emoji} ${agent.name} 의견 생성 실패: ${errMsg}`);
            return null;
        }
    }

    /**
     * 교차 검토 (Cross-Review)
     */
    async function performCrossReview(
        opinions: AgentOpinion[],
        topic: string
    ): Promise<string> {
        const systemPrompt = localizedPrompts.crossReview;

        let contextMessage = `${localizedLabels.discussionTopic}\n<topic>${sanitizePromptInput(topic)}</topic>\n\n${localizedLabels.expertOpinions}\n`;
        for (const op of opinions) {
            contextMessage += `\n### ${op.agentEmoji} ${op.agentName}\n${op.opinion}\n`;
        }
        contextMessage += `\n---\n\n${localizedLabels.crossReviewRequest}`;

        return await generateResponse(systemPrompt, contextMessage);
    }

    /**
     * 최종 답변 합성
     */
    async function synthesizeFinalAnswer(
        topic: string,
        opinions: AgentOpinion[],
        crossReview?: string
    ): Promise<string> {
        const systemPrompt = localizedPrompts.finalSynthesis;

        let contextMessage = `${localizedLabels.question}\n<topic>${sanitizePromptInput(topic)}</topic>\n\n${localizedLabels.expertOpinionsSection}\n`;
        for (const op of opinions) {
            contextMessage += `\n### ${op.agentEmoji} ${op.agentName}\n${op.opinion}\n`;
        }

        if (crossReview) {
            contextMessage += `\n${localizedLabels.crossReviewResult}\n${crossReview}\n`;
        }

        contextMessage += `\n---\n\n${localizedLabels.synthesisRequest}`;

        return await generateResponse(systemPrompt, contextMessage);
    }

    /**
     * 토론 시작
     */
    async function startDiscussion(
        topic: string,
        webSearchFn?: (query: string) => Promise<any[]>
    ): Promise<DiscussionResult> {
        const startTime = Date.now();
        const opinions: AgentOpinion[] = [];

        // 1. 전문가 에이전트 선택
        onProgress?.({
            phase: 'selecting',
            message: localizedProgressMessages.selectingExperts,
            progress: 5
        });

        const experts = await selectExpertAgents(topic);
        const participants = experts.map(e => e.name);

        // 2. 라운드별 토론
        for (let round = 0; round < maxRounds; round++) {
            for (let i = 0; i < experts.length; i++) {
                const agent = experts[i];
                const progressPercent = 10 + (round * 40 / maxRounds) + (i * 40 / maxRounds / experts.length);

                onProgress?.({
                    phase: 'discussing',
                    currentAgent: agent.name,
                    agentEmoji: agent.emoji,
                    message: localizedProgressMessages.agentOpining(agent.emoji || '🤖', agent.name),
                    progress: progressPercent,
                    roundNumber: round + 1,
                    totalRounds: maxRounds
                });

                const opinion = await generateAgentOpinion(
                    agent,
                    topic,
                    round > 0 ? opinions : []
                );
                if (opinion) {
                    opinions.push(opinion);
                }
            }
        }

        // 2.5. 의견이 하나도 수집되지 않은 경우 조기 종료
        if (opinions.length === 0) {
            logger.error('⚠️ 모든 에이전트 의견 생성 실패 — LLM 연결 상태를 확인하세요.');
            onProgress?.({
                phase: 'complete',
                message: localizedProgressMessages.connectionError,
                progress: 100
            });
            return {
                discussionSummary: localizedErrorMessages.discussionFailureSummary,
                finalAnswer: localizedErrorMessages.connectionErrorDetail,
                participants,
                opinions: [],
                totalTime: Date.now() - startTime,
                factChecked: false
            };
        }

        // 3. 교차 검토
        let crossReview: string | undefined;
        if (enableCrossReview && opinions.length > 1) {
            onProgress?.({
                phase: 'reviewing',
                message: localizedProgressMessages.crossReviewing,
                progress: 75
            });

            crossReview = await performCrossReview(opinions, topic);
        }

        // 4. 사실 검증 (옵션)
        let factChecked = false;
        if (enableFactCheck && webSearchFn) {
            onProgress?.({
                phase: 'reviewing',
                message: localizedProgressMessages.factChecking,
                progress: 80
            });

            try {
                await webSearchFn(topic);
                factChecked = true;
            } catch (e) {
                logger.warn('사실 검증 실패:', e);
            }
        }

        // 5. 최종 답변 합성
        onProgress?.({
            phase: 'synthesizing',
            message: localizedProgressMessages.synthesizing,
            progress: 90
        });

        const finalAnswer = await synthesizeFinalAnswer(topic, opinions, crossReview);

        // 6. 완료
        onProgress?.({
            phase: 'complete',
            message: localizedProgressMessages.complete,
            progress: 100
        });

        return {
            discussionSummary: localizedErrorMessages.discussionSummary(experts.length, maxRounds),
            finalAnswer,
            participants,
            opinions,
            totalTime: Date.now() - startTime,
            factChecked
        };
    }

    return {
        startDiscussion,
        selectExpertAgents
    };
}
