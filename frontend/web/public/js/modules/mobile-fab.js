/**
 * 모바일 FAB 메뉴 — 480px 이하에서 mobileMenuBtn 대체
 * @module mobile-fab
 */

const FAB_BREAKPOINT = 480;

function applyBreakpoint(fabContainer) {
    const isMobile = window.innerWidth <= FAB_BREAKPOINT;
    fabContainer.style.display = isMobile ? 'block' : 'none';
    const menuBtn = document.getElementById('mobileMenuBtn');
    if (menuBtn) menuBtn.style.display = isMobile ? 'none' : '';
}

function closeMenu(fabMenu, fabBtn) {
    fabMenu.classList.remove('open');
    fabBtn.textContent = '≡';
}

function createFab() {
    const container = document.createElement('div');
    container.className = 'fab-container';

    const menu = document.createElement('div');
    menu.className = 'fab-menu';
    menu.id = 'fabMenu';

    const newChatItem = document.createElement('button');
    newChatItem.className = 'fab-menu-item primary';
    newChatItem.id = 'fabNewChat';
    newChatItem.textContent = '+ 새 대화';

    const historyItem = document.createElement('button');
    historyItem.className = 'fab-menu-item';
    historyItem.id = 'fabHistory';
    historyItem.textContent = '히스토리';

    const settingsItem = document.createElement('button');
    settingsItem.className = 'fab-menu-item';
    settingsItem.id = 'fabSettings';
    settingsItem.textContent = '설정';

    menu.appendChild(newChatItem);
    menu.appendChild(historyItem);
    menu.appendChild(settingsItem);

    const btn = document.createElement('button');
    btn.className = 'fab-btn';
    btn.id = 'fabBtn';
    btn.setAttribute('aria-label', '메뉴 열기');
    btn.textContent = '≡';

    container.appendChild(menu);
    container.appendChild(btn);

    return container;
}

export function init() {
    const fabContainer = createFab();
    document.body.appendChild(fabContainer);

    const fabBtn = fabContainer.querySelector('#fabBtn');
    const fabMenu = fabContainer.querySelector('#fabMenu');

    // FAB 버튼 — stopPropagation으로 document click과 충돌 방지
    fabBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        const isOpen = fabMenu.classList.toggle('open');
        fabBtn.textContent = isOpen ? '✕' : '≡';
        fabBtn.setAttribute('aria-label', isOpen ? '메뉴 닫기' : '메뉴 열기');
    });

    // 팝업 외부 클릭 시 닫힘
    document.addEventListener('click', function () {
        closeMenu(fabMenu, fabBtn);
    });

    // 메뉴 항목 핸들러
    fabContainer.querySelector('#fabNewChat').addEventListener('click', function (e) {
        e.stopPropagation();
        closeMenu(fabMenu, fabBtn);
        if (typeof window.newChat === 'function') window.newChat();
    });

    fabContainer.querySelector('#fabHistory').addEventListener('click', function (e) {
        e.stopPropagation();
        closeMenu(fabMenu, fabBtn);
        if (window.sidebar && typeof window.sidebar.toggle === 'function') window.sidebar.toggle();
    });

    fabContainer.querySelector('#fabSettings').addEventListener('click', function (e) {
        e.stopPropagation();
        closeMenu(fabMenu, fabBtn);
        if (typeof window.showSettings === 'function') window.showSettings();
    });

    // 초기 상태 즉시 적용 (ResizeObserver는 최초 콜백 보장 안 함)
    applyBreakpoint(fabContainer);

    // 이후 resize 감지
    const observer = new ResizeObserver(function () {
        applyBreakpoint(fabContainer);
    });
    observer.observe(document.body);

    // 정리(cleanup) 함수 제공
    window.cleanupMobileFAB = function() {
        observer.disconnect();
    };
}
