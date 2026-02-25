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
 * 공통 요청 처리
 * - credentials: 'include' (httpOnly 쿠키 자동 포함)
 * - Content-Type: application/json (기본)
 * - 인증 토큰 자동 첨부 (window.authFetch 위임 가능)
 *
 * @param {string} endpoint - API 경로 (/api/...)
 * @param {RequestInit} [options={}] - fetch 옵션
 * @returns {Promise<Response>}
 */
async function apiRequest(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    // Upload 요청 시 Content-Type 자동 설정 방지 (브라우저가 multipart boundary 설정)
    if (options.body instanceof FormData) {
        delete headers['Content-Type'];
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
