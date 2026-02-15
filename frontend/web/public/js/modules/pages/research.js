/**
 * ============================================
 * Research Page - 딥 리서치 에이전트
 * ============================================
 * 자율적 다단계 리서치 에이전트를 실행하는 SPA 페이지 모듈입니다.
 * 주제 입력 후 자동으로 분해, 웹 검색, 소스 수집,
 * 종합 보고서 생성 과정을 실시간 스트리밍으로 표시합니다.
 *
 * @module pages/research
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};

    // Module-scoped state
    var _intervals = [];
    var _listeners = [];
    var _currentSessionId = null;

    var _statusLabels = { pending:'\uB300\uAE30\uC911', running:'\uC9C4\uD589\uC911', completed:'\uC644\uB8CC', failed:'\uC2E4\uD328', cancelled:'\uCDE8\uC18C\uB428' };
    var _depthLabels = { quick:'\uBE60\uB978 \uAC80\uC0C9', standard:'\uD45C\uC900', deep:'\uC2EC\uCE35' };

    function _authFetch(url, options) {
        return window.authFetch(url, options || {}).then(function(r) { return r.json(); });
    }

    function _showToast(msg, type) {
        type = type || 'success';
        var t = document.getElementById('research-toast');
        if (!t) return;
        t.textContent = msg;
        t.className = 'toast ' + type + ' show';
        setTimeout(function() { t.classList.remove('show'); }, 3000);
    }

    function _esc(s) {
        var d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

    function _loadSessions() {
        _authFetch('/api/research/sessions').then(function(res) {
            var sessions = res.data || res || [];
            var el = document.getElementById('sessionList');
            if (!el) return;
            if (!sessions.length) {
                el.innerHTML = '<div class="empty-state"><h2>\uC5F0\uAD6C \uC138\uC158\uC774 \uC5C6\uC2B5\uB2C8\uB2E4</h2><p>\uC704\uC5D0\uC11C \uC8FC\uC81C\uB97C \uC785\uB825\uD558\uACE0 \uC5F0\uAD6C\uB97C \uC2DC\uC791\uD558\uC138\uC694.</p></div>';
                return;
            }
            el.innerHTML = sessions.map(function(s) {
                return '<div class="session-card" data-session-id="' + s.id + '">' +
                    '<h3>' + _esc(s.topic) + '</h3>' +
                    '<div class="session-meta">' +
                        '<span class="badge badge-' + s.status + '">' + (_statusLabels[s.status] || s.status) + '</span>' +
                        '<span>' + (_depthLabels[s.depth] || s.depth) + '</span>' +
                        '<span>' + new Date(s.created_at).toLocaleDateString('ko') + '</span>' +
                    '</div>' +
                    (s.progress > 0 ? '<div class="progress-bar"><div class="progress-fill" style="width:' + s.progress + '%"></div></div>' : '') +
                '</div>';
            }).join('');
        }).catch(function() {
            _showToast('\uC138\uC158 \uB85C\uB4DC \uC2E4\uD328', 'error');
        });
    }

    function _createSession() {
        var topicEl = document.getElementById('topic');
        var topic = topicEl ? topicEl.value.trim() : '';
        if (!topic) { _showToast('\uC8FC\uC81C\uB97C \uC785\uB825\uD558\uC138\uC694', 'error'); return; }
        var depthEl = document.getElementById('depth');
        _authFetch('/api/research/sessions', {
            method: 'POST',
            body: JSON.stringify({ topic: topic, depth: depthEl ? depthEl.value : 'standard' })
        }).then(function() {
            if (topicEl) topicEl.value = '';
            _showToast('\uC5F0\uAD6C\uAC00 \uC2DC\uC791\uB418\uC5C8\uC2B5\uB2C8\uB2E4');
            _loadSessions();
        }).catch(function() {
            _showToast('\uC0DD\uC131 \uC2E4\uD328', 'error');
        });
    }

    function _openSession(id) {
        _currentSessionId = id;
        var dm = document.getElementById('detailModal');
        if (dm) dm.classList.add('open');
        var dc = document.getElementById('detailContent');
        if (dc) dc.innerHTML = '<div class="loading">\uBD88\uB7EC\uC624\uB294 \uC911...</div>';

        _authFetch('/api/research/sessions/' + id).then(function(res) {
            var s = res.data || res;
            return _authFetch('/api/research/sessions/' + id + '/steps').then(function(stepsRes) {
                var steps = stepsRes.data || stepsRes || [];
                var dt = document.getElementById('detailTitle');
                if (dt) dt.textContent = s.topic;

                var html = '<div class="session-meta" style="margin-bottom:var(--space-4)">' +
                    '<span class="badge badge-' + s.status + '">' + (_statusLabels[s.status] || s.status) + '</span>' +
                    '<span>' + (_depthLabels[s.depth] || s.depth) + '</span>' +
                    '<span>\uC9C4\uD589\uB960: ' + (s.progress || 0) + '%</span>' +
                '</div>';

                if (s.summary) html += '<div class="detail-section"><h3>\uC694\uC57D</h3><p>' + _esc(s.summary) + '</p></div>';

                var findings = s.key_findings || [];
                if (findings.length) {
                    html += '<div class="detail-section"><h3>\uC8FC\uC694 \uBC1C\uACAC</h3><ul>' +
                        findings.map(function(f) { return '<li>' + _esc(f) + '</li>'; }).join('') +
                    '</ul></div>';
                }

                var sources = s.sources || [];
                if (sources.length) {
                    html += '<div class="detail-section"><h3>\uCD9C\uCC98</h3><ul>' +
                        sources.map(function(src) { return '<li>' + _esc(typeof src === 'string' ? src : JSON.stringify(src)) + '</li>'; }).join('') +
                    '</ul></div>';
                }

                if (steps.length) {
                    html += '<div class="detail-section"><h3>\uC5F0\uAD6C \uB2E8\uACC4</h3><div class="steps-timeline">';
                    html += steps.map(function(st) {
                        return '<div class="step-item">' +
                            '<span class="step-num">#' + st.step_number + '</span> <span class="step-type">' + _esc(st.step_type) + '</span>' +
                            (st.query ? '<div style="color:var(--text-secondary);margin-top:var(--space-1)">' + _esc(st.query) + '</div>' : '') +
                            (st.result ? '<div class="step-result">' + _esc(st.result) + '</div>' : '') +
                        '</div>';
                    }).join('');
                    html += '</div></div>';
                }

                if (dc) dc.innerHTML = html;
            });
        }).catch(function() {
            if (dc) dc.innerHTML = '<div class="empty-state"><p>\uB85C\uB4DC \uC2E4\uD328</p></div>';
        });
    }

    function _closeDetail() {
        var dm = document.getElementById('detailModal');
        if (dm) dm.classList.remove('open');
    }

    function _deleteSession() {
        if (!_currentSessionId || !confirm('\uC774 \uC5F0\uAD6C \uC138\uC158\uC744 \uC0AD\uC81C\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?')) return;
        _authFetch('/api/research/sessions/' + _currentSessionId, { method: 'DELETE' }).then(function() {
            _showToast('\uC138\uC158\uC774 \uC0AD\uC81C\uB418\uC5C8\uC2B5\uB2C8\uB2E4');
            _closeDetail();
            _loadSessions();
        }).catch(function() {
            _showToast('\uC0AD\uC81C \uC2E4\uD328', 'error');
        });
    }

    window.PageModules['research'] = {
        getHTML: function() {
            return '<div class="page-research">' +
                '<style data-spa-style="research">' +
                '.page-research .new-research { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); margin-bottom:var(--space-5); display:flex; gap:var(--space-3); align-items:flex-end; flex-wrap:wrap; }' +
                '.page-research .new-research .form-group { flex:1; min-width:200px; margin:0; }' +
                '.page-research .new-research label { display:block; margin-bottom:var(--space-2); color:var(--text-secondary); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }' +
                '.page-research .new-research input, .page-research .new-research select { width:100%; padding:var(--space-3); background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-md); color:var(--text-primary); box-sizing:border-box; }' +
                '.page-research .btn-primary { padding:var(--space-3) var(--space-5); background:var(--accent-primary); color:#fff; border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); white-space:nowrap; }' +
                '.page-research .session-list { display:flex; flex-direction:column; gap:var(--space-4); }' +
                '.page-research .session-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); cursor:pointer; transition:border-color .2s; }' +
                '.page-research .session-card:hover { border-color:var(--accent-primary); }' +
                '.page-research .session-card h3 { margin:0 0 var(--space-2); color:var(--text-primary); }' +
                '.page-research .session-meta { display:flex; gap:var(--space-3); align-items:center; flex-wrap:wrap; font-size:var(--font-size-sm); color:var(--text-muted); }' +
                '.page-research .badge { display:inline-block; padding:2px 10px; border-radius:var(--radius-md); font-size:11px; font-weight:var(--font-weight-semibold); }' +
                '.page-research .badge-pending { background:var(--bg-tertiary); color:var(--text-muted); }' +
                '.page-research .badge-running { background:var(--accent-primary); color:#fff; animation:researchPulse 1.5s infinite; }' +
                '.page-research .badge-completed { background:var(--success); color:#fff; }' +
                '.page-research .badge-failed { background:var(--danger); color:#fff; }' +
                '.page-research .badge-cancelled { background:var(--warning); color:#000; }' +
                '@keyframes researchPulse { 0%,100%{opacity:1} 50%{opacity:.6} }' +
                '.page-research .progress-bar { height:6px; background:var(--bg-tertiary); border-radius:3px; margin-top:var(--space-2); overflow:hidden; }' +
                '.page-research .progress-fill { height:100%; background:var(--accent-primary); border-radius:3px; transition:width .3s; }' +
                '.page-research .empty-state { text-align:center; padding:var(--space-8); color:var(--text-muted); }' +
                '.page-research .empty-state h2 { color:var(--text-secondary); margin-bottom:var(--space-3); }' +
                '.page-research .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:1000; justify-content:center; align-items:center; }' +
                '.page-research .modal-overlay.open { display:flex; }' +
                '.page-research .modal { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); width:90%; max-width:700px; max-height:90vh; overflow-y:auto; padding:var(--space-6); }' +
                '.page-research .modal h2 { margin:0 0 var(--space-4); color:var(--text-primary); }' +
                '.page-research .detail-section { margin-bottom:var(--space-5); }' +
                '.page-research .detail-section h3 { color:var(--text-secondary); font-size:var(--font-size-sm); margin-bottom:var(--space-2); text-transform:uppercase; letter-spacing:.5px; }' +
                '.page-research .detail-section p, .page-research .detail-section li { color:var(--text-primary); line-height:1.6; }' +
                '.page-research .detail-section ul { padding-left:var(--space-5); }' +
                '.page-research .steps-timeline { border-left:2px solid var(--border-light); padding-left:var(--space-5); }' +
                '.page-research .step-item { margin-bottom:var(--space-4); position:relative; }' +
                '.page-research .step-item::before { content:""; position:absolute; left:calc(-1 * var(--space-5) - 5px); top:4px; width:8px; height:8px; border-radius:50%; background:var(--accent-primary); }' +
                '.page-research .step-num { font-weight:var(--font-weight-semibold); color:var(--accent-primary); }' +
                '.page-research .step-type { background:var(--bg-tertiary); padding:2px 8px; border-radius:var(--radius-md); font-size:11px; color:var(--text-secondary); }' +
                '.page-research .step-result { background:var(--bg-secondary); padding:var(--space-3); border-radius:var(--radius-md); margin-top:var(--space-2); font-size:var(--font-size-sm); color:var(--text-secondary); max-height:120px; overflow-y:auto; white-space:pre-wrap; }' +
                '.page-research .modal-actions { display:flex; gap:var(--space-3); justify-content:flex-end; margin-top:var(--space-5); }' +
                '.page-research .modal-actions button { padding:var(--space-2) var(--space-4); border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }' +
                '.page-research .btn-secondary { background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-light) !important; }' +
                '.page-research .btn-danger { background:var(--danger); color:#fff; }' +
                '.page-research .toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }' +
                '.page-research .toast.show { opacity:1; }' +
                '.page-research .toast.success { background:var(--success); }' +
                '.page-research .toast.error { background:var(--danger); }' +
                '.page-research .loading { text-align:center; padding:var(--space-6); color:var(--text-muted); }' +
                '</style>' +
                '<header class="page-header">' +
                    '<h1>\uB525 \uB9AC\uC11C\uCE58</h1>' +
                '</header>' +
                '<div class="content-area">' +
                    '<div class="new-research">' +
                        '<div class="form-group" style="flex:3"><label>\uC5F0\uAD6C \uC8FC\uC81C</label><input type="text" id="topic" placeholder="\uC5F0\uAD6C\uD558\uACE0 \uC2F6\uC740 \uC8FC\uC81C\uB97C \uC785\uB825\uD558\uC138\uC694..."></div>' +
                        '<div class="form-group" style="flex:1"><label>\uAE4A\uC774</label>' +
                            '<select id="depth"><option value="quick">\uBE60\uB978 \uAC80\uC0C9</option><option value="standard" selected>\uD45C\uC900</option><option value="deep">\uC2EC\uCE35</option></select>' +
                        '</div>' +
                        '<button class="btn-primary" id="btnStartResearch">\uC5F0\uAD6C \uC2DC\uC791</button>' +
                    '</div>' +
                    '<div id="sessionList" class="session-list"><div class="loading">\uBD88\uB7EC\uC624\uB294 \uC911...</div></div>' +
                '</div>' +
                '<div class="modal-overlay" id="detailModal">' +
                    '<div class="modal">' +
                        '<h2 id="detailTitle">\uC5F0\uAD6C \uC0C1\uC138</h2>' +
                        '<div id="detailContent"></div>' +
                        '<div class="modal-actions">' +
                            '<button class="btn-secondary" id="btnCloseDetail">\uB2EB\uAE30</button>' +
                            '<button class="btn-danger" id="btnDeleteSession">\uC0AD\uC81C</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div id="research-toast" class="toast"></div>' +
            '</div>';
        },

        init: function() {
            _currentSessionId = null;

            // Start research button
            var btnStart = document.getElementById('btnStartResearch');
            if (btnStart) {
                var startHandler = function() { _createSession(); };
                btnStart.addEventListener('click', startHandler);
                _listeners.push({ el: btnStart, type: 'click', fn: startHandler });
            }

            // Enter key on topic input
            var topicInput = document.getElementById('topic');
            if (topicInput) {
                var keyHandler = function(e) { if (e.key === 'Enter') _createSession(); };
                topicInput.addEventListener('keydown', keyHandler);
                _listeners.push({ el: topicInput, type: 'keydown', fn: keyHandler });
            }

            // Session card clicks (delegated)
            var sessionList = document.getElementById('sessionList');
            if (sessionList) {
                var sessionClickHandler = function(e) {
                    var card = e.target.closest('.session-card');
                    if (card && card.dataset.sessionId) _openSession(card.dataset.sessionId);
                };
                sessionList.addEventListener('click', sessionClickHandler);
                _listeners.push({ el: sessionList, type: 'click', fn: sessionClickHandler });
            }

            // Detail modal buttons
            var btnClose = document.getElementById('btnCloseDetail');
            if (btnClose) {
                var closeHandler = function() { _closeDetail(); };
                btnClose.addEventListener('click', closeHandler);
                _listeners.push({ el: btnClose, type: 'click', fn: closeHandler });
            }

            var btnDelete = document.getElementById('btnDeleteSession');
            if (btnDelete) {
                var deleteHandler = function() { _deleteSession(); };
                btnDelete.addEventListener('click', deleteHandler);
                _listeners.push({ el: btnDelete, type: 'click', fn: deleteHandler });
            }

            // Load initial data
            _loadSessions();
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            _listeners.forEach(function(l) { l.el.removeEventListener(l.type, l.fn); });
            _listeners = [];
            _currentSessionId = null;
        }
    };
})();
