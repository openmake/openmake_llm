import { Plugin, PluginCommand, PluginTool, PluginHooks } from './types';

export class PluginRegistry {
    private plugins: Map<string, Plugin> = new Map();
    private commands: Map<string, PluginCommand> = new Map();
    private tools: Map<string, PluginTool> = new Map();
    private hooks: PluginHooks = {};

    register(plugin: Plugin): void {
        if (this.plugins.has(plugin.name)) {
            throw new Error(`플러그인이 이미 등록됨: ${plugin.name}`);
        }

        this.plugins.set(plugin.name, plugin);

        // 명령어 등록
        if (plugin.commands) {
            for (const cmd of plugin.commands) {
                const fullName = `${plugin.name}:${cmd.name}`;
                this.commands.set(fullName, cmd);
                this.commands.set(cmd.name, cmd); // 짧은 이름도 등록
            }
        }

        // 도구 등록
        if (plugin.tools) {
            for (const tool of plugin.tools) {
                const fullName = `${plugin.name}:${tool.name}`;
                this.tools.set(fullName, tool);
            }
        }

        // 훅 병합
        if (plugin.hooks) {
            this.mergeHooks(plugin.hooks);
        }
    }

    unregister(name: string): void {
        const plugin = this.plugins.get(name);
        if (!plugin) return;

        // 명령어 제거
        if (plugin.commands) {
            for (const cmd of plugin.commands) {
                this.commands.delete(`${name}:${cmd.name}`);
                this.commands.delete(cmd.name);
            }
        }

        // 도구 제거
        if (plugin.tools) {
            for (const tool of plugin.tools) {
                this.tools.delete(`${name}:${tool.name}`);
            }
        }

        this.plugins.delete(name);
    }

    private mergeHooks(hooks: PluginHooks): void {
        // 훅 체이닝을 위한 간단한 병합
        for (const [key, handler] of Object.entries(hooks)) {
            const hookKey = key as keyof PluginHooks;
            const existing = this.hooks[hookKey];

            if (existing && handler) {
                // 기존 훅과 새 훅을 체인으로 연결
                const hookObj = this.hooks as Record<string, ((...args: unknown[]) => Promise<unknown>) | undefined>;
                hookObj[hookKey] = async (...args: unknown[]) => {
                    const result = await (existing as (...a: unknown[]) => Promise<unknown>)(...args);
                    return (handler as (...a: unknown[]) => Promise<unknown>)(result ?? args[0]);
                };
            } else if (handler) {
                const hookObj = this.hooks as Record<string, ((...args: unknown[]) => Promise<unknown>) | undefined>;
                hookObj[hookKey] = handler as (...args: unknown[]) => Promise<unknown>;
            }
        }
    }

    getPlugin(name: string): Plugin | undefined {
        return this.plugins.get(name);
    }

    getCommand(name: string): PluginCommand | undefined {
        return this.commands.get(name);
    }

    getTool(name: string): PluginTool | undefined {
        return this.tools.get(name);
    }

    getHooks(): PluginHooks {
        return this.hooks;
    }

    listPlugins(): Plugin[] {
        return Array.from(this.plugins.values());
    }

    listCommands(): PluginCommand[] {
        return Array.from(this.commands.values());
    }

    listTools(): PluginTool[] {
        return Array.from(this.tools.values());
    }
}

// 전역 레지스트리 싱글톤
let globalRegistry: PluginRegistry | null = null;

export function getRegistry(): PluginRegistry {
    if (!globalRegistry) {
        globalRegistry = new PluginRegistry();
    }
    return globalRegistry;
}
