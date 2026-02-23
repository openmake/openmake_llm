/**
 * =========================================================================
 * Skill Library - 스킬 라이브러리 및 마켓플레이스 연동 모듈 (SPA PageModule)
 * =========================================================================
 */
(function () {
    'use strict';
    window.PageModules = window.PageModules || {};

    let localSkills = [];
    let mpSkills = [];
    let userAssignedIds = new Set(); // 사용자 개인 할당 스킬 ID 집합

    let localFilters = {
        search: '',
        category: '',
        sortBy: 'newest',
        page: 1,
        limit: 12,
        total: 0
    };

    let mpFilters = {
        query: '',
        page: 1,
        limit: 12,
        total: 0
    };

    function getPageHTML() {
        return `
<style data-spa-style="skill-library">
    .sl-page {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }
    .sl-header {
        padding: var(--space-5, 1.25rem) var(--space-5, 1.25rem) 0;
        flex-shrink: 0;
    }
    .sl-header h1 {
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--text-primary, #fff);
        margin: 0 0 var(--space-2, 0.5rem);
        display: flex;
        align-items: center;
        gap: var(--space-2, 0.5rem);
    }
    .sl-header p {
        color: var(--text-secondary, #94a3b8);
        margin-bottom: var(--space-3, 0.75rem);
        font-size: 0.875rem;
    }
    /* Tabs */
    .sl-tabs {
        display: flex;
        gap: 0;
        border-bottom: 1px solid var(--border-color, #2d3748);
        margin-bottom: 0;
    }
    .sl-tab {
        padding: 0.75rem 1.25rem;
        cursor: pointer;
        color: var(--text-secondary, #a0aec0);
        border: none;
        border-bottom: 2px solid transparent;
        background: transparent;
        font-weight: 500;
        font-size: 0.9rem;
        transition: color 0.15s, border-color 0.15s;
    }
    .sl-tab:hover { color: var(--text-primary, #fff); }
    .sl-tab.active {
        color: var(--accent-primary, #3b82f6);
        border-bottom-color: var(--accent-primary, #3b82f6);
    }
    /* Tab panes */
    .sl-tab-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-5, 1.25rem);
    }
    .sl-pane { display: none; }
    .sl-pane.active { display: block; }
    /* Toolbar row */
    .sl-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--space-3, 0.75rem);
        margin-bottom: var(--space-4, 1rem);
    }
    .sl-search-group {
        display: flex;
        gap: var(--space-2, 0.5rem);
        flex: 1;
        max-width: 600px;
        flex-wrap: wrap;
    }
    .sl-input-wrap {
        position: relative;
        display: flex;
        align-items: center;
        flex: 1;
    }
    .sl-input-icon {
        position: absolute;
        left: 0.75rem;
        color: var(--text-secondary, #94a3b8);
        pointer-events: none;
        font-size: 0.875rem;
    }
    .sl-input {
        width: 100%;
        padding: 0.5rem 0.75rem 0.5rem 2.2rem;
        background: var(--bg-secondary, #1e293b);
        border: 1px solid var(--border-light, #334155);
        border-radius: var(--radius-md, 6px);
        color: var(--text-primary, #fff);
        font-size: 0.875rem;
        box-sizing: border-box;
    }
    .sl-input::placeholder { color: var(--text-muted, #64748b); }
    .sl-input:focus { outline: none; border-color: var(--accent-primary, #3b82f6); }
    .sl-select {
        padding: 0.5rem 0.75rem;
        background: var(--bg-secondary, #1e293b);
        border: 1px solid var(--border-light, #334155);
        border-radius: var(--radius-md, 6px);
        color: var(--text-primary, #fff);
        font-size: 0.875rem;
    }
    .sl-select:focus { outline: none; border-color: var(--accent-primary, #3b82f6); }
    /* Buttons */
    .sl-btn {
        padding: 0.5rem 1rem;
        border-radius: var(--radius-md, 6px);
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        border: none;
        display: inline-flex;
        align-items: center;
        gap: var(--space-2, 0.5rem);
        transition: opacity 0.15s;
    }
    .sl-btn:hover { opacity: 0.85; }
    .sl-btn-primary { background: var(--accent-primary, #3b82f6); color: #fff; }
    .sl-btn-outline { background: transparent; color: var(--text-secondary, #94a3b8); border: 1px solid var(--border-light, #334155); }
    .sl-btn-outline:hover { color: var(--text-primary, #fff); border-color: var(--text-secondary, #94a3b8); }
    .sl-btn-sm { padding: 0.35rem 0.75rem; font-size: 0.8rem; }
    /* Grids */
    .skill-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 1.25rem;
    }
    /* Cards */
    .skill-card {
        background-color: var(--bg-card, #1e293b);
        border: 1px solid var(--border-color, #334155);
        border-radius: 0.5rem;
        padding: 1.25rem;
        transition: border-color 0.2s, transform 0.2s;
        display: flex;
        flex-direction: column;
    }
    .skill-card:hover {
        border-color: var(--accent-primary, #3b82f6);
        transform: translateY(-2px);
    }
    .skill-card-top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 0.5rem;
    }
    .skill-card-badge {
        font-size: 0.75rem;
        padding: 0.2rem 0.5rem;
        border-radius: 1rem;
        background: rgba(59,130,246,0.1);
        color: var(--accent-primary, #3b82f6);
        border: 1px solid rgba(59,130,246,0.2);
        display: inline-block;
    }
    .skill-card-menu {
        position: relative;
    }
    .skill-card-menu-btn {
        background: transparent;
        border: none;
        color: var(--text-secondary, #94a3b8);
        cursor: pointer;
        padding: 0.2rem 0.4rem;
        border-radius: 4px;
        font-size: 1.1rem;
        line-height: 1;
    }
    .skill-card-menu-btn:hover { background: var(--bg-tertiary, #2d3748); }
    .skill-card-dropdown {
        display: none;
        position: absolute;
        right: 0;
        top: 100%;
        background: var(--bg-card, #1e293b);
        border: 1px solid var(--border-color, #334155);
        border-radius: var(--radius-md, 6px);
        min-width: 160px;
        z-index: 100;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    }
    .skill-card-dropdown.open { display: block; }
    .skill-card-dropdown a {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        color: var(--text-primary, #fff);
        text-decoration: none;
        font-size: 0.875rem;
    }
    .skill-card-dropdown a:hover { background: var(--bg-tertiary, #2d3748); }
    .skill-card-dropdown a.danger { color: #f87171; }
    .skill-card-dropdown hr {
        margin: 0.25rem 0;
        border: none;
        border-top: 1px solid var(--border-color, #334155);
    }
    .skill-card-title {
        font-size: 1rem;
        font-weight: 600;
        color: var(--text-primary, #fff);
        margin-bottom: 0.4rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .skill-card-desc {
        color: var(--text-secondary, #94a3b8);
        font-size: 0.8rem;
        line-height: 1.5;
        flex-grow: 1;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        margin-bottom: 0.75rem;
    }
    .skill-card-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-top: 1px solid var(--border-color, #334155);
        padding-top: 0.75rem;
        margin-top: auto;
    }
    .skill-card-footer small { color: var(--text-muted, #64748b); font-size: 0.75rem; }
    .sl-badge {
        font-size: 0.7rem;
        padding: 0.15rem 0.5rem;
        border-radius: 1rem;
        border: 1px solid;
    }
    .sl-badge-success { background: rgba(34,197,94,0.1); color: #4ade80; border-color: rgba(34,197,94,0.25); }
    .sl-badge-secondary { background: rgba(148,163,184,0.1); color: #94a3b8; border-color: rgba(148,163,184,0.2); }
    /* Marketplace banner */
    .sl-mp-banner {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
        padding: 1rem 1.25rem;
        background: var(--bg-secondary, #1e293b);
        border: 1px solid rgba(59,130,246,0.25);
        border-radius: 0.5rem;
        margin-bottom: 1.25rem;
    }
    .sl-mp-banner-icon { font-size: 2rem; color: var(--accent-primary, #3b82f6); }
    .sl-mp-banner h5 { margin: 0 0 0.25rem; color: var(--text-primary, #fff); font-size: 0.95rem; }
    .sl-mp-banner p { margin: 0; color: var(--text-secondary, #94a3b8); font-size: 0.8rem; }
    /* MP search toolbar */
    .sl-mp-search {
        display: flex;
        gap: var(--space-2, 0.5rem);
        margin-bottom: 1.25rem;
        max-width: 600px;
    }
    .sl-mp-search .sl-input-wrap { flex: 1; }
    /* MP card action buttons */
    .skill-card-actions {
        display: flex;
        gap: 0.5rem;
        border-top: 1px solid var(--border-color, #334155);
        padding-top: 0.75rem;
        margin-top: auto;
    }
    /* Pagination */
    .sl-pagination {
        display: flex;
        justify-content: center;
        gap: 0.25rem;
        margin-top: 1.25rem;
        flex-wrap: wrap;
    }
    .sl-page-btn {
        padding: 0.35rem 0.65rem;
        background: var(--bg-secondary, #1e293b);
        border: 1px solid var(--border-color, #334155);
        border-radius: var(--radius-md, 6px);
        color: var(--text-secondary, #94a3b8);
        cursor: pointer;
        font-size: 0.8rem;
    }
    .sl-page-btn:hover { border-color: var(--accent-primary, #3b82f6); color: var(--text-primary, #fff); }
    .sl-page-btn.active { background: var(--accent-primary, #3b82f6); border-color: var(--accent-primary, #3b82f6); color: #fff; }
    .sl-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    /* Loading / Empty states */
    .sl-loading {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 3rem;
        width: 100%;
        color: var(--text-secondary, #94a3b8);
    }
    .sl-empty {
        text-align: center;
        padding: 3rem;
        color: var(--text-secondary, #94a3b8);
        width: 100%;
        font-size: 0.9rem;
    }
    .sl-error {
        padding: 1rem 1.25rem;
        background: rgba(248,113,113,0.1);
        border: 1px solid rgba(248,113,113,0.25);
        border-radius: 0.5rem;
        color: #f87171;
        font-size: 0.875rem;
        width: 100%;
        box-sizing: border-box;
    }
    /* Spinner */
    @keyframes sl-spin { to { transform: rotate(360deg); } }
    .sl-spinner {
        width: 1.5rem; height: 1.5rem;
        border: 2px solid var(--border-color, #334155);
        border-top-color: var(--accent-primary, #3b82f6);
        border-radius: 50%;
        animation: sl-spin 0.7s linear infinite;
        margin: auto;
    }
</style>
<div class="sl-page" id="skill-library-root">
    <div class="sl-header">
        <h1>
            <span class="iconify" data-icon="lucide:package"></span>
            스킬 라이브러리
        </h1>
        <p>로컬에 설치된 에이전트 스킬을 관리하거나 마켓플레이스에서 새로운 스킬을 가져옵니다.</p>
        <div class="sl-tabs" role="tablist">
            <button class="sl-tab active" data-sl-tab="local" role="tab" aria-selected="true">내 스킬</button>
            <button class="sl-tab" data-sl-tab="marketplace" role="tab" aria-selected="false">SkillsMP 마켓플레이스</button>
        </div>
    </div>

    <div class="sl-tab-content">
        <!-- 로컬 스킬 탭 -->
        <div class="sl-pane active" id="sl-pane-local" role="tabpanel">
            <div class="sl-toolbar">
                <div class="sl-search-group">
                    <div class="sl-input-wrap">
                        <span class="sl-input-icon iconify" data-icon="lucide:search"></span>
                        <input type="text" id="localSearchInput" class="sl-input" placeholder="스킬 검색...">
                    </div>
                    <select id="localCategoryFilter" class="sl-select">
                        <option value="">모든 카테고리</option>
                    </select>
                    <select id="localSortSelect" class="sl-select">
                        <option value="newest">최신순</option>
                        <option value="updated">업데이트순</option>
                        <option value="name">이름순</option>
                        <option value="category">카테고리순</option>
                    </select>
                </div>
                <button class="sl-btn sl-btn-primary" id="btnNewSkill">
                    <span class="iconify" data-icon="lucide:plus"></span> 새 스킬 등록
                </button>
            </div>

            <div id="localSkillsGrid" class="skill-grid">
                <div class="sl-loading"><div class="sl-spinner"></div></div>
            </div>
            <div id="localPagination" class="sl-pagination"></div>
        </div>

        <!-- 마켓플레이스 탭 -->
        <div class="sl-pane" id="sl-pane-marketplace" role="tabpanel">
            <div class="sl-mp-banner">
                <div class="sl-mp-banner-icon">
                    <span class="iconify" data-icon="lucide:globe"></span>
                </div>
                <div>
                    <h5>SkillsMP 오픈소스 생태계 연동</h5>
                    <p>전 세계 개발자가 공유하는 26만 개 이상의 오픈소스 에이전트 스킬 포맷(SKILL.md)을 검색하고 로컬 환경으로 즉시 가져올 수 있습니다.</p>
                </div>
            </div>

            <div class="sl-mp-search">
                <div class="sl-input-wrap">
                    <span class="sl-input-icon iconify" data-icon="lucide:search"></span>
                    <input type="text" id="mpSearchInput" class="sl-input"
                        placeholder="마켓플레이스 검색 (예: react, python, 분석)...">
                </div>
                <button class="sl-btn sl-btn-primary" id="mpSearchBtn">검색</button>
            </div>

            <div id="mpSkillsGrid" class="skill-grid">
                <div class="sl-empty">검색어를 입력하고 버튼을 눌러 스킬을 찾아보세요.</div>
            </div>
            <div id="mpPagination" class="sl-pagination"></div>
        </div>
    </div>
</div>`;
    }

    window.PageModules['skill-library'] = {
        getHTML: function () {
            return getPageHTML();
        },

        init: async function () {
            try {
                this.setupTabs();
                this.setupEventListeners();
                await this.loadLocalCategories();
                await this.loadLocalSkills();
            } catch (e) {
                console.error('Skill Library init error:', e);
            }

            // 모달 오픈 이벤트 리스너 추가 (custom-agents 연동)
            window.addEventListener('open-skill-editor', this.onOpenSkillEditor);
            window.addEventListener('edit-local-skill', this.onEditLocalSkill);
        },

        cleanup: function () {
            window.removeEventListener('open-skill-editor', this.onOpenSkillEditor);
            window.removeEventListener('edit-local-skill', this.onEditLocalSkill);

            // Cleanup globals
            ['sl_openNewSkill', 'sl_editSkill', 'sl_deleteSkill', 'sl_exportSkill',
             'sl_importSkill', 'sl_viewMpSkill', 'sl_changeLocalPage', 'sl_changeMpPage',
             'sl_toggleUserSkill'].forEach(key => {
                try { delete window[key]; } catch (e) {}
            });

            // Close any open dropdowns
            document.querySelectorAll('.skill-card-dropdown.open').forEach(el => el.classList.remove('open'));
        },

        setupTabs: function () {
            document.querySelectorAll('.sl-tab').forEach(tab => {
                tab.addEventListener('click', function () {
                    const target = this.dataset.slTab;
                    // Update tab buttons
                    document.querySelectorAll('.sl-tab').forEach(t => {
                        t.classList.toggle('active', t.dataset.slTab === target);
                        t.setAttribute('aria-selected', t.dataset.slTab === target ? 'true' : 'false');
                    });
                    // Update panes
                    document.querySelectorAll('.sl-pane').forEach(p => {
                        p.classList.toggle('active', p.id === 'sl-pane-' + target);
                    });
                });
            });
        },

        onOpenSkillEditor: function () {
            document.getElementById('btnNewSkill')?.click();
        },

        onEditLocalSkill: function (e) {
            const id = e.detail?.id;
            if (id && typeof window.sl_editSkill === 'function') {
                window.sl_editSkill(id);
            }
        },

        setupEventListeners: function () {
            const self = this;

            // New skill button
            document.getElementById('btnNewSkill')?.addEventListener('click', () => {
                self.openNewSkillModal();
            });

            // 로컬 스킬 탭 검색/필터
            const localSearch = document.getElementById('localSearchInput');
            if (localSearch) {
                const debouncedSearch = window.debounce ? window.debounce(function (e) {
                    localFilters.search = e.target.value;
                    localFilters.page = 1;
                    self.loadLocalSkills();
                }, 500) : function (e) {
                    localFilters.search = e.target.value;
                    localFilters.page = 1;
                    self.loadLocalSkills();
                };
                localSearch.addEventListener('input', debouncedSearch);
            }

            document.getElementById('localCategoryFilter')?.addEventListener('change', (e) => {
                localFilters.category = e.target.value;
                localFilters.page = 1;
                self.loadLocalSkills();
            });

            document.getElementById('localSortSelect')?.addEventListener('change', (e) => {
                localFilters.sortBy = e.target.value;
                localFilters.page = 1;
                self.loadLocalSkills();
            });

            // 마켓플레이스 검색
            document.getElementById('mpSearchBtn')?.addEventListener('click', () => {
                mpFilters.query = document.getElementById('mpSearchInput')?.value || '';
                mpFilters.page = 1;
                self.loadMpSkills();
            });

            document.getElementById('mpSearchInput')?.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    mpFilters.query = e.target.value;
                    mpFilters.page = 1;
                    self.loadMpSkills();
                }
            });

            // Global dropdown close on outside click
            document.addEventListener('click', function slDropdownClose(e) {
                if (!e.target.closest('.skill-card-menu')) {
                    document.querySelectorAll('.skill-card-dropdown.open').forEach(d => d.classList.remove('open'));
                }
            });

            // 글로벌 함수 노출
            window.sl_openNewSkill = this.openNewSkillModal.bind(this);
            window.sl_editSkill = this.editLocalSkill.bind(this);
            window.sl_deleteSkill = this.deleteLocalSkill.bind(this);
            window.sl_exportSkill = this.exportSkill.bind(this);
            window.sl_importSkill = this.importMpSkill.bind(this);
            window.sl_viewMpSkill = this.viewMpSkillDetail.bind(this);
            window.sl_changeLocalPage = (p) => { localFilters.page = p; self.loadLocalSkills(); };
            window.sl_changeMpPage = (p) => { mpFilters.page = p; self.loadMpSkills(); };
            window.sl_toggleUserSkill = this.toggleUserSkill.bind(this);
        },

        loadLocalCategories: async function () {
            try {
                const response = await window.authFetch('/api/agents/skills/categories');
                const data = await response.json();
                if (response.ok && data.success) {
                    const select = document.getElementById('localCategoryFilter');
                    if (!select) return;

                    while (select.options.length > 1) {
                        select.remove(1);
                    }

                    data.data.forEach(c => {
                        if (c.category) {
                            const opt = document.createElement('option');
                            opt.value = c.category;
                            opt.textContent = `${c.category} (${c.count})`;
                            select.appendChild(opt);
                        }
                    });
                }
            } catch (e) {
                console.error('카테고리 로드 실패:', e);
            }
        },

        loadLocalSkills: async function () {
            const grid = document.getElementById('localSkillsGrid');
            if (!grid) return;

            grid.innerHTML = '<div class="sl-loading"><div class="sl-spinner"></div></div>';

            try {
                const offset = (localFilters.page - 1) * localFilters.limit;
                const queryParams = new URLSearchParams({
                    search: localFilters.search,
                    category: localFilters.category,
                    sortBy: localFilters.sortBy,
                    limit: localFilters.limit,
                    offset: offset
                });

                // 스킬 목록과 개인 할당 목록 병렬 로드
                const [response, assignedRes] = await Promise.all([
                    window.authFetch(`/api/agents/skills?${queryParams.toString()}`),
                    window.authFetch('/api/agents/skills/user-assigned')
                ]);
                const data = await response.json();

                if (!response.ok || !data.success) throw new Error(data.message || '스킬 로드 실패');

                // 개인 할당 ID 집합 갱신
                if (assignedRes.ok) {
                    const assignedData = await assignedRes.json();
                    if (assignedData.success && Array.isArray(assignedData.data)) {
                        userAssignedIds = new Set(assignedData.data.map(s => s.id));
                    }
                }

                localSkills = data.data.skills || [];
                localFilters.total = data.data.total || 0;

                this.renderLocalSkills();
                this.renderPagination('localPagination', localFilters.page, localFilters.total, localFilters.limit, 'sl_changeLocalPage');

            } catch (error) {
                console.error(error);
                grid.innerHTML = `<div class="sl-error">${window.escapeHtml ? window.escapeHtml(error.message) : error.message}</div>`;
            }
        },

        renderLocalSkills: function () {
            const grid = document.getElementById('localSkillsGrid');
            if (!grid) return;

            if (localSkills.length === 0) {
                grid.innerHTML = '<div class="sl-empty">조회된 스킬이 없습니다. 새 스킬을 등록하거나 마켓플레이스에서 가져와보세요.</div>';
                return;
            }

            const esc = window.escapeHtml || (s => s);

            grid.innerHTML = localSkills.map(skill => {
                const isUserAssigned = userAssignedIds.has(skill.id);
                const userBadge = isUserAssigned
                    ? '<span class="sl-badge" style="background:rgba(168,85,247,0.12);color:#c084fc;border-color:rgba(168,85,247,0.25);margin-left:0.4rem" title="나에게만 적용된 스킬">👤 나만</span>'
                    : '';
                const toggleLabel = isUserAssigned ? '👤 나만 적용 해제' : '👤 나만 적용';
                return `
                <div class="skill-card">
                    <div class="skill-card-top">
                        <span class="skill-card-badge">${esc(skill.category || 'general')}${userBadge}</span>
                        <div class="skill-card-menu">
                            <button class="skill-card-menu-btn" title="더 보기"
                                onclick="(function(btn){btn.nextElementSibling.classList.toggle('open');event.stopPropagation();})(this)">⋯</button>
                            <div class="skill-card-dropdown">
                                <a href="#" onclick="sl_toggleUserSkill('${esc(skill.id)}', ${isUserAssigned});return false;">
                                    <span class="iconify" data-icon="lucide:user"></span> ${toggleLabel}
                                </a>
                                <a href="#" onclick="sl_editSkill('${esc(skill.id)}');return false;">
                                    <span class="iconify" data-icon="lucide:edit-2"></span> 수정
                                </a>
                                <a href="#" onclick="sl_exportSkill('${esc(skill.id)}');return false;">
                                    <span class="iconify" data-icon="lucide:download"></span> 다운로드 (.SKILL)
                                </a>
                                <hr>
                                <a href="#" class="danger" onclick="sl_deleteSkill('${esc(skill.id)}');return false;">
                                    <span class="iconify" data-icon="lucide:trash-2"></span> 삭제
                                </a>
                            </div>
                        </div>
                    </div>
                    <h3 class="skill-card-title" title="${esc(skill.name)}">${esc(skill.name)}</h3>
                    <p class="skill-card-desc" title="${esc(skill.description || '')}">${esc(skill.description || '설명이 없습니다.')}</p>
                    <div class="skill-card-footer">
                        <small>${new Date(skill.createdAt).toLocaleDateString()}</small>
                        ${skill.isPublic
                            ? '<span class="sl-badge sl-badge-success">Public</span>'
                            : '<span class="sl-badge sl-badge-secondary"><span class="iconify" data-icon="lucide:lock" style="font-size:10px;vertical-align:middle"></span> Private</span>'}
                    </div>
                </div>`;
            }).join('');
        },

        loadMpSkills: async function () {
            const grid = document.getElementById('mpSkillsGrid');
            if (!grid) return;

            if (!mpFilters.query) {
                grid.innerHTML = '<div class="sl-empty">검색어를 입력하고 버튼을 눌러 스킬을 찾아보세요.</div>';
                return;
            }

            grid.innerHTML = '<div class="sl-loading"><div class="sl-spinner"></div><span style="margin-left:0.75rem">마켓플레이스 연동 중...</span></div>';

            try {
                const offset = (mpFilters.page - 1) * mpFilters.limit;
                const queryParams = new URLSearchParams({
                    query: mpFilters.query,
                    limit: mpFilters.limit,
                    offset: offset
                });

                const response = await window.authFetch(`/api/skills-marketplace/search?${queryParams.toString()}`);
                const data = await response.json().catch(() => ({}));

                // GITHUB_TOKEN 미설정: 503 + 특정 코드 처리
                if (response.status === 503 || (data.error && data.error.code === 'GITHUB_TOKEN_NOT_CONFIGURED')) {
                    grid.innerHTML = `<div class="sl-error" style="text-align:center;padding:2rem">
                        <div style="font-size:2rem;margin-bottom:0.75rem">⚙️</div>
                        <div style="font-weight:600;margin-bottom:0.5rem">GitHub 연동 미설정</div>
                        <div style="font-size:0.875rem;opacity:0.8">관리자에게 GITHUB_TOKEN 환경변수 설정을 요청하세요.<br>설정 후 스킬마켓플레이스를 이용할 수 있습니다.</div>
                    </div>`;
                    return;
                }

                // 서버 에러 메시지 추출 (다양한 응답 포맷 대응)
                if (!response.ok || !data.success) {
                    const errMsg = data.error?.message || data.message || `서버 오류 (HTTP ${response.status})`;
                    throw new Error(errMsg);
                }
                mpSkills = data.data.skills || [];
                mpFilters.total = data.data.total || 0;
                this.renderMpSkills();
                this.renderPagination('mpPagination', mpFilters.page, mpFilters.total, mpFilters.limit, 'sl_changeMpPage');
            } catch (error) {
                console.error('[SkillLibrary] 마켓플레이스 검색 오류:', error);
                const esc = window.escapeHtml || (s => s);
                grid.innerHTML = `<div class="sl-error">${esc(error.message)}</div>`;
            }
        },

        renderMpSkills: function () {
            const grid = document.getElementById('mpSkillsGrid');
            if (!grid) return;

            if (mpSkills.length === 0) {
                grid.innerHTML = '<div class="sl-empty">검색 결과가 없습니다.</div>';
                return;
            }

            const esc = window.escapeHtml || (s => s);

            grid.innerHTML = mpSkills.map(skill => {
                const idParams = esc(JSON.stringify({ repo: skill.repo, path: skill.path }));
                return `
                <div class="skill-card">
                    <div class="skill-card-top">
                        <span class="skill-card-badge" style="background:rgba(59,130,246,0.15);color:var(--accent-primary,#3b82f6)">${esc(skill.category || 'general')}</span>
                    </div>
                    <h3 class="skill-card-title" title="${esc(skill.name)}">${esc(skill.name)}</h3>
                    <p class="skill-card-desc" title="${esc(skill.description || '')}">${esc(skill.description || '설명이 없습니다.')}</p>
                    <small style="color:var(--text-muted,#64748b);font-size:0.75rem;display:flex;align-items:center;gap:0.25rem;margin-bottom:0.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(skill.repo)}">
                        <span class="iconify" data-icon="lucide:github"></span> ${esc(skill.repo)}
                    </small>
                    <div class="skill-card-actions">
                        <button class="sl-btn sl-btn-outline sl-btn-sm" style="flex:1" onclick='sl_viewMpSkill(${idParams})'>미리보기</button>
                        <button class="sl-btn sl-btn-primary sl-btn-sm" style="flex:1" onclick='sl_importSkill(${idParams}, event)'>
                            <span class="iconify" data-icon="lucide:download-cloud"></span> 설치
                        </button>
                    </div>
                </div>`;
            }).join('');
        },

        importMpSkill: async function (paramsStr, event) {
            try {
                const btn = event ? event.currentTarget : null;
                let orgHtml = '';
                if (btn) {
                    orgHtml = btn.innerHTML;
                    btn.innerHTML = '<div class="sl-spinner" style="width:1rem;height:1rem;display:inline-block"></div> 설치 중...';
                    btn.disabled = true;
                }

                const response = await window.authFetch('/api/skills-marketplace/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        repo: paramsStr.repo,
                        path: paramsStr.path
                    })
                });

                const data = await response.json();
                if (btn) {
                    btn.innerHTML = orgHtml;
                    btn.disabled = false;
                }

                if (response.ok && data.success) {
                    if (window.showToast) window.showToast('스킬이 설치되어 모든 에이전트에 자동 적용됩니다.', 'success');
                    this.loadLocalSkills();
                } else {
                    if (window.showToast) window.showToast(data.message || '알 수 없는 오류', 'error');
                }
            } catch (err) {
                if (window.showToast) window.showToast('스킬 임포트 실패: ' + err.message, 'error');
            }
        },

        toggleUserSkill: async function (skillId, currentlyAssigned) {
            try {
                const method = currentlyAssigned ? 'DELETE' : 'POST';
                const res = await window.authFetch(`/api/agents/skills/${skillId}/user-assign`, { method });
                const data = await res.json();
                if (res.ok && data.success) {
                    if (currentlyAssigned) {
                        userAssignedIds.delete(skillId);
                        if (window.showToast) window.showToast('개인 스킬 적용이 해제되었습니다.', 'success');
                    } else {
                        userAssignedIds.add(skillId);
                        if (window.showToast) window.showToast('이 스킬이 나에게만 적용됩니다.', 'success');
                    }
                    this.renderLocalSkills();
                } else {
                    if (window.showToast) window.showToast(data.message || data.error?.message || '오류 발생', 'error');
                }
            } catch (e) {
                if (window.showToast) window.showToast('오류 발생: ' + e.message, 'error');
            }
        },

        viewMpSkillDetail: async function (paramsStr) {
            try {
                const res = await window.authFetch(`/api/skills-marketplace/detail?repo=${encodeURIComponent(paramsStr.repo)}&path=${encodeURIComponent(paramsStr.path)}`);
                const data = await res.json();
                if (res.ok && data.success) {
                    alert(`[SKILL.md 미리보기]\n\nName: ${data.data.parsed.name}\nCategory: ${data.data.parsed.category}\n\n${data.data.parsed.content.substring(0, 300)}...`);
                } else {
                    if (window.showToast) window.showToast('조회 실패: ' + data.message, 'error');
                }
            } catch (e) {
                if (window.showToast) window.showToast('조회 실패: ' + e.message, 'error');
            }
        },

        openNewSkillModal: function () {
            // 커스텀 에이전트 메뉴로 이동
            if (window.Router && window.Router.navigate) {
                window.Router.navigate('/custom-agents.html');
            } else {
                const navLink = document.querySelector('[data-route="custom-agents"]');
                if (navLink) navLink.click();
            }
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('open-skill-editor'));
            }, 400);
        },

        editLocalSkill: function (id) {
            if (window.Router && window.Router.navigate) {
                window.Router.navigate('/custom-agents.html');
            } else {
                const navLink = document.querySelector('[data-route="custom-agents"]');
                if (navLink) navLink.click();
            }
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('edit-local-skill', { detail: { id } }));
            }, 400);
        },

        exportSkill: function (id) {
            window.location.href = `/api/agents/skills/${id}/export`;
        },

        deleteLocalSkill: async function (id) {
            if (!confirm('정말 이 스킬을 삭제하시겠습니까? 연결된 에이전트에서도 제거됩니다.')) return;
            try {
                const res = await window.authFetch(`/api/agents/skills/${id}`, { method: 'DELETE' });
                const data = await res.json();
                if (res.ok && data.success) {
                    if (window.showToast) window.showToast('스킬이 삭제되었습니다.', 'success');
                    this.loadLocalSkills();
                    this.loadLocalCategories();
                } else {
                    if (window.showToast) window.showToast('삭제 실패: ' + data.message, 'error');
                }
            } catch (e) {
                if (window.showToast) window.showToast('오류 발생: ' + e.message, 'error');
            }
        },

        renderPagination: function (containerId, currentPage, totalItems, limit, changeFnName) {
            const container = document.getElementById(containerId);
            if (!container) return;

            const totalPages = Math.ceil(totalItems / limit);
            if (totalPages <= 1) {
                container.innerHTML = '';
                return;
            }

            const startPage = Math.max(1, currentPage - 2);
            const endPage = Math.min(totalPages, startPage + 4);

            let html = `<button class="sl-page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="window.${changeFnName}(${currentPage - 1})">이전</button>`;

            for (let i = startPage; i <= endPage; i++) {
                html += `<button class="sl-page-btn ${i === currentPage ? 'active' : ''}" onclick="window.${changeFnName}(${i})">${i}</button>`;
            }

            html += `<button class="sl-page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="window.${changeFnName}(${currentPage + 1})">다음</button>`;

            container.innerHTML = html;
        }
    };
})();
