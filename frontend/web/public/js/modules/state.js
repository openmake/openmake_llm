/**
 * State Management Module
 * 애플리케이션 전역 상태를 중앙 집중식으로 관리합니다.
 */

// 상태 저장소
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

    // 기능 플래그
    webSearchEnabled: false,
    thinkingEnabled: true,

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
    isSending: false
};

// 상태 변경 리스너
const stateListeners = new Map();

/**
 * 상태 조회
 * @param {string} key - 상태 키 (점 표기법 지원: 'auth.currentUser')
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
 * @param {string} key - 상태 키
 * @param {*} value - 새 값
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
 * 리스너 알림
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
 * 대화 메모리 추가
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
 * 대화 메모리 초기화
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
