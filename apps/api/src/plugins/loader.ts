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
import { createLogger } from '../utils/logger';

// 새 canonical 경로: ~/.openmake-coder/plugins
// 기존 사용자 보호 위해 legacy ~/.ollama-coder/plugins 도 함께 읽음 (fallback chain).
const PLUGINS_DIR = path.join(os.homedir(), '.openmake-coder', 'plugins');
const LEGACY_PLUGINS_DIR = path.join(os.homedir(), '.ollama-coder', 'plugins');
const CONFIG_DIR = path.join(os.homedir(), '.openmake-coder');
const LEGACY_CONFIG_DIR = path.join(os.homedir(), '.ollama-coder');
const logger = createLogger('PluginLoader');

export class PluginLoader {
    private loadedPlugins: Map<string, Plugin> = new Map();
    private context: PluginContext;

    constructor(context?: Partial<PluginContext>) {
        const llmModel = (context?.llmModel ?? context?.ollamaModel ?? getConfig().llmDefaultModel) as string;
        // legacy config dir 가 존재하고 새 경로가 없으면 legacy 를 그대로 사용 (호환 우선).
        const configDirectory = fs.existsSync(CONFIG_DIR) || !fs.existsSync(LEGACY_CONFIG_DIR)
            ? CONFIG_DIR
            : LEGACY_CONFIG_DIR;
        this.context = {
            workingDirectory: process.cwd(),
            configDirectory,
            llmModel,
            ollamaModel: llmModel,  // legacy alias — 기존 플러그인 호환
            ...context
        };
    }

    async loadAll(): Promise<void> {
        const dirs = [PLUGINS_DIR, LEGACY_PLUGINS_DIR].filter((d, i, arr) =>
            arr.indexOf(d) === i  // dedupe (homedir 동일 시 안전)
        );

        let foundAny = false;
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) continue;
            foundAny = true;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    try {
                        await this.loadPlugin(path.join(dir, entry.name));
                    } catch (error) {
                        logger.error(`플러그인 로드 실패: ${entry.name}`, error);
                    }
                }
            }
        }

        if (!foundAny) {
            // 두 경로 모두 없으면 새 canonical 경로 생성 (legacy 는 건드리지 않음).
            fs.mkdirSync(PLUGINS_DIR, { recursive: true });
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
            logger.error(`플러그인 언로드 실패: ${name}`, error);
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
