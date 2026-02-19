/**
 * ============================================
 * Authentication - 사용자 인증 및 권한 관리
 * ============================================
 * JWT 토큰 및 httpOnly 쿠키 기반 인증을 처리합니다.
 * OAuth 세션 복구, 게스트 모드, 익명 세션 이관(claiming),
 * 인증된 API 요청(authFetch) 기능을 제공합니다.
 *
 * @module auth
 */

import { getState, setState } from './state.js';

/**
 * 안전한 localStorage 래퍼
 * localStorage 접근 시 발생할 수 있는 예외(Safari 프라이빗 모드 등)를 처리합니다.
 * @type {{getItem: Function, setItem: Function, removeItem: Function}}
 */
const SafeStorage = window.SafeStorage || {
    getItem(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    setItem(key, value) {
        try { localStorage.setItem(key, value); } catch (e) {}
    },
    removeItem(key) {
        try { localStorage.removeItem(key); } catch (e) {}
    }
};

/**
 * Silent refresh 동시성 가드.
 * authFetch는 401(로그인/리프레시 요청 제외) 응답을 받으면 /api/auth/refresh를 1회 시도하고,
 * 성공 시 토큰을 SafeStorage/AppState에 반영한 뒤 원 요청을 1회만 재시도합니다.
 */
let isRefreshing = false;

/**
 * 인증 상태 초기화
 * localStorage에서 토큰과 사용자 정보를 복원하고,
 * 사용자 정보가 없으면 httpOnly 쿠키 기반 세션 복구를 시도합니다.
 * Phase 3 패치: async로 변경하여 세션 복구 완료를 보장 (경쟁 조건 해결)
 * @returns {Promise<void>} 세션 복구 완료까지 대기
 */
async function initAuth() {
    const authToken = SafeStorage.getItem('authToken');
    const isGuestMode = SafeStorage.getItem('guestMode') === 'true';

    setState('auth.authToken', authToken);
    setState('auth.isGuestMode', isGuestMode);

    const savedUser = SafeStorage.getItem('user');
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            setState('auth.currentUser', user);
        } catch (e) {
            setState('auth.currentUser', null);
        }
    }

    updateAuthUI();

    // 🔒 자동로그인 차단: OAuth 콜백 리턴(?auth=callback) 시에만 쿠키 기반 세션 복구
    // 일반 페이지 접속 시에는 자동로그인하지 않음 — 사용자가 명시적으로 로그인해야 함
    const urlParams = new URLSearchParams(window.location.search);
    const isOAuthCallback = urlParams.get('auth') === 'callback';

    if (isOAuthCallback && !getState('auth.currentUser')) {
        await recoverSessionFromCookie();
        // URL에서 ?auth=callback 파라미터 제거 (깔끔한 URL 유지)
        urlParams.delete('auth');
        const cleanUrl = urlParams.toString()
            ? `${window.location.pathname}?${urlParams.toString()}`
            : window.location.pathname;
        window.history.replaceState(null, '', cleanUrl);
    }
}

/**
 * 🔒 Phase 3: 익명 세션 클레이밍 공용 함수
 * 로그인/OAuth 복구 시 이전 게스트 대화를 사용자에게 귀속
 * 4곳에 중복되었던 로직을 이 함수 하나로 통합
 * @param {string|null} token - Bearer 토큰 (없으면 쿠키 사용)
 */
async function claimAnonymousSession(token) {
    const anonSessionId = sessionStorage.getItem('anonSessionId');
    if (!anonSessionId) return;

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        await fetch('/api/chat/sessions/claim', {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({ anonSessionId })
        });
        sessionStorage.removeItem('anonSessionId');
        console.log('[Auth Module] 익명 세션 이관 완료:', anonSessionId);
    } catch (claimErr) {
        console.warn('[Auth Module] 익명 세션 이관 실패 (무시):', claimErr);
    }
}

/**
 * httpOnly 쿠키 기반 세션 복구
 * OAuth 로그인 후 리다이렉트 시 localStorage가 비어있는 경우,
 * 서버의 /api/auth/me 엔드포인트를 호출하여 세션을 복원합니다.
 * 복구 성공 시 localStorage와 AppState를 동기화하고 사이드바를 업데이트합니다.
 * @returns {Promise<void>}
 */
async function recoverSessionFromCookie() {
    try {
        const resp = await fetch('/api/auth/me', { credentials: 'include' });
        if (resp.ok) {
            const data = await resp.json();
            const user = data.data?.user || data.user;
            if (user && user.email) {
                // 세션 복구 성공
                SafeStorage.setItem('user', JSON.stringify(user));
                SafeStorage.removeItem('guestMode');
                SafeStorage.removeItem('isGuest');

                // 🔒 OAuth 세션 마커: httpOnly 쿠키 기반 인증 표시
                // spa-router.js의 isAuthenticated()가 이 값을 확인하여 인증 상태 유지
                if (!SafeStorage.getItem('authToken')) {
                    SafeStorage.setItem('authToken', 'cookie-session');
                    setState('auth.authToken', 'cookie-session');
                }

                setState('auth.currentUser', user);
                setState('auth.isGuestMode', false);

                updateAuthUI();

                // 사이드바 업데이트
                if (window.sidebar && typeof window.sidebar._updateUserSection === 'function') {
                    window.sidebar._updateUserSection();
                }

                console.log('[Auth Module] OAuth 쿠키 세션 복구 성공:', user.email);

                // 🔒 Phase 3: 통합된 클레이밍 함수 사용
                await claimAnonymousSession(getState('auth.authToken'));
            }
        }
    } catch (e) {
        // 네트워크 오류 — 무시
    }
}

/**
 * 인증된 fetch 요청
 * Authorization 헤더와 httpOnly 쿠키를 자동으로 포함합니다.
 * 401 응답(로그인/리프레시 제외) 시 Silent Refresh를 먼저 시도한 뒤 실패하면 로그인 페이지로 리다이렉트합니다.
 * @param {string} url - 요청 URL
 * @param {object} [options={}] - fetch 옵션 (headers, method, body 등)
 * @returns {Promise<Response>} fetch Response 객체
 */
async function authFetch(url, options = {}) {
    const requestOptions = { ...options };
    const isRetryAfterRefresh = requestOptions._retryAfterRefresh === true;
    delete requestOptions._retryAfterRefresh;

    const authToken = getState('auth.authToken');

    const headers = {
        'Content-Type': 'application/json',
        ...(requestOptions.headers || {})
    };

    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(url, {
        ...requestOptions,
        credentials: 'include',  // 🔒 httpOnly 쿠키 자동 포함
        headers
    });

    const isLoginRequest = url.includes('/api/auth/login');
    const isRefreshRequest = url.includes('/api/auth/refresh');

    // 401 인터셉터: 세션 만료 시 로그인 페이지로 리다이렉트
    if (response.status === 401 && !isLoginRequest && !isRefreshRequest) {
        if (!isRetryAfterRefresh) {
            if (isRefreshing) {
                while (isRefreshing) {
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
                return authFetch(url, { ...options, _retryAfterRefresh: true });
            }

            isRefreshing = true;
            try {
                const refreshResponse = await fetch('/api/auth/refresh', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' }
                });

                if (refreshResponse.ok) {
                    const refreshData = await refreshResponse.json();
                    const newToken = refreshData?.data?.token;

                    if (refreshData?.success === true && newToken) {
                        SafeStorage.setItem('authToken', newToken);
                        setState('auth.authToken', newToken);
                        return authFetch(url, { ...options, _retryAfterRefresh: true });
                    }
                }
            } catch (e) {
                // 네트워크 오류 시 기존 401 리다이렉트 로직으로 폴백
            } finally {
                isRefreshing = false;
            }
        }

        SafeStorage.removeItem('authToken');
        SafeStorage.removeItem('user');
        setState('auth.authToken', null);
        setState('auth.currentUser', null);
        window.location.href = '/login.html';
        return response;
    }

    return response;
}

/**
 * 인증된 JSON fetch 요청 (자동 JSON 파싱 + 표준 응답 언래핑)
 * 페이지 모듈에서 로컬 authFetch 대신 사용
 * @param {string} url - 요청 URL
 * @param {object} options - fetch 옵션
 * @returns {Promise<{ok: boolean, data: any, error: string|null}>}
 */
async function authJsonFetch(url, options = {}) {
    const response = await authFetch(url, options);
    const json = await response.json();

    // 표준 응답 형식 언래핑: { success, data, error }
    if (json.success === true) {
        return { ok: true, data: json.data, error: null };
    }
    if (json.success === false) {
        const msg = json.error?.message || json.error || '요청 실패';
        return { ok: false, data: null, error: msg };
    }

    // 비표준 응답 (레거시 호환): 그대로 반환
    return { ok: response.ok, data: json, error: response.ok ? null : '요청 실패' };
}

/**
 * 이메일/비밀번호 로그인
 * 성공 시 JWT 토큰을 저장하고 익명 세션 이관을 수행합니다.
 * @param {string} email - 사용자 이메일 주소
 * @param {string} password - 비밀번호
 * @returns {Promise<{success: boolean, user?: Object, error?: string}>} 로그인 결과
 */
async function login(email, password) {
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            credentials: 'include',  // 🔒 httpOnly 쿠키 포함
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        // Backend wraps in success(): { success, data: { token, user, ... }, meta }
        const payload = data.data || data;
        const token = payload.token;
        const user = payload.user;

        if (response.ok && token) {
            SafeStorage.setItem('authToken', token);
            SafeStorage.setItem('user', JSON.stringify(user));
            SafeStorage.removeItem('guestMode');

            setState('auth.authToken', token);
            setState('auth.currentUser', user);
            setState('auth.isGuestMode', false);

            // 🔒 Phase 3: 통합된 클레이밍 함수 사용
            await claimAnonymousSession(token);

            return { success: true, user };
        }

        // Error response: { success: false, error: { code, message } }
        const errorMsg = data.error?.message || data.error || '로그인 실패';
        return { success: false, error: errorMsg };
    } catch (error) {
        return { success: false, error: '네트워크 오류' };
    }
}

/**
 * 로그아웃 처리
 * 서버에 토큰 블랙리스트 등록을 요청하고 로컬 인증 정보를 정리합니다.
 * 완료 후 로그인 페이지로 리다이렉트합니다.
 * @returns {void}
 */
function logout() {
    // 서버에 로그아웃 요청 (httpOnly 쿠키 포함)
    authFetch('/api/auth/logout', {
        method: 'POST'
    }).catch(() => {});

    // localStorage 정리
    SafeStorage.removeItem('authToken');
    SafeStorage.removeItem('user');
    SafeStorage.removeItem('guestMode');

    setState('auth.authToken', null);
    setState('auth.currentUser', null);
    setState('auth.isGuestMode', false);

    window.location.href = '/login.html';
}

/**
 * 게스트 모드로 진입
 * 로그인 없이 제한된 기능을 사용할 수 있도록 설정합니다.
 * @returns {void}
 */
function enterGuestMode() {
    SafeStorage.setItem('guestMode', 'true');
    setState('auth.isGuestMode', true);
    updateAuthUI();
}

/**
 * 인증 상태에 따른 UI 업데이트
 * 로그인/게스트/비인증 상태에 따라 사용자 정보, 로그인/로그아웃 버튼,
 * 관리자 링크의 표시 여부를 제어합니다.
 * @returns {void}
 */
function updateAuthUI() {
    const currentUser = getState('auth.currentUser');
    const isGuestMode = getState('auth.isGuestMode');

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
            adminLink.style.display = currentUser.role === 'admin' ? 'flex' : 'none';
        }
    } else if (isGuestMode) {
        if (userInfo) {
            userInfo.textContent = '게스트';
            userInfo.style.display = 'block';
        }
        if (loginBtn) loginBtn.style.display = 'flex';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (adminLink) adminLink.style.display = 'none';
    } else {
        if (userInfo) userInfo.style.display = 'none';
        if (loginBtn) loginBtn.style.display = 'flex';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (adminLink) adminLink.style.display = 'none';
    }
}

/**
 * 관리자 권한 확인
 * @returns {boolean} 현재 사용자가 admin 역할인지 여부
 */
function isAdmin() {
    const user = getState('auth.currentUser');
    return user?.role === 'admin';
}

/**
 * 로그인 상태 확인
 * @returns {boolean} 현재 사용자가 로그인되어 있는지 여부
 */
function isLoggedIn() {
    return !!getState('auth.currentUser');
}

/**
 * 현재 사용자 정보 조회
 * @returns {Object|null} 사용자 객체 (email, role, id 등) 또는 null
 */
function getCurrentUser() {
    return getState('auth.currentUser');
}

// 전역 노출 (레거시 호환)
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

export {
    initAuth,
    authFetch,
    authJsonFetch,
    login,
    logout,
    enterGuestMode,
    updateAuthUI,
    isAdmin,
    isLoggedIn,
    getCurrentUser,
    claimAnonymousSession
};
