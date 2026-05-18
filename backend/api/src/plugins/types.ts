/**
 * ============================================================
 * Plugin Types - 플러그인 계약(Contract) 타입 정의
 * ============================================================
 * 플러그인 생명주기 훅, 커맨드, 툴, 컨텍스트, 매니페스트 타입을
 * 선언합니다.
 *
 * @module plugins/types
 */

export interface Plugin {
    name: string;
    version: string;
    description?: string;

    // 생명주기 훅
    onLoad?: () => Promise<void>;
    onUnload?: () => Promise<void>;

    // 기능 확장
    commands?: PluginCommand[];
    tools?: PluginTool[];
    hooks?: PluginHooks;
}

export interface PluginCommand {
    name: string;
    description: string;
    usage?: string;
    handler: (args: string[]) => Promise<void>;
}

export interface PluginTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface PluginHooks {
    beforeChat?: (message: string) => Promise<string>;
    afterResponse?: (response: string) => Promise<string>;
    beforeCommand?: (command: string, args: string[]) => Promise<boolean>;
    afterCommand?: (command: string, result: unknown) => Promise<void>;
}

export interface PluginContext {
    workingDirectory: string;
    configDirectory: string;
    /** 로컬 LLM 모델 ID (canonical). */
    llmModel: string;
    /** @deprecated Use llmModel. 호환 alias — 기존 플러그인 호환 위해 동일 값 유지. */
    ollamaModel: string;
}

export interface PluginManifest {
    name: string;
    version: string;
    description?: string;
    main: string;
    dependencies?: Record<string, string>;
}
