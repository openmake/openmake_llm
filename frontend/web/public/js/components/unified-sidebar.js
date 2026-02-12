/**
 * ============================================
 * UnifiedSidebar — Gemini-Style 3-State Sidebar
 *
 * States: full (280px) | icon (64px) | hidden (0px)
 * 대화 목록 전용 사이드바 (네비게이션 메뉴 없음)
 *
 * 의존성:
 *   - window.Router (spa-router.js)
 *   - window.authFetch (auth.js)
 *   - window.isLoggedIn, window.getCurrentUser (auth.js)
 * ============================================
 */

(function () {
    'use strict';

    var STATES = { FULL: 'full', ICON: 'icon', HIDDEN: 'hidden' };
    var LS_KEY = 'sidebar-state';
    var HOVER_DELAY = 300;
    var SEARCH_DEBOUNCE = 200;
    var MOBILE_BREAKPOINT = 768;
    var LOG_PREFIX = '[Sidebar]';

    // ─── SVG 아이콘 ────────────────────────────────────
    var ICONS = {
        sidebar: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
        sun: '<svg class="sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
        moon: '<svg class="moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
        plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
        search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
        settings: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
        logout: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
        chat: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
        empty: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
    };

    // ─── 유틸리티 ──────────────────────────────────────

    function isMobile() {
        return window.innerWidth <= MOBILE_BREAKPOINT;
    }

    function truncate(str, max) {
        if (!str) return '';
        return str.length > max ? str.substring(0, max) + '...' : str;
    }

    /**
     * 날짜를 그룹으로 분류
     * @param {string|number} dateStr
     * @returns {'today'|'yesterday'|'week'|'older'}
     */
    function getDateGroup(dateStr) {
        if (!dateStr) return 'older';
        var date = new Date(dateStr);
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        var weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);

        if (date >= today) return 'today';
        if (date >= yesterday) return 'yesterday';
        if (date >= weekAgo) return 'week';
        return 'older';
    }

    var GROUP_LABELS = {
        today: '\uC624\uB298',       // 오늘
        yesterday: '\uC5B4\uC81C',   // 어제
        week: '\uC774\uBC88 \uC8FC', // 이번 주
        older: '\uC774\uC804'        // 이전
    };

    // ─── UnifiedSidebar 클래스 ─────────────────────────

    /**
     * @param {string} containerId - 사이드바를 마운트할 요소 ID
     */
    function UnifiedSidebar(containerId) {
        this.containerId = containerId || 'sidebar';
        this.el = null;
        this.state = STATES.FULL;
        this.conversations = [];
        this.filteredConversations = null;
        this.activeConversationId = null;
        this._hoverTimer = null;
        this._searchTimer = null;
        this._resizeHandler = null;
        this._keyHandler = null;
        this._backdropEl = null;
    }

    // ─── 초기화 ────────────────────────────────────────

    UnifiedSidebar.prototype.init = function () {
        var container = document.getElementById(this.containerId);
        if (!container) {
            console.warn(LOG_PREFIX, '\uCEE8\uD14C\uC774\uB108\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4:', this.containerId);
            return;
        }

        // 저장된 상태 복원
        var saved = localStorage.getItem(LS_KEY);
        if (saved && (saved === STATES.FULL || saved === STATES.ICON || saved === STATES.HIDDEN)) {
            this.state = saved;
        }

        // 모바일이면 hidden
        if (isMobile()) {
            this.state = STATES.HIDDEN;
        }

        // HTML 생성
        container.innerHTML = this._renderHTML();
        this.el = container.querySelector('.unified-sidebar');

        // 모바일 백드롭
        this._backdropEl = document.createElement('div');
        this._backdropEl.className = 'us-mobile-backdrop';
        container.parentNode.insertBefore(this._backdropEl, container.nextSibling);

        // 이벤트 바인딩
        this._bindEvents();

        // 대화 목록 로드
        this.loadConversations();

        // 사용자 정보 업데이트
        this._updateUserSection();

        console.log(LOG_PREFIX, '\uCD08\uAE30\uD654 \uC644\uB8CC. \uC0C1\uD0DC:', this.state);

        // OAuth 쿠키 세션 복구 대기: recoverSessionFromCookie()가 비동기로 완료되면
        // 사이드바 사용자 섹션을 다시 업데이트
        window.dispatchEvent(new Event('sidebarReady'));
    };

    // ─── HTML 렌더링 ───────────────────────────────────

    UnifiedSidebar.prototype._renderHTML = function () {
        return '' +
            '<div class="unified-sidebar" data-state="' + this.state + '" role="navigation" aria-label="Conversation sidebar">' +
                // Header
                '<div class="us-header">' +
                    '<button class="us-toggle-btn" title="\uC0AC\uC774\uB4DC\uBC14 \uD1A0\uAE00" aria-label="Toggle sidebar">' + ICONS.sidebar + '</button>' +
                    '<button class="us-theme-btn" title="\uD14C\uB9C8 \uBCC0\uACBD" aria-label="Toggle theme">' + ICONS.sun + ICONS.moon + '</button>' +
                '</div>' +
                // Logo
                '<div class="us-logo">' +
                    '<img src="/logo.png" alt="OpenMake.AI" />' +
                    '<span class="us-brand-text">OpenMake.AI</span>' +
                '</div>' +
                // New Chat
                '<button class="us-new-chat">' +
                    ICONS.plus +
                    '<span class="us-label">\uC0C8 \uB300\uD654</span>' +
                '</button>' +
                // Search
                '<div class="us-search">' +
                    ICONS.search +
                    '<input type="text" class="us-search-input" placeholder="\uB300\uD654 \uAC80\uC0C9..." aria-label="Search conversations" />' +
                '</div>' +
                // Conversations
                '<div class="us-conversations" role="list" aria-label="Conversation list">' +
                    '<div class="us-loading"><div class="us-loading-spinner"></div></div>' +
                '</div>' +
                // User section
                '<div class="us-user-section">' +
                    // Dropdown Menu
                    '<div class="us-user-menu">' +
                        '<div class="us-menu-header"></div>' +
                        '<button class="us-menu-item settings">' +
                            '<span class="us-menu-icon">' + ICONS.settings + '</span>' +
                            '<span>\uC124\uC815</span>' + // 설정
                        '</button>' +
                        '<button class="us-menu-item logout">' +
                            '<span class="us-menu-icon">' + ICONS.logout + '</span>' +
                            '<span>\uB85C\uADF8\uC544\uC6C3</span>' + // 로그아웃
                        '</button>' +
                    '</div>' +
                    '<div class="us-user-avatar">?</div>' +
                    '<span class="us-user-name us-label">\uC0AC\uC6A9\uC790</span>' +
                    '<button class="us-settings-btn" title="\uC124\uC815">' + ICONS.settings + '</button>' +
                '</div>' +
            '</div>';
    };

    // ─── 이벤트 바인딩 ─────────────────────────────────

    UnifiedSidebar.prototype._bindEvents = function () {
        var self = this;

        // 토글 버튼
        var toggleBtn = this.el.querySelector('.us-toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function () {
                self.toggle();
            });
        }

        // 테마 토글
        var themeBtn = this.el.querySelector('.us-theme-btn');
        if (themeBtn) {
            themeBtn.addEventListener('click', function () {
                self._toggleTheme();
            });
        }

        // 새 대화
        var newChatBtn = this.el.querySelector('.us-new-chat');
        if (newChatBtn) {
            newChatBtn.addEventListener('click', function () {
                if (typeof window.newChat === 'function') {
                    window.newChat();
                } else if (window.Router) {
                    window.Router.navigate('/');
                }
                // 모바일이면 사이드바 닫기
                if (isMobile()) {
                    self.setState(STATES.HIDDEN);
                }
            });
        }

        // 검색
        var searchInput = this.el.querySelector('.us-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                clearTimeout(self._searchTimer);
                self._searchTimer = setTimeout(function () {
                    self._filterConversations(searchInput.value.trim());
                }, SEARCH_DEBOUNCE);
            });
        }

        // 대화 목록 클릭 (이벤트 위임)
        var convContainer = this.el.querySelector('.us-conversations');
        if (convContainer) {
            convContainer.addEventListener('click', function (e) {
                var item = e.target.closest('.us-conv-item');
                if (item && item.dataset.id) {
                    self._onConversationClick(item.dataset.id);
                }
            });
            // ARIA: 키보드 내비게이션 (Enter/Space → 클릭, Arrow → 이동)
            convContainer.addEventListener('keydown', function (e) {
                var item = e.target.closest('.us-conv-item');
                if (!item) return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (item.dataset.id) self._onConversationClick(item.dataset.id);
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    var next = item.nextElementSibling;
                    while (next && !next.classList.contains('us-conv-item')) next = next.nextElementSibling;
                    if (next) next.focus();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    var prev = item.previousElementSibling;
                    while (prev && !prev.classList.contains('us-conv-item')) prev = prev.previousElementSibling;
                    if (prev) prev.focus();
                }
            });
        }

        // 사용자 아바타/이름 클릭 → 로그인/프로필
        var userAvatar = this.el.querySelector('.us-user-avatar');
        var userName = this.el.querySelector('.us-user-name');
        var userClickHandler = function (e) {
            e.stopPropagation();
            // getCurrentUser()로 실제 유효한 로그인 상태 확인 (_updateUserSection과 동일 기준)
            var user = typeof window.getCurrentUser === 'function' ? window.getCurrentUser() : null;
            if (!user) {
                var savedUser = localStorage.getItem('user');
                if (savedUser) {
                    try { user = JSON.parse(savedUser); } catch (e) { user = null; }
                }
            }

            if (!user) {
                window.location.href = '/login.html';
            } else {
                self._toggleUserMenu();
            }
        };
        if (userAvatar) {
            userAvatar.style.cursor = 'pointer';
            userAvatar.addEventListener('click', userClickHandler);
        }
        if (userName) {
            userName.style.cursor = 'pointer';
            userName.addEventListener('click', userClickHandler);
        }

        // User Menu Items
        var menuSettings = this.el.querySelector('.us-menu-item.settings');
        if (menuSettings) {
            menuSettings.addEventListener('click', function() {
                self._closeUserMenu();
                if (window.Router) {
                    window.Router.navigate('/settings.html');
                }
                if (isMobile()) {
                    self.setState(STATES.HIDDEN);
                }
            });
        }

        var menuLogout = this.el.querySelector('.us-menu-item.logout');
        if (menuLogout) {
            menuLogout.addEventListener('click', function() {
                self._closeUserMenu();
                if (typeof window.logout === 'function') {
                    window.logout();
                } else {
                    localStorage.clear();
                    window.location.href = '/login.html';
                }
            });
        }

        // Close menu on click outside
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.us-user-section')) {
                self._closeUserMenu();
            }
        });

        // Close menu on ESC
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                self._closeUserMenu();
            }
        });

        // 설정 버튼
        var settingsBtn = this.el.querySelector('.us-settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', function () {
                if (window.AdminPanel) {
                    window.AdminPanel.toggle();
                } else if (window.Router) {
                    window.Router.navigate('/settings.html');
                }
                if (isMobile()) {
                    self.setState(STATES.HIDDEN);
                }
            });
        }

        // 호버 확장 (아이콘 모드에서만)
        this.el.addEventListener('mouseenter', function () {
            if (self.state === STATES.ICON && !isMobile()) {
                clearTimeout(self._hoverTimer);
                self.el.classList.add('us-hover-expanded');
            }
        });

        this.el.addEventListener('mouseleave', function () {
            if (self.state === STATES.ICON && !isMobile()) {
                self._hoverTimer = setTimeout(function () {
                    self.el.classList.remove('us-hover-expanded');
                }, HOVER_DELAY);
            }
        });

        // 모바일 백드롭
        this._backdropEl.addEventListener('click', function () {
            self.setState(STATES.HIDDEN);
        });

        // 키보드 단축키 (Ctrl+B / Cmd+B)
        this._keyHandler = function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
                e.preventDefault();
                self.toggle();
            }
        };
        document.addEventListener('keydown', this._keyHandler);

        // 리사이즈 핸들러 — width 변경만 감지 (모바일 address bar 높이 변경 무시)
        this._lastWidth = window.innerWidth;
        this._resizeHandler = function () {
            var currentWidth = window.innerWidth;
            // 모바일에서 스크롤 시 address bar가 숨겨지면 height만 변경됨
            // height-only 변경은 무시하여 떨림(지진) 현상 방지
            if (currentWidth === self._lastWidth) return;
            self._lastWidth = currentWidth;

            if (isMobile() && self.state !== STATES.HIDDEN) {
                self.setState(STATES.HIDDEN);
            }
        };
        window.addEventListener('resize', this._resizeHandler);
    };

    // ─── 상태 관리 ─────────────────────────────────────

    UnifiedSidebar.prototype.getState = function () {
        return this.state;
    };

    UnifiedSidebar.prototype.setState = function (newState) {
        if (newState !== STATES.FULL && newState !== STATES.ICON && newState !== STATES.HIDDEN) {
            return;
        }

        var oldState = this.state;
        this.state = newState;

        if (this.el) {
            this.el.setAttribute('data-state', newState);
            this.el.classList.remove('us-hover-expanded');
        }

        // 모바일 백드롭
        if (this._backdropEl) {
            if (isMobile() && newState !== STATES.HIDDEN) {
                this._backdropEl.classList.add('visible');
            } else {
                this._backdropEl.classList.remove('visible');
            }
        }

        // 저장 (모바일 hidden은 저장 안함)
        if (!isMobile()) {
            localStorage.setItem(LS_KEY, newState);
        }

        console.log(LOG_PREFIX, '\uC0C1\uD0DC \uBCC0\uACBD:', oldState, '\u2192', newState);
    };

    UnifiedSidebar.prototype.toggle = function () {
        if (isMobile()) {
            // 모바일: hidden ↔ full
            this.setState(this.state === STATES.HIDDEN ? STATES.FULL : STATES.HIDDEN);
        } else {
            // 데스크톱: full ↔ icon
            this.setState(this.state === STATES.FULL ? STATES.ICON : STATES.FULL);
        }
    };

    // ─── 대화 목록 ─────────────────────────────────────

    UnifiedSidebar.prototype.loadConversations = function () {
        var self = this;
        var fetchFn = window.authFetch || window.fetch;

        // 🆕 비로그인 사용자는 anonSessionId를 전달하여 자신의 대화만 조회
        var url = '/api/chat/sessions';
        var authToken = localStorage.getItem('authToken');
        if (!authToken) {
            var anonSessionId = sessionStorage.getItem('anonSessionId');
            if (anonSessionId) {
                url += '?anonSessionId=' + encodeURIComponent(anonSessionId);
            }
        }

        fetchFn(url)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                // API 응답 형태에 따라 대화 목록 추출
                // Backend returns: { success: true, data: { sessions: [...] } }
                var payload = data.data || data;  // Unwrap standardized API response
                var list = Array.isArray(payload) ? payload : (payload.sessions || payload.conversations || []);
                self.conversations = list;
                self._renderConversations(list);
            })
            .catch(function (err) {
                console.warn(LOG_PREFIX, '\uB300\uD654 \uBAA9\uB85D \uB85C\uB4DC \uC2E4\uD328:', err.message);
                self._renderEmptyState();
            });
    };

    UnifiedSidebar.prototype._renderConversations = function (conversations) {
        var container = this.el.querySelector('.us-conversations');
        if (!container) return;

        if (!conversations || conversations.length === 0) {
            this._renderEmptyState();
            return;
        }

        // 날짜 그룹별 분류
        var groups = { today: [], yesterday: [], week: [], older: [] };

        conversations.forEach(function (conv) {
            var group = getDateGroup(conv.updatedAt || conv.createdAt || conv.created_at);
            groups[group].push(conv);
        });

        var html = '';
        var groupOrder = ['today', 'yesterday', 'week', 'older'];
        var self = this;

        groupOrder.forEach(function (groupKey) {
            var items = groups[groupKey];
            if (items.length === 0) return;

            html += '<div class="us-group" data-group="' + groupKey + '">';
            html += '<div class="us-group-label">' + GROUP_LABELS[groupKey] + '</div>';
            html += '<div class="us-group-items">';

            items.forEach(function (conv) {
                var id = conv.id || conv._id || conv.conversationId;
                var title = conv.title || conv.name || '\uC0C8 \uB300\uD654';
                var isActive = id === self.activeConversationId;
                html += '<div class="us-conv-item' + (isActive ? ' active' : '') + '" data-id="' + id + '" role="listitem" tabindex="0" aria-label="' + truncate(title, 30) + '"' + (isActive ? ' aria-current="true"' : '') + '>';
                html += '<span class="us-conv-icon">' + ICONS.chat + '</span>';
                html += '<span class="us-conv-title">' + truncate(title, 30) + '</span>';
                html += '</div>';
            });

            html += '</div></div>';
        });

        container.innerHTML = html;
    };

    UnifiedSidebar.prototype._renderEmptyState = function () {
        var container = this.el.querySelector('.us-conversations');
        if (!container) return;

        container.innerHTML =
            '<div class="us-empty">' +
                ICONS.empty +
                '<p>\uB300\uD654 \uAE30\uB85D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4</p>' +
                '<p>\uC0C8 \uB300\uD654\uB97C \uC2DC\uC791\uD574\uBCF4\uC138\uC694</p>' +
            '</div>';
    };

    UnifiedSidebar.prototype._filterConversations = function (query) {
        if (!query) {
            this.filteredConversations = null;
            this._renderConversations(this.conversations);
            return;
        }

        var lowerQuery = query.toLowerCase();
        var filtered = this.conversations.filter(function (conv) {
            var title = (conv.title || conv.name || '').toLowerCase();
            return title.indexOf(lowerQuery) !== -1;
        });

        this.filteredConversations = filtered;
        this._renderConversations(filtered);
    };

    UnifiedSidebar.prototype._onConversationClick = function (conversationId) {
        // 활성 대화 업데이트
        this.activeConversationId = conversationId;

        // UI 업데이트
        var items = this.el.querySelectorAll('.us-conv-item');
        items.forEach(function (item) {
            item.classList.toggle('active', item.dataset.id === conversationId);
        });

        // 대화 로드 (app.js에서 window.loadConversation = loadSession 으로 노출)
        if (typeof window.loadConversation === 'function') {
            window.loadConversation(conversationId);
        } else if (window.Router) {
            window.Router.navigate('/?sessionId=' + conversationId);
        }

        // 모바일이면 사이드바 닫기
        if (isMobile()) {
            this.setState(STATES.HIDDEN);
        }
    };

    UnifiedSidebar.prototype._toggleUserMenu = function () {
        var menu = this.el.querySelector('.us-user-menu');
        if (menu) {
            menu.classList.toggle('active');
            if (menu.classList.contains('active')) {
                // Update email in header
                var user = typeof window.getCurrentUser === 'function' ? window.getCurrentUser() : null;
                if (!user) {
                    var savedUser = localStorage.getItem('user');
                    if (savedUser) {
                        try { user = JSON.parse(savedUser); } catch (e) { user = null; }
                    }
                }
                var header = menu.querySelector('.us-menu-header');
                if (header && user) {
                    header.textContent = user.email || user.name || 'User';
                }
            }
        }
    };

    UnifiedSidebar.prototype._closeUserMenu = function () {
        var menu = this.el.querySelector('.us-user-menu');
        if (menu) {
            menu.classList.remove('active');
        }
    };

    // ─── 사용자 섹션 ───────────────────────────────────

    UnifiedSidebar.prototype._updateUserSection = function () {
        var avatar = this.el.querySelector('.us-user-avatar');
        var name = this.el.querySelector('.us-user-name');

        // 사용자 정보 조회: 모듈 함수 → localStorage fallback
        var user = typeof window.getCurrentUser === 'function' ? window.getCurrentUser() : null;
        if (!user) {
            var savedUser = localStorage.getItem('user');
            if (savedUser) {
                try { user = JSON.parse(savedUser); } catch (e) { user = null; }
            }
        }

        if (user && user.email) {
            var initial = (user.name || user.email || '?').charAt(0).toUpperCase();
            if (avatar) avatar.textContent = initial;
            if (name) {
                name.textContent = user.name || user.email || '\uC0AC\uC6A9\uC790';
                name.title = user.email || '';
            }
        } else {
            var isGuest = localStorage.getItem('guestMode') === 'true' || localStorage.getItem('isGuest') === 'true';
            if (avatar) avatar.textContent = isGuest ? 'G' : '?';
            if (name) {
                name.textContent = isGuest ? '\uAC8C\uC2A4\uD2B8' : '\uB85C\uADF8\uC778';
                name.title = isGuest ? '\uD074\uB9AD\uD558\uC5EC \uB85C\uADF8\uC778' : '\uD074\uB9AD\uD558\uC5EC \uB85C\uADF8\uC778';
            }
        }
    };

    // ─── 테마 토글 ─────────────────────────────────────

    UnifiedSidebar.prototype._toggleTheme = function () {
        // 기존 toggleTheme 함수가 있으면 사용
        if (typeof window.toggleTheme === 'function') {
            window.toggleTheme();
            return;
        }

        var html = document.documentElement;
        var current = html.getAttribute('data-theme') || 'dark';
        var next = current === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
    };

    // ─── 외부 연동 메서드 ──────────────────────────────

    /**
     * 대화 목록 새로고침
     */
    UnifiedSidebar.prototype.refresh = function () {
        this.loadConversations();
        this._updateUserSection();
    };

    /**
     * 활성 대화 설정
     * @param {string} id
     */
    UnifiedSidebar.prototype.setActiveConversation = function (id) {
        this.activeConversationId = id;
        var items = this.el ? this.el.querySelectorAll('.us-conv-item') : [];
        items.forEach(function (item) {
            item.classList.toggle('active', item.dataset.id === id);
        });
    };

    /**
     * 정리 (이벤트 리스너 제거)
     */
    UnifiedSidebar.prototype.destroy = function () {
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
        }
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
        }
        if (this._backdropEl && this._backdropEl.parentNode) {
            this._backdropEl.parentNode.removeChild(this._backdropEl);
        }
        clearTimeout(this._hoverTimer);
        clearTimeout(this._searchTimer);
    };

    // ─── 전역 노출 ────────────────────────────────────

    window.UnifiedSidebar = UnifiedSidebar;

})();
