/**
 * ============================================
 * Main Entry Point - ES Module 앱 초기화 및 통합
 * ============================================
 * 애플리케이션의 메인 진입점으로, 모든 모듈을 ES import로 로드하고
 * 인증/WebSocket/테마/설정 등 초기화를 순차 수행합니다.
 * 레거시 호환을 위해 주요 함수를 window에 노출합니다.
 *
 * <script type="module" src="js/main.js?v=18"> 로 로드됩니다.
 *
 * @module main
 */

// ============================================
// 1. ES Module Imports (의존성 순서)
// ============================================

// 1-1. 상태 관리 (최우선)
import { AppState, getState, setState, subscribe, addToMemory, clearMemory } from './modules/state.js';

// 1-2. 유틸리티 (의존성 없음)
import {
    debugLog, debugWarn, debugError,
    handleKeyDown,
    truncateFilename, formatFileSize, formatDate, relativeTime,
    debounce, throttle, generateUUID, deepClone, DEBUG
} from './modules/utils.js';

// 1-3. 인증 (state 의존)
import {
    initAuth, authFetch, authJsonFetch, login, logout,
    enterGuestMode, updateAuthUI, isAdmin, isLoggedIn,
    getCurrentUser, claimAnonymousSession
} from './modules/auth.js';

// 1-4. UI (state 의존)
import {
    applyTheme, toggleTheme, setTheme,
    toggleSidebar, toggleMobileSidebar as uiToggleMobileSidebar,
    openModal, closeModal,
    showSettings, closeSettings,
    showFileUpload, closeFileModal,
    showToast, showError,
    scrollToBottom, escapeHtml, renderMarkdown
} from './modules/ui.js';

// 1-5. WebSocket (state, utils 의존)
import {
    connectWebSocket, sendWsMessage, handleMessage,
    updateConnectionStatus, isConnected
} from './modules/websocket.js';

// 1-6. 설정 (state, auth, ui 의존)
import {
    MCP_TOOL_CATALOG,
    loadMCPSettings, saveMCPSettings,
    toggleMCPModule, toggleWebSearch, toggleMCPTool,
    setAllMCPTools, getEnabledTools, updateMCPToolTogglesUI,
    loadPromptMode, setPromptMode,
    loadAgentMode, toggleAgentMode,
    loadCurrentModel, saveSettings, resetSettings, toggleSection
} from './modules/settings.js';

// 1-7. 채팅 (state, websocket, ui, auth 의존)
import {
    sendMessage, addChatMessage, appendToken,
    finishAssistantMessage, copyMessage, regenerateMessage,
    newChat as chatNewChat, useSuggestion, abortChat
} from './modules/chat.js?v=19';

// 1-8. 세션 관리 (state, auth 의존)
import {
    getOrCreateAnonymousSessionId,
    loadChatSessions, formatTimeAgo,
    createNewSession, loadSession,
    addRestoredAssistantMessage, saveMessageToSession,
    deleteSession, addToChatHistory,
    newChat as sessionNewChat
} from './modules/session.js';

// 1-9. 파일 업로드 (state 의존)
import {
    uploadFile, setupFileInput, setupChatDropZone,
    renderAttachments, removeAttachment, clearAttachments
} from './modules/file-upload.js';

// 1-10. 모드 토글 (state 의존)
import {
    toggleDiscussionMode, toggleThinkingMode, toggleDeepResearch,
    showDiscussionProgress, showResearchProgress
} from './modules/modes.js';

// 1-11. 클러스터 (state 의존)
import {
    BRAND_MODELS,
    updateClusterInfo, updateSidebarClusterInfo, updateClusterStatus,
    fetchClusterInfoFallback, updateModelSelect, handleClusterEvent,
    showAgentBadge, selectModel, loadModelInfo, formatSize
} from './modules/cluster.js';

// 1-12. 문서 (state 의존)
import {
    updateActiveDocumentUI, clearActiveDocument,
    askDocumentQuestion, formatSummaryResponse,
    showDocumentProgress
} from './modules/document.js';

// 1-13. 에러 핸들러 / 기능 카드 (state 의존)
import {
    startFeatureChat, handleCommand,
    showHelpAndMessage, performWebSearch,
    syncMCPSettingsToServer, syncMCPSettingsFromServer,
    showHelpPopup, hideHelpPopup,
    hideHelpPopupDelayed, closeHelpPopup
} from './modules/error-handler.js';

// 1-14. 가이드 (ui 의존)
import { showUserGuide, closeGuideModal, useMode } from './modules/guide.js';

// NOTE: sanitize.js는 ES export가 없으며 window.purifyHTML/sanitizeHTML로 전역 노출됨
// side-effect import로 로드하여 window 전역에 등록
import './modules/sanitize.js';

// 1-15. 네비게이션 데이터
import { NAV_ITEMS } from './nav-items.js';

// 1-16. SPA 라우터
import { Router, SafeStorage } from './spa-router.js';

// 1-17. 컴포넌트 (사이드바, 관리자 패널, 오프라인 인디케이터, 설치 프롬프트)
import { UnifiedSidebar } from './components/unified-sidebar.js';
import { AdminPanel } from './components/admin-panel.js';
import { show as offlineShow, hide as offlineHide, isOffline as offlineIsOffline } from './components/offline-indicator.js';
import { show as installShow, hide as installHide, isInstalled } from './components/install-prompt.js';


// ============================================
// 2. SPA 모드: alert() → showToast() 변환 (blocking alert 방지)
// ============================================
(function () {
    var _origAlert = window.alert;
    window.alert = function (msg) {
        if (typeof showToast === 'function') {
            showToast(msg, 'warning');
        } else {
            _origAlert.call(window, msg);
        }
    };
})();

// ============================================
// 3. 앱에서만 사용되는 초기화 함수 (app.js에서 이전)
// ============================================

/**
 * 모바일 사이드바 초기화 - 앱 로드 시 사이드바 숨기기
 *
 * 화면 너비 768px 이하(모바일)에서 사이드바, 메뉴 버튼, 오버레이를
 * 닫힌 상태로 초기화합니다.
 *
 * @returns {void}
 */
function initMobileSidebar() {
    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        const menuBtn = document.getElementById('mobileMenuBtn');
        const overlay = document.getElementById('mobileOverlay');

        if (sidebar) {
            sidebar.classList.remove('open');
        }
        if (menuBtn) {
            menuBtn.classList.remove('active');
        }
        if (overlay) {
            overlay.classList.remove('active');
        }
        document.body.style.overflow = '';
    }
}

/**
 * 인증 상태에 따라 제한된 메뉴 항목을 필터링
 *
 * data-require-auth="true" 속성을 가진 메뉴 항목을 비인증 사용자에게 숨기고,
 * 관리 섹션 레이블과 사용자 상태 배지를 업데이트합니다.
 *
 * @returns {void}
 */
function filterRestrictedMenus() {
    const authToken = SafeStorage.getItem('authToken');
    const currentUser = getCurrentUser();
    const isGuest = SafeStorage.getItem('guestMode') === 'true' || SafeStorage.getItem('isGuest') === 'true';
    const isAuthenticated = (authToken || currentUser) && !isGuest;

    // data-require-auth="true" 속성이 있는 메뉴 항목 숨기기
    document.querySelectorAll('[data-require-auth="true"]').forEach(el => {
        if (!isAuthenticated) {
            el.style.display = 'none';
        }
    });

    // 관리 섹션 레이블도 숨기기 (관리 메뉴가 모두 숨겨지면)
    const adminLabel = document.getElementById('adminSectionLabel');
    if (adminLabel && !isAuthenticated) {
        adminLabel.style.display = 'none';
    }

    // 사용자 상태 표시
    showUserStatusBadge(isAuthenticated, isGuest);
}

/**
 * 사용자 상태 배지를 UI에 표시
 *
 * 인증 상태에 따라 "사용자 이메일", "게스트", "비로그인" 배지를
 * 다른 색상으로 표시합니다.
 *
 * @param {boolean} isAuthenticated - 인증된 사용자인지 여부
 * @param {boolean} isGuest - 게스트 모드인지 여부
 * @returns {void}
 */
function showUserStatusBadge(isAuthenticated, isGuest) {
    const userInfo = document.getElementById('userInfo');
    if (!userInfo) return;

    if (isAuthenticated) {
        const SS = window.SafeStorage || { getItem: function(k) { try { return localStorage.getItem(k); } catch(e) { return null; } } };
        const user = JSON.parse(SS.getItem('user') || '{}');
        userInfo.innerHTML = `<span style="color: var(--success);">👤 ${escapeHtml(user.email || user.username || '사용자')}</span>`;
        userInfo.style.display = 'block';
    } else if (isGuest) {
        userInfo.innerHTML = `<span style="color: var(--info);">👤 게스트</span>`;
        userInfo.style.display = 'block';
    } else {
        userInfo.innerHTML = `<span style="color: var(--warning);">⚠️ 비로그인</span>`;
        userInfo.style.display = 'block';
    }
}

/**
 * 모바일 사이드바 토글 - UnifiedSidebar 인스턴스 연동
 *
 * window.sidebar (UnifiedSidebar 인스턴스)의 toggle() 메서드를 호출하고,
 * 햄버거 아이콘 상태를 동기화합니다.
 *
 * @param {Event} [e] - 클릭/터치 이벤트 (preventDefault 처리)
 * @returns {void}
 */
function toggleMobileSidebarLegacy(e) {
    if (e) e.preventDefault();

    if (window.sidebar && typeof window.sidebar.toggle === 'function') {
        window.sidebar.toggle();
        _syncHamburgerIcon();
    }
}

/**
 * 햄버거 메뉴 아이콘 상태를 사이드바 상태와 동기화
 * @private
 * @returns {void}
 */
function _syncHamburgerIcon() {
    const menuBtn = document.getElementById('mobileMenuBtn');
    if (!menuBtn || !window.sidebar) return;

    const state = window.sidebar.getState();
    if (state === 'hidden') {
        menuBtn.classList.remove('active');
    } else {
        menuBtn.classList.add('active');
    }
}

/**
 * 모바일 사이드바를 닫기 (hidden 상태로 전환)
 * @returns {void}
 */
function closeMobileSidebar() {
    if (window.sidebar && typeof window.sidebar.setState === 'function') {
        window.sidebar.setState('hidden');
    }
    const menuBtn = document.getElementById('mobileMenuBtn');
    if (menuBtn) menuBtn.classList.remove('active');
}

/**
 * 사이드바 메뉴 항목 클릭 시 모바일에서 자동으로 사이드바 닫기
 * @returns {void}
 */
function closeSidebarOnMobileNav() {
    if (window.innerWidth <= 768) {
        closeMobileSidebar();
    }
}

/**
 * 에이전트 목록을 사이드바에 렌더링
 * @param {Array<{url: string, name?: string}>} agents - 에이전트 목록
 * @returns {void}
 */
function renderAgentList(agents) {
    const list = document.getElementById('agentList');
    if (!list) return;

    if (!agents || agents.length === 0) {
        list.innerHTML = '<div class="agent-item-empty">등록된 에이전트 없음</div>';
        return;
    }

    list.innerHTML = agents.map(agent => `
        <div class="agent-item" title="${escapeHtml(agent.url)}">
            <span class="agent-icon">${agent.url.startsWith('local://') ? '🤖' : '🌐'}</span>
            <span class="agent-name">${escapeHtml(agent.name || agent.url.replace('local://', ''))}</span>
            <span class="agent-status-dot online"></span>
        </div>
    `).join('');
}


// ============================================
// 3. newChat 통합 (session.newChat + chat.newChat)
// ============================================

/**
 * 새 대화 시작 — 세션 생성 + 채팅 UI 초기화 통합
 * session.js의 newChat(세션 초기화)과 chat.js의 newChat(UI 클리어)를 결합합니다.
 * @returns {void}
 */
function newChat() {
    sessionNewChat();
    chatNewChat();
}


// ============================================
// 4. 이벤트 리스너 설정
// ============================================

/**
 * 이벤트 리스너 등록 — textarea 자동 높이, 전송 버튼, 모달, 키보드 단축키
 * @returns {void}
 */
function setupEventListeners() {
    // 텍스트 영역 자동 높이 조절
    const textarea = document.getElementById('chatInput');
    if (textarea) {
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
        });
    }

    // 전송 버튼 클릭
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            sendMessage();
        });
    }

    // 파일 입력 설정
    setupFileInput();

    // 채팅 입력 영역 드래그 앤 드롭 파일 업로드
    setupChatDropZone();

    // 모달 외부 클릭 시 닫기
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });

    // 키보드 단축키
    document.addEventListener('keydown', (e) => {
        // Cmd/Ctrl + K: 새 대화
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            newChat();
        }

        // Cmd/Ctrl + ,: 설정
        if ((e.metaKey || e.ctrlKey) && e.key === ',') {
            e.preventDefault();
            showSettings();
        }
    });

    // 모바일 터치 이벤트 — 햄버거 메뉴
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('touchstart', function (e) {
            e.preventDefault();
            toggleMobileSidebarLegacy();
        }, { passive: false });
    }
}


// ============================================
// 5. 앱 초기화
// ============================================

/**
 * 앱 초기화 — 인증, WebSocket, 테마, 설정을 순차적으로 초기화
 * @returns {Promise<void>}
 */
async function initApp() {
    debugLog('[App] 초기화 시작...');

    // 1. 인증 상태 초기화 (세션 복구 완료까지 대기)
    await initAuth();

    // 2. 인증 기반 메뉴 필터링
    filterRestrictedMenus();

    // 3. WebSocket 연결
    connectWebSocket();

    // 4. 테마 적용
    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);

    // 5. 설정 로드
    loadMCPSettings();
    loadPromptMode();
    loadAgentMode();

    // 6. 대화 히스토리 로드
    loadChatSessions();

    // 7. 모바일 사이드바 초기화
    initMobileSidebar();

    // 8. 이벤트 리스너 등록
    setupEventListeners();

    // 9. URL 파라미터 체크 (세션 복원)
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('sessionId') || urlParams.get('chat');
    const pendingSessionId = sessionStorage.getItem('pendingSessionId');
    if (pendingSessionId) {
        sessionStorage.removeItem('pendingSessionId');
    }
    const targetSessionId = sessionId || pendingSessionId;
    if (targetSessionId) {
        setTimeout(() => loadSession(targetSessionId), 100);
    }

    // 10. 통합 사이드바 초기화
    const sidebarInstance = new UnifiedSidebar('sidebar');
    sidebarInstance.init();
    window.sidebar = sidebarInstance;

    // 모바일 메뉴 버튼 연결
    const mobileMenuBtnEl = document.getElementById('mobileMenuBtn');
    if (mobileMenuBtnEl) {
        mobileMenuBtnEl.addEventListener('click', function () {
            if (window.sidebar) {
                window.sidebar.toggle();
            }
        });
    }

    // 11. OAuth 세션 복구 완료 대기 후 라우터 시작
    if (window._authRecoveryPromise) {
        try {
            await Promise.race([
                window._authRecoveryPromise,
                new Promise(function (resolve) { setTimeout(resolve, 2000); })
            ]);
        } catch (e) {
            // 네트워크 오류 — 무시하고 라우터 시작
        }
    }

    // 12. SPA 라우터 시작
    Router.start();

    // 라우터 네비게이션 시 사이드바 활성 대화 업데이트
    Router.onAfterNavigate(function (info) {
        if (info.to !== '/') {
            if (window.sidebar) {
                window.sidebar.setActiveConversation(null);
            }
        }
    });

    debugLog('[App] 초기화 완료');
}


// ============================================
// 6. 전역 노출 (레거시 호환 — inline onclick, 컴포넌트 스크립트 등)
// ============================================

// 상태
window.AppState = AppState;
window.getState = getState;
window.setState = setState;
window.subscribe = subscribe;
window.addToMemory = addToMemory;
window.clearMemory = clearMemory;

// 유틸리티
window.debugLog = debugLog;
window.debugWarn = debugWarn;
window.debugError = debugError;
window.handleKeyDown = handleKeyDown;
window.truncateFilename = truncateFilename;
window.formatFileSize = formatFileSize;
window.formatDate = formatDate;
window.relativeTime = relativeTime;
window.debounce = debounce;
window.throttle = throttle;
window.generateUUID = generateUUID;
window.deepClone = deepClone;

// 인증
window.initAuth = initAuth;
window.authFetch = authFetch;
window.authJsonFetch = authJsonFetch;
window.login = login;
window.logout = logout;
window.enterGuestMode = enterGuestMode;
window.updateAuthUI = updateAuthUI;
window.isAdmin = isAdmin;
window.isLoggedIn = isLoggedIn;
window.getCurrentUser = getCurrentUser;
window.claimAnonymousSession = claimAnonymousSession;

// UI
window.applyTheme = applyTheme;
window.toggleTheme = toggleTheme;
window.setTheme = setTheme;
window.toggleSidebar = toggleSidebar;
window.openModal = openModal;
window.closeModal = closeModal;
window.showSettings = showSettings;
window.closeSettings = closeSettings;
window.showFileUpload = showFileUpload;
window.closeFileModal = closeFileModal;
window.showToast = showToast;
window.showError = showError;
window.scrollToBottom = scrollToBottom;
window.escapeHtml = escapeHtml;
window.renderMarkdown = renderMarkdown;

// WebSocket
window.connectWebSocket = connectWebSocket;
window.sendWsMessage = sendWsMessage;
window.handleMessage = handleMessage;
window.updateConnectionStatus = updateConnectionStatus;
window.isConnected = isConnected;

// 설정
window.MCP_TOOL_CATALOG = MCP_TOOL_CATALOG;
window.loadMCPSettings = loadMCPSettings;
window.saveMCPSettings = saveMCPSettings;
window.toggleMCPModule = toggleMCPModule;
window.toggleWebSearch = toggleWebSearch;
window.toggleMCPTool = toggleMCPTool;
window.setAllMCPTools = setAllMCPTools;
window.getEnabledTools = getEnabledTools;
window.updateMCPToolTogglesUI = updateMCPToolTogglesUI;
window.loadPromptMode = loadPromptMode;
window.setPromptMode = setPromptMode;
window.loadAgentMode = loadAgentMode;
window.toggleAgentMode = toggleAgentMode;
window.loadCurrentModel = loadCurrentModel;
window.saveSettings = saveSettings;
window.resetSettings = resetSettings;
window.toggleSection = toggleSection;

// 채팅
window.sendMessage = sendMessage;
window.addChatMessage = addChatMessage;
window.appendToken = appendToken;
window.finishAssistantMessage = finishAssistantMessage;
window.copyMessage = copyMessage;
window.regenerateMessage = regenerateMessage;
window.newChat = newChat;
window.useSuggestion = useSuggestion;
window.abortChat = abortChat;

// 세션
window.getOrCreateAnonymousSessionId = getOrCreateAnonymousSessionId;
window.loadChatSessions = loadChatSessions;
window.formatTimeAgo = formatTimeAgo;
window.createNewSession = createNewSession;
window.loadSession = loadSession;
window.addRestoredAssistantMessage = addRestoredAssistantMessage;
window.saveMessageToSession = saveMessageToSession;
window.deleteSession = deleteSession;
window.addToChatHistory = addToChatHistory;

// 파일 업로드
window.uploadFile = uploadFile;
window.setupFileInput = setupFileInput;
window.setupChatDropZone = setupChatDropZone;
window.renderAttachments = renderAttachments;
window.removeAttachment = removeAttachment;
window.clearAttachments = clearAttachments;

// 모드 토글
window.toggleDiscussionMode = toggleDiscussionMode;
window.toggleThinkingMode = toggleThinkingMode;
window.toggleDeepResearch = toggleDeepResearch;
window.showDiscussionProgress = showDiscussionProgress;
window.showResearchProgress = showResearchProgress;

// 클러스터
window.BRAND_MODELS = BRAND_MODELS;
window.updateClusterInfo = updateClusterInfo;
window.updateSidebarClusterInfo = updateSidebarClusterInfo;
window.updateClusterStatus = updateClusterStatus;
window.fetchClusterInfoFallback = fetchClusterInfoFallback;
window.updateModelSelect = updateModelSelect;
window.handleClusterEvent = handleClusterEvent;
window.showAgentBadge = showAgentBadge;
window.selectModel = selectModel;
window.loadModelInfo = loadModelInfo;
window.formatSize = formatSize;

// 문서
window.updateActiveDocumentUI = updateActiveDocumentUI;
window.clearActiveDocument = clearActiveDocument;
window.askDocumentQuestion = askDocumentQuestion;
window.formatSummaryResponse = formatSummaryResponse;
window.showDocumentProgress = showDocumentProgress;

// 에러 핸들러 / 기능 카드
window.startFeatureChat = startFeatureChat;
window.handleCommand = handleCommand;
window.showHelpAndMessage = showHelpAndMessage;
window.performWebSearch = performWebSearch;
window.syncMCPSettingsToServer = syncMCPSettingsToServer;
window.syncMCPSettingsFromServer = syncMCPSettingsFromServer;
window.useMode = useMode;
window.showHelpPopup = showHelpPopup;
window.hideHelpPopup = hideHelpPopup;
window.hideHelpPopupDelayed = hideHelpPopupDelayed;
window.closeHelpPopup = closeHelpPopup;

// 가이드
window.showUserGuide = showUserGuide;
window.closeGuideModal = closeGuideModal;

// 앱 초기화 (main.js 자체)
window.initApp = initApp;
window.renderAgentList = renderAgentList;
window.filterRestrictedMenus = filterRestrictedMenus;
window.showUserStatusBadge = showUserStatusBadge;
window.toggleMobileSidebar = toggleMobileSidebarLegacy;
window.closeMobileSidebar = closeMobileSidebar;
window.closeSidebarOnMobileNav = closeSidebarOnMobileNav;
window.initMobileSidebar = initMobileSidebar;

// 네비게이션 데이터
window.NAV_ITEMS = NAV_ITEMS;

// SPA 라우터 (이미 spa-router.js에서 window.Router 설정됨, 여기서 보장)
window.Router = Router;
window.SPARouter = Router;
window.SafeStorage = SafeStorage;

// 컴포넌트 (이미 각 파일에서 window.* 설정됨, 여기서 보장)
window.UnifiedSidebar = UnifiedSidebar;
window.AdminPanel = AdminPanel;

// 초기화 플래그 — 레거시 app.js 중복 로드 방지
window._appInitialized = true;

// ============================================
// 8. 모듈 로드 시 initApp 자동 실행 (DOMContentLoaded 대체)
// ============================================
// ES module은 defer와 동일하게 DOM 파싱 후 실행되므로
// DOMContentLoaded 대신 직접 호출합니다.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
