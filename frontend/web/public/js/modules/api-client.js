/**
 * ============================================================
 * API Client — 중앙 HTTP 클라이언트
 * ============================================================
 *
 * fetch 래핑 유틸리티. 인증 헤더 자동 포함, JSON 파싱,
 * 공통 에러 처리를 제공합니다.
 *
 * 기존 authFetch 패턴을 기반으로 구현하되, ApiClient 네임스페이스로
 * 래핑하여 page module에서 일관되게 사용할 수 있습니다.
 *
 * @module api-client
 */

/**
 * CSRF API 계약 상수 — backend `config/security.ts`의 CSRF_POLICY를 반영.
 * 이 프로젝트는 build-step 없는 vanilla JS이므로 백엔드 상수를 직접 import할 수 없다.
 * 백엔드에서 값이 바뀌면 이 블록도 함께 업데이트해야 한다.
 * @see backend/api/src/config/security.ts CSRF_POLICY
 */
const CSRF_CONTRACT = Object.freeze({
    COOKIE_NAME: 'csrf_token',
    HEADER_NAME: 'X-CSRF-Token',
    TOKEN_ENDPOINT: '/api/csrf-token',
});

/** CSRF 검증 대상 메서드 — 백엔드 SAFE_METHODS의 역보완 (mutating만) */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** document.cookie에서 이름으로 값 추출 */
function readCookie(name) {
    const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1');
    const match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
}

/**
 * CSRF 토큰 lazy-fetch. 쿠키에 토큰 없으면 TOKEN_ENDPOINT 호출로 발급 받고 반환.
 * 실패해도 throw하지 않음 — 서버가 warn 모드면 요청이 통과할 수 있어 사용자 경험 보호.
 */
async function ensureCsrfToken() {
    let token = readCookie(CSRF_CONTRACT.COOKIE_NAME);
    if (token) return token;
    try {
        await fetch(CSRF_CONTRACT.TOKEN_ENDPOINT, { method: 'GET', credentials: 'include' });
        token = readCookie(CSRF_CONTRACT.COOKIE_NAME);
    } catch (_e) { /* 네트워크 실패: 호출측은 토큰 없이 진행, 서버 모드에 따라 결과 달라짐 */ }
    return token;
}

/**
 * 공통 요청 처리
 * - credentials: 'include' (httpOnly 쿠키 자동 포함)
 * - Content-Type: application/json (기본)
 * - mutating 메서드(POST/PUT/PATCH/DELETE)에 한해 X-CSRF-Token 헤더 자동 주입
 *
 * @param {string} endpoint - API 경로 (/api/...)
 * @param {RequestInit} [options={}] - fetch 옵션
 * @returns {Promise<Response>}
 */
async function apiRequest(endpoint, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    // Upload 요청 시 Content-Type 자동 설정 방지 (브라우저가 multipart boundary 설정)
    if (options.body instanceof FormData) {
        delete headers['Content-Type'];
    }

    // CSRF Double-Submit Cookie 헤더 주입 (변경 메서드에 한정)
    if (MUTATING_METHODS.has(method) && !headers[CSRF_CONTRACT.HEADER_NAME]) {
        const token = await ensureCsrfToken();
        if (token) headers[CSRF_CONTRACT.HEADER_NAME] = token;
    }

    return fetch(endpoint, {
        ...options,
        credentials: 'include',
        headers
    });
}

const ApiClient = Object.freeze({

    /**
     * GET 요청
     * @param {string} endpoint
     * @param {RequestInit} [options={}]
     * @returns {Promise<any>} parsed JSON
     */
    async get(endpoint, options = {}) {
        const res = await apiRequest(endpoint, { ...options, method: 'GET' });
        return res.json();
    },

    /**
     * POST 요청 (JSON body)
     * @param {string} endpoint
     * @param {object} body
     * @param {RequestInit} [options={}]
     * @returns {Promise<any>} parsed JSON
     */
    async post(endpoint, body, options = {}) {
        const res = await apiRequest(endpoint, {
            ...options,
            method: 'POST',
            body: JSON.stringify(body)
        });
        return res.json();
    },

    /**
     * PUT 요청 (JSON body)
     * @param {string} endpoint
     * @param {object} body
     * @param {RequestInit} [options={}]
     * @returns {Promise<any>} parsed JSON
     */
    async put(endpoint, body, options = {}) {
        const res = await apiRequest(endpoint, {
            ...options,
            method: 'PUT',
            body: JSON.stringify(body)
        });
        return res.json();
    },

    /**
     * DELETE 요청
     * @param {string} endpoint
     * @param {RequestInit} [options={}]
     * @returns {Promise<any>} parsed JSON
     */
    async del(endpoint, options = {}) {
        const res = await apiRequest(endpoint, { ...options, method: 'DELETE' });
        return res.json();
    },

    /**
     * 파일 업로드 (multipart/form-data)
     * @param {string} endpoint
     * @param {FormData} formData
     * @param {RequestInit} [options={}]
     * @returns {Promise<any>} parsed JSON
     */
    async upload(endpoint, formData, options = {}) {
        const res = await apiRequest(endpoint, {
            ...options,
            method: 'POST',
            body: formData  // FormData → Content-Type 자동 처리
        });
        return res.json();
    },

    /**
     * Raw fetch — 파싱 없이 Response 반환
     * 스트리밍 응답 등 특수 케이스용
     * @param {string} endpoint
     * @param {RequestInit} [options={}]
     * @returns {Promise<Response>}
     */
    async raw(endpoint, options = {}) {
        return apiRequest(endpoint, options);
    }
});

// Expose globally for IIFE page modules
window.ApiClient = ApiClient;
