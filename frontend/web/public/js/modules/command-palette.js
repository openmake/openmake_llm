/**
 * ============================================
 * ⌘K Command Palette
 * ============================================
 * Chat-first 구조의 단일 진입점 — 이동(Go)·액션·검색을 한 단축키로.
 * 기존 글로벌 재사용: window.Router / NAV_ITEMS / newChat / toggleTheme / logout /
 * getCurrentUser / isLoggedIn. 부가(additive) 컴포넌트 — 기존 셸 비파괴.
 *
 * 트리거: ⌘K (mac) / Ctrl+K. window.openCommandPalette() 로도 호출 가능.
 * CSP: 인라인 핸들러 없음(addEventListener), innerHTML 미사용(safe DOM).
 * @module command-palette
 */

let scrimEl = null;
let inputEl = null;
let listEl = null;
let allItems = [];
let shown = [];
let selIdx = 0;
let isOpen = false;

function currentUser() {
    try { return typeof window.getCurrentUser === 'function' ? window.getCurrentUser() : null; }
    catch (e) { return null; }
}
function loggedIn() {
    try { return typeof window.isLoggedIn === 'function' ? !!window.isLoggedIn() : !!currentUser(); }
    catch (e) { return false; }
}
function isAdminUser() {
    const u = currentUser();
    return !!(u && u.role === 'admin');
}
/** NAV_ITEMS + 액션으로 명령 목록 구성 (열릴 때마다 현재 권한 반영) */
function buildCommands() {
    const cmds = [];
    const nav = window.NAV_ITEMS || { menu: [], admin: [] };
    const admin = isAdminUser();
    const authed = loggedIn();

    [['이동', nav.menu || []], ['관리', nav.admin || []]].forEach(function (pair) {
        const groupLabel = pair[0];
        pair[1].forEach(function (it) {
            if (!it || !it.href) return;
            if (it.requireAdmin && !admin) return;
            if (it.requireAuth && !authed) return;
            cmds.push({
                group: groupLabel,
                icon: it.iconify || 'lucide:circle',
                label: it.label,
                run: function () { if (window.Router) window.Router.navigate(it.href); }
            });
        });
    });

    // 채팅(홈) — NAV_ITEMS 에 없으므로 명시 추가
    cmds.unshift({ group: '이동', icon: 'lucide:message-circle', label: '채팅', run: function () { if (window.Router) window.Router.navigate('/'); } });

    const actions = [
        { icon: 'lucide:plus', label: '새 대화', hint: '⌘N', run: function () { if (typeof window.newChat === 'function') window.newChat(); else if (window.Router) window.Router.navigate('/'); } },
        { icon: 'lucide:search', label: '대화 검색', run: function () {
            try { if (window.sidebar && typeof window.sidebar.setState === 'function') window.sidebar.setState('full'); } catch (e) {}
            setTimeout(function () { var i = document.getElementById('sidebarSearch'); if (i) { i.focus(); if (i.select) i.select(); } }, 60);
        } },
        { icon: 'lucide:arrow-left-right', label: '모델 선택 / 전환', run: function () {
            var t = document.querySelector('.model-selector-trigger');
            if (t) { t.click(); return; }
            // 셀렉터가 현재 화면에 없으면(비채팅 등) 채팅 홈으로 이동 후 재시도
            if (window.Router) window.Router.navigate('/');
            setTimeout(function () { var t2 = document.querySelector('.model-selector-trigger'); if (t2) t2.click(); }, 400);
        } },
        { icon: 'lucide:brain', label: '추론 패널 열기', run: function () { if (typeof window.openContextPanel === 'function') window.openContextPanel('reasoning'); } },
        { icon: 'lucide:wrench', label: '도구 패널 열기', run: function () { if (typeof window.openContextPanel === 'function') window.openContextPanel('tools'); } },
        { icon: 'lucide:contrast', label: '테마 전환 (다크 / 라이트)', run: function () { if (typeof window.toggleTheme === 'function') window.toggleTheme(); } },
        { icon: 'lucide:settings', label: '설정 열기', run: function () { if (window.Router) window.Router.navigate('/settings.html'); } }
    ];
    if (authed) {
        actions.push({ icon: 'lucide:power', label: '로그아웃', run: function () { if (typeof window.logout === 'function') window.logout(); } });
    }
    actions.forEach(function (a) { cmds.push({ group: '액션', icon: a.icon, label: a.label, hint: a.hint, run: a.run }); });

    return cmds;
}

function renderList() {
    listEl.textContent = '';
    if (!shown.length) {
        const empty = document.createElement('div');
        empty.className = 'cmdk-empty';
        empty.textContent = '결과 없음';
        listEl.appendChild(empty);
        return;
    }
    let lastGroup = null;
    shown.forEach(function (c, i) {
        if (c.group !== lastGroup) {
            lastGroup = c.group;
            const gl = document.createElement('div');
            gl.className = 'cmdk-gl';
            gl.textContent = c.group;
            listEl.appendChild(gl);
        }
        const row = document.createElement('div');
        row.className = 'cmdk-row' + (i === selIdx ? ' sel' : '');
        row.setAttribute('role', 'option');

        const ic = document.createElement('iconify-icon');
        ic.className = 'ic';
        ic.setAttribute('icon', c.icon);
        row.appendChild(ic);

        const lbl = document.createElement('span');
        lbl.className = 'lbl';
        lbl.textContent = c.label;
        row.appendChild(lbl);

        if (c.hint) {
            const h = document.createElement('span');
            h.className = 'hint';
            h.textContent = c.hint;
            row.appendChild(h);
        }
        row.addEventListener('mousemove', function () { if (selIdx !== i) { selIdx = i; paintSel(); } });
        row.addEventListener('click', function () { selIdx = i; execute(); });
        listEl.appendChild(row);
    });
}

function paintSel() {
    const rows = listEl.querySelectorAll('.cmdk-row');
    rows.forEach(function (r, idx) { r.classList.toggle('sel', idx === selIdx); });
    if (rows[selIdx]) rows[selIdx].scrollIntoView({ block: 'nearest' });
}

function filterList(q) {
    q = (q || '').trim().toLowerCase();
    shown = !q ? allItems.slice() : allItems.filter(function (c) { return c.label.toLowerCase().indexOf(q) !== -1; });
    selIdx = 0;
    renderList();
}

function openPalette() {
    if (isOpen) return;
    allItems = buildCommands();
    shown = allItems.slice();
    selIdx = 0;
    inputEl.value = '';
    renderList();
    scrimEl.classList.add('open');
    isOpen = true;
    setTimeout(function () { inputEl.focus(); }, 0);
}

function closePalette() {
    if (!isOpen) return;
    scrimEl.classList.remove('open');
    isOpen = false;
}

function execute() {
    const c = shown[selIdx];
    if (!c) return;
    closePalette();
    try { c.run(); } catch (e) { console.error('[command-palette] run 실패:', e); }
}

function onKeydown(e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (isOpen) closePalette(); else openPalette();
        return;
    }
    if (!isOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = Math.min(selIdx + 1, shown.length - 1); paintSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selIdx = Math.max(selIdx - 1, 0); paintSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); execute(); }
}

function build() {
    if (document.querySelector('.cmdk-scrim')) return;

    scrimEl = document.createElement('div');
    scrimEl.className = 'cmdk-scrim';
    scrimEl.setAttribute('role', 'dialog');
    scrimEl.setAttribute('aria-modal', 'true');
    scrimEl.setAttribute('aria-label', '명령 팔레트');

    const box = document.createElement('div');
    box.className = 'cmdk';

    const inWrap = document.createElement('div');
    inWrap.className = 'cmdk-in';
    const mag = document.createElement('span');
    mag.className = 'mag';
    mag.textContent = '⌕';
    inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.placeholder = '검색하거나 명령 실행…';
    inputEl.setAttribute('aria-label', '명령 검색');
    inputEl.autocomplete = 'off';
    const escKbd = document.createElement('kbd');
    escKbd.textContent = 'esc';
    inWrap.appendChild(mag);
    inWrap.appendChild(inputEl);
    inWrap.appendChild(escKbd);

    listEl = document.createElement('div');
    listEl.className = 'cmdk-list';
    listEl.setAttribute('role', 'listbox');

    const foot = document.createElement('div');
    foot.className = 'cmdk-foot';
    [['↑↓', '이동'], ['↵', '실행'], ['esc', '닫기']].forEach(function (pair) {
        const span = document.createElement('span');
        const b = document.createElement('b');
        b.textContent = pair[0];
        span.appendChild(b);
        span.appendChild(document.createTextNode(' ' + pair[1]));
        foot.appendChild(span);
    });

    box.appendChild(inWrap);
    box.appendChild(listEl);
    box.appendChild(foot);
    scrimEl.appendChild(box);

    scrimEl.addEventListener('mousedown', function (e) { if (e.target === scrimEl) closePalette(); });
    inputEl.addEventListener('input', function () { filterList(inputEl.value); });

    document.body.appendChild(scrimEl);
    document.addEventListener('keydown', onKeydown);

    // 외부(슬림 레일 트리거 등)에서 호출
    window.openCommandPalette = openPalette;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
} else {
    build();
}
