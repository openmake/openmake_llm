/**
 * ============================================
 * Token Monitoring Page - 토큰 사용량 모니터링
 * ============================================
 * API 토큰 사용량 추적 및 시각화 페이지입니다.
 * admin-metrics 페이지로 리다이렉트하여 통합 대시보드에서
 * 토큰 모니터링을 제공합니다.
 *
 * @module pages/token-monitoring
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    /** @type {number[]} setInterval ID 배열 (cleanup용) */
    var _intervals = [];

    window.PageModules['token-monitoring'] = {
        getHTML: function() {
            return '<div class="page-token-monitoring">' +
                '<style data-spa-style="token-monitoring">' +
                '.page-token-monitoring .redirect-notice { text-align:center; padding:var(--space-8); color:var(--text-muted); } ' +
                '.page-token-monitoring .redirect-notice p { margin-bottom:var(--space-4); font-size:var(--font-size-lg); } ' +
                '.page-token-monitoring .redirect-notice a { color:var(--accent-primary); text-decoration:underline; cursor:pointer; } ' +
                '</style>' +
                '<div class="redirect-notice">' +
                    '<p>\uD1A0\uD070 \uBAA8\uB2C8\uD130\uB9C1 \uD398\uC774\uC9C0\uB294 \uD1B5\uD569 \uC2DC\uC2A4\uD15C \uB300\uC2DC\uBCF4\uB4DC\uB85C \uC774\uB3D9\uB418\uC5C8\uC2B5\uB2C8\uB2E4.</p>' +
                    '<a id="tokenMonitoringRedirectLink" href="/admin-metrics.html">\uD1B5\uD569 \uC2DC\uC2A4\uD15C \uB300\uC2DC\uBCF4\uB4DC\uB85C \uC774\uB3D9</a>' +
                '</div>' +
            '</div>';
        },

        init: function() {
            // Original page redirects to admin-metrics.html
            // In SPA context, navigate via router if available
            var link = document.getElementById('tokenMonitoringRedirectLink');
            if (link) {
                link.addEventListener('click', function(e) {
                    if (window.Router && typeof window.Router.navigate === 'function') {
                        e.preventDefault();
                        window.Router.navigate('/admin-metrics.html');
                    }
                });
            }

            // Auto-navigate if SPA router exists
            if (window.Router && typeof window.Router.navigate === 'function') {
                window.Router.navigate('/admin-metrics.html');
            }
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
        }
    };
})();
