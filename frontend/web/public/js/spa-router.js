/**
 * ============================================
 * SPA Router — History API 기반 클라이언트 사이드 라우터
 *
 * OpenMake.AI Gemini-Style UX Rebuild 용
 * Vanilla JavaScript, 빌드 도구 없음
 *
 * 사용법:
 *   Router.register('/canvas.html', { ... });
 *   Router.start();
 *   Router.navigate('/canvas.html');
 * ============================================
 */

(function () {
    'use strict';

    // ─── 내부 상태 ─────────────────────────────────────
    const _routes = new Map();           // path → routeConfig
    const _loadedModules = new Set();    // 이미 로드된 모듈 파일
    const _beforeHooks = [];             // onBeforeNavigate 콜백
    const _afterHooks = [];              // onAfterNavigate 콜백

    let _currentRoute = null;            // 현재 활성 routeConfig
    let _started = false;                // start() 호출 여부

    // ─── 상수 ──────────────────────────────────────────
    const CHAT_PATH = '/';
    const LOGIN_PATH = '/login.html';
    const DEFAULT_TITLE = 'OpenMake.AI';
    const LOG_PREFIX = '[Router]';

    // ─── 유틸리티 ──────────────────────────────────────

    /**
     * 콘솔 경고 (개발용)
     * @param {...*} args
     */
    function warn(...args) {
        console.warn(LOG_PREFIX, ...args);
    }

    /**
     * 콘솔 로그 (개발용)
     * @param {...*} args
     */
    function log(...args) {
        console.log(LOG_PREFIX, ...args);
    }

    /**
     * 인증 상태 확인
     * @returns {boolean}
     */
    function isAuthenticated() {
        const authToken = localStorage.getItem('authToken');
        const isGuest = localStorage.getItem('guestMode') === 'true' ||
                        localStorage.getItem('isGuest') === 'true';
        return !!authToken && !isGuest;
    }

    /**
     * 경로 정규화 — 쿼리 스트링/해시 제거, 슬래시 처리
     * @param {string} path
     * @returns {string}
     */
    function normalizePath(path) {
        if (!path) return CHAT_PATH;
        // URL 객체로 파싱하여 pathname만 추출
        try {
            const url = new URL(path, window.location.origin);
            return url.pathname;
        } catch (e) {
            return path.split('?')[0].split('#')[0] || CHAT_PATH;
        }
    }

    /**
     * 내부 링크인지 판별
     * @param {string} href
     * @returns {boolean}
     */
    function isInternalLink(href) {
        if (!href) return false;
        try {
            const url = new URL(href, window.location.origin);
            return url.origin === window.location.origin;
        } catch (e) {
            // 상대 경로는 내부
            return href.startsWith('/') || href.startsWith('./') || href.startsWith('../');
        }
    }

    // ─── 로딩 인디케이터 ───────────────────────────────

    /**
     * 로딩 상태 표시
     */
    function showLoading() {
        const container = document.getElementById('page-content');
        if (!container) return;
        container.innerHTML = `
            <div class="spa-loading">
                <div class="spa-loading-spinner"></div>
                <p>\uB85C\uB529 \uC911...</p>
            </div>
        `;
        container.style.display = '';
    }

    /**
     * 에러 메시지 표시
     * @param {string} message
     */
    function showError(message) {
        const container = document.getElementById('page-content');
        if (!container) return;
        container.innerHTML = `
            <div class="spa-error">
                <h2>\uD398\uC774\uC9C0 \uB85C\uB4DC \uC2E4\uD328</h2>
                <p>${message}</p>
                <button onclick="Router.navigate('/')">\uCC44\uD305\uC73C\uB85C \uB3CC\uC544\uAC00\uAE30</button>
            </div>
        `;
        container.style.display = '';
    }

    // ─── CSS 관리 ──────────────────────────────────────

    /**
     * 모듈 전용 CSS 로드
     * @param {string} moduleName
     * @param {string[]} cssFiles
     * @returns {Promise<void>}
     */
    function loadModuleCSS(moduleName, cssFiles) {
        if (!cssFiles || cssFiles.length === 0) return Promise.resolve();

        const promises = cssFiles.map(function (href) {
            // 이미 로드 되어 있으면 스킵
            if (document.querySelector('link[data-spa-css="' + moduleName + '"][href="' + href + '"]')) {
                return Promise.resolve();
            }
            return new Promise(function (resolve, reject) {
                var link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = href;
                link.setAttribute('data-spa-css', moduleName);
                link.onload = resolve;
                link.onerror = function () {
                    warn('CSS \uB85C\uB4DC \uC2E4\uD328:', href);
                    resolve(); // CSS 실패해도 페이지는 보여준다
                };
                document.head.appendChild(link);
            });
        });

        return Promise.all(promises);
    }

    /**
     * 모듈 전용 CSS 제거
     * @param {string} moduleName
     */
    function removeModuleCSS(moduleName) {
        if (!moduleName) return;
        var links = document.querySelectorAll('link[data-spa-css="' + moduleName + '"]');
        links.forEach(function (link) {
            link.parentNode.removeChild(link);
        });
    }

    // ─── 스크립트 동적 로딩 ────────────────────────────

    /**
     * <script> 태그 주입으로 모듈 파일 로드
     * @param {string} src - 스크립트 파일 경로
     * @returns {Promise<void>}
     */
    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            // 이미 로드됨
            if (_loadedModules.has(src)) {
                return resolve();
            }

            var script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = function () {
                _loadedModules.add(src);
                log('\uBAA8\uB4C8 \uB85C\uB4DC \uC644\uB8CC:', src);
                resolve();
            };
            script.onerror = function () {
                reject(new Error('\uBAA8\uB4C8 \uD30C\uC77C \uB85C\uB4DC \uC2E4\uD328: ' + src));
            };
            document.body.appendChild(script);
        });
    }

    // ─── 뷰 전환 ──────────────────────────────────────

    /**
     * 페이지 네비게이션 바 HTML 생성
     * @param {string} pageTitle - 현재 페이지 제목
     * @returns {string} 네비게이션 바 HTML
     */
    function _createBackNavigationHTML(pageTitle) {
        return [
            '<nav class="spa-page-nav">',
            '  <a href="/" class="spa-page-nav-back" title="채팅으로 돌아가기">',
            '    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
            '      <path d="m15 18-6-6 6-6"/>',
            '    </svg>',
            '    <span>채팅으로</span>',
            '  </a>',
            '  <span class="spa-page-nav-divider"></span>',
            '  <h1 class="spa-page-nav-title">' + pageTitle + '</h1>',
            '</nav>'
        ].join('\n');
    }

    /**
     * 채팅 뷰 표시 (홈 라우트)
     */
    function showChatView() {
        var chatArea = document.getElementById('chat-area');
        var pageContent = document.getElementById('page-content');

        if (chatArea) chatArea.style.display = '';
        if (pageContent) {
            pageContent.style.display = 'none';
            pageContent.innerHTML = '';
        }

        document.title = '\uCC44\uD305 - ' + DEFAULT_TITLE;

        // 툴 피커 활성 해제
        updateToolPickerActive('/');
    }

    /**
     * 페이지 모듈 뷰 표시
     */
    function showPageView() {
        var chatArea = document.getElementById('chat-area');
        var pageContent = document.getElementById('page-content');

        if (chatArea) chatArea.style.display = 'none';
        if (pageContent) {
            pageContent.style.display = '';
            // Re-trigger fade-in animation
            pageContent.style.animation = 'none';
            pageContent.offsetHeight; // force reflow
            pageContent.style.animation = '';
        }
    }

    /**
     * 툴 피커 활성 상태 업데이트
     */
    function updateToolPickerActive(path) {
        var pills = document.querySelectorAll('.tool-pill');
        for (var i = 0; i < pills.length; i++) {
            var btn = pills[i];
            var onclick = btn.getAttribute('onclick') || '';
            if (onclick.indexOf(path) !== -1 && path !== '/') {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    }

    // ─── 네비게이션 핵심 로직 ──────────────────────────

    /**
     * 라우트 전환 실행 (내부용)
     * @param {string} path - 이동할 경로
     * @param {object} [options]
     * @param {boolean} [options.replace=false] - replaceState 사용 여부
     * @param {boolean} [options.popstate=false] - popstate 이벤트에서 호출 시 true
     * @returns {Promise<boolean>} 성공 여부
     */
    async function executeNavigation(path, options) {
        options = options || {};
        var replace = options.replace || false;
        var isPopstate = options.popstate || false;

        var normalizedPath = normalizePath(path);
        var previousRoute = _currentRoute;
        var targetRoute = _routes.get(normalizedPath);

        // login.html은 항상 풀 페이지 리디렉트
        if (normalizedPath === LOGIN_PATH) {
            window.location.href = LOGIN_PATH;
            return false;
        }

        // 등록되지 않은 라우트 → 채팅으로 폴백
        if (!targetRoute && normalizedPath !== CHAT_PATH) {
            warn('\uB4F1\uB85D\uB418\uC9C0 \uC54A\uC740 \uB77C\uC6B0\uD2B8:', normalizedPath);
            // .html 파일이면 레거시 URL일 수 있으므로 풀 페이지 리디렉트
            if (normalizedPath.endsWith('.html')) {
                window.location.href = normalizedPath;
                return false;
            }
            // 그 외 → 채팅으로 리디렉트
            normalizedPath = CHAT_PATH;
            targetRoute = null;
        }

        // ─── 인증 가드 ───────────────────────
        if (targetRoute && targetRoute.requireAuth && !isAuthenticated()) {
            sessionStorage.setItem('redirectAfterLogin', normalizedPath);
            window.location.href = LOGIN_PATH;
            return false;
        }

        // ─── beforeNavigate 훅 ───────────────
        var navInfo = {
            from: previousRoute ? previousRoute.path : (window.location.pathname),
            to: normalizedPath
        };

        for (var i = 0; i < _beforeHooks.length; i++) {
            try {
                var result = _beforeHooks[i](navInfo);
                if (result === false) {
                    log('\uB124\uBE44\uAC8C\uC774\uC158 \uCDE8\uC18C (beforeNavigate \uD6C5)');
                    return false;
                }
            } catch (e) {
                warn('beforeNavigate \uD6C5 \uC624\uB958:', e);
            }
        }

        // ─── 현재 모듈 정리 ──────────────────
        if (_currentRoute && _currentRoute.moduleName) {
            var currentModule = window.PageModules && window.PageModules[_currentRoute.moduleName];
            if (currentModule && typeof currentModule.cleanup === 'function') {
                try {
                    currentModule.cleanup();
                } catch (e) {
                    warn('\uBAA8\uB4C8 cleanup \uC624\uB958:', _currentRoute.moduleName, e);
                }
            }
            // 이전 모듈 CSS 제거
            removeModuleCSS(_currentRoute.moduleName);
        }

        // ─── History 상태 업데이트 ───────────
        if (!isPopstate) {
            var stateObj = { path: normalizedPath };
            if (replace) {
                window.history.replaceState(stateObj, '', normalizedPath);
            } else {
                window.history.pushState(stateObj, '', normalizedPath);
            }
        }

        // ─── 채팅 라우트 (홈) ────────────────
        if (normalizedPath === CHAT_PATH || !targetRoute) {
            _currentRoute = { path: CHAT_PATH, moduleName: null, title: '\uCC44\uD305' };
            showChatView();
            _notifyAfterHooks(navInfo, null);
            return true;
        }

        // ─── 페이지 모듈 로드 ────────────────
        _currentRoute = targetRoute;
        showPageView();
        showLoading();

        try {
            // 모듈 파일 로드 (캐시 확인 포함)
            if (targetRoute.moduleFile && !_loadedModules.has(targetRoute.moduleFile)) {
                await loadScript(targetRoute.moduleFile);
            }

            // 모듈 참조 획득
            var pageModule = window.PageModules && window.PageModules[targetRoute.moduleName];
            if (!pageModule) {
                throw new Error('\uBAA8\uB4C8\uC774 \uB4F1\uB85D\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4: window.PageModules.' + targetRoute.moduleName);
            }

            // HTML 주입 (네비게이션 바 포함)
            var container = document.getElementById('page-content');
            if (container) {
                if (typeof pageModule.getHTML === 'function') {
                    var pageTitle = targetRoute.title || targetRoute.moduleName;
                    var backNavHTML = _createBackNavigationHTML(pageTitle);
                    container.innerHTML = backNavHTML + pageModule.getHTML();

                    // 뒤로가기 버튼 이벤트 바인딩
                    var backButton = container.querySelector('.spa-page-nav-back');
                    if (backButton) {
                        backButton.addEventListener('click', function(e) {
                            e.preventDefault();
                            if (window.Router && window.Router.navigate) {
                                window.Router.navigate('/');
                            } else {
                                window.location.href = '/';
                            }
                        });
                    }
                } else {
                    throw new Error('\uBAA8\uB4C8\uC5D0 getHTML() \uD568\uC218\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4: ' + targetRoute.moduleName);
                }
            }

            // CSS 로드
            if (targetRoute.cssFiles && targetRoute.cssFiles.length > 0) {
                await loadModuleCSS(targetRoute.moduleName, targetRoute.cssFiles);
            }

            // 초기화
            if (typeof pageModule.init === 'function') {
                await pageModule.init();
            }

            // 페이지 타이틀
            document.title = (targetRoute.title || targetRoute.moduleName) + ' - ' + DEFAULT_TITLE;

            // 스크롤 초기화
            window.scrollTo(0, 0);

            // 툴 피커 활성 상태
            updateToolPickerActive(normalizedPath);

            // afterNavigate 훅
            _notifyAfterHooks(navInfo, pageModule);

            log('\uB124\uBE44\uAC8C\uC774\uC158 \uC644\uB8CC:', normalizedPath);
            return true;

        } catch (error) {
            warn('\uBAA8\uB4C8 \uB85C\uB4DC \uC2E4\uD328:', error.message);
            showError(error.message);
            return false;
        }
    }

    /**
     * afterNavigate 훅 알림
     * @param {object} navInfo
     * @param {object|null} pageModule
     */
    function _notifyAfterHooks(navInfo, pageModule) {
        for (var i = 0; i < _afterHooks.length; i++) {
            try {
                _afterHooks[i]({
                    from: navInfo.from,
                    to: navInfo.to,
                    module: pageModule
                });
            } catch (e) {
                warn('afterNavigate \uD6C5 \uC624\uB958:', e);
            }
        }
    }

    // ─── 링크 인터셉트 ────────────────────────────────

    /**
     * 글로벌 클릭 핸들러 — 내부 링크를 SPA 네비게이션으로 변환
     * @param {MouseEvent} event
     */
    function handleGlobalClick(event) {
        // 수정키 + 클릭은 무시 (새 탭 열기 등)
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

        // 가장 가까운 <a> 태그 찾기
        var anchor = event.target.closest('a');
        if (!anchor) return;

        var href = anchor.getAttribute('href');
        if (!href) return;

        // data-spa-ignore 속성 있으면 무시
        if (anchor.hasAttribute('data-spa-ignore')) return;

        // target="_blank" 무시
        if (anchor.getAttribute('target') === '_blank') return;

        // 외부 링크 무시
        if (!isInternalLink(href)) return;

        var normalizedPath = normalizePath(href);

        // login.html은 항상 풀 페이지 리디렉트
        if (normalizedPath === LOGIN_PATH) return;

        // SPA 네비게이션으로 전환
        event.preventDefault();
        Router.navigate(normalizedPath);
    }

    // ─── Popstate 핸들러 ──────────────────────────────

    /**
     * 브라우저 뒤로/앞으로 버튼 처리
     * @param {PopStateEvent} event
     */
    function handlePopstate(event) {
        var path = (event.state && event.state.path) || window.location.pathname;
        log('popstate:', path);
        executeNavigation(path, { popstate: true });
    }

    // ─── 라우트 자동 등록 ─────────────────────────────

    /**
     * nav-items.js 데이터로 전체 라우트 등록
     * window.NAV_ITEMS가 로드된 후 호출해야 함
     */
    function registerFromNavItems() {
        if (!window.NAV_ITEMS) {
            warn('NAV_ITEMS\uAC00 \uC544\uC9C1 \uB85C\uB4DC\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4');
            return;
        }

        var allItems = [].concat(
            window.NAV_ITEMS.menu || [],
            window.NAV_ITEMS.admin || []
        );

        allItems.forEach(function (item) {
            if (!item.href || item.href === '/' || item.href === LOGIN_PATH) return;

            var path = item.href;
            // moduleName: '/canvas.html' → 'canvas'
            var moduleName = path.replace(/^\//, '').replace(/\.html$/, '');

            Router.register(path, {
                moduleName: moduleName,
                moduleFile: '/js/modules/pages/' + moduleName + '.js',
                cssFiles: [], // 각 모듈이 필요 시 자체 등록
                requireAuth: !!item.requireAuth,
                title: item.label || moduleName,
                icon: item.icon || '',
                iconify: item.iconify || ''
            });
        });

        log('\uB77C\uC6B0\uD2B8 \uC790\uB3D9 \uB4F1\uB85D \uC644\uB8CC:', _routes.size, '\uAC1C');
    }

    // ─── 공개 API ─────────────────────────────────────

    var Router = {

        /**
         * 라우트 등록
         * @param {string} path - URL 경로 (예: '/canvas.html')
         * @param {object} config - 라우트 설정
         * @param {string} config.moduleName - PageModules 키
         * @param {string} config.moduleFile - 모듈 JS 파일 경로
         * @param {string[]} [config.cssFiles] - CSS 파일 경로 배열
         * @param {boolean} [config.requireAuth] - 인증 필요 여부
         * @param {string} [config.title] - 페이지 제목
         */
        register: function (path, config) {
            var normalizedPath = normalizePath(path);
            config.path = normalizedPath;
            _routes.set(normalizedPath, config);
        },

        /**
         * 라우트 이동
         * @param {string} path - 이동할 경로
         * @param {object} [options]
         * @param {boolean} [options.replace] - replaceState 사용
         * @returns {Promise<boolean>}
         */
        navigate: function (path, options) {
            if (!_started) {
                warn('Router.start() \uD638\uCD9C \uC804\uC5D0 navigate \uC2DC\uB3C4\uB428');
            }
            return executeNavigation(path, options || {});
        },

        /**
         * 뒤로 가기
         */
        back: function () {
            window.history.back();
        },

        /**
         * 앞으로 가기
         */
        forward: function () {
            window.history.forward();
        },

        /**
         * 현재 라우트 정보 반환
         * @returns {object|null}
         */
        getCurrentRoute: function () {
            return _currentRoute ? Object.assign({}, _currentRoute) : null;
        },

        /**
         * 현재 경로 반환
         * @returns {string}
         */
        getCurrentPath: function () {
            return _currentRoute ? _currentRoute.path : window.location.pathname;
        },

        /**
         * 채팅 뷰 표시 (홈으로 이동)
         * @returns {Promise<boolean>}
         */
        showChat: function () {
            return Router.navigate(CHAT_PATH);
        },

        /**
         * 네비게이션 전 훅 등록
         * @param {function} callback - { from, to } → false면 취소
         * @returns {function} 해제 함수
         */
        onBeforeNavigate: function (callback) {
            _beforeHooks.push(callback);
            return function () {
                var idx = _beforeHooks.indexOf(callback);
                if (idx > -1) _beforeHooks.splice(idx, 1);
            };
        },

        /**
         * 네비게이션 후 훅 등록
         * @param {function} callback - { from, to, module }
         * @returns {function} 해제 함수
         */
        onAfterNavigate: function (callback) {
            _afterHooks.push(callback);
            return function () {
                var idx = _afterHooks.indexOf(callback);
                if (idx > -1) _afterHooks.splice(idx, 1);
            };
        },

        /**
         * 등록된 모든 라우트 반환
         * @returns {Map}
         */
        getRoutes: function () {
            return new Map(_routes);
        },

        /**
         * 특정 라우트가 현재 활성인지 확인
         * @param {string} path
         * @returns {boolean}
         */
        isActive: function (path) {
            var normalizedPath = normalizePath(path);
            return _currentRoute && _currentRoute.path === normalizedPath;
        },

        /**
         * 모듈 CSS 파일 업데이트 (모듈이 자체적으로 CSS를 등록할 때 사용)
         * @param {string} moduleName
         * @param {string[]} cssFiles
         */
        setModuleCSS: function (moduleName, cssFiles) {
            var route = null;
            _routes.forEach(function (config) {
                if (config.moduleName === moduleName) {
                    route = config;
                }
            });
            if (route) {
                route.cssFiles = cssFiles;
            }
        },

        /**
         * nav-items.js에서 라우트 자동 등록
         */
        registerFromNavItems: registerFromNavItems,

        /**
         * 라우터 초기화 — 이벤트 리스너 등록 + 현재 URL 처리
         */
        start: function () {
            if (_started) {
                warn('\uB77C\uC6B0\uD130\uAC00 \uC774\uBBF8 \uC2DC\uC791\uB418\uC5C8\uC2B5\uB2C8\uB2E4');
                return;
            }

            _started = true;

            // PageModules 컨테이너 초기화
            if (!window.PageModules) {
                window.PageModules = {};
            }

            // nav-items.js 기반 자동 등록
            registerFromNavItems();

            // 이벤트 리스너 등록
            window.addEventListener('popstate', handlePopstate);
            document.addEventListener('click', handleGlobalClick);

            // 현재 URL 처리 (초기 로드)
            var currentPath = normalizePath(window.location.pathname);

            // 초기 history 상태 설정
            window.history.replaceState({ path: currentPath }, '', currentPath);

            // 로그인 후 리디렉트 처리
            var redirectPath = sessionStorage.getItem('redirectAfterLogin');
            if (redirectPath && isAuthenticated()) {
                sessionStorage.removeItem('redirectAfterLogin');
                log('\uB85C\uADF8\uC778 \uD6C4 \uB9AC\uB514\uB809\uD2B8:', redirectPath);
                executeNavigation(redirectPath, { replace: true });
            } else {
                // 현재 경로로 네비게이션
                executeNavigation(currentPath, { replace: true });
            }

            log('\uB77C\uC6B0\uD130 \uC2DC\uC791\uB428. \uB4F1\uB85D\uB41C \uB77C\uC6B0\uD2B8:', _routes.size);
        },

        /**
         * 라우터 정지 — 이벤트 리스너 제거 (테스트용)
         */
        stop: function () {
            window.removeEventListener('popstate', handlePopstate);
            document.removeEventListener('click', handleGlobalClick);
            _started = false;
            _currentRoute = null;
            log('\uB77C\uC6B0\uD130 \uC815\uC9C0\uB428');
        },

        /**
         * 디버그 정보 출력
         */
        debug: function () {
            console.group(LOG_PREFIX + ' Debug Info');
            console.log('Started:', _started);
            console.log('Current Route:', _currentRoute);
            console.log('Registered Routes:', _routes.size);
            _routes.forEach(function (config, path) {
                console.log('  ', path, '→', config.moduleName, config.requireAuth ? '(auth)' : '');
            });
            console.log('Loaded Modules:', Array.from(_loadedModules));
            console.log('Before Hooks:', _beforeHooks.length);
            console.log('After Hooks:', _afterHooks.length);
            console.groupEnd();
        }
    };

    // ─── 전역 노출 ────────────────────────────────────
    window.Router = Router;
    window.SPARouter = Router; // 별칭

})();
