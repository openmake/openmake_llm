/**
 * ============================================
 * History Page - 대화 기록 관리
 * ============================================
 * 사용자의 과거 대화 세션 목록을 조회하고,
 * 세션 선택/삭제, 대화 내용 확인, 세션 이어가기 등
 * 대화 기록 관리 기능을 제공하는 SPA 페이지 모듈입니다.
 *
 * @module pages/history
 */
'use strict';
    var SK = window.STORAGE_KEYS || {};
    window.PageModules = window.PageModules || {};
    let _intervals = [];
    let _timeouts = [];

    window.PageModules['history'] = {
        getHTML: function () {
            return '<div class="page-history">' +
                '<style data-spa-style="history">' +
                /* ── History — Graphite & Ember II (Archetype B) ── */
                /* 세션 카드 — .gc 패턴: bg-card, border-light, r-lg, hover translateY + shadow-md */
                ".session-card{background:var(--bg-card);border-radius:var(--radius-lg);padding:var(--space-5);border:1px solid var(--border-light);cursor:pointer;transition:transform .2s,box-shadow .2s,border-color .2s;margin-bottom:var(--space-3);}" +
                ".session-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-md,0 4px 16px -4px rgba(0,0,0,.45));border-color:var(--border-strong,var(--accent-primary));}" +
                ".session-header{display:flex;justify-content:space-between;align-items:center;}" +
                ".session-title{font-weight:600;font-size:var(--font-size-base);color:var(--text-primary);}" +
                /* 메타 — mono 10px faint, .gm 패턴 */
                ".session-meta{display:flex;gap:var(--space-4);font-family:var(--font-mono);font-size:10px;color:var(--text-faint,var(--text-muted));margin-top:var(--space-2);}" +
                /* 미리보기 — .gd 패턴 */
                ".session-preview{margin-top:var(--space-3);padding-top:var(--space-3);border-top:1px solid var(--border-light);color:var(--text-secondary);font-size:12.5px;line-height:1.55;}" +
                ".messages-panel{display:none;margin-top:var(--space-4);padding:var(--space-4);background:var(--bg-sidebar,var(--bg-secondary));border-radius:var(--radius-md);}" +
                ".messages-panel.show{display:block;}" +
                ".message{padding:var(--space-3);margin-bottom:var(--space-2);border-radius:var(--radius-md);}" +
                ".message.user{background:var(--ember-soft,rgba(255,106,61,.13));border:1px solid var(--ember-line,rgba(255,106,61,.32));}" +
                ".message.assistant{background:var(--bg-tertiary);border:1px solid var(--border-light);}" +
                /* 역할 레이블 — mono uppercase faint */
                ".message-role{font-family:var(--font-mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-faint,var(--text-muted));margin-bottom:var(--space-1);}" +
                /* 검색 입력 — .search 패턴 */
                ".page-history .form-input,.page-history .form-select{background:var(--bg-sidebar,var(--bg-secondary));border:1px solid var(--border-strong,var(--border-light));border-radius:var(--radius-sm,8px);padding:var(--space-2) var(--space-3);color:var(--text-primary);font-size:var(--font-size-sm);}" +
                ".page-history .form-input:focus,.page-history .form-select:focus{outline:none;border-color:var(--accent-primary);}" +
                '<\/style>' +
                "<div class=\"page-content\">\n                <div class=\"container container-xl\">\n                    <header class=\"page-header\">\n                        <div>\n                            <h1 class=\"page-title page-title-gradient\"><iconify-icon icon=lucide:scroll-text></iconify-icon> 대화 히스토리</h1>\n                            <p class=\"page-subtitle\">이전 대화 기록 조회</p>\n                        </div>\n                        <div class=\"page-actions\">\n                            <button class=\"btn btn-secondary\" onclick=\"exportHistory()\"><iconify-icon icon=lucide:download></iconify-icon> 내보내기</button>\n                            <button class=\"btn btn-primary\" onclick=\"loadSessions()\"><iconify-icon icon=lucide:refresh-cw></iconify-icon> 새로고침</button>\n                        </div>\n                    </header>\n\n                    <div class=\"search-bar\" style=\"margin-bottom: var(--space-6);\">\n                        <input type=\"date\" id=\"filterDate\" class=\"form-input\" style=\"width: auto;\"\n                            onchange=\"loadSessions()\">\n                        <input type=\"text\" id=\"searchQuery\" class=\"form-input\" style=\"max-width: 300px;\"\n                            placeholder=\"검색어 입력...\" onkeyup=\"debounceSearch()\">\n                        <select id=\"sortOrder\" class=\"form-select\" style=\"width: auto;\" onchange=\"loadSessions()\">\n                            <option value=\"desc\">최신순</option>\n                            <option value=\"asc\">오래된순</option>\n                        </select>\n                    </div>\n\n                    <div id=\"sessionsList\">\n                        <div class=\"empty-state\">\n                            <div class=\"empty-state-icon\"><iconify-icon icon=lucide:refresh-cw></iconify-icon></div>\n                            <div class=\"empty-state-title\">대화 기록을 불러오는 중...</div>\n                        </div>\n                    </div>\n                </div>\n            </div>\n\n<div id=\"toast\" class=\"toast\"></div>" +
                '<\/div>';
        },

        init: function () {
            try {

                let allSessions = [];
                let searchTimeout;
                // SafeStorage 래퍼 — safe-storage.js에서 전역 등록됨
                const SS = window.SafeStorage;

                // 인증 체크
                (function checkAuthAccess() {
                    const user = SS.getItem(SK.USER || 'user');
                    const isGuest = SS.getItem(SK.IS_GUEST || 'isGuest') === 'true';
                    if (!user || isGuest) {
                        if (typeof showToast === 'function') showToast('이 페이지는 로그인이 필요합니다.', 'warning');
                        else console.warn('이 페이지는 로그인이 필요합니다.');
                        if (typeof Router !== 'undefined') Router.navigate('/');
                    }
                })();

                async function loadSessions() {
                    const list = document.getElementById('sessionsList');
                    // 로딩 표시가 없으면 추가
                    if (!allSessions.length) {
                        list.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><iconify-icon icon=lucide:refresh-cw></iconify-icon></div><div class="empty-state-title">대화 기록을 불러오는 중...</div></div>';
                    }

                    try {
                        const res = await window.ApiClient.raw(API_ENDPOINTS.CHAT_SESSIONS + '?limit=100');
                        if (!res.ok) throw new Error('서버 응답 오류: ' + res.status);
                        const data = await res.json();
                        const payload = data.data || data;

                        if (data.success) {
                            allSessions = payload.sessions;
                            renderSessions();
                        } else {
                            list.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><iconify-icon icon=lucide:search-x></iconify-icon></div><div class="empty-state-title">데이터를 불러올 수 없습니다</div></div>';
                        }
                    } catch (e) {
                        console.error('세션 로드 실패:', e);
                        list.innerHTML = '<div class="empty-state"><div class="empty-state-title">서버 연결 오류</div></div>';
                    }
                }

                function renderSessions() {
                    const list = document.getElementById('sessionsList');
                    const query = document.getElementById('searchQuery').value.toLowerCase();
                    const dateFilter = document.getElementById('filterDate').value;
                    const sortOrder = document.getElementById('sortOrder').value; // 'desc' or 'asc'

                    let filtered = allSessions.filter(s => {
                        // 검색 필터 (제목)
                        if (query && !(s.title || '').toLowerCase().includes(query)) return false;
                        // 날짜 필터
                        if (dateFilter) {
                            const sDate = new Date(s.createdAt).toISOString().split('T')[0];
                            if (sDate !== dateFilter) return false;
                        }
                        return true;
                    });

                    // 정렬
                    filtered.sort((a, b) => {
                        const timeA = new Date(a.updatedAt || a.createdAt).getTime();
                        const timeB = new Date(b.updatedAt || b.createdAt).getTime();
                        return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
                    });

                    if (filtered.length === 0) {
                        list.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><iconify-icon icon=lucide:inbox></iconify-icon></div><div class="empty-state-title">대화 기록이 없습니다</div></div>';
                        return;
                    }

                    list.innerHTML = filtered.map(s => `
                <div class="session-card" data-session-id="${s.id}">
                    <div class="session-header">
                        <span class="session-title">${escapeHtml(s.title || '\uC0C8 \uB300\uD654')}</span>
                        <span class="session-meta">${formatDate(s.updatedAt || s.createdAt)}</span>
                    </div>
                    <div class="session-meta">
                        <span><iconify-icon icon=lucide:message-square></iconify-icon> ${escapeHtml(s.model || 'Unknown Model')}</span>
                    </div>
                    ${s.preview ? `<div class="session-preview">${escapeHtml(s.preview)}</div>` : ''}
                </div>
            `).join('');
                    list.onclick = function(e) {
                        var card = e.target.closest('[data-session-id]');
                        if (card) { goToSession(card.dataset.sessionId); }
                    };
                }

                function goToSession(id) {
                    // 메인 채팅 화면으로 이동하며 세션 ID 전달
                    // Router.navigate strips query strings via normalizePath, so use sessionStorage
                    sessionStorage.setItem('pendingSessionId', id);
                    if (typeof Router !== 'undefined') Router.navigate('/');
                }

                function formatDate(dateStr) {
                    const date = new Date(dateStr);
                    return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                }

                function escapeHtml(text) {
                    if (!text) return '';
                    return text
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;")
                        .replace(/"/g, "&quot;")
                        .replace(/'/g, "&#039;");
                }

                function debounceSearch() {
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(renderSessions, 300); // API 재호출 대신 렌더링만 갱신
                }

                function exportHistory() {
                    if (allSessions.length === 0) {
                        if (typeof showToast === 'function') showToast('내보낼 데이터가 없습니다.', 'warning');
                        else console.warn('내보낼 데이터가 없습니다.');
                        return;
                    }
                    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allSessions, null, 2));
                    const downloadAnchorNode = document.createElement('a');
                    downloadAnchorNode.setAttribute("href", dataStr);
                    downloadAnchorNode.setAttribute("download", "chat_history.json");
                    document.body.appendChild(downloadAnchorNode);
                    downloadAnchorNode.click();
                    downloadAnchorNode.remove();
                }

                loadSessions();

                // Expose onclick-referenced functions globally
                if (typeof exportHistory === 'function') window.exportHistory = exportHistory;
                if (typeof loadSessions === 'function') window.loadSessions = loadSessions;
                if (typeof goToSession === 'function') window.goToSession = goToSession;
            } catch (e) {
                console.error('[PageModule:history] init error:', e);
            }
        },

        cleanup: function () {
            _intervals.forEach(function (id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function (id) { clearTimeout(id); });
            _timeouts = [];
            // Remove onclick-exposed globals
            try { delete window.exportHistory; } catch (e) { }
            try { delete window.loadSessions; } catch (e) { }
            try { delete window.goToSession; } catch (e) { }
        }
    };

const { getHTML, init, cleanup } = window.PageModules['history'];
export default { getHTML, init, cleanup };
