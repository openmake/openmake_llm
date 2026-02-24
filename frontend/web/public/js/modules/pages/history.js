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
(function () {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];

    window.PageModules['history'] = {
        getHTML: function () {
            return '<div class="page-history">' +
                '<style data-spa-style="history">' +
                ".session-card {\n            background: var(--bg-card);\n            border-radius: var(--radius-lg);\n            padding: var(--space-5);\n            border: 1px solid var(--border-light);\n            cursor: pointer;\n            transition: all 0.2s;\n            margin-bottom: var(--space-3);\n        }\n\n        .session-card:hover {\n            border-color: var(--accent-primary);\n        }\n\n        .session-header {\n            display: flex;\n            justify-content: space-between;\n            align-items: center;\n        }\n\n        .session-title {\n            font-weight: var(--font-weight-semibold);\n        }\n\n        .session-meta {\n            display: flex;\n            gap: var(--space-4);\n            font-size: var(--font-size-sm);\n            color: var(--text-muted);\n            margin-top: var(--space-2);\n        }\n\n        .session-preview {\n            margin-top: var(--space-3);\n            padding-top: var(--space-3);\n            border-top: 1px solid var(--border-light);\n            color: var(--text-muted);\n            font-size: var(--font-size-sm);\n            line-height: 1.5;\n        }\n\n        .messages-panel {\n            display: none;\n            margin-top: var(--space-4);\n            padding: var(--space-4);\n            background: var(--bg-secondary);\n            border-radius: var(--radius-md);\n        }\n\n        .messages-panel.show {\n            display: block;\n        }\n\n        .message {\n            padding: var(--space-3);\n            margin-bottom: var(--space-2);\n            border-radius: var(--radius-md);\n        }\n\n        .message.user {\n            background: var(--accent-primary-light);\n        }\n\n        .message.assistant {\n            background: var(--bg-tertiary);\n        }\n\n        .message-role {\n            font-size: var(--font-size-xs);\n            color: var(--text-muted);\n            margin-bottom: var(--space-1);\n            text-transform: uppercase;\n        }" +
                '<\/style>' +
                "<div class=\"page-content\">\n                <div class=\"container container-xl\">\n                    <header class=\"page-header\">\n                        <div>\n                            <h1 class=\"page-title page-title-gradient\">📜 대화 히스토리</h1>\n                            <p class=\"page-subtitle\">이전 대화 기록 조회</p>\n                        </div>\n                        <div class=\"page-actions\">\n                            <button class=\"btn btn-secondary\" onclick=\"exportHistory()\">📥 내보내기</button>\n                            <button class=\"btn btn-primary\" onclick=\"loadSessions()\">🔄 새로고침</button>\n                        </div>\n                    </header>\n\n                    <div class=\"search-bar\" style=\"margin-bottom: var(--space-6);\">\n                        <input type=\"date\" id=\"filterDate\" class=\"form-input\" style=\"width: auto;\"\n                            onchange=\"loadSessions()\">\n                        <input type=\"text\" id=\"searchQuery\" class=\"form-input\" style=\"max-width: 300px;\"\n                            placeholder=\"검색어 입력...\" onkeyup=\"debounceSearch()\">\n                        <select id=\"sortOrder\" class=\"form-select\" style=\"width: auto;\" onchange=\"loadSessions()\">\n                            <option value=\"desc\">최신순</option>\n                            <option value=\"asc\">오래된순</option>\n                        </select>\n                    </div>\n\n                    <div id=\"sessionsList\">\n                        <div class=\"empty-state\">\n                            <div class=\"empty-state-icon\">🔄</div>\n                            <div class=\"empty-state-title\">대화 기록을 불러오는 중...</div>\n                        </div>\n                    </div>\n                </div>\n            </div>\n\n<div id=\"toast\" class=\"toast\"></div>" +
                '<\/div>';
        },

        init: function () {
            try {

                let allSessions = [];
                let searchTimeout;
                // SafeStorage 래퍼 — Safari Private Mode 등에서 localStorage 예외 방지
                const SS = window.SafeStorage || { getItem: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, setItem: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } }, removeItem: function (k) { try { localStorage.removeItem(k); } catch (e) { } } };

                // 인증 체크
                (function checkAuthAccess() {
                    const user = SS.getItem('user');
                    const isGuest = SS.getItem('isGuest') === 'true';
                    if (!user || isGuest) {
                        (typeof showToast === 'function' ? showToast('이 페이지는 로그인이 필요합니다.', 'warning') : console.warn('이 페이지는 로그인이 필요합니다.'));
                        (typeof Router !== 'undefined' && Router.navigate('/'));
                    }
                })();

                async function loadSessions() {
                    const list = document.getElementById('sessionsList');
                    // 로딩 표시가 없으면 추가
                    if (!allSessions.length) {
                        list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔄</div><div class="empty-state-title">대화 기록을 불러오는 중...</div></div>';
                    }

                    try {
                        const res = await fetch('/api/chat/sessions?limit=100', {
                            credentials: 'include'  // 하이퍼투글 쿠키 기반 인증
                        });
                        if (!res.ok) throw new Error('서버 응답 오류: ' + res.status);
                        const data = await res.json();
                        const payload = data.data || data;

                        if (data.success) {
                            allSessions = payload.sessions;
                            renderSessions();
                        } else {
                            list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><div class="empty-state-title">데이터를 불러올 수 없습니다</div></div>';
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
                        list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-title">대화 기록이 없습니다</div></div>';
                        return;
                    }

                    list.innerHTML = filtered.map(s => `
                <div class="session-card" data-session-id="${s.id}">
                    <div class="session-header">
                        <span class="session-title">${escapeHtml(s.title || '\uC0C8 \uB300\uD654')}</span>
                        <span class="session-meta">${formatDate(s.updatedAt || s.createdAt)}</span>
                    </div>
                    <div class="session-meta">
                        <span>\uD83D\uDCAC ${escapeHtml(s.model || 'Unknown Model')}</span>
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
                    (typeof Router !== 'undefined' && Router.navigate('/'));
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
                        (typeof showToast === 'function' ? showToast('내보낼 데이터가 없습니다.', 'warning') : console.warn('내보낼 데이터가 없습니다.'));
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
})();
