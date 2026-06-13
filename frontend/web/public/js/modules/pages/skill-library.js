/**
 * =========================================================================
 * Skill Library - 스킬 라이브러리 모듈 (SPA PageModule)
 * =========================================================================
 */
'use strict';
    window.PageModules = window.PageModules || {};

    /** 카테고리 ID → 한국어 레이블 매핑 */
    const CATEGORY_LABELS = {
        general: '일반',
        coding: '코딩',
        writing: '글쓰기',
        analysis: '분석',
        creative: '창작/디자인',
        education: '교육/학습',
        business: '비즈니스',
        science: '과학/연구',
        technology: '기술/IT',
        finance: '금융/투자',
        healthcare: '의료/건강',
        legal: '법률',
        engineering: '엔지니어링',
        media: '미디어',
        'social-welfare': '사회/복지',
        government: '공공/정부',
        'real-estate': '부동산',
        energy: '에너지/환경',
        logistics: '물류/운송',
        hospitality: '관광/서비스',
        agriculture: '농업/식품',
        special: '특수 분야',
        productivity: '생산성',
        communication: '커뮤니케이션',
    };

    function categoryLabel(id) {
        return CATEGORY_LABELS[id] || id || '일반';
    }

    let localSkills = [];
    let userAssignedIds = new Set(); // 사용자 개인 할당 스킬 ID 집합
    let editingSkillId = null; // 현재 편집 중인 스킬 ID (null = 새 스킬)
    let drafts = []; // AI 자동 생성 draft 목록
    let draftsLoaded = false; // drafts 탭 첫 진입 시에만 자동 로드

    let localFilters = {
        search: '',
        category: '',
        sortBy: 'newest',
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
        <p>로컬에 설치된 에이전트 스킬을 관리합니다.</p>
        <div class="sl-tabs" role="tablist">
            <button class="sl-tab active" data-sl-tab="local" role="tab" aria-selected="true">내 스킬</button>
            <button class="sl-tab" data-sl-tab="drafts" role="tab" aria-selected="false">AI 자동 생성 (Drafts)</button>
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
                    <select id="localCategoryFilter" class="sl-select" aria-label="카테고리 필터">
                        <option value="">모든 카테고리</option>
                    </select>
                    <select id="localSortSelect" class="sl-select" aria-label="정렬">
                        <option value="newest">최신순</option>
                        <option value="updated">업데이트순</option>
                        <option value="name">이름순</option>
                        <option value="category">카테고리순</option>
                    </select>
                </div>
                <button class="sl-btn sl-btn-secondary" id="btnUploadSkill" title=".SKILL 또는 .md 파일 업로드">
                    <span class="iconify" data-icon="lucide:upload"></span> 업로드
                </button>
                <input type="file" id="skillUploadInput" accept=".skill,.md" style="display:none">
                <button class="sl-btn sl-btn-primary" id="btnNewSkill">
                    <span class="iconify" data-icon="lucide:plus"></span> 새 스킬 등록
                </button>
            </div>

            <!-- 리스트 컬럼 헤더 (skill-row 와 동일 구조로 정렬) -->
            <div class="skill-row skill-row-header" role="row" aria-hidden="false">
                <div class="skill-row-meta">카테고리</div>
                <div class="skill-row-main">이름 · 설명</div>
                <div class="skill-row-side">공개 / 등록일</div>
                <div class="skill-row-actions">작업</div>
            </div>

            <div id="localSkillsGrid" class="skill-grid">
                <div class="sl-loading"><div class="sl-spinner"></div></div>
            </div>
            <div id="localPagination" class="sl-pagination"></div>
        </div>

        <!-- AI 자동 생성 (Drafts) 탭 -->
        <div class="sl-pane" id="sl-pane-drafts" role="tabpanel">
            <div class="sl-toolbar">
                <div class="sl-search-group" style="flex:1">
                    <p style="margin:0;color:var(--text-secondary,#a0a0a0);font-size:var(--font-size-sm)">
                        자연어로 스킬의 목적을 설명하면 AI 가 매니페스트를 자동 작성합니다. 검토 후 승인하면 활성화됩니다.
                    </p>
                </div>
                <button class="sl-btn sl-btn-primary" id="btnOpenAutoCreate">
                    <span class="iconify" data-icon="lucide:sparkles"></span> AI 로 새 스킬 만들기
                </button>
            </div>

            <div class="skill-row skill-row-header" role="row" aria-hidden="false">
                <div class="skill-row-meta">카테고리</div>
                <div class="skill-row-main">이름 · 설명</div>
                <div class="skill-row-side">생성 정보</div>
                <div class="skill-row-actions">작업</div>
            </div>

            <div id="draftsGrid" class="skill-grid">
                <div class="sl-empty">"AI 로 새 스킬 만들기" 버튼을 눌러 시작하세요.</div>
            </div>
        </div>
    </div>

    <!-- AI 자동 생성 모달 -->
    <div class="sl-modal-overlay" id="slAutoCreateModal">
        <div class="sl-modal">
            <h2>AI 자동 스킬 생성</h2>
            <div class="sl-form-group">
                <label class="sl-form-label">생성 방식</label>
                <div style="display:flex; gap:0.5rem">
                    <button type="button" class="sl-btn sl-btn-sm sl-btn-mode active" data-ac-mode="prompt">자연어 prompt</button>
                    <button type="button" class="sl-btn sl-btn-sm sl-btn-mode" data-ac-mode="git">Git URL 가져오기</button>
                </div>
            </div>
            <div class="sl-form-group" id="acGitUrlGroup" style="display:none">
                <label class="sl-form-label" for="acGitUrl">Git URL <span style="color:var(--danger-color,#ef4444)">*</span></label>
                <input type="text" id="acGitUrl" class="sl-form-input" placeholder="https://github.com/owner/repo 또는 owner/repo" maxlength="500">
                <small style="color:var(--text-secondary);font-size:var(--font-size-xs)">GitHub public repo. private/rate-limit 우회: 아래 access token 옵션</small>
            </div>
            <div class="sl-form-group" id="acGitPathGroup" style="display:none">
                <label class="sl-form-label" for="acGitPath">파일 경로 (선택)</label>
                <input type="text" id="acGitPath" class="sl-form-input" placeholder="skills/legal.SKILL.md (미지정 시 자동 스캔)" maxlength="500">
            </div>
            <div class="sl-form-group" id="acGitTokenGroup" style="display:none">
                <label class="sl-form-label" for="acGitToken">GitHub access token (선택)</label>
                <input type="password" id="acGitToken" class="sl-form-input" placeholder="ghp_..." maxlength="200">
                <small style="color:var(--text-secondary);font-size:var(--font-size-xs)">요청 한정, DB 미저장</small>
            </div>
            <div class="sl-form-group">
                <label class="sl-form-label" for="acPurpose">목적 / 역할 <span style="color:var(--danger-color,#ef4444)">*</span></label>
                <textarea id="acPurpose" class="sl-form-textarea" rows="2" placeholder="예: 한국 의료법 자문 — 의료기기법·약사법·임상시험 규정에 답변" maxlength="500"></textarea>
                <small style="color:var(--text-secondary);font-size:var(--font-size-xs)">5~500자. 만들고자 하는 스킬이 어떤 일을 해야 하는지.</small>
            </div>
            <div class="sl-form-group">
                <label class="sl-form-label" for="acCategory">카테고리 (선택)</label>
                <select id="acCategory" class="sl-form-select">
                    <option value="">자동 결정</option>
                    <option value="general">일반</option>
                    <option value="coding">코딩</option>
                    <option value="writing">글쓰기</option>
                    <option value="analysis">분석</option>
                    <option value="creative">창작</option>
                    <option value="education">교육</option>
                    <option value="business">비즈니스</option>
                    <option value="science">과학</option>
                    <option value="technology">기술/IT</option>
                    <option value="finance">금융</option>
                    <option value="healthcare">의료/건강</option>
                    <option value="legal">법률</option>
                    <option value="engineering">엔지니어링</option>
                    <option value="media">미디어</option>
                    <option value="social-welfare">사회/복지</option>
                    <option value="government">공공/정부</option>
                    <option value="real-estate">부동산</option>
                    <option value="energy">에너지/환경</option>
                    <option value="logistics">물류/운송</option>
                    <option value="hospitality">관광/서비스</option>
                    <option value="agriculture">농업/식품</option>
                    <option value="productivity">생산성</option>
                    <option value="communication">커뮤니케이션</option>
                </select>
            </div>
            <div class="sl-form-group">
                <label class="sl-form-label" for="acExamples">예시 질문/작업 (선택, 한 줄당 하나, 최대 5개)</label>
                <textarea id="acExamples" class="sl-form-textarea" rows="4" placeholder="의료기기 인증 절차를 알려줘&#10;임상시험 IRB 승인 요건은?&#10;..."></textarea>
            </div>
            <div class="sl-form-group">
                <label class="sl-form-label" for="acHints">추가 지침 (선택, 최대 1000자)</label>
                <textarea id="acHints" class="sl-form-textarea" rows="2" placeholder="예: 한국법만 다루고, 출처를 명시할 것" maxlength="1000"></textarea>
            </div>
            <div class="sl-form-group" id="acTargetGroup" style="display:none">
                <label class="sl-form-label" for="acTarget">대상 (관리자 전용)</label>
                <select id="acTarget" class="sl-form-select">
                    <option value="user">user — 본인 전용</option>
                    <option value="system">system — 전역 공개</option>
                </select>
            </div>
            <!-- GDPR Phase B Fix 5 — 탈퇴 시 manifest 처리 안내 -->
            <div class="sl-form-group" style="background: var(--surface-secondary, #f7f7f7); padding: 10px 12px; border-radius: 6px; font-size: var(--font-size-sm); color: var(--text-muted, #666); line-height: 1.5;">
                <iconify-icon icon=lucide:lightbulb></iconify-icon> <strong>탈퇴 시 안내</strong>: 본인 manifest 는 계정 삭제 시 <code>is_public</code> 이 자동으로 false 처리되어 다른 사용자에게 노출되지 않습니다 (Phase A Fix 1). 운영자가 system manifest 로 publish 한 경우에만 영구 공개됩니다.
            </div>
            <div class="sl-modal-actions">
                <button class="sl-btn sl-btn-secondary" onclick="sl_closeAutoCreate()">취소</button>
                <button class="sl-btn sl-btn-primary" id="btnSubmitAutoCreate" onclick="sl_submitAutoCreate()">
                    <span class="iconify" data-icon="lucide:sparkles"></span> 생성하기
                </button>
            </div>
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
                    <option value="technology">기술/IT</option>
                    <option value="finance">금융</option>
                    <option value="healthcare">의료/건강</option>
                    <option value="legal">법률</option>
                    <option value="engineering">엔지니어링</option>
                    <option value="media">미디어</option>
                    <option value="social-welfare">사회/복지</option>
                    <option value="government">공공/정부</option>
                    <option value="real-estate">부동산</option>
                    <option value="energy">에너지/환경</option>
                    <option value="logistics">물류/운송</option>
                    <option value="hospitality">관광/서비스</option>
                    <option value="agriculture">농업/식품</option>
                    <option value="productivity">생산성</option>
                    <option value="communication">커뮤니케이션</option>
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
             'sl_changeLocalPage', 'sl_toggleUserSkill', 'sl_saveSkill', 'sl_closeSkillModal',
             'sl_openAutoCreate', 'sl_closeAutoCreate', 'sl_submitAutoCreate',
             'sl_approveDraft', 'sl_rejectDraft'].forEach(key => {
                try { delete window[key]; } catch (e) {}
            });

            // Reset draft state for next session
            drafts = [];
            draftsLoaded = false;

            // Close any open dropdowns
            document.querySelectorAll('.skill-card-dropdown.open').forEach(el => el.classList.remove('open'));
        },

        setupTabs: function () {
            document.querySelectorAll('.sl-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    const target = tab.dataset.slTab;
                    // Update tab buttons
                    document.querySelectorAll('.sl-tab').forEach(t => {
                        t.classList.toggle('active', t.dataset.slTab === target);
                        t.setAttribute('aria-selected', t.dataset.slTab === target ? 'true' : 'false');
                    });
                    // Update panes
                    document.querySelectorAll('.sl-pane').forEach(p => {
                        p.classList.toggle('active', p.id === 'sl-pane-' + target);
                    });
                    // drafts 탭 첫 진입 시 자동 로드
                    if (target === 'drafts' && !draftsLoaded) {
                        this.loadDrafts();
                    }
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

            // New skill button
            document.getElementById('btnNewSkill')?.addEventListener('click', () => {
                this.openNewSkillModal();
            });

            // .SKILL 매니페스트 업로드
            const uploadInput = document.getElementById('skillUploadInput');
            document.getElementById('btnUploadSkill')?.addEventListener('click', () => {
                uploadInput?.click();
            });
            uploadInput?.addEventListener('change', async (ev) => {
                const file = ev.target.files?.[0];
                if (!file) return;
                if (file.size > 256 * 1024) {
                    if (window.showToast) window.showToast('파일이 256KB 를 초과합니다', 'error');
                    ev.target.value = '';
                    return;
                }
                const fd = new FormData();
                fd.append('file', file);
                try {
                    const res = await fetch('/api/agents/skills/upload', {
                        method: 'POST',
                        body: fd,
                        credentials: 'include',
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                        const details = Array.isArray(data?.details) ? `\n- ${data.details.join('\n- ')}` : '';
                        const msg = (data?.error || data?.message || res.statusText) + details;
                        if (window.showToast) window.showToast(`업로드 실패: ${msg}`, 'error');
                        return;
                    }
                    const payload = data?.data || data;
                    const skillId = payload?.skill_id || '?';
                    const ver = payload?.version || '?';
                    const dup = payload?.duplicate_checksum;
                    if (dup) {
                        if (window.showToast) window.showToast(`이미 존재하는 manifest (${skillId} v${ver})`, 'info');
                    } else {
                        if (window.showToast) window.showToast(`업로드 완료: ${skillId} v${ver} (도구 ${payload?.bindings_count ?? 0}개)`, 'success');
                    }
                    this.loadLocalSkills();
                } catch (e) {
                    if (window.showToast) window.showToast('업로드 중 오류: ' + (e?.message || e), 'error');
                } finally {
                    ev.target.value = '';
                }
            });

            // 로컬 스킬 탭 검색/필터
            const localSearch = document.getElementById('localSearchInput');
            if (localSearch) {
                const debouncedSearch = window.debounce ? window.debounce((e) => {
                    localFilters.search = e.target.value;
                    localFilters.page = 1;
                    this.loadLocalSkills();
                }, 500) : (e) => {
                    localFilters.search = e.target.value;
                    localFilters.page = 1;
                    this.loadLocalSkills();
                };
                localSearch.addEventListener('input', debouncedSearch);
            }

            document.getElementById('localCategoryFilter')?.addEventListener('change', (e) => {
                localFilters.category = e.target.value;
                localFilters.page = 1;
                this.loadLocalSkills();
            });

            document.getElementById('localSortSelect')?.addEventListener('change', (e) => {
                localFilters.sortBy = e.target.value;
                localFilters.page = 1;
                this.loadLocalSkills();
            });

            // Global dropdown close on outside click
            document.addEventListener('click', function slDropdownClose(e) {
                if (!e.target.closest('.skill-card-menu')) {
                    document.querySelectorAll('.skill-card-dropdown.open').forEach(d => d.classList.remove('open'));
                }
            });

            // AI 자동 생성 버튼
            document.getElementById('btnOpenAutoCreate')?.addEventListener('click', () => {
                this.openAutoCreateModal();
            });

            // AI 자동 생성 모달 — mode 토글 (prompt ↔ git)
            document.querySelectorAll('[data-ac-mode]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const mode = btn.dataset.acMode;
                    document.querySelectorAll('[data-ac-mode]').forEach(b => b.classList.toggle('active', b === btn));
                    // prompt 필드들 토글
                    ['acPurpose', 'acExamples', 'acHints'].forEach(id => {
                        const el = document.getElementById(id);
                        const group = el?.closest('.sl-form-group');
                        if (group) group.style.display = mode === 'prompt' ? '' : 'none';
                    });
                    // git 필드들 토글
                    ['acGitUrlGroup', 'acGitPathGroup', 'acGitTokenGroup'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.style.display = mode === 'git' ? '' : 'none';
                    });
                });
            });

            // 글로벌 함수 노출
            window.sl_openNewSkill = this.openNewSkillModal.bind(this);
            window.sl_editSkill = this.editLocalSkill.bind(this);
            window.sl_deleteSkill = this.deleteLocalSkill.bind(this);
            window.sl_exportSkill = this.exportSkill.bind(this);
            window.sl_changeLocalPage = (p) => {
                const maxPage = Math.ceil(localFilters.total / localFilters.limit) || 1;
                localFilters.page = Math.min(Math.max(1, p), maxPage);
                this.loadLocalSkills();
            };
            window.sl_toggleUserSkill = this.toggleUserSkill.bind(this);
            window.sl_saveSkill = this.saveSkillFromModal.bind(this);
            window.sl_closeSkillModal = this.closeSkillModal.bind(this);
            // AI 자동 생성 / draft 관리 함수
            window.sl_openAutoCreate = this.openAutoCreateModal.bind(this);
            window.sl_closeAutoCreate = this.closeAutoCreateModal.bind(this);
            window.sl_submitAutoCreate = this.submitAutoCreate.bind(this);
            window.sl_approveDraft = this.approveDraft.bind(this);
            window.sl_rejectDraft = this.rejectDraft.bind(this);
        },

        loadLocalCategories: async function () {
            try {
                const response = await window.authFetch(API_ENDPOINTS.AGENTS_SKILLS + '/categories');
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
                            opt.textContent = `${categoryLabel(c.category)} (${c.count})`;
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
                    window.authFetch(`${API_ENDPOINTS.AGENTS_SKILLS}?${queryParams.toString()}`),
                    window.authFetch(API_ENDPOINTS.AGENTS_SKILLS + '/user-assigned')
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

                // 현재 페이지가 실제 데이터 페이지를 초과하면 마지막 페이지로 자동 이동
                const maxPage = Math.ceil(localFilters.total / localFilters.limit) || 1;
                if (localFilters.page > maxPage) {
                    localFilters.page = maxPage;
                    this.loadLocalSkills();
                    return;
                }

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
                grid.innerHTML = '<div class="sl-empty">조회된 스킬이 없습니다. 새 스킬을 등록해보세요.</div>';
                return;
            }

            const esc = window.escapeHtml || (s => s);

            grid.innerHTML = localSkills.map(skill => {
                const isUserAssigned = userAssignedIds.has(skill.id);
                const userBadge = isUserAssigned
                    ? '<span class="sl-badge" style="background:rgba(168,85,247,0.12);color:var(--accent-primary);border-color:rgba(168,85,247,0.25);margin-left:0.4rem" title="나에게만 적용된 스킬"><iconify-icon icon=lucide:user></iconify-icon> 나만</span>'
                    : '';
                const toggleLabel = isUserAssigned ? '<iconify-icon icon=lucide:user></iconify-icon> 나만 적용 해제' : '<iconify-icon icon=lucide:user></iconify-icon> 나만 적용';
                const isSystemSkill = !skill.createdBy;
                const systemBadge = isSystemSkill ? '<span class="sl-badge" style="background:rgba(59,130,246,0.12);color:var(--info-color,#3b82f6);border-color:rgba(59,130,246,0.25);margin-left:0.4rem" title="시스템 스킬"><iconify-icon icon=lucide:lock></iconify-icon> 시스템</span>' : '';
                const visibilityBadge = skill.isPublic
                    ? '<span class="sl-badge sl-badge-success">Public</span>'
                    : '<span class="sl-badge sl-badge-secondary"><span class="iconify" data-icon="lucide:lock" style="font-size:10px;vertical-align:middle"></span> Private</span>';
                return `
                <div class="skill-row">
                    <div class="skill-row-meta">
                        <span class="skill-card-badge">${esc(categoryLabel(skill.category))}</span>
                        ${userBadge}${systemBadge}
                    </div>
                    <div class="skill-row-main">
                        <h3 class="skill-row-title" title="${esc(skill.name)}">${esc(skill.name)}</h3>
                        <p class="skill-row-desc" title="${esc(skill.description || '')}">${esc(skill.description || '설명이 없습니다.')}</p>
                    </div>
                    <div class="skill-row-side">
                        ${visibilityBadge}
                        <small class="skill-row-date">${new Date(skill.createdAt).toLocaleDateString()}</small>
                    </div>
                    <div class="skill-row-actions skill-card-menu">
                        <button class="skill-card-menu-btn" data-action="toggle-menu" title="더 보기">⋯</button>
                        <div class="skill-card-dropdown">
                            <a href="#" data-action="toggle-user" data-skill-id="${esc(skill.id)}" data-assigned="${isUserAssigned}">
                                <span class="iconify" data-icon="lucide:user"></span> ${toggleLabel}
                            </a>
                            <a href="#" data-action="edit" data-skill-id="${esc(skill.id)}">
                                <span class="iconify" data-icon="lucide:edit-2"></span> 수정
                            </a>
                            <a href="#" data-action="export" data-skill-id="${esc(skill.id)}">
                                <span class="iconify" data-icon="lucide:download"></span> 다운로드 (.SKILL)
                            </a>
                            <hr>
                            <a href="#" class="danger" data-action="delete" data-skill-id="${esc(skill.id)}">
                                <span class="iconify" data-icon="lucide:trash-2"></span> 삭제
                            </a>
                        </div>
                    </div>
                </div>`;
            }).join('');

            // XSS 방지: 인라인 onclick 대신 이벤트 위임 사용
            grid.addEventListener('click', (e) => {
                const menuBtn = e.target.closest('[data-action="toggle-menu"]');
                if (menuBtn) {
                    e.stopPropagation();
                    menuBtn.nextElementSibling.classList.toggle('open');
                    return;
                }
                const link = e.target.closest('a[data-action]');
                if (link) {
                    e.preventDefault();
                    e.stopPropagation();
                    const action = link.dataset.action;
                    const skillId = link.dataset.skillId;
                    if (action === 'toggle-user') sl_toggleUserSkill(skillId, link.dataset.assigned === 'true');
                    else if (action === 'edit') sl_editSkill(skillId);
                    else if (action === 'export') sl_exportSkill(skillId);
                    else if (action === 'delete') sl_deleteSkill(skillId);
                    return;
                }
            });
        },


        toggleUserSkill: async function (skillId, currentlyAssigned) {
            try {
                const method = currentlyAssigned ? 'DELETE' : 'POST';
                const res = await window.authFetch(`${API_ENDPOINTS.AGENTS_SKILLS}/${skillId}/user-assign`, { method });
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

        openNewSkillModal: function () {
            this.openSkillModal(null);
        },
        editLocalSkill: function (id) {
            this.openSkillModal(id);
        },

        exportSkill: function (id) {
            window.location.href = `${API_ENDPOINTS.AGENTS_SKILLS}/${id}/export`;
        },

        deleteLocalSkill: async function (id) {
            if (!confirm('정말 이 스킬을 삭제하시겠습니까? 연결된 에이전트에서도 제거됩니다.')) return;
            try {
                const res = await window.authFetch(`${API_ENDPOINTS.AGENTS_SKILLS}/${id}`, { method: 'DELETE' });
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
                    res = await window.authFetch(API_ENDPOINTS.AGENTS_SKILLS + '/' + editingSkillId, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                } else {
                    res = await window.authFetch(API_ENDPOINTS.AGENTS_SKILLS, {
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

            // 현재 페이지를 유효 범위로 클램핑
            const safePage = Math.min(Math.max(1, currentPage), totalPages);

            const startPage = Math.max(1, safePage - 2);
            const endPage = Math.min(totalPages, startPage + 4);

            let html = `<button class="sl-page-btn" ${safePage === 1 ? 'disabled' : ''} data-action="paginate" data-fn="${changeFnName}" data-page="${safePage - 1}">이전</button>`;

            for (let i = startPage; i <= endPage; i++) {
                html += `<button class="sl-page-btn ${i === safePage ? 'active' : ''}" data-action="paginate" data-fn="${changeFnName}" data-page="${i}">${i}</button>`;
            }

            html += `<button class="sl-page-btn" ${safePage === totalPages ? 'disabled' : ''} data-action="paginate" data-fn="${changeFnName}" data-page="${safePage + 1}">다음</button>`;

            container.innerHTML = html;

            if (!container.dataset.delegated) {
                container.addEventListener('click', (e) => {
                    const btn = e.target.closest('[data-action="paginate"]');
                    if (!btn || btn.disabled) return;
                    const fn = window[btn.dataset.fn];
                    const page = parseInt(btn.dataset.page, 10);
                    if (typeof fn === 'function' && !Number.isNaN(page)) fn(page);
                });
                container.dataset.delegated = '1';
            }
        },

        // -------------------------------------------------------
        // AI 자동 생성 (Drafts)
        // -------------------------------------------------------

        loadDrafts: async function () {
            const grid = document.getElementById('draftsGrid');
            if (!grid) return;
            grid.innerHTML = '<div class="sl-loading"><div class="sl-spinner"></div></div>';
            try {
                const res = await window.authFetch(API_ENDPOINTS.AGENTS_SKILLS_DRAFTS + '?target=user&limit=50');
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error?.message || data.message || 'draft 로드 실패');
                drafts = (data.data && Array.isArray(data.data.drafts)) ? data.data.drafts : [];
                draftsLoaded = true;
                this.renderDrafts();
            } catch (e) {
                const esc = window.escapeHtml || (s => s);
                grid.innerHTML = `<div class="sl-error">${esc(e.message || String(e))}</div>`;
            }
        },

        renderDrafts: function () {
            const grid = document.getElementById('draftsGrid');
            if (!grid) return;
            const esc = window.escapeHtml || (s => s);

            if (drafts.length === 0) {
                grid.innerHTML = '<div class="sl-empty">생성된 draft 가 없습니다. "AI 로 새 스킬 만들기" 버튼을 눌러 시작하세요.</div>';
                return;
            }

            grid.innerHTML = drafts.map(d => {
                const meta = d.manifestMeta || {};
                const model = esc(meta.model || '-');
                const tokens = (meta.tokensUsed != null) ? meta.tokensUsed : '-';
                const createdAt = d.createdAt ? new Date(d.createdAt).toLocaleString() : '-';
                const triggers = Array.isArray(meta.triggers) && meta.triggers.length > 0
                    ? meta.triggers.slice(0, 3).map(t => `<span class="sl-badge">${esc(String(t))}</span>`).join(' ')
                    : '';
                const promptText = (meta.userPrompt && typeof meta.userPrompt === 'string') ? meta.userPrompt : '';
                return `
                <div class="skill-row">
                    <div class="skill-row-meta">
                        <span class="skill-card-badge">${esc(categoryLabel(d.category))}</span>
                        <span class="sl-badge" style="background:var(--warning-light);color:var(--warning);border-color:rgba(232,176,75,0.25);margin-left:0.4rem">DRAFT</span>
                    </div>
                    <div class="skill-row-main">
                        <h3 class="skill-row-title" title="${esc(d.name)}">${esc(d.name)}</h3>
                        <p class="skill-row-desc" title="${esc(d.description || '')}">${esc(d.description || '설명 없음')}</p>
                        ${promptText ? `<small style="display:block;margin-top:0.3rem;color:var(--text-secondary,#a0a0a0);font-size:var(--font-size-xs)">요청: ${esc(promptText.slice(0,120))}${promptText.length > 120 ? '…' : ''}</small>` : ''}
                        ${triggers ? `<div style="margin-top:0.3rem">${triggers}</div>` : ''}
                    </div>
                    <div class="skill-row-side" style="font-size:var(--font-size-xs);color:var(--text-secondary,#a0a0a0)">
                        <div>모델: ${model}</div>
                        <div>토큰: ${esc(String(tokens))}</div>
                        <div>${esc(createdAt)}</div>
                    </div>
                    <div class="skill-row-actions" style="display:flex;gap:0.4rem;align-items:center">
                        <button class="sl-btn sl-btn-secondary" data-draft-action="preview" data-draft-id="${esc(d.id)}" title="미리보기">
                            <span class="iconify" data-icon="lucide:eye"></span>
                        </button>
                        <button class="sl-btn sl-btn-primary" data-draft-action="approve" data-draft-id="${esc(d.id)}">
                            <span class="iconify" data-icon="lucide:check"></span> 승인
                        </button>
                        <button class="sl-btn sl-btn-secondary" data-draft-action="reject" data-draft-id="${esc(d.id)}" title="거절 (archived 로 보관)">
                            <span class="iconify" data-icon="lucide:x"></span>
                        </button>
                    </div>
                </div>`;
            }).join('');

            // 이벤트 위임 — inline onclick 회피 (CSP/XSS)
            if (!grid.dataset.delegated) {
                grid.addEventListener('click', (e) => {
                    const btn = e.target.closest('[data-draft-action]');
                    if (!btn) return;
                    const id = btn.dataset.draftId;
                    const action = btn.dataset.draftAction;
                    if (action === 'approve') sl_approveDraft(id);
                    else if (action === 'reject') sl_rejectDraft(id);
                    else if (action === 'preview') {
                        const d = drafts.find(x => x.id === id);
                        if (d) {
                            // 기존 편집 모달 재사용 — preview-only (저장 시 PUT 으로 active 스킬 수정됨)
                            const titleEl = document.getElementById('slSkillModalTitle');
                            if (titleEl) titleEl.textContent = 'Draft 미리보기 (저장 시 active 로 즉시 반영)';
                            document.getElementById('slSkillName').value = d.name || '';
                            document.getElementById('slSkillDesc').value = d.description || '';
                            document.getElementById('slSkillCategory').value = d.category || 'general';
                            document.getElementById('slSkillContent').value = d.content || '';
                            editingSkillId = d.id;
                            document.getElementById('slSkillModal')?.classList.add('open');
                        }
                    }
                });
                grid.dataset.delegated = '1';
            }
        },

        openAutoCreateModal: function () {
            const modal = document.getElementById('slAutoCreateModal');
            if (!modal) return;
            document.getElementById('acPurpose').value = '';
            document.getElementById('acCategory').value = '';
            document.getElementById('acExamples').value = '';
            document.getElementById('acHints').value = '';
            const gitUrl = document.getElementById('acGitUrl'); if (gitUrl) gitUrl.value = '';
            const gitPath = document.getElementById('acGitPath'); if (gitPath) gitPath.value = '';
            const gitToken = document.getElementById('acGitToken'); if (gitToken) gitToken.value = '';
            // mode 초기화: prompt 활성
            document.querySelectorAll('[data-ac-mode]').forEach(b => b.classList.toggle('active', b.dataset.acMode === 'prompt'));
            ['acGitUrlGroup', 'acGitPathGroup', 'acGitTokenGroup'].forEach(id => {
                const el = document.getElementById(id); if (el) el.style.display = 'none';
            });
            ['acPurpose', 'acExamples', 'acHints'].forEach(id => {
                const el = document.getElementById(id); const g = el?.closest('.sl-form-group');
                if (g) g.style.display = '';
            });
            // admin 만 target 노출 — currentUser 가 있으면 role 확인
            const isAdmin = (window.currentUser && window.currentUser.role === 'admin');
            const targetGroup = document.getElementById('acTargetGroup');
            if (targetGroup) targetGroup.style.display = isAdmin ? 'block' : 'none';
            if (isAdmin) document.getElementById('acTarget').value = 'user';
            modal.classList.add('open');
        },

        closeAutoCreateModal: function () {
            const modal = document.getElementById('slAutoCreateModal');
            if (modal) modal.classList.remove('open');
        },

        submitAutoCreate: async function () {
            // mode 분기 — git URL 모드면 별도 함수
            const activeMode = document.querySelector('[data-ac-mode].active')?.dataset.acMode || 'prompt';
            if (activeMode === 'git') {
                return this.submitImportFromGit();
            }
            const purpose = (document.getElementById('acPurpose').value || '').trim();
            if (purpose.length < 5) {
                if (window.showToast) window.showToast('목적은 5자 이상 입력하세요', 'error');
                return;
            }
            const category = document.getElementById('acCategory').value || undefined;
            const examplesText = (document.getElementById('acExamples').value || '').trim();
            const examples = examplesText
                ? examplesText.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 5)
                : undefined;
            const hints = (document.getElementById('acHints').value || '').trim() || undefined;
            const isAdmin = (window.currentUser && window.currentUser.role === 'admin');
            const target = isAdmin ? (document.getElementById('acTarget').value || 'user') : undefined;

            const btn = document.getElementById('btnSubmitAutoCreate');
            if (btn) { btn.disabled = true; btn.dataset.origText = btn.innerHTML; btn.innerHTML = '<span class="iconify" data-icon="lucide:loader-2"></span> 생성 중...'; }

            // SSE 모드 — backend 의 long-running LLM 호출 (60~120s) 동안 proxy idle drop 방어 + 진행 UX
            try {
                const res = await window.authFetch(API_ENDPOINTS.AGENTS_SKILLS_AUTO_CREATE, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
                    body: JSON.stringify({ purpose, category, examples, hints, target }),
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    const msg = errData?.error?.message || errData?.error || errData?.detail || res.statusText;
                    if (window.showToast) window.showToast(`생성 실패: ${msg}`, 'error');
                    return;
                }

                // Content-Type 분기: SSE 면 stream 파싱, 아니면 기존 JSON 호환
                const ct = (res.headers.get('Content-Type') || '').toLowerCase();
                let result = null;
                let errorPayload = null;

                if (ct.includes('text/event-stream')) {
                    // SSE reader — 'event: <name>\ndata: <json>\n\n' 청크 파싱
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        const events = buffer.split('\n\n');
                        buffer = events.pop() || '';
                        for (const raw of events) {
                            const lines = raw.split('\n');
                            let evName = 'message';
                            let dataStr = '';
                            for (const ln of lines) {
                                if (ln.startsWith(':')) continue; // 주석 (heartbeat)
                                if (ln.startsWith('event:')) evName = ln.slice(6).trim();
                                else if (ln.startsWith('data:')) dataStr += ln.slice(5).trim();
                            }
                            if (!dataStr) continue;
                            try {
                                const payload = JSON.parse(dataStr);
                                if (evName === 'progress') {
                                    // 진행 표시 — 버튼 라벨 갱신
                                    if (btn) btn.innerHTML = '<span class="iconify" data-icon="lucide:loader-2"></span> LLM 호출 중...';
                                } else if (evName === 'result') {
                                    result = payload.data;
                                } else if (evName === 'error') {
                                    errorPayload = payload.error || { message: '알 수 없는 오류' };
                                }
                            } catch (_e) { /* malformed event chunk — 무시 */ }
                        }
                    }
                } else {
                    // Fallback: JSON 응답 (구버전 backend 호환)
                    const data = await res.json().catch(() => ({}));
                    if (data.success) result = data.data;
                    else errorPayload = data.error;
                }

                if (errorPayload) {
                    if (window.showToast) window.showToast(`생성 실패: ${errorPayload.message || JSON.stringify(errorPayload)}`, 'error');
                    return;
                }
                if (!result) {
                    if (window.showToast) window.showToast('응답을 받았으나 result 가 비어있습니다', 'error');
                    return;
                }

                if (window.showToast) {
                    const note = result.deduped ? ' (24시간 내 동일 요청 — 기존 draft 재사용)' : '';
                    window.showToast(`Draft 생성 완료: ${result.name || result.skillId}${note}`, 'success');
                }
                this.closeAutoCreateModal();
                await this.loadDrafts();
                const draftsTab = document.querySelector('.sl-tab[data-sl-tab="drafts"]');
                if (draftsTab) draftsTab.click();
            } catch (e) {
                if (window.showToast) window.showToast('오류: ' + (e?.message || String(e)), 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.origText || '<span class="iconify" data-icon="lucide:sparkles"></span> 생성하기'; }
            }
        },

        // Phase 2 — Git URL ingest
        submitImportFromGit: async function () {
            const gitUrl = (document.getElementById('acGitUrl').value || '').trim();
            if (gitUrl.length < 3) {
                if (window.showToast) window.showToast('Git URL 을 입력하세요', 'error');
                return;
            }
            const gitPath = (document.getElementById('acGitPath').value || '').trim() || undefined;
            const accessToken = (document.getElementById('acGitToken').value || '').trim() || undefined;
            const category = document.getElementById('acCategory').value || undefined;
            const isAdmin = (window.currentUser && window.currentUser.role === 'admin');
            const target = isAdmin ? (document.getElementById('acTarget').value || 'user') : undefined;

            const btn = document.getElementById('btnSubmitAutoCreate');
            if (btn) { btn.disabled = true; btn.dataset.origText = btn.innerHTML; btn.innerHTML = '<span class="iconify" data-icon="lucide:loader-2"></span> Git 가져오는 중...'; }

            try {
                const res = await window.authFetch(API_ENDPOINTS.AGENTS_SKILLS_IMPORT_FROM_GIT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
                    body: JSON.stringify({ gitUrl, gitPath, accessToken, target, category }),
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    if (window.showToast) window.showToast('가져오기 실패: ' + (errData?.error?.message || res.statusText), 'error');
                    return;
                }
                const ct = (res.headers.get('Content-Type') || '').toLowerCase();
                let result = null;
                let errorPayload = null;

                if (ct.includes('text/event-stream')) {
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        const events = buffer.split('\n\n'); buffer = events.pop() || '';
                        for (const raw of events) {
                            const lines = raw.split('\n');
                            let evName = 'message'; let dataStr = '';
                            for (const ln of lines) {
                                if (ln.startsWith(':')) continue;
                                if (ln.startsWith('event:')) evName = ln.slice(6).trim();
                                else if (ln.startsWith('data:')) dataStr += ln.slice(5).trim();
                            }
                            if (!dataStr) continue;
                            try {
                                const payload = JSON.parse(dataStr);
                                if (evName === 'progress' && btn) {
                                    const phase = payload.phase || '';
                                    btn.innerHTML = `<span class="iconify" data-icon="lucide:loader-2"></span> ${phase}...`;
                                } else if (evName === 'result') {
                                    result = payload.data;
                                } else if (evName === 'error') {
                                    errorPayload = payload.error;
                                }
                            } catch (_e) { /* malformed */ }
                        }
                    }
                } else {
                    const data = await res.json().catch(() => ({}));
                    if (data.success) result = data.data;
                    else errorPayload = data.error;
                }

                if (errorPayload) {
                    if (window.showToast) window.showToast('가져오기 실패: ' + (errorPayload.message || errorPayload.code), 'error');
                    return;
                }
                if (!result) {
                    if (window.showToast) window.showToast('응답이 비어있습니다', 'error');
                    return;
                }
                if (result.selectionRequired) {
                    // multi-candidate — 사용자 선택 받아 재호출
                    const choice = window.prompt(
                        `여러 SKILL.md 후보가 발견됐습니다. 가져올 파일 번호를 선택하세요:\n\n` +
                        result.candidates.map((c, i) => `${i + 1}. ${c.path}`).join('\n'),
                        '1'
                    );
                    const idx = parseInt(choice, 10) - 1;
                    if (Number.isNaN(idx) || idx < 0 || idx >= result.candidates.length) return;
                    document.getElementById('acGitPath').value = result.candidates[idx].path;
                    return this.submitImportFromGit();
                }
                if (window.showToast) {
                    const note = result.deduped ? ' (24시간 내 동일 ref/path — 기존 draft 재사용)' : '';
                    window.showToast(`Draft 가져옴: ${result.name}${note}`, 'success');
                }
                this.closeAutoCreateModal();
                await this.loadDrafts();
                const draftsTab = document.querySelector('.sl-tab[data-sl-tab="drafts"]');
                if (draftsTab) draftsTab.click();
            } catch (e) {
                if (window.showToast) window.showToast('오류: ' + (e?.message || String(e)), 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.origText || '<span class="iconify" data-icon="lucide:sparkles"></span> 생성하기'; }
            }
        },

        approveDraft: async function (skillId) {
            if (!confirm('이 draft 를 승인하시겠습니까?\n\n<iconify-icon icon=lucide:triangle-alert></iconify-icon> 승인 후 이 스킬의 content 가 채팅의 system prompt 에 주입됩니다. AI 가 작성한 텍스트이므로 의심스러운 지시문(예: "이전 지시를 무시하라", 시스템 페르소나 변경 등)이 포함돼 있지 않은지 미리보기로 확인하세요.')) return;
            try {
                const res = await window.authFetch(API_ENDPOINTS.AGENTS_SKILLS_APPROVE(skillId), { method: 'POST' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) {
                    const msg = data?.error?.message || data?.error || data?.detail || res.statusText;
                    if (window.showToast) window.showToast(`승인 실패: ${msg}`, 'error');
                    return;
                }
                if (window.showToast) window.showToast('승인 완료 — 활성 스킬로 전환되었습니다.', 'success');
                await this.loadDrafts();
                await this.loadLocalSkills();
                await this.loadLocalCategories();
            } catch (e) {
                if (window.showToast) window.showToast('오류: ' + (e?.message || String(e)), 'error');
            }
        },

        rejectDraft: async function (skillId) {
            if (!confirm('이 draft 를 거절하시겠습니까? archived 상태로 보관됩니다 (영구 삭제 아님).')) return;
            try {
                const res = await window.authFetch(API_ENDPOINTS.AGENTS_SKILLS_REJECT(skillId), { method: 'POST' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) {
                    const msg = data?.error?.message || data?.error || data?.detail || res.statusText;
                    if (window.showToast) window.showToast(`거절 실패: ${msg}`, 'error');
                    return;
                }
                if (window.showToast) window.showToast('거절됨 (archived).', 'success');
                await this.loadDrafts();
            } catch (e) {
                if (window.showToast) window.showToast('오류: ' + (e?.message || String(e)), 'error');
            }
        }
    };

const pageModule = window.PageModules['skill-library'];
export default pageModule;
