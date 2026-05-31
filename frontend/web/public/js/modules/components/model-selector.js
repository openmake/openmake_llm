/**
 * ============================================
 * Model Selector Component
 * ============================================
 * 채팅 입력 영역 좌측 통합 모델 셀렉트 dropdown.
 * Provider 카탈로그 + 등록된 외부 모델 + "+ 새 LLM 키 등록" 진입점.
 *
 * 의존: window.AddKeyModal, window.UsageModal, window.ModelActionMenu
 * (각각 add-key-modal.js / usage-modal.js / model-action-menu.js 가 글로벌 노출)
 *
 * @module components/model-selector
 */
'use strict';

import { fetchModelsPayload } from '../models-api.js';

const STORAGE_KEY = 'selectedModel';

// 디버그 로그 — console 만 (page overlay 제거됨, PR #20).
// 필요 시 DevTools Console 에서 [ModelSelector] 검색.
function logDebug(msg) {
    try { console.info('[ModelSelector]', msg); } catch (_) {}
}

const PROVIDER_LABELS = {
    'local-llm': '🖥️ 로컬 LLM',
    openrouter: '🌐 OpenRouter',
};

const PROVIDER_ORDER = ['local-llm', 'openrouter'];

/**
 * 중복 dedup 시 우선순위 — 같은 canonical 모델이 여러 provider 에서 노출되면 우선순위 높은 1개만 유지.
 * Tasks 1-7 (2026-05-08) 이후 외부 provider 가 OpenRouter 단독이라 실질적 dedup 은 없지만 코드 경로 보존.
 */
const PROVIDER_DEDUP_PRIORITY = {
    'local-llm': 100,
    openrouter: 50,
};

/**
 * 모델의 canonical key 를 만든다 — 같은 key 의 모델은 동일 모델로 간주.
 *
 * 정확 매치 룰 (보수적):
 *   - 'openai:gpt-4o'                 → 'openai/gpt-4o'
 *   - 'openrouter:openai/gpt-4o'      → 'openai/gpt-4o'   (dedup 매치)
 *   - 'anthropic:claude-sonnet-4-6'   → 'anthropic/claude-sonnet-4-6'
 *   - 'openrouter:anthropic/claude-sonnet-4.6' → 'anthropic/claude-sonnet-4.6'
 *     (4-6 vs 4.6 표기 차이는 별개 모델로 취급 — false positive 방지)
 *   - 'local-llm:qwen3.6-35b-a3b'     → 'local-llm/qwen3.6-35b-a3b'
 */
function canonicalModelKey(model) {
    const provider = model.provider || 'local-llm';
    let id = model.modelId || '';
    const prefix = provider + ':';
    if (id.startsWith(prefix)) id = id.slice(prefix.length);
    // OpenRouter 의 modelId 는 이미 'vendor/model' 네임스페이스 — 그대로
    // 직접 provider 의 modelId 는 'model' 만 — 'provider/model' 로 prefix
    if (provider !== 'openrouter' && !id.includes('/')) {
        id = provider + '/' + id;
    }
    return id.toLowerCase();
}

/**
 * 같은 canonical 키의 모델을 PROVIDER_DEDUP_PRIORITY 기준으로 1개만 유지.
 * 입력 순서는 보존 (Map 의 삽입 순서).
 */
function dedupModels(models) {
    const winner = new Map();
    for (const m of models) {
        const key = canonicalModelKey(m);
        const cur = winner.get(key);
        if (!cur) { winner.set(key, m); continue; }
        const curPri = PROVIDER_DEDUP_PRIORITY[cur.provider || 'local-llm'] ?? 0;
        const newPri = PROVIDER_DEDUP_PRIORITY[m.provider || 'local-llm'] ?? 0;
        if (newPri > curPri) winner.set(key, m);
    }
    return Array.from(winner.values());
}

/**
 * Frontend fallback 모델 — backend `/api/models` 가 외부 모델 합산을 안 할 때
 * (캐시 stale 또는 backend 옛 dist 사용 중) 등록된 키 기준으로 직접 보강.
 * backend `getProviderFallbackModels` 와 동일 정의 (PR #11).
 */
const FRONTEND_FALLBACK_MODELS = {
    openrouter: [
        { id: 'openai/gpt-5',                     name: 'GPT-5' },
        { id: 'anthropic/claude-opus-4.5',        name: 'Claude Opus 4.5' },
        { id: 'anthropic/claude-sonnet-4.6',      name: 'Claude Sonnet 4.6' },
        { id: 'google/gemini-2.5-pro',            name: 'Gemini 2.5 Pro (via OR)' },
        { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
        { id: 'deepseek/deepseek-r1',             name: 'DeepSeek R1' },
    ],
};

let _container = null;
let _isOpen = false;
let _models = [];
let _providers = [];
let _isAuthenticated = false;
let _isAdmin = false;
/** Named handler for document-level outside-click — hoisted so unmount() can remove it. */
let _onDocumentClick = null;
/** OpenRouter group search query — preserved across re-renders so input focus survives. */
let _orSearchQuery = '';

function escAttr(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escText(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
}

async function authFetch(url, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    return (window.authFetch || fetch)(url, opts);
}

async function loadData() {
    try {
        const [modelsData, providersRes] = await Promise.all([
            fetchModelsPayload(),
            authFetch('/api/external-keys'),
        ]);
        if (modelsData) {
            _models = modelsData.models || [];
        }
        if (providersRes.ok) {
            _isAuthenticated = true;
            const json = await providersRes.json();
            _providers = (json.data && json.data.providers) || [];
        } else {
            _isAuthenticated = false;
            _providers = [];
        }
    } catch (e) {
        console.warn('[ModelSelector] 데이터 로드 실패:', e);
    }

    _isAdmin = !!(window.AppState && window.AppState.user && window.AppState.user.role === 'admin')
        || (typeof window.isAdmin === 'function' && window.isAdmin());

    // Frontend fallback inject — backend 응답에 외부 모델 미포함 시 등록된 키 기준 보강.
    // backend dist 가 옛 코드일 때도 사용자가 즉시 모델 선택 가능 (streamChat 은 정상 작동).
    const externalProviders = new Set(_models.filter(m => (m.provider || 'local-llm') !== 'local-llm').map(m => m.provider));
    for (const p of _providers) {
        if (!p.user_key) continue;
        if (externalProviders.has(p.provider_id)) continue; // 이미 backend 가 합산
        const fallback = FRONTEND_FALLBACK_MODELS[p.provider_id];
        if (!fallback || fallback.length === 0) continue;
        for (const m of fallback) {
            _models.push({
                modelId: p.provider_id + ':' + m.id,
                name: m.name,
                provider: p.provider_id,
                description: p.display_name + ' — frontend fallback (backend 미합산)',
                capabilities: { executionStrategy: 'single', thinking: 'off', discussion: false, vision: false, toolCalling: true, streaming: true },
            });
        }
        logDebug('frontend fallback 적용: ' + p.provider_id + ' (+' + fallback.length + ' models)');
    }

    // 중복 dedup — 같은 모델이 여러 provider 에서 노출 시 우선순위 높은 1개만 유지.
    // 예: 사용자가 Anthropic 직접 + OpenRouter 둘 다 등록 → 직접 Anthropic 우선.
    const beforeCount = _models.length;
    _models = dedupModels(_models);
    if (_models.length < beforeCount) {
        logDebug('dedup: ' + beforeCount + ' → ' + _models.length + ' (' + (beforeCount - _models.length) + ' 중복 제거)');
    }
}

function getSelectedModel() {
    return localStorage.getItem(STORAGE_KEY)
        || (_models[0] && _models[0].modelId)
        || '';
}

function setSelectedModel(modelId) {
    try {
        localStorage.setItem(STORAGE_KEY, modelId);
    } catch (e) {
        console.warn('[ModelSelector] localStorage 쓰기 실패 (incognito?):', e);
    }
    renderTrigger();
    if (window.showToast) window.showToast('🤖 모델 변경됨: ' + modelId);
    if (typeof window.applyModelCapabilityToggles === 'function') {
        try {
            window.applyModelCapabilityToggles(modelId);
        } catch (e) {
            console.warn('[ModelSelector] applyModelCapabilityToggles 오류:', e);
        }
    }
}

function renderTrigger() {
    if (!_container) return;
    const selected = getSelectedModel();
    const model = _models.find(m => m.modelId === selected);
    const displayName = model ? model.name : (selected || '모델 선택');
    const provider = model ? (model.provider || 'local-llm') : null;
    // provider 별 아이콘 — 어떤 LLM 사용 중인지 한눈에
    const PROVIDER_ICONS = {
        'local-llm': '🖥️',
        openrouter: '🌐',
    };
    const icon = provider && PROVIDER_ICONS[provider] ? PROVIDER_ICONS[provider] : '📋';
    const trigger = _container.querySelector('.model-selector-trigger');
    if (trigger) {
        trigger.innerHTML =
            '<span class="icon">' + icon + '</span>' +
            '<span class="name">' + escText(displayName) + '</span>' +
            '<span class="arrow">▾</span>';
        if (provider && provider !== 'local-llm') {
            trigger.title = '현재 사용 중: ' + provider + ' / ' + displayName;
        } else {
            trigger.title = '모델 선택 — 클릭하여 변경';
        }
    }
}

function groupModelsByProvider() {
    const groups = {};
    for (const m of _models) {
        const provider = m.provider || 'local-llm';
        if (!groups[provider]) groups[provider] = [];
        groups[provider].push(m);
    }
    const local = groups['local-llm'];
    if (!_isAdmin && local && local.length > 1) {
        const selected = getSelectedModel();
        const active = local.find(m => m.modelId === selected) || local[0];
        groups['local-llm'] = [active];
    }
    return groups;
}

function renderDropdown() {
    const dropdown = _container.querySelector('.model-selector-dropdown');
    if (!dropdown) return;

    const groups = groupModelsByProvider();
    const selected = getSelectedModel();
    let html = '';

    for (const pid of PROVIDER_ORDER) {
        if (!groups[pid] || groups[pid].length === 0) continue;
        const label = PROVIDER_LABELS[pid] || pid;

        if (pid === 'openrouter') {
            html += renderOpenRouterGroup(groups[pid], selected);
        } else {
            const count = groups[pid].length;
            html += '<div class="model-selector-optgroup-label">' +
                escText(label) +
                ' <span style="opacity:0.6;font-weight:normal">(' + count + ')</span>' +
                '</div>';
            for (const m of groups[pid]) {
                const isActive = m.modelId === selected;
                const isLocal = pid === 'local-llm';
                // 가용성 — backend 가 available: false 면 서버 backend 미가동/장애.
                // 클릭 차단 + dimmed + tooltip 으로 사유 표시.
                const unavailable = m.available === false;
                const disabledByRole = isLocal && !_isAdmin && !isActive;
                const disabled = disabledByRole || unavailable;
                const reason = unavailable
                    ? (m.unavailableReason || 'unavailable')
                    : '';
                const badge = unavailable
                    ? ' <span style="opacity:0.6;font-size:0.8em;">🔴 ' + escText(reason) + '</span>'
                    : '';
                const tooltip = unavailable
                    ? ' title="현재 사용 불가: ' + escAttr(reason) + '"'
                    : '';
                html +=
                    '<div class="model-selector-option' +
                    (isActive ? ' active' : '') +
                    (disabled ? ' disabled' : '') +
                    (unavailable ? ' unavailable' : '') +
                    '" data-model-id="' + escAttr(m.modelId) + '" data-provider="' + escAttr(pid) + '"' +
                    tooltip + '>' +
                    '<span>' + (isActive ? '<span class="check">✓ </span>' : '') + escText(m.name) + badge + '</span>' +
                    '</div>';
            }
        }
    }

    if (_isAuthenticated && _providers.length > 0) {
        const registered = new Set(_providers.filter(p => p.user_key).map(p => p.provider_id));
        const unregistered = _providers.filter(p => p.enabled && !registered.has(p.provider_id));
        if (unregistered.length > 0) {
            html += '<div class="model-selector-separator"></div>';
            html += '<div class="model-selector-optgroup-label">➕ 새 LLM 키 등록</div>';
            for (const p of unregistered) {
                html +=
                    '<div class="model-selector-add-option" data-action="add-key" data-provider="' +
                    escAttr(p.provider_id) + '">' +
                    '+ ' + escText(p.display_name) +
                    '</div>';
            }
        }
    }

    if (!html) {
        html = '<div style="padding:12px;color:var(--text-muted);text-align:center">사용 가능한 모델 없음</div>';
    }

    const hasExternal = _models.some(m => (m.provider || 'local-llm') !== 'local-llm');
    const registeredButMissing = _isAuthenticated &&
        _providers.some(p => p.user_key) && !hasExternal;

    if (_isAuthenticated && !hasExternal && !registeredButMissing) {
        html =
            '<div style="padding:8px 12px;font-size:11px;color:var(--text-muted);background:var(--bg-tertiary);border-bottom:1px solid var(--border-light);line-height:1.5">' +
            '💡 외부 LLM 사용 — 아래 <b>"+ 새 LLM 키 등록"</b>에서 OpenRouter 키 입력 시 모델이 위쪽에 자동 추가됩니다.' +
            '</div>' + html;
    } else if (registeredButMissing) {
        const registered = _providers.filter(p => p.user_key).map(p => p.provider_id).join(', ');
        html =
            '<div style="padding:10px 12px;font-size:11px;color:var(--danger);background:rgba(220,38,38,0.08);border-bottom:1px solid var(--border-light);line-height:1.5">' +
            '⚠️ 등록된 키 [<b>' + escText(registered) + '</b>]가 있지만 모델 합산 실패. ' +
            '<br>운영자 조치: <code>pm2 restart openmake-api</code> + ' +
            '<code>DELETE FROM external_provider_models_cache</code>' +
            '</div>' + html;
    }

    dropdown.innerHTML = html;
    bindDropdownHandlers(dropdown);
    bindOpenRouterCardHandler(dropdown);
}

/**
 * OpenRouter 그룹 렌더 — 검색박스 + free-first 정렬 + 무료/유료 sub-header + 배지.
 *
 * 정렬 규칙:
 *   1. isFree=true 가 isFree=false 보다 앞
 *   2. 같은 isFree 안에서: paid 는 입력가격 cheapest 우선, free 는 알파벳 순
 *   3. 동일 가격 시 displayName 알파벳 순
 *
 * 검색: modelId 또는 name 의 lowercase substring 매칭. 빈 query 면 전체.
 */
function renderOpenRouterGroup(models, selected) {
    // OpenRouter 는 367+ 모델이라 dropdown max-height (420px) 안에 다 안 들어감 →
    // inline list 대신 풀스크린 모달 진입점만 표시. 클릭 시 ModelListModal 이 열림.
    const free = models.filter(m => m.isFree);
    const paid = models.filter(m => !m.isFree);
    const totalCount = models.length;

    // 현재 선택된 OpenRouter 모델 정보 (있다면)
    const selectedOR = models.find(m => m.modelId === selected);

    let html = '<div class="model-selector-or-card" data-action="open-list-modal" ' +
        'title="클릭하여 전체 ' + totalCount + ' 모델 검색·선택">' +
        '<div class="or-card-header">' +
        '<span class="or-card-icon">🌐</span>' +
        '<span class="or-card-title">OpenRouter</span>' +
        '<span class="or-card-count">' + totalCount + ' 모델</span>' +
        '</div>' +
        '<div class="or-card-stats">' +
        '<span class="or-stat or-stat-free">🆓 무료 ' + free.length + '</span>' +
        '<span class="or-stat or-stat-paid">💰 유료 ' + paid.length + '</span>' +
        '</div>';

    if (selectedOR) {
        html += '<div class="or-card-selected">' +
            '✓ 선택됨: ' + escText(selectedOR.name) +
            (selectedOR.isFree
                ? ' <span class="badge badge-free">🆓 FREE</span>'
                : (selectedOR.pricing
                    ? ' <span class="price">$' +
                        (selectedOR.pricing.input || 0).toFixed(2) + ' / $' +
                        (selectedOR.pricing.output || 0).toFixed(2) + ' /1M</span>'
                    : '')) +
            '</div>';
    }

    html += '<div class="or-card-action">📋 전체 모델 보기 →</div>' +
        '</div>';

    return html;
}

/**
 * OpenRouter 카드 클릭 시 ModelListModal 열기 — 367 모델을 풀스크린 모달에서 검색·선택.
 * Inline list / 검색 input 은 사용 안 함 (dropdown max-height 클리핑 회피).
 */
function bindOpenRouterCardHandler(dropdown) {
    const card = dropdown.querySelector('.model-selector-or-card');
    if (!card) return;
    card.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (!window.ModelListModal) {
            console.warn('[ModelSelector] window.ModelListModal 미정의 — 모듈 로드 실패');
            if (window.showToast) window.showToast('모달 로드 실패 — 페이지 새로고침 필요', 'error');
            return;
        }
        const orModels = _models.filter(m => (m.provider || 'local-llm') === 'openrouter');
        window.ModelListModal.open({
            models: orModels,
            selected: getSelectedModel(),
            onSelect: function (modelId) {
                setSelectedModel(modelId);
                closeDropdown();
            },
        });
    });
}

/**
 * 렌더된 dropdown 의 각 인터랙티브 element 에 직접 핸들러 부착.
 * 이벤트 위임이 실패하는 환경(레이어 z-index, 부모 핸들러 중복 등) 회피.
 */
function bindDropdownHandlers(dropdown) {
    const optionCount = dropdown.querySelectorAll('.model-selector-option').length;
    const addCount = dropdown.querySelectorAll('[data-action="add-key"]').length;
    const menuCount = dropdown.querySelectorAll('[data-action="open-menu"]').length;
    logDebug('dropdown 렌더 — opt=' + optionCount + ', +추가=' + addCount + ', ⋮=' + menuCount);

    // 모델 옵션 클릭 — 모델 변경
    dropdown.querySelectorAll('.model-selector-option').forEach((el) => {
        if (el.classList.contains('disabled')) return;
        el.addEventListener('click', function (ev) {
            // ⋮ 메뉴 trigger 클릭은 별도 처리 — option 클릭과 분리
            if (ev.target.closest('[data-action="open-menu"]')) return;
            ev.preventDefault();
            ev.stopPropagation();
            const modelId = el.dataset.modelId;
            logDebug('✓ 옵션 클릭: ' + modelId);
            if (modelId) {
                setSelectedModel(modelId);
                closeDropdown();
            } else {
                logDebug('  ✗ modelId 비어있음 — dataset 누락');
            }
        });
    });

    // ⋮ 메뉴 trigger 클릭
    dropdown.querySelectorAll('[data-action="open-menu"]').forEach((el) => {
        el.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            const providerId = el.dataset.provider;
            const modelId = el.dataset.modelId;
            logDebug('⋮ 메뉴 클릭: ' + providerId);
            if (window.ModelActionMenu) {
                window.ModelActionMenu.open(el, { providerId, modelId });
            } else {
                logDebug('  ✗ window.ModelActionMenu 미정의');
            }
        });
    });

    // "+ 새 LLM 키 등록" 클릭
    dropdown.querySelectorAll('[data-action="add-key"]').forEach((el) => {
        el.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            const providerId = el.dataset.provider;
            logDebug('+ 추가 클릭: ' + providerId);
            if (window.AddKeyModal) {
                window.AddKeyModal.open({
                    providerId,
                    onSuccess: () => refresh({ afterRegisterProviderId: providerId }),
                });
            } else {
                logDebug('  ✗ window.AddKeyModal 미정의');
                if (window.showToast) window.showToast('등록 모달 로드 실패 — 페이지 새로고침 필요', 'error');
            }
            closeDropdown();
        });
    });
}

function toggleDropdown() {
    _isOpen = !_isOpen;
    logDebug('toggle → ' + (_isOpen ? '열림' : '닫힘'));
    const dropdown = _container.querySelector('.model-selector-dropdown');
    if (dropdown) dropdown.classList.toggle('open', _isOpen);
    if (_isOpen) renderDropdown();
}

function closeDropdown() {
    _isOpen = false;
    const dropdown = _container.querySelector('.model-selector-dropdown');
    if (dropdown) dropdown.classList.remove('open');
}

export async function mount(targetElement) {
    logDebug('mount 시작');
    _container = document.createElement('div');
    _container.className = 'model-selector';
    _container.innerHTML =
        '<button type="button" class="model-selector-trigger" data-action="toggle">' +
        '<span class="icon">📋</span><span class="name">로딩 중...</span><span class="arrow">▾</span>' +
        '</button>' +
        '<div class="model-selector-dropdown"></div>';
    targetElement.appendChild(_container);

    _container.addEventListener('click', function (ev) {
        try {
            const toggleBtn = ev.target.closest('[data-action="toggle"]');
            if (toggleBtn) {
                ev.preventDefault();
                ev.stopPropagation();
                toggleDropdown();
                return;
            }
            const menuTrigger = ev.target.closest('[data-action="open-menu"]');
            if (menuTrigger) {
                ev.preventDefault();
                ev.stopPropagation();
                const providerId = menuTrigger.dataset.provider;
                const modelId = menuTrigger.dataset.modelId;
                if (window.ModelActionMenu) {
                    window.ModelActionMenu.open(menuTrigger, { providerId, modelId });
                } else {
                    console.warn('[ModelSelector] window.ModelActionMenu 미정의 — 모듈 로드 실패');
                }
                return;
            }
            const addOption = ev.target.closest('[data-action="add-key"]');
            if (addOption) {
                ev.preventDefault();
                ev.stopPropagation();
                const providerId = addOption.dataset.provider;
                if (window.AddKeyModal) {
                    window.AddKeyModal.open({ providerId, onSuccess: refresh });
                } else {
                    console.warn('[ModelSelector] window.AddKeyModal 미정의 — 모듈 로드 실패');
                    if (window.showToast) window.showToast('등록 모달 로드 실패 — 페이지 새로고침 필요', 'error');
                }
                closeDropdown();
                return;
            }
            const option = ev.target.closest('.model-selector-option');
            if (option && !option.classList.contains('disabled')) {
                ev.preventDefault();
                ev.stopPropagation();
                const modelId = option.dataset.modelId;
                if (modelId) {
                    setSelectedModel(modelId);
                    closeDropdown();
                }
            }
        } catch (err) {
            console.error('[ModelSelector] 클릭 핸들러 오류:', err);
        }
    });

    _onDocumentClick = function (ev) {
        if (_isOpen && _container && !_container.contains(ev.target)) closeDropdown();
    };
    document.addEventListener('click', _onDocumentClick);

    await loadData();
    renderTrigger();
    logDebug('mount 완료 — models=' + _models.length + ' / providers=' + _providers.length +
        ' / auth=' + _isAuthenticated + ' / admin=' + _isAdmin +
        ' / globals: AddKey=' + !!window.AddKeyModal +
        ', Usage=' + !!window.UsageModal +
        ', Menu=' + !!window.ModelActionMenu);

    // 자동 진단 — 등록된 키 vs 합산된 외부 모델 일치 여부
    const registeredKeys = _providers.filter(p => p.user_key).map(p => p.provider_id);
    const externalModelsByProvider = {};
    _models.filter(m => (m.provider || 'local-llm') !== 'local-llm').forEach(m => {
        externalModelsByProvider[m.provider] = (externalModelsByProvider[m.provider] || 0) + 1;
    });
    if (registeredKeys.length > 0) {
        logDebug('등록된 키: [' + registeredKeys.join(', ') + ']');
        logDebug('합산된 외부 모델: ' +
            (Object.keys(externalModelsByProvider).length > 0
                ? JSON.stringify(externalModelsByProvider)
                : '0건'));
        const missing = registeredKeys.filter(p => !externalModelsByProvider[p]);
        if (missing.length > 0) {
            logDebug('⚠️ 키 [' + missing.join(', ') + '] 모델 미합산 — 가능 원인:');
            logDebug('  1. PM2 재시작 안 됨 (새 fallback 코드 미적용)');
            logDebug('  2. external_provider_models_cache stale 빈 배열');
            logDebug('  3. provider /v1/models endpoint 응답 실패');
            logDebug('해결: pm2 restart openmake-api && DELETE FROM external_provider_models_cache');
        }
    }

    if (location.search.includes('openModelSelector=1')) {
        toggleDropdown();
    }
}

export function refresh(opts) {
    logDebug('refresh 호출' + (opts && opts.afterRegisterProviderId ? ' (등록 후: ' + opts.afterRegisterProviderId + ')' : ''));
    const prevModelIds = new Set(_models.map(m => m.modelId));
    return loadData().then(() => {
        const grouped = groupModelsByProvider();
        const summary = Object.keys(grouped).map(p => p + '=' + grouped[p].length).join(', ');
        logDebug('refresh 완료 — models=' + _models.length + ' (' + summary + ')');

        // 등록 직후: 새로 추가된 첫 모델 자동 선택 + dropdown 자동 재오픈
        if (opts && opts.afterRegisterProviderId) {
            const newModelsForProvider = _models.filter(m =>
                (m.provider || '') === opts.afterRegisterProviderId && !prevModelIds.has(m.modelId)
            );
            if (newModelsForProvider.length > 0) {
                const firstNew = newModelsForProvider[0];
                // 외부 키 등록은 모델을 '사용 가능'하게만 만들고, active 모델 변경은
                // 사용자의 명시 선택 시에만 일어나야 한다. 기존에 유효한 선택이 있으면
                // 등록만으로 덮어쓰지 않고 유지한다 (미선택 상태에서만 자동 선택).
                const saved = localStorage.getItem(STORAGE_KEY);
                const hasValidSelection = !!saved && _models.some(m => m.modelId === saved);
                if (hasValidSelection) {
                    logDebug('기존 선택 유지: ' + saved + ' (등록된 새 모델 자동선택 안 함)');
                    if (window.showToast) {
                        window.showToast(
                            '✓ ' + opts.afterRegisterProviderId + ' 등록 완료 — ' +
                            newModelsForProvider.length + '개 모델 사용 가능. 현재 모델(' + saved +
                            ') 유지 — 변경하려면 드롭다운에서 선택하세요.'
                        );
                    }
                } else {
                    setSelectedModel(firstNew.modelId);
                    logDebug('자동 선택(미선택 상태): ' + firstNew.modelId + ' (' + newModelsForProvider.length + ' new models)');
                    if (window.showToast) {
                        window.showToast(
                            '✓ ' + opts.afterRegisterProviderId + ' 등록 완료 — ' +
                            newModelsForProvider.length + '개 모델 사용 가능. "' + firstNew.name + '" 자동 선택됨.'
                        );
                    }
                }
            } else {
                if (window.showToast) {
                    window.showToast(
                        '⚠️ ' + opts.afterRegisterProviderId + ' 등록은 됐지만 모델 목록 미수신. ' +
                        '드롭다운을 다시 열어 확인하거나 검증(⋮ → 🔍)을 시도하세요.',
                        'error',
                    );
                }
            }
            // 사용자가 새 모델을 시각 확인할 수 있도록 dropdown 자동 재오픈
            if (!_isOpen) toggleDropdown();
            else renderDropdown();
            return;
        }

        renderTrigger();
        if (_isOpen) renderDropdown();
    });
}

/**
 * SPA cleanup — settings 페이지가 라우트 떠날 때 settings.js cleanup() 에서 호출.
 *
 * 처리:
 *   1. document click 리스너 해제 (named _onDocumentClick 으로 등록되어 있음)
 *   2. 컨테이너 DOM 제거
 *   3. 모듈 스코프 상태 초기화 — 다음 mount() 가 fresh 상태로 시작하도록
 *
 * 미호출 시: document click 리스너가 누적되어 메모리 leak (특히 라우팅 반복 시).
 */
export function unmount() {
    if (_onDocumentClick) {
        document.removeEventListener('click', _onDocumentClick);
        _onDocumentClick = null;
    }
    if (_container && _container.parentNode) {
        _container.parentNode.removeChild(_container);
    }
    _container = null;
    _isOpen = false;
    _models = [];
    _providers = [];
    _isAuthenticated = false;
    _isAdmin = false;
    _orSearchQuery = '';
}

export default { mount, refresh, unmount };
