/**
 * ============================================
 * Offline Indicator - 네트워크 상태 표시 컴포넌트
 * ============================================
 * 네트워크 연결 상태를 화면 상단 고정 배너로 표시합니다.
 * 오프라인 시 amber/orange 배너 표시(2초 디바운스),
 * 온라인 복구 시 즉시 숨김 처리됩니다.
 * 의존성 없이 순수 Vanilla JS로 구현되었습니다.
 *
 * @module components/offline-indicator
 */

(function () {
    'use strict';

    /** @type {string} 콘솔 로그 접두사 */
    var LOG_PREFIX = '[OfflineIndicator]';
    /** @type {number} 오프라인 배너 표시 디바운스 지연 시간 (ms) */
    var DEBOUNCE_DELAY = 2000;
    /** @type {number|null} 디바운스 타이머 ID */
    var debounceTimer = null;
    /** @type {boolean} 현재 오프라인 상태 */
    var isOfflineState = false;
    /** @type {HTMLElement|null} 배너 DOM 요소 */
    var bannerEl = null;

    /**
     * 오프라인 배너 CSS 스타일을 head에 주입
     * 중복 주입을 방지합니다.
     * @returns {void}
     */
    function injectStyles() {
        if (document.getElementById('offline-indicator-styles')) {
            return; // 이미 주입됨
        }

        var style = document.createElement('style');
        style.id = 'offline-indicator-styles';
        style.textContent = `
            #offline-banner {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                z-index: 10000;
                background: rgba(245, 158, 11, 0.95);
                color: #1a1a2e;
                padding: 12px 16px;
                display: flex;
                align-items: center;
                gap: 12px;
                font-weight: 500;
                font-size: 14px;
                border-bottom: 1px solid rgba(245, 158, 11, 0.5);
                backdrop-filter: blur(10px);
                border-radius: 0 0 8px 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                animation: slideDown 0.3s ease-out;
                transform-origin: top;
            }

            #offline-banner.hide {
                animation: slideUp 0.3s ease-in forwards;
            }

            #offline-banner.pulse {
                animation: slideDown 0.3s ease-out, pulse 2s ease-in-out infinite;
            }

            @keyframes slideDown {
                from {
                    transform: translateY(-100%);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }

            @keyframes slideUp {
                from {
                    transform: translateY(0);
                    opacity: 1;
                }
                to {
                    transform: translateY(-100%);
                    opacity: 0;
                }
            }

            @keyframes pulse {
                0%, 100% {
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                }
                50% {
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
                }
            }

            #offline-banner-icon {
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 18px;
                flex-shrink: 0;
            }

            #offline-banner-text {
                flex: 1;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * 오프라인 배너 DOM 요소 생성
     * @returns {HTMLElement} 생성된 배너 요소
     */
    function createBanner() {
        if (bannerEl) {
            return bannerEl;
        }

        bannerEl = document.createElement('div');
        bannerEl.id = 'offline-banner';
        bannerEl.innerHTML = `
            <div id="offline-banner-icon">⚠️</div>
            <div id="offline-banner-text">인터넷 연결이 끊겼습니다</div>
        `;

        return bannerEl;
    }

    /**
     * 오프라인 배너 표시 (DEBOUNCE_DELAY 적용)
     * 짧은 연결 끊김을 필터링하여 깜빡임을 방지합니다.
     * @returns {void}
     */
    function show() {
        // 기존 debounce 타이머 취소
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }

        // 이미 표시 중이면 반환
        if (isOfflineState && bannerEl && bannerEl.parentNode) {
            return;
        }

        // debounce 설정
        debounceTimer = setTimeout(function () {
            if (!bannerEl) {
                createBanner();
            }

            // 배너가 DOM에 없으면 추가
            if (!bannerEl.parentNode) {
                document.body.insertBefore(bannerEl, document.body.firstChild);
            }

            // 애니메이션 클래스 제거 후 추가 (재트리거)
            bannerEl.classList.remove('hide');
            bannerEl.classList.add('pulse');

            isOfflineState = true;

            if (typeof debugLog === 'function') {
                debugLog(LOG_PREFIX + ' 오프라인 상태 표시');
            }

            debounceTimer = null;
        }, DEBOUNCE_DELAY);
    }

    /**
     * 오프라인 배너 즉시 숨김 (디바운스 타이머 취소 후 애니메이션 숨김)
     * @returns {void}
     */
    function hide() {
        // debounce 타이머 취소
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }

        if (!bannerEl || !bannerEl.parentNode) {
            isOfflineState = false;
            return;
        }

        // 애니메이션으로 숨김
        bannerEl.classList.remove('pulse');
        bannerEl.classList.add('hide');

        // 애니메이션 완료 후 DOM에서 제거
        setTimeout(function () {
            if (bannerEl && bannerEl.parentNode) {
                bannerEl.parentNode.removeChild(bannerEl);
            }
            isOfflineState = false;

            if (typeof debugLog === 'function') {
                debugLog(LOG_PREFIX + ' 온라인 상태 복구');
            }
        }, 300);
    }

    /**
     * 현재 오프라인 상태 확인
     * @returns {boolean} 오프라인 상태 여부
     */
    function getIsOffline() {
        return isOfflineState;
    }

    /**
     * 오프라인 인디케이터 초기화
     * 스타일 주입, 배너 생성, 초기 상태 확인, 이벤트 리스너 등록을 수행합니다.
     * @returns {void}
     */
    function initOfflineIndicator() {
        injectStyles();
        createBanner();

        // 초기 상태 확인
        if (!navigator.onLine) {
            // 초기 상태에서는 debounce 없이 즉시 표시
            if (!bannerEl.parentNode) {
                document.body.insertBefore(bannerEl, document.body.firstChild);
            }
            bannerEl.classList.add('pulse');
            isOfflineState = true;

            if (typeof debugLog === 'function') {
                debugLog(LOG_PREFIX + ' 초기화: 오프라인 상태');
            }
        }

        // offline 이벤트 리스너
        window.addEventListener('offline', function () {
            if (typeof debugLog === 'function') {
                debugLog(LOG_PREFIX + ' offline 이벤트 감지');
            }
            show();
        });

        // online 이벤트 리스너
        window.addEventListener('online', function () {
            if (typeof debugLog === 'function') {
                debugLog(LOG_PREFIX + ' online 이벤트 감지');
            }
            hide();
        });

        if (typeof debugLog === 'function') {
            debugLog(LOG_PREFIX + ' 초기화 완료');
        }
    }

    // 전역 노출
    window.offlineIndicator = {
        show: show,
        hide: hide,
        isOffline: getIsOffline
    };

    // 자동 초기화
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initOfflineIndicator);
    } else {
        initOfflineIndicator();
    }
})();
