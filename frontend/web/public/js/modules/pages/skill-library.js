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

    window.PageModules['skill-library'] = {
        getHTML: function () {
            return '<div id="skill-library-root"><div class="text-center p-5"><div class="spinner-border text-primary" role="status"></div></div></div>';
        },

        init: async function () {
            try {
                // 1. HTML 마크업 로드
                const res = await fetch('/skill-library.html');
                if (!res.ok) throw new Error('HTML 로드 실패');
                const html = await res.text();

                const root = document.getElementById('skill-library-root');
                if (root) {
                    root.innerHTML = html;

                    // 2. 초기화 작업
                    this.setupEventListeners();
                    await this.loadLocalCategories();
                    await this.loadLocalSkills();
                }
            } catch (e) {
                console.error('Skill Library init error:', e);
                const root = document.getElementById('skill-library-root');
                if (root) root.innerHTML = '<div class="alert alert-danger m-4">스킬 라이브러리를 블러오지 못했습니다.</div>';
            }

            // 모달 오픈 이벤트 리스너 추가 (custom-agents 연동)
            window.addEventListener('open-skill-editor', this.onOpenSkillEditor);
            window.addEventListener('edit-local-skill', this.onEditLocalSkill);
        },

        cleanup: function () {
            window.removeEventListener('open-skill-editor', this.onOpenSkillEditor);
            window.removeEventListener('edit-local-skill', this.onEditLocalSkill);
        },

        onOpenSkillEditor: function () {
            // custom-agents의 함수 호출
            if (window.btnNewSkill) {
                document.getElementById('btnNewSkill')?.click();
            }
        },

        onEditLocalSkill: function (e) {
            const id = e.detail?.id;
            if (id && typeof window.editSkill === 'function') {
                window.editSkill(id);
            }
        },

        setupEventListeners: function () {
            const self = this;

            // 로컬 스킬 탭 검색/필터
            document.getElementById('localSearchInput')?.addEventListener('input', window.debounce((e) => {
                localFilters.search = e.target.value;
                localFilters.page = 1;
                self.loadLocalSkills();
            }, 500));

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

            // 글로벌 함수 노출 (HTML onclick 연동)
            window.sl_openNewSkill = this.openNewSkillModal.bind(this);
            window.sl_editSkill = this.editLocalSkill.bind(this);
            window.sl_deleteSkill = this.deleteLocalSkill.bind(this);
            window.sl_exportSkill = this.exportSkill.bind(this);
            window.sl_importSkill = this.importMpSkill.bind(this);
            window.sl_viewMpSkill = this.viewMpSkillDetail.bind(this);
            window.sl_changeLocalPage = (p) => { localFilters.page = p; self.loadLocalSkills(); };
            window.sl_changeMpPage = (p) => { mpFilters.page = p; self.loadMpSkills(); };
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

            grid.innerHTML = '<div class="text-center p-5 w-100"><div class="spinner-border text-primary" role="status"></div></div>';

            try {
                const offset = (localFilters.page - 1) * localFilters.limit;
                const queryParams = new URLSearchParams({
                    search: localFilters.search,
                    category: localFilters.category,
                    sortBy: localFilters.sortBy,
                    limit: localFilters.limit,
                    offset: offset
                });

                const response = await window.authFetch(`/api/agents/skills?${queryParams.toString()}`);
                const data = await response.json();

                if (!response.ok || !data.success) throw new Error(data.message || '스킬 로드 실패');

                localSkills = data.data.skills || [];
                localFilters.total = data.data.total || 0;

                this.renderLocalSkills();
                this.renderPagination('localPagination', localFilters.page, localFilters.total, localFilters.limit, 'sl_changeLocalPage');

            } catch (error) {
                console.error(error);
                grid.innerHTML = `<div class="alert alert-danger w-100">${window.escapeHtml(error.message)}</div>`;
            }
        },

        renderLocalSkills: function () {
            const grid = document.getElementById('localSkillsGrid');
            if (!grid) return;

            if (localSkills.length === 0) {
                grid.innerHTML = '<div class="text-center p-5 text-secondary w-100">조회된 스킬이 없습니다. 새 스킬을 등록하거나 마켓플레이스에서 가져와보세요.</div>';
                return;
            }

            grid.innerHTML = localSkills.map(skill => `
                <div class="skill-card">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <span class="skill-card-badge">${window.escapeHtml(skill.category || 'general')}</span>
                        <div class="dropdown">
                            <button class="btn btn-sm btn-icon text-secondary" type="button" data-bs-toggle="dropdown">
                                <span class="iconify" data-icon="lucide:more-vertical"></span>
                            </button>
                            <ul class="dropdown-menu dropdown-menu-end bg-surface border-secondary">
                                <li><a class="dropdown-item text-white" href="#" onclick="sl_editSkill('${skill.id}')"><span class="iconify me-2" data-icon="lucide:edit-2"></span>수정</a></li>
                                <li><a class="dropdown-item text-white" href="#" onclick="sl_exportSkill('${skill.id}')"><span class="iconify me-2" data-icon="lucide:download"></span>다운로드 (.SKILL)</a></li>
                                <li><hr class="dropdown-divider border-secondary"></li>
                                <li><a class="dropdown-item text-danger" href="#" onclick="sl_deleteSkill('${skill.id}')"><span class="iconify me-2" data-icon="lucide:trash-2"></span>삭제</a></li>
                            </ul>
                        </div>
                    </div>
                    <h3 class="skill-card-title" title="${window.escapeHtml(skill.name)}">${window.escapeHtml(skill.name)}</h3>
                    <p class="skill-card-desc" title="${window.escapeHtml(skill.description || '')}">${window.escapeHtml(skill.description || '설명이 없습니다.')}</p>
                    <div class="skill-card-footer">
                        <small class="text-secondary opacity-75">${new Date(skill.createdAt).toLocaleDateString()}</small>
                        ${skill.isPublic ? '<span class="badge bg-success-subtle border border-success-subtle text-success rounded-pill px-2">Public</span>' : '<span class="badge bg-secondary-subtle border border-secondary-subtle text-light rounded-pill px-2"><span class="iconify me-1" data-icon="lucide:lock" style="font-size:10px"></span>Private</span>'}
                    </div>
                </div>
            `).join('');
        },

        loadMpSkills: async function () {
            const grid = document.getElementById('mpSkillsGrid');
            if (!grid) return;

            if (!mpFilters.query) {
                grid.innerHTML = '<div class="text-center p-5 w-100 text-secondary">검색어를 입력하고 버튼을 눌러 스킬을 찾아보세요.</div>';
                return;
            }

            grid.innerHTML = '<div class="text-center p-5 w-100"><div class="spinner-border text-primary" role="status"></div><p class="mt-3 text-secondary">마켓플레이스 연동 중...</p></div>';

            try {
                const offset = (mpFilters.page - 1) * mpFilters.limit;
                const queryParams = new URLSearchParams({
                    query: mpFilters.query,
                    limit: mpFilters.limit,
                    offset: offset
                });

                const response = await window.authFetch(`/api/skills-marketplace/search?${queryParams.toString()}`);
                const data = await response.json();

                if (!response.ok || !data.success) throw new Error(data.message || '마켓플레이스 검색 실패');

                mpSkills = data.data.skills || [];
                mpFilters.total = data.data.total || 0;

                this.renderMpSkills();
                this.renderPagination('mpPagination', mpFilters.page, mpFilters.total, mpFilters.limit, 'sl_changeMpPage');

            } catch (error) {
                console.error(error);
                grid.innerHTML = `<div class="alert alert-danger w-100">${window.escapeHtml(error.message)}</div>`;
            }
        },

        renderMpSkills: function () {
            const grid = document.getElementById('mpSkillsGrid');
            if (!grid) return;

            if (mpSkills.length === 0) {
                grid.innerHTML = '<div class="text-center p-5 text-secondary w-100">검색 결과가 없습니다.</div>';
                return;
            }

            grid.innerHTML = mpSkills.map(skill => {
                const idParams = window.escapeHtml(JSON.stringify({ repo: skill.repo, path: skill.path }));
                return `
                <div class="skill-card">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <span class="skill-card-badge bg-primary-subtle text-primary border-primary">${window.escapeHtml(skill.category || 'general')}</span>
                    </div>
                    <h3 class="skill-card-title text-truncate" title="${window.escapeHtml(skill.name)}">${window.escapeHtml(skill.name)}</h3>
                    <p class="skill-card-desc mb-2" title="${window.escapeHtml(skill.description || '')}">${window.escapeHtml(skill.description || '설명이 없습니다.')}</p>
                    <small class="text-secondary d-flex align-items-center gap-1 mb-3 text-truncate" title="${window.escapeHtml(skill.repo)}"><span class="iconify" data-icon="lucide:github"></span> ${window.escapeHtml(skill.repo)}</small>
                    
                    <div class="skill-card-footer mt-auto pt-3 border-top border-secondary d-flex gap-2">
                        <button class="btn btn-sm btn-outline-secondary flex-grow-1" onclick='sl_viewMpSkill(${idParams})'>미리보기</button>
                        <button class="btn btn-sm btn-primary flex-grow-1 d-flex align-items-center justify-content-center gap-1" onclick='sl_importSkill(${idParams}, event)'>
                            <span class="iconify" data-icon="lucide:download-cloud"></span> 설치
                        </button>
                    </div>
                </div>
            `}).join('');
        },

        importMpSkill: async function (paramsStr, event) {
            try {
                const btn = event ? event.currentTarget : null;
                let orgHtml = '';
                if (btn) {
                    orgHtml = btn.innerHTML;
                    btn.innerHTML = '<span class="spinner-border spinner-border-sm mr-1"></span> 설치 중...';
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
                    window.showToast('마켓플레이스 스킬을 로컬에 저장했습니다.', 'success');
                    this.loadLocalSkills();
                } else {
                    window.showToast(data.message || '알 수 없는 오류', 'error');
                }
            } catch (err) {
                window.showToast('스킬 임포트 실패: ' + err.message, 'error');
            }
        },

        viewMpSkillDetail: async function (paramsStr) {
            try {
                const res = await window.authFetch(`/api/skills-marketplace/detail?repo=${encodeURIComponent(paramsStr.repo)}&path=${encodeURIComponent(paramsStr.path)}`);
                const data = await res.json();
                if (res.ok && data.success) {
                    alert(`[SKILL.md 미리보기]\n\nName: ${data.data.parsed.name}\nCategory: ${data.data.parsed.category}\n\n${data.data.parsed.content.substring(0, 300)}...`);
                } else {
                    window.showToast('조회 실패: ' + data.message, 'error');
                }
            } catch (e) {
                window.showToast('조회 실패: ' + e.message, 'error');
            }
        },

        openNewSkillModal: function () {
            // 커스텀 에이전트 메뉴로 이동
            const navLink = document.querySelector('[data-route="custom-agents"]');
            if (navLink) {
                if (window.Router && window.Router.navigate) {
                    window.Router.navigate('/custom-agents.html');
                } else {
                    navLink.click();
                }
                setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('open-skill-editor'));
                }, 400);
            }
        },

        editLocalSkill: function (id) {
            const navLink = document.querySelector('[data-route="custom-agents"]');
            if (navLink) {
                if (window.Router && window.Router.navigate) {
                    window.Router.navigate('/custom-agents.html');
                } else {
                    navLink.click();
                }
                setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('edit-local-skill', { detail: { id } }));
                }, 400);
            }
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
                    window.showToast('스킬이 삭제되었습니다.', 'success');
                    this.loadLocalSkills();
                    this.loadLocalCategories();
                } else {
                    window.showToast('삭제 실패: ' + data.message, 'error');
                }
            } catch (e) {
                window.showToast('오류 발생: ' + e.message, 'error');
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

            let html = '<ul class="pagination pagination-sm">';
            html += `<li class="page-item ${currentPage === 1 ? 'disabled' : ''}"><a class="page-link bg-surface border-secondary text-white" href="#" onclick="${changeFnName}(${currentPage - 1}); return false;">이전</a></li>`;

            const startPage = Math.max(1, currentPage - 2);
            const endPage = Math.min(totalPages, startPage + 4);

            for (let i = startPage; i <= endPage; i++) {
                html += `<li class="page-item ${i === currentPage ? 'active' : ''}"><a class="page-link ${i === currentPage ? 'bg-primary border-primary text-white' : 'bg-surface border-secondary text-white'}" href="#" onclick="${changeFnName}(${i}); return false;">${i}</a></li>`;
            }

            html += `<li class="page-item ${currentPage === totalPages ? 'disabled' : ''}"><a class="page-link bg-surface border-secondary text-white" href="#" onclick="${changeFnName}(${currentPage + 1}); return false;">다음</a></li>`;
            html += '</ul>';

            container.innerHTML = html;
        }
    };
})();
