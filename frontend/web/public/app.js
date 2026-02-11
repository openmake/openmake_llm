// OpenMake.Ai - Premium UI
// ========================================
//
// #6 개선: 모듈 분리 마이그레이션
// ----------------------------------------
// 이 파일은 모놀리스 구조입니다 (~2800줄).
// js/modules/ 아래에 도메인별 모듈이 준비되어 있습니다:
//
//   state.js     - 중앙 집중 상태 관리 (AppState, getState, setState)
//   auth.js      - 인증 로직 (initAuth, authFetch, logout, updateAuthUI)
//   ui.js        - UI 유틸리티 (showToast, escapeHtml, scrollToBottom, applyTheme)
//   websocket.js - WebSocket 연결 및 메시지 핸들링
//   chat.js      - 채팅 기능 (sendMessage, addChatMessage, appendToken)
//   settings.js  - 설정 모달 및 MCP/프롬프트 모드
//   utils.js     - 포맷팅, 디버그, 파일 유틸리티
//   guide.js     - 사용자 가이드 렌더링
//   sanitize.js  - XSS 방어 (escapeHTML, sanitizeHTML)
//
// 마이그레이션 절차:
// 1. 각 모듈이 window 객체에 함수를 노출 (현재 완료)
// 2. index.html에서 모듈 script 태그 추가 (Phase 2 준비됨)
// 3. 이 파일의 해당 섹션을 제거하고 모듈로 대체
// 4. 모든 모듈 전환 후 이 파일 삭제
//
// ========================================

// 🆕 Debug Mode - set to false for production
const DEBUG_MODE = false;
const debug = {
    log: (...args) => DEBUG_MODE && console.log(...args),
    warn: (...args) => DEBUG_MODE && console.warn(...args),
    error: (...args) => console.error(...args)  // errors always show
};

// State
let ws = null;
let nodes = [];
let chatHistory = [];
let currentChatId = null;
let webSearchEnabled = false;
let discussionMode = false;  // 멀티 에이전트 토론 모드
let thinkingMode = false;    // Ollama Native Thinking 모드 (심층 추론)
let thinkingLevel = 'high'; // Thinking 레벨: 'low', 'medium', 'high'
let deepResearchMode = false;  // Deep Research 모드 (심층 연구)
let thinkingEnabled = true; // Sequential Thinking 기본 활성화
let attachedFiles = [];
let messageStartTime = null;
let isGenerating = false;  // 응답 생성 중 여부 (중단 버튼용)

// 인증 상태
let currentUser = null;
let authToken = null;
let isGuestMode = false;

// 대화 메모리 (LLM 컨텍스트용)
let conversationMemory = [];
const MAX_MEMORY_LENGTH = 20;

// 세션 레벨 문서 컨텍스트 (PDF 업로드 시 저장, 모든 채팅에서 참조)
let activeDocumentContext = null;  // { docId, filename, textLength }

// ========================================
// 인증 헬퍼 함수
// ========================================

// 관리자 여부 확인 (모델 이름 표시 권한)
function isAdmin() {
    const savedUser = localStorage.getItem('user');
    if (!savedUser) return false;
    try {
        const user = JSON.parse(savedUser);
        return user.role === 'admin' || user.role === 'administrator';
    } catch (e) {
        return false;
    }
}

// 인증 상태 초기화
function initAuth() {
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
    if (!currentUser && !isGuestMode) {
        recoverSessionFromCookie();
    } else if (!currentUser && isGuestMode) {
        // 게스트 모드이지만 OAuth 쿠키 세션이 있을 수 있음 (OAuth 로그인 후 리다이렉트)
        recoverSessionFromCookie();
    }
}

// 🔒 httpOnly 쿠키 기반 세션 복구
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
                
                // 모듈 상태도 동기화 (state.js의 AppState)
                if (typeof window.setState === 'function') {
                    window.setState('auth.currentUser', user);
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
            }
        }
    } catch (e) {
        // 네트워크 오류 등 — 무시 (비로그인 상태 유지)
    }
}

// 인증된 fetch 요청
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

// 로그아웃 (🆕 서버 토큰 블랙리스트 연동)
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

// 인증 UI 업데이트
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

// 권한 체크
function isAdmin() {
    return currentUser?.role === 'admin';
}

function isLoggedIn() {
    return !!currentUser;
}

// 에이전트 목록 렌더링
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

// 초기화
function initApp() {
    initAuth(); // 인증 상태 초기화
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
    if (sessionId) {
        // 약간의 지연 후 로드 (초기화 안정성 확보)
        setTimeout(() => loadSession(sessionId), 100);
    }

    // WebSocket 연결 후 자동으로 에이전트 목록 요청됨 (connectWebSocket의 onopen에서 처리)
}

// 📱 모바일 사이드바 초기화 - 앱 로드 시 사이드바 숨기기
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

// 게스트/비로그인 메뉴 필터링
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

// 사용자 상태 배지 표시
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


// 모바일 사이드바 토글 — UnifiedSidebar 연동
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

// 햄버거 아이콘 상태 동기화 (bars ↔ X)
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

function closeMobileSidebar() {
    // UnifiedSidebar로 닫기
    if (window.sidebar && typeof window.sidebar.setState === 'function') {
        window.sidebar.setState('hidden');
    }
    const menuBtn = document.getElementById('mobileMenuBtn');
    if (menuBtn) menuBtn.classList.remove('active');
}

// 사이드바 메뉴 클릭 시 모바일에서 자동 닫기
function closeSidebarOnMobileNav() {
    if (window.innerWidth <= 768) {
        closeMobileSidebar();
    }
}


// ========================================
// Theme Management
// ========================================

function applyTheme(theme) {
    if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);
}

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
// Suggestion Cards
// ========================================
function useSuggestion(text) {
    const input = document.getElementById('chatInput');
    input.value = text;
    input.focus();
    // Hide welcome screen
    const welcomeScreen = document.getElementById('welcomeScreen');
    if (welcomeScreen) welcomeScreen.style.display = 'none';
}

// WebSocket Connection with Auto-Reconnect
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 1000;

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

// 연결 상태 UI 업데이트
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

function handleMessage(data) {
    switch (data.type) {
        case 'init':
            updateClusterInfo(data.data);
            break;
        case 'update':
            updateClusterInfo(data.data);
            break;
        case 'token':
            appendToken(data.token);
            break;
        case 'done':
            finishAssistantMessage();
            break;
        case 'agents':
            renderAgentList(data.agents);
            break;
        case 'error':
            // 🆕 API 키 소진 에러 특별 처리
            if (data.errorType === 'api_keys_exhausted') {
                showApiKeyExhaustedError(data);
            } else {
                showError(data.message);
            }
            break;
        case 'aborted':
            console.log('[Chat] 응답 생성 중단됨');
            isGenerating = false;
            isSending = false;
            hideAbortButton();
            break;
        case 'cluster_event':
            handleClusterEvent(data.event);
            break;
        case 'document_progress':
            showDocumentProgress(data);
            break;
        case 'mcp_settings_ack':
            // 서버에서 MCP 설정 동기화 완료 확인
            console.log('[MCP] 서버 동기화 완료:', data.settings);
            break;
        case 'mcp_settings_update':
            // 외부(REST API)에서 MCP 설정이 변경됨 - UI 동기화
            console.log('[MCP] 외부 설정 변경 감지:', data.settings);
            syncMCPSettingsFromServer(data.settings);
            showToast('🔄 MCP 설정이 외부에서 변경되었습니다', 'info');
            break;
        case 'agent_selected':
            // 에이전트 선택 정보 수신
            console.log('[Agent] 선택됨:', data.agent);
            showAgentBadge(data.agent);
            break;
        case 'discussion_progress':
            // 멀티 에이전트 토론 진행 상황
            console.log('[Discussion] 진행:', data.progress);
            showDiscussionProgress(data.progress);
            break;
        case 'research_progress':
            // 🔬 Deep Research 진행 상황
            console.log('[Research] 진행:', data.progress);
            showResearchProgress({
                stage: data.progress?.currentStep || 'running',
                progress: data.progress?.progress || 0,
                message: data.progress?.message || '연구 중...'
            });
            break;
        case 'session_created':
            // 🆕 WebSocket 채팅에서 생성된 새 세션 ID 수신
            console.log('[Session] 새 세션 생성:', data.sessionId);
            currentSessionId = data.sessionId;
            loadChatSessions(); // 사이드바 히스토리 새로고침
            break;
    }
}

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

// 사이드바 클러스터 상태 업데이트
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

function updateClusterStatus(text, online) {
    const statusText = document.getElementById('clusterStatusText');
    const statusDot = document.querySelector('.status-dot');

    if (statusText) statusText.textContent = text;
    if (statusDot) {
        statusDot.classList.toggle('online', online);
        statusDot.classList.toggle('offline', !online);
    }
}

// REST API 폴백: WebSocket init이 실패했을 때 클러스터 정보 가져오기
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

function updateModelSelect() {
    const select = document.getElementById('modelSelect');
    if (!select) return;

    const allModels = [...new Set(nodes.flatMap(n => n.models || []))];

    // 🔒 관리자가 아니면 모델 이름 숨김
    if (!isAdmin()) {
        select.innerHTML = '<option value="default">AI Assistant</option>';
        select.disabled = true;
        select.style.cursor = 'default';
        return;
    }

    select.disabled = false;
    select.style.cursor = 'pointer';

    if (allModels.length > 0) {
        const savedModel = localStorage.getItem('selectedModel');
        // 서버 설정에서 기본 모델 가져오거나 첫 번째 모델 사용
        const defaultModel = window.__SERVER_CONFIG__?.defaultModel || allModels[0] || '';

        select.innerHTML = allModels.map(m => {
            const isSelected = savedModel ? m === savedModel : (defaultModel ? m.includes(defaultModel) : false);
            return `<option value="${escapeHtml(m)}" ${isSelected ? 'selected' : ''}>${escapeHtml(m)}</option>`;
        }).join('');

        if (!savedModel && select.value) {
            localStorage.setItem('selectedModel', select.value);
        }

        // Change 이벤트 리스너 추가 (중복 방지)
        select.onchange = function () {
            localStorage.setItem('selectedModel', this.value);
            showToast(`🤖 모델 변경됨: ${this.value}`);
        };
    }
}

function handleClusterEvent(event) {
    ws.send(JSON.stringify({ type: 'refresh' }));
}

// 채팅 기능
let currentAssistantMessage = null;
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
            const rawText = content.dataset.rawText || content.textContent || '';
            content.innerHTML = rawText + '<br><span style="color: var(--warning); font-style: italic;">⏹️ 응답이 중단되었습니다.</span>';
        }
    }
    currentAssistantMessage = null;
}

// SVG 아이콘 상수
const SEND_ICON_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z"/></svg>';
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

    // 모델 선택기가 없으면 기본값 사용 (서버에서 자동 선택)
    const model = document.getElementById('modelSelect')?.value || 'default';

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

// 대화 메모리 관리
function addToMemory(role, content, images = null) {
    const memoryItem = { role, content };
    if (images && images.length > 0) memoryItem.images = images;
    conversationMemory.push(memoryItem);
    // 메모리 크기 제한
    if (conversationMemory.length > MAX_MEMORY_LENGTH * 2) {
        conversationMemory = conversationMemory.slice(-MAX_MEMORY_LENGTH);
    }
}

function clearMemory() {
    conversationMemory = [];
}

// ========================================
// 활성 문서 컨텍스트 UI
// ========================================

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

function clearActiveDocument() {
    activeDocumentContext = null;
    updateActiveDocumentUI();
    showToast('📄 문서 컨텍스트가 해제되었습니다', 'info');
    console.log('[Document] 활성 문서 컨텍스트 해제');
}

// ========================================
// 에이전트 배지 표시
// ========================================
let currentAgent = null;

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
                background: rgba(99, 102, 241, 0.12);
                border: 1px solid rgba(99, 102, 241, 0.25);
                border-radius: 20px;
                font-size: 0.85rem;
                color: var(--text-primary);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
                animation: agentFadeIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                transition: all 0.3s ease;
            ">
                <span style="font-size: 1.1rem; filter: drop-shadow(0 0 2px rgba(0,0,0,0.1));">${agent.emoji}</span>
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
                    transform: translateY(-2px);
                    box-shadow: 0 6px 16px rgba(99, 102, 241, 0.15);
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

// 토론 모드 토글
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

// Thinking 모드 토글 (Ollama Native Thinking)
function toggleThinkingMode() {
    thinkingMode = !thinkingMode;
    const btn = document.getElementById('thinkingModeBtn');
    if (btn) {
        btn.classList.toggle('active', thinkingMode);
        btn.title = thinkingMode ? `Thinking 모드 활성화 (${thinkingLevel})` : 'Thinking 모드 비활성화';
    }
    showToast(thinkingMode ? `🧠 Thinking 모드 활성화 (레벨: ${thinkingLevel})` : '💬 일반 모드로 전환', 'info');
}

// Deep Research 모드 토글 (심층 연구)
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

// 토론 진행 상황 표시 (채팅창 상단 미니바 스타일)
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
                    background: rgba(255, 255, 255, 0.9);
                    border: 1px solid var(--border-medium);
                    border-radius: 20px;
                    padding: 8px 16px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-size: 0.85rem;
                    color: var(--text-primary);
                    backdrop-filter: blur(8px);
                    animation: slideUp 0.3s ease-out;
                }
                [data-theme="dark"] #discussionProgress {
                    background: rgba(30, 30, 35, 0.9);
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

// Deep Research 진행 상황 표시 (채팅창 상단 미니바 스타일)
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
                    background: linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%);
                    border: 1px solid rgba(139, 92, 246, 0.3);
                    border-radius: 20px;
                    padding: 8px 16px;
                    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.1);
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-size: 0.85rem;
                    color: var(--text-primary);
                    backdrop-filter: blur(8px);
                    animation: slideUp 0.3s ease-out;
                }
                [data-theme="dark"] #researchProgress {
                    background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(59, 130, 246, 0.15) 100%);
                    border-color: rgba(139, 92, 246, 0.4);
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
                    background: linear-gradient(90deg, #8B5CF6 0%, #3B82F6 100%);
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
                    background: rgba(139, 92, 246, 0.2);
                    border-radius: 8px;
                    color: #8B5CF6;
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
// Scroll to bottom
// ========================================
function scrollToBottom() {
    const chatArea = document.getElementById('chatArea');
    if (chatArea) {
        chatArea.scrollTop = chatArea.scrollHeight;
    }
}

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

// 메시지 복사
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

// 메시지 재생성
function regenerateMessage() {
    // 마지막 사용자 메시지 찾기
    const lastUserContent = conversationMemory.filter(m => m.role === 'user').pop();
    if (lastUserContent) {
        const input = document.getElementById('chatInput');
        input.value = lastUserContent.content;
        sendMessage();
    }
}

// 토스트 알림
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

// 🆕 API 키 소진 에러 표시 (카운트다운 포함)
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
                background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                color: white;
                padding: 16px 24px;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 16px;
                font-size: 0.95rem;
                box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
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
                background: rgba(0, 0, 0, 0.2);
                padding: 8px 16px;
                border-radius: 8px;
                font-weight: 600;
                font-size: 1.1rem;
                min-width: 80px;
                text-align: center;
            }
            #apiKeyExhaustedBanner .close-btn {
                background: rgba(255, 255, 255, 0.2);
                border: none;
                color: white;
                padding: 6px 12px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 0.85rem;
            }
            #apiKeyExhaustedBanner .close-btn:hover {
                background: rgba(255, 255, 255, 0.3);
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

// 카운트다운 포맷 (분:초)
function formatCountdown(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// API 키 소진 배너 닫기
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

let currentSessionId = null;

// 🆕 익명 세션 ID 관리 (비로그인 사용자용)
function getOrCreateAnonymousSessionId() {
    let anonSessionId = sessionStorage.getItem('anonSessionId');
    if (!anonSessionId) {
        anonSessionId = 'anon-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem('anonSessionId', anonSessionId);
        console.log('[Auth] 새 익명 세션 ID 생성:', anonSessionId);
    }
    return anonSessionId;
}

// 세션 목록 로드 (🆕 사용자 격리 적용)
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

// 시간 포맷팅
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

// 새 세션 생성 (🆕 anonSessionId 지원)
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

// 세션 로드 (대화 복원)
async function loadSession(sessionId) {
     try {
         const res = await fetch(`/api/chat/sessions/${sessionId}/messages`);
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

// 복원된 AI 응답 메시지 추가 (마크다운 렌더링 적용)
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

// 메시지 저장
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

// 세션 삭제
async function deleteSession(sessionId) {
    if (!confirm('이 대화를 삭제하시겠습니까?')) return;

    try {
        const res = await fetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' });
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

// 기존 addToChatHistory 유지 (호환성)
function addToChatHistory(message) {
    // 서버에 메시지 저장
    saveMessageToSession('user', message);
}

// 새 대화 시작
function newChat() {
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

// 파일 업로드
function showFileUpload() {
    document.getElementById('fileModal').classList.add('active');
    setupFileInput();
}

function closeFileModal() {
    document.getElementById('fileModal').classList.remove('active');
}

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

function removeAttachment(index) {
    attachedFiles.splice(index, 1);
    renderAttachments();
}

function clearAttachments() {
    attachedFiles = [];
    renderAttachments();
}

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

// 요약 응답 포맷팅 헬퍼
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

// 웹 검색
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

// 설정
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

// LLM 모델 정보 로드
async function loadModelInfo() {
    const activeModelName = document.getElementById('activeModelName');
    const modelListContainer = document.getElementById('modelListContainer');

    if (!activeModelName || !modelListContainer) return;

    // 🔒 관리자가 아니면 모델 정보 숨김
    if (!isAdmin()) {
        activeModelName.textContent = 'AI Assistant (Premium)';
        modelListContainer.innerHTML = '<span style="color: var(--text-muted);">모델 정보는 관리자만 볼 수 있습니다</span>';
        return;
    }

    activeModelName.textContent = '로딩 중...';
    modelListContainer.innerHTML = '<span style="color: var(--text-muted);">조회 중...</span>';

     try {
          // Ollama 모델 목록 API 호출
          const response = await fetch('/api/models', {
              credentials: 'include'  // 🔒 httpOnly 쿠키 포함
          });
          if (response.ok) {
              const data = await response.json();
              const payload = data.data || data;
             console.log('[Settings] 모델 정보:', data);

             // 현재 기본 모델 표시 (서버 응답 우선)
             const defaultModel = payload.defaultModel || payload.models?.[0]?.name || 'AI Assistant';
             activeModelName.textContent = defaultModel;

             // 설치된 모델 목록 표시
             if (payload.models && payload.models.length > 0) {
                 const savedModel = localStorage.getItem('selectedModel');
                 modelListContainer.innerHTML = payload.models.map(model => {
                     // 저장된 모델이 있으면 그것을, 없으면 기본 모델을 활성 상태로 표시
                     const isActive = savedModel ? model.name === savedModel : model.name === defaultModel;
                     return `
                     <div class="model-badge ${isActive ? 'active' : ''}" onclick="selectModel('${escapeHtml(model.name)}')">
                         ${isActive ? '✓ ' : ''}${escapeHtml(model.name)}
                         <span style="font-size: 0.65rem; opacity: 0.7; margin-left: 4px;">(${formatSize(model.size)})</span>
                     </div>
                 `}).join('');
             } else {
                 modelListContainer.innerHTML = '<span style="color: var(--text-muted);">설치된 모델 없음</span>';
             }
        } else {
            throw new Error('모델 API 응답 오류');
        }
    } catch (error) {
        console.error('[Settings] 모델 정보 조회 실패:', error);
        activeModelName.textContent = 'AI Assistant (Premium)';
        modelListContainer.innerHTML = '<span style="color: var(--text-muted);">모델 목록을 가져올 수 없습니다</span>';
    }
}

// 파일 크기 포맷팅
function formatSize(bytes) {
    if (!bytes) return '?';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)}GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)}MB`;
}

function selectModel(modelName) {
    localStorage.setItem('selectedModel', modelName);

    // UI 업데이트
    const badges = document.querySelectorAll('.model-badge');
    badges.forEach(b => {
        if (b.textContent.includes(modelName)) {
            b.classList.add('active');
            if (!b.textContent.includes('✓')) {
                // 텍스트 노드만 업데이트하거나 재렌더링 필요
                loadModelInfo(); // 간단하게 재로드
            }
        } else {
            b.classList.remove('active');
        }
    });

    // 메인 셀렉트 박스도 업데이트
    const select = document.getElementById('modelSelect');
    if (select) {
        select.value = modelName;
    }

    showToast(`🤖 모델 선택됨: ${modelName}`);
}

// 설정 섹션 토글 (아코디언)
function toggleSection(sectionId) {
    const content = document.getElementById(sectionId);
    const arrow = document.getElementById(sectionId + '-arrow');

    if (content && arrow) {
        content.classList.toggle('collapsed');
        arrow.classList.toggle('collapsed');
    }
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('active');
}

// ========================================
// MCP Module Settings
// ========================================
let mcpSettings = {
    thinking: true,
    webSearch: false,
    pdf: true,
    github: false,
    exa: false
};

// MCP 설정 로드
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
    // 기존 토글 버튼과 동기화
    thinkingEnabled = mcpSettings.thinking;
    webSearchEnabled = mcpSettings.webSearch;

    updateToggleButtonStates();
}

// 토글 버튼 상태 업데이트
function updateToggleButtonStates() {
    const thinkingBtn = document.getElementById('thinkingBtn');
    const webSearchBtn = document.getElementById('webSearchBtn');

    if (thinkingBtn) thinkingBtn.classList.toggle('active', thinkingEnabled);
    if (webSearchBtn) webSearchBtn.classList.toggle('active', webSearchEnabled);
}

// MCP 모듈 토글 - 즉시 기능 적용 및 서버 동기화
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

// MCP 설정을 서버에 동기화 (WebSocket)
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

// 서버에서 받은 MCP 설정을 UI에 동기화
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

// 프롬프트 모드 설정 - 즉시 적용
let currentPromptMode = 'auto';

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

// Agent Mode 토글
let agentModeEnabled = false;

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

// 설정 저장
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

// 설정 초기화
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
        exa: false
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

// 사이드바 토글
function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('collapsed');
}

// ========================================
// User Guide Functions (Manual Automation)
// ========================================
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

function closeGuideModal() {
    document.getElementById('guideModal').classList.remove('active');
}

function useMode(mode) {
    document.getElementById('chatInput').value = `/mode ${mode}`;
    closeGuideModal();
    document.getElementById('chatInput').focus();
}

// 구형 로직 호환성 유지 (호출 시 무시하거나 가이드 열기)
function showHelpPopup() { }
function hideHelpPopup() { }
function hideHelpPopupDelayed() { }
function closeHelpPopup() { }

// 명령어 처리
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

// /help 명령어로 도움말 메시지 표시
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

// 키보드 이벤트
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
});

// 마크다운 렌더링 헬퍼
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

// 유틸리티
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// 문서 분석 진행 현황 표시
let progressHideTimeout = null;

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

// 파일명 자르기 헬퍼
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
