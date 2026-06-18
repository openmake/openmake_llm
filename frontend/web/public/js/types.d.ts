/**
 * Frontend window globals — TypeScript declaration only.
 *
 * main.js + 각 모듈이 window.X = X 로 등록하는 함수들을 declare global 하여
 * TS 2568 (Property may not exist on Window) 경고를 해소합니다.
 *
 * 본 파일은 런타임 영향 0 — TypeScript checker / IDE intellisense 용도.
 *
 * @module types
 */

export {};

declare global {
    interface Window {
        // chat & messaging
        sendMessage?: (...args: unknown[]) => unknown;
        copyMessage?: (...args: unknown[]) => unknown;
        reportMessage?: (...args: unknown[]) => unknown;
        regenerateMessage?: (...args: unknown[]) => unknown;
        useSuggestion?: (...args: unknown[]) => unknown;
        abortChat?: (...args: unknown[]) => unknown;
        newChat?: (...args: unknown[]) => unknown;
        appendToken?: (...args: unknown[]) => unknown;
        finishAssistantMessage?: (...args: unknown[]) => unknown;
        addChatMessage?: (...args: unknown[]) => unknown;

        // ui helpers
        showToast?: (message: string, type?: string) => void;
        showError?: (message: string) => void;
        renderMarkdown?: (md: string) => string;
        escapeHtml?: (s: string) => string;
        escapeHTML?: (s: string) => string;
        scrollToBottom?: () => void;
        applyTheme?: (theme: string) => void;
        toggleTheme?: () => void;
        setTheme?: (theme: string) => void;
        toggleSidebar?: () => void;
        toggleMobileSidebar?: () => void;
        closeMobileSidebar?: () => void;
        openModal?: (id: string) => void;
        closeModal?: (id: string) => void;
        showFileUpload?: () => void;
        closeFileModal?: () => void;

        // utilities
        formatDate?: (d: Date | string) => string;
        formatTimeAgo?: (d: Date | string) => string;
        relativeTime?: (d: Date | string) => string;
        formatFileSize?: (bytes: number) => string;
        truncateFilename?: (name: string, max?: number) => string;
        debounce?: <T extends (...args: unknown[]) => unknown>(fn: T, ms: number) => T;
        throttle?: <T extends (...args: unknown[]) => unknown>(fn: T, ms: number) => T;
        generateUUID?: () => string;
        deepClone?: <T>(obj: T) => T;
        handleKeyDown?: (e: KeyboardEvent) => void;

        // auth & user
        authFetch?: (url: string, init?: RequestInit) => Promise<Response>;
        authJsonFetch?: <T = unknown>(url: string, init?: RequestInit) => Promise<T>;
        isLoggedIn?: () => boolean;
        isAdmin?: () => boolean;
        getCurrentUser?: () => Record<string, unknown> | null;
        updateAuthUI?: () => void;
        enterGuestMode?: () => void;
        login?: (email: string, password: string) => Promise<unknown>;
        logout?: () => Promise<void>;

        // navigation
        NAV_ITEMS?: { menu: unknown[]; admin: unknown[] };
        Router?: { navigate: (path: string) => void; getCurrentPath: () => string };
        sidebar?: { toggle: () => void; setState: (s: string) => void; getState: () => string; setActiveConversation?: (id: string | null) => void };
        SafeStorage?: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void };

        // settings / mcp
        MCP_TOOL_CATALOG?: unknown[];
        loadMCPSettings?: () => unknown;
        saveMCPSettings?: () => void;
        toggleMCPTool?: (name: string) => void;
        getEnabledTools?: () => Record<string, boolean>;

        // skill / feature cards
        startFeatureChat?: (kind: string) => void;
        handleCommand?: (cmd: string) => void;
        showHelpAndMessage?: (msg: string) => void;
        performWebSearch?: (q: string) => void;
        // useMode / showUserGuide / closeGuideModal: 2026-05-21 사용 가이드 시스템 폐기

        // sanitize
        purifyHTML?: (html: string) => string;
        sanitizeHTML?: (html: string) => string;
        escapeCodeBlock?: (code: string) => string;
        safeSetHTML?: (el: HTMLElement, html: string) => void;

        // misc
        _origAlert?: (msg?: string) => void;
        PageModules?: Record<string, { getHTML?: () => string; init?: () => void; cleanup?: () => void }>;

        // WebSocket
        connectWebSocket?: () => void;
        isConnected?: () => boolean;
        sendWsMessage?: (msg: unknown) => void;

        // ChatService 외 시스템 함수 (필요 시 추가)
        [key: string]: unknown;
    }
}
