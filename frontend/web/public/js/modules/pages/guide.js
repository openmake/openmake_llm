/**
 * ============================================
 * Guide Page - 사용자 가이드
 * ============================================
 * 애플리케이션 사용법, 기능 안내, 단축키, 명령어 목록 등
 * 사용자 가이드 컨텐츠를 표시하는 SPA 페이지 모듈입니다.
 *
 * @module pages/guide
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    /** @type {number[]} setInterval ID 배열 (cleanup용) */
    var _intervals = [];

    window.PageModules['guide'] = {
        getHTML: function() {
            return '<div class="page-guide">' +
                '<style data-spa-style="guide">' +
                '.guide-content {' +
                '  line-height: 1.8;' +
                '  max-width: 800px;' +
                '}' +
                '.guide-content h2 {' +
                '  font-size: var(--font-size-2xl);' +
                '  margin: var(--space-10) 0 var(--space-5);' +
                '  padding-bottom: var(--space-2);' +
                '  border-bottom: 1px solid var(--border-light);' +
                '}' +
                '.guide-content h3 {' +
                '  font-size: var(--font-size-xl);' +
                '  margin: var(--space-8) 0 var(--space-4);' +
                '  color: var(--accent-primary);' +
                '}' +
                '.guide-content h4 {' +
                '  font-size: var(--font-size-lg);' +
                '  margin: var(--space-5) 0 var(--space-2);' +
                '}' +
                '.guide-content p {' +
                '  margin-bottom: var(--space-4);' +
                '}' +
                '.guide-content ul,' +
                '.guide-content ol {' +
                '  margin-left: var(--space-6);' +
                '  margin-bottom: var(--space-4);' +
                '}' +
                '.guide-content li {' +
                '  margin-bottom: var(--space-2);' +
                '}' +
                '.guide-content code {' +
                '  background: var(--bg-card);' +
                '  padding: var(--space-1) var(--space-2);' +
                '  border-radius: var(--radius-sm);' +
                '  font-size: 0.9em;' +
                '}' +
                '.guide-content pre {' +
                '  background: var(--bg-card);' +
                '  padding: var(--space-5);' +
                '  border-radius: var(--radius-lg);' +
                '  overflow-x: auto;' +
                '  margin: var(--space-5) 0;' +
                '}' +
                '.guide-content pre code {' +
                '  background: transparent;' +
                '  padding: 0;' +
                '}' +
                '.guide-content table {' +
                '  width: 100%;' +
                '  border-collapse: collapse;' +
                '  margin: var(--space-5) 0;' +
                '}' +
                '.guide-content th,' +
                '.guide-content td {' +
                '  padding: var(--space-3) var(--space-4);' +
                '  text-align: left;' +
                '  border-bottom: 1px solid var(--border-light);' +
                '}' +
                '.guide-content th {' +
                '  background: var(--bg-card);' +
                '  color: var(--text-muted);' +
                '  font-size: var(--font-size-sm);' +
                '  text-transform: uppercase;' +
                '}' +
                '.mode-card {' +
                '  background: var(--bg-card);' +
                '  border-radius: var(--radius-lg);' +
                '  padding: var(--space-5);' +
                '  margin-bottom: var(--space-4);' +
                '  border-left: 4px solid var(--accent-primary);' +
                '}' +
                '.mode-card h4 {' +
                '  margin-top: 0 !important;' +
                '  display: flex;' +
                '  align-items: center;' +
                '  gap: var(--space-2);' +
                '}' +
                '.mode-grid {' +
                '  display: grid;' +
                '  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));' +
                '  gap: var(--space-4);' +
                '  margin: var(--space-5) 0;' +
                '}' +
                '.tip-box {' +
                '  background: var(--bg-tertiary);' +
                '  border: 2px solid var(--success);' +
                '  border-radius: var(--radius-lg);' +
                '  padding: var(--space-4) var(--space-5);' +
                '  margin: var(--space-5) 0;' +
                '}' +
                '.tip-box h4 {' +
                '  color: var(--success);' +
                '  margin-top: 0 !important;' +
                '}' +
                '.warning-box {' +
                '  background: var(--bg-tertiary);' +
                '  border: 2px solid var(--warning);' +
                '  border-radius: var(--radius-lg);' +
                '  padding: var(--space-4) var(--space-5);' +
                '  margin: var(--space-5) 0;' +
                '}' +
                '.warning-box h4 {' +
                '  color: var(--warning);' +
                '  margin-top: 0 !important;' +
                '}' +
                '</style>' +
                '<div class="container container-lg">' +
                  '<header class="page-header">' +
                    '<div>' +
                      '<h1 class="page-title page-title-gradient">\uD83D\uDCD6 OpenMake.Ai \uC0AC\uC6A9\uC790 \uAC00\uC774\uB4DC</h1>' +
                      '<p class="page-subtitle">\uBC84\uC804 1.5.2 \u00B7 \uB9C8\uC9C0\uB9C9 \uC5C5\uB370\uC774\uD2B8: 2026-02-14</p>' +
                    '</div>' +
                  '</header>' +
                  '<div class="guide-content">' +
                    '<h2>\uD83C\uDFAF \uC18C\uAC1C</h2>' +
                    '<p><strong>OpenMake.Ai</strong>\uC740 \uB2E4\uC591\uD55C AI \uBAA8\uB378\uC744 \uD65C\uC6A9\uD558\uC5EC \uB300\uD654, \uCF54\uB4DC \uC791\uC131, \uBB38\uC11C \uBD84\uC11D, \uBC88\uC5ED \uB4F1 \uB2E4\uC591\uD55C \uC791\uC5C5\uC744 \uC218\uD589\uD560 \uC218 \uC788\uB294 \uC62C\uC778\uC6D0 AI \uC5B4\uC2DC\uC2A4\uD134\uD2B8\uC785\uB2C8\uB2E4.</p>' +

                    '<h2>\u270F\uFE0F \uD504\uB86C\uD504\uD2B8 \uBAA8\uB4DC (12\uC885)</h2>' +
                    '<p>\uAC01 \uBAA8\uB4DC\uB294 \uD2B9\uC815 \uC791\uC5C5\uC5D0 \uCD5C\uC801\uD654\uB41C \uC2DC\uC2A4\uD15C \uD504\uB86C\uD504\uD2B8\uB97C \uC0AC\uC6A9\uD569\uB2C8\uB2E4. \uC9C8\uBB38 \uB0B4\uC6A9\uC5D0 \uB530\uB77C <strong>\uC790\uB3D9\uC73C\uB85C \uCD5C\uC801 \uBAA8\uB4DC\uAC00 \uC120\uD0DD</strong>\uB429\uB2C8\uB2E4.</p>' +

                    '<h3>\uD83D\uDFE2 \uAE30\uBCF8 \uBAA8\uB4DC</h3>' +
                    '<div class="mode-grid">' +
                      '<div class="mode-card">' +
                        '<h4>\uD83E\uDD1D Assistant <span class="badge badge-primary">\uAE30\uBCF8</span></h4>' +
                        '<p>\uC77C\uBC18 \uB300\uD654, \uC9C8\uBB38 \uB2F5\uBCC0, \uC815\uBCF4 \uC81C\uACF5</p>' +
                      '</div>' +
                      '<div class="mode-card">' +
                        '<h4>\uD83E\uDDE0 Reasoning</h4>' +
                        '<p>\uBCF5\uC7A1\uD55C \uBB38\uC81C \uD574\uACB0, \uC218\uD559\uC801/\uB17C\uB9AC\uC801 \uBD84\uC11D</p>' +
                      '</div>' +
                    '</div>' +

                    '<h3>\uD83D\uDCBB \uAC1C\uBC1C \uBAA8\uB4DC</h3>' +
                    '<div class="mode-grid">' +
                      '<div class="mode-card">' +
                        '<h4>\uD83D\uDC68\u200D\uD83D\uDCBB Coder</h4>' +
                        '<p>\uD504\uB85C\uADF8\uB798\uBC0D, \uB514\uBC84\uAE45, API \uAC1C\uBC1C</p>' +
                      '</div>' +
                      '<div class="mode-card">' +
                        '<h4>\uD83D\uDD0D Reviewer</h4>' +
                        '<p>\uCF54\uB4DC \uD488\uC9C8 \uBD84\uC11D, \uBCF4\uC548 \uCDE8\uC57D\uC810 \uAC80\uD1A0</p>' +
                      '</div>' +
                      '<div class="mode-card">' +
                        '<h4>\uD83C\uDFD7\uFE0F Generator</h4>' +
                        '<p>\uD504\uB85C\uC81D\uD2B8 \uC2A4\uCE90\uD3F4\uB529, \uBCF4\uC77C\uB7EC\uD50C\uB808\uC774\uD2B8 \uC0DD\uC131</p>' +
                      '</div>' +
                      '<div class="mode-card">' +
                        '<h4>\uD83D\uDEE1\uFE0F Security</h4>' +
                        '<p>\uBCF4\uC548 \uCDE8\uC57D\uC810 \uBD84\uC11D, \uBC29\uC5B4 \uC804\uB7B5 \uC218\uB9BD</p>' +
                      '</div>' +
                    '</div>' +

                    '<h3>\uD83D\uDCDD \uCF58\uD150\uCE20 \uBAA8\uB4DC</h3>' +
                    '<div class="mode-grid">' +
                      '<div class="mode-card">' +
                        '<h4>\u270D\uFE0F Writer</h4>' +
                        '<p>\uBE14\uB85C\uADF8, \uC774\uBA54\uC77C, \uBCF4\uACE0\uC11C \uC791\uC131</p>' +
                      '</div>' +
                      '<div class="mode-card">' +
                        '<h4>\uD83D\uDCDA Explainer</h4>' +
                        '<p>\uBCF5\uC7A1\uD55C \uAC1C\uB150\uC744 \uC27D\uAC8C \uC124\uBA85</p>' +
                      '</div>' +
                      '<div class="mode-card">' +
                        '<h4>\uD83C\uDF10 Translator</h4>' +
                        '<p>\uB2E4\uAD6D\uC5B4 \uBC88\uC5ED, \uBB38\uD654\uC801 \uB9E5\uB77D \uD574\uC124</p>' +
                      '</div>' +
                    '</div>' +

                    '<h3>\uD83D\uDD2C \uBD84\uC11D \uBAA8\uB4DC</h3>' +
                    '<div class="mode-grid">' +
                      '<div class="mode-card">' +
                        '<h4>\uD83D\uDD0E Researcher</h4>' +
                        '<p>\uB9AC\uC11C\uCE58, \uB370\uC774\uD130 \uC870\uC0AC, \uD2B8\uB80C\uB4DC \uBD84\uC11D</p>' +
                      '</div>' +
                      '<div class="mode-card">' +
                        '<h4>\uD83D\uDCBC Consultant</h4>' +
                        '<p>\uBE44\uC988\uB2C8\uC2A4 \uC804\uB7B5, \uBB38\uC81C \uD574\uACB0</p>' +
                      '</div>' +
                      '<div class="mode-card">' +
                        '<h4>\uD83E\uDD16 Agent</h4>' +
                        '<p>\uC678\uBD80 \uB3C4\uAD6C \uD638\uCD9C, \uC790\uB3D9\uD654 \uC791\uC5C5</p>' +
                      '</div>' +
                    '</div>' +

                    '<h2>\uD83D\uDD27 MCP \uB3C4\uAD6C</h2>' +
                    '<p>\uC678\uBD80 \uC11C\uBE44\uC2A4\uC640 \uC5F0\uB3D9\uD558\uC5EC LLM\uC758 \uB2A5\uB825\uC744 \uD655\uC7A5\uD569\uB2C8\uB2E4.</p>' +
                    '<table>' +
                      '<tr>' +
                        '<th>\uB3C4\uAD6C</th>' +
                        '<th>\uAE30\uB2A5</th>' +
                      '</tr>' +
                      '<tr>' +
                        '<td>\uD83D\uDD0D \uC6F9 \uAC80\uC0C9</td>' +
                        '<td>Google/DuckDuckGo/Naver \uAC80\uC0C9</td>' +
                      '</tr>' +
                      '<tr>' +
                        '<td>\uD83D\uDC19 GitHub</td>' +
                        '<td>\uB808\uD3EC\uC9C0\uD1A0\uB9AC \uAC80\uC0C9, \uC774\uC288 \uAD00\uB9AC, \uCF54\uB4DC \uC870\uD68C</td>' +
                      '</tr>' +
                      '<tr>' +
                        '<td>\uD83D\uDCCA Exa Search</td>' +
                        '<td>\uD559\uC220/\uAE30\uC220 \uBB38\uC11C \uAC80\uC0C9</td>' +
                      '</tr>' +
                      '<tr>' +
                        '<td>\uD83D\uDCC4 PDF \uBD84\uC11D</td>' +
                        '<td>\uBB38\uC11C \uC694\uC57D \uBC0F Q&amp;A</td>' +
                      '</tr>' +
                      '<tr>' +
                        '<td>\uD83D\uDDBC\uFE0F \uC774\uBBF8\uC9C0 \uBD84\uC11D</td>' +
                        '<td>Vision \uAE30\uBC18 \uC774\uBBF8\uC9C0 \uC778\uC2DD</td>' +
                      '</tr>' +
                    '</table>' +

                    '<h2>\uD83D\uDCC4 \uBB38\uC11C \uBD84\uC11D</h2>' +
                    '<h3>\uC9C0\uC6D0 \uD615\uC2DD</h3>' +
                    '<ul>' +
                      '<li>PDF, DOCX, TXT, MD</li>' +
                      '<li>\uC774\uBBF8\uC9C0 (PNG, JPG) - OCR \uC9C0\uC6D0</li>' +
                      '<li>\uC5D1\uC140 (XLSX) - \uB370\uC774\uD130 \uCD94\uCD9C</li>' +
                    '</ul>' +
                    '<h3>\uC0AC\uC6A9 \uBC29\uBC95</h3>' +
                    '<ol>' +
                      '<li>\uCC44\uD305 \uC785\uB825\uCC3D\uC758 \uD83D\uDCCE \uBC84\uD2BC \uD074\uB9AD</li>' +
                      '<li>\uD30C\uC77C \uC5C5\uB85C\uB4DC (\uCD5C\uB300 100MB)</li>' +
                      '<li>&quot;\uC774 \uBB38\uC11C \uC694\uC57D\uD574\uC918&quot; \uB610\uB294 &quot;3\uD398\uC774\uC9C0 \uB0B4\uC6A9 \uC124\uBA85\uD574\uC918&quot;</li>' +
                    '</ol>' +

                    '<h2>\uD83D\uDCA1 \uD301 &amp; \uD2B8\uB9AD</h2>' +
                    '<div class="tip-box">' +
                      '<h4>\u2705 \uD6A8\uACFC\uC801\uC778 \uD504\uB86C\uD504\uD2B8 \uC791\uC131</h4>' +
                      '<p><strong>\uC88B\uC740 \uC608\uC2DC:</strong> &quot;TypeScript\uB85C \uC0AC\uC6A9\uC790 \uC778\uC99D API\uB97C \uC791\uC131\uD574\uC918. JWT \uD1A0\uD070\uC744 \uC0AC\uC6A9\uD558\uACE0 \uC5D0\uB7EC \uCC98\uB9AC\uB97C \uD3EC\uD568\uD574\uC918.&quot;</p>' +
                      '<p><strong>\uB098\uC05C \uC608\uC2DC:</strong> &quot;API \uB9CC\uB4E4\uC5B4\uC918&quot;</p>' +
                    '</div>' +
                    '<div class="warning-box">' +
                      '<h4>\u26A0\uFE0F \uC8FC\uC758\uC0AC\uD56D</h4>' +
                      '<p>AI\uC758 \uC9C0\uC2DD\uC740 2024\uB144 12\uC6D4\uAE4C\uC9C0\uC758 \uB370\uC774\uD130 \uAE30\uBC18\uC785\uB2C8\uB2E4. \uCD5C\uC2E0 \uC815\uBCF4\uB294 \uC6F9 \uAC80\uC0C9 \uAE30\uB2A5\uC744 \uD65C\uC6A9\uD558\uC138\uC694.</p>' +
                    '</div>' +

                    '<h2>\u2753 FAQ</h2>' +
                    '<h4>Q: \uC5B4\uB5A4 \uBAA8\uB378\uC744 \uC0AC\uC6A9\uD558\uB098\uC694?</h4>' +
                    '<p>\uAE30\uBCF8\uC801\uC73C\uB85C Gemini 3 Flash/Pro\uB97C \uC0AC\uC6A9\uD558\uBA70, \uC124\uC815\uC5D0\uC11C \uBCC0\uACBD\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</p>' +
                    '<h4>Q: \uB300\uD654 \uB0B4\uC6A9\uC740 \uC800\uC7A5\uB418\uB098\uC694?</h4>' +
                    '<p>\uB85C\uADF8\uC778 \uC0AC\uC6A9\uC790\uC758 \uB300\uD654\uB294 \uC11C\uBC84\uC5D0 \uC800\uC7A5\uB418\uBA70 \uD788\uC2A4\uD1A0\uB9AC \uBA54\uB274\uC5D0\uC11C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</p>' +
                    '<h4>Q: \uD30C\uC77C \uC5C5\uB85C\uB4DC \uC6A9\uB7C9 \uC81C\uD55C\uC740?</h4>' +
                    '<p>\uCD5C\uB300 100MB\uC785\uB2C8\uB2E4.</p>' +
                    '<h4>Q: \uD504\uB86C\uD504\uD2B8 \uBAA8\uB4DC\uB97C \uC218\uB3D9\uC73C\uB85C \uBCC0\uACBD\uD560 \uC218 \uC788\uB098\uC694?</h4>' +
                    '<p>\uB124, \uC0AC\uC774\uB4DC\uBC14\uC758 \uD504\uB86C\uD504\uD2B8 \uBAA8\uB4DC \uC139\uC158\uC5D0\uC11C \uC6D0\uD558\uB294 \uBAA8\uB4DC\uB97C \uD074\uB9AD\uD558\uC138\uC694.</p>' +
                  '</div>' +
                '</div>' +
              '</div>';
        },

        init: function() {
            // \uAC00\uC774\uB4DC \uD398\uC774\uC9C0\uB294 \uC815\uC801 \uCF58\uD150\uCE20\uC774\uBBC0\uB85C \uCD08\uAE30\uD654 \uB85C\uC9C1 \uC5C6\uC74C
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
        }
    };
})();
