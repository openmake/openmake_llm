/**
 * ============================================
 * Install Prompt - PWA 설치 안내 컴포넌트
 * ============================================
 * Chrome/Android의 beforeinstallprompt 이벤트와
 * iOS Safari의 수동 안내를 모두 처리합니다.
 * 7일간 닫기 기억, 로그인 페이지 제외, 30초 후 표시 등
 * 사용자 경험을 고려한 조건부 표시 로직을 포함합니다.
 *
 * @module components/install-prompt
 */

/** @type {BeforeInstallPromptEvent|null} 지연된 설치 프롬프트 이벤트 */
var _deferredPrompt = null;
/** @type {HTMLElement|null} 배너 DOM 요소 */
var _bannerEl = null;
/** @type {boolean} 배너 표시 상태 */
var _isShown = false;
/** @type {boolean} 앱 설치 완료 상태 */
var _isInstalled = false;
/** @type {boolean} iOS 디바이스 여부 */
var _isIOS = false;

/**
 * 현재 페이지가 로그인 페이지인지 확인
 * @returns {boolean} 로그인 페이지 여부
 */
function isLoginPage() {
    var pathname = window.location.pathname;
    var hash = window.location.hash;
    return pathname.includes('login') || pathname.includes('auth') || hash.includes('login');
}

/**
 * iOS Safari 환경 감지 (standalone 모드 제외)
 * @returns {boolean} iOS Safari에서 실행 중인지 여부
 */
function detectIOS() {
    var ua = navigator.userAgent;
    var isIOSDevice = /iPhone|iPad|iPod/.test(ua);
    var isStandalone = window.navigator.standalone === true;
    return isIOSDevice && !isStandalone;
}

/**
 * PWA가 이미 설치되었는지 확인 (standalone/navigator.standalone)
 * @returns {boolean} 설치 여부
 */
function checkIfInstalled() {
    if (window.matchMedia('(display-mode: standalone)').matches) {
        return true;
    }
    if (window.navigator.standalone === true) {
        return true;
    }
    return false;
}

/**
 * 배너 닫기 시간 조회
 * @returns {number|null} 타임스탬프 또는 null
 */
function getDismissedTime() {
    var dismissed = localStorage.getItem('installPromptDismissed');
    return dismissed ? parseInt(dismissed, 10) : null;
}

/**
 * 최근 7일 이내 배너를 닫았는지 확인
 * @returns {boolean} 7일 이내 닫음 여부
 */
function isDismissedRecently() {
    var dismissedTime = getDismissedTime();
    if (!dismissedTime) return false;
    var sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    return (Date.now() - dismissedTime) < sevenDaysMs;
}

function setDismissed() {
    localStorage.setItem('installPromptDismissed', Date.now().toString());
}

/**
 * 설치 프롬프트 CSS 스타일을 head에 주입
 * @returns {void}
 */
function injectStyles() {
    if (document.getElementById('install-prompt-styles')) return;

    var style = document.createElement('style');
    style.id = 'install-prompt-styles';
    style.textContent = `
        .install-prompt-banner {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            z-index: 9999;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 16px;
            animation: slideUpInstall 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        .install-prompt-banner.hide {
            animation: slideDownInstall 0.3s ease-out forwards;
        }

        @keyframes slideUpInstall {
            from {
                transform: translateY(100%);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }

        @keyframes slideDownInstall {
            from {
                transform: translateY(0);
                opacity: 1;
            }
            to {
                transform: translateY(100%);
                opacity: 0;
            }
        }

        .install-prompt-content {
            background: var(--bg-card);
            border: 2px solid var(--border-light);
            border-radius: 12px;
            padding: 16px;
            max-width: 480px;
            width: 100%;
            display: flex;
            gap: 12px;
            align-items: flex-start;
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }

        .install-prompt-icon {
            width: 48px;
            height: 48px;
            flex-shrink: 0;
            border-radius: 8px;
            overflow: hidden;
            background: var(--bg-tertiary);
        }

        .install-prompt-icon img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .install-prompt-text {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .install-prompt-title {
            font-size: 14px;
            font-weight: 600;
            line-height: 1.2;
        }

        .install-prompt-subtitle {
            font-size: 12px;
            opacity: 0.85;
            line-height: 1.3;
        }

        .install-prompt-ios-guide {
            font-size: 12px;
            opacity: 0.85;
            line-height: 1.4;
            margin-top: 4px;
        }

        .install-prompt-arrow {
            display: inline-block;
            margin-left: 4px;
            animation: bounceArrow 1.5s ease-in-out infinite;
        }

        @keyframes bounceArrow {
            0%, 100% {
                transform: translateY(0);
            }
            50% {
                transform: translateY(4px);
            }
        }

        .install-prompt-actions {
            display: flex;
            gap: 8px;
            flex-shrink: 0;
        }

        .install-prompt-btn {
            padding: 8px 12px;
            border: none;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            white-space: nowrap;
        }

        .install-prompt-btn-install {
            background: var(--accent-primary);
            color: #ffffff;
        }

        .install-prompt-btn-install:hover {
            transform: translate(-2px, -2px);
            box-shadow: 4px 4px 0 #000;
        }

        .install-prompt-btn-install:active {
            transform: translateY(0);
        }

        .install-prompt-btn-close {
            background: var(--bg-tertiary);
            color: #ffffff;
            padding: 8px 10px;
            min-width: auto;
        }

        .install-prompt-btn-close:hover {
            background: var(--bg-hover);
        }

        @media (max-width: 480px) {
            .install-prompt-content {
                flex-direction: column;
                gap: 12px;
            }

            .install-prompt-icon {
                width: 40px;
                height: 40px;
            }

            .install-prompt-title {
                font-size: 13px;
            }

            .install-prompt-subtitle {
                font-size: 11px;
            }

            .install-prompt-actions {
                width: 100%;
                gap: 8px;
            }

            .install-prompt-btn {
                flex: 1;
                padding: 10px 12px;
            }
        }
    `;
    document.head.appendChild(style);
}

/**
 * 설치 안내 배너 DOM 생성 (iOS/Android 분기)
 * @returns {HTMLElement} 생성된 배너 요소
 */
function createBanner() {
    if (_bannerEl) return _bannerEl;

    var banner = document.createElement('div');
    banner.className = 'install-prompt-banner';
    banner.id = 'install-prompt-banner';

    if (_isIOS) {
        banner.innerHTML = `
            <div class="install-prompt-content">
                <div class="install-prompt-icon">
                    <img src="/icons/icon-72.png" alt="OpenMake.Ai">
                </div>
                <div class="install-prompt-text">
                    <div class="install-prompt-title">홈 화면에 추가하기</div>
                    <div class="install-prompt-ios-guide">
                        Safari 하단의 공유 버튼 <span class="install-prompt-arrow">⬆</span> → '홈 화면에 추가' 선택
                    </div>
                </div>
                <div class="install-prompt-actions">
                    <button class="install-prompt-btn install-prompt-btn-close" data-action="close">✕</button>
                </div>
            </div>
        `;
    } else {
        banner.innerHTML = `
            <div class="install-prompt-content">
                <div class="install-prompt-icon">
                    <img src="/icons/icon-72.png" alt="OpenMake.Ai">
                </div>
                <div class="install-prompt-text">
                    <div class="install-prompt-title">OpenMake.Ai 앱 설치</div>
                    <div class="install-prompt-subtitle">홈 화면에 추가하여 더 빠르게 이용하세요</div>
                </div>
                <div class="install-prompt-actions">
                    <button class="install-prompt-btn install-prompt-btn-install" data-action="install">설치</button>
                    <button class="install-prompt-btn install-prompt-btn-close" data-action="close">✕</button>
                </div>
            </div>
        `;
    }

    document.body.appendChild(banner);
    _bannerEl = banner;

    var installBtn = banner.querySelector('[data-action="install"]');
    var closeBtn = banner.querySelector('[data-action="close"]');

    if (installBtn) {
        installBtn.addEventListener('click', handleInstallClick);
    }
    if (closeBtn) {
        closeBtn.addEventListener('click', handleDismiss);
    }

    return banner;
}

/**
 * 설치 버튼 클릭 핸들러 - 네이티브 설치 프롬프트 트리거
 * @returns {void}
 */
function handleInstallClick() {
    if (!_deferredPrompt) return;

    _deferredPrompt.prompt();
    _deferredPrompt.userChoice.then(function (choiceResult) {
        if (choiceResult.outcome === 'accepted') {
            if (typeof showToast === 'function') {
                showToast('앱이 설치되었습니다!', 'success');
            }
        }
        _deferredPrompt = null;
        hide();
    }).catch(function (err) {
        console.error('Install prompt error:', err);
    });
}

/**
 * 닫기 버튼 클릭 핸들러 - 닫기 기록 저장 후 배너 숨기기
 * @returns {void}
 */
function handleDismiss() {
    setDismissed();
    hide();
}

/**
 * beforeinstallprompt 이벤트 핸들러 - 프롬프트 지연 저장
 * @param {BeforeInstallPromptEvent} e - 설치 프롬프트 이벤트
 * @returns {void}
 */
function handleBeforeInstallPrompt(e) {
    e.preventDefault();
    _deferredPrompt = e;
    if (!isDismissedRecently() && !_isInstalled && !isLoginPage()) {
        setTimeout(show, 30000);
    }
}

function handleAppInstalled() {
    _isInstalled = true;
    hide();
}

/**
 * 설치 안내 배너 표시 (조건 미충족 시 무시)
 * @returns {void}
 */
function show() {
    if (_isShown || _isInstalled || isDismissedRecently() || isLoginPage()) {
        return;
    }

    if (!_bannerEl) {
        createBanner();
    }

    _bannerEl.classList.remove('hide');
    _isShown = true;
}

/**
 * 설치 안내 배너 숨기기 (애니메이션 후 DOM 제거)
 * @returns {void}
 */
function hide() {
    if (!_bannerEl) return;

    _bannerEl.classList.add('hide');
    _isShown = false;

    setTimeout(function () {
        if (_bannerEl && _bannerEl.parentNode) {
            _bannerEl.parentNode.removeChild(_bannerEl);
            _bannerEl = null;
        }
    }, 300);
}

function isInstalled() {
    return _isInstalled;
}

/**
 * PWA 설치 프롬프트 컴포넌트 초기화
 * 스타일 주입, iOS 감지, 이벤트 리스너 등록을 수행합니다.
 * @returns {void}
 */
function init() {
    if (isLoginPage()) {
        return;
    }

    injectStyles();
    _isIOS = detectIOS();
    _isInstalled = checkIfInstalled();

    if (!_isIOS) {
        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    }

    window.addEventListener('appinstalled', handleAppInstalled);

    if (_isIOS && !_isInstalled && !isDismissedRecently()) {
        setTimeout(show, 30000);
    }
}

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Expose Public API
window.installPrompt = {
    show: show,
    hide: hide,
    isInstalled: isInstalled
};

export { show, hide, isInstalled, init as initInstallPrompt };
