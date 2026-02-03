/**
 * Authentication Module
 * 사용자 인증 및 권한 관리를 담당합니다.
 */

import { getState, setState } from './state.js';

/**
 * 인증 상태 초기화
 */
function initAuth() {
    const authToken = localStorage.getItem('authToken');
    const isGuestMode = localStorage.getItem('guestMode') === 'true';

    setState('auth.authToken', authToken);
    setState('auth.isGuestMode', isGuestMode);

    const savedUser = localStorage.getItem('user');
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            setState('auth.currentUser', user);
        } catch (e) {
            setState('auth.currentUser', null);
        }
    }

    updateAuthUI();
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

    return fetch(url, {
        ...options,
        credentials: 'include',  // 🔒 httpOnly 쿠키 자동 포함
        headers
    });
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

        if (response.ok && data.token) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            localStorage.removeItem('guestMode');

            setState('auth.authToken', data.token);
            setState('auth.currentUser', data.user);
            setState('auth.isGuestMode', false);

            return { success: true, user: data.user };
        }

        return { success: false, error: data.error || '로그인 실패' };
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
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    localStorage.removeItem('guestMode');

    setState('auth.authToken', null);
    setState('auth.currentUser', null);
    setState('auth.isGuestMode', false);

    window.location.href = '/login.html';
}

/**
 * 게스트 모드로 진입
 */
function enterGuestMode() {
    localStorage.setItem('guestMode', 'true');
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
window.login = login;
window.logout = logout;
window.enterGuestMode = enterGuestMode;
window.updateAuthUI = updateAuthUI;
window.isAdmin = isAdmin;
window.isLoggedIn = isLoggedIn;
window.getCurrentUser = getCurrentUser;

export {
    initAuth,
    authFetch,
    login,
    logout,
    enterGuestMode,
    updateAuthUI,
    isAdmin,
    isLoggedIn,
    getCurrentUser
};
