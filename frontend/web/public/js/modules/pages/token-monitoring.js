/**
 * ============================================
 * Token Monitoring Page - API 토큰 모니터링
 * ============================================
 * 토큰 모니터링 기능은 통합 시스템 대시보드(admin-metrics)에
 * 통합되었습니다. 이 모듈은 SPA 라우팅 시 admin-metrics 페이지로
 * 리디렉트합니다.
 *
 * @module pages/token-monitoring
 */
'use strict';
    window.PageModules = window.PageModules || {};

function getHTML() {
            return '<div class="page-token-monitoring">' +
                '<style data-spa-style="token-monitoring">' +
                ".redirect-container { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:40vh; text-align:center; }\n" +
                ".redirect-container h2 { font-size:1.3rem; font-weight:var(--font-weight-semibold); color:var(--text-primary); margin-bottom:var(--space-3); }\n" +
                ".redirect-container p { color:var(--text-muted); font-size:var(--font-size-sm); margin-bottom:var(--space-4); }\n" +
                ".redirect-container .redirect-icon { font-size:2.5rem; margin-bottom:var(--space-4); }\n" +
                ".redirect-container a { color:var(--accent-primary); text-decoration:underline; font-weight:var(--font-weight-semibold); }" +
                '<\/style>' +
                '<header class="page-header">' +
                    '<button class="mobile-menu-btn" onclick="toggleMobileSidebar(event)">&#9776;</button>' +
                    '<h1>API 토큰 모니터링</h1>' +
                '</header>' +
                '<div class="content-area">' +
                    '<div class="redirect-container">' +
                        '<div class="redirect-icon">📊</div>' +
                        '<h2>통합 대시보드로 이동합니다</h2>' +
                        '<p>API 토큰 모니터링은 통합 시스템 대시보드에서 확인할 수 있습니다.</p>' +
                        '<a href="/admin-metrics.html" onclick="event.preventDefault(); window.Router && Router.navigate(\'/admin-metrics.html\');">통합 대시보드 바로가기</a>' +
                    '</div>' +
                '</div>' +
            '<\/div>';
}

function init() {
            try {
                // 자동 리디렉트 (SPA 라우터 사용)
                if (window.Router && typeof Router.navigate === 'function') {
                    setTimeout(function() {
                        Router.navigate('/admin-metrics.html');
                    }, 100);
                }
            } catch(e) {
                console.error('[PageModule:token-monitoring] init error:', e);
            }
}

function cleanup() {
            // 리디렉트 전용 모듈 — 정리할 자원 없음
}

const pageModule = { getHTML, init, cleanup };
window.PageModules['token-monitoring'] = pageModule;
export default pageModule;
