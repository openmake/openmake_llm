/**
 * ============================================
 * Developer Page - API 개발자 포털
 * ============================================
 * 외부 개발자를 위한 API 문서, 코드 예제, 인증 방법,
 * Rate Limit 안내, 엔드포인트 목록을 제공하는
 * SPA 페이지 모듈입니다. 코드 구문 강조를 지원합니다.
 *
 * 섹션 콘텐츠: ./developer-sections.js
 * 공통 헬퍼:   ./developer-helpers.js
 *
 * @module pages/developer
 */
'use strict';

import {
    renderIntroSection,
    renderAuthSection,
    renderModelsSection,
    renderChatSection,
    renderOpenAICompatSection,
    renderApiKeysSection,
    renderUsageSection,
    renderRateLimitsSection,
    renderErrorsSection,
    renderSdksSection
} from './developer-sections.js';

    window.PageModules = window.PageModules || {};
    /** @type {number[]} setInterval ID 배열 (cleanup용) */
    let _intervals = [];
    /** @type {IntersectionObserver|null} 스크롤 관찰자 */
    let _observer = null;

    window.PageModules['developer'] = {
        getHTML: function() {
            var styles = '<style data-spa-style="developer">' +
                '.dev-layout { display: flex; gap: var(--space-8); position: relative; max-width: 1400px; margin: 0 auto; }' +
                '.dev-sidebar { width: 260px; position: sticky; top: var(--space-8); height: calc(100vh - 100px); height: calc(100dvh - 100px); overflow-y: auto; flex-shrink: 0; padding-right: var(--space-4); display: none; -webkit-transform: translate3d(0,0,0); transform: translate3d(0,0,0); }' +
                '@media (min-width: 900px) { .dev-sidebar { display: block; } }' +
                '.dev-sidebar::-webkit-scrollbar { width: 4px; }' +
                '.dev-sidebar-nav { list-style: none; padding: 0; }' +
                '.dev-sidebar-nav li { margin-bottom: var(--space-1); }' +
                '.dev-sidebar-link { display: block; padding: var(--space-2) var(--space-3); color: var(--text-muted); text-decoration: none; border-radius: var(--radius-md); font-size: var(--font-size-sm); transition: all var(--transition-fast); border-left: 2px solid transparent; }' +
                '.dev-sidebar-link:hover { color: var(--text-primary); background: var(--bg-hover); }' +
                '.dev-sidebar-link.active { color: var(--accent-primary); border-left-color: var(--accent-primary); background: var(--accent-primary-light); font-weight: var(--font-weight-medium); }' +
                '.dev-sidebar-sub { padding-left: var(--space-4); margin-top: var(--space-1); display: none; }' +
                '.dev-sidebar-link.active + .dev-sidebar-sub, .dev-sidebar-sub:hover { display: block; }' +

                '.dev-content { flex: 1; min-width: 0; padding-bottom: var(--space-16); }' +
                '.dev-section { margin-bottom: var(--space-12); scroll-margin-top: 100px; }' +
                '.dev-section h2 { font-size: var(--font-size-2xl); margin-bottom: var(--space-6); border-bottom: 1px solid var(--border-light); padding-bottom: var(--space-2); }' +
                '.dev-section h3 { font-size: var(--font-size-xl); margin: var(--space-8) 0 var(--space-4); color: var(--text-primary); }' +
                '.dev-section p { margin-bottom: var(--space-4); line-height: 1.6; color: var(--text-secondary); }' +

                '.endpoint-badge { display: inline-block; padding: 2px 8px; border-radius: var(--radius-sm); font-size: var(--font-size-xs); font-weight: bold; margin-right: var(--space-2); text-transform: uppercase; letter-spacing: 0.5px; }' +
                '.badge-get { background: var(--bg-tertiary); color: var(--success); border: 2px solid var(--success); }' +
                '.badge-post { background: var(--bg-tertiary); color: var(--info); border: 2px solid var(--info); }' +
                '.badge-put, .badge-patch { background: var(--bg-tertiary); color: var(--warning); border: 2px solid var(--warning); }' +
                '.badge-delete { background: var(--bg-tertiary); color: var(--danger); border: 2px solid var(--danger); }' +

                '.code-group { border: 1px solid var(--border-light); border-radius: var(--radius-lg); overflow: hidden; margin: var(--space-6) 0; background: #1e1e1e; box-shadow: var(--shadow-md); }' +
                '.code-tabs { display: flex; background: #252526; border-bottom: 1px solid #333; }' +
                '.code-tab { background: transparent; border: none; padding: var(--space-3) var(--space-5); color: #888; cursor: pointer; font-family: var(--font-sans); font-size: var(--font-size-sm); transition: color 0.2s; }' +
                '.code-tab:hover { color: #fff; }' +
                '.code-tab.active { color: var(--accent-primary); border-bottom: 2px solid var(--accent-primary); font-weight: 500; color: #fff; }' +
                '.code-content-wrapper { position: relative; }' +
                '.code-content { display: none; padding: var(--space-5); overflow-x: auto; font-family: var(--font-mono); font-size: 0.9rem; line-height: 1.5; color: #d4d4d4; }' +
                '.code-content.active { display: block; }' +
                '.copy-btn { position: absolute; top: var(--space-2); right: var(--space-2); background: var(--bg-tertiary); border: 1px solid var(--border-light); color: #ccc; padding: 4px 10px; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-xs); opacity: 0; transition: all 0.2s; }' +
                '.code-group:hover .copy-btn { opacity: 1; }' +
                '.copy-btn:hover { background: var(--bg-hover); color: #fff; }' +

                '/* Syntax Highlighting */' +
                '.tok-key { color: #569cd6; }' +
                '.tok-str { color: #ce9178; }' +
                '.tok-num { color: #b5cea8; }' +
                '.tok-com { color: #6a9955; }' +
                '.tok-func { color: #dcdcaa; }' +
                '.tok-param { color: #9cdcfe; }' +
                '.tok-punc { color: #d4d4d4; }' +

                '.param-table { width: 100%; border-collapse: collapse; margin-bottom: var(--space-6); font-size: var(--font-size-sm); }' +
                '.param-table th { text-align: left; padding: var(--space-3); border-bottom: 1px solid var(--border-medium); color: var(--text-muted); font-weight: 600; }' +
                '.param-table td { padding: var(--space-3); border-bottom: 1px solid var(--border-light); vertical-align: top; line-height: 1.6; }' +
                '.param-name { font-family: var(--font-mono); color: var(--accent-primary); font-weight: 600; }' +
                '.param-type { font-family: var(--font-mono); color: var(--text-muted); font-size: 0.85em; display: block; margin-top: 4px; }' +

                '.rate-table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid var(--border-light); border-radius: var(--radius-lg); overflow: hidden; margin: var(--space-6) 0; }' +
                '.rate-table th, .rate-table td { padding: var(--space-3) var(--space-4); text-align: left; border-bottom: 1px solid var(--border-light); }' +
                '.rate-table th { background: var(--bg-card); font-weight: 600; color: var(--text-secondary); }' +
                '.rate-table tr:last-child td { border-bottom: none; }' +
                '.rate-table tr:hover td { background: var(--bg-hover); }' +

                '.intro-card { background: var(--bg-card); border-radius: var(--radius-lg); padding: var(--space-6); margin-bottom: var(--space-8); border: 1px solid var(--border-light); }' +
                '.intro-card h3 { margin-top: 0; }' +

                '@media (max-width: 899px) { .dev-layout { flex-direction: column; } .dev-sidebar { display: none; } }' +
                '</style>';

            var sidebar = '<nav class="dev-sidebar">' +
                '<ul class="dev-sidebar-nav">' +
                '<li><a href="#intro" class="dev-sidebar-link">Introduction</a></li>' +
                '<li><a href="#auth" class="dev-sidebar-link">Authentication</a></li>' +
                '<li><a href="#models" class="dev-sidebar-link">Available Models</a></li>' +
                '<li><a href="#chat" class="dev-sidebar-link">Chat</a></li>' +
                '<li><a href="#openai-compat" class="dev-sidebar-link">OpenAI Compatibility</a>' +
                    '<ul class="dev-sidebar-sub">' +
                        '<li><a href="#chat-completions" class="dev-sidebar-link">Chat Completions</a></li>' +
                        '<li><a href="#openai-models" class="dev-sidebar-link">Models</a></li>' +
                        '<li><a href="#openai-streaming" class="dev-sidebar-link">Streaming</a></li>' +
                    '</ul>' +
                '</li>' +
                '<li><a href="#apikeys" class="dev-sidebar-link">API Keys</a>' +
                    '<ul class="dev-sidebar-sub">' +
                        '<li><a href="#create-key" class="dev-sidebar-link">Create Key</a></li>' +
                        '<li><a href="#list-keys" class="dev-sidebar-link">List Keys</a></li>' +
                        '<li><a href="#get-key" class="dev-sidebar-link">Get Key</a></li>' +
                        '<li><a href="#update-key" class="dev-sidebar-link">Update Key</a></li>' +
                        '<li><a href="#delete-key" class="dev-sidebar-link">Delete Key</a></li>' +
                        '<li><a href="#key-usage" class="dev-sidebar-link">Key Usage</a></li>' +
                    '</ul>' +
                '</li>' +
                '<li><a href="#usage" class="dev-sidebar-link">Usage & Billing</a></li>' +
                '<li><a href="#rate-limits" class="dev-sidebar-link">Rate Limits</a></li>' +
                '<li><a href="#errors" class="dev-sidebar-link">Errors</a></li>' +
                '<li><a href="#sdks" class="dev-sidebar-link">SDKs</a></li>' +
                '</ul>' +
                '</nav>';

            // CONTENT GENERATION
            var content = '<div class="dev-content">' +
                renderIntroSection() +
                renderAuthSection() +
                renderModelsSection() +
                renderChatSection() +
                renderOpenAICompatSection() +
                renderApiKeysSection() +
                renderUsageSection() +
                renderRateLimitsSection() +
                renderErrorsSection() +
                renderSdksSection() +
                '</div>';

            return '<div class="page-developer">' + styles + '<div class="dev-layout">' + sidebar + content + '</div></div>';
        },

        init: function() {
            // Tab Switching Logic
            var layout = document.querySelector('.dev-layout');
            if (layout) {
                layout.addEventListener('click', function(e) {
                    // Handle Tabs
                    if (e.target.classList.contains('code-tab')) {
                        var lang = e.target.getAttribute('data-lang');
                        var group = e.target.closest('.code-group');

                        // Update active tab
                        var tabs = group.querySelectorAll('.code-tab');
                        tabs.forEach(function(t) { t.classList.remove('active'); });
                        e.target.classList.add('active');

                        // Update active content
                        var contents = group.querySelectorAll('.code-content');
                        contents.forEach(function(c) {
                            c.classList.remove('active');
                            if (c.getAttribute('data-lang') === lang) {
                                c.classList.add('active');
                            }
                        });
                    }

                    // Handle Copy
                    if (e.target.classList.contains('copy-btn')) {
                        var group = e.target.closest('.code-group');
                        var activeContent = group.querySelector('.code-content.active');
                        var text = activeContent.textContent;

                        navigator.clipboard.writeText(text).then(function() {
                            var originalText = e.target.textContent;
                            e.target.textContent = 'Copied!';
                            setTimeout(function() {
                                e.target.textContent = originalText;
                            }, 2000);
                        });
                    }
                });
            }

            // Scrollspy Logic
            var sections = document.querySelectorAll('.dev-section');
            var navLinks = document.querySelectorAll('.dev-sidebar-link');

            if (window.IntersectionObserver && sections.length > 0) {
                _observer = new IntersectionObserver(function(entries) {
                    // requestAnimationFrame으로 래핑하여 iOS Safari 레이아웃 스래싱 방지
                    requestAnimationFrame(function() {
                        entries.forEach(function(entry) {
                            if (entry.isIntersecting) {
                                var id = entry.target.getAttribute('id');
                                navLinks.forEach(function(link) {
                                    link.classList.remove('active');
                                    if (link.getAttribute('href') === '#' + id) {
                                        link.classList.add('active');
                                        // Expand parent submenu if exists
                                        var parent = link.closest('.dev-sidebar-sub');
                                        if (parent) {
                                            var parentLink = parent.parentElement.querySelector('a');
                                            if (parentLink) parentLink.classList.add('active');
                                        }
                                    }
                                });
                            }
                        });
                    });
                }, { threshold: 0.2, rootMargin: "-10% 0px -70% 0px" });

                sections.forEach(function(section) {
                    _observer.observe(section);
                });
            }
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            if (_observer) {
                _observer.disconnect();
                _observer = null;
            }
        }
    };

const { getHTML, init, cleanup } = window.PageModules['developer'];
export default { getHTML, init, cleanup };
