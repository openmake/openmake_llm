/**
 * ============================================
 * State Management - 중앙 집중식 상태 관리
 * ============================================
 * 애플리케이션 전역 상태를 단일 저장소(AppState)에서 관리합니다.
 * 점 표기법(dot notation) 기반의 상태 조회/설정과
 * 구독(subscribe) 패턴을 통한 상태 변경 알림을 지원합니다.
 *
 * @module state
 */

/**
 * 애플리케이션 전역 상태 저장소
 * 모든 모듈이 공유하는 단일 진실의 원천(Single Source of Truth)
 * @type {Object}
 */
const AppState = {
    // WebSocket
    ws: null,

    // 클러스터
    nodes: [],

    // 채팅
    chatHistory: [],
    currentChatId: null,
    conversationMemory: [],
    MAX_MEMORY_LENGTH: 20,

    // 세션
    currentSessionId: null,

    // 기능 플래그
    webSearchEnabled: false,
    thinkingEnabled: true,
    discussionMode: false,
    thinkingMode: false,
    thinkingLevel: 'high',
    deepResearchMode: false,

    // MCP 도구 활성화 상태 (키: 도구명, 값: boolean — 기본 전체 비활성)
    mcpToolsEnabled: {},

    // 파일
    attachedFiles: [],
    activeDocumentContext: null,

    // 타이밍
    messageStartTime: null,

    // 인증
    auth: {
        currentUser: null,
        authToken: null,
        isGuestMode: false
    },

    // 에이전트
    currentAgent: null,

    // UI
    currentAssistantMessage: null,
    isSending: false,
    isGenerating: false  // 응답 생성 중 여부 (중단 버튼 표시용)
};

/**
 * 상태 변경 리스너 맵
 * 키: 상태 경로(string), 값: 콜백 Set
 * @type {Map<string, Set<Function>>}
 */
const stateListeners = new Map();

/**
 * 상태 조회
 * 점 표기법을 사용하여 중첩된 상태에 접근할 수 있습니다.
 * 키를 생략하면 전체 AppState 객체를 반환합니다.
 * @param {string} [key] - 상태 키 (점 표기법 지원: 'auth.currentUser')
 * @returns {*} 해당 키의 상태 값, 키 없으면 전체 AppState
 */
function getState(key) {
    if (!key) return AppState;

    const keys = key.split('.');
    let value = AppState;
    for (const k of keys) {
        value = value?.[k];
    }
    return value;
}

/**
 * 상태 설정
 * 점 표기법으로 중첩된 상태를 설정하고, 등록된 리스너에 변경을 알립니다.
 * 부모 키에 등록된 리스너에도 알림이 전파됩니다.
 * @param {string} key - 상태 키 (점 표기법 지원: 'auth.currentUser')
 * @param {*} value - 새 값
 * @returns {void}
 */
function setState(key, value) {
    const keys = key.split('.');
    let target = AppState;

    for (let i = 0; i < keys.length - 1; i++) {
        target = target[keys[i]];
    }

    const lastKey = keys[keys.length - 1];
    const oldValue = target[lastKey];
    target[lastKey] = value;

    // 리스너 호출
    notifyListeners(key, value, oldValue);
}

/**
 * 상태 변경 구독
 * @param {string} key - 감시할 상태 키
 * @param {function} callback - 콜백 함수
 * @returns {function} 구독 해제 함수
 */
function subscribe(key, callback) {
    if (!stateListeners.has(key)) {
        stateListeners.set(key, new Set());
    }
    stateListeners.get(key).add(callback);

    return () => {
        stateListeners.get(key)?.delete(callback);
    };
}

/**
 * 등록된 리스너에 상태 변경을 알림
 * 정확한 키 매칭과 부모 키 매칭을 모두 수행합니다.
 * 예: 'auth.currentUser' 변경 시 'auth' 구독 리스너도 호출됩니다.
 * @param {string} key - 변경된 상태 키
 * @param {*} newValue - 새로운 값
 * @param {*} oldValue - 이전 값
 * @returns {void}
 */
function notifyListeners(key, newValue, oldValue) {
    // 정확한 키 매칭
    if (stateListeners.has(key)) {
        stateListeners.get(key).forEach(cb => cb(newValue, oldValue, key));
    }

    // 부모 키도 알림 (예: 'auth.currentUser' 변경 시 'auth' 리스너도 호출)
    const parentKey = key.split('.').slice(0, -1).join('.');
    if (parentKey && stateListeners.has(parentKey)) {
        stateListeners.get(parentKey).forEach(cb => cb(getState(parentKey), null, parentKey));
    }
}

/**
 * 대화 메모리에 메시지 추가
 * MAX_MEMORY_LENGTH를 초과하면 가장 오래된 메시지부터 자동 제거됩니다.
 * @param {string} role - 메시지 역할 ('user' | 'assistant' | 'system')
 * @param {string} content - 메시지 내용
 * @param {Array|null} [images=null] - 첨부 이미지 배열 (비전 모델용)
 * @returns {void}
 */
function addToMemory(role, content, images = null) {
    const memory = getState('conversationMemory');
    const maxLength = getState('MAX_MEMORY_LENGTH');

    const newMessage = { role, content };
    if (images) newMessage.images = images;

    memory.push(newMessage);

    // 최대 길이 초과 시 오래된 메시지 제거
    while (memory.length > maxLength) {
        memory.shift();
    }

    setState('conversationMemory', memory);
}

/**
 * 대화 메모리 전체 초기화
 * 새 대화 시작 시 호출됩니다.
 * @returns {void}
 */
function clearMemory() {
    setState('conversationMemory', []);
}

// 전역 노출 (레거시 호환)
window.AppState = AppState;
window.getState = getState;
window.setState = setState;
window.subscribe = subscribe;
window.addToMemory = addToMemory;
window.clearMemory = clearMemory;

export { AppState, getState, setState, subscribe, addToMemory, clearMemory };
