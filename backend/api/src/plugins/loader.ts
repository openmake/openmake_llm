/**
 * ============================================================
 * Plugin Loader - 사용자 플러그인 동적 로더
 * ============================================================
 * 플러그인 디렉토리 스캔, 매니페스트 파싱, 동적 로드/언로드,
 * 레지스트리 등록/해제를 담당합니다.
 *
 * @module plugins/loader
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Plugin, PluginManifest, PluginContext } from './types';
import { getRegistry } from './registry';
import { getConfig } from '../config';

const PLUGINS_DIR = path.join(os.homedir(), '.ollama-coder', 'plugins');

export class PluginLoader {
    private loadedPlugins: Map<string, Plugin> = new Map();
    private context: PluginContext;

    constructor(context?: Partial<PluginContext>) {
        this.context = {
            workingDirectory: process.cwd(),
            configDirectory: path.join(os.homedir(), '.ollama-coder'),
            ollamaModel: getConfig().ollamaDefaultModel,
            ...context
        };
    }

    async loadAll(): Promise<void> {
        if (!fs.existsSync(PLUGINS_DIR)) {
            fs.mkdirSync(PLUGINS_DIR, { recursive: true });
            return;
        }

        const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory()) {
                try {
                    await this.loadPlugin(path.join(PLUGINS_DIR, entry.name));
                } catch (error) {
                    console.error(`플러그인 로드 실패: ${entry.name}`, error);
                }
            }
        }
    }

    async loadPlugin(pluginPath: string): Promise<Plugin | null> {
        const manifestPath = path.join(pluginPath, 'package.json');

        if (!fs.existsSync(manifestPath)) {
            return null;
        }

        try {
            const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
            const manifest: PluginManifest = JSON.parse(manifestContent);

            const mainPath = path.join(pluginPath, manifest.main || 'index.js');

            if (!fs.existsSync(mainPath)) {
                throw new Error(`메인 파일을 찾을 수 없음: ${mainPath}`);
            }

            // 동적 로드
            const pluginModule = require(mainPath);
            const plugin: Plugin = pluginModule.default || pluginModule;

            if (!plugin.name) {
                plugin.name = manifest.name;
            }
            if (!plugin.version) {
                plugin.version = manifest.version;
            }

            // 생명주기 훅 실행
            if (plugin.onLoad) {
                await plugin.onLoad();
            }

            // 레지스트리에 등록
            getRegistry().register(plugin);
            this.loadedPlugins.set(plugin.name, plugin);

            return plugin;
        } catch (error) {
            throw new Error(`플러그인 로드 오류: ${error}`);
        }
    }

    async unloadPlugin(name: string): Promise<void> {
        const plugin = this.loadedPlugins.get(name);
        if (!plugin) return;

        try {
            if (plugin.onUnload) {
                await plugin.onUnload();
            }

            getRegistry().unregister(name);
            this.loadedPlugins.delete(name);
        } catch (error) {
            console.error(`플러그인 언로드 실패: ${name}`, error);
        }
    }

    async unloadAll(): Promise<void> {
        for (const name of this.loadedPlugins.keys()) {
            await this.unloadPlugin(name);
        }
    }

    getLoadedPlugins(): Plugin[] {
        return Array.from(this.loadedPlugins.values());
    }

    getPluginsDirectory(): string {
        return PLUGINS_DIR;
    }

    getContext(): PluginContext {
        return this.context;
    }
}

export function createPluginLoader(context?: Partial<PluginContext>): PluginLoader {
    return new PluginLoader(context);
}
