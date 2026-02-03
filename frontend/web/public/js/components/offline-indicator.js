/**
 * ============================================
 * Offline Indicator Component
 * 
 * 네트워크 연결 상태를 표시하는 고정 배너
 * - 오프라인 상태를 amber/orange 배너로 표시
 * - 2초 debounce로 깜빡임 방지
 * - 온라인 복구 시 즉시 숨김
 * 
 * 의존성: 없음 (순수 vanilla JS)
 * ============================================
 */

(function () {
    'use strict';

    var LOG_PREFIX = '[OfflineIndicator]';
    var DEBOUNCE_DELAY = 2000; // 2초 debounce
    var debounceTimer = null;
    var isOfflineState = false;
    var bannerEl = null;

    /**
     * 스타일 주입
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
     * 배너 생성
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
     * 배너 표시 (debounce 적용)
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
     * 배너 숨김 (즉시)
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
     */
    function getIsOffline() {
        return isOfflineState;
    }

    /**
     * 초기화
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
