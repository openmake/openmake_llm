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
import { STORAGE_KEY_AUTH_TOKEN, STORAGE_KEY_USER, STORAGE_KEY_GUEST_MODE, STORAGE_KEY_IS_GUEST } from './constants.js';

/**
 * 안전한 localStorage 래퍼
 * localStorage 접근 시 발생할 수 있는 예외(Safari 프라이빗 모드 등)를 처리합니다.
 * @type {{getItem: Function, setItem: Function, removeItem: Function}}
 */
// SafeStorage 래퍼 — safe-storage.js에서 전역 등록됨
const SafeStorage = window.SafeStorage;

/**
 * Silent refresh 동시성 가드.
 * authFetch는 401(로그인/리프레시 요청 제외) 응답을 받으면 /api/auth/refresh를 1회 시도하고,
 * 성공 시 토큰을 SafeStorage/AppState에 반영한 뒤 원 요청을 1회만 재시도합니다.
 */
let isRefreshing = false;

/**
 * Proactive refresh 타이머 ID.
 * 토큰 만료 전에 미리 갱신하여 401 burst를 방지합니다.
 * @type {number|null}
 */
let refreshTimer = null;

/**
 * 동시 401 대기열.
 * 리프레시 진행 중 추가 401 요청은 이 Promise를 공유합니다.
 * @type {Promise<boolean>|null}
 */
let refreshPromise = null;

/**
 * stale 인증 데이터 정리
 * httpOnly 쿠키 만료 후 localStorage에 남은 잔존 데이터를 제거합니다.
 * @returns {void}
 */
function clearStaleAuth() {
    SafeStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
    SafeStorage.removeItem(STORAGE_KEY_USER);
    SafeStorage.removeItem(STORAGE_KEY_GUEST_MODE);
    SafeStorage.removeItem(STORAGE_KEY_IS_GUEST);
    setState('auth.authToken', null);
    setState('auth.currentUser', null);
    setState('auth.isGuestMode', false);
}

/**
 * Silent refresh: 액세스 토큰 만료 시 리프레시 토큰으로 갱신 시도
 * refresh_token 쿠키(7일, path=/api/auth/refresh)를 사용합니다.
 * @returns {Promise<boolean>} 갱신 성공 여부
 */
async function trySilentRefresh() {
    try {
        const resp = await fetch(API_ENDPOINTS.AUTH_REFRESH, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });
        if (resp.ok) {
            const data = await resp.json();
            const newToken = data?.data?.token;
            if (data?.success === true && newToken) {
                // authToken은 httpOnly 쿠키로 처리됩니다 — localStorage 저장 안함
                setState('auth.authToken', newToken);
                scheduleProactiveRefresh(newToken);
                return true;
            }
        }
        return false;
    } catch (e) {
        return false;
    }
}

/**
 * JWT payload에서 exp 클레임을 추출하여 만료 전에 자동 갱신을 예약합니다.
 * TTL의 80% 시점(예: 15분 토큰 → 12분 후)에 리프레시를 실행합니다.
 * @param {string} token - JWT 액세스 토큰
 * @returns {void}
 */
function scheduleProactiveRefresh(token) {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }
    if (!token || token === 'cookie-session') return;

    try {
        // JWT payload 디코딩 (base64url → JSON)
        const parts = token.split('.');
        if (parts.length !== 3) return;
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        const exp = payload.exp; // UNIX timestamp (seconds)
        if (!exp) return;

        const now = Math.floor(Date.now() / 1000);
        const ttl = exp - now; // seconds until expiry
        if (ttl <= 30) return; // 30초 이하면 예약 불필요

        // TTL의 80% 시점에 갱신 (최소 30초 후)
        const refreshInMs = Math.max(ttl * 0.8, 30) * 1000;

        refreshTimer = setTimeout(async () => {
            refreshTimer = null;
            // 로그아웃 상태면 무시
            if (!getState('auth.currentUser')) return;
            const success = await trySilentRefresh();
            if (!success) {
                // 갱신 실패 — 다음 authFetch 401 인터셉터에 위임
                console.warn('[Auth] Proactive refresh 실패 — 401 인터셉터로 폴백');
            }
        }, refreshInMs);
    } catch (e) {
        // JWT 디코딩 실패 — 무시 (서버가 비표준 토큰을 반환할 수 있음)
    }
}

/**
 * 서버에서 현재 유저 정보를 조회합니다.
 * @returns {Promise<Object|null>} 유저 객체 또는 null
 */
async function fetchCurrentUser() {
    const resp = await fetch(API_ENDPOINTS.AUTH_ME, { credentials: 'include' });
    if (!resp.ok) return null;
    const data = await resp.json();
    const user = data.data?.user || data.user;
    return (user && user.email) ? user : null;
}

/**
 * 인증 상태 초기화
 * localStorage에 유저 데이터가 있으면 서버(/api/auth/me)로 세션 유효성을 검증합니다.
 * 액세스 토큰(15분) 만료 시 리프레시 토큰(7일)으로 자동 갱신을 시도합니다.
 * 네트워크 오류 시에는 localStorage를 유지합니다 (PWA 오프라인 지원).
 * @returns {Promise<void>} 세션 검증 완료까지 대기
 */
async function initAuth() {
    const isGuestMode = SafeStorage.getItem(STORAGE_KEY_GUEST_MODE) === 'true';

    setState('auth.isGuestMode', isGuestMode);

    const savedUser = SafeStorage.getItem(STORAGE_KEY_USER);

    // 🔒 세션 유효성 검증: localStorage에 유저 데이터가 있으면 서버에서 확인
    // 액세스 토큰 만료 시 리프레시 토큰으로 자동 갱신을 시도합니다
    if (savedUser) {
        try {
            // 1차: 현재 액세스 토큰으로 유저 조회
            let user = await fetchCurrentUser();

            if (!user) {
                // 2차: 액세스 토큰 만료 → 리프레시 토큰으로 갱신 시도 (7일 유효)
                const refreshed = await trySilentRefresh();
                if (refreshed) {
                    // 갱신 성공 → 새 액세스 토큰으로 재시도
                    user = await fetchCurrentUser();
                }
            }

            if (user) {
                // ✅ 세션 유효 — 서버의 최신 유저 정보로 갱신
                SafeStorage.setItem('user', JSON.stringify(user));
                setState('auth.currentUser', user);
                // 토큰이 유효하면 proactive refresh 예약
                const currentToken = getState('auth.authToken');
                if (currentToken) scheduleProactiveRefresh(currentToken);
            } else {
                // 리프레시까지 실패 → 세션 완전 만료, stale 데이터 정리
                clearStaleAuth();
            }
        } catch (e) {
            // 네트워크 오류 → 오프라인일 수 있으므로 localStorage 유지 (PWA 지원)
            try {
                const user = JSON.parse(savedUser);
                setState('auth.currentUser', user);
            } catch (parseErr) {
                setState('auth.currentUser', null);
            }
        }
    }

    updateAuthUI();

    // 🔒 OAuth 콜백 리턴(?auth=callback) 시 쿠키 기반 세션 복구
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
        await fetch(API_ENDPOINTS.CHAT_SESSIONS_CLAIM, {
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
        const resp = await fetch(API_ENDPOINTS.AUTH_ME, { credentials: 'include' });
        if (resp.ok) {
            const data = await resp.json();
            const user = data.data?.user || data.user;
            if (user && user.email) {
                // 세션 복구 성공
                SafeStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
                SafeStorage.removeItem(STORAGE_KEY_GUEST_MODE);
                SafeStorage.removeItem(STORAGE_KEY_IS_GUEST);

                setState('auth.currentUser', user);
                setState('auth.isGuestMode', false);

                updateAuthUI();

                // 사이드바 업데이트
                if (window.sidebar && typeof window.sidebar._updateUserSection === 'function') {
                    window.sidebar._updateUserSection();
                }

                console.log('[Auth Module] OAuth 쿠키 세션 복구 성공:', user.email);

                // 🔒 Phase 3: 통합된 클레이밍 함수 사용
                await claimAnonymousSession(null);
                // Proactive refresh 예약 (토큰이 있으면)
                const currentToken = getState('auth.authToken');
                if (currentToken) scheduleProactiveRefresh(currentToken);
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

    if (authToken && authToken !== 'cookie-session') {
        headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(url, {
        ...requestOptions,
        credentials: 'include',  // 🔒 httpOnly 쿠키 자동 포함
        headers
    });

    const isLoginRequest = url.includes(API_ENDPOINTS.AUTH_LOGIN);
    const isRefreshRequest = url.includes(API_ENDPOINTS.AUTH_REFRESH);

    // 401 인터셉터: 세션 만료 시 로그인 페이지로 리다이렉트
    if (response.status === 401 && !isLoginRequest && !isRefreshRequest) {
        if (!isRetryAfterRefresh) {
            // 리프레시 진행 중이면 공유 Promise 대기 (busy-wait 대신)
            if (refreshPromise) {
                const success = await refreshPromise;
                if (success) {
                    return authFetch(url, { ...options, _retryAfterRefresh: true });
                }
            } else {
                // 첫 번째 401 요청이 리프레시를 담당
                refreshPromise = (async () => {
                    isRefreshing = true;
                    try {
                        const refreshResponse = await fetch(API_ENDPOINTS.AUTH_REFRESH, {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' }
                        });

                        if (refreshResponse.ok) {
                            const refreshData = await refreshResponse.json();
                            const newToken = refreshData?.data?.token;

                            if (refreshData?.success === true && newToken) {
                                setState('auth.authToken', newToken);
                                scheduleProactiveRefresh(newToken);
                                return true;
                            }
                        }
                        return false;
                    } catch (e) {
                        return false;
                    } finally {
                        isRefreshing = false;
                        refreshPromise = null;
                    }
                })();

                const success = await refreshPromise;
                if (success) {
                    return authFetch(url, { ...options, _retryAfterRefresh: true });
                }
            }
        }

        SafeStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
        SafeStorage.removeItem(STORAGE_KEY_USER);
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
        const response = await fetch(API_ENDPOINTS.AUTH_LOGIN, {
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
            // authToken은 httpOnly 쿠키로 처리됩니다 — localStorage 저장 안함
            SafeStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
            SafeStorage.removeItem(STORAGE_KEY_GUEST_MODE);

            setState('auth.authToken', token);
            scheduleProactiveRefresh(token);
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
    authFetch(API_ENDPOINTS.AUTH_LOGOUT, {
        method: 'POST'
    }).catch(() => { });

    // Proactive refresh 타이머 해제
    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }

    // localStorage 정리
    SafeStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
    SafeStorage.removeItem(STORAGE_KEY_USER);
    SafeStorage.removeItem(STORAGE_KEY_GUEST_MODE);

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

/**
 * 사용자 등급 변경 (셀프 서비스)
 * PUT /api/auth/tier 호출 후 AppState + localStorage 동기화
 * @param {string} tier - 변경할 등급 ('free' | 'pro' | 'enterprise')
 * @returns {Promise<boolean>} 성공 여부
 */
async function changeTier(tier) {
    const validTiers = ['free', 'pro', 'enterprise'];
    if (!validTiers.includes(tier)) {
        if (typeof showToast === 'function') showToast('유효하지 않은 등급입니다', 'error');
        return false;
    }

    try {
        const res = await authFetch('/api/auth/tier', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tier })
        });

        if (!res || !res.ok) {
            const data = res ? await res.json().catch(() => ({})) : {};
            if (typeof showToast === 'function') showToast(data.error || '등급 변경 실패', 'error');
            return false;
        }

        const data = await res.json();
        const updatedUser = data.data?.user || data.user;

        if (updatedUser) {
            // AppState 업데이트
            setState('auth.currentUser', updatedUser);
            // localStorage 업데이트
            SafeStorage.setItem(STORAGE_KEY_USER, JSON.stringify(updatedUser));
        } else {
            // 서버가 user 객체를 반환하지 않은 경우 로컬만 업데이트
            const currentUser = getState('auth.currentUser');
            if (currentUser) {
                const patched = { ...currentUser, tier };
                setState('auth.currentUser', patched);
                SafeStorage.setItem(STORAGE_KEY_USER, JSON.stringify(patched));
            }
        }

        // 사이드바 티어 배지 갱신
        if (typeof window.updateSidebarTierBadge === 'function') {
            window.updateSidebarTierBadge();
        }

        // 설정 페이지 티어 UI 갱신 (설정 페이지에 있을 때만)
        if (typeof window.refreshTierUI === 'function') {
            window.refreshTierUI();
        }

        // 레거시 사이드바 메뉴 티어별 갱신 (SharedSidebar가 있으면 재렌더링)
        if (document.getElementById('sidebar') && typeof window.SharedSidebar === 'function') {
            try { new window.SharedSidebar().render('sidebar'); } catch (e) { /* ignore */ }
        }

        // 관리자 패널 메뉴도 티어 변경에 맞게 갱신
        // AdminPanel.open()에서 항상 buildPanelHTML()을 재호출하므로 다음 열기 시 자동 반영됨

        const tierLabels = { free: 'Free', pro: 'Pro', enterprise: 'Enterprise' };
        if (typeof showToast === 'function') showToast(tierLabels[tier] + ' 플랜으로 변경되었습니다', 'success');
        return true;
    } catch (error) {
        console.error('[Auth] 등급 변경 오류:', error);
        if (typeof showToast === 'function') showToast('등급 변경 중 오류가 발생했습니다', 'error');
        return false;
    }
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
window.trySilentRefresh = trySilentRefresh;
window.changeTier = changeTier;
// SafeStorage는 safe-storage.js에서 전역 등록됨 — 여기서 중복 등록 불필요

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
    claimAnonymousSession,
    trySilentRefresh,
    changeTier
};
