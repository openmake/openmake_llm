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
    let editingSkillId = null; // 현재 편집 중인 스킬 ID (null = 새 스킬)

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
    <!-- 인라인 스킬 편집 모달 -->
    <div class="sl-modal-overlay" id="slSkillModal">
        <div class="sl-modal">
            <h2 id="slSkillModalTitle">스킬 편집</h2>
            <div class="sl-form-group">
                <label class="sl-form-label" for="slSkillName">스킬 이름 *</label>
                <input type="text" id="slSkillName" class="sl-form-input" placeholder="스킬 이름">
            </div>
            <div class="sl-form-group">
                <label class="sl-form-label" for="slSkillDesc">설명</label>
                <textarea id="slSkillDesc" class="sl-form-textarea" rows="2" placeholder="스킬 설명..."></textarea>
            </div>
            <div class="sl-form-group">
                <label class="sl-form-label" for="slSkillCategory">카테고리</label>
                <select id="slSkillCategory" class="sl-form-select">
                    <option value="general">일반</option>
                    <option value="coding">코딩</option>
                    <option value="writing">글쓰기</option>
                    <option value="analysis">분석</option>
                    <option value="creative">창작</option>
                    <option value="education">교육</option>
                    <option value="business">비즈니스</option>
                    <option value="science">과학</option>
                </select>
            </div>
            <div class="sl-form-group">
                <label class="sl-form-label" for="slSkillContent">스킬 내용 (시스템 프롬프트에 주입될 텍스트)</label>
                <textarea id="slSkillContent" class="sl-form-textarea mono" rows="12" placeholder="스킬 내용을 입력하세요..."></textarea>
            </div>
            <div class="sl-modal-actions">
                <button class="sl-btn sl-btn-secondary" onclick="sl_closeSkillModal()">취소</button>
                <button class="sl-btn sl-btn-primary" onclick="sl_saveSkill()">저장</button>
            </div>
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
             'sl_toggleUserSkill', 'sl_saveSkill', 'sl_closeSkillModal'].forEach(key => {
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
            window.sl_saveSkill = this.saveSkillFromModal.bind(this);
            window.sl_closeSkillModal = this.closeSkillModal.bind(this);
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

                if (!response.ok || !data.success) throw new Error(data.error?.message || data.message || '스킬 로드 실패');

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
                const esc = window.escapeHtml || (s => s);
                grid.innerHTML = `<div class="sl-error">${esc(error.message)}</div>`;
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
                    ? '<span class="sl-badge" style="background:rgba(168,85,247,0.12);color:var(--accent-primary);border-color:rgba(168,85,247,0.25);margin-left:0.4rem" title="나에게만 적용된 스킬">👤 나만</span>'
                    : '';
                const toggleLabel = isUserAssigned ? '👤 나만 적용 해제' : '👤 나만 적용';
                const isSystemSkill = !skill.createdBy;
                const systemBadge = isSystemSkill ? '<span class="sl-badge" style="background:rgba(59,130,246,0.12);color:var(--info-color,#3b82f6);border-color:rgba(59,130,246,0.25);margin-left:0.4rem" title="시스템 스킬">🔒 시스템</span>' : '';
                return `
                <div class="skill-card">
                    <div class="skill-card-top">
                        <span class="skill-card-badge">${esc(skill.category || 'general')}${userBadge}${systemBadge}</span>
                        <div class="skill-card-menu">
                            <button class="skill-card-menu-btn" title="더 보기"
                                onclick="(function(btn){btn.nextElementSibling.classList.toggle('open');event.stopPropagation();})(this)">⋯</button>
                            <div class="skill-card-dropdown">
                                <a href="#" onclick="sl_toggleUserSkill('${esc(skill.id)}', ${isUserAssigned});return false;">
                                    <span class="iconify" data-icon="lucide:user"></span> ${toggleLabel}
                                </a>
                                ${!isSystemSkill ? `<a href="#" onclick="sl_editSkill('${esc(skill.id)}');return false;">
                                    <span class="iconify" data-icon="lucide:edit-2"></span> 수정
                                </a>
                                <a href="#" onclick="sl_exportSkill('${esc(skill.id)}');return false;">
                                    <span class="iconify" data-icon="lucide:download"></span> 다운로드 (.SKILL)
                                </a>
                                <hr>
                                <a href="#" class="danger" onclick="sl_deleteSkill('${esc(skill.id)}');return false;">
                                    <span class="iconify" data-icon="lucide:trash-2"></span> 삭제
                                </a>` : ''}
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
                    if (window.showToast) window.showToast(data.error?.message || data.message || '알 수 없는 오류', 'error');
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
                    if (window.showToast) window.showToast(data.error?.message || data.message || '오류 발생', 'error');
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
                    if (window.showToast) window.showToast('조회 실패: ' + (data.error?.message || data.message || '알 수 없는 오류'), 'error');
                }
            } catch (e) {
                if (window.showToast) window.showToast('조회 실패: ' + e.message, 'error');
            }
        },

        openNewSkillModal: function () {
            this.openSkillModal(null);
        },
        editLocalSkill: function (id) {
            this.openSkillModal(id);
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
                    if (window.showToast) window.showToast('삭제 실패: ' + (data.error?.message || data.message || '알 수 없는 오류'), 'error');
                }
            } catch (e) {
                if (window.showToast) window.showToast('오류 발생: ' + e.message, 'error');
            }
        },

        // -------------------------------------------------------
        // 인라인 스킬 편집 모달
        // -------------------------------------------------------

        /**
         * 스킬 편집 모달 오픈 (id=null 이면 새 스킬 등록)
         */
        openSkillModal: function (id) {
            editingSkillId = id || null;
            const modal = document.getElementById('slSkillModal');
            if (!modal) return;
            const titleEl = document.getElementById('slSkillModalTitle');
            if (id) {
                titleEl.textContent = '스킬 편집';
                const skill = localSkills.find(function (s) { return s.id === id; });
                if (skill) {
                    document.getElementById('slSkillName').value = skill.name || '';
                    document.getElementById('slSkillDesc').value = skill.description || '';
                    document.getElementById('slSkillCategory').value = skill.category || 'general';
                    document.getElementById('slSkillContent').value = skill.content || '';
                    modal.classList.add('open');
                } else {
                    // localSkills에 없으면 빈 폼으로 오픈
                    document.getElementById('slSkillName').value = '';
                    document.getElementById('slSkillDesc').value = '';
                    document.getElementById('slSkillCategory').value = 'general';
                    document.getElementById('slSkillContent').value = '';
                    modal.classList.add('open');
                }
            } else {
                titleEl.textContent = '새 스킬 등록';
                document.getElementById('slSkillName').value = '';
                document.getElementById('slSkillDesc').value = '';
                document.getElementById('slSkillCategory').value = 'general';
                document.getElementById('slSkillContent').value = '';
                modal.classList.add('open');
            }
        },

        saveSkillFromModal: async function () {
            const name = (document.getElementById('slSkillName').value || '').trim();
            if (!name) {
                if (window.showToast) window.showToast('스킬 이름을 입력하세요', 'error');
                return;
            }
            const body = {
                name: name,
                description: (document.getElementById('slSkillDesc').value || '').trim(),
                category: document.getElementById('slSkillCategory').value || 'general',
                content: (document.getElementById('slSkillContent').value || '').trim(),
            };
            try {
                let res;
                if (editingSkillId) {
                    res = await window.authFetch('/api/agents/skills/' + editingSkillId, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                } else {
                    res = await window.authFetch('/api/agents/skills', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                }
                const data = await res.json();
                if (res.ok && data.success) {
                    if (window.showToast) window.showToast(editingSkillId ? '스킬이 저장되었습니다.' : '새 스킬이 등록되었습니다.', 'success');
                    this.closeSkillModal();
                    this.loadLocalSkills();
                    this.loadLocalCategories();
                } else {
                    if (window.showToast) window.showToast('저장 실패: ' + (data.error?.message || data.message || '알 수 없는 오류'), 'error');
                }
            } catch (e) {
                if (window.showToast) window.showToast('오류: ' + e.message, 'error');
            }
        },

        closeSkillModal: function () {
            const modal = document.getElementById('slSkillModal');
            if (modal) modal.classList.remove('open');
            editingSkillId = null;
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
