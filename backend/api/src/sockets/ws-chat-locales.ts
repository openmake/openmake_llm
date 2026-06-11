/**
 * WebSocket 채팅 다국어 리소스
 * ws-chat-handler.ts 에서 사용하는 시사 키워드, 웹 검색 컨텍스트 템플릿,
 * 에러 메시지 템플릿을 언어 코드별로 정의합니다.
 * @module sockets/ws-chat-locales
 */
import type { ProviderErrorCode } from '../providers/provider-errors';

// 다국어 시사 키워드 맵
export const CURRENT_EVENTS_KEYWORDS: Record<string, string[]> = {
    ko: ['대통령', '총리', '장관', '현재', '지금', '오늘', '최근', '뉴스', '선거', '정치', '국회', '정부', '탄핵', '취임'],
    en: ['president', 'prime minister', 'minister', 'current', 'today', 'recent', 'news', 'election', 'politics', 'parliament', 'government', 'impeach', 'inaugur'],
    ja: ['大統領', '首相', '大臣', '現在', '今日', '最近', 'ニュース', '選挙', '政治', '国会', '政府'],
    zh: ['总统', '总理', '部长', '现在', '今天', '最近', '新闻', '选举', '政治', '国会', '政府'],
    es: ['presidente', 'primer ministro', 'ministro', 'actual', 'hoy', 'reciente', 'noticias', 'elecciones', 'política', 'parlamento', 'gobierno', 'destitución', 'investidura'],
    de: ['Präsident', 'Premierminister', 'Minister', 'aktuell', 'heute', 'neulich', 'Nachrichten', 'Wahl', 'Politik', 'Parlament', 'Regierung', 'Amtsenthebung', 'Amtseinführung'],
    fr: ['président', 'premier ministre', 'ministre', 'actuel', 'aujourd\'hui', 'récent', 'actualités', 'élections', 'politique', 'parlement', 'gouvernement', 'destitution', 'investiture'],
};

// 다국어 웹 검색 컨텍스트 템플릿
export const WEB_SEARCH_TEMPLATES: Record<string, { header: string; instruction: string; sourceLabel: string; contentLabel: string; locale: string }> = {
    ko: { header: '웹 검색 결과', instruction: '다음은 최신 웹 검색 결과입니다. 이 정보를 우선적으로 참고하여 답변하세요:', sourceLabel: '출처', contentLabel: '내용', locale: 'ko-KR' },
    en: { header: 'Web Search Results', instruction: 'Below are the latest web search results. Please prioritize this information in your response:', sourceLabel: 'Source', contentLabel: 'Content', locale: 'en-US' },
    ja: { header: 'ウェブ検索結果', instruction: '以下は最新のウェブ検索結果です。回答の際にこの情報を優先的に参考にしてください:', sourceLabel: '出典', contentLabel: '内容', locale: 'ja-JP' },
    zh: { header: '网络搜索结果', instruction: '以下是最新的网络搜索结果，请优先参考这些信息进行回答:', sourceLabel: '来源', contentLabel: '内容', locale: 'zh-CN' },
    es: { header: 'Resultados de búsqueda web', instruction: 'A continuación se muestran los resultados más recientes de búsqueda web. Por favor, priorice esta información en su respuesta:', sourceLabel: 'Fuente', contentLabel: 'Contenido', locale: 'es-ES' },
    de: { header: 'Websuchergebnisse', instruction: 'Nachfolgend finden Sie die neuesten Websuchergebnisse. Bitte berücksichtigen Sie diese Informationen vorrangig in Ihrer Antwort:', sourceLabel: 'Quelle', contentLabel: 'Inhalt', locale: 'de-DE' },
    fr: { header: 'Résultats de recherche web', instruction: 'Voici les résultats les plus récents de la recherche web. Veuillez donner la priorité à ces informations dans votre réponse :', sourceLabel: 'Source', contentLabel: 'Contenu', locale: 'fr-FR' },
};

// 다국어 에러 메시지 템플릿
export const WS_ERROR_MESSAGES: Record<string, { quotaExceeded: string; genericError: string }> = {
    ko: { quotaExceeded: 'API 할당량이 초과되었습니다', genericError: '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' },
    en: { quotaExceeded: 'API quota exceeded', genericError: 'An error occurred while processing. Please try again later.' },
    ja: { quotaExceeded: 'API割り当て量を超過しました', genericError: '処理中にエラーが発生しました。しばらくしてからもう一度お試しください。' },
    zh: { quotaExceeded: 'API配额已超出', genericError: '处理过程中发生错误，请稍后重试。' },
    es: { quotaExceeded: 'Se ha superado la cuota de API', genericError: 'Se produjo un error durante el procesamiento. Por favor, inténtelo de nuevo más tarde.' },
    de: { quotaExceeded: 'API-Kontingent überschritten', genericError: 'Bei der Verarbeitung ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut.' },
    fr: { quotaExceeded: 'Quota d\'API dépassé', genericError: 'Une erreur est survenue lors du traitement. Veuillez réessayer ultérieurement.' },
};

// 외부 provider(Anthropic/OpenRouter/Ollama 등) ProviderError 다국어 메시지
// raw upstream 메시지를 그대로 노출하면 stack/credential 누출 위험 → 코드별 사전 정의 텍스트만 전달
export const WS_PROVIDER_ERROR_MESSAGES: Record<string, Record<ProviderErrorCode, string>> = {
    ko: {
        GUEST_NOT_ALLOWED: '이 모델은 로그인이 필요합니다. 로그인 후 다시 시도해주세요.',
        MISSING_API_KEY: '외부 LLM 제공자의 API 키가 설정되지 않았습니다. 관리자에게 문의하거나 다른 모델을 선택하세요.',
        INVALID_API_KEY: '외부 LLM 제공자의 API 키 인증에 실패했습니다. 관리자에게 문의하세요.',
        QUOTA_EXCEEDED: '외부 LLM 제공자의 사용량 한도가 초과되었습니다. 잠시 후 다시 시도하거나 다른 모델을 선택하세요.',
        INSUFFICIENT_CREDIT: '외부 LLM 제공자의 잔액이 부족합니다. 관리자에게 문의하거나 다른 모델을 선택하세요.',
        MODEL_NOT_FOUND: '선택한 모델을 외부 LLM 제공자에서 찾을 수 없습니다. 모델 목록을 새로고침하거나 다른 모델을 선택하세요.',
        NOT_SUPPORTED: '선택한 모델이 이 기능을 지원하지 않습니다. 다른 모델을 시도해주세요.',
        UPSTREAM_ERROR: '외부 LLM 제공자에서 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        INVALID_MODEL_ID: '모델 식별자 형식이 올바르지 않습니다. 모델 목록에서 다시 선택해주세요.',
    },
    en: {
        GUEST_NOT_ALLOWED: 'This model requires authentication. Please log in and try again.',
        MISSING_API_KEY: 'The API key for the external LLM provider is not configured. Please contact your administrator or select a different model.',
        INVALID_API_KEY: 'Authentication with the external LLM provider failed. Please contact your administrator.',
        QUOTA_EXCEEDED: 'The usage limit for the external LLM provider has been exceeded. Please try again later or select a different model.',
        INSUFFICIENT_CREDIT: 'The external LLM provider has insufficient credit. Please contact your administrator or select a different model.',
        MODEL_NOT_FOUND: 'The selected model was not found at the external LLM provider. Please refresh the model list or select a different model.',
        NOT_SUPPORTED: 'The selected model does not support this feature. Please try a different model.',
        UPSTREAM_ERROR: 'A temporary error occurred at the external LLM provider. Please try again later.',
        INVALID_MODEL_ID: 'The model identifier format is invalid. Please reselect from the model list.',
    },
    ja: {
        GUEST_NOT_ALLOWED: 'このモデルはログインが必要です。ログイン後に再度お試しください。',
        MISSING_API_KEY: '外部LLMプロバイダーのAPIキーが設定されていません。管理者にお問い合わせいただくか、別のモデルを選択してください。',
        INVALID_API_KEY: '外部LLMプロバイダーのAPIキー認証に失敗しました。管理者にお問い合わせください。',
        QUOTA_EXCEEDED: '外部LLMプロバイダーの使用上限を超過しました。しばらくしてから再度お試しいただくか、別のモデルを選択してください。',
        INSUFFICIENT_CREDIT: '外部LLMプロバイダーの残高が不足しています。管理者にお問い合わせいただくか、別のモデルを選択してください。',
        MODEL_NOT_FOUND: '選択したモデルが外部LLMプロバイダーで見つかりません。モデル一覧を更新するか、別のモデルを選択してください。',
        NOT_SUPPORTED: '選択したモデルはこの機能をサポートしていません。別のモデルをお試しください。',
        UPSTREAM_ERROR: '外部LLMプロバイダーで一時的なエラーが発生しました。しばらくしてから再度お試しください。',
        INVALID_MODEL_ID: 'モデル識別子の形式が正しくありません。モデル一覧から再選択してください。',
    },
    zh: {
        GUEST_NOT_ALLOWED: '此模型需要登录。请登录后重试。',
        MISSING_API_KEY: '未配置外部LLM提供商的API密钥。请联系管理员或选择其他模型。',
        INVALID_API_KEY: '外部LLM提供商的API密钥认证失败。请联系管理员。',
        QUOTA_EXCEEDED: '已超过外部LLM提供商的使用限制。请稍后重试或选择其他模型。',
        INSUFFICIENT_CREDIT: '外部LLM提供商的余额不足。请联系管理员或选择其他模型。',
        MODEL_NOT_FOUND: '外部LLM提供商找不到所选模型。请刷新模型列表或选择其他模型。',
        NOT_SUPPORTED: '所选模型不支持此功能。请尝试其他模型。',
        UPSTREAM_ERROR: '外部LLM提供商发生临时错误。请稍后重试。',
        INVALID_MODEL_ID: '模型标识符格式无效。请从模型列表中重新选择。',
    },
    es: {
        GUEST_NOT_ALLOWED: 'Este modelo requiere autenticación. Por favor, inicie sesión e inténtelo de nuevo.',
        MISSING_API_KEY: 'La clave API del proveedor LLM externo no está configurada. Por favor, contacte al administrador o seleccione un modelo diferente.',
        INVALID_API_KEY: 'La autenticación con el proveedor LLM externo falló. Por favor, contacte al administrador.',
        QUOTA_EXCEEDED: 'Se ha superado el límite de uso del proveedor LLM externo. Por favor, inténtelo más tarde o seleccione un modelo diferente.',
        INSUFFICIENT_CREDIT: 'El proveedor LLM externo tiene saldo insuficiente. Por favor, contacte al administrador o seleccione un modelo diferente.',
        MODEL_NOT_FOUND: 'El modelo seleccionado no se encontró en el proveedor LLM externo. Por favor, actualice la lista de modelos o seleccione un modelo diferente.',
        NOT_SUPPORTED: 'El modelo seleccionado no admite esta función. Por favor, pruebe un modelo diferente.',
        UPSTREAM_ERROR: 'Se produjo un error temporal en el proveedor LLM externo. Por favor, inténtelo de nuevo más tarde.',
        INVALID_MODEL_ID: 'El formato del identificador del modelo no es válido. Por favor, vuelva a seleccionar de la lista de modelos.',
    },
    de: {
        GUEST_NOT_ALLOWED: 'Dieses Modell erfordert eine Anmeldung. Bitte melden Sie sich an und versuchen Sie es erneut.',
        MISSING_API_KEY: 'Der API-Schlüssel des externen LLM-Anbieters ist nicht konfiguriert. Bitte wenden Sie sich an den Administrator oder wählen Sie ein anderes Modell.',
        INVALID_API_KEY: 'Die Authentifizierung beim externen LLM-Anbieter ist fehlgeschlagen. Bitte wenden Sie sich an den Administrator.',
        QUOTA_EXCEEDED: 'Das Nutzungslimit des externen LLM-Anbieters wurde überschritten. Bitte versuchen Sie es später erneut oder wählen Sie ein anderes Modell.',
        INSUFFICIENT_CREDIT: 'Der externe LLM-Anbieter verfügt über unzureichendes Guthaben. Bitte wenden Sie sich an den Administrator oder wählen Sie ein anderes Modell.',
        MODEL_NOT_FOUND: 'Das ausgewählte Modell wurde beim externen LLM-Anbieter nicht gefunden. Bitte aktualisieren Sie die Modellliste oder wählen Sie ein anderes Modell.',
        NOT_SUPPORTED: 'Das ausgewählte Modell unterstützt diese Funktion nicht. Bitte versuchen Sie ein anderes Modell.',
        UPSTREAM_ERROR: 'Beim externen LLM-Anbieter ist ein vorübergehender Fehler aufgetreten. Bitte versuchen Sie es später erneut.',
        INVALID_MODEL_ID: 'Das Format der Modellkennung ist ungültig. Bitte wählen Sie aus der Modellliste neu aus.',
    },
    fr: {
        GUEST_NOT_ALLOWED: 'Ce modèle nécessite une authentification. Veuillez vous connecter et réessayer.',
        MISSING_API_KEY: 'La clé API du fournisseur LLM externe n\'est pas configurée. Veuillez contacter l\'administrateur ou sélectionner un autre modèle.',
        INVALID_API_KEY: 'L\'authentification auprès du fournisseur LLM externe a échoué. Veuillez contacter l\'administrateur.',
        QUOTA_EXCEEDED: 'La limite d\'utilisation du fournisseur LLM externe a été dépassée. Veuillez réessayer plus tard ou sélectionner un autre modèle.',
        INSUFFICIENT_CREDIT: 'Le fournisseur LLM externe dispose d\'un crédit insuffisant. Veuillez contacter l\'administrateur ou sélectionner un autre modèle.',
        MODEL_NOT_FOUND: 'Le modèle sélectionné est introuvable chez le fournisseur LLM externe. Veuillez actualiser la liste des modèles ou sélectionner un autre modèle.',
        NOT_SUPPORTED: 'Le modèle sélectionné ne prend pas en charge cette fonctionnalité. Veuillez essayer un autre modèle.',
        UPSTREAM_ERROR: 'Une erreur temporaire s\'est produite chez le fournisseur LLM externe. Veuillez réessayer plus tard.',
        INVALID_MODEL_ID: 'Le format de l\'identifiant du modèle est invalide. Veuillez resélectionner dans la liste des modèles.',
    },
};

/** 언어 코드로 템플릿 맵에서 값을 조회 — 미지원 언어는 en, 그것도 없으면 첫 항목 fallback */
export function getLocalizedTemplate<T>(map: Record<string, T>, lang: string): T {
    return map[lang] || map['en'] || Object.values(map)[0];
}
