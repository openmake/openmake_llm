/**
 * 켜진 add-on 이 싣는 에이전트 정의·라우팅 어휘 (매니페스트 `components.agents`·`components.routingVocabulary`).
 *
 * Base(`agents/types.ts`·`agents/enhanced-keywords.ts`)는 특정 팩을 알지 않고 이 함수만 부른다 — 여러 add-on 이
 * 선언하면 합친다(같은 키는 `order` 가 앞선 쪽 우선). 모듈 로드 시점에 불리므로 레지스트리 외 의존을 두지 않는다.
 * 선언된 파일을 못 읽으면 throw 한다 — 호출부가 기록한다(조용히 빈 값으로 넘기지 않는다).
 *
 * @module addon-host/pack-data
 */
import * as fs from 'fs';
import * as path from 'path';
import { enabledBuiltinAddons } from './builtin-registry';

function mergeComponentJson<T>(component: 'agents' | 'routingVocabulary'): Record<string, T> {
    const merged: Record<string, T> = {};
    for (const addon of enabledBuiltinAddons()) {
        const rel = addon.manifest.components[component];
        if (!rel) continue;
        const data = JSON.parse(fs.readFileSync(path.resolve(addon.dir, rel), 'utf-8')) as Record<string, T>;
        for (const [key, value] of Object.entries(data)) if (!(key in merged)) merged[key] = value;
    }
    return merged;
}

/** 카테고리 id → 카테고리(에이전트 목록) */
export function loadAddonAgentCategories<T>(): Record<string, T> {
    return mergeComponentJson<T>('agents');
}

/** 에이전트 id → 어휘 추출용 텍스트 */
export function loadAddonRoutingVocabulary(): Record<string, string> {
    return mergeComponentJson<string>('routingVocabulary');
}
