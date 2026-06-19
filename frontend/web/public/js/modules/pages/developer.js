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
    renderSdksSection,
    getDocModel,
    setDocModel
} from './developer-sections.js';
import { getDefaultModelId } from '../models-api.js';

    window.PageModules = window.PageModules || {};
    /** @type {number[]} setInterval ID 배열 (cleanup용) */
    let _intervals = [];
    /** @type {IntersectionObserver|null} 스크롤 관찰자 */
    let _observer = null;

    /** 문서 본문(.dev-content) HTML 생성 — 모델명은 _docModel(단일 소스) 사용 */
    function buildContentHTML() {
        return '<div class="dev-content">' +
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
    }

    /** Scrollspy(IntersectionObserver) 설정 — 재렌더 시 재호출 가능 (기존 observer disconnect 후 재관찰) */
    function setupScrollspy() {
        if (_observer) { _observer.disconnect(); _observer = null; }
        var sections = document.querySelectorAll('.dev-section');
        var navLinks = document.querySelectorAll('.dev-sidebar-link');
        if (window.IntersectionObserver && sections.length > 0) {
            _observer = new IntersectionObserver(function(entries) {
                requestAnimationFrame(function() {
                    entries.forEach(function(entry) {
                        if (entry.isIntersecting) {
                            var id = entry.target.getAttribute('id');
                            navLinks.forEach(function(link) {
                                link.classList.remove('active');
                                if (link.getAttribute('href') === '#' + id) {
                                    link.classList.add('active');
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
            sections.forEach(function(section) { _observer.observe(section); });
        }
    }

    /**
     * 문서 예제 모델명을 백엔드 실제 default 모델로 동적 갱신.
     * `/api/models`(→ 백엔드 LLM_DEFAULT_MODEL/model-pool 반영)에서 defaultModel 조회 →
     * setDocModel() → .dev-content 재렌더. 실패/미인증 시 fallback 유지.
     */
    async function refreshDocModel() {
        try {
            var id = await getDefaultModelId();
            if (!id) return;
            if (id.indexOf(':') > -1) id = id.slice(id.indexOf(':') + 1);  // 표시용: provider prefix 제거 ('local-llm:xxx' → 'xxx', 모델 id 내부 콜론 보존)
            if (id === getDocModel()) return;
            setDocModel(id);
            var contentEl = document.querySelector('.dev-content');
            if (contentEl) {
                // 재렌더 전 사용자가 선택한 코드 탭 상태 보존 (buildContentHTML 결정적 → code-group 순서 일치)
                var activeLangs = Array.prototype.map.call(document.querySelectorAll('.code-group'), function (g) {
                    var t = g.querySelector('.code-tab.active');
                    return t ? t.getAttribute('data-lang') : null;
                });
                contentEl.outerHTML = buildContentHTML();
                var newGroups = document.querySelectorAll('.code-group');
                activeLangs.forEach(function (lang, i) {
                    if (!lang || !newGroups[i]) return;
                    newGroups[i].querySelectorAll('.code-tab').forEach(function (t) {
                        t.classList.toggle('active', t.getAttribute('data-lang') === lang);
                    });
                    newGroups[i].querySelectorAll('.code-content').forEach(function (c) {
                        c.classList.toggle('active', c.getAttribute('data-lang') === lang);
                    });
                });
                setupScrollspy();
            }
        } catch (e) { /* fetch 실패 → fallback 모델 유지 */ }
    }

    window.PageModules['developer'] = {
        getHTML: function() {
            var styles = '<style data-spa-style="developer">' +
                '.dev-layout { display: flex; gap: var(--space-8); position: relative; max-width: 1400px; margin: 0 auto; }' +
                '.dev-sidebar { width: 260px; position: sticky; top: var(--space-8); height: calc(100vh - 100px); height: calc(100dvh - 100px); overflow-y: auto; flex-shrink: 0; padding-right: var(--space-4); display: none; -webkit-transform: translate3d(0,0,0); transform: translate3d(0,0,0); }' +
                '@media (min-width: 900px) { .dev-sidebar { display: block; } }' +
                '.dev-sidebar::-webkit-scrollbar { width: 4px; }' +
                '.dev-sidebar-nav { list-style: none; padding: 0; }' +
                '.dev-sidebar-nav li { margin-bottom: var(--space-1); }' +
                '.dev-sidebar-link { display: block; padding: 6px 10px; color: var(--text-faint); text-decoration: none; border-radius: var(--r-sm); font-size: 13px; transition: all var(--transition-fast); border-left: 2px solid transparent; }' +
                '.dev-sidebar-link:hover { color: var(--text-secondary); background: var(--bg-hover); }' +
                '.dev-sidebar-link.active { color: var(--accent-primary-hover); background: var(--ember-soft); border-left: 2px solid var(--accent-primary); font-weight: var(--font-weight-medium); }' +
                '.dev-sidebar-sub { padding-left: var(--space-4); margin-top: var(--space-1); display: none; }' +
                '.dev-sidebar-link.active + .dev-sidebar-sub, .dev-sidebar-sub:hover { display: block; }' +

                '.dev-content { flex: 1; min-width: 0; padding-bottom: var(--space-16); }' +
                '.dev-section { margin-bottom: var(--space-12); scroll-margin-top: 100px; }' +
                '.dev-section h2 { font-size: var(--font-size-2xl); margin-bottom: var(--space-6); border-bottom: 1px solid var(--border-light); padding-bottom: var(--space-2); }' +
                '.dev-section h3 { font-size: var(--font-size-xl); margin: var(--space-8) 0 var(--space-4); color: var(--text-primary); }' +
                '.dev-section p { margin-bottom: var(--space-4); line-height: 1.6; color: var(--text-secondary); }' +

                '.endpoint-badge { display: inline-block; padding: 3px 8px; border-radius: 5px; font-family: var(--font-mono); font-size: 11px; font-weight: 600; margin-right: var(--space-2); text-transform: uppercase; letter-spacing: 0.5px; }' +
                '.badge-get { background: rgba(95,185,125,.13); color: var(--success); border: 1px solid rgba(95,185,125,.3); }' +
                '.badge-post { background: var(--ember-soft); color: var(--accent-primary); border: 1px solid var(--ember-line); }' +
                '.badge-put, .badge-patch { background: rgba(232,176,75,.13); color: var(--warning); border: 1px solid rgba(232,176,75,.3); }' +
                '.badge-delete { background: rgba(229,84,78,.13); color: var(--danger); border: 1px solid rgba(229,84,78,.3); }' +

                '.code-group { border: 1px solid var(--border-light); border-radius: var(--r-md); overflow: hidden; margin: var(--space-6) 0; background: var(--bg-sidebar); box-shadow: var(--shadow-md); }' +
                '.code-tabs { display: flex; background: var(--bg-tertiary); border-bottom: 1px solid var(--border-light); }' +
                '.code-tab { background: transparent; border: none; padding: var(--space-3) var(--space-5); color: var(--text-faint); cursor: pointer; font-family: var(--font-sans); font-size: var(--font-size-sm); transition: color 0.2s; }' +
                '.code-tab:hover { color: var(--text-primary); }' +
                '.code-tab.active { color: var(--text-primary); border-bottom: 2px solid var(--accent-primary); font-weight: 500; }' +
                '.code-content-wrapper { position: relative; }' +
                '.code-content { display: none; padding: var(--space-5); overflow-x: auto; font-family: var(--font-mono); font-size: var(--font-size-sm); line-height: 1.5; color: var(--text-secondary); }' +
                '.code-content.active { display: block; }' +
                '.copy-btn { position: absolute; top: var(--space-2); right: var(--space-2); background: var(--bg-tertiary); border: 1px solid var(--border-light); color: var(--text-faint); padding: 4px 10px; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-xs); opacity: 0; transition: all 0.2s; }' +
                '.code-group:hover .copy-btn { opacity: 1; }' +
                '.copy-btn:hover { background: var(--bg-hover); color: var(--text-primary); }' +

                '/* Syntax Highlighting */' +
                '.tok-key { color: var(--accent-primary-hover); }' +
                '.tok-str { color: var(--success); }' +
                '.tok-num { color: var(--success); }' +
                '.tok-com { color: var(--text-faint); }' +
                '.tok-func { color: var(--accent-primary-hover); }' +
                '.tok-param { color: var(--info, #6ba5c9); }' +
                '.tok-punc { color: var(--text-secondary); }' +

                '.param-table { width: 100%; border-collapse: collapse; margin-bottom: var(--space-6); font-size: var(--font-size-sm); }' +
                '.param-table th { text-align: left; padding: var(--space-3); border-bottom: 1px solid var(--border-medium); color: var(--text-muted); font-weight: 600; }' +
                '.param-table td { padding: var(--space-3); border-bottom: 1px solid var(--border-light); vertical-align: top; line-height: 1.6; }' +
                '.param-name { font-family: var(--font-mono); color: var(--accent-primary); font-weight: 600; }' +
                '.param-type { font-family: var(--font-mono); color: var(--text-muted); font-size: var(--font-size-sm); display: block; margin-top: 4px; }' +

                '.rate-table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid var(--border-light); border-radius: var(--radius-lg); overflow: hidden; margin: var(--space-6) 0; }' +
                '.rate-table th, .rate-table td { padding: var(--space-3) var(--space-4); text-align: left; border-bottom: 1px solid var(--border-light); }' +
                '.rate-table th { background: var(--bg-card); font-weight: 600; color: var(--text-secondary); }' +
                '.rate-table tr:last-child td { border-bottom: none; }' +
                '.rate-table tr:hover td { background: var(--bg-hover); }' +

                '.intro-card { background: var(--bg-sidebar); border-radius: var(--radius-lg); padding: var(--space-6); margin-bottom: var(--space-8); border: 1px solid var(--border-light); }' +
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
            var content = buildContentHTML();

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

            // Scrollspy 설정 + 문서 예제 모델을 백엔드 default 모델로 동적 반영
            setupScrollspy();
            refreshDocModel();
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
