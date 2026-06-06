/**
 * ============================================
 * Admin Page - 관리자 대시보드
 * ============================================
 * 사용자 관리(CRUD), 대화 기록 조회/내보내기, 사용 통계 등
 * 관리자 전용 기능을 제공하는 SPA 페이지 모듈입니다.
 * 관리자 인증 검증 후 탭 기반 UI로 각 기능에 접근합니다.
 *
 * @module pages/admin
 */
'use strict';
    var SK = window.STORAGE_KEYS || {};
    window.PageModules = window.PageModules || {};
    /** @type {number[]} setInterval ID 배열 (cleanup용) */
    let _intervals = [];
    /** @type {number[]} setTimeout ID 배열 (cleanup용) */
    let _timeouts = [];
    /** @type {{target:EventTarget,event:string,handler:EventListener}[]} 인라인 핸들러 대체 DOM 리스너 (cleanup용) */
    let _domListeners = [];

    window.PageModules['admin'] = {
        /**
         * 페이지 HTML 문자열 반환
         * @returns {string} 관리자 대시보드 HTML (스타일 포함)
         */
        getHTML: function () {
            return '<div class="page-admin">' +
                '<style data-spa-style="admin">' +
                "/* Admin-specific styles */\n        .badge-admin {\n            background: var(--bg-tertiary);\n            color: #f87171;\n            border: 2px solid #ef4444;\n        }\n\n        .badge-user {\n            background: var(--bg-tertiary);\n            color: #4ade80;\n            border: 2px solid #22c55e;\n        }\n\n        .badge-guest {\n            background: var(--bg-tertiary);\n            color: #9ca3af;\n            border: 2px solid #9ca3af;\n        }\n\n        .badge-active {\n            background: var(--success-light);\n            color: var(--success);\n        }\n\n        .badge-inactive {\n            background: var(--danger-light);\n            color: var(--danger);\n        }\n\n        .badge-info, .badge-assistant {\n            background: var(--bg-tertiary);\n            color: #60a5fa;\n            border: 2px solid #3b82f6;\n        }\n\n        .badge-system {\n            background: var(--bg-tertiary);\n            color: #a78bfa;\n            border: 2px solid #7c3aed;\n        }\n\n        .toast {\n            position: fixed;\n            bottom: 20px;\n            right: 20px;\n            padding: 12px 20px;\n            border-radius: var(--radius-md);\n            color: white;\n            font-size: var(--font-size-sm);\n            z-index: 1001;\n            animation: slideIn 0.3s ease;\n        }\n\n        .toast.success {\n            background: var(--success);\n        }\n\n        .toast.error {\n            background: var(--danger);\n        }\n\n        @keyframes slideIn {\n            from {\n                transform: translateX(100%);\n                opacity: 0;\n            }\n\n            to {\n                transform: translateX(0);\n                opacity: 1;\n            }\n        }" +
                '<\/style>' +
                "<div class=\"page-content\">\n                <div class=\"container container-xl\">\n                    <header class=\"page-header\">\n                        <div>\n                            <h1 class=\"page-title page-title-gradient\">관리자 대시보드</h1>\n                            <p class=\"page-subtitle\">사용자 및 대화 관리</p>\n                        </div>\n                        <div class=\"page-actions\">\n                            <a href=\"/\" class=\"btn btn-secondary\">← 채팅으로 돌아가기</a>\n                        </div>\n                    </header>\n\n                    <nav class=\"admin-section-tabs\" role=\"tablist\" aria-label=\"Admin sections\">\n                        <button class=\"admin-section-tab active\" data-section-tab=\"users\" role=\"tab\"><iconify-icon icon=\"lucide:users\"></iconify-icon> 사용자</button>\n                        <button class=\"admin-section-tab\" data-section-tab=\"metrics\" role=\"tab\"><iconify-icon icon=\"lucide:gauge\"></iconify-icon> 통합 모니터링</button>\n                        <button class=\"admin-section-tab\" data-section-tab=\"audit\" role=\"tab\"><iconify-icon icon=\"lucide:clipboard-list\"></iconify-icon> 감사 로그</button>\n                        <button class=\"admin-section-tab\" data-section-tab=\"analytics\" role=\"tab\"><iconify-icon icon=\"lucide:bar-chart-3\"></iconify-icon> 분석</button>\n                        <button class=\"admin-section-tab\" data-section-tab=\"alerts\" role=\"tab\"><iconify-icon icon=\"lucide:bell\"></iconify-icon> 알림</button>\n                        <button class=\"admin-section-tab\" data-section-tab=\"mcp-catalog\" role=\"tab\"><iconify-icon icon=\"lucide:server-cog\"></iconify-icon> MCP 카탈로그</button>\n                        <button class=\"admin-section-tab\" data-section-tab=\"mcp-monitoring\" role=\"tab\"><iconify-icon icon=\"lucide:activity\"></iconify-icon> MCP 모니터링</button>\n                    </nav>\n\n                    <!-- Native users section (default) — metrics/audit/analytics/alerts/tokens 탭 선택 시 hidden -->\n                    <section id=\"adminNativeSection\" data-section-content=\"users\">\n                    <div class=\"tabs\" style=\"margin-bottom: var(--space-6); width: fit-content;\">\n                        <button class=\"tab active\" data-action=\"switch-tab\" data-tab=\"users\"><iconify-icon icon=\"lucide:users\"></iconify-icon> 사용자 관리</button>\n                        <button class=\"tab\" data-action=\"switch-tab\" data-tab=\"conversations\"><iconify-icon icon=\"lucide:message-square\"></iconify-icon> 대화 기록</button>\n                        <button class=\"tab\" data-action=\"switch-tab\" data-tab=\"guardian\"><iconify-icon icon=\"lucide:shield\"></iconify-icon> 14세 미만 동의 보류</button>\n                    </div>\n\n                    <!-- Stats Cards -->\n                    <div id=\"userStatsCards\" class=\"dashboard-grid\" style=\"margin-bottom: var(--space-8);\">\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-value\" id=\"statTotalUsers\">0</div>\n                            <div class=\"text-muted text-sm\">총 사용자</div>\n                        </div>\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-value\" id=\"statActiveUsers\">0</div>\n                            <div class=\"text-muted text-sm\">활성 사용자</div>\n                        </div>\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-value\" id=\"statAdmins\">0</div>\n                            <div class=\"text-muted text-sm\">관리자</div>\n                        </div>\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-value\" id=\"statTodayQueries\">0</div>\n                            <div class=\"text-muted text-sm\">오늘 질문</div>\n                        </div>\n                    </div>\n\n                    <!-- Users Panel -->\n                    <div id=\"usersPanel\" class=\"panel active\">\n                        <div class=\"card\">\n                            <div class=\"card-header\">\n                                <span class=\"card-title\">사용자 목록</span>\n                                <button class=\"btn btn-primary btn-sm\" data-action=\"add-user\">+ 사용자 추가</button>\n                            </div>\n                            <div class=\"search-bar\" style=\"margin-bottom: var(--space-4);\">\n                                <select id=\"filterRole\" class=\"form-select\" style=\"width: auto;\">\n                                    <option value=\"\">모든 역할</option>\n                                    <option value=\"admin\">관리자</option>\n                                    <option value=\"user\">일반 사용자</option>\n                                    <option value=\"guest\">게스트</option>\n                                </select>\n                                <input type=\"text\" id=\"filterSearch\" class=\"form-input\" style=\"max-width: 300px;\"\n                                    placeholder=\"이메일 검색...\">\n                            </div>\n                            <div class=\"table-container\" style=\"border: none;\">\n                                <table class=\"data-table\">\n                                    <thead>\n                                        <tr>\n                                            <th>ID</th>\n                                            <th>이메일</th>\n                                            <th>역할</th>\n                                            <th>상태</th>\n                                            <th>가입일</th>\n                                            <th>마지막 로그인</th>\n                                            <th>작업</th>\n                                        </tr>\n                                    </thead>\n                                    <tbody id=\"usersList\"></tbody>\n                                </table>\n                            </div>\n                            <div class=\"pagination flex justify-center gap-2 mt-4\" id=\"usersPagination\"></div>\n                        </div>\n                    </div>\n\n                    <!-- Conversations Panel -->\n                    <div id=\"conversationsPanel\" class=\"panel\" style=\"display: none;\">\n                        <div class=\"card\">\n                            <div class=\"card-header\">\n                                <span class=\"card-title\">대화 기록</span>\n                                <button class=\"btn btn-secondary btn-sm\" data-action=\"export-csv\"><iconify-icon icon=lucide:download></iconify-icon> CSV 내보내기</button>\n                            </div>\n                            <div class=\"search-bar\" style=\"margin-bottom: var(--space-4);\">\n                                <label class=\"text-muted text-sm\" for=\"filterStartDate\" style=\"margin-right: 4px;\">시작:</label>\n                                <input type=\"date\" id=\"filterStartDate\" class=\"form-input\" style=\"width: auto;\"\n                                   >\n                                <span class=\"text-muted text-sm\" style=\"margin: 0 8px;\">~</span>\n                                <input type=\"date\" id=\"filterEndDate\" class=\"form-input\" style=\"width: auto;\"\n                                   >\n                                <select id=\"filterConvRole\" class=\"form-select\" style=\"width: auto;\"\n                                   >\n                                    <option value=\"\">모든 역할</option>\n                                    <option value=\"user\">사용자만</option>\n                                    <option value=\"assistant\">AI 응답만</option>\n                                </select>\n                                <input type=\"text\" id=\"filterConvSearch\" class=\"form-input\" style=\"max-width: 300px;\"\n                                    placeholder=\"검색어...\">\n                            </div>\n                            <div class=\"table-container\" style=\"border: none;\">\n                                <table class=\"data-table\">\n                                    <thead>\n                                        <tr>\n                                            <th>시간</th>\n                                            <th>사용자</th>\n                                            <th>역할</th>\n                                            <th>내용</th>\n                                            <th>모델</th>\n                                        </tr>\n                                    </thead>\n                                    <tbody id=\"conversationsList\"></tbody>\n                                </table>\n                            </div>\n                            <div class=\"pagination flex justify-center gap-2 mt-4\" id=\"convPagination\"></div>\n                        </div>\n                    </div>\n\n                    <!-- GDPR Phase D — Guardian Consent Pending Panel -->\n                    <div id=\"guardianPanel\" class=\"panel\" style=\"display: none;\">\n                        <div class=\"card\">\n                            <div class=\"card-header\">\n                                <span class=\"card-title\"><iconify-icon icon=lucide:shield></iconify-icon> 14세 미만 동의 보류 (GDPR Article 8 / 정통망법 §31)</span>\n                                <button class=\"btn btn-secondary btn-sm\" data-action=\"reload-guardian\"><iconify-icon icon=lucide:refresh-cw></iconify-icon> 새로고침</button>\n                            </div>\n                            <p class=\"text-muted text-sm\" style=\"margin: 0 0 var(--space-3) 0;\">\n                                미성년자 가입 후 활성화 대기 중인 사용자. 법정대리인 이메일로 확인 후 승인/거부.\n                            </p>\n                            <div class=\"table-container\" style=\"border: none;\">\n                                <table class=\"data-table\">\n                                    <thead>\n                                        <tr>\n                                            <th>가입일</th>\n                                            <th>사용자명</th>\n                                            <th>이메일</th>\n                                            <th>생년월일</th>\n                                            <th>법정대리인 이메일</th>\n                                            <th>작업</th>\n                                        </tr>\n                                    </thead>\n                                    <tbody id=\"guardianList\"></tbody>\n                                </table>\n                            </div>\n                        </div>\n                    </div>\n\n                    </section>\n\n                    <!-- SPA sub-panel slots (lazy-load on tab click) -->\n                    <div class=\"admin-sub-panel\" data-section-content=\"metrics\" style=\"display:none;\"></div>\n                    <div class=\"admin-sub-panel\" data-section-content=\"audit\" style=\"display:none;\"></div>\n                    <div class=\"admin-sub-panel\" data-section-content=\"analytics\" style=\"display:none;\"></div>\n                    <div class=\"admin-sub-panel\" data-section-content=\"alerts\" style=\"display:none;\"></div>\n                    <div class=\"admin-sub-panel\" data-section-content=\"mcp-catalog\" style=\"display:none;\"></div>\n                    <div class=\"admin-sub-panel\" data-section-content=\"mcp-monitoring\" style=\"display:none;\"></div>\n                </div>\n            </div>\n<div class=\"modal-overlay\" id=\"editUserModal\">\n        <div class=\"modal-content\">\n            <div class=\"modal-header\">\n                <h3 class=\"modal-title\" id=\"editModalTitle\">사용자 편집</h3>\n                <button class=\"modal-close\" data-action=\"close-edit-modal\">×</button>\n            </div>\n            <form id=\"editUserForm\" class=\"modal-body\">\n                <input type=\"hidden\" id=\"editUserId\">\n                <div class=\"form-group\">\n                    <label class=\"form-label\" for=\"editEmail\">이메일</label>\n                    <input type=\"email\" id=\"editEmail\" class=\"form-input\">\n                </div>\n                <div class=\"form-group\">\n                    <label class=\"form-label\" for=\"editPassword\">비밀번호 (변경 시에만 입력)</label>\n                    <input type=\"password\" id=\"editPassword\" class=\"form-input\" placeholder=\"새 비밀번호\" autocomplete=\"new-password\">\n                </div>\n                <div class=\"form-group\">\n                    <label class=\"form-label\" for=\"editRole\">역할</label>\n                    <select id=\"editRole\" class=\"form-select\">\n                        <option value=\"user\">일반 사용자</option>\n                        <option value=\"admin\">관리자</option>\n                        <option value=\"guest\">게스트</option>\n                    </select>\n                </div>\n                <div class=\"form-group\">\n                    <label class=\"form-label\" for=\"editActive\">상태</label>\n                    <select id=\"editActive\" class=\"form-select\">\n                        <option value=\"1\">활성</option>\n                        <option value=\"0\">비활성</option>\n                    </select>\n                </div>\n            </form>\n            <div class=\"modal-footer\">\n                <button class=\"btn btn-secondary\" data-action=\"close-edit-modal\">취소</button>\n                <button class=\"btn btn-primary\" data-action=\"save-user\">저장</button>\n            </div>\n        </div>\n    </div>\n<div class=\"modal-overlay\" id=\"deleteUserModal\">\n        <div class=\"modal-content\">\n            <div class=\"modal-header\">\n                <h3 class=\"modal-title\"><iconify-icon icon=lucide:alert-triangle></iconify-icon> 사용자 삭제 — GDPR 영향 안내</h3>\n                <button class=\"modal-close\" data-action=\"close-delete-modal\">×</button>\n            </div>\n            <div class=\"modal-body\">\n                <p style=\"margin-bottom: 8px;\">아래 데이터가 처리됩니다:</p>\n                <ul style=\"margin: 8px 0 12px 0; padding-left: 20px; line-height: 1.6;\">\n                    <li><strong>즉시 삭제 (12개):</strong> 커스텀 에이전트, 스킬, 대화 세션, 메모리, API 키, MCP 서버, push 구독 등</li>\n                    <li><strong>작성자 익명화 (3개):</strong>\n                        <ul style=\"padding-left: 18px;\">\n                            <li>감사 로그, 메시지 피드백 — 감사 추적 보존</li>\n                            <li>Skill manifest — <strong>is_public 자동 false 처리</strong> (다른 사용자 접근 차단)</li>\n                        </ul>\n                    </li>\n                    <li><strong>보호 (6개):</strong> agent_feedback, agent_installations, agent_marketplace, agent_reviews, agent_usage_logs, canvas_documents\n                        <br><span class=\"text-muted text-sm\">→ 위 데이터가 있으면 삭제 차단 (사전 정리 필요)</span></li>\n                </ul>\n                <p class=\"text-muted text-sm\" style=\"margin-bottom: 12px;\">※ 자기 자신/마지막 관리자는 삭제할 수 없습니다.</p>\n                <div class=\"form-group\">\n                    <label class=\"form-label\" for=\"deleteUserConfirmInput\">확인을 위해 사용자 이메일을 정확히 입력하세요:</label>\n                    <div class=\"text-muted text-sm\" style=\"margin: 4px 0;\">대상: <strong id=\"deleteUserTargetEmail\"></strong></div>\n                    <input type=\"hidden\" id=\"deleteUserTargetId\">\n                    <input type=\"email\" id=\"deleteUserConfirmInput\" class=\"form-input\" placeholder=\"user@example.com\" autocomplete=\"off\">\n                </div>\n            </div>\n            <div class=\"modal-footer\">\n                <button class=\"btn btn-secondary\" data-action=\"close-delete-modal\">취소</button>\n                <button class=\"btn btn-danger\" data-action=\"confirm-delete\">삭제 진행</button>\n            </div>\n        </div>\n    </div>\n<div id=\"toast\" class=\"toast\"></div>" +
                '<\/div>';
        },

        /**
         * 페이지 초기화 - 인증 확인 후 사용자/대화/통계 데이터 로드
         * @returns {void}
         */
        init: function () {
            // Phase R2: admin 섹션 탭 → SPA 내부 panel 전환 (별도 페이지 이동 없음)
            const SUB_SECTION_MODULES = {
                metrics: '/js/modules/pages/admin-metrics.js',
                audit: '/js/modules/pages/audit.js',
                analytics: '/js/modules/pages/analytics.js',
                alerts: '/js/modules/pages/alerts.js',
                'mcp-catalog': '/js/modules/pages/admin-mcp-catalog.js',
                'mcp-monitoring': '/js/modules/pages/admin-mcp-monitoring.js',
            };
            const _subModuleCache = {};

            async function loadSubSection(section) {
                const panel = document.querySelector('.admin-sub-panel[data-section-content="' + section + '"]');
                if (!panel) return;
                if (_subModuleCache[section] && _subModuleCache[section].initialized) return;
                if (!_subModuleCache[section] || !_subModuleCache[section].module) {
                    try {
                        const mod = await import(SUB_SECTION_MODULES[section]);
                        const pageModule = mod.default || mod;
                        _subModuleCache[section] = { module: pageModule, initialized: false };
                    } catch (e) {
                        panel.innerHTML = '<div style="padding:var(--space-6);color:var(--danger);">모듈 로드 실패: ' + section + ' — ' + (e && e.message ? e.message : e) + '</div>';
                        console.error('[admin] sub-panel 로드 실패:', section, e);
                        return;
                    }
                }
                const m = _subModuleCache[section].module;
                if (typeof m.getHTML === 'function') panel.innerHTML = m.getHTML();
                if (typeof m.init === 'function') {
                    try { await m.init(); } catch (e) { console.error('[admin] sub-panel init 실패:', section, e); }
                }
                _subModuleCache[section].initialized = true;
            }

            function switchSection(section) {
                document.querySelectorAll('.admin-section-tab').forEach(function (t) {
                    t.classList.toggle('active', t.getAttribute('data-section-tab') === section);
                });
                const nativeSection = document.getElementById('adminNativeSection');
                const subPanels = document.querySelectorAll('.admin-sub-panel');
                if (section === 'users') {
                    if (nativeSection) nativeSection.style.display = '';
                    subPanels.forEach(function (p) { p.style.display = 'none'; });
                } else {
                    if (nativeSection) nativeSection.style.display = 'none';
                    subPanels.forEach(function (p) {
                        p.style.display = p.getAttribute('data-section-content') === section ? '' : 'none';
                    });
                    loadSubSection(section);
                }
                // URL ?tab=<name> 동기화 — 기본 (users) 은 query 제거
                try {
                    const params = new URLSearchParams(location.search);
                    if (section === 'users') params.delete('tab'); else params.set('tab', section);
                    const qs = params.toString();
                    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
                } catch (_e) { /* noop */ }
            }

            document.querySelectorAll('.admin-section-tab').forEach(function (btn) {
                btn.addEventListener('click', function (ev) {
                    ev.preventDefault();
                    const section = btn.getAttribute('data-section-tab');
                    if (section) switchSection(section);
                });
            });

            // 초기 진입 시 URL ?tab=... 으로 활성 탭 결정
            try {
                const initialTab = new URLSearchParams(location.search).get('tab');
                if (initialTab && SUB_SECTION_MODULES[initialTab]) switchSection(initialTab);
            } catch (_e) { /* noop */ }

            // cleanup 시 sub-module cleanup 호출 위해 전역 노출
            window.__adminSubModuleCache = _subModuleCache;

            try {
                // SafeStorage 래퍼 — safe-storage.js에서 전역 등록됨
                const SS = window.SafeStorage;
                // authToken은 httpOnly 쿠키로 관리됩니다 — localStorage에서 읽지 않음
                const _userStr = SS.getItem(SK.USER || 'user');
                let currentUser = null;
                let usersPage = 1;
                let convPage = 1;
                const pageSize = 20;
                let userSearchTimeout;
                let convSearchTimeout;

                async function checkAuth() {
                    if (!_userStr) { (typeof Router !== 'undefined' && Router.navigate('/')); return false; }
                    try {
                        const res = await authFetch(API_ENDPOINTS.AUTH_ME);
                        const data = await res.json();
                        const payload = data.data || data;
                        if (!res.ok || !payload.user) throw new Error('인증 실패');
                        currentUser = payload.user;
                        if (currentUser.role !== 'admin') {
                            showToast('관리자 권한이 필요합니다', 'error');
                            setTimeout(() => (typeof Router !== 'undefined' && Router.navigate('/')), 1500);
                            return false;
                        }
                        return true;
                    } catch (e) {
                        (typeof Router !== 'undefined' && Router.navigate('/'));
                        return false;
                    }
                }

                async function authFetch(url, options = {}) {
                    return fetch(url, {
                        ...options,
                        credentials: 'include',
                        // 인증은 credentials: 'include' 쿠키로 처리 — Bearer 헤더 불필요
                        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
                    });
                }

                function switchTab(tab) {
                    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                    document.querySelectorAll('.panel').forEach(p => p.style.display = 'none');
                    document.querySelector(`[data-action="switch-tab"][data-tab="${tab}"]`).classList.add('active');
                    document.getElementById(`${tab}Panel`).style.display = 'block';
                    // 통계 카드(총사용자/활성/관리자/오늘질문)는 사용자 관리 탭 전용 — 대화기록/14세미만 탭에선 숨김
                    var userStatsCards = document.getElementById('userStatsCards');
                    if (userStatsCards) userStatsCards.style.display = (tab === 'users') ? '' : 'none';
                    // GDPR Phase D — guardian 탭 클릭 시 자동 load
                    if (tab === 'guardian') loadGuardianPending();
                }

                // GDPR Phase D — 14세 미만 동의 보류 list 조회 + verify
                async function loadGuardianPending() {
                    const tbody = document.getElementById('guardianList');
                    if (!tbody) return;
                    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted p-4">로딩 중...</td></tr>';
                    try {
                        const res = await authFetch('/api/admin/guardian-consent-pending');
                        const data = await res.json();
                        if (!res.ok || !data.success) {
                            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger p-4">조회 실패</td></tr>';
                            return;
                        }
                        const rows = (data.data && data.data.pending) || [];
                        if (rows.length === 0) {
                            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted p-4">보류 사용자 없음</td></tr>';
                            return;
                        }
                        tbody.innerHTML = rows.map(r => `
                            <tr>
                                <td>${formatDate(r.created_at)}</td>
                                <td>${escapeHtml(r.username || '-')}</td>
                                <td>${escapeHtml(r.user_email || '-')}</td>
                                <td>${r.birth_date ? escapeHtml(String(r.birth_date).slice(0, 10)) : '-'}</td>
                                <td>${escapeHtml(r.guardian_email || '-')}</td>
                                <td class="flex gap-2">
                                    <button class="btn btn-primary btn-sm" data-guardian-action="verified" data-user-id="${escapeHtml(r.user_id)}">승인</button>
                                    <button class="btn btn-danger btn-sm" data-guardian-action="rejected" data-user-id="${escapeHtml(r.user_id)}">거부</button>
                                </td>
                            </tr>
                        `).join('');
                        tbody.onclick = function (e) {
                            const btn = e.target.closest('[data-guardian-action]');
                            if (!btn) return;
                            verifyGuardian(btn.dataset.userId, btn.dataset.guardianAction);
                        };
                    } catch (e) {
                        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger p-4">조회 실패: ' + escapeHtml(String(e.message || e)) + '</td></tr>';
                    }
                }

                async function verifyGuardian(userId, decision) {
                    const label = decision === 'verified' ? '승인' : '거부';
                    const reason = prompt(`${label} 사유 (선택, 미입력 시 빈 값):`);
                    if (reason === null) return;  // cancel
                    if (!confirm(`사용자 ${userId} 를 ${label} 처리하시겠습니까?`)) return;
                    try {
                        const res = await authFetch(`/api/admin/users/${encodeURIComponent(userId)}/guardian-verify`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ decision, reason: reason || undefined }),
                        });
                        const data = await res.json();
                        if (res.ok && data.success) {
                            showToast(`${label} 완료`, 'success');
                            loadGuardianPending();
                            loadUsers();
                            loadUserStats();
                        } else {
                            const msg = (data.error && typeof data.error === 'object') ? data.error.message : data.error;
                            showToast(msg || `${label} 실패`, 'error');
                        }
                    } catch (e) {
                        showToast(`${label} 실패: ${e.message || e}`, 'error');
                    }
                }

                async function loadUsers() {
                    const role = document.getElementById('filterRole').value;
                    const search = document.getElementById('filterSearch').value;
                    try {
                        const params = new URLSearchParams({ page: usersPage, limit: pageSize, ...(role && { role }), ...(search && { search }) });
                        const res = await authFetch(`${API_ENDPOINTS.ADMIN_USERS}?${params}`);
                        const data = await res.json();
                        const payload = data.data || data;
                        renderUsers(payload.users || []);
                        renderPagination('usersPagination', payload.total || 0, usersPage, (p) => { usersPage = p; loadUsers(); });
                    } catch (e) { showToast('사용자 목록 로드 실패', 'error'); }
                }

                function renderUsers(users) {
                    const tbody = document.getElementById('usersList');
                    if (users.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted p-4">사용자가 없습니다</td></tr>'; return; }
                    tbody.innerHTML = users.map(u => `
                <tr>
                    <td>${escapeHtml(u.id)}</td>
                    <td>${escapeHtml(u.email)}</td>
                    <td><span class="badge badge-${escapeHtml(u.role)}">${escapeHtml(getRoleName(u.role))}</span></td>
                    <td><span class="badge ${u.is_active ? 'badge-active' : 'badge-inactive'}">${u.is_active ? '활성' : '비활성'}</span></td>
                    <td>${formatDate(u.created_at)}</td>
                    <td>${u.last_login ? formatDate(u.last_login) : '-'}</td>
                    <td class="flex gap-2">
                        <button class="btn btn-secondary btn-sm" data-action="edit" data-user-id="${escapeHtml(u.id)}">편집</button>
                        ${u.id !== currentUser.id ? `<button class="btn btn-danger btn-sm" data-action="delete" data-user-id="${escapeHtml(u.id)}" data-user-email="${escapeHtml(u.email)}">삭제</button>` : ''}
                    </td>
                </tr>
            `).join('');
                    tbody.onclick = function(e) {
                        var btn = e.target.closest('[data-action]');
                        if (!btn) return;
                        var action = btn.dataset.action;
                        var userId = btn.dataset.userId;
                        var userEmail = btn.dataset.userEmail || '';
                        // setTimeout으로 비동기 API 호출을 클릭 이벤트에서 분리 (Violation 방지)
                        if (action === 'edit') { setTimeout(function() { editUser(userId); }, 0); }
                        else if (action === 'delete') { setTimeout(function() { deleteUser(userId, userEmail); }, 0); }
                    };
                }

                function getRoleName(role) { return { admin: '관리자', user: '사용자', guest: '게스트' }[role] || role; }

                async function loadUserStats() {
                    try {
                        const res = await authFetch(API_ENDPOINTS.ADMIN_USERS_STATS);
                        const stats = await res.json();
                        const payload = stats.data || stats;
                        document.getElementById('statTotalUsers').textContent = payload.totalUsers || 0;
                        document.getElementById('statActiveUsers').textContent = payload.activeUsers || 0;
                        document.getElementById('statAdmins').textContent = payload.adminCount || 0;
                    } catch (e) { console.error('[Admin] 사용자 통계 로드 실패:', e); }
                    try {
                        const res = await authFetch(API_ENDPOINTS.ADMIN_STATS);
                        if (res.ok) { const data = await res.json(); const payload2 = data.data || data; document.getElementById('statTodayQueries').textContent = payload2.today_queries || 0; }
                    } catch (e) { console.error('[Admin] 관리 통계 로드 실패:', e); }
                }

                function showAddUserModal() {
                    document.getElementById('editModalTitle').textContent = '새 사용자 추가';
                    document.getElementById('editUserId').value = '';
                    document.getElementById('editEmail').value = '';
                    document.getElementById('editPassword').value = '';
                    document.getElementById('editRole').value = 'user';
                    document.getElementById('editActive').value = '1';
                    document.getElementById('editUserModal').classList.add('active');
                }

                async function editUser(id) {
                    try {
                        const res = await authFetch(`${API_ENDPOINTS.ADMIN_USERS}?search=`);
                        const data = await res.json();
                        const payload = data.data || data;
                        const user = (payload.users || []).find(u => u.id === id);
                        if (!user) { showToast('사용자를 찾을 수 없습니다', 'error'); return; }
                        document.getElementById('editModalTitle').textContent = '사용자 편집';
                        document.getElementById('editUserId').value = user.id;
                        document.getElementById('editEmail').value = user.email;
                        document.getElementById('editPassword').value = '';
                        document.getElementById('editRole').value = user.role;
                        document.getElementById('editActive').value = user.is_active ? '1' : '0';
                        document.getElementById('editUserModal').classList.add('active');
                    } catch (e) { showToast('사용자 정보 로드 실패', 'error'); }
                }

                async function saveUser() {
                    const id = document.getElementById('editUserId').value;
                    const email = document.getElementById('editEmail').value;
                    const password = document.getElementById('editPassword').value;
                    const role = document.getElementById('editRole').value;
                    const is_active = document.getElementById('editActive').value === '1';
                    if (!email) { showToast('이메일을 입력하세요', 'error'); return; }
                    try {
                        if (id) {
                            const res = await authFetch(`${API_ENDPOINTS.ADMIN_USERS}/${id}`, { method: 'PUT', body: JSON.stringify({ email, role, is_active }) });
                            if (!res.ok) { const d = await res.json(); throw new Error((d.error && typeof d.error === 'object' ? d.error.message : d.error) || '수정 실패'); }
                            showToast('사용자 정보가 수정되었습니다', 'success');
                        } else {
                            if (!password || password.length < 8) { showToast('비밀번호는 8자 이상이어야 합니다', 'error'); return; }
                            if (!/[A-Z]/.test(password) || !/[a-z]/.test(password)) { showToast('비밀번호에 대문자와 소문자를 포함해야 합니다', 'error'); return; }
                            if (!/[0-9]/.test(password)) { showToast('비밀번호에 숫자를 포함해야 합니다', 'error'); return; }
                            if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) { showToast('비밀번호에 특수문자를 포함해야 합니다', 'error'); return; }
                            const res = await authFetch(API_ENDPOINTS.ADMIN_USERS, { method: 'POST', body: JSON.stringify({ email, password, role }) });
                            if (!res.ok) { const d = await res.json(); throw new Error((d.error && typeof d.error === 'object' ? d.error.message : d.error) || '추가 실패'); }
                            showToast('사용자가 추가되었습니다', 'success');
                        }
                        closeModal(); loadUsers(); loadUserStats();
                    } catch (e) { showToast('저장 실패: ' + e.message, 'error'); }
                }

                // GDPR Phase A Fix 2 — deleteUser 가 단순 confirm() 대신 영향 안내 modal 표시.
                // 이메일 입력 확인으로 의도 검증 + skill_manifest is_public 자동 false 처리 명시.
                function deleteUser(id, email) {
                    showDeleteUserModal(id, email);
                }

                function showDeleteUserModal(id, email) {
                    document.getElementById('deleteUserTargetId').value = id;
                    document.getElementById('deleteUserTargetEmail').textContent = email || '(이메일 없음)';
                    const input = document.getElementById('deleteUserConfirmInput');
                    input.value = '';
                    document.getElementById('deleteUserModal').classList.add('active');
                    setTimeout(() => input.focus(), 50);
                }

                function closeDeleteUserModal() {
                    document.getElementById('deleteUserModal').classList.remove('active');
                }

                async function confirmDeleteUser() {
                    const id = document.getElementById('deleteUserTargetId').value;
                    const email = document.getElementById('deleteUserTargetEmail').textContent;
                    const input = (document.getElementById('deleteUserConfirmInput').value || '').trim();
                    if (input !== email) {
                        showToast('이메일 불일치 — 정확히 입력하세요', 'error');
                        return;
                    }
                    try {
                        const res = await authFetch(`${API_ENDPOINTS.ADMIN_USERS}/${id}`, { method: 'DELETE' });
                        const data = await res.json();
                        if (res.ok) {
                            closeDeleteUserModal();
                            showToast('사용자가 삭제되었습니다', 'success');
                            loadUsers();
                            loadUserStats();
                        } else {
                            const errorMsg = (data.error && typeof data.error === 'object') ? data.error.message : data.error;
                            showToast(errorMsg || '삭제 실패', 'error');
                        }
                    } catch (e) { showToast('삭제 실패', 'error'); }
                }

                function closeModal() { document.getElementById('editUserModal').classList.remove('active'); }

                function debounceSearch() { clearTimeout(userSearchTimeout); userSearchTimeout = setTimeout(() => { usersPage = 1; loadUsers(); }, 300); }

                async function loadConversations() {
                    const startDate = document.getElementById('filterStartDate').value;
                    const endDate = document.getElementById('filterEndDate').value;
                    const role = document.getElementById('filterConvRole').value;
                    const search = document.getElementById('filterConvSearch').value;
                    try {
                        const params = new URLSearchParams({ page: convPage, limit: pageSize, ...(startDate && { startDate }), ...(endDate && { endDate }), ...(role && { role }), ...(search && { search }) });
                        const res = await authFetch(`${API_ENDPOINTS.ADMIN_CONVERSATIONS}?${params}`);
                        const data = await res.json();
                        const payload = data.data || data;
                        renderConversations(payload.conversations || []);
                        renderPagination('convPagination', payload.total || 0, convPage, (p) => { convPage = p; loadConversations(); });
                    } catch (e) { showToast('대화 기록 로드 실패', 'error'); }
                }

                function renderConversations(conversations) {
                    const tbody = document.getElementById('conversationsList');
                    if (conversations.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted p-4">대화 기록이 없습니다</td></tr>'; return; }
                    tbody.innerHTML = conversations.map(c => `
                <tr>
                    <td>${formatDateTime(c.created_at)}</td>
                    <td class="text-muted text-sm">${escapeHtml(c.user_email || '-')}</td>
                    <td><span class="badge ${c.role === 'user' ? 'badge-user' : c.role === 'assistant' ? 'badge-assistant' : 'badge-system'}">${escapeHtml(c.role || '')}</span></td>
                    <td style="max-width:350px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(c.content?.substring(0, 100) || '')}</td>
                    <td class="text-muted text-sm">${escapeHtml(c.model || '-')}</td>
                </tr>
            `).join('');
                }

                function debounceConvSearch() { clearTimeout(convSearchTimeout); convSearchTimeout = setTimeout(() => { convPage = 1; loadConversations(); }, 300); }
                function exportCSV() { window.open(API_ENDPOINTS.ADMIN_CONVERSATIONS_EXPORT + '?format=csv', '_blank'); }

                function renderPagination(containerId, total, currentPage, onPageChange) {
                    const totalPages = Math.ceil(total / pageSize);
                    const container = document.getElementById(containerId);
                    if (totalPages <= 1) { container.innerHTML = ''; return; }
                    // Window-based pagination: 1 ... 5 6 7 ... 20
                    const windowSize = 2; // Show 2 pages on each side of current
                    const pages = [];
                    
                    // Always show first page
                    pages.push(1);
                    
                    // Calculate range around current page
                    const rangeStart = Math.max(2, currentPage - windowSize);
                    const rangeEnd = Math.min(totalPages - 1, currentPage + windowSize);
                    
                    // Add ellipsis after page 1 if needed
                    if (rangeStart > 2) {
                        pages.push('...');
                    }
                    
                    // Add pages in range
                    for (let i = rangeStart; i <= rangeEnd; i++) {
                        pages.push(i);
                    }
                    
                    // Add ellipsis before last page if needed
                    if (rangeEnd < totalPages - 1) {
                        pages.push('...');
                    }
                    
                    // Always show last page (if more than 1 page)
                    if (totalPages > 1) {
                        pages.push(totalPages);
                    }
                    
                    // Render buttons
                    let html = '';
                    pages.forEach(p => {
                        if (p === '...') {
                            html += '<span class="pagination-ellipsis" style="padding: 0 8px; color: var(--text-muted);">...</span>';
                        } else {
                            html += `<button class="btn ${p === currentPage ? 'btn-primary' : 'btn-secondary'} btn-sm" data-page="${p}">${p}</button>`;
                        }
                    });
                    container.innerHTML = html;
                    container.onclick = function (e) {
                        var btn = e.target.closest('[data-page]');
                        if (btn) onPageChange(parseInt(btn.dataset.page));
                    };
                }

                function formatDate(dateStr) {
                    if (!dateStr) return '-';
                    const d = new Date(dateStr);
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                }

                function formatDateTime(dateStr) {
                    if (!dateStr) return '-';
                    const d = new Date(dateStr);
                    return `${formatDate(dateStr)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                }

                function escapeHtml(text) {
                    const div = document.createElement('div');
                    div.textContent = text;
                    return div.innerHTML;
                }

                function showToast(message, type = 'info') {
                    const toast = document.createElement('div');
                    toast.className = `toast ${type}`;
                    toast.textContent = message;
                    document.body.appendChild(toast);
                    setTimeout(() => toast.remove(), 3000);
                }

                // Expose onclick-referenced functions globally
                if (typeof switchTab === 'function') window.switchTab = switchTab;
                if (typeof showAddUserModal === 'function') window.showAddUserModal = showAddUserModal;
                if (typeof exportCSV === 'function') window['exportCSV'] = exportCSV;
                if (typeof closeModal === 'function') window.closeModal = closeModal;
                if (typeof saveUser === 'function') window.saveUser = saveUser;
                if (typeof editUser === 'function') window.editUser = editUser;
                if (typeof deleteUser === 'function') window.deleteUser = deleteUser;
                if (typeof showDeleteUserModal === 'function') window.showDeleteUserModal = showDeleteUserModal;
                if (typeof closeDeleteUserModal === 'function') window.closeDeleteUserModal = closeDeleteUserModal;
                if (typeof confirmDeleteUser === 'function') window.confirmDeleteUser = confirmDeleteUser;
                if (typeof debounceSearch === 'function') window.debounceSearch = debounceSearch;
                if (typeof debounceConvSearch === 'function') window.debounceConvSearch = debounceConvSearch;
                if (typeof loadConversations === 'function') window.loadConversations = loadConversations;
                if (typeof loadUsers === 'function') window.loadUsers = loadUsers;
                if (typeof loadGuardianPending === 'function') window.loadGuardianPending = loadGuardianPending;
                if (typeof verifyGuardian === 'function') window.verifyGuardian = verifyGuardian;

                // ─── 인라인 핸들러 → 위임/바인딩 (CSP script-src-attr 위생) ───
                // 정적 onclick 은 app-root data-action 위임으로, onchange/onkeyup/onsubmit 은 id 바인딩으로 대체.
                function bindDom(target, event, handler) {
                    if (!target) return;
                    target.addEventListener(event, handler);
                    _domListeners.push({ target: target, event: event, handler: handler });
                }
                var adminRoot = document.getElementById('app-root') || document.body;
                bindDom(adminRoot, 'click', function (e) {
                    var btn = e.target.closest('[data-action]');
                    if (!btn || !adminRoot.contains(btn)) return;
                    switch (btn.dataset.action) {
                        case 'switch-tab': switchTab(btn.dataset.tab); break;
                        case 'add-user': showAddUserModal(); break;
                        case 'export-csv': exportCSV(); break;
                        case 'reload-guardian': loadGuardianPending(); break;
                        case 'close-edit-modal': closeModal(); break;
                        case 'save-user': saveUser(); break;
                        case 'close-delete-modal': closeDeleteUserModal(); break;
                        case 'confirm-delete': confirmDeleteUser(); break;
                        // edit/delete(동적 행)는 usersList tbody 위임에서 처리 — 여기선 무시
                    }
                });
                bindDom(document.getElementById('filterRole'), 'change', loadUsers);
                bindDom(document.getElementById('filterStartDate'), 'change', loadConversations);
                bindDom(document.getElementById('filterEndDate'), 'change', loadConversations);
                bindDom(document.getElementById('filterConvRole'), 'change', loadConversations);
                bindDom(document.getElementById('filterSearch'), 'keyup', debounceSearch);
                bindDom(document.getElementById('filterConvSearch'), 'keyup', debounceConvSearch);
                bindDom(document.getElementById('editUserForm'), 'submit', function (e) { e.preventDefault(); });

                // Init
                (async () => {
                    if (await checkAuth()) { loadUsers(); loadUserStats(); loadConversations(); }
                })();
            } catch (e) {
                console.error('[PageModule:admin] init error:', e);
            }
        },

        /**
         * 페이지 정리 - 인터벌/타임아웃 해제 및 전역 함수 제거
         * @returns {void}
         */
        cleanup: function () {
            _intervals.forEach(function (id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function (id) { clearTimeout(id); });
            _timeouts = [];
            // 인라인 핸들러 대체 DOM 리스너 해제 (app-root 위임은 영속이므로 명시 해제 필요)
            _domListeners.forEach(function (l) {
                try { l.target.removeEventListener(l.event, l.handler); } catch (e) { }
            });
            _domListeners = [];
            // R2: SPA sub-panel 모듈 cleanup 연쇄 호출
            try {
                const cache = window.__adminSubModuleCache || {};
                Object.keys(cache).forEach(function (section) {
                    const m = cache[section] && cache[section].module;
                    if (m && typeof m.cleanup === 'function') {
                        try { m.cleanup(); } catch (e) { console.error('[admin] sub-panel cleanup 실패:', section, e); }
                    }
                });
                delete window.__adminSubModuleCache;
            } catch (_e) { /* noop */ }
            // Remove onclick-exposed globals
            try { delete window.switchTab; } catch (e) { }
            try { delete window.showAddUserModal; } catch (e) { }
            try { delete window['exportCSV']; } catch (e) { }
            try { delete window.closeModal; } catch (e) { }
            try { delete window.saveUser; } catch (e) { }
            try { delete window.editUser; } catch (e) { }
            try { delete window.deleteUser; } catch (e) { }
            try { delete window.showDeleteUserModal; } catch (e) { }
            try { delete window.closeDeleteUserModal; } catch (e) { }
            try { delete window.confirmDeleteUser; } catch (e) { }
            try { delete window.debounceSearch; } catch (e) { }
            try { delete window.debounceConvSearch; } catch (e) { }
            try { delete window.loadConversations; } catch (e) { }
            try { delete window.loadUsers; } catch (e) { }
            try { delete window.loadGuardianPending; } catch (e) { }
            try { delete window.verifyGuardian; } catch (e) { }
        }
    };

const { getHTML, init, cleanup } = window.PageModules['admin'];
export default { getHTML, init, cleanup };
