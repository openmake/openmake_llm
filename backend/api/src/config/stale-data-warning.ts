/**
 * Stale Data Warning Templates
 *
 * 시사 키워드가 매칭됐으나 외부 데이터(웹 검색)를 얻지 못한 경우,
 * LLM 환각 방지를 위해 system prompt에 prepend되는 다국어 안전망 메시지.
 *
 * 사용 흐름: ws-chat-handler.ts에서 isCurrentEventsQuery=true이고 webSearchContext가
 * 비어있을 때 (검색 차단 또는 결과 0건) 이 템플릿이 webSearchContext 채널로 주입된다.
 *
 * @module config/stale-data-warning
 * @see sockets/ws-chat-handler - 주입 지점
 * @see services/chat-service/context-builder - system prompt 합성 흐름
 *
 * 추후 admin UI에서 편집 가능하도록 DB(prompt_templates)로 이전할 수 있다.
 */

export interface StaleDataWarningTemplate {
    /** 안전망 섹션 헤더 — Markdown H2 뒤에 사용됨 */
    header: string;
    /** LLM에게 전달되는 본문 instruction — 학습 컷오프 명시·단정 자제·검색 권유 */
    instruction: string;
}

export const STALE_DATA_WARNING_TEMPLATES: Record<string, StaleDataWarningTemplate> = {
    ko: {
        header: '주의: 실시간 정보 미반영',
        instruction:
            '사용자 질문이 시간에 민감한 사실 정보를 요구합니다. 그러나 현재 웹 검색 결과가 제공되지 않았으므로, 당신의 학습 데이터 시점 이후의 변동(인사 변경, 선거 결과, 임명, 사망, 기관·정책 변경 등)은 알 수 없습니다.\n\n답변 시 반드시 다음을 지키세요:\n1. "제 학습 데이터 기준으로는…" 등으로 정보의 시점 한계를 명시할 것.\n2. "~로 알고 있습니다", "변경됐을 수 있습니다" 같은 비단정 표현을 사용할 것 (단정 금지).\n3. 사용자에게 "정확한 최신 정보가 필요하시면 웹 검색을 활성화해 주세요"라고 안내할 것.\n4. 모르거나 불확실한 부분은 추측하지 말고 모른다고 답할 것.',
    },
    en: {
        header: 'Notice: Real-time Information Unavailable',
        instruction:
            'The user\'s question requires time-sensitive factual information, but no web search results are currently available. You cannot know about changes that occurred after your training data cutoff (personnel changes, election results, appointments, deaths, institutional/policy changes, etc.).\n\nWhen responding, you must:\n1. Explicitly state the temporal limit of your information (e.g., "Based on my training data...").\n2. Use non-assertive expressions like "I believe..." or "this may have changed" — avoid definitive claims.\n3. Advise the user: "Please enable web search for accurate, up-to-date information."\n4. For unknown or uncertain parts, admit you don\'t know rather than speculating.',
    },
    ja: {
        header: '注意: リアルタイム情報未反映',
        instruction:
            'ユーザーの質問は時間に敏感な事実情報を求めていますが、現在ウェブ検索結果が提供されていないため、学習データ時点以降の変化（人事異動、選挙結果、任命、死去、機関・政策変更など）は把握できません。\n\n回答時に以下を必ず守ってください:\n1. 「学習データ時点では…」などと情報の時間的限界を明示すること。\n2. 「〜と認識しています」「変更されている可能性があります」などの非断定的表現を使うこと（断定禁止）。\n3. ユーザーに「正確な最新情報が必要な場合はウェブ検索を有効にしてください」と案内すること。\n4. 不明・不確実な部分は推測せず「分かりません」と答えること。',
    },
    zh: {
        header: '注意: 未反映实时信息',
        instruction:
            '用户的问题需要时间敏感的事实信息，但当前没有提供网络搜索结果，因此您无法了解训练数据时点之后的变化（人事变动、选举结果、任命、逝世、机构/政策变更等）。\n\n回答时必须遵守以下原则:\n1. 明确标注信息的时间界限，例如"根据我的训练数据……"。\n2. 使用"我了解到……""可能已经变化"等非断言性表达（禁止断言）。\n3. 提示用户"如需准确的最新信息，请启用网络搜索"。\n4. 对于不知道或不确定的部分，不要猜测，直接回答不知道。',
    },
    es: {
        header: 'Aviso: Información en tiempo real no disponible',
        instruction:
            'La pregunta del usuario requiere información factual sensible al tiempo, pero actualmente no hay resultados de búsqueda web disponibles. No puede conocer los cambios ocurridos después de la fecha de corte de sus datos de entrenamiento (cambios de personal, resultados electorales, nombramientos, fallecimientos, cambios institucionales/políticos, etc.).\n\nAl responder, debe:\n1. Indicar explícitamente el límite temporal de su información (por ejemplo, "Según mis datos de entrenamiento...").\n2. Usar expresiones no asertivas como "creo que..." o "esto puede haber cambiado" — evite afirmaciones definitivas.\n3. Indicar al usuario: "Por favor, active la búsqueda web para obtener información precisa y actualizada."\n4. Para partes desconocidas o inciertas, admita que no lo sabe en lugar de especular.',
    },
    de: {
        header: 'Hinweis: Echtzeitinformationen nicht verfügbar',
        instruction:
            'Die Frage des Benutzers erfordert zeitkritische Fakteninformationen, jedoch sind derzeit keine Websuchergebnisse verfügbar. Sie können keine Änderungen kennen, die nach dem Stichtag Ihrer Trainingsdaten eingetreten sind (Personalwechsel, Wahlergebnisse, Ernennungen, Todesfälle, institutionelle/politische Änderungen usw.).\n\nBeim Antworten müssen Sie:\n1. Den zeitlichen Rahmen Ihrer Information ausdrücklich angeben (z. B. "Nach meinen Trainingsdaten...").\n2. Nicht-assertive Ausdrücke wie "ich glaube..." oder "das hat sich möglicherweise geändert" verwenden — vermeiden Sie definitive Aussagen.\n3. Den Benutzer hinweisen: "Bitte aktivieren Sie die Websuche für genaue, aktuelle Informationen."\n4. Für unbekannte oder unsichere Teile geben Sie zu, dass Sie es nicht wissen, anstatt zu spekulieren.',
    },
    fr: {
        header: 'Avis : Informations en temps réel indisponibles',
        instruction:
            'La question de l\'utilisateur nécessite des informations factuelles sensibles au temps, mais aucun résultat de recherche web n\'est actuellement disponible. Vous ne pouvez pas connaître les changements survenus après la date de coupure de vos données d\'entraînement (changements de personnel, résultats électoraux, nominations, décès, changements institutionnels/politiques, etc.).\n\nLors de la réponse, vous devez :\n1. Indiquer explicitement la limite temporelle de votre information (par exemple, "D\'après mes données d\'entraînement...").\n2. Utiliser des expressions non assertives comme "je crois que..." ou "cela a peut-être changé" — évitez les affirmations définitives.\n3. Conseiller à l\'utilisateur : "Veuillez activer la recherche web pour des informations précises et à jour."\n4. Pour les parties inconnues ou incertaines, admettez que vous ne savez pas plutôt que de spéculer.',
    },
};

/**
 * 사용자 언어에 맞는 stale-data 안전망 템플릿을 반환한다.
 * 매칭되는 언어가 없으면 영어 템플릿으로 폴백한다.
 *
 * @param lang - SupportedLanguageCode (ko, en, ja, zh, es, de, fr)
 */
export function getStaleDataWarning(lang: string): StaleDataWarningTemplate {
    return (
        STALE_DATA_WARNING_TEMPLATES[lang] ||
        STALE_DATA_WARNING_TEMPLATES['en'] ||
        Object.values(STALE_DATA_WARNING_TEMPLATES)[0]
    );
}
