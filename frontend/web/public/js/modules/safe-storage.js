/**
 * ============================================
 * SafeStorage — localStorage 안전 래퍼
 * ============================================
 * Safari Private Mode 등 localStorage 접근이 차단되는
 * 환경에서 예외 없이 동작하도록 try-catch로 래핑합니다.
 *
 * 이 모듈이 유일한 정의 — 다른 파일에서 중복 정의하지 마세요.
 * 전역 window.SafeStorage로 노출되어 비-모듈 코드에서도 접근 가능합니다.
 *
 * @module safe-storage
 */

export const SafeStorage = {
    getItem: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    setItem: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* Safari Private Mode */ } },
    removeItem: (k) => { try { localStorage.removeItem(k); } catch (e) { /* Safari Private Mode */ } }
};

// 전역 노출 — pages/ 모듈, settings-standalone.js 등 비-import 코드에서 사용
window.SafeStorage = SafeStorage;
