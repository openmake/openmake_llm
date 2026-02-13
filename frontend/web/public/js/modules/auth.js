/**
 * Authentication Module
 * 사용자 인증 및 권한 관리를 담당합니다.
 */

import { getState, setState } from './state.js';

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
 * 인증 상태 초기화
 * 🔒 Phase 3 패치: async로 변경하여 세션 복구 완료를 보장 (경쟁 조건 해결)
 * 반환된 Promise는 앱 초기화 시 await 되어야 함
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

    // 🔒 OAuth 쿠키 기반 세션 복구: localStorage에 사용자 정보가 없으면
    // httpOnly 쿠키로 인증된 세션이 있는지 서버에 확인
    // 🔒 Phase 3: await로 세션 복구 완료까지 대기 (이전: fire-and-forget → race condition)
    if (!getState('auth.currentUser')) {
        await recoverSessionFromCookie();
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
 * 🔒 httpOnly 쿠키 기반 세션 복구
 * OAuth 로그인 후 리다이렉트 시 localStorage가 비어있는 경우 처리
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
 * @param {string} url - 요청 URL
 * @param {object} options - fetch 옵션
 */
async function authFetch(url, options = {}) {
    const authToken = getState('auth.authToken');

    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(url, {
        ...options,
        credentials: 'include',  // 🔒 httpOnly 쿠키 자동 포함
        headers
    });

    // 401 인터셉터: 세션 만료 시 로그인 페이지로 리다이렉트
    if (response.status === 401 && !url.includes('/api/auth/login')) {
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
 * 로그인
 * @param {string} email - 이메일
 * @param {string} password - 비밀번호
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
 * 로그아웃 (🆕 서버 토큰 블랙리스트 연동)
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
 */
function enterGuestMode() {
    SafeStorage.setItem('guestMode', 'true');
    setState('auth.isGuestMode', true);
    updateAuthUI();
}

/**
 * 인증 UI 업데이트
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
 */
function isAdmin() {
    const user = getState('auth.currentUser');
    return user?.role === 'admin';
}

/**
 * 로그인 상태 확인
 */
function isLoggedIn() {
    return !!getState('auth.currentUser');
}

/**
 * 현재 사용자 정보 조회
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
