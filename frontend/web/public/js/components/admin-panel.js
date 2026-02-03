/**
 * ============================================
 * Admin Quick-Access Panel — Slide-out overlay
 * 
 * Provides quick navigation to admin/settings pages
 * without leaving the current context.
 * 
 * Usage:
 *   AdminPanel.open();
 *   AdminPanel.close();
 *   AdminPanel.toggle();
 * ============================================
 */

(function () {
    'use strict';

    var _isOpen = false;
    var _panelEl = null;
    var _backdropEl = null;

    var ADMIN_ITEMS = [
        { href: '/settings.html', icon: 'lucide:settings', label: '설정', desc: '앱 환경 및 AI 모델 설정' },
        { href: '/admin.html', icon: 'lucide:users', label: '사용자 관리', desc: '사용자 및 대화 관리', admin: true },
        { href: '/admin-metrics.html', icon: 'lucide:bar-chart-3', label: '통합 모니터링', desc: '시스템 성능 대시보드', admin: true },
        { href: '/audit.html', icon: 'lucide:clipboard-list', label: '감사 로그', desc: '시스템 활동 기록', admin: true },
        { href: '/analytics.html', icon: 'lucide:pie-chart', label: '분석 대시보드', desc: '사용 패턴 분석', admin: true },
        { href: '/external.html', icon: 'lucide:link', label: '외부 연동', desc: 'Google Drive, Notion 등', admin: true },
        { href: '/alerts.html', icon: 'lucide:bell', label: '알림 관리', desc: '시스템 알림 설정', admin: true },
        { href: '/cluster.html', icon: 'lucide:monitor', label: '클러스터', desc: '노드 상태 관리', admin: true },
        { href: '/usage.html', icon: 'lucide:bar-chart-2', label: 'API 사용량', desc: '토큰 및 요청 통계' },
        { href: '/password-change.html', icon: 'lucide:key-round', label: '비밀번호 변경', desc: '계정 보안 설정' }
    ];

    function isAdmin() {
        try {
            var user = JSON.parse(localStorage.getItem('user') || '{}');
            return user.role === 'admin' || user.role === 'administrator';
        } catch (e) {
            return false;
        }
    }

    function createPanel() {
        if (_panelEl) return;

        var container = document.getElementById('panel-container');
        if (!container) return;

        // Backdrop
        _backdropEl = document.createElement('div');
        _backdropEl.className = 'admin-panel-backdrop';
        _backdropEl.addEventListener('click', function () {
            AdminPanel.close();
        });

        // Panel
        _panelEl = document.createElement('div');
        _panelEl.className = 'admin-panel';
        _panelEl.innerHTML = buildPanelHTML();

        container.appendChild(_backdropEl);
        container.appendChild(_panelEl);

        // Bind item clicks
        _panelEl.querySelectorAll('.admin-panel-item').forEach(function (item) {
            item.addEventListener('click', function () {
                var href = item.getAttribute('data-href');
                if (href && window.Router) {
                    window.Router.navigate(href);
                }
                AdminPanel.close();
            });
        });

        // Close button
        var closeBtn = _panelEl.querySelector('.admin-panel-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                AdminPanel.close();
            });
        }
    }

    function buildPanelHTML() {
        var admin = isAdmin();
        var items = ADMIN_ITEMS.filter(function (item) {
            return !item.admin || admin;
        });

        var html = '<div class="admin-panel-header">' +
            '<h3>⚙️ 설정 & 관리</h3>' +
            '<button class="admin-panel-close" title="닫기">&times;</button>' +
            '</div>' +
            '<div class="admin-panel-body">';

        items.forEach(function (item) {
            html += '<div class="admin-panel-item" data-href="' + item.href + '">' +
                '<div class="admin-panel-item-icon"><iconify-icon icon="' + item.icon + '"></iconify-icon></div>' +
                '<div class="admin-panel-item-info">' +
                '<div class="admin-panel-item-label">' + item.label + '</div>' +
                '<div class="admin-panel-item-desc">' + item.desc + '</div>' +
                '</div>' +
                '</div>';
        });

        html += '</div>';
        return html;
    }

    // ─── Public API ────────────────────────────────────

    var AdminPanel = {
        open: function () {
            createPanel();
            if (!_panelEl) return;
            // Rebuild in case admin status changed
            _panelEl.innerHTML = buildPanelHTML();
            // Re-bind
            _panelEl.querySelectorAll('.admin-panel-item').forEach(function (item) {
                item.addEventListener('click', function () {
                    var href = item.getAttribute('data-href');
                    if (href && window.Router) {
                        window.Router.navigate(href);
                    }
                    AdminPanel.close();
                });
            });
            var closeBtn = _panelEl.querySelector('.admin-panel-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', function () {
                    AdminPanel.close();
                });
            }

            requestAnimationFrame(function () {
                _backdropEl.classList.add('open');
                _panelEl.classList.add('open');
            });
            _isOpen = true;
        },

        close: function () {
            if (!_panelEl) return;
            _backdropEl.classList.remove('open');
            _panelEl.classList.remove('open');
            _isOpen = false;
        },

        toggle: function () {
            if (_isOpen) {
                AdminPanel.close();
            } else {
                AdminPanel.open();
            }
        },

        isOpen: function () {
            return _isOpen;
        }
    };

    window.AdminPanel = AdminPanel;

})();
