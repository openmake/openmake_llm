/**
 * 팩 eval 세트 — add-on 이 자기 기능의 골든 케이스를 동봉한다 (2026-09-19, S3).
 *
 * "이 팩은 이 모델에서 검증됨" 이 상품 가치이므로, 케이스는 팩과 함께 다닌다.
 * Base 의 골든셋(`evaluation/golden-dataset.json`)에 **켜진 add-on 의 케이스만** 합류하고,
 * id 는 `<addonId>:<caseId>` 로 네임스페이스해 Base 케이스와 충돌하지 않는다.
 *
 * 형식이 어긋난 팩 케이스는 그 팩만 건너뛴다(fail-open) — 평가 실행 자체를 막지 않는다.
 *
 * @module addon-host/pack-evals
 */
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';
import { enabledBuiltinAddons } from './builtin-registry';

const logger = createLogger('PackEvals');

/** 팩 케이스 — Base 골든셋 스키마를 그대로 따른다(검증은 dataset-loader 가 한 번에 한다). */
export interface PackEvalCase extends Record<string, unknown> {
    id: string;
    category: string;
    query: string;
}

/** 켜진 add-on 이 동봉한 eval 케이스 — id 는 `<addonId>:<caseId>`, tags 에 `addon:<id>` 가 붙는다. */
export function loadEnabledPackEvalCases(): PackEvalCase[] {
    const out: PackEvalCase[] = [];
    for (const addon of enabledBuiltinAddons()) {
        const rel = addon.manifest.components.evals;
        if (!rel) continue;
        try {
            const raw = JSON.parse(fs.readFileSync(path.resolve(addon.dir, rel), 'utf-8')) as { cases?: PackEvalCase[] };
            for (const c of raw.cases ?? []) {
                const tags = Array.isArray(c.tags) ? (c.tags as string[]) : [];
                out.push({ ...c, id: `${addon.id}:${c.id}`, tags: [...tags, `addon:${addon.id}`] });
            }
        } catch (err) {
            logger.warn(`팩 '${addon.id}' eval 세트를 읽지 못해 건너뜀: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    if (out.length > 0) logger.info(`팩 eval 케이스 ${out.length}건 합류`);
    return out;
}

/**
 * 켜진 add-on 중 eval 세트를 **선언한** 것의 id — "케이스 0건" 을 두 경우로 가르는 데 쓴다:
 * 선언한 팩이 없으면 평가할 대상이 없는 것(건너뜀), 선언했는데 0건이면 읽기 실패(실패로 알린다).
 */
export function addonsDeclaringEvals(): string[] {
    return enabledBuiltinAddons().filter(a => a.manifest.components.evals).map(a => a.id);
}
