/**
 * ============================================
 * Agent Tasks Page - 자율 에이전트 작업
 * ============================================
 * 목표를 입력하면 백그라운드에서 도구를 사용해 자율적으로 작업을 수행하는
 * SPA 페이지 모듈입니다. 실행은 연결과 분리된 백그라운드라 대화를 닫아도
 * 계속 진행되며, 진행상황을 polling 으로 갱신하고 taskId 로 다시 확인할 수 있습니다.
 *
 * @module pages/agent-tasks
 */
'use strict';
    window.PageModules = window.PageModules || {};

    // Module-scoped state
    var _intervals = [];
    var _listeners = [];
    var _currentTaskId = null;
    var _hasActive = false;
    var _notified = {};  // taskId → 완료 알림 중복 방지

    var _statusLabels = { pending:'대기중', running:'진행중', completed:'완료', failed:'실패', cancelled:'취소됨' };
    var _stepLabels = { plan:'📋 계획', assistant:'생각', assistant_tool_call:'도구 호출', tool_result:'도구 결과' };

    function _ep() { return (window.API_ENDPOINTS && window.API_ENDPOINTS.AGENT_TASKS) || '/api/agent-tasks'; }

    function _authFetch(url, options) {
        return window.authFetch(url, options || {}).then(function(r) { return r.json(); });
    }

    function _showToast(msg, type) {
        type = type || 'success';
        var t = document.getElementById('agent-tasks-toast');
        if (!t) return;
        t.textContent = msg;
        t.className = 'toast ' + type + ' show';
        setTimeout(function() { t.classList.remove('show'); }, 3000);
    }

    function _esc(s) {
        var d = document.createElement('div');
        d.textContent = (s === null || s === undefined) ? '' : String(s);
        return d.innerHTML;
    }

    function _loadTasks() {
        return _authFetch(_ep()).then(function(res) {
            var tasks = (res.data && res.data.tasks) || res.data || [];
            _hasActive = tasks.some(function(t) { return t.status === 'running' || t.status === 'pending'; });
            var el = document.getElementById('taskList');
            if (!el) return;
            if (!tasks.length) {
                el.innerHTML = '<div class="empty-state"><h2>작업이 없습니다</h2><p>위에서 목표를 입력하고 작업을 시작하세요.</p></div>';
                return;
            }
            el.innerHTML = tasks.map(function(t) {
                return '<div class="task-card" data-task-id="' + _esc(t.id) + '">' +
                    '<h3>' + _esc(t.goal) + '</h3>' +
                    '<div class="task-meta">' +
                        '<span class="badge badge-' + _esc(t.status) + '">' + (_statusLabels[t.status] || t.status) + '</span>' +
                        '<span>턴 ' + (t.current_turn || 0) + '/' + (t.max_turns || 0) + '</span>' +
                        '<span>' + new Date(t.created_at).toLocaleDateString('ko') + '</span>' +
                    '</div>' +
                    (t.progress > 0 ? '<div class="progress-bar"><div class="progress-fill" style="width:' + t.progress + '%"></div></div>' : '') +
                '</div>';
            }).join('');
        }).catch(function(e) {
            console.error('[AgentTasks] 목록 로드 실패:', e);
            _showToast('목록 로드 실패', 'error');
        });
    }

    function _createAndStart() {
        var goalEl = document.getElementById('goal');
        var goal = goalEl ? goalEl.value.trim() : '';
        if (!goal) { _showToast('목표를 입력하세요', 'error'); return; }
        // 완료 알림용 브라우저 권한 요청 + web push 구독 (사용자 제스처 컨텍스트)
        if (window.Notification) {
            if (Notification.permission === 'default') {
                try { Notification.requestPermission().then(function() { _ensurePushSubscription(); }); } catch (e) { /* noop */ }
            } else if (Notification.permission === 'granted') {
                _ensurePushSubscription();
            }
        }

        _authFetch(_ep(), {
            method: 'POST',
            body: JSON.stringify({ goal: goal })
        }).then(function(res) {
            var task = (res.data && res.data.task) || res.data;
            if (!task || !task.id) throw new Error('no task id');
            // 생성 직후 백그라운드 실행 시작 (detached — 응답 202 즉시 반환)
            return _authFetch(_ep() + '/' + task.id + '/execute', { method: 'POST' }).then(function() {
                if (goalEl) goalEl.value = '';
                _showToast('작업이 시작되었습니다. 창을 닫아도 계속 진행됩니다.');
                _loadTasks();
            });
        }).catch(function(e) {
            console.error('[AgentTasks] 생성/실행 실패:', e);
            _showToast('시작 실패', 'error');
        });
    }

    function _renderDetail(task, steps) {
        var dt = document.getElementById('detailTitle');
        if (dt) dt.textContent = task.goal;

        var html = '<div class="task-meta" style="margin-bottom:var(--space-4)">' +
            '<span class="badge badge-' + _esc(task.status) + '">' + (_statusLabels[task.status] || task.status) + '</span>' +
            '<span>턴 ' + (task.current_turn || 0) + '/' + (task.max_turns || 0) + '</span>' +
            '<span>진행률: ' + (task.progress || 0) + '%</span>' +
        '</div>';

        if (task.result) html += '<div class="detail-section"><h3>결과</h3><p style="white-space:pre-wrap">' + _esc(task.result) + '</p></div>';
        if (task.error) html += '<div class="detail-section"><h3>오류</h3><p class="err-text">' + _esc(task.error) + '</p></div>';

        if (steps && steps.length) {
            html += '<div class="detail-section"><h3>실행 단계</h3><div class="steps-timeline">';
            html += steps.map(function(st) {
                return '<div class="step-item">' +
                    '<span class="step-num">#' + st.step_number + '</span> ' +
                    '<span class="step-type">' + (_stepLabels[st.step_type] || _esc(st.step_type)) + '</span>' +
                    (st.tool_name ? ' <span class="step-tool">' + _esc(st.tool_name) + '</span>' : '') +
                    (st.content ? '<div class="step-result">' + _esc(st.content) + '</div>' : '') +
                '</div>';
            }).join('');
            html += '</div></div>';
        }

        var dc = document.getElementById('detailContent');
        if (dc) dc.innerHTML = html;

        // 취소 버튼은 진행 중일 때만, 이어하기 버튼은 중단된(resumable) 작업에만 노출
        var btnCancel = document.getElementById('btnCancelTask');
        if (btnCancel) btnCancel.style.display = (task.status === 'running' || task.status === 'pending') ? '' : 'none';
        var btnResume = document.getElementById('btnResumeTask');
        if (btnResume) btnResume.style.display = task.resumable ? '' : 'none';
    }

    function _openTask(id) {
        _currentTaskId = id;
        var dm = document.getElementById('detailModal');
        if (dm) dm.classList.add('open');
        var dc = document.getElementById('detailContent');
        if (dc) dc.innerHTML = '<div class="loading">불러오는 중...</div>';
        _refreshDetail();
    }

    function _refreshDetail() {
        if (!_currentTaskId) return Promise.resolve();
        return _authFetch(_ep() + '/' + _currentTaskId).then(function(res) {
            var data = res.data || res;
            var task = data.task || data;
            var steps = data.steps || [];
            _renderDetail(task, steps);
        }).catch(function(e) {
            console.error('[AgentTasks] 상세 로드 실패:', e);
            var dc = document.getElementById('detailContent');
            if (dc) dc.innerHTML = '<div class="empty-state"><p>로드 실패</p></div>';
        });
    }

    function _closeDetail() {
        var dm = document.getElementById('detailModal');
        if (dm) dm.classList.remove('open');
        _currentTaskId = null;
    }

    function _cancelTask() {
        if (!_currentTaskId) return;
        _authFetch(_ep() + '/' + _currentTaskId + '/cancel', { method: 'POST' }).then(function() {
            _showToast('작업 취소를 요청했습니다');
            _refreshDetail();
            _loadTasks();
        }).catch(function(e) {
            console.error('[AgentTasks] 취소 실패:', e);
            _showToast('취소 실패', 'error');
        });
    }

    function _resumeTask() {
        if (!_currentTaskId) return;
        _authFetch(_ep() + '/' + _currentTaskId + '/resume', { method: 'POST' }).then(function() {
            _showToast('작업을 이어서 시작했습니다');
            delete _notified[_currentTaskId];  // 재완료 시 다시 알림 허용
            _refreshDetail();
            _loadTasks();
        }).catch(function(e) {
            console.error('[AgentTasks] 이어하기 실패:', e);
            _showToast('이어하기 실패', 'error');
        });
    }

    function _deleteTask() {
        if (!_currentTaskId || !confirm('이 작업을 삭제하시겠습니까?')) return;
        _authFetch(_ep() + '/' + _currentTaskId, { method: 'DELETE' }).then(function() {
            _showToast('작업이 삭제되었습니다');
            _closeDetail();
            _loadTasks();
        }).catch(function(e) {
            console.error('[AgentTasks] 삭제 실패:', e);
            _showToast('삭제 실패', 'error');
        });
    }

    function _pollTick() {
        if (_hasActive) _loadTasks();
        var dm = document.getElementById('detailModal');
        if (_currentTaskId && dm && dm.classList.contains('open')) _refreshDetail();
    }

    // WS(agent_task_progress) 진행 이벤트로 카드를 GET 없이 in-place 갱신 (순수 overlay).
    // payload 에 status/progress/currentTurn 이 실려 있어 추가 API 호출 없이 반영한다.
    function _applyProgress(p) {
        if (!p || !p.taskId) return;
        var card = document.querySelector('.task-card[data-task-id="' + p.taskId + '"]');
        if (!card) { _loadTasks(); return; }  // 목록에 없는 새 작업 — 1회 재렌더
        var badge = card.querySelector('.badge');
        if (badge && p.status) {
            badge.className = 'badge badge-' + p.status;
            badge.textContent = _statusLabels[p.status] || p.status;
        }
        var spans = card.querySelectorAll('.task-meta span');
        if (spans[1] && p.currentTurn != null) {
            spans[1].textContent = spans[1].textContent.replace(/턴\s*\d+/, '턴 ' + p.currentTurn);
        }
        var bar = card.querySelector('.progress-fill');
        if (bar && p.progress != null) {
            bar.style.width = p.progress + '%';
        } else if (p.progress > 0) {
            _loadTasks();  // progress bar 미생성 상태 — 1회 재렌더로 생성
            return;
        }
        if (p.status === 'running' || p.status === 'pending') {
            _hasActive = true;
        } else {
            _notifyDone(p, card);  // 완료/실패/취소 — in-app 알림
        }
        // 상세 모달이 이 작업을 보고 있으면 스텝 갱신 (이벤트 시에만 GET)
        var dm = document.getElementById('detailModal');
        if (_currentTaskId === p.taskId && dm && dm.classList.contains('open')) _refreshDetail();
    }

    // 작업 종료 알림 — toast + (권한 허용 시) 브라우저 Notification. taskId 당 1회.
    function _notifyDone(p, card) {
        if (!p || !p.taskId || _notified[p.taskId]) return;
        _notified[p.taskId] = true;
        var labels = { completed:'완료', failed:'실패', cancelled:'취소' };
        var goal = card && card.querySelector('h3') ? card.querySelector('h3').textContent : '';
        var msg = '에이전트 작업이 ' + (labels[p.status] || p.status) + '되었습니다';
        _showToast(msg + (goal ? ': ' + goal : ''), p.status === 'failed' ? 'error' : 'success');
        if (window.Notification && Notification.permission === 'granted') {
            try { new Notification('OpenMake 에이전트 작업', { body: msg + (goal ? '\n' + goal : '') }); } catch (e) { /* noop */ }
        }
    }

    // web push 구독 (권한 허용 시 1회) — 페이지가 닫혀 있어도 완료 알림 수신
    function _ensurePushSubscription() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        if (!window.Notification || Notification.permission !== 'granted') return;
        navigator.serviceWorker.register('/push-sw.js').then(function(reg) {
            return reg.pushManager.getSubscription().then(function(existing) {
                if (existing) return existing;
                return _authFetch('/api/push/vapid-key').then(function(vres) {
                    var vapidKey = (vres.data && vres.data.publicKey) || vres.publicKey;
                    if (!vapidKey) throw new Error('no vapid key');
                    return reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: _urlB64ToUint8Array(vapidKey),
                    });
                });
            });
        }).then(function(sub) {
            if (!sub) return;
            var json = sub.toJSON();
            return _authFetch('/api/push/subscribe', {
                method: 'POST',
                body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
            });
        }).catch(function(e) { console.warn('[AgentTasks] push 구독 실패:', e); });
    }

    function _urlB64ToUint8Array(base64String) {
        var padding = '='.repeat((4 - base64String.length % 4) % 4);
        var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        var raw = atob(base64);
        var arr = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
        return arr;
    }

    window.PageModules['agent-tasks'] = {
        getHTML: function() {
            return '<div class="page-agent-tasks">' +
                '<style data-spa-style="agent-tasks">' +
                '.page-agent-tasks .new-task { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); margin-bottom:var(--space-5); display:flex; gap:var(--space-3); align-items:flex-end; flex-wrap:wrap; }' +
                '.page-agent-tasks .new-task .form-group { flex:1; min-width:200px; margin:0; }' +
                '.page-agent-tasks .new-task label { display:block; margin-bottom:var(--space-2); color:var(--text-secondary); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }' +
                '.page-agent-tasks .new-task textarea { width:100%; min-height:48px; padding:var(--space-3); background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-md); color:var(--text-primary); box-sizing:border-box; resize:vertical; font-family:inherit; }' +
                '.page-agent-tasks .btn-primary { padding:var(--space-3) var(--space-5); background:var(--accent-primary); color:#fff; border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); white-space:nowrap; }' +
                '.page-agent-tasks .task-list { display:flex; flex-direction:column; gap:var(--space-4); }' +
                '.page-agent-tasks .task-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); cursor:pointer; transition:border-color .2s; }' +
                '.page-agent-tasks .task-card:hover { border-color:var(--accent-primary); }' +
                '.page-agent-tasks .task-card h3 { margin:0 0 var(--space-2); color:var(--text-primary); font-size:var(--font-size-md); }' +
                '.page-agent-tasks .task-meta { display:flex; gap:var(--space-3); align-items:center; flex-wrap:wrap; font-size:var(--font-size-sm); color:var(--text-muted); }' +
                '.page-agent-tasks .badge { display:inline-block; padding:2px 10px; border-radius:var(--radius-md); font-size:11px; font-weight:var(--font-weight-semibold); }' +
                '.page-agent-tasks .badge-pending { background:var(--bg-tertiary); color:var(--text-muted); }' +
                '.page-agent-tasks .badge-running { background:var(--accent-primary); color:#fff; animation:agentPulse 1.5s infinite; }' +
                '.page-agent-tasks .badge-completed { background:var(--success); color:#fff; }' +
                '.page-agent-tasks .badge-failed { background:var(--danger); color:#fff; }' +
                '.page-agent-tasks .badge-cancelled { background:var(--warning); color:#000; }' +
                '@keyframes agentPulse { 0%,100%{opacity:1} 50%{opacity:.6} }' +
                '.page-agent-tasks .progress-bar { height:6px; background:var(--bg-tertiary); border-radius:3px; margin-top:var(--space-2); overflow:hidden; }' +
                '.page-agent-tasks .progress-fill { height:100%; background:var(--accent-primary); border-radius:3px; transition:width .3s; }' +
                '.page-agent-tasks .empty-state { text-align:center; padding:var(--space-8); color:var(--text-muted); }' +
                '.page-agent-tasks .empty-state h2 { color:var(--text-secondary); margin-bottom:var(--space-3); }' +
                '.page-agent-tasks .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:1000; justify-content:center; align-items:center; }' +
                '.page-agent-tasks .modal-overlay.open { display:flex; }' +
                '.page-agent-tasks .modal { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); width:90%; max-width:700px; max-height:90vh; overflow-y:auto; padding:var(--space-6); }' +
                '.page-agent-tasks .modal h2 { margin:0 0 var(--space-4); color:var(--text-primary); }' +
                '.page-agent-tasks .detail-section { margin-bottom:var(--space-5); }' +
                '.page-agent-tasks .detail-section h3 { color:var(--text-secondary); font-size:var(--font-size-sm); margin-bottom:var(--space-2); text-transform:uppercase; letter-spacing:.5px; }' +
                '.page-agent-tasks .detail-section p { color:var(--text-primary); line-height:1.6; }' +
                '.page-agent-tasks .err-text { color:var(--danger); }' +
                '.page-agent-tasks .steps-timeline { border-left:2px solid var(--border-light); padding-left:var(--space-5); }' +
                '.page-agent-tasks .step-item { margin-bottom:var(--space-4); position:relative; }' +
                '.page-agent-tasks .step-item::before { content:""; position:absolute; left:calc(-1 * var(--space-5) - 5px); top:4px; width:8px; height:8px; border-radius:50%; background:var(--accent-primary); }' +
                '.page-agent-tasks .step-num { font-weight:var(--font-weight-semibold); color:var(--accent-primary); }' +
                '.page-agent-tasks .step-type { background:var(--bg-tertiary); padding:2px 8px; border-radius:var(--radius-md); font-size:11px; color:var(--text-secondary); }' +
                '.page-agent-tasks .step-tool { background:var(--accent-primary); color:#fff; padding:2px 8px; border-radius:var(--radius-md); font-size:11px; }' +
                '.page-agent-tasks .step-result { background:var(--bg-secondary); padding:var(--space-3); border-radius:var(--radius-md); margin-top:var(--space-2); font-size:var(--font-size-sm); color:var(--text-secondary); max-height:160px; overflow-y:auto; white-space:pre-wrap; }' +
                '.page-agent-tasks .modal-actions { display:flex; gap:var(--space-3); justify-content:flex-end; margin-top:var(--space-5); }' +
                '.page-agent-tasks .modal-actions button { padding:var(--space-2) var(--space-4); border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }' +
                '.page-agent-tasks .btn-secondary { background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-light) !important; }' +
                '.page-agent-tasks .btn-warning { background:var(--warning); color:#000; }' +
                '.page-agent-tasks .btn-danger { background:var(--danger); color:#fff; }' +
                '.page-agent-tasks .toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }' +
                '.page-agent-tasks .toast.show { opacity:1; }' +
                '.page-agent-tasks .toast.success { background:var(--success); }' +
                '.page-agent-tasks .toast.error { background:var(--danger); }' +
                '.page-agent-tasks .loading { text-align:center; padding:var(--space-6); color:var(--text-muted); }' +
                '</style>' +
                '<header class="page-header">' +
                    '<h1>에이전트 작업</h1>' +
                '</header>' +
                '<div class="content-area">' +
                    '<div class="new-task">' +
                        '<div class="form-group" style="flex:4"><label for="goal">목표</label><textarea id="goal" placeholder="예: 최신 AI 에이전트 동향을 조사해서 요약해줘"></textarea></div>' +
                        '<button class="btn-primary" id="btnStartTask">작업 시작</button>' +
                    '</div>' +
                    '<div id="taskList" class="task-list"><div class="loading">불러오는 중...</div></div>' +
                '</div>' +
                '<div class="modal-overlay" id="detailModal">' +
                    '<div class="modal">' +
                        '<h2 id="detailTitle">작업 상세</h2>' +
                        '<div id="detailContent"></div>' +
                        '<div class="modal-actions">' +
                            '<button class="btn-secondary" id="btnCloseDetail">닫기</button>' +
                            '<button class="btn-primary" id="btnResumeTask" style="display:none">이어하기</button>' +
                            '<button class="btn-warning" id="btnCancelTask">중단</button>' +
                            '<button class="btn-danger" id="btnDeleteTask">삭제</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div id="agent-tasks-toast" class="toast"></div>' +
            '</div>';
        },

        init: function() {
            _currentTaskId = null;
            _hasActive = false;

            var btnStart = document.getElementById('btnStartTask');
            if (btnStart) {
                var startHandler = function() { _createAndStart(); };
                btnStart.addEventListener('click', startHandler);
                _listeners.push({ el: btnStart, type: 'click', fn: startHandler });
            }

            var goalInput = document.getElementById('goal');
            if (goalInput) {
                var keyHandler = function(e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) _createAndStart(); };
                goalInput.addEventListener('keydown', keyHandler);
                _listeners.push({ el: goalInput, type: 'keydown', fn: keyHandler });
            }

            var taskList = document.getElementById('taskList');
            if (taskList) {
                var cardClickHandler = function(e) {
                    var card = e.target.closest('.task-card');
                    if (card && card.dataset.taskId) _openTask(card.dataset.taskId);
                };
                taskList.addEventListener('click', cardClickHandler);
                _listeners.push({ el: taskList, type: 'click', fn: cardClickHandler });
            }

            var btnClose = document.getElementById('btnCloseDetail');
            if (btnClose) {
                var closeHandler = function() { _closeDetail(); };
                btnClose.addEventListener('click', closeHandler);
                _listeners.push({ el: btnClose, type: 'click', fn: closeHandler });
            }

            var btnCancel = document.getElementById('btnCancelTask');
            if (btnCancel) {
                var cancelHandler = function() { _cancelTask(); };
                btnCancel.addEventListener('click', cancelHandler);
                _listeners.push({ el: btnCancel, type: 'click', fn: cancelHandler });
            }

            var btnResume = document.getElementById('btnResumeTask');
            if (btnResume) {
                var resumeHandler = function() { _resumeTask(); };
                btnResume.addEventListener('click', resumeHandler);
                _listeners.push({ el: btnResume, type: 'click', fn: resumeHandler });
            }

            var btnDelete = document.getElementById('btnDeleteTask');
            if (btnDelete) {
                var deleteHandler = function() { _deleteTask(); };
                btnDelete.addEventListener('click', deleteHandler);
                _listeners.push({ el: btnDelete, type: 'click', fn: deleteHandler });
            }

            _loadTasks();
            // WS(agent_task_progress)가 실시간 갱신을 담당 — polling 은 느린 safety net(25s).
            // WS 미수신(연결 끊김 등) 시 복구용. DB 가 진실의 원천(DB-primary).
            window.onAgentTaskProgress = _applyProgress;
            _intervals.push(setInterval(_pollTick, 25000));
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            _listeners.forEach(function(l) { l.el.removeEventListener(l.type, l.fn); });
            _listeners = [];
            window.onAgentTaskProgress = null;
            _currentTaskId = null;
            _hasActive = false;
            _notified = {};
        }
    };

const { getHTML, init, cleanup } = window.PageModules['agent-tasks'];
export default { getHTML, init, cleanup };
