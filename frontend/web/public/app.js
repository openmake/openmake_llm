/**
 * OpenMake.Ai - Premium UI (메인 애플리케이션)
 * ========================================
 *
 * 프론트엔드 모놀리스 파일 (~3500줄).
 * 인증, WebSocket 통신, 채팅 UI, 파일 첨부, 에이전트 배지,
 * MCP 설정, 테마, 세션 히스토리, 웹 검색, 마크다운 렌더링 등
 * 애플리케이션의 핵심 기능을 모두 포함합니다.
 *
 * @file app.js
 * @description 메인 SPA 애플리케이션 로직 (Vanilla JS, 프레임워크 없음)
 *
 * #6 개선: 모듈 분리 마이그레이션
 * ----------------------------------------
 * js/modules/ 아래에 도메인별 모듈이 준비되어 있습니다:
 *
 *   state.js     - 중앙 집중 상태 관리 (AppState, getState, setState)
 *   auth.js      - 인증 로직 (initAuth, authFetch, logout, updateAuthUI)
 *   ui.js        - UI 유틸리티 (showToast, escapeHtml, scrollToBottom, applyTheme)
 *   websocket.js - WebSocket 연결 및 메시지 핸들링
 *   chat.js      - 채팅 기능 (sendMessage, addChatMessage, appendToken)
 *   settings.js  - 설정 모달 및 MCP/프롬프트 모드
 *   utils.js     - 포맷팅, 디버그, 파일 유틸리티
 *   guide.js     - 사용자 가이드 렌더링
 *   sanitize.js  - XSS 방어 (escapeHTML, sanitizeHTML)
 *
 * 마이그레이션 절차:
 * 1. 각 모듈이 window 객체에 함수를 노출 (현재 완료)
 * 2. index.html에서 모듈 script 태그 추가 (Phase 2 준비됨)
 * 3. 이 파일의 해당 섹션을 제거하고 모듈로 대체
 * 4. 모든 모듈 전환 후 이 파일 삭제
 *
 * ========================================
 */

// ========================================
// 디버그 설정
// ========================================

// 🆕 Debug Mode - set to false for production
/** @type {boolean} 디버그 모드 플래그 - 프로덕션에서는 false */
const DEBUG_MODE = false;

/**
 * 디버그 로거 객체
 * DEBUG_MODE가 true일 때만 log/warn 출력, error는 항상 출력
 * @namespace debug
 */
const debug = {
    log: (...args) => DEBUG_MODE && console.log(...args),
    warn: (...args) => DEBUG_MODE && console.warn(...args),
    error: (...args) => console.error(...args)  // errors always show
};

// ========================================
// 전역 상태 변수
// ========================================

/** @type {WebSocket|null} 채팅 스트리밍용 WebSocket 연결 */
let ws = null;
/** @type {Array<Object>} 클러스터 노드 목록 (Ollama 인스턴스) */
let nodes = [];
/** @type {Array<string>} 채팅 입력 히스토리 (로컬) */
let chatHistory = [];
/** @type {string|null} 현재 활성 채팅 ID */
let currentChatId = null;
/** @type {boolean} 웹 검색 모드 활성화 여부 */
let webSearchEnabled = false;
/** @type {boolean} 멀티 에이전트 토론 모드 활성화 여부 */
let discussionMode = false;  // 멀티 에이전트 토론 모드
/** @type {boolean} Ollama Native Thinking 모드 (심층 추론) 활성화 여부 */
let thinkingMode = false;    // Ollama Native Thinking 모드 (심층 추론)
/** @type {'low'|'medium'|'high'} Thinking 레벨 설정 */
let thinkingLevel = 'high'; // Thinking 레벨: 'low', 'medium', 'high'
/** @type {boolean} Deep Research 모드 (심층 연구) 활성화 여부 */
let deepResearchMode = false;  // Deep Research 모드 (심층 연구)
/** @type {boolean} Sequential Thinking MCP 도구 활성화 여부 */
let thinkingEnabled = true; // Sequential Thinking 기본 활성화
/** @type {Array<Object>} 현재 첨부된 파일 목록 ({filename, base64, isImage, docId, textContent} 등) */
let attachedFiles = [];
/** @type {number|null} AI 응답 시작 시간 (응답 소요 시간 측정용, ms) */
let messageStartTime = null;
/** @type {boolean} AI 응답 생성 중 여부 (중단 버튼 표시/숨김 제어) */
let isGenerating = false;  // 응답 생성 중 여부 (중단 버튼용)

// 인증 상태
/** @type {Object|null} 현재 로그인한 사용자 정보 ({email, role, name, ...}) */
let currentUser = null;
/** @type {string|null} JWT 인증 토큰 또는 'cookie-session' 마커 */
let authToken = null;
/** @type {boolean} 게스트 모드 활성화 여부 */
let isGuestMode = false;

// 대화 메모리 (LLM 컨텍스트용)
/** @type {Array<{role: string, content: string, images?: string[]}>} LLM 컨텍스트용 대화 메모리 배열 */
let conversationMemory = [];
/** @type {number} 대화 메모리 최대 항목 수 (초과 시 오래된 항목 제거) */
const MAX_MEMORY_LENGTH = 20;

// 세션 레벨 문서 컨텍스트 (PDF 업로드 시 저장, 모든 채팅에서 참조)
/** @type {{docId: string, filename: string, textLength: number}|null} 활성 문서 컨텍스트 (PDF 업로드 시 설정, 모든 채팅에서 자동 참조) */
let activeDocumentContext = null;  // { docId, filename, textLength }

// ========================================
// 인증 헬퍼 함수
// ========================================

// 🔒 Phase 3: 중복 isAdmin() 제거 — 아래 265번 줄의 정의 하나만 유지
// (이전: localStorage 파싱 방식 / 아래: currentUser 변수 직접 참조 방식)
// currentUser 변수 참조가 더 효율적이고 일관성 있음

/**
 * 인증 상태 초기화
 * 
 * 실행 순서:
 * 1. localStorage에서 authToken, guestMode, user 정보 복원
 * 2. updateAuthUI()로 UI 반영
 * 3. currentUser가 없으면 recoverSessionFromCookie()로 httpOnly 쿠키 기반 세션 복구
 * 4. 복구 완료 Promise를 window._authRecoveryPromise에 노출 (Router.start() 대기용)
 *
 * @async
 * @returns {Promise<void>}
 */
// 🔒 Phase 3 패치: async로 변경하여 세션 복구 완료를 보장 (경쟁 조건 해결)
async function initAuth() {
    // 🔒 OAuth 토큰은 이제 httpOnly 쿠키로 설정됨 (URL 파라미터 제거)
    // 브라우저가 자동으로 모든 요청에 포함시킴
    
    authToken = localStorage.getItem('authToken');
    isGuestMode = localStorage.getItem('guestMode') === 'true';

    const savedUser = localStorage.getItem('user');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
        } catch (e) {
            currentUser = null;
        }
    }

    updateAuthUI();

    // 🔒 OAuth 쿠키 기반 세션 복구: localStorage에 사용자 정보가 없으면
    // httpOnly 쿠키로 인증된 세션이 있는지 서버에 확인
    // 🔒 Phase 3: await로 세션 복구 완료까지 대기 (이전: fire-and-forget → race condition)
    if (!currentUser) {
        await recoverSessionFromCookie();
    }
    // Promise를 전역에 노출하여 Router.start()가 대기 가능 (하위호환)
    window._authRecoveryPromise = Promise.resolve();
}

/**
 * httpOnly 쿠키 기반 OAuth 세션 복구
 * 
 * localStorage에 사용자 정보가 없을 때 호출됨.
 * 서버의 /api/auth/me 엔드포인트에 쿠키를 포함하여 요청하고,
 * 유효한 세션이 있으면:
 * - currentUser 및 localStorage 업데이트
 * - authToken에 'cookie-session' 마커 설정
 * - state.js의 AppState 동기화
 * - UI 업데이트 (사이드바, 아바타 등)
 * - 익명 세션이 있으면 인증 사용자로 이관 (claim)
 *
 * @async
 * @returns {Promise<void>} 실패 시 조용히 무시 (비로그인 상태 유지)
 */
async function recoverSessionFromCookie() {
    try {
        const resp = await fetch('/api/auth/me', { credentials: 'include' });
        if (resp.ok) {
            const data = await resp.json();
            const user = data.data?.user || data.user;
            if (user && user.email) {
                // 세션 복구 성공: localStorage 업데이트
                currentUser = user;
                localStorage.setItem('user', JSON.stringify(user));
                localStorage.removeItem('guestMode');
                localStorage.removeItem('isGuest');
                isGuestMode = false;

                // 🔒 OAuth 세션 마커: httpOnly 쿠키 기반 인증임을 표시
                // spa-router.js의 isAuthenticated()가 이 값을 확인하여 인증 상태를 유지
                // 실제 JWT 토큰이 아니라 마커이므로 보안 위험 없음 (인증은 쿠키로 처리)
                if (!localStorage.getItem('authToken')) {
                    authToken = 'cookie-session';
                    localStorage.setItem('authToken', 'cookie-session');
                }
                
                // 모듈 상태도 동기화 (state.js의 AppState)
                if (typeof window.setState === 'function') {
                    window.setState('auth.currentUser', user);
                    window.setState('auth.authToken', localStorage.getItem('authToken'));
                    window.setState('auth.isGuestMode', false);
                }
                
                // UI 업데이트
                updateAuthUI();
                filterRestrictedMenus();
                
                // 사이드바 업데이트: sidebar 인스턴스가 이미 초기화되었으면 refresh()
                // (비동기 fetch 완료 시점에는 DOMContentLoaded가 이미 끝나 sidebar 존재)
                if (window.sidebar && typeof window.sidebar.refresh === 'function') {
                    window.sidebar.refresh();
                } else {
                    // sidebar가 아직 없으면 (극히 드문 경우) 직접 DOM 업데이트
                    const avatar = document.querySelector('.us-user-avatar');
                    const nameEl = document.querySelector('.us-user-name');
                    if (avatar) {
                        avatar.textContent = (user.name || user.email || '?').charAt(0).toUpperCase();
                    }
                    if (nameEl) {
                        nameEl.textContent = user.name || user.email || '사용자';
                        nameEl.title = user.email || '';
                    }
                    // sidebar가 나중에 초기화되면 그때 업데이트하도록 이벤트 대기
                    window.addEventListener('sidebarReady', function onReady() {
                        if (window.sidebar && typeof window.sidebar.refresh === 'function') {
                            window.sidebar.refresh();
                        }
                        window.removeEventListener('sidebarReady', onReady);
                    });
                }
                
                console.log('[Auth] OAuth 쿠키 세션 복구 성공:', user.email);

                // 🔒 Phase 3: 통합된 클레이밍 로직 (중복 제거)
                const anonSessionId = sessionStorage.getItem('anonSessionId');
                if (anonSessionId) {
                    try {
                        await authFetch('/api/chat/sessions/claim', {
                            method: 'POST',
                            body: JSON.stringify({ anonSessionId })
                        });
                        sessionStorage.removeItem('anonSessionId');
                        console.log('[Auth] 익명 세션 이관 완료:', anonSessionId);
                        if (window.sidebar && typeof window.sidebar.refresh === 'function') {
                            window.sidebar.refresh();
                        }
                        loadChatSessions();
                    } catch (claimErr) {
                        console.warn('[Auth] 익명 세션 이관 실패 (무시):', claimErr);
                    }
                }
            }
        }
    } catch (e) {
        // 네트워크 오류 등 — 무시 (비로그인 상태 유지)
    }
}

/**
 * 인증 정보를 포함한 fetch 요청 래퍼
 * 
 * Authorization 헤더에 JWT 토큰을 추가하고,
 * credentials: 'include'로 httpOnly 쿠키를 자동 포함합니다.
 * 모든 인증이 필요한 API 호출에 사용합니다.
 *
 * @async
 * @param {string} url - 요청 URL
 * @param {RequestInit} [options={}] - fetch 옵션 (headers, method, body 등)
 * @returns {Promise<Response>} fetch 응답 객체
 */
async function authFetch(url, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }

    return fetch(url, {
        ...options,
        credentials: 'include',  // 🔒 httpOnly 쿠키 자동 포함
        headers
    });
}

// 🔧 전역 노출: UnifiedSidebar 등 외부 컴포넌트에서 인증 fetch 사용 가능
window.authFetch = authFetch;

/**
 * 로그아웃 처리
 * 
 * 1. 서버에 POST /api/auth/logout 요청 (httpOnly 쿠키 포함, 토큰 블랙리스트 등록)
 * 2. localStorage에서 인증 관련 데이터 제거
 * 3. 전역 인증 변수 초기화
 * 4. 로그인 페이지로 리다이렉트
 *
 * @returns {void}
 */
function logout() {
    // 서버에 로그아웃 요청 (httpOnly 쿠키 포함)
    authFetch('/api/auth/logout', {
        method: 'POST'
    }).catch(() => {}); // 네트워크 오류 무시

    // localStorage 정리
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    localStorage.removeItem('guestMode');
    authToken = null;
    currentUser = null;
    isGuestMode = false;
    window.location.href = '/login.html';
}

/**
 * 인증 상태에 따라 UI 요소를 업데이트
 * 
 * currentUser, isGuestMode 상태에 따라
 * 사용자 정보, 로그인/로그아웃 버튼, 관리자 메뉴 링크의 표시 여부를 제어합니다.
 *
 * @returns {void}
 */
function updateAuthUI() {
    const userInfo = document.getElementById('userInfo');
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const adminLink = document.getElementById('adminLink');

    if (currentUser) {
        if (userInfo) {
            userInfo.textContent = currentUser.email;
            userInfo.style.display = 'block';
        }
        if (loginBtn) loginBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'block';
        if (adminLink) {
            adminLink.style.display = currentUser.role === 'admin' ? 'block' : 'none';
        }
    } else if (isGuestMode) {
        if (userInfo) {
            userInfo.textContent = '게스트';
            userInfo.style.display = 'block';
        }
        if (loginBtn) loginBtn.style.display = 'block';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (adminLink) adminLink.style.display = 'none';
    } else {
        if (userInfo) userInfo.style.display = 'none';
        if (loginBtn) loginBtn.style.display = 'block';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (adminLink) adminLink.style.display = 'none';
    }
}

/**
 * 현재 사용자가 관리자 권한인지 확인
 * @returns {boolean} admin 역할이면 true
 */
function isAdmin() {
    return currentUser?.role === 'admin';
}

/**
 * 현재 로그인 상태인지 확인
 * @returns {boolean} currentUser가 존재하면 true
 */
function isLoggedIn() {
    return !!currentUser;
}

// ========================================
// 에이전트 목록 렌더링
// ========================================

/**
 * WebSocket으로 수신한 에이전트 목록을 DOM에 렌더링
 * 
 * 로컬 에이전트(local://)와 원격 에이전트를 아이콘으로 구분하여 표시합니다.
 *
 * @param {Array<{url: string, name?: string}>} agents - 에이전트 배열
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

// ========================================
// 애플리케이션 초기화
// ========================================

/**
 * 애플리케이션 메인 초기화 함수
 * 
 * index.html의 onload에서 호출되며, 다음 순서로 초기화합니다:
 * 1. initAuth() - 인증 상태 초기화 (세션 복구 await)
 * 2. filterRestrictedMenus() - 권한별 메뉴 필터링
 * 3. connectWebSocket() - 실시간 스트리밍 연결
 * 4. applyTheme() - 저장된 테마 적용
 * 5. loadMCPSettings() - MCP 도구 설정 로드
 * 6. loadPromptMode() / loadAgentMode() - 프롬프트/에이전트 모드 복원
 * 7. loadChatSessions() - 사이드바 대화 히스토리 로드
 * 8. initMobileSidebar() - 모바일 사이드바 초기화
 * 9. URL 파라미터에서 sessionId 확인하여 대화 복원
 *
 * @async
 * @returns {Promise<void>}
 */
// 🔒 Phase 3: async로 변경하여 initAuth() 완료까지 대기
async function initApp() {
    await initAuth(); // 인증 상태 초기화 (세션 복구 완료까지 대기)
    filterRestrictedMenus(); // 게스트/비로그인 메뉴 필터링
    connectWebSocket();
    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);
    loadMCPSettings();
    loadPromptMode();
    loadAgentMode(); // Agent Mode 상태 로드
    loadChatSessions(); // 🆕 대화 히스토리 로드
    initMobileSidebar(); // 📱 모바일 사이드바 초기화

    // URL 파라미터 체크 (세션 복원)
    // ?sessionId= 우선, ?chat= fallback (UnifiedSidebar 호환)
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('sessionId') || urlParams.get('chat');
    // sessionStorage 체크 (history.js goToSession에서 전달 — Router가 query string을 제거하므로)
    const pendingSessionId = sessionStorage.getItem('pendingSessionId');
    if (pendingSessionId) {
        sessionStorage.removeItem('pendingSessionId');
    }
    const targetSessionId = sessionId || pendingSessionId;
    if (targetSessionId) {
        // 약간의 지연 후 로드 (초기화 안정성 확보)
        setTimeout(() => loadSession(targetSessionId), 100);
    }

    // WebSocket 연결 후 자동으로 에이전트 목록 요청됨 (connectWebSocket의 onopen에서 처리)
}

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

        // 사이드바 숨김 상태 보장
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
    const authToken = localStorage.getItem('authToken');
    const isGuest = localStorage.getItem('guestMode') === 'true' || localStorage.getItem('isGuest') === 'true';
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
        const user = JSON.parse(localStorage.getItem('user') || '{}');
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
function toggleMobileSidebar(e) {
    if (e) e.preventDefault();
    console.log('[Mobile] toggleMobileSidebar called');

    // UnifiedSidebar 인스턴스 사용 (index.html에서 window.sidebar로 노출)
    if (window.sidebar && typeof window.sidebar.toggle === 'function') {
        window.sidebar.toggle();
        _syncHamburgerIcon();
        console.log('[Mobile] Sidebar toggled via UnifiedSidebar');
    } else {
        console.error('[Mobile] UnifiedSidebar instance not found');
    }
}

/**
 * 햄버거 메뉴 아이콘 상태를 사이드바 상태와 동기화
 * 
 * UnifiedSidebar의 현재 상태(hidden/full/icon)에 따라
 * 모바일 메뉴 버튼의 active 클래스를 토글합니다.
 *
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

// DOMContentLoaded에서 터치 이벤트 추가
document.addEventListener('DOMContentLoaded', function () {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('touchstart', function (e) {
            e.preventDefault();
            toggleMobileSidebar();
        }, { passive: false });
        console.log('[Mobile] Touch event listener added to menu button');
    }
});

/**
 * 모바일 사이드바를 닫기 (hidden 상태로 전환)
 * @returns {void}
 */
function closeMobileSidebar() {
    // UnifiedSidebar로 닫기
    if (window.sidebar && typeof window.sidebar.setState === 'function') {
        window.sidebar.setState('hidden');
    }
    const menuBtn = document.getElementById('mobileMenuBtn');
    if (menuBtn) menuBtn.classList.remove('active');
}

/**
 * 사이드바 메뉴 항목 클릭 시 모바일에서 자동으로 사이드바 닫기
 * 
 * 화면 너비 768px 이하일 때만 동작합니다.
 *
 * @returns {void}
 */
function closeSidebarOnMobileNav() {
    if (window.innerWidth <= 768) {
        closeMobileSidebar();
    }
}


// ========================================
// Theme Management
// ========================================

/**
 * 테마를 HTML 루트 요소에 적용
 * 
 * 'system' 테마는 prefers-color-scheme 미디어 쿼리로 자동 감지합니다.
 *
 * @param {'dark'|'light'|'system'} theme - 적용할 테마
 * @returns {void}
 */
function applyTheme(theme) {
    if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }
}

/**
 * 현재 테마를 dark/light 간 토글
 * @returns {void}
 */
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);
}

/**
 * 테마를 설정하고 localStorage에 저장, 설정 모달 버튼 상태 업데이트
 *
 * @param {'dark'|'light'|'system'} theme - 설정할 테마
 * @returns {void}
 */
function setTheme(theme) {
    localStorage.setItem('theme', theme);
    applyTheme(theme);

    // 설정 모달 테마 버튼 상태 업데이트
    ['light', 'dark', 'system'].forEach(t => {
        const btn = document.getElementById(`theme-${t}`);
        if (btn) btn.classList.toggle('active', t === theme);
    });
}

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (localStorage.getItem('theme') === 'system') {
        applyTheme('system');
    }
});

// ========================================
// 제안 카드 (Welcome Screen)
// ========================================

/**
 * 환영 화면의 제안 카드 텍스트를 채팅 입력창에 채우기
 *
 * @param {string} text - 채팅 입력창에 설정할 텍스트
 * @returns {void}
 */
function useSuggestion(text) {
    const input = document.getElementById('chatInput');
    input.value = text;
    input.focus();
    // Hide welcome screen
    const welcomeScreen = document.getElementById('welcomeScreen');
    if (welcomeScreen) welcomeScreen.style.display = 'none';
}

// ========================================
// WebSocket 연결 및 메시지 처리
// ========================================

/** @type {number} 현재 재연결 시도 횟수 */
let reconnectAttempts = 0;
/** @type {number} 최대 재연결 시도 횟수 */
const MAX_RECONNECT_ATTEMPTS = 10;
/** @type {number} 초기 재연결 대기 시간 (ms) - exponential backoff 기준값 */
const INITIAL_RECONNECT_DELAY = 1000;

/**
 * 채팅 스트리밍용 WebSocket 연결 수립
 *
 * 이 WebSocket은 실시간 채팅 토큰 스트리밍(SSE 유사)을 처리합니다.
 * websocket.js의 별도 WebSocket은 시스템 메시지(에이전트, 새로고침, 하트비트)를 처리합니다.
 * 두 연결은 메시지 라우팅 복잡성을 피하기 위해 분리 유지해야 합니다.
 *
 * 재연결 전략 (Exponential Backoff):
 * - 연결 종료 시 INITIAL_RECONNECT_DELAY * 2^(시도횟수) 만큼 대기 후 재시도
 * - 최대 MAX_RECONNECT_ATTEMPTS(10)회까지 시도
 * - 예: 1초 -> 2초 -> 4초 -> 8초 -> 16초 -> ...
 * - 연결 성공 시 reconnectAttempts를 0으로 리셋
 * - 최대 시도 초과 시 사용자에게 새로고침 안내
 *
 * onopen 동작:
 * - 에이전트 목록 및 클러스터 정보 요청
 * - REST API 폴백으로 클러스터 정보 추가 확보 (1초 후 재확인)
 *
 * onclose 동작:
 * - isSending 플래그 리셋 (전송 중 연결 끊김 대비)
 * - exponential backoff 재연결 스케줄링
 *
 * onerror 동작:
 * - 상태 표시 업데이트, isSending 리셋
 *
 * onmessage 동작:
 * - JSON 파싱 후 handleMessage()에 위임
 *
 * @returns {void}
 */
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);

    // 연결 중 상태
    updateConnectionStatus('connecting', '연결 중...');

    ws.onopen = () => {
        console.log('WebSocket 연결 성공');
        reconnectAttempts = 0; // 연결 성공 시 재시도 카운트 리셋
        showToast('서버 연결됨', 'success');
        updateClusterStatus('연결됨', true);
        updateConnectionStatus('connected', '연결됨');
        // 에이전트 목록 요청
        ws.send(JSON.stringify({ type: 'request_agents' }));
        ws.send(JSON.stringify({ type: 'refresh' })); // Keep existing refresh

        // REST API 폴백: WebSocket init 메시지가 안 올 경우를 대비
        // 연결 직후 바로 클러스터 정보도 가져옴
        fetchClusterInfoFallback();

        setTimeout(() => {
            if (nodes.length === 0) {
                fetchClusterInfoFallback();
            }
        }, 1000);
    };


    ws.onclose = () => {
        console.log('WebSocket 연결 종료');
        updateClusterStatus('연결 끊김', false);
        updateConnectionStatus('disconnected', '연결 끊김');
        // 🔒 안전장치: 연결 종료 시 다음 메시지 전송 가능하도록 리셋
        isSending = false;

        // Exponential backoff 재연결
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
            reconnectAttempts++;

            console.log(`${delay / 1000}초 후 재연결 시도 (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
            showToast(`${delay / 1000}초 후 재연결 시도`, 'info');

            setTimeout(() => connectWebSocket(), delay);
        } else {
            console.error('최대 재연결 시도 횟수 초과');
            showToast('서버에 연결할 수 없습니다. 페이지를 새로고침하세요.', 'error');
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket 오류:', error);
        updateClusterStatus('오류', false);
        updateConnectionStatus('disconnected', '오류');
        // 🔒 안전장치: WebSocket 오류 시 다음 메시지 전송 가능하도록 리셋
        isSending = false;
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
    };
}

window.addEventListener('beforeunload', () => {
    if (ws) {
        ws.close();
    }
});

/**
 * WebSocket 연결 상태를 UI에 반영
 *
 * @param {'connected'|'disconnected'|'connecting'} status - 연결 상태
 * @param {string} text - 표시할 텍스트 (예: '연결됨', '연결 끊김')
 * @returns {void}
 */
function updateConnectionStatus(status, text) {
    const statusEl = document.getElementById('connectionStatus');
    if (!statusEl) return;

    statusEl.classList.remove('connected', 'disconnected', 'connecting');
    if (status === 'disconnected') {
        statusEl.classList.add('disconnected');
    } else if (status === 'connecting') {
        statusEl.classList.add('connecting');
    }

    const textEl = statusEl.querySelector('.status-text');
    if (textEl) textEl.textContent = text;
}

/**
 * WebSocket 메시지 타입별 핸들러 (메인 메시지 라우터)
 *
 * 수신 가능한 메시지 타입:
 * - 'init'/'update'         : 클러스터 노드 정보 업데이트
 * - 'token'                 : AI 응답 토큰 (스트리밍, appendToken으로 실시간 표시)
 * - 'done'                  : AI 응답 완료 (마크다운 렌더링, 메모리 저장)
 * - 'stats'                 : MCP 도구 사용 통계
 * - 'agents'                : 에이전트 목록 갱신
 * - 'error'                 : 에러 (API 키 소진 시 특별 배너 표시)
 * - 'aborted'               : 사용자 중단 확인
 * - 'cluster_event'         : 클러스터 노드 변경 이벤트
 * - 'document_progress'     : 문서 분석 진행률 (PDF, OCR 등)
 * - 'mcp_settings_ack'      : MCP 설정 서버 동기화 확인
 * - 'mcp_settings_update'   : 외부에서 MCP 설정 변경 시 UI 동기화
 * - 'agent_selected'        : AI가 선택한 에이전트 배지 표시
 * - 'discussion_progress'   : 멀티 에이전트 토론 진행률
 * - 'research_progress'     : Deep Research 진행률
 * - 'session_created'       : 새 채팅 세션 ID 수신
 *
 * @param {Object} data - 파싱된 WebSocket 메시지 객체
 * @param {string} data.type - 메시지 타입 식별자
 * @returns {void}
 */
function handleMessage(data) {
    switch (data.type) {
        case 'init':  // 초기 클러스터 정보
            updateClusterInfo(data.data);
            break;
        case 'update':  // 클러스터 정보 갱신
            updateClusterInfo(data.data);
            break;
        case 'token':  // AI 응답 토큰 (실시간 스트리밍)
            if (data.messageId) {
                window._lastTokenMessageId = data.messageId;
            }
            appendToken(data.token);
            break;
        case 'done':  // AI 응답 완료 - 마크다운 렌더링 및 메모리 저장 트리거
            finishAssistantMessage();
            break;
        case 'stats':  // MCP 도구 사용 통계
            // MCP stats 데이터 수신 — 상태 저장
            if (data.stats) {
                window._mcpStats = data.stats;
            }
            break;
        case 'agents':  // 에이전트 목록
            renderAgentList(data.agents);
            break;
        case 'error':  // 에러 처리
            // 🆕 API 키 소진 에러 특별 처리
            if (data.errorType === 'api_keys_exhausted') {
                showApiKeyExhaustedError(data);
            } else {
                showError(data.message);
            }
            break;
        case 'aborted':  // 사용자 중단 확인
            console.log('[Chat] 응답 생성 중단됨');
            isGenerating = false;
            isSending = false;
            hideAbortButton();
            break;
        case 'cluster_event':  // 클러스터 노드 변경
            handleClusterEvent(data.event);
            break;
        case 'document_progress':  // 문서 분석 진행률 (업로드, OCR, PDF 파싱 등)
            showDocumentProgress(data);
            break;
        case 'mcp_settings_ack':  // MCP 설정 서버 동기화 완료 확인
            // 서버에서 MCP 설정 동기화 완료 확인
            console.log('[MCP] 서버 동기화 완료:', data.settings);
            break;
        case 'mcp_settings_update':  // 외부에서 MCP 설정 변경 감지
            // 외부(REST API)에서 MCP 설정이 변경됨 - UI 동기화
            console.log('[MCP] 외부 설정 변경 감지:', data.settings);
            syncMCPSettingsFromServer(data.settings);
            showToast('🔄 MCP 설정이 외부에서 변경되었습니다', 'info');
            break;
        case 'agent_selected':  // AI 에이전트 자동 선택 결과
            // 에이전트 선택 정보 수신
            console.log('[Agent] 선택됨:', data.agent);
            showAgentBadge(data.agent);
            break;
        case 'discussion_progress':  // 멀티 에이전트 토론 진행률
            // 멀티 에이전트 토론 진행 상황
            console.log('[Discussion] 진행:', data.progress);
            showDiscussionProgress(data.progress);
            break;
        case 'research_progress':  // Deep Research 진행률
            // 🔬 Deep Research 진행 상황
            console.log('[Research] 진행:', data.progress);
            showResearchProgress({
                stage: data.progress?.currentStep || 'running',
                progress: data.progress?.progress || 0,
                message: data.progress?.message || '연구 중...'
            });
            break;
        case 'session_created':  // 새 채팅 세션 생성 알림
            // 🆕 WebSocket 채팅에서 생성된 새 세션 ID 수신
            console.log('[Session] 새 세션 생성:', data.sessionId);
            currentSessionId = data.sessionId;
            loadChatSessions(); // 사이드바 히스토리 새로고침
            break;
    }
}

/**
 * 클러스터 노드 정보를 전역 상태에 반영하고 UI 업데이트
 *
 * @param {Object} data - 클러스터 데이터
 * @param {Array<Object>} [data.nodes] - 노드 목록 ({id, name, host, port, status, models})
 * @returns {void}
 */
function updateClusterInfo(data) {
    if (!data) return;

    if (data.nodes) {
        nodes = data.nodes;
        updateModelSelect();
        const onlineCount = nodes.filter(n => n.status === 'online').length;
        updateClusterStatus(`${onlineCount} node online`, onlineCount > 0);

        // 사이드바 클러스터 정보도 업데이트
        updateSidebarClusterInfo();
    }
}

/**
 * 사이드바의 클러스터 상태 정보를 갱신
 * 
 * 전역 nodes 배열의 데이터를 사이드바의 clusterInfo 텍스트와
 * nodesList DOM에 반영합니다.
 *
 * @returns {void}
 */
function updateSidebarClusterInfo() {
    const clusterInfo = document.getElementById('clusterInfo');
    const nodesList = document.getElementById('nodesList');

    if (clusterInfo) {
        const onlineCount = nodes.filter(n => n.status === 'online').length;
        clusterInfo.textContent = `${nodes.length}개 노드 중 ${onlineCount}개 온라인`;
    }

    if (nodesList) {
        if (nodes.length > 0) {
            nodesList.innerHTML = nodes.map(n =>
                `<div style="margin: 4px 0; display: flex; align-items: center; gap: 8px;">
                    <span style="color: ${n.status === 'online' ? '#22c55e' : '#ef4444'}">●</span>
                    <div>
                        <div style="font-weight: 500;">${escapeHtml(n.name || n.id)}</div>
                        <div style="font-size: 12px; color: var(--text-muted);">${escapeHtml(n.host)}:${escapeHtml(String(n.port))}</div>
                    </div>
                </div>`
            ).join('');
        } else {
            nodesList.innerHTML = '<div style="color: var(--text-muted);">노드 없음</div>';
        }
    }
}

/**
 * 클러스터 연결 상태 텍스트와 점 색상 업데이트
 *
 * @param {string} text - 표시할 상태 텍스트 (예: '2 node online')
 * @param {boolean} online - 온라인 상태 여부 (점 색상 결정)
 * @returns {void}
 */
function updateClusterStatus(text, online) {
    const statusText = document.getElementById('clusterStatusText');
    const statusDot = document.querySelector('.status-dot');

    if (statusText) statusText.textContent = text;
    if (statusDot) {
        statusDot.classList.toggle('online', online);
        statusDot.classList.toggle('offline', !online);
    }
}

/**
 * REST API 폴백: WebSocket init 메시지가 도착하지 않을 때 클러스터 정보 가져오기
 * 
 * GET /api/cluster 엔드포인트를 호출하여 노드 정보를 업데이트합니다.
 * WebSocket이 주 채널이므로 실패 시 조용히 무시합니다.
 *
 * @async
 * @returns {Promise<void>}
 */
async function fetchClusterInfoFallback() {
    try {
        const response = await fetch('/api/cluster', {
            credentials: 'include'  // 🔒 httpOnly 쿠키 포함
        });
        if (response.ok) {
            const data = await response.json();
            updateClusterInfo(data);
        }
    } catch (error) {
        // REST API 폴백 실패 — 무시 (WebSocket이 주 채널)
    }
}

// ========================================
// 브랜드 모델 프로파일
// ========================================

/**
 * 브랜드 모델 프로파일 정의
 * 
 * backend의 pipeline-profile.ts와 동기화되어야 합니다.
 * 각 프로파일은 고유한 파이프라인 전략(엔진, A2A, Thinking, Discussion)을 가집니다.
 *
 * @type {Array<{id: string, name: string, desc: string}>}
 */
const BRAND_MODELS = [
    { id: 'openmake_llm_auto', name: 'OpenMake LLM Auto', desc: '자동 라우팅' },
    { id: 'openmake_llm', name: 'OpenMake LLM', desc: '균형 잡힌 범용' },
    { id: 'openmake_llm_pro', name: 'OpenMake LLM Pro', desc: '프리미엄 품질' },
    { id: 'openmake_llm_fast', name: 'OpenMake LLM Fast', desc: '속도 최적화' },
    { id: 'openmake_llm_think', name: 'OpenMake LLM Think', desc: '심층 추론' },
    { id: 'openmake_llm_code', name: 'OpenMake LLM Code', desc: '코드 전문' },
    { id: 'openmake_llm_vision', name: 'OpenMake LLM Vision', desc: '멀티모달' },
];

/**
 * 모델 선택 드롭다운(select) UI를 브랜드 모델 프로파일로 업데이트
 * 
 * 관리자가 아니면 자동 라우팅(Auto) 모델만 표시하고 선택 불가 처리합니다.
 * localStorage의 savedModel 값으로 이전 선택을 복원합니다.
 *
 * @returns {void}
 */
function updateModelSelect() {
    const select = document.getElementById('modelSelect');
    if (!select) return;

    // 🔒 관리자가 아니면 모델 이름 숨김
    if (!isAdmin()) {
        select.innerHTML = '<option value="openmake_llm_auto">OpenMake LLM Auto</option>';
        select.disabled = true;
        select.style.cursor = 'default';
        return;
    }

    select.disabled = false;
    select.style.cursor = 'pointer';

    const savedModel = localStorage.getItem('selectedModel');
    const defaultModelId = 'openmake_llm_auto';

    // 브랜드 모델 프로파일로 셀렉트 박스 구성
    select.innerHTML = BRAND_MODELS.map(m => {
        const isSelected = savedModel ? m.id === savedModel : m.id === defaultModelId;
        return `<option value="${escapeHtml(m.id)}" ${isSelected ? 'selected' : ''}>${escapeHtml(m.name)}</option>`;
    }).join('');

    if (!savedModel && select.value) {
        localStorage.setItem('selectedModel', select.value);
    }

    // Change 이벤트 리스너 추가 (중복 방지)
    select.onchange = function () {
        localStorage.setItem('selectedModel', this.value);
        const brandModel = BRAND_MODELS.find(m => m.id === this.value);
        const displayName = brandModel ? brandModel.name : this.value;
        showToast(`🤖 모델 변경됨: ${displayName}`);
    };
}

/**
 * 클러스터 이벤트 수신 시 노드 정보 새로고침 요청
 *
 * @param {Object} event - 클러스터 이벤트 데이터
 * @returns {void}
 */
function handleClusterEvent(event) {
    ws.send(JSON.stringify({ type: 'refresh' }));
}

// ========================================
// 채팅 메시지 전송 및 응답 처리
// ========================================

/** @type {HTMLElement|null} 현재 AI 응답이 렌더링되고 있는 DOM 요소 */
let currentAssistantMessage = null;
/** @type {boolean} 메시지 전송 중 여부 (중복 전송 방지 플래그) */
let isSending = false;  // 중복 전송 방지 플래그

// ========================================
// 중단 버튼 관리
// ========================================

/**
 * 응답 생성 중단
 */
function abortChat() {
    if (!isGenerating) return;
    
    console.log('[Chat] 응답 생성 중단 요청');
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'abort' }));
    }
    
    // UI 상태 업데이트
    isGenerating = false;
    isSending = false;
    hideAbortButton();
    
    // 현재 메시지에 중단 표시
    if (currentAssistantMessage) {
        const content = currentAssistantMessage.querySelector('.message-content');
        if (content) {
            // 🔒 Phase 3 보안 패치: innerHTML 대신 안전한 DOM API 사용 (XSS 방지)
            // rawText를 textContent로 삽입하여 스크립트 주입 차단
            const rawText = content.dataset.rawText || content.textContent || '';
            content.textContent = rawText;
            const abortNotice = document.createElement('span');
            abortNotice.style.cssText = 'color: var(--warning); font-style: italic; display: block; margin-top: 4px;';
            abortNotice.textContent = '⏹️ 응답이 중단되었습니다.';
            content.appendChild(abortNotice);
        }
    }
    currentAssistantMessage = null;
}

/** @type {string} 전송 버튼 SVG 아이콘 (화살표 모양) */
const SEND_ICON_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z"/></svg>';
/** @type {string} 중단 버튼 SVG 아이콘 (사각형 모양) */
const STOP_ICON_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

/**
 * 전송 버튼을 중단 모드로 전환
 * — 전송 아이콘 → 중단 아이콘, 파란색 → 빨간색
 */
function showAbortButton() {
    const btn = document.getElementById('sendBtn');
    if (!btn) return;

    btn.classList.add('abort-mode');
    btn.innerHTML = STOP_ICON_SVG;
    btn.title = '응답 생성 중단 (Enter)';
    btn.setAttribute('onclick', '');   // 기존 onclick 제거
    btn.onclick = abortChat;
}

/**
 * 전송 버튼을 원래 전송 모드로 복원
 * — 중단 아이콘 → 전송 아이콘, 빨간색 → 파란색
 */
function hideAbortButton() {
    const btn = document.getElementById('sendBtn');
    if (!btn) return;

    btn.classList.remove('abort-mode');
    btn.innerHTML = SEND_ICON_SVG;
    btn.title = '전송 (Enter)';
    btn.setAttribute('onclick', '');
    btn.onclick = sendMessage;
}

/**
 * 사용자 메시지를 WebSocket으로 전송
 * 
 * 메시지 전송 흐름:
 * 1. 중복 전송 방지 (isSending 체크)
 * 2. 입력값 및 WebSocket 상태 검증
 * 3. 모델 선택 (브랜드 모델 자동 라우팅 기본값)
 * 4. 첨부 파일 처리:
 *    - 이미지: base64 추출하여 멀티모달 전송
 *    - PDF/문서: 텍스트 컨텍스트를 메시지에 결합
 * 5. 모드별 분기 처리:
 *    - 첨부 파일 있음: 문서/이미지 컨텍스트 포함 전송
 *    - Deep Research 모드: type='chat' + deepResearchMode=true
 *    - 웹 검색 모드: performWebSearch() REST API 호출
 *    - 일반 채팅: type='chat' + 프롬프트 모드/에이전트 모드 적용
 * 6. 인증 정보(userId, userRole, userTier) 포함
 * 7. 익명 사용자는 anonSessionId 포함
 * 8. 30초 타임아웃으로 isSending 자동 리셋 (무한 차단 방지)
 *
 * @returns {void}
 */
function sendMessage() {
    // 이미 전송 중이면 무시
    if (isSending) {
        console.log('[sendMessage] 이미 전송 중, 무시');
        return;
    }

    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message && attachedFiles.length === 0) return;

    // WebSocket 연결 상태 확인
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('[sendMessage] WebSocket 연결 안됨, readyState:', ws?.readyState);
        showToast('서버에 연결되지 않았습니다. 재연결 중...', 'error');
        connectWebSocket();
        return;
    }

    isSending = true;  // 전송 시작
    console.log('[sendMessage] 메시지 전송 시작:', message.substring(0, 50));

    // 모델 선택기가 없으면 기본값 사용 (브랜드 모델 자동 라우팅)
    const model = document.getElementById('modelSelect')?.value || localStorage.getItem('selectedModel') || 'openmake_llm_auto';

    // 환영 화면 숨기기
    const welcomeScreen = document.getElementById('welcomeScreen');
    if (welcomeScreen) welcomeScreen.style.display = 'none';

    // 첨부 파일 처리
    let images = [];
    if (attachedFiles.length > 0) {
        images = attachedFiles.filter(f => f.isImage).map(f => f.base64);
        const fileInfo = attachedFiles.map(f => f.filename).join(', ');

        // PDF 문서의 텍스트 컨텍스트 수집
        const documentContexts = attachedFiles
            .filter(f => !f.isImage && f.textContent)
            .map(f => `### 📄 문서: ${f.filename}\n\n${f.textContent}`)
            .join('\n\n---\n\n');

        // 메시지에 문서 컨텍스트 결합 (문서가 있는 경우)
        let finalMessage = message || (images.length > 0 ? '이 이미지를 분석해줘' : '이 문서를 요약해주세요');
        if (documentContexts && !images.length) {
            finalMessage = `## 📚 업로드된 문서 내용\n\n${documentContexts}\n\n---\n\n## 사용자 요청\n\n${finalMessage}`;
        }

        const userMsg = `📎 ${fileInfo}\n\n${message || (images.length > 0 ? '이 이미지를 분석해줘' : '이 문서를 요약해주세요')}`;

        addChatMessage('user', userMsg);
        addToMemory('user', finalMessage, images);
        currentAssistantMessage = addChatMessage('assistant', '');
        isGenerating = true;
        showAbortButton();

        // WebSocket 전송 (문서 컨텍스트 포함)
        const anonId = !localStorage.getItem('authToken') ? getOrCreateAnonymousSessionId() : undefined;
        // 🔐 인증된 사용자 정보를 WebSocket 메시지에 포함
        const storedUser = localStorage.getItem('user');
        const parsedUser = storedUser ? JSON.parse(storedUser) : {};
        const authFields = {
            userId: parsedUser.userId || parsedUser.id || undefined,
            userRole: parsedUser.role || undefined,
            userTier: parsedUser.tier || undefined
        };
        ws.send(JSON.stringify({
            type: 'chat',
            message: finalMessage,
            model: model || undefined,
            history: conversationMemory.slice(-MAX_MEMORY_LENGTH),
            images: images,
            enableThinking: mcpSettings.thinking,
            enabledTools: mcpSettings.enabledTools || {},
            discussionMode: discussionMode,  // 🆕 멀티 에이전트 토론 모드
            thinkingMode: thinkingMode,      // 🆕 Ollama Native Thinking 모드
            thinkingLevel: thinkingMode ? thinkingLevel : undefined,
            anonSessionId: anonId,
            ...authFields
        }));
    } else if (deepResearchMode) {
        // 🔬 Deep Research 모드 (심층 연구) — 웹 검색보다 우선
        addChatMessage('user', `🔬 [심층 연구] ${message}`);
        addToMemory('user', message);
        currentAssistantMessage = addChatMessage('assistant', '');
        isGenerating = true;
        showAbortButton();
        showResearchProgress({ stage: 'starting', message: '심층 연구를 시작합니다...', progress: 0 });
        
        const anonId = !localStorage.getItem('authToken') ? getOrCreateAnonymousSessionId() : undefined;
        // 🔐 인증된 사용자 정보를 WebSocket 메시지에 포함
        const storedUser2 = localStorage.getItem('user');
        const parsedUser2 = storedUser2 ? JSON.parse(storedUser2) : {};
        const authFields2 = {
            userId: parsedUser2.userId || parsedUser2.id || undefined,
            userRole: parsedUser2.role || undefined,
            userTier: parsedUser2.tier || undefined
        };
        ws.send(JSON.stringify({
            type: 'chat',
            message,
            model: model || undefined,
            history: conversationMemory.slice(-MAX_MEMORY_LENGTH),
            deepResearchMode: true,
            enableThinking: mcpSettings.thinking,
            enabledTools: mcpSettings.enabledTools || {},
            thinkingMode: thinkingMode,
            thinkingLevel: thinkingMode ? thinkingLevel : undefined,
            anonSessionId: anonId,
            ...authFields2
        }));
    } else if (webSearchEnabled && !discussionMode) {
        // 웹 검색 모드 (토론 모드와 동시 사용 불가)
        addChatMessage('user', `🌐 ${message}`);
        addToMemory('user', message);
        currentAssistantMessage = addChatMessage('assistant', '');
        isGenerating = true;
        showAbortButton();
        performWebSearch(message, model);
    } else {
        // 일반 채팅 (활성 문서 컨텍스트 자동 포함)
        const displayMessage = activeDocumentContext
            ? `📄 [${activeDocumentContext.filename}] ${message}`
            : message;
        addChatMessage('user', displayMessage);
        addToMemory('user', message);
        currentAssistantMessage = addChatMessage('assistant', '');
        isGenerating = true;
        showAbortButton();

        // Agent Mode 활성화 시 강제로 agent 모드 적용
        const effectivePromptMode = agentModeEnabled ? 'agent' : currentPromptMode;

        // 메모리와 함께 메시지 전송 (docId로 문서 컨텍스트 자동 주입)
        const anonId = !localStorage.getItem('authToken') ? getOrCreateAnonymousSessionId() : undefined;
        // 🔐 인증된 사용자 정보를 WebSocket 메시지에 포함
        const storedUser3 = localStorage.getItem('user');
        const parsedUser3 = storedUser3 ? JSON.parse(storedUser3) : {};
        const authFields3 = {
            userId: parsedUser3.userId || parsedUser3.id || undefined,
            userRole: parsedUser3.role || undefined,
            userTier: parsedUser3.tier || undefined
        };
        ws.send(JSON.stringify({
            type: 'chat',
            message,
            model: model || undefined,
            history: conversationMemory.slice(-MAX_MEMORY_LENGTH),
            images,
            docId: activeDocumentContext?.docId,  // 활성 문서 ID 포함
            promptMode: effectivePromptMode,
            enableThinking: mcpSettings.thinking,
            enabledTools: mcpSettings.enabledTools || {},
            discussionMode: discussionMode,  // 멀티 에이전트 토론 모드
            thinkingMode: thinkingMode,      // 🧠 Ollama Native Thinking 모드
            thinkingLevel: thinkingMode ? thinkingLevel : undefined,  // Thinking 레벨
            anonSessionId: anonId,
            ...authFields3
        }));
    }

    input.value = '';
    input.style.height = 'auto';
    clearAttachments();
    addToChatHistory(message);

    // 🔒 안전장치: 30초 후 자동으로 isSending 리셋 (무한 차단 방지)
    setTimeout(() => {
        if (isSending) {
            console.warn('[sendMessage] 타임아웃 - isSending 강제 리셋');
            isSending = false;
        }
    }, 30000);

    // 스크롤 하단으로
    setTimeout(scrollToBottom, 100);
}

// ========================================
// 대화 메모리 관리
// ========================================

/**
 * 대화 항목을 LLM 컨텍스트 메모리에 추가
 * 
 * MAX_MEMORY_LENGTH * 2 초과 시 오래된 항목을 자동으로 잘라냅니다.
 * 이 메모리는 WebSocket 메시지의 history 필드로 서버에 전송됩니다.
 *
 * @param {'user'|'assistant'} role - 발화자 역할
 * @param {string} content - 메시지 내용
 * @param {string[]|null} [images=null] - base64 이미지 배열 (멀티모달용)
 * @returns {void}
 */
function addToMemory(role, content, images = null) {
    const memoryItem = { role, content };
    if (images && images.length > 0) memoryItem.images = images;
    conversationMemory.push(memoryItem);
    // 메모리 크기 제한
    if (conversationMemory.length > MAX_MEMORY_LENGTH * 2) {
        conversationMemory = conversationMemory.slice(-MAX_MEMORY_LENGTH);
    }
}

/**
 * 대화 메모리 초기화 (새 대화 시작 시 호출)
 * @returns {void}
 */
function clearMemory() {
    conversationMemory = [];
}

// ========================================
// 활성 문서 컨텍스트 UI
// ========================================

/**
 * 활성 문서 컨텍스트 배지를 채팅 입력 영역에 표시/제거
 * 
 * activeDocumentContext가 설정되어 있으면 파일명과 텍스트 길이를 표시하고,
 * null이면 배지를 제거합니다. 배지에는 닫기(X) 버튼이 포함됩니다.
 *
 * @returns {void}
 */
function updateActiveDocumentUI() {
    let badge = document.getElementById('activeDocBadge');

    if (!activeDocumentContext) {
        if (badge) badge.remove();
        return;
    }

    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'activeDocBadge';
        badge.className = 'active-doc-badge';
        badge.innerHTML = `
            <span class="doc-icon">📄</span>
            <span class="doc-name"></span>
            <button class="doc-clear" onclick="clearActiveDocument()" title="문서 컨텍스트 해제">✕</button>
        `;

        // 채팅 입력 영역 위에 배치
        const chatInputArea = document.querySelector('.chat-input-area');
        if (chatInputArea) {
            chatInputArea.insertBefore(badge, chatInputArea.firstChild);
        }
    }

    const docName = badge.querySelector('.doc-name');
    if (docName) {
        const truncatedName = activeDocumentContext.filename.length > 30
            ? activeDocumentContext.filename.substring(0, 27) + '...'
            : activeDocumentContext.filename;
        docName.textContent = `${truncatedName} (${(activeDocumentContext.textLength / 1000).toFixed(1)}K자)`;
    }
}

/**
 * 활성 문서 컨텍스트를 해제하고 배지 제거
 * @returns {void}
 */
function clearActiveDocument() {
    activeDocumentContext = null;
    updateActiveDocumentUI();
    showToast('📄 문서 컨텍스트가 해제되었습니다', 'info');
    console.log('[Document] 활성 문서 컨텍스트 해제');
}

// ========================================
// 에이전트 배지 표시
// ========================================

/** @type {Object|null} 현재 활성 에이전트 정보 ({name, emoji, reason, phase, confidence}) */
let currentAgent = null;

/**
 * AI가 선택한 에이전트의 배지를 채팅 영역에 표시
 * 
 * 에이전트의 이름, 이모지, 전문 분야, 현재 단계(planning/build/optimization)를
 * 시각적 배지로 표시합니다. 페이드인 애니메이션과 호버 효과를 포함합니다.
 *
 * @param {Object} agent - 에이전트 정보 객체
 * @param {string} agent.name - 에이전트 이름
 * @param {string} agent.emoji - 에이전트 이모지
 * @param {string} agent.reason - 선택 이유 텍스트
 * @param {'planning'|'build'|'optimization'} agent.phase - 현재 실행 단계
 * @param {number} agent.confidence - 선택 신뢰도 (0-1)
 * @returns {void}
 */
function showAgentBadge(agent) {
    currentAgent = agent;

    // 에이전트 배지 업데이트
    const badgeContainer = document.getElementById('agentBadge');
    if (badgeContainer) {
        const phaseColors = {
            planning: '#f59e0b',
            build: '#22c55e',
            optimization: '#3b82f6'
        };
        const phaseLabels = {
            planning: '기획',
            build: '구현',
            optimization: '최적화'
        };

        badgeContainer.innerHTML = `
            <div class="agent-badge" style="
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 6px 14px;
                background: var(--bg-secondary);
                border: 2px solid var(--border-light);
                border-radius: 20px;
                font-size: 0.85rem;
                color: var(--text-primary);
                box-shadow: 2px 2px 0 #000;
                animation: agentFadeIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                transition: all 0.3s ease;
            ">
                <span style="font-size: 1.1rem; filter: drop-shadow(2px 2px 0 #000);">${agent.emoji}</span>
                <div style="display: flex; flex-direction: column; line-height: 1.2;">
                    <span style="font-weight: 600; color: var(--accent-primary);">${agent.name}</span>
                    <span style="font-size: 0.7rem; color: var(--text-secondary); opacity: 0.8;">Expertise: ${agent.reason.split('단계로')[0].trim()}</span>
                </div>
                <span class="phase-indicator" style="
                    margin-left: 4px;
                    padding: 3px 8px;
                    background: ${phaseColors[agent.phase] || '#6366f1'};
                    color: white;
                    border-radius: 12px;
                    font-size: 0.65rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                ">${phaseLabels[agent.phase] || agent.phase}</span>
            </div>
            
            <style>
                @keyframes agentFadeIn {
                    from { opacity: 0; transform: translateY(10px) scale(0.95); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
                .agent-badge:hover {
                    transform: translate(-2px, -2px);
                    box-shadow: 4px 4px 0 #000;
                    border-color: var(--accent-primary);
                }
            </style>
        `;
        badgeContainer.style.display = 'block';
    }

    // 채팅 영역에 에이전트 선택 정보 표시 (선택 사항)
    if (agent.confidence > 0.3) {
        console.log(`[Agent] ${agent.emoji} ${agent.name} 활성화 - ${agent.reason}`);
    }
}

/**
 * 에이전트 배지를 숨기고 currentAgent를 초기화
 * @returns {void}
 */
function hideAgentBadge() {
    const badgeContainer = document.getElementById('agentBadge');
    if (badgeContainer) {
        badgeContainer.style.display = 'none';
    }
    currentAgent = null;
}

// ========================================
// 멀티 에이전트 토론 모드
// ========================================

/**
 * 멀티 에이전트 토론 모드 토글
 * 
 * 토론 모드와 웹 검색은 상호 배타적입니다.
 * 토론 모드 활성화 시 웹 검색을 자동 비활성화합니다.
 *
 * @returns {void}
 */
function toggleDiscussionMode() {
    discussionMode = !discussionMode;
    const btn = document.getElementById('discussionModeBtn');
    if (btn) {
        btn.classList.toggle('active', discussionMode);
        btn.title = discussionMode ? '토론 모드 활성화됨' : '토론 모드 비활성화됨';
    }
    
    // 토론 모드와 웹 검색은 동시 사용 불가 - 토론 모드 활성화 시 웹 검색 비활성화
    if (discussionMode && webSearchEnabled) {
        webSearchEnabled = false;
        const webSearchBtn = document.getElementById('webSearchBtn');
        if (webSearchBtn) {
            webSearchBtn.classList.remove('active');
        }
        showToast('🎯 멀티 에이전트 토론 모드 활성화 (웹 검색 비활성화됨)', 'info');
    } else {
        showToast(discussionMode ? '🎯 멀티 에이전트 토론 모드 활성화' : '💬 일반 모드로 전환', 'info');
    }
}

/**
 * Ollama Native Thinking 모드 토글
 * 
 * Thinking 모드 활성화 시 현재 thinkingLevel(low/medium/high)을 표시합니다.
 *
 * @returns {void}
 */
function toggleThinkingMode() {
    thinkingMode = !thinkingMode;
    const btn = document.getElementById('thinkingModeBtn');
    if (btn) {
        btn.classList.toggle('active', thinkingMode);
        btn.title = thinkingMode ? `Thinking 모드 활성화 (${thinkingLevel})` : 'Thinking 모드 비활성화';
    }
    showToast(thinkingMode ? `🧠 Thinking 모드 활성화 (레벨: ${thinkingLevel})` : '💬 일반 모드로 전환', 'info');
}

/**
 * Deep Research 모드 토글 (심층 연구)
 * 
 * Deep Research는 다른 모드(토론)와 상호 배타적입니다.
 * 활성화 시 토론 모드를 자동 비활성화합니다.
 * 주제를 입력하면 자율적 다단계 리서치 에이전트가 동작합니다.
 *
 * @returns {void}
 */
function toggleDeepResearch() {
    deepResearchMode = !deepResearchMode;
    const btn = document.getElementById('deepResearchBtn');
    if (btn) {
        btn.classList.toggle('active', deepResearchMode);
        btn.title = deepResearchMode ? 'Deep Research 모드 활성화' : 'Deep Research (심층 연구)';
    }
    
    // Deep Research 모드일 때 다른 모드 비활성화 (상호 배타적)
    if (deepResearchMode) {
        if (discussionMode) {
            discussionMode = false;
            const discussionBtn = document.getElementById('discussionModeBtn');
            if (discussionBtn) discussionBtn.classList.remove('active');
        }
        showToast('🔬 Deep Research 모드 활성화\n주제를 입력하면 자동으로 심층 연구를 수행합니다.', 'info');
    } else {
        showToast('💬 일반 모드로 전환', 'info');
    }
}

/**
 * 멀티 에이전트 토론 진행 상황을 미니바 스타일로 표시
 * 
 * 입력창 컨테이너 상단에 프로그레스 바와 메시지를 표시합니다.
 * 최초 호출 시 DOM 요소를 생성하고, 이후 호출에서는 업데이트만 합니다.
 * phase가 'complete'이면 1.5초 후 페이드아웃으로 자동 제거됩니다.
 *
 * @param {Object} progress - 토론 진행 정보
 * @param {number} progress.progress - 진행률 (0-100)
 * @param {string} progress.message - 현재 상태 메시지
 * @param {string} [progress.phase] - 토론 단계 ('complete' 시 자동 제거)
 * @returns {void}
 */
function showDiscussionProgress(progress) {
    let progressEl = document.getElementById('discussionProgress');

    if (!progressEl) {
        progressEl = document.createElement('div');
        progressEl.id = 'discussionProgress';
        progressEl.innerHTML = `
            <style>
                #discussionProgress {
                    margin: 0 auto 10px auto;
                    max-width: 600px;
                    background: var(--bg-card);
                    border: 2px solid var(--border-light);
                    border-radius: 20px;
                    padding: 8px 16px;
                    box-shadow: 2px 2px 0 #000;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-size: 0.85rem;
                    color: var(--text-primary);
                    backdrop-filter: none;
                    animation: slideUp 0.3s ease-out;
                }
                [data-theme="dark"] #discussionProgress {
                    background: var(--bg-card);
                    border-color: var(--border-light);
                }
                #discussionProgress .progress-icon {
                    font-size: 1.2rem;
                    animation: pulse 2s infinite;
                }
                #discussionProgress .progress-content {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                #discussionProgress .progress-header {
                    font-weight: 600;
                    display: flex;
                    justify-content: space-between;
                    font-size: 0.8rem;
                    color: var(--accent-primary);
                }
                #discussionProgress .progress-bar-bg {
                    background: var(--bg-tertiary);
                    height: 4px;
                    border-radius: 2px;
                    overflow: hidden;
                    width: 100%;
                }
                #discussionProgress .progress-fill {
                    background: var(--accent-primary);
                    height: 100%;
                    width: 0%;
                    transition: width 0.4s ease;
                    border-radius: 2px;
                }
                #discussionProgress .progress-message {
                    font-size: 0.75rem;
                    color: var(--text-secondary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes pulse {
                    0% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.1); opacity: 0.8; }
                    100% { transform: scale(1); opacity: 1; }
                }
            </style>
            <div class="progress-icon">🎯</div>
            <div class="progress-content">
            <div class="progress-header">
                <span>🎯 멀티 에이전트 토론 (v2)</span>
                <span class="progress-percent">0%</span>
            </div>
                <div class="progress-bar-bg"><div class="progress-fill"></div></div>
                <div class="progress-message">토론 준비 중...</div>
            </div>
        `;

        // 입력창 컨테이너 최상단에 추가 (입력창 바로 위)
        const inputContainer = document.querySelector('.input-container');
        if (inputContainer) {
            inputContainer.insertBefore(progressEl, inputContainer.firstChild);
        } else {
            document.body.appendChild(progressEl); // Fallback
        }
    }

    const fillEl = progressEl.querySelector('.progress-fill');
    const msgEl = progressEl.querySelector('.progress-message');
    const percentEl = progressEl.querySelector('.progress-percent');

    if (fillEl) fillEl.style.width = `${progress.progress}%`;
    if (msgEl) msgEl.textContent = progress.message;
    if (percentEl) percentEl.textContent = `${Math.round(progress.progress)}%`;

    // 완료 시 자동 제거
    if (progress.phase === 'complete') {
        setTimeout(() => {
            progressEl.style.opacity = '0';
            progressEl.style.transform = 'translateY(10px)';
            progressEl.style.transition = 'all 0.3s ease';
            setTimeout(() => progressEl.remove(), 300);
        }, 1500);
    }
}

/**
 * Deep Research 진행 상황을 미니바 스타일로 표시
 * 
 * 입력창 컨테이너 상단에 단계별 배지, 프로그레스 바, 메시지를 표시합니다.
 * 단계 라벨: starting, decompose, search, scrape, synthesize, report, complete
 * 'complete'/'completed' 시 2초 후 페이드아웃으로 자동 제거됩니다.
 *
 * @param {Object} progress - 리서치 진행 정보
 * @param {string} progress.stage - 현재 단계 ('starting'|'decompose'|'search'|'scrape'|'synthesize'|'report'|'complete')
 * @param {number} progress.progress - 진행률 (0-100)
 * @param {string} progress.message - 현재 상태 메시지
 * @returns {void}
 */
function showResearchProgress(progress) {
    let progressEl = document.getElementById('researchProgress');

    if (!progressEl) {
        progressEl = document.createElement('div');
        progressEl.id = 'researchProgress';
        progressEl.innerHTML = `
            <style>
                #researchProgress {
                    margin: 0 auto 10px auto;
                    max-width: 600px;
                    background: var(--bg-card);
                    border: 2px solid var(--border-light);
                    border-radius: 20px;
                    padding: 8px 16px;
                    box-shadow: 2px 2px 0 #000;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-size: 0.85rem;
                    color: var(--text-primary);
                    backdrop-filter: none;
                    animation: slideUp 0.3s ease-out;
                }
                [data-theme="dark"] #researchProgress {
                    background: var(--bg-card);
                    border-color: var(--border-light);
                }
                #researchProgress .progress-icon {
                    font-size: 1.2rem;
                    animation: researchPulse 2s infinite;
                }
                #researchProgress .progress-content {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                #researchProgress .progress-header {
                    font-weight: 600;
                    display: flex;
                    justify-content: space-between;
                    font-size: 0.8rem;
                    color: #8B5CF6;
                }
                #researchProgress .progress-bar-bg {
                    background: var(--bg-tertiary);
                    height: 4px;
                    border-radius: 2px;
                    overflow: hidden;
                    width: 100%;
                }
                #researchProgress .progress-fill {
                    background: var(--accent-primary);
                    height: 100%;
                    width: 0%;
                    transition: width 0.4s ease;
                    border-radius: 2px;
                }
                #researchProgress .progress-message {
                    font-size: 0.75rem;
                    color: var(--text-secondary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                #researchProgress .stage-badge {
                    font-size: 0.65rem;
                    padding: 2px 6px;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--border-light);
                    border-radius: 8px;
                    color: var(--accent-primary);
                    font-weight: 500;
                }
                @keyframes researchPulse {
                    0% { transform: scale(1) rotate(0deg); opacity: 1; }
                    25% { transform: scale(1.1) rotate(5deg); opacity: 0.9; }
                    50% { transform: scale(1) rotate(0deg); opacity: 1; }
                    75% { transform: scale(1.1) rotate(-5deg); opacity: 0.9; }
                    100% { transform: scale(1) rotate(0deg); opacity: 1; }
                }
            </style>
            <div class="progress-icon">🔬</div>
            <div class="progress-content">
            <div class="progress-header">
                <span>🔬 Deep Research</span>
                <span class="stage-badge">준비중</span>
                <span class="progress-percent">0%</span>
            </div>
                <div class="progress-bar-bg"><div class="progress-fill"></div></div>
                <div class="progress-message">심층 연구 시작 중...</div>
            </div>
        `;

        // 입력창 컨테이너 최상단에 추가 (입력창 바로 위)
        const inputContainer = document.querySelector('.input-container');
        if (inputContainer) {
            inputContainer.insertBefore(progressEl, inputContainer.firstChild);
        } else {
            document.body.appendChild(progressEl); // Fallback
        }
    }

    const fillEl = progressEl.querySelector('.progress-fill');
    const msgEl = progressEl.querySelector('.progress-message');
    const percentEl = progressEl.querySelector('.progress-percent');
    const stageEl = progressEl.querySelector('.stage-badge');

    // 스테이지별 표시
    const stageLabels = {
        'starting': '시작',
        '초기화': '초기화',
        'decompose': '주제 분석',
        'decomposing': '분석중',
        'search': '웹 검색',
        'searching': '검색중',
        'scrape': '콘텐츠 수집',
        'synthesize': '정보 합성',
        'synthesizing': '합성중',
        'report': '보고서 작성',
        'generating': '작성중',
        'complete': '완료',
        'completed': '완료'
    };

    if (fillEl) fillEl.style.width = `${progress.progress || 0}%`;
    if (msgEl) msgEl.textContent = progress.message || '처리 중...';
    if (percentEl) percentEl.textContent = `${Math.round(progress.progress || 0)}%`;
    if (stageEl) stageEl.textContent = stageLabels[progress.stage] || progress.stage || '진행중';

    // 완료 시 자동 제거 ('complete' 또는 'completed' 둘 다 처리)
    if (progress.stage === 'complete' || progress.stage === 'completed') {
        setTimeout(() => {
            progressEl.style.opacity = '0';
            progressEl.style.transform = 'translateY(10px)';
            progressEl.style.transition = 'all 0.3s ease';
            setTimeout(() => progressEl.remove(), 300);
        }, 2000);
    }
}

// ========================================
// 채팅 UI 유틸리티
// ========================================

/**
 * 채팅 영역을 최하단으로 스크롤
 * @returns {void}
 */
function scrollToBottom() {
    const chatArea = document.getElementById('chatArea');
    if (chatArea) {
        chatArea.scrollTop = chatArea.scrollHeight;
    }
}

/**
 * 채팅 메시지를 DOM에 추가
 * 
 * user 역할: 오른쪽 정렬, escapeHtml 적용, 사용자 아바타
 * assistant 역할: 왼쪽 정렬, 로딩 스피너 표시, 복사/재생성 액션 버튼 포함
 * AI 응답 시 messageStartTime을 기록하여 응답 소요 시간을 측정합니다.
 *
 * @param {'user'|'assistant'} role - 메시지 발화자 역할
 * @param {string} content - 메시지 내용 (user: 평문, assistant: 빈 문자열이면 로딩 표시)
 * @returns {HTMLElement} 생성된 메시지 DOM 요소
 */
function addChatMessage(role, content) {
    const container = document.getElementById('chatMessages');
    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const messageId = `msg-${Date.now()}`;

    const div = document.createElement('div');
    div.className = `chat-message ${role}`;
    div.id = messageId;

    if (role === 'user') {
        div.innerHTML = `
            <div class="message-wrapper">
                <div class="message-content">${escapeHtml(content).replace(/\n/g, '<br>')}</div>
                <div class="message-time">${timestamp}</div>
            </div>
            <div class="message-avatar">👤</div>
        `;
    } else {
        // AI 응답 시작 시간 기록
        messageStartTime = Date.now();
        div.innerHTML = `
            <div class="message-avatar">✨</div>
            <div class="message-wrapper">
                <div class="message-content">${content || '<span class="loading-spinner"></span> 생각 중...'}</div>
                <div class="message-actions">
                    <button class="message-action-btn" onclick="copyMessage('${messageId}')" title="복사">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        복사
                    </button>
                    <button class="message-action-btn" onclick="regenerateMessage()" title="재생성">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 4v6h6"/><path d="M23 20v-6h-6"/>
                            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                        </svg>
                        재생성
                    </button>
                </div>
                <div class="message-time" id="${messageId}-time">${timestamp}</div>
            </div>
        `;
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    // 스크롤
    const chatArea = document.getElementById('chatArea');
    chatArea.scrollTop = chatArea.scrollHeight;

    return div;
}

/**
 * 특정 메시지의 텍스트 내용을 클립보드에 복사
 *
 * @param {string} messageId - 복사할 메시지의 DOM ID
 * @returns {void}
 */
function copyMessage(messageId) {
    const msgElement = document.getElementById(messageId);
    if (!msgElement) return;

    const content = msgElement.querySelector('.message-content');
    if (!content) return;

    const text = content.innerText;
    navigator.clipboard.writeText(text).then(() => {
        showToast('클립보드에 복사됨');
    }).catch(err => {
        console.error('복사 실패:', err);
    });
}

/**
 * 마지막 사용자 메시지를 입력창에 복원하고 재전송
 * 
 * conversationMemory에서 마지막 user 메시지를 찾아
 * 입력창에 채운 뒤 sendMessage()를 호출합니다.
 *
 * @returns {void}
 */
function regenerateMessage() {
    // 마지막 사용자 메시지 찾기
    const lastUserContent = conversationMemory.filter(m => m.role === 'user').pop();
    if (lastUserContent) {
        const input = document.getElementById('chatInput');
        input.value = lastUserContent.content;
        sendMessage();
    }
}

/**
 * 화면 하단 중앙에 토스트 알림 표시 (2초 후 자동 제거)
 * 
 * 기존 토스트가 있으면 제거 후 새로 생성합니다.
 *
 * @param {string} message - 표시할 알림 메시지
 * @returns {void}
 */
function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--accent-primary);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 1000;
        animation: fadeIn 0.2s ease;
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// ========================================
// API 키 소진 에러 배너
// ========================================

/**
 * API 키 소진 에러 배너를 화면 상단에 표시 (카운트다운 포함)
 * 
 * 모든 API 키가 쿨다운 상태일 때 표시되며:
 * - 빨간색 배너로 키 소진 상태 안내
 * - 쿨다운 카운트다운 (분:초 형식)
 * - 카운트다운 완료 시 자동으로 배너 닫기 및 복구 알림
 * - 응답 생성 중이던 상태를 리셋
 *
 * @param {Object} data - API 키 소진 에러 데이터
 * @param {string} data.resetTime - 리셋 시간 (ISO 문자열)
 * @param {number} [data.retryAfter=300] - 재시도까지 대기 시간 (초)
 * @param {number} data.keysInCooldown - 쿨다운 중인 키 수
 * @param {number} data.totalKeys - 전체 키 수
 * @returns {void}
 */
function showApiKeyExhaustedError(data) {
    // 기존 배너 제거
    const existingBanner = document.getElementById('apiKeyExhaustedBanner');
    if (existingBanner) existingBanner.remove();

    // 리셋 시간 계산
    const resetTime = new Date(data.resetTime);
    const retryAfterSeconds = data.retryAfter || 300; // 기본 5분

    // 배너 생성
    const banner = document.createElement('div');
    banner.id = 'apiKeyExhaustedBanner';
    banner.innerHTML = `
        <style>
            #apiKeyExhaustedBanner {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                background: var(--danger);
                border-bottom: 2px solid #000;
                color: white;
                padding: 16px 24px;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 16px;
                font-size: 0.95rem;
                box-shadow: 0 4px 0 #000;
                animation: slideDown 0.3s ease-out;
            }
            #apiKeyExhaustedBanner .banner-icon {
                font-size: 1.5rem;
            }
            #apiKeyExhaustedBanner .banner-content {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            #apiKeyExhaustedBanner .banner-title {
                font-weight: 600;
                font-size: 1rem;
            }
            #apiKeyExhaustedBanner .banner-subtitle {
                font-size: 0.85rem;
                opacity: 0.9;
            }
            #apiKeyExhaustedBanner .countdown {
                background: var(--bg-tertiary);
                border: 2px solid #000;
                padding: 8px 16px;
                border-radius: 8px;
                font-weight: 600;
                font-size: 1.1rem;
                min-width: 80px;
                text-align: center;
            }
            #apiKeyExhaustedBanner .close-btn {
                background: var(--bg-tertiary);
                border: 2px solid #000;
                color: white;
                padding: 6px 12px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 0.85rem;
                box-shadow: 2px 2px 0 #000;
                transition: transform 0.1s;
            }
            #apiKeyExhaustedBanner .close-btn:hover {
                background: var(--bg-secondary);
                transform: translate(-1px, -1px);
                box-shadow: 3px 3px 0 #000;
            }
            @keyframes slideDown {
                from { transform: translateY(-100%); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
        </style>
        <span class="banner-icon">⚠️</span>
        <div class="banner-content">
            <span class="banner-title">모든 API 키가 일시적으로 사용 불가능합니다</span>
            <span class="banner-subtitle">${data.keysInCooldown}/${data.totalKeys}개 키 쿨다운 중 - 잠시 후 자동으로 복구됩니다</span>
        </div>
        <div class="countdown" id="apiKeyCountdown">${formatCountdown(retryAfterSeconds)}</div>
        <button class="close-btn" onclick="closeApiKeyExhaustedBanner()">닫기</button>
    `;

    document.body.appendChild(banner);

    // 카운트다운 시작
    let remainingSeconds = retryAfterSeconds;
    const countdownEl = document.getElementById('apiKeyCountdown');
    
    const countdownInterval = setInterval(() => {
        remainingSeconds--;
        if (countdownEl) {
            countdownEl.textContent = formatCountdown(remainingSeconds);
        }
        
        if (remainingSeconds <= 0) {
            clearInterval(countdownInterval);
            closeApiKeyExhaustedBanner();
            showToast('✅ API 키가 복구되었습니다. 다시 시도해주세요.', 'success');
        }
    }, 1000);

    // 배너에 인터벌 ID 저장 (닫을 때 정리용)
    banner.dataset.intervalId = countdownInterval;

    // 현재 응답 생성 중단
    isGenerating = false;
    isSending = false;
    hideAbortButton();
}

/**
 * 초를 '분:초' 형식 문자열로 변환
 *
 * @param {number} seconds - 남은 초
 * @returns {string} '분:초' 형식 (예: '4:30')
 */
function formatCountdown(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * API 키 소진 배너를 닫고 카운트다운 인터벌 정리
 * @returns {void}
 */
function closeApiKeyExhaustedBanner() {
    const banner = document.getElementById('apiKeyExhaustedBanner');
    if (banner) {
        // 카운트다운 인터벌 정리
        const intervalId = banner.dataset.intervalId;
        if (intervalId) {
            clearInterval(parseInt(intervalId));
        }
        
        banner.style.animation = 'slideDown 0.3s ease-out reverse';
        setTimeout(() => banner.remove(), 300);
    }
}

/**
 * AI 응답 토큰을 실시간으로 메시지 영역에 추가 (스트리밍 렌더링)
 * 
 * 토큰이 도착할 때마다 rawText에 누적하고, 표시 로직:
 * 1. [N/N] 패턴 감지: 단계별 사고 과정이면 진행 표시 ("분석 중... (N단계 진행)")
 * 2. 마지막 단계([N/N] where N=total) 도달 시 해당 부분만 표시
 * 3. "## 최종 답변" 등 마커 감지 시 해당 부분부터 표시
 * 4. 일반 응답이면 전체 텍스트 표시
 *
 * @param {string} token - 수신한 응답 토큰 (문자열 조각)
 * @returns {void}
 */
function appendToken(token) {
    if (currentAssistantMessage) {
        const content = currentAssistantMessage.querySelector('.message-content');
        // 로딩 스피너 제거
        const spinner = content.querySelector('.loading-spinner');
        if (spinner) spinner.remove();

        // 원본 텍스트 저장
        if (!content.dataset.rawText) content.dataset.rawText = '';
        content.dataset.rawText += token;

        const fullText = content.dataset.rawText;

        // [N/N] 형식 단계 패턴 감지 (예: [1/6], [6/6])
        const stepPattern = /\[(\d+)\/(\d+)\]/g;
        const matches = [...fullText.matchAll(stepPattern)];

        // 마지막 단계([N/N]) 찾기
        let finalStepIndex = -1;
        if (matches.length > 0) {
            const lastMatch = matches[matches.length - 1];
            const lastStepNum = parseInt(lastMatch[1]);
            const totalSteps = parseInt(lastMatch[2]);

            if (lastStepNum === totalSteps) {
                // 마지막 단계 시작 위치
                finalStepIndex = fullText.lastIndexOf(lastMatch[0]);
            }
        }

        // 기존 마커도 확인
        const finalAnswerMarkers = ['## 최종 답변', '## 답변', '## 결론', '## 요약'];
        for (const marker of finalAnswerMarkers) {
            const idx = fullText.lastIndexOf(marker);
            if (idx !== -1 && idx > finalStepIndex) {
                finalStepIndex = idx;
            }
        }

        // 생각 과정 패턴 감지
        const isThinking = /\[\d+\/\d+\]/.test(fullText) || /##\s*(단계|분석|Step)/i.test(fullText);

        if (finalStepIndex !== -1) {
            // 마지막 단계가 시작되면 그 부분만 표시
            content.textContent = fullText.substring(finalStepIndex);
        } else if (isThinking && fullText.length > 50) {
            // 생각 과정 중이면 진행 표시만
            const stepCount = matches.length;
            content.innerHTML = `<div style="color: #6b7280; font-style: italic;">🤔 분석 중... ${stepCount > 0 ? `(${stepCount}단계 진행)` : ''}</div>`;
        } else {
            // 일반 응답은 그대로 표시
            content.textContent = fullText;
        }

        const chatArea = document.getElementById('chatArea');
        chatArea.scrollTop = chatArea.scrollHeight;
    }
}

/**
 * AI 응답 완료 처리 (마크다운 렌더링, 메모리 저장, 상태 리셋)
 * 
 * 처리 흐름:
 * 1. rawText에서 단계별 사고 과정과 최종 답변을 분리
 *    - [N/N] 패턴으로 마지막 단계 감지
 *    - "## 최종 답변" 등 마커로 최종 답변 위치 감지
 * 2. 사고 과정이 있으면 details 태그로 접힌 상태로 표시
 * 3. 최종 답변을 marked.js로 마크다운 렌더링 (window.purifyHTML로 XSS 방어)
 * 4. hljs로 코드 블록 구문 강조 적용
 * 5. conversationMemory에 응답 저장
 * 6. saveMessageToSession()으로 서버에 영속화
 * 7. 응답 소요 시간 표시 (messageStartTime 기준)
 * 8. isSending, isGenerating 플래그 리셋, 중단 버튼 숨김
 *
 * @returns {void}
 */
function finishAssistantMessage() {
    console.log('[finishAssistantMessage] 호출됨, currentAssistantMessage:', !!currentAssistantMessage);
    // 마크다운 렌더링
    if (currentAssistantMessage && typeof marked !== 'undefined') {
        const content = currentAssistantMessage.querySelector('.message-content');
        const rawText = content.dataset.rawText || content.textContent;

        if (rawText) {
            try {
                // [N/N] 형식의 단계별 패턴 감지 (예: [1/6], [6/6])
                const stepPattern = /\[(\d+)\/(\d+)\]/g;
                const matches = [...rawText.matchAll(stepPattern)];

                let thinkingProcess = '';
                let finalAnswer = rawText;
                let hasSteps = false;

                if (matches.length > 0) {
                    // 마지막 단계 찾기 (예: [6/6])
                    const lastMatch = matches[matches.length - 1];
                    const lastStepNum = parseInt(lastMatch[1]);
                    const totalSteps = parseInt(lastMatch[2]);

                    // 마지막 단계인지 확인
                    if (lastStepNum === totalSteps) {
                        hasSteps = true;
                        const lastStepIndex = rawText.lastIndexOf(lastMatch[0]);
                        thinkingProcess = rawText.substring(0, lastStepIndex).trim();
                        finalAnswer = rawText.substring(lastStepIndex);
                    }
                }

                // 기존 마커도 확인 (## 최종 답변 등)
                if (!hasSteps) {
                    const finalAnswerMarkers = ['## 최종 답변', '## 답변', '## 결론', '## 요약', '### 결론', '### 답변', '[6/6]'];
                    let finalAnswerIndex = -1;

                    for (const marker of finalAnswerMarkers) {
                        const idx = rawText.lastIndexOf(marker);
                        if (idx !== -1 && idx > finalAnswerIndex) {
                            finalAnswerIndex = idx;
                        }
                    }

                    if (finalAnswerIndex > 50) {
                        hasSteps = true;
                        thinkingProcess = rawText.substring(0, finalAnswerIndex).trim();
                        finalAnswer = rawText.substring(finalAnswerIndex);
                    }
                }

                // marked 옵션 설정
                marked.setOptions({
                    breaks: true,
                    gfm: true,
                    highlight: function (code, lang) {
                        if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
                            try {
                                return hljs.highlight(code, { language: lang }).value;
                            } catch (e) { }
                        }
                        return code;
                    }
                });

                let finalHtml = '';

                // 생각 과정이 있으면 펼치기로 표시
                if (hasSteps && thinkingProcess.length > 50) {
                    // 최종 답변 렌더링
                    finalHtml = window.purifyHTML(marked.parse(finalAnswer));

                    // 생각 과정 펼치기 추가 (기본 접힘)
                    finalHtml += `
                        <details class="thinking-block">
                            <summary>
                                🧠 분석 과정 보기 (단계 1~${matches.length > 0 ? matches.length - 1 : '?'})
                            </summary>
                            <div class="thinking-content">
                                ${window.purifyHTML(marked.parse(thinkingProcess))}
                            </div>
                        </details>
                    `;
                } else {
                    // 생각 과정 없으면 전체 표시
                    finalHtml = window.purifyHTML(marked.parse(rawText));
                }

                content.innerHTML = finalHtml;
                console.log('[finishAssistantMessage] 마크다운 파싱 완료, HTML 길이:', finalHtml.length);
                content.classList.add('markdown-body');

                // 코드 블록에 하이라이팅 적용
                if (typeof hljs !== 'undefined') {
                    content.querySelectorAll('pre code').forEach((block) => {
                        hljs.highlightElement(block);
                    });
                }

                // 응답을 메모리에 저장
                addToMemory('assistant', rawText);
                saveMessageToSession('assistant', rawText); // 🆕 서버에 AI 응답 저장

                // 응답 시간 표시
                if (messageStartTime) {
                    const elapsed = ((Date.now() - messageStartTime) / 1000).toFixed(1);
                    const timeElement = currentAssistantMessage.querySelector('[id$="-time"]');
                    if (timeElement) {
                        const currentTime = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                        timeElement.textContent = `${currentTime} · ${elapsed}초`;
                    }
                    messageStartTime = null;
                }
            } catch (e) {
                console.error('Markdown parse error:', e);
            }
        }
    }
    currentAssistantMessage = null;
    isSending = false;  // 전송 완료, 다음 전송 허용
    isGenerating = false;
    hideAbortButton();

    // 스크롤 하단으로
    setTimeout(scrollToBottom, 100);
}

/**
 * 에러 메시지를 현재 AI 응답 영역에 표시하고 상태 리셋
 *
 * @param {string} message - 표시할 에러 메시지
 * @returns {void}
 */
function showError(message) {
    if (currentAssistantMessage) {
        const content = currentAssistantMessage.querySelector('.message-content');
        content.innerHTML = `<span style="color: #ef4444">❌ ${escapeHtml(message)}</span>`;
    }
    currentAssistantMessage = null;
    isSending = false;  // 에러 발생 시에도 다음 전송 허용
    isGenerating = false;
    hideAbortButton();
}

// ========================================
// 🆕 대화 히스토리 (서버 연동)
// ========================================

/** @type {string|null} 현재 활성 채팅 세션 ID (서버 세션) */
let currentSessionId = null;

/**
 * 익명 사용자용 세션 ID를 생성 또는 반환
 * 
 * sessionStorage에 저장되어 브라우저 탭 단위로 유지됩니다.
 * 로그인하면 이 세션을 인증 사용자로 이관(claim)합니다.
 * 형식: 'anon-{timestamp}-{random}'
 *
 * @returns {string} 익명 세션 ID
 */
function getOrCreateAnonymousSessionId() {
    let anonSessionId = sessionStorage.getItem('anonSessionId');
    if (!anonSessionId) {
        anonSessionId = 'anon-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem('anonSessionId', anonSessionId);
        console.log('[Auth] 새 익명 세션 ID 생성:', anonSessionId);
    }
    return anonSessionId;
}

/**
 * 사이드바에 채팅 세션 목록을 로드하여 렌더링
 * 
 * GET /api/chat/sessions 엔드포인트를 호출합니다.
 * - 인증 사용자: JWT 토큰으로 본인 세션만 조회
 * - 비인증 사용자: anonSessionId로 익명 세션 조회
 * - 관리자: viewAll 옵션으로 전체 세션 조회 가능
 * 각 세션은 클릭 시 loadSession(), 삭제 시 deleteSession() 호출합니다.
 *
 * @async
 * @returns {Promise<void>}
 */
async function loadChatSessions() {
    const historyList = document.getElementById('recentChats');
    if (!historyList) return;

    try {
        const authToken = localStorage.getItem('authToken');
        const userRole = JSON.parse(localStorage.getItem('user') || '{}').role;
        const isAdminUser = userRole === 'admin' || userRole === 'administrator';

        // URL 파라미터 구성
        const params = new URLSearchParams({ limit: '20' });

        // 비로그인 사용자는 익명 세션 ID 전달
        if (!authToken) {
            params.append('anonSessionId', getOrCreateAnonymousSessionId());
        }

        // 관리자용 전체 보기 옵션 (체크박스 상태 확인)
        const viewAllCheckbox = document.getElementById('viewAllSessions');
        if (isAdminUser && viewAllCheckbox?.checked) {
            params.append('viewAll', 'true');
        }

        const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};

         const res = await fetch(`/api/chat/sessions?${params}`, { headers });
         if (!res.ok) {
             throw new Error(`HTTP ${res.status}: ${res.statusText}`);
         }
         const data = await res.json();

         const payload = data.data || data;
         if (data.success && payload.sessions && payload.sessions.length > 0) {
             historyList.innerHTML = payload.sessions.map(session => `
                <div class="history-item ${session.id === currentSessionId ? 'active' : ''}" 
                     data-session-id="${session.id}"
                     onclick="loadSession('${session.id}')"
                     title="${escapeHtml(session.title || '새 대화')}">
                    <span class="history-title">${escapeHtml((session.title || '새 대화').substring(0, 25))}${(session.title?.length > 25) ? '...' : ''}</span>
                    <span class="history-meta">${formatTimeAgo(session.updatedAt || session.createdAt)}</span>
                    <button class="history-delete" onclick="event.stopPropagation(); deleteSession('${session.id}')" title="삭제">✕</button>
                </div>
            `).join('');
        } else {
            historyList.innerHTML = '<div class="history-empty">대화 기록이 없습니다</div>';
        }
    } catch (error) {
        console.error('[ChatHistory] 세션 로드 실패:', error);
        historyList.innerHTML = '<div class="history-empty">로드 실패</div>';
    }
}

/**
 * 날짜 문자열을 상대 시간 텍스트로 변환
 *
 * @param {string} dateStr - ISO 날짜 문자열
 * @returns {string} 상대 시간 (예: '방금', '5분 전', '3시간 전', '2일 전', '2025. 2. 15.')
 */
function formatTimeAgo(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '방금';
    if (minutes < 60) return `${minutes}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    if (days < 7) return `${days}일 전`;
    return date.toLocaleDateString('ko-KR');
}

/**
 * 새 채팅 세션을 서버에 생성
 * 
 * POST /api/chat/sessions 엔드포인트를 호출하고,
 * 생성된 세션 ID를 currentSessionId에 설정합니다.
 * 비인증 사용자는 anonSessionId를 포함합니다.
 *
 * @async
 * @param {string} title - 세션 제목 (보통 첫 메시지의 처음 50자)
 * @returns {Promise<Object|null>} 생성된 세션 객체 또는 실패 시 null
 */
async function createNewSession(title) {
    try {
        const model = document.getElementById('modelSelect')?.value || 'default';
        const authToken = localStorage.getItem('authToken');
        const anonSessionId = !authToken ? getOrCreateAnonymousSessionId() : undefined;

        const headers = {
            'Content-Type': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
        };

         const res = await fetch('/api/chat/sessions', {
              method: 'POST',
              credentials: 'include',  // 🔒 httpOnly 쿠키 포함
              headers,
              body: JSON.stringify({ title, model, anonSessionId })
          });
         if (!res.ok) {
             throw new Error(`HTTP ${res.status}: ${res.statusText}`);
         }
         const data = await res.json();
         const payload = data.data || data;
         if (data.success) {
             currentSessionId = payload.session.id;
             loadChatSessions();
             return payload.session;
         }
    } catch (error) {
        console.error('[ChatHistory] 세션 생성 실패:', error);
    }
    return null;
}

/**
 * 특정 세션의 대화 내역을 서버에서 로드하여 채팅 영역에 복원
 * 
 * 1. 다른 페이지에 있으면 채팅 뷰('/')로 이동
 * 2. GET /api/chat/sessions/{sessionId}/messages 호출
 * 3. 채팅 영역 초기화 후 메시지 복원 (assistant는 마크다운 렌더링 적용)
 * 4. conversationMemory 재구성
 * 5. 사이드바 활성 상태 업데이트
 *
 * @async
 * @param {string} sessionId - 로드할 세션 ID
 * @returns {Promise<void>}
 */
async function loadSession(sessionId) {
     // 다른 페이지에 있으면 먼저 채팅 뷰로 전환
     if (window.Router && window.location.pathname !== '/') {
         window.Router.navigate('/');
     }

     try {
         const res = await fetch(`/api/chat/sessions/${sessionId}/messages`);
         if (!res.ok) {
             throw new Error(`HTTP ${res.status}: ${res.statusText}`);
         }
         const data = await res.json();

         const payload = data.data || data;
         if (data.success) {
             currentSessionId = sessionId;

             // 채팅 영역 초기화
             const chatMessages = document.getElementById('chatMessages');
             chatMessages.innerHTML = '';
             document.getElementById('welcomeScreen').style.display = 'none';

             // 메시지 복원
             conversationMemory = [];
             payload.messages.forEach(msg => {
                if (msg.role === 'assistant') {
                    // AI 응답은 마크다운 렌더링 적용
                    addRestoredAssistantMessage(msg.content);
                } else {
                    addChatMessage(msg.role, msg.content);
                }
                conversationMemory.push({ role: msg.role, content: msg.content });
            });

            // 활성 상태 업데이트
            document.querySelectorAll('.history-item').forEach(item => {
                item.classList.toggle('active', item.dataset.sessionId === sessionId);
            });

            scrollToBottom();
            showToast('💬 대화를 불러왔습니다', 'success');
        }
    } catch (error) {
        console.error('[ChatHistory] 세션 로드 실패:', error);
        showToast('대화를 불러올 수 없습니다', 'error');
    }
}

// 🔧 전역 노출: UnifiedSidebar에서 대화 클릭 시 loadSession 호출 가능
window.loadConversation = loadSession;
window.loadSession = loadSession;

/**
 * 세션 복원 시 AI 응답 메시지를 마크다운 렌더링하여 추가
 * 
 * loadSession()에서 호출되며, 저장된 AI 응답을
 * marked.js + window.purifyHTML로 렌더링하고,
 * hljs로 코드 블록 구문 강조를 적용합니다.
 * 복사 버튼만 포함됩니다 (재생성 버튼 없음).
 *
 * @param {string} content - AI 응답 원문 (마크다운)
 * @returns {HTMLElement} 생성된 메시지 DOM 요소
 */
function addRestoredAssistantMessage(content) {
    const container = document.getElementById('chatMessages');
    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const div = document.createElement('div');
    div.className = 'chat-message assistant';
    div.id = messageId;

    // 마크다운 렌더링
    let renderedContent = content;
    if (typeof marked !== 'undefined') {
        try {
            renderedContent = window.purifyHTML(marked.parse(content));
        } catch (e) {
            console.warn('마크다운 파싱 실패:', e);
            renderedContent = content.replace(/\n/g, '<br>');
        }
    }

    div.innerHTML = `
        <div class="message-avatar">✨</div>
        <div class="message-wrapper">
            <div class="message-content">${renderedContent}</div>
            <div class="message-actions">
                <button class="message-action-btn" onclick="copyMessage('${messageId}')" title="복사">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    복사
                </button>
            </div>
            <div class="message-time">${timestamp} · 저장됨</div>
        </div>
    `;

    container.appendChild(div);

    // 코드 하이라이팅 적용
    if (typeof hljs !== 'undefined') {
        div.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }

    return div;
}

/**
 * 메시지를 현재 세션에 서버 저장
 * 
 * currentSessionId가 없으면 새 세션을 자동 생성합니다.
 * POST /api/chat/sessions/{sessionId}/messages 엔드포인트를 호출합니다.
 *
 * @async
 * @param {'user'|'assistant'} role - 메시지 발화자 역할
 * @param {string} content - 메시지 내용
 * @param {Object} [options={}] - 추가 옵션 (서버 전달)
 * @returns {Promise<void>}
 */
async function saveMessageToSession(role, content, options = {}) {
    if (!currentSessionId) {
        // 첫 메시지인 경우 새 세션 생성
        const title = content.substring(0, 50);
        await createNewSession(title);
    }

    if (currentSessionId) {
        try {
            await fetch(`/api/chat/sessions/${currentSessionId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role, content, ...options })
            });
        } catch (error) {
            console.error('[ChatHistory] 메시지 저장 실패:', error);
        }
    }
}

/**
 * 채팅 세션을 서버에서 삭제 (확인 다이얼로그 포함)
 * 
 * 삭제 후 현재 세션이었으면 newChat()으로 초기화하고,
 * 사이드바 히스토리를 새로고침합니다.
 *
 * @async
 * @param {string} sessionId - 삭제할 세션 ID
 * @returns {Promise<void>}
 */
async function deleteSession(sessionId) {
    if (!confirm('이 대화를 삭제하시겠습니까?')) return;

    try {
        const res = await fetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const data = await res.json();

        if (data.success) {
            if (currentSessionId === sessionId) {
                newChat();
            }
            loadChatSessions();
            showToast('🗑️ 대화가 삭제되었습니다', 'info');
        }
    } catch (error) {
        console.error('[ChatHistory] 세션 삭제 실패:', error);
        showToast('삭제 실패', 'error');
    }
}

/**
 * 사용자 메시지를 서버 세션에 저장 (하위 호환 래퍼)
 *
 * @param {string} message - 사용자 메시지
 * @returns {void}
 */
function addToChatHistory(message) {
    // 서버에 메시지 저장
    saveMessageToSession('user', message);
}

/**
 * 새 대화 시작 - 채팅 영역 초기화
 * 
 * 1. 다른 페이지에 있으면 채팅 뷰('/')로 이동
 * 2. currentSessionId 초기화
 * 3. 채팅 메시지 영역 비우기, 환영 화면 표시
 * 4. 첨부 파일 및 대화 메모리 초기화
 * 5. 사이드바 활성 상태 해제
 *
 * @returns {void}
 */
function newChat() {
    // 다른 페이지에 있으면 먼저 채팅 뷰로 전환
    if (window.Router && window.location.pathname !== '/') {
        window.Router.navigate('/');
    }

    currentSessionId = null;
    document.getElementById('chatMessages').innerHTML = '';
    document.getElementById('welcomeScreen').style.display = 'flex';
    document.getElementById('chatInput').value = '';
    clearAttachments();
    clearMemory();

    // 활성 상태 해제
    document.querySelectorAll('.history-item').forEach(item => {
        item.classList.remove('active');
    });
}

// ========================================
// 파일 업로드 및 첨부 관리
// ========================================

/**
 * 파일 업로드 모달 열기
 * @returns {void}
 */
function showFileUpload() {
    document.getElementById('fileModal').classList.add('active');
    setupFileInput();
}

/**
 * 파일 업로드 모달 닫기
 * @returns {void}
 */
function closeFileModal() {
    document.getElementById('fileModal').classList.remove('active');
}

/**
 * 파일을 서버에 업로드하고 첨부 목록에 추가
 * 
 * 처리 흐름:
 * 1. 이미지 파일이면 base64 추출 (멀티모달 전송용)
 * 2. POST /api/upload로 FormData 전송
 * 3. PDF 문서이면 GET /api/documents/{docId}로 전체 텍스트 획득
 *    - 20,000자 초과 시 처음 15,000자 + 마지막 5,000자로 축약
 * 4. attachedFiles 배열에 추가, renderAttachments() 호출
 * 5. PDF 문서이면 activeDocumentContext 설정 (세션 레벨 컨텍스트)
 *
 * @async
 * @param {File} file - 업로드할 파일 객체
 * @returns {Promise<void>}
 */
async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    const uploadArea = document.getElementById('uploadArea');
    const originalContent = uploadArea.innerHTML;
    uploadArea.innerHTML = `
        <div class="upload-content">
            <span class="loading-spinner"></span>
            <p>업로드 중: ${escapeHtml(file.name)}</p>
        </div>
    `;

    try {
        // 이미지 파일인 경우 멀티모달 지원을 위해 base64 추출
        let base64 = null;
        if (file.type.startsWith('image/')) {
            base64 = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]); // Prefix 제거
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(file);
            });
        }

          const res = await fetch('/api/upload', {
              method: 'POST',
              credentials: 'include',  // 🔒 httpOnly 쿠키 포함
              body: formData
          });
         if (!res.ok) {
             throw new Error(`HTTP ${res.status}: ${res.statusText}`);
         }

         const data = await res.json();

         // Unwrap api-response wrapper
         if (data.data && data.success) { Object.assign(data, data.data); }

         if (data.success) {
            // 멀티모달용 base64 데이터 추가
            if (base64) {
                data.base64 = base64;
                data.isImage = true;
            }

             // PDF 문서인 경우 전체 텍스트를 가져와서 저장
             if (!data.isImage && data.docId) {
                 try {
                     // 문서 전체 내용을 서버에서 가져옴
                     const docRes = await fetch(`/api/documents/${data.docId}`);
                     if (!docRes.ok) {
                         throw new Error(`HTTP ${docRes.status}: ${docRes.statusText}`);
                     }
                     const docData = await docRes.json();
                     const docPayload = docData.data || docData;
                     if (docPayload.text) {
                         // 텍스트가 너무 긴 경우 처음 15000자 + 마지막 5000자를 사용 (토큰 제한 고려)
                         const maxLength = 20000;
                         if (docPayload.text.length > maxLength) {
                             const front = docPayload.text.substring(0, 15000);
                             const back = docPayload.text.substring(docPayload.text.length - 5000);
                             data.textContent = `${front}\n\n... [중간 내용 ${docPayload.text.length - maxLength}자 생략] ...\n\n${back}`;
                         } else {
                             data.textContent = docPayload.text;
                         }
                        console.log(`[Upload] 문서 텍스트 저장: ${data.textContent.length}자`);
                    }
                } catch (e) {
                    console.warn('[Upload] 문서 텍스트 가져오기 실패:', e);
                    // preview 사용 폴백
                    data.textContent = data.preview || '';
                }
            }

            attachedFiles.push(data);
            renderAttachments();
            closeFileModal();

            // PDF 문서인 경우 세션 레벨 컨텍스트 설정
            if (data.docId && !data.isImage) {
                activeDocumentContext = {
                    docId: data.docId,
                    filename: data.filename,
                    textLength: data.textLength || 0
                };
                updateActiveDocumentUI();
                console.log(`[Upload] 활성 문서 설정: ${data.filename} (${data.textLength}자)`);
            }

             // 업로드 성공 알림
             showToast(`📄 ${data.filename} 업로드 완료 - 문서 컨텍스트 활성화됨`, 'success');
         } else {
             const errorMsg = (data.error && typeof data.error === 'object') ? data.error.message : data.error;
             alert(errorMsg || '업로드 실패');
         }
    } catch (e) {
        alert('업로드 오류: ' + e.message);
    }

    uploadArea.innerHTML = originalContent;
    setupFileInput();
}

/**
 * 파일 입력 요소와 업로드 영역의 이벤트 핸들러 설정
 * 
 * fileInput의 change 이벤트와 uploadArea의 드래그 앤 드롭을 바인딩합니다.
 *
 * @returns {void}
 */
function setupFileInput() {
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.onchange = (e) => {
            if (e.target.files.length > 0) {
                uploadFile(e.target.files[0]);
            }
        };
    }

    const uploadArea = document.getElementById('uploadArea');
    if (uploadArea) {
        uploadArea.ondragover = (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        };
        uploadArea.ondragleave = () => uploadArea.classList.remove('dragover');
        uploadArea.ondrop = (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                uploadFile(e.dataTransfer.files[0]);
            }
        };
    }
}

/**
 * 채팅 입력 영역의 드래그 앤 드롭 파일 업로드 초기화
 * 
 * 채팅 input-container에 드래그 오버레이를 추가하고,
 * 파일 드롭 시 모달 없이 직접 uploadFile()을 호출합니다.
 * 중복 초기화 방지를 위해 _chatDropZoneInit 플래그를 사용합니다.
 * 텍스트 드래그는 무시하고 파일 드래그만 처리합니다.
 *
 * @returns {void}
 */
function setupChatDropZone() {
    const inputContainer = document.querySelector('.input-container');
    if (!inputContainer) return;
    // 중복 초기화 방지
    if (inputContainer._chatDropZoneInit) return;
    inputContainer._chatDropZoneInit = true;

    let dragCounter = 0; // 중첩된 dragenter/dragleave 카운팅

    // 드래그 오버레이 생성
    let overlay = inputContainer.querySelector('.chat-drop-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'chat-drop-overlay';
        overlay.innerHTML = `
            <div class="chat-drop-overlay-content">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <p>파일을 여기에 놓으세요</p>
                <span>이미지, PDF, 문서 파일 지원</span>
            </div>
        `;
        inputContainer.style.position = 'relative';
        inputContainer.appendChild(overlay);
    }

    inputContainer.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 파일 드래그만 처리 (텍스트 드래그 무시)
        if (!e.dataTransfer.types.includes('Files')) return;
        dragCounter++;
        if (dragCounter === 1) {
            inputContainer.classList.add('chat-drag-active');
        }
    });

    inputContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!e.dataTransfer.types.includes('Files')) return;
        e.dataTransfer.dropEffect = 'copy';
    });

    inputContainer.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            inputContainer.classList.remove('chat-drag-active');
        }
    });

    inputContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        inputContainer.classList.remove('chat-drag-active');

        const files = e.dataTransfer.files;
        if (!files || files.length === 0) return;

        // 파일 순차 업로드 (모달 없이 직접 업로드)
        Array.from(files).forEach((file) => {
            uploadFile(file);
        });
    });

    // 페이지 전체 드래그 시 브라우저 기본 동작 방지 (파일 열기 방지)
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    document.addEventListener('drop', (e) => {
        // input-container 안에서의 drop은 위에서 처리됨
        // 그 외 영역의 drop은 기본 동작만 방지
        e.preventDefault();
    });
}

/**
 * 첨부 파일 목록을 DOM에 렌더링
 * 
 * 파일 타입별 아이콘(이미지/PDF/텍스트)과 삭제 버튼을 표시합니다.
 * 첨부 파일이 없으면 컨테이너를 숨깁니다.
 *
 * @returns {void}
 */
function renderAttachments() {
    const container = document.getElementById('attachments');
    if (attachedFiles.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    container.innerHTML = attachedFiles.map((f, i) => `
        <div class="attachment-item">
            <span>${f.isImage ? '🖼️' : (f.type === 'pdf' ? '📄' : '📝')} ${escapeHtml(f.filename)}</span>
            <button class="attachment-remove" onclick="removeAttachment(${i})">&times;</button>
        </div>
    `).join('');
}

/**
 * 특정 인덱스의 첨부 파일을 제거
 *
 * @param {number} index - 제거할 첨부 파일의 배열 인덱스
 * @returns {void}
 */
function removeAttachment(index) {
    attachedFiles.splice(index, 1);
    renderAttachments();
}

/**
 * 모든 첨부 파일을 제거하고 UI 갱신
 * @returns {void}
 */
function clearAttachments() {
    attachedFiles = [];
    renderAttachments();
}

// ========================================
// 문서 질의응답 (Document Q&A)
// ========================================

/**
 * 업로드된 문서에 대해 질문하고 AI 응답을 표시
 * 
 * POST /api/document/ask 엔드포인트를 호출합니다.
 * 응답이 객체인 경우 answer, summary, evidence, additional_info 필드를
 * 적절히 포맷팅하여 마크다운으로 렌더링합니다.
 *
 * @async
 * @param {string} docId - 질문 대상 문서 ID
 * @param {string} question - 사용자 질문
 * @param {string} model - 사용할 모델 ID
 * @returns {Promise<void>}
 */
async function askDocumentQuestion(docId, question, model) {
    currentAssistantMessage = addChatMessage('assistant', '');

    try {
        const res = await fetch('/api/document/ask', {
            method: 'POST',
            credentials: 'include',  // 🔒 httpOnly 쿠키 포함
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docId, question, model })
        });

         const data = await res.json();

         const payload = data.data || data;
         if (payload.answer) {
             let answerText = payload.answer;

             // 만약 answer가 객체라면 그 안의 필드를 추출
             if (typeof payload.answer === 'object') {
                 if (payload.answer.answer) {
                     answerText = payload.answer.answer;
                 } else if (payload.answer.summary) {
                     // 요약 응답 형식 처리
                     answerText = formatSummaryResponse(payload.answer);
                 } else {
                     // 그 외의 경우 JSON으로 포맷팅
                     answerText = JSON.stringify(payload.answer, null, 2);
                 }

                 // 근거(evidence)가 있으면 추가
                 if (payload.answer.evidence) {
                     answerText += '\n\n**📌 근거:**\n' + payload.answer.evidence;
                 }

                 // 추가 정보가 있으면 추가
                 if (payload.answer.additional_info) {
                     answerText += '\n\n**💡 추가 정보:**\n' + payload.answer.additional_info;
                 }
             }

            if (currentAssistantMessage) {
                const content = currentAssistantMessage.querySelector('.message-content');
                renderMarkdown(content, answerText);

                 // 응답을 메모리에 저장
                 addToMemory('assistant', answerText);
             }
         } else {
             const errorMsg = (data.error && typeof data.error === 'object') ? data.error.message : data.error;
             showError(errorMsg || '답변 생성 실패');
         }
    } catch (e) {
        showError(e.message);
    }

    currentAssistantMessage = null;
}

/**
 * 요약 응답 객체를 마크다운 문자열로 포맷팅
 * 
 * title, category, summary(배열 또는 문자열), sections, implications 필드를
 * 마크다운 헤딩과 리스트로 변환합니다.
 *
 * @param {Object} obj - 요약 응답 객체
 * @param {string} [obj.title] - 문서 제목
 * @param {string} [obj.category] - 문서 분류
 * @param {string|string[]} [obj.summary] - 요약 (문자열 또는 배열)
 * @param {Array<{title: string, content: string}>} [obj.sections] - 세부 섹션
 * @param {string} [obj.implications] - 시사점
 * @returns {string} 포맷팅된 마크다운 문자열
 */
function formatSummaryResponse(obj) {
    let result = '';

    if (obj.title) {
        result += `## ${obj.title}\n\n`;
    }

    if (obj.category) {
        result += `**분류:** ${obj.category}\n\n`;
    }

    if (obj.summary) {
        if (Array.isArray(obj.summary)) {
            result += '### 📋 요약\n';
            obj.summary.forEach(item => {
                result += `- ${item}\n`;
            });
            result += '\n';
        } else {
            result += `### 📋 요약\n${obj.summary}\n\n`;
        }
    }

    if (obj.sections && Array.isArray(obj.sections)) {
        obj.sections.forEach(section => {
            result += `### ${section.title}\n${section.content}\n\n`;
        });
    }

    if (obj.implications) {
        result += `### 💡 시사점\n${obj.implications}\n`;
    }

    return result.trim();
}

// ========================================
// 웹 검색 통합
// ========================================

/**
 * 웹 검색 모드 토글
 * 
 * 웹 검색과 토론 모드는 상호 배타적입니다.
 * 웹 검색 활성화 시 토론 모드를 자동 비활성화합니다.
 * mcpSettings.webSearch와 설정 모달 체크박스도 동기화합니다.
 *
 * @returns {void}
 */
function toggleWebSearch() {
    webSearchEnabled = !webSearchEnabled;
    mcpSettings.webSearch = webSearchEnabled; // 설정 동기화
    const btn = document.getElementById('webSearchBtn');
    if (btn) {
        btn.classList.toggle('active', webSearchEnabled);
        btn.title = webSearchEnabled ? '웹 검색 - ON' : '웹 검색 - OFF';
    }

    // 설정 모달 체크박스 동기화
    const checkbox = document.getElementById('mcpWebSearch');
    if (checkbox) checkbox.checked = webSearchEnabled;

    // 웹 검색과 토론 모드는 동시 사용 불가 - 웹 검색 활성화 시 토론 모드 비활성화
    if (webSearchEnabled && discussionMode) {
        discussionMode = false;
        const discussionBtn = document.getElementById('discussionModeBtn');
        if (discussionBtn) {
            discussionBtn.classList.remove('active');
        }
        showToast('🌐 웹 검색 활성화 (토론 모드 비활성화됨)');
    } else {
        showToast(webSearchEnabled ? '🌐 웹 검색 활성화' : '웹 검색 비활성화');
    }
}

/**
 * 웹 검색 실행 및 결과를 채팅 영역에 표시
 * 
 * POST /api/web-search 엔드포인트를 호출하고,
 * AI 생성 답변과 검색 출처 링크를 마크다운으로 렌더링합니다.
 * Google Custom Search API를 통해 실시간 웹 정보를 가져옵니다.
 *
 * @async
 * @param {string} query - 검색 쿼리
 * @param {string} model - 사용할 모델 ID
 * @returns {Promise<void>}
 */
async function performWebSearch(query, model) {
    try {
        // 검색 중 표시
        if (currentAssistantMessage) {
            const content = currentAssistantMessage.querySelector('.message-content');
            content.innerHTML = '<span class="loading-spinner"></span> 웹에서 검색 중...';
        }

         const res = await fetch('/api/web-search', {
             method: 'POST',
             credentials: 'include',  // 🔒 httpOnly 쿠키 포함
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ query, model })
         });

         const data = await res.json();

         const payload = data.data || data;
         if (payload.answer) {
             if (currentAssistantMessage) {
                 const content = currentAssistantMessage.querySelector('.message-content');
                 // 마크다운 렌더링
                 renderMarkdown(content, payload.answer);

                 // 소스 표시
                 if (payload.sources && payload.sources.length > 0) {
                     const sourcesDiv = document.createElement('div');
                     sourcesDiv.style.cssText = 'margin-top: 12px; padding: 10px; background: #f8f9fa; border-radius: 8px; font-size: 13px;';
                     sourcesDiv.innerHTML = '<b>📚 검색 출처:</b><br>' + payload.sources.map((s, i) =>
                         `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" style="color: #0369a1; display: block; margin-top: 4px;">[${i + 1}] ${escapeHtml(s.title || new URL(s.url).hostname)}</a>`
                     ).join('');
                     content.appendChild(sourcesDiv);
                 }
             }
         } else {
             const errorMsg = (data.error && typeof data.error === 'object') ? data.error.message : data.error;
             showError(errorMsg || '검색 실패');
         }
    } catch (e) {
        showError(e.message);
    }

    currentAssistantMessage = null;
    isSending = false;  // 🔒 웹 검색 완료 후 다음 전송 허용
}

// ========================================
// 설정 모달
// ========================================

/**
 * 설정 모달을 열고 현재 정보를 로드
 * 
 * 1. 현재 테마 버튼 활성화 상태 표시
 * 2. loadModelInfo()로 LLM 모델 정보 로드
 * 3. GET /api/cluster로 클러스터 노드 정보 조회 및 표시
 *
 * @async
 * @returns {Promise<void>}
 */
async function showSettings() {
    document.getElementById('settingsModal').classList.add('active');

    // 현재 테마 버튼 활성화 상태 표시
    const currentTheme = localStorage.getItem('theme') || 'system';
    setTheme(currentTheme);

    // LLM 모델 정보 로드
    loadModelInfo();

    // 클러스터 정보 로드 - REST API로 최신 정보 가져오기
    const clusterInfo = document.getElementById('clusterInfo');
    const nodesList = document.getElementById('nodesList');

    // 먼저 로딩 상태 표시
    clusterInfo.textContent = '로딩 중...';
    nodesList.innerHTML = '<div style="color: var(--text-muted);">클러스터 정보 조회 중...</div>';

    try {
         // REST API로 최신 클러스터 정보 가져오기
         const response = await fetch('/api/cluster', {
             credentials: 'include'  // 🔒 httpOnly 쿠키 포함
         });
         if (response.ok) {
             const data = await response.json();
             console.log('[Settings] 클러스터 정보 조회:', data);

            // 전역 nodes 배열 업데이트
            if (data.nodes) {
                nodes = data.nodes;
            }

            const onlineCount = nodes.filter(n => n.status === 'online').length;
            clusterInfo.textContent = `${nodes.length}개 노드 중 ${onlineCount}개 온라인`;

            if (nodes.length > 0) {
                nodesList.innerHTML = nodes.map(n =>
                    `<div class="node-item">
                        <div class="node-status-dot ${n.status === 'online' ? 'online' : 'offline'}"></div>
                        <div class="node-info">
                            <div class="node-name">${escapeHtml(n.name || n.id)}</div>
                            <div class="node-addr">${escapeHtml(n.host)}:${escapeHtml(String(n.port))}</div>
                            ${(n.models && n.models.length > 0 && isAdmin()) ? `<div class="node-models">보유 모델: ${escapeHtml(n.models.join(', '))}</div>` : ''}
                        </div>
                    </div>`
                ).join('');
            } else {
                nodesList.innerHTML = '<div style="color: #ef4444;">노드 없음 - Ollama 서버가 실행 중인지 확인하세요</div>';
            }

            // 모델 선택도 업데이트
            updateModelSelect();
        } else {
            throw new Error('API 응답 오류');
        }
    } catch (error) {
        console.error('[Settings] 클러스터 정보 조회 실패:', error);
        clusterInfo.textContent = '연결 오류';
        nodesList.innerHTML = '<div style="color: #ef4444;">❌ 클러스터 정보를 가져올 수 없습니다</div>';
    }
}

/**
 * LLM 모델 프로파일 목록을 서버에서 로드하여 설정 모달에 표시
 * 
 * GET /api/models 엔드포인트를 호출합니다.
 * 관리자가 아니면 모델 정보를 숨기고 'OpenMake LLM Auto'만 표시합니다.
 * 각 모델 배지 클릭 시 selectModel()이 호출됩니다.
 *
 * @async
 * @returns {Promise<void>}
 */
async function loadModelInfo() {
    const activeModelName = document.getElementById('activeModelName');
    const modelListContainer = document.getElementById('modelListContainer');

    if (!activeModelName || !modelListContainer) return;

    // 🔒 관리자가 아니면 모델 정보 숨김
    if (!isAdmin()) {
        activeModelName.textContent = 'OpenMake LLM Auto';
        modelListContainer.innerHTML = '<span style="color: var(--text-muted);">모델 정보는 관리자만 볼 수 있습니다</span>';
        return;
    }

    activeModelName.textContent = '로딩 중...';
    modelListContainer.innerHTML = '<span style="color: var(--text-muted);">조회 중...</span>';

     try {
          // 브랜드 모델 프로파일 목록 API 호출
          const response = await fetch('/api/models', {
              credentials: 'include'  // 🔒 httpOnly 쿠키 포함
          });
          if (response.ok) {
              const data = await response.json();
              const payload = data.data || data;
             console.log('[Settings] 모델 정보:', data);

             // 현재 기본 모델 표시 (브랜드 모델명)
             const savedModel = localStorage.getItem('selectedModel');
             const defaultModelId = payload.defaultModel || 'openmake_llm_auto';

             // 저장된 모델의 displayName 찾기
             let activeDisplayName = 'OpenMake LLM Auto';
             if (payload.models && payload.models.length > 0) {
                 const activeModel = payload.models.find(m => {
                     const modelId = m.modelId || m.name;
                     return savedModel ? modelId === savedModel : modelId === defaultModelId;
                 });
                 if (activeModel) activeDisplayName = activeModel.name;
             }
             activeModelName.textContent = activeDisplayName;

             // 브랜드 모델 프로파일 목록 표시
             if (payload.models && payload.models.length > 0) {
                 modelListContainer.innerHTML = payload.models.map(model => {
                     const modelId = model.modelId || model.name;
                     const displayName = model.name;
                     const isActive = savedModel ? modelId === savedModel : modelId === defaultModelId;
                     return `
                     <div class="model-badge ${isActive ? 'active' : ''}" onclick="selectModel('${escapeHtml(modelId)}')">
                         ${isActive ? '✓ ' : ''}${escapeHtml(displayName)}
                     </div>
                 `}).join('');
             } else {
                 modelListContainer.innerHTML = '<span style="color: var(--text-muted);">사용 가능한 모델 없음</span>';
             }
        } else {
            throw new Error('모델 API 응답 오류');
        }
    } catch (error) {
        console.error('[Settings] 모델 정보 조회 실패:', error);
        activeModelName.textContent = 'OpenMake LLM Auto';
        modelListContainer.innerHTML = '<span style="color: var(--text-muted);">모델 목록을 가져올 수 없습니다</span>';
    }
}

/**
 * 바이트 수를 사람이 읽기 쉬운 크기 문자열로 변환
 *
 * @param {number} bytes - 바이트 수
 * @returns {string} 포맷팅된 크기 (예: '1.5GB', '256MB', '?')
 */
function formatSize(bytes) {
    if (!bytes) return '?';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)}GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)}MB`;
}

/**
 * 모델을 선택하고 localStorage에 저장, UI 갱신
 *
 * @param {string} modelId - 선택할 브랜드 모델 ID (예: 'openmake_llm_auto')
 * @returns {void}
 */
function selectModel(modelId) {
    localStorage.setItem('selectedModel', modelId);

    // UI 전체 재로드 (브랜드 모델 badge 갱신)
    loadModelInfo();

    // 메인 셀렉트 박스도 업데이트
    const select = document.getElementById('modelSelect');
    if (select) {
        select.value = modelId;
    }

    // 브랜드 모델명으로 toast 표시
    const brandModel = BRAND_MODELS.find(m => m.id === modelId);
    const displayName = brandModel ? brandModel.name : modelId;
    showToast(`🤖 모델 선택됨: ${displayName}`);
}

/**
 * 설정 모달 섹션 아코디언 토글 (접기/펼치기)
 *
 * @param {string} sectionId - 토글할 섹션의 DOM ID
 * @returns {void}
 */
function toggleSection(sectionId) {
    const content = document.getElementById(sectionId);
    const arrow = document.getElementById(sectionId + '-arrow');

    if (content && arrow) {
        content.classList.toggle('collapsed');
        arrow.classList.toggle('collapsed');
    }
}

/**
 * 설정 모달 닫기
 * @returns {void}
 */
function closeSettings() {
    document.getElementById('settingsModal').classList.remove('active');
}

// ========================================
// MCP 모듈 설정 관리
// ========================================

/**
 * MCP(Model Context Protocol) 모듈 설정 상태
 * 
 * localStorage에 'mcpSettings' 키로 영속화되며,
 * WebSocket을 통해 서버와 실시간 동기화됩니다.
 *
 * @type {{thinking: boolean, webSearch: boolean, pdf: boolean, github: boolean, exa: boolean}}
 */
let mcpSettings = {
    thinking: true,
    webSearch: false,
    pdf: true,
    github: false,
    exa: false,
    enabledTools: {}
};

/**
 * localStorage에서 MCP 설정을 로드하고 UI/전역 변수와 동기화
 * 
 * 체크박스 상태, thinkingEnabled, webSearchEnabled 변수,
 * 토글 버튼 상태를 모두 업데이트합니다.
 *
 * @returns {void}
 */
function loadMCPSettings() {
    const saved = localStorage.getItem('mcpSettings');
    if (saved) {
        mcpSettings = JSON.parse(saved);
        // UI 동기화
        Object.keys(mcpSettings).forEach(key => {
            const checkbox = document.getElementById(`mcp${key.charAt(0).toUpperCase() + key.slice(1)}`);
            if (checkbox) checkbox.checked = mcpSettings[key];
        });
    }
    // enabledTools 로드 (없으면 빈 객체 = 전체 비활성)
    if (!mcpSettings.enabledTools || typeof mcpSettings.enabledTools !== 'object') {
        mcpSettings.enabledTools = {};
    }
    // 기존 토글 버튼과 동기화
    thinkingEnabled = mcpSettings.thinking;
    webSearchEnabled = mcpSettings.webSearch;

    updateToggleButtonStates();
}

/**
 * Thinking 및 Web Search 토글 버튼의 active 클래스를 현재 상태에 맞게 갱신
 * @returns {void}
 */
function updateToggleButtonStates() {
    const thinkingBtn = document.getElementById('thinkingBtn');
    const webSearchBtn = document.getElementById('webSearchBtn');

    if (thinkingBtn) thinkingBtn.classList.toggle('active', thinkingEnabled);
    if (webSearchBtn) webSearchBtn.classList.toggle('active', webSearchEnabled);
}

/**
 * MCP 모듈을 토글하고 즉시 기능 적용 및 서버 동기화
 * 
 * 체크박스 상태를 읽어 mcpSettings에 반영하고,
 * 연관 전역 변수(thinkingEnabled, webSearchEnabled)를 동기화한 뒤,
 * WebSocket으로 서버에 설정을 전송합니다.
 *
 * @param {'thinking'|'webSearch'|'pdf'|'github'|'exa'} module - 토글할 MCP 모듈 키
 * @returns {void}
 */
function toggleMCPModule(module) {
    // 체크박스의 실제 상태를 가져옴 (onchange는 상태 변경 후 호출됨)
    const checkboxId = `mcp${module.charAt(0).toUpperCase() + module.slice(1)}`;
    const checkbox = document.getElementById(checkboxId);

    if (checkbox) {
        mcpSettings[module] = checkbox.checked;
    } else {
        // 체크박스가 없는 경우 기존 방식 (반전)
        mcpSettings[module] = !mcpSettings[module];
    }

    // 기존 변수와 동기화 및 기능 즉시 적용
    if (module === 'thinking') {
        thinkingEnabled = mcpSettings.thinking;
    }
    if (module === 'webSearch') {
        webSearchEnabled = mcpSettings.webSearch;
        const btn = document.getElementById('webSearchBtn');
        if (btn) btn.classList.toggle('active', webSearchEnabled);
    }

    // 즉시 기능 활성화/비활성화 피드백
    const toggleLabels = {
        thinking: '🧠 Sequential Thinking',
        webSearch: '🌐 Web Search',
        pdf: '📄 PDF Tools',
        github: '🐙 GitHub',
        exa: '🔍 Exa Search'
    };

    // 서버에 MCP 설정 즉시 동기화 (WebSocket)
    syncMCPSettingsToServer();

    showToast(`${mcpSettings[module] ? '✅' : '❌'} ${toggleLabels[module]} ${mcpSettings[module] ? '활성화' : '비활성화'}`, mcpSettings[module] ? 'success' : 'info');
}

/**
 * 현재 MCP 설정을 WebSocket으로 서버에 동기화
 * 
 * type='mcp_settings' 메시지로 sequentialThinking, pdfTools, webSearch 설정을 전송합니다.
 * WebSocket 연결이 없으면 경고 로그를 출력합니다.
 *
 * @returns {void}
 */
function syncMCPSettingsToServer() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const serverSettings = {
            sequentialThinking: mcpSettings.thinking,
            pdfTools: mcpSettings.pdf,
            webSearch: mcpSettings.webSearch
        };

        ws.send(JSON.stringify({
            type: 'mcp_settings',
            settings: serverSettings
        }));

        console.log('[MCP] 서버에 설정 동기화:', serverSettings);
    } else {
        console.warn('[MCP] WebSocket 연결 없음, 서버 동기화 실패');
    }
}

/**
 * 서버에서 수신한 MCP 설정을 로컬 상태와 UI에 동기화
 * 
 * 서버 키(sequentialThinking, pdfTools, webSearch)를
 * 로컬 키(thinking, pdf, webSearch)로 매핑하여 반영합니다.
 * mcp_settings_update 메시지 수신 시 호출됩니다.
 *
 * @param {Object} serverSettings - 서버 MCP 설정 객체
 * @param {boolean} [serverSettings.sequentialThinking] - Sequential Thinking 활성화
 * @param {boolean} [serverSettings.pdfTools] - PDF 도구 활성화
 * @param {boolean} [serverSettings.webSearch] - 웹 검색 활성화
 * @returns {void}
 */
function syncMCPSettingsFromServer(serverSettings) {
    if (!serverSettings) return;

    // 서버 설정을 로컬 설정으로 변환
    const settingsMap = {
        sequentialThinking: 'thinking',
        pdfTools: 'pdf',
        webSearch: 'webSearch'
    };

    for (const [serverKey, localKey] of Object.entries(settingsMap)) {
        if (serverKey in serverSettings) {
            mcpSettings[localKey] = serverSettings[serverKey];

            // UI 체크박스 업데이트
            const checkboxId = `mcp${localKey.charAt(0).toUpperCase() + localKey.slice(1)}`;
            const checkbox = document.getElementById(checkboxId);
            if (checkbox) {
                checkbox.checked = serverSettings[serverKey];
            }
        }
    }

    // 기존 변수 동기화
    thinkingEnabled = mcpSettings.thinking;
    webSearchEnabled = mcpSettings.webSearch;

    console.log('[MCP] UI 설정 동기화 완료:', mcpSettings);
}

// ========================================
// 프롬프트 모드 및 Agent 모드
// ========================================

/** @type {string} 현재 프롬프트 모드 ('auto'|'assistant'|'reasoning'|'coder'|'reviewer'|'explainer'|'generator'|'writer'|'researcher'|'translator'|'consultant'|'security'|'agent') */
let currentPromptMode = 'auto';

/**
 * 프롬프트 모드를 설정하고 토스트 알림 표시
 * 
 * 프롬프트 모드는 서버에서 시스템 프롬프트 생성 시 사용됩니다.
 * 'auto' 모드는 질문 유형에 따라 서버가 자동으로 최적 모드를 선택합니다.
 *
 * @param {string} mode - 설정할 프롬프트 모드
 * @returns {void}
 */
function setPromptMode(mode) {
    currentPromptMode = mode;

    // 즉시 적용 피드백
    const modeLabels = {
        auto: '🔄 자동 감지',
        assistant: '💬 Assistant',
        reasoning: '🧮 Reasoning',
        coder: '💻 Coder',
        reviewer: '🔍 Reviewer',
        explainer: '📚 Explainer',
        generator: '🚀 Generator',
        writer: '✍️ Writer',
        researcher: '🔍 Researcher',
        translator: '🌐 Translator',
        consultant: '💡 Consultant',
        security: '🔒 Security',
        agent: '🤖 Agent'
    };

    showToast(`프롬프트 모드: ${modeLabels[mode]} 적용됨`);
}

/** @type {boolean} Agent Mode 활성화 여부 (활성화 시 프롬프트 모드를 'agent'로 강제 고정) */
let agentModeEnabled = false;

/**
 * Agent Mode 토글
 * 
 * 활성화 시 프롬프트 모드를 'agent'로 강제 고정하고 select를 비활성화합니다.
 * 비활성화 시 'auto' 모드로 복귀하고 select를 다시 활성화합니다.
 * localStorage에 저장하여 새로고침 시에도 유지됩니다.
 *
 * @returns {void}
 */
function toggleAgentMode() {
    agentModeEnabled = !agentModeEnabled;

    // Agent Mode 활성화 시 프롬프트 모드를 'agent'로 자동 전환
    if (agentModeEnabled) {
        setPromptMode('agent');
        document.getElementById('promptModeSelect').value = 'agent';
        document.getElementById('promptModeSelect').disabled = true; // Agent 모드 고정
    } else {
        // 비활성화 시 자동 감지로 복귀
        setPromptMode('auto');
        document.getElementById('promptModeSelect').value = 'auto';
        document.getElementById('promptModeSelect').disabled = false;
    }

    // localStorage에 저장
    localStorage.setItem('agentMode', agentModeEnabled);

    showToast(`🤖 Agent Mode ${agentModeEnabled ? '활성화' : '비활성화'}`);
}

/**
 * localStorage에서 Agent Mode 상태를 복원하고 UI 동기화
 * @returns {void}
 */
function loadAgentMode() {
    const saved = localStorage.getItem('agentMode');
    if (saved !== null) {
        agentModeEnabled = saved === 'true';
        const toggle = document.getElementById('agentModeToggle');
        if (toggle) {
            toggle.checked = agentModeEnabled;
            // 상태 복원
            if (agentModeEnabled) {
                setPromptMode('agent');
                const select = document.getElementById('promptModeSelect');
                if (select) {
                    select.value = 'agent';
                    select.disabled = true;
                }
            }
        }
    }
}

/**
 * localStorage에서 프롬프트 모드를 복원하고 select 동기화
 * @returns {void}
 */
function loadPromptMode() {
    const saved = localStorage.getItem('promptMode');
    if (saved) {
        currentPromptMode = saved;
        const select = document.getElementById('promptModeSelect');
        if (select) select.value = saved;
    }
}

// ========================================
// Settings Save/Reset Functions
// ========================================

/**
 * 현재 설정을 localStorage에 저장하고 전역 변수 동기화
 * 
 * MCP 설정, 프롬프트 모드, 선택된 모델을 저장하고,
 * 토글 버튼 상태를 업데이트한 뒤 500ms 후 모달을 닫습니다.
 *
 * @returns {void}
 */
function saveSettings() {
    // MCP 설정 저장
    localStorage.setItem('mcpSettings', JSON.stringify(mcpSettings));

    // 프롬프트 모드 저장
    localStorage.setItem('promptMode', currentPromptMode);

    // 현재 선택된 모델 저장
    const modelSelect = document.getElementById('modelSelect');
    if (modelSelect) {
        localStorage.setItem('selectedModel', modelSelect.value);
    }

    // 기존 변수들과 동기화
    thinkingEnabled = mcpSettings.thinking;
    webSearchEnabled = mcpSettings.webSearch;

    updateToggleButtonStates();

    showToast('✅ 설정이 저장되었습니다');

    // 모달 닫기
    setTimeout(() => {
        closeSettings();
    }, 500);
}

/**
 * 모든 설정을 기본값으로 초기화 (확인 다이얼로그 포함)
 * 
 * MCP 설정, 프롬프트 모드, 테마를 기본값으로 되돌리고
 * localStorage와 UI를 업데이트합니다.
 *
 * @returns {void}
 */
function resetSettings() {
    if (!confirm('모든 설정을 기본값으로 초기화하시겠습니까?')) {
        return;
    }

    // 기본값으로 초기화
    mcpSettings = {
        thinking: true,
        webSearch: false,
        pdf: true,
        github: false,
        exa: false,
        enabledTools: {}
    };
    currentPromptMode = 'auto';

    // localStorage 저장
    localStorage.setItem('mcpSettings', JSON.stringify(mcpSettings));
    localStorage.setItem('promptMode', currentPromptMode);

    // UI 업데이트
    document.getElementById('mcpThinking').checked = true;
    document.getElementById('mcpWebSearch').checked = false;
    document.getElementById('mcpPDF').checked = true;
    if (document.getElementById('mcpGithub')) document.getElementById('mcpGithub').checked = false;
    if (document.getElementById('mcpExa')) document.getElementById('mcpExa').checked = false;
    document.getElementById('promptModeSelect').value = 'auto';

    // 테마 초기화
    setTheme('system');

    updateToggleButtonStates();

    showToast('🔄 설정 및 테마가 초기화되었습니다');
}

/**
 * 사이드바 접기/펼치기 토글 (collapsed 클래스)
 * @returns {void}
 */
function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('collapsed');
}

// ========================================
// User Guide Functions (Manual Automation)
// ========================================
/**
 * 사용자 가이드 모달을 열고 GUIDE_DATA를 기반으로 동적 렌더링
 * 
 * GUIDE_DATA(전역 상수)의 sections를 순회하며:
 * - 'auto_detect' 섹션: 카드 그리드로 표시
 * - 'commands' 섹션: 명령어 목록으로 표시
 * - 'prompt_modes' 섹션: 클릭 가능한 태그로 표시
 *
 * @returns {void}
 */
function showUserGuide() {
    const modal = document.getElementById('guideModal');
    const body = document.getElementById('guideBody');
    const title = document.getElementById('guideTitle');
    const footer = document.getElementById('guideFooter');

    if (!modal || !body || typeof GUIDE_DATA === 'undefined') {
        console.error('Guide data or modal elements not found');
        return;
    }

    // 데이터 기반 동적 렌더링
    title.textContent = `📖 ${GUIDE_DATA.title}`;
    footer.textContent = GUIDE_DATA.footer;

    let html = '';
    GUIDE_DATA.sections.forEach(section => {
        html += `
            <div class="guide-section">
                <div class="guide-section-title">${section.title}</div>
                <div class="guide-section-desc">${section.description}</div>
        `;

        if (section.id === 'auto_detect') {
            html += `<div class="guide-grid">`;
            section.items.forEach(item => {
                html += `
                    <div class="guide-card">
                        <div class="guide-card-icon">${item.icon}</div>
                        <div class="guide-card-content">
                            <div class="guide-card-label">${item.label}</div>
                            <div class="guide-card-example">${item.example} → ${item.mode} 모드</div>
                        </div>
                    </div>
                `;
            });
            html += `</div>`;
        } else if (section.id === 'commands') {
            html += `<div class="guide-command-list">`;
            section.items.forEach(item => {
                html += `
                    <div class="guide-command-item">
                        <div class="guide-command-code">${item.cmd}</div>
                        <div class="guide-command-desc">${item.desc}</div>
                    </div>
                `;
            });
            html += `</div>`;
        } else if (section.id === 'prompt_modes') {
            html += `<div class="guide-mode-tags">`;
            section.modes.forEach(mode => {
                html += `<span class="guide-mode-tag" onclick="useMode('${mode}')">${mode}</span>`;
            });
            html += `</div>`;
        }

        html += `</div>`;
    });

    body.innerHTML = html;
    modal.classList.add('active');
}

/**
 * 사용자 가이드 모달 닫기
 * @returns {void}
 */
function closeGuideModal() {
    document.getElementById('guideModal').classList.remove('active');
}

/**
 * 가이드 모달에서 모드 태그 클릭 시 /mode 명령어를 입력창에 설정
 *
 * @param {string} mode - 설정할 프롬프트 모드
 * @returns {void}
 */
function useMode(mode) {
    document.getElementById('chatInput').value = `/mode ${mode}`;
    closeGuideModal();
    document.getElementById('chatInput').focus();
}

// 구형 로직 호환성 유지용 빈 함수 (레거시 코드에서 호출될 수 있음)
/** @deprecated 호환성 유지용 빈 함수 */
function showHelpPopup() { }
/** @deprecated 호환성 유지용 빈 함수 */
function hideHelpPopup() { }
/** @deprecated 호환성 유지용 빈 함수 */
function hideHelpPopupDelayed() { }
/** @deprecated 호환성 유지용 빈 함수 */
function closeHelpPopup() { }

/**
 * 슬래시 명령어('/') 처리
 * 
 * 지원 명령어:
 * - /help : 사용자 가이드 모달 열기
 * - /clear : 새 대화 시작 (채팅 초기화)
 * - /mode [타입] : 프롬프트 모드 변경 (assistant, reasoning, coder 등)
 *
 * @param {string} command - 입력된 명령어 문자열 (슬래시 포함)
 * @returns {boolean} 명령어가 처리되었으면 true, 아니면 false
 */
function handleCommand(command) {
    const cmd = command.toLowerCase().trim();

    if (cmd === '/help') {
        showUserGuide();
        return true;
    }

    if (cmd === '/clear') {
        newChat();
        showToast('💬 대화가 초기화되었습니다');
        return true;
    }

    if (cmd.startsWith('/mode ')) {
        const mode = cmd.substring(6).trim();
        const validModes = ['assistant', 'reasoning', 'coder', 'reviewer', 'explainer', 'generator', 'agent'];
        if (validModes.includes(mode)) {
            showToast(`🎯 프롬프트 모드: ${mode}`);
            // 모드 힌트를 다음 메시지에 추가하도록 설정
            return true;
        } else {
            showToast(`❌ 알 수 없는 모드. 사용 가능: ${validModes.join(', ')}`);
            return true;
        }
    }

    return false;
}

/**
 * /help 명령어 실행 시 채팅 영역에 인라인 도움말 메시지 표시
 * 
 * 자동 프롬프트 감지 표, 사용 가능한 명령어,
 * 프롬프트 모드 태그, 사용 예시를 HTML 테이블/리스트로 렌더링합니다.
 *
 * @returns {void}
 */
function showHelpAndMessage() {
    const welcomeScreen = document.getElementById('welcomeScreen');
    if (welcomeScreen) welcomeScreen.style.display = 'none';

    // HTML 형식으로 직접 도움말 표시
    const container = document.getElementById('chatMessages');
    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

    const div = document.createElement('div');
    div.className = 'chat-message assistant';
    div.innerHTML = `
        <div class="message-avatar">✨</div>
        <div class="message-wrapper">
            <div class="message-content help-message">
                <h3 style="margin-bottom: 16px; color: var(--accent-primary);">💡 OpenMake.Ai 사용 가이드</h3>
                
                <div style="margin-bottom: 16px;">
                    <h4 style="margin-bottom: 8px;">🎯 자동 프롬프트 감지</h4>
                    <p style="margin-bottom: 8px; color: var(--text-secondary);">질문 유형에 따라 자동으로 최적의 모드가 선택됩니다:</p>
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                        <thead>
                            <tr style="background: var(--bg-tertiary);">
                                <th style="padding: 8px; text-align: left; border-bottom: 1px solid var(--border-color);">질문 유형</th>
                                <th style="padding: 8px; text-align: left; border-bottom: 1px solid var(--border-color);">감지 키워드</th>
                                <th style="padding: 8px; text-align: left; border-bottom: 1px solid var(--border-color);">프롬프트</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr><td style="padding: 6px 8px;">🧮 수학/비교</td><td style="padding: 6px 8px;">"크다", "비교", "계산"</td><td style="padding: 6px 8px;"><code>reasoning</code></td></tr>
                            <tr><td style="padding: 6px 8px;">💻 코드 작성</td><td style="padding: 6px 8px;">"코드", "함수", "개발"</td><td style="padding: 6px 8px;"><code>coder</code></td></tr>
                            <tr><td style="padding: 6px 8px;">🚀 프로젝트 생성</td><td style="padding: 6px 8px;">"만들어", "앱", "프로젝트"</td><td style="padding: 6px 8px;"><code>generator</code></td></tr>
                            <tr><td style="padding: 6px 8px;">🔍 코드 리뷰</td><td style="padding: 6px 8px;">"검토", "리뷰"</td><td style="padding: 6px 8px;"><code>reviewer</code></td></tr>
                            <tr><td style="padding: 6px 8px;">📚 개념 설명</td><td style="padding: 6px 8px;">"설명", "뭐야"</td><td style="padding: 6px 8px;"><code>explainer</code></td></tr>
                            <tr><td style="padding: 6px 8px;">🤖 도구 호출</td><td style="padding: 6px 8px;">"검색", "찾아", "도구"</td><td style="padding: 6px 8px;"><code>agent</code></td></tr>
                            <tr><td style="padding: 6px 8px;">💬 일반 대화</td><td style="padding: 6px 8px;">그 외</td><td style="padding: 6px 8px;"><code>assistant</code></td></tr>
                        </tbody>
                    </table>
                </div>

                <div style="margin-bottom: 16px;">
                    <h4 style="margin-bottom: 8px;">⌨️ 사용 가능한 명령어</h4>
                    <ul style="list-style: none; padding: 0; margin: 0;">
                        <li style="padding: 4px 0;"><code>/help</code> - 이 도움말 표시</li>
                        <li style="padding: 4px 0;"><code>/clear</code> - 대화 초기화</li>
                        <li style="padding: 4px 0;"><code>/mode [타입]</code> - 프롬프트 모드 전환</li>
                    </ul>
                </div>

                <div style="margin-bottom: 16px;">
                    <h4 style="margin-bottom: 8px;">🔧 프롬프트 모드</h4>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                        <span class="mode-tag">assistant</span>
                        <span class="mode-tag">reasoning</span>
                        <span class="mode-tag">coder</span>
                        <span class="mode-tag">reviewer</span>
                        <span class="mode-tag">explainer</span>
                        <span class="mode-tag">generator</span>
                        <span class="mode-tag">agent</span>
                    </div>
                </div>

                <div>
                    <h4 style="margin-bottom: 8px;">💬 예시</h4>
                    <ul style="list-style: none; padding: 0; margin: 0; font-size: 13px; color: var(--text-secondary);">
                        <li style="padding: 4px 0;">"3.12와 3.9 중 뭐가 더 커?" → <strong>reasoning</strong> 모드</li>
                        <li style="padding: 4px 0;">"React로 Todo 앱 만들어줘" → <strong>generator</strong> 모드</li>
                        <li style="padding: 4px 0;">"API가 뭐야?" → <strong>explainer</strong> 모드</li>
                        <li style="padding: 4px 0;">"최신 AI 뉴스 검색해줘" → <strong>agent</strong> 모드</li>
                    </ul>
                </div>
            </div>
            <div class="message-time">${timestamp}</div>
        </div>
    `;

    container.appendChild(div);
    scrollToBottom();
}

// ========================================
// 키보드 이벤트 처리
// ========================================

/**
 * 채팅 입력창의 키보드 이벤트 핸들러
 * 
 * - Enter (Shift 없이): 메시지 전송 또는 명령어 실행
 * - Enter (Shift 포함): 줄바꿈 (기본 동작)
 * - ESC: 도움말 팝업 닫기
 * - IME 조합 중(한글 입력 등): Enter 무시 (isComposing/keyCode 229)
 *
 * @param {KeyboardEvent} event - 키보드 이벤트 객체
 * @returns {void}
 */
function handleKeyDown(event) {
    const input = document.getElementById('chatInput');
    const value = input.value.trim();

    // IME 조합 중인 경우 (한글 등 입력 중) Enter 무시
    if (event.isComposing || event.keyCode === 229) {
        return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();

        // 빈 메시지 무시
        if (!value && attachedFiles.length === 0) {
            return;
        }

        // 명령어 체크
        if (value.startsWith('/')) {
            if (handleCommand(value)) {
                input.value = '';
                return;
            }
        }

        hideHelpPopup();
        sendMessage();
    }

    // ESC로 도움말 닫기
    if (event.key === 'Escape') {
        hideHelpPopup();
    }
}

// 텍스트 영역 자동 높이 조절 + 전송 버튼 초기화
document.addEventListener('DOMContentLoaded', () => {
    const textarea = document.getElementById('chatInput');
    if (textarea) {
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
        });
    }

    // 전송 버튼 초기 onclick 바인딩 (인라인 onclick 제거됨)
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
        sendBtn.onclick = sendMessage;
    }

    // 채팅 입력 영역 드래그 앤 드롭 파일 업로드 초기화
    setupChatDropZone();
});

// ========================================
// 마크다운 렌더링 및 유틸리티
// ========================================

/**
 * 마크다운 텍스트를 DOM 요소에 렌더링
 * 
 * marked.js 라이브러리가 로드되어 있으면 마크다운 파싱 후
 * window.purifyHTML로 XSS 방어 처리한 HTML을 삽입합니다.
 * 라이브러리가 없거나 파싱 실패 시 평문 텍스트로 표시합니다.
 *
 * @param {HTMLElement} element - 렌더링 대상 DOM 요소
 * @param {string} text - 마크다운 원문
 * @returns {void}
 */
function renderMarkdown(element, text) {
    if (typeof marked !== 'undefined') {
        try {
            marked.setOptions({
                breaks: true,
                gfm: true
            });
            element.innerHTML = window.purifyHTML(marked.parse(text));
            element.classList.add('markdown-body');
        } catch (e) {
            console.error('Markdown parse error:', e);
            element.textContent = text;
        }
    } else {
        // marked 라이브러리가 없으면 기본 텍스트
        element.textContent = text;
    }
}

/**
 * HTML 특수문자를 이스케이프하여 XSS 방지
 * 
 * DOM API를 이용한 안전한 이스케이프 방식:
 * textContent에 설정하면 브라우저가 자동으로 특수문자를 엔티티로 변환합니다.
 *
 * @param {string} str - 이스케이프할 문자열
 * @returns {string} HTML 이스케이프된 문자열
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ========================================
// 문서 분석 진행 현황 표시
// ========================================

/** @type {number|null} 문서 진행률 숨김 타이머 ID */
let progressHideTimeout = null;

/**
 * 문서 분석 진행 현황을 채팅 입력 영역 위에 표시
 * 
 * 단계별 아이콘(upload, extract, pdf_parse, ocr_*, excel_parse, complete, error)과
 * 프로그레스 바, 파일명, 메시지를 표시합니다.
 * 완료/에러 시 3초 후 페이드아웃으로 자동 숨김합니다.
 *
 * @param {Object} event - 문서 진행 이벤트 데이터
 * @param {string} event.stage - 현재 단계 ('upload'|'extract'|'pdf_parse'|'ocr_prepare'|'ocr_convert'|'ocr_recognize'|'ocr_complete'|'excel_parse'|'image_ocr'|'text_read'|'complete'|'error')
 * @param {number} [event.progress] - 진행률 (0-100)
 * @param {string} event.message - 현재 상태 메시지
 * @param {string} [event.filename] - 처리 중인 파일명
 * @returns {void}
 */
function showDocumentProgress(event) {
    let progressContainer = document.getElementById('documentProgress');

    // 컨테이너가 없으면 생성
    if (!progressContainer) {
        progressContainer = document.createElement('div');
        progressContainer.id = 'documentProgress';
        progressContainer.className = 'document-progress';

        // 입력 영역 위에 삽입
        const inputContainer = document.querySelector('.chat-input-container');
        if (inputContainer) {
            inputContainer.insertBefore(progressContainer, inputContainer.firstChild);
        } else {
            document.body.appendChild(progressContainer);
        }
    }

    // 기존 타이머 취소
    if (progressHideTimeout) {
        clearTimeout(progressHideTimeout);
        progressHideTimeout = null;
    }

    // 단계별 아이콘
    const stageIcons = {
        'upload': '📤',
        'extract': '📋',
        'pdf_parse': '📄',
        'ocr_prepare': '🔧',
        'ocr_convert': '🖼️',
        'ocr_recognize': '🔍',
        'ocr_complete': '✅',
        'excel_parse': '📊',
        'image_ocr': '🖼️',
        'text_read': '📝',
        'complete': '✅',
        'error': '❌'
    };

    const icon = stageIcons[event.stage] || '⏳';
    const isComplete = event.stage === 'complete';
    const isError = event.stage === 'error';

    // 진행률 바 생성
    const progressBar = event.progress !== undefined
        ? `<div class="progress-bar">
             <div class="progress-fill ${isComplete ? 'complete' : ''} ${isError ? 'error' : ''}" 
                  style="width: ${event.progress}%"></div>
           </div>`
        : '';

    // 파일명 표시 (있는 경우)
    const filenameDisplay = event.filename
        ? `<span class="progress-filename">${escapeHtml(truncateFilename(event.filename, 30))}</span>`
        : '';

    progressContainer.innerHTML = `
        <div class="progress-content">
            <span class="progress-icon ${isComplete || isError ? '' : 'animate'}">${icon}</span>
            <div class="progress-info">
                ${filenameDisplay}
                <span class="progress-message">${escapeHtml(event.message)}</span>
            </div>
            ${progressBar}
        </div>
    `;

    progressContainer.style.display = 'flex';
    progressContainer.classList.remove('hiding');

    // 완료 또는 에러 시 3초 후 숨김
    if (isComplete || isError) {
        progressHideTimeout = setTimeout(() => {
            progressContainer.classList.add('hiding');
            setTimeout(() => {
                progressContainer.style.display = 'none';
                progressContainer.classList.remove('hiding');
            }, 300);
        }, 3000);
    }
}

/**
 * 긴 파일명을 최대 길이로 잘라서 '...' 추가 (확장자 보존)
 *
 * @param {string} filename - 원본 파일명
 * @param {number} maxLength - 최대 표시 길이
 * @returns {string} 잘린 파일명 (예: 'very_long_docu....pdf')
 */
function truncateFilename(filename, maxLength) {
    if (!filename || filename.length <= maxLength) return filename;
    const ext = filename.split('.').pop();
    const name = filename.slice(0, -(ext.length + 1));
    const truncatedName = name.slice(0, maxLength - ext.length - 4) + '...';
    return truncatedName + '.' + ext;
}

// 초기화 - initApp()은 index.html의 onload에서 호출됨
// 중복 초기화 방지를 위해 별도의 DOMContentLoaded 이벤트 핸들러 제거

// ========================================
// 🆕 기능 카드 시작 함수 (Welcome Screen)
// ========================================
/**
 * 환영 화면의 기능 카드 클릭 시 해당 기능의 AI 환영 메시지 표시
 * 
 * feature에 따라 코딩, 문서 작성, 데이터 분석, 일반 채팅 중
 * 적절한 환영 메시지를 표시하고 입력창에 포커스합니다.
 *
 * @param {'coding'|'document'|'data'|'chat'} feature - 선택한 기능 타입
 * @returns {void}
 */
function startFeatureChat(feature) {
    const prompts = {
        coding: '안녕하세요! 코딩 에이전트입니다. 코드 작성, 디버깅, 코드 리뷰 등을 도와드립니다. 어떤 코딩 작업을 도와드릴까요?',
        document: '안녕하세요! 문서 작성 도우미입니다. 블로그 글, 보고서 초안, 이메일 등을 작성해 드립니다. 어떤 문서를 작성할까요?',
        data: '안녕하세요! 데이터 분석 에이전트입니다. 데이터 시각화, 통계 분석, 인사이트 도출을 도와드립니다. 어떤 데이터를 분석할까요?',
        chat: '안녕하세요! 무엇이든 물어보세요. 저는 다양한 질문에 답변하고 도움을 드릴 수 있습니다. 😊'
    };

    // Welcome Screen 숨기기
    const welcomeScreen = document.getElementById('welcomeScreen');
    if (welcomeScreen) welcomeScreen.style.display = 'none';

    // AI 환영 메시지 표시
    const message = prompts[feature] || prompts.chat;
    addChatMessage('assistant', message);
    addToMemory('assistant', message);

    // 입력창 포커스
    const input = document.getElementById('chatInput');
    if (input) input.focus();
}
