/**
 * Capability 카탈로그 — 설정 화면·관리자 화면이 그리는 metadata (P03, 2026-09-23).
 *
 * Registry 스냅샷(정의)에 소유 add-on 의 실효 가용성(`addon-host/activation`)을 합친다. 함수(handler)는 싣지 않는다.
 * Registry 에 없는 배정 대상(꺼진 add-on 의 capability)도 `availability: 'disabled'` 로 **넣는다** — 저장된 배정을 지우지 않고
 * "중지됨" 으로 보여 주기 위해서다(계획서 6.4·8.4, T19).
 *
 * @module services/capability-catalog
 */
import { ASSIGNABLE_CAPABILITIES, CAPABILITY_LABELS_KO, type Capability } from '../config/capabilities';
import { snapshotForExecution } from '../runtime-ports/capability-runtime';
import { ensureLegacyCapabilityBridge } from '../addon-host/legacy-capability-bridge';
import { resolveAddonActivation, type AddonAvailability } from '../addon-host/activation';
import { listBuiltinAddonDefs } from '../addon-host/builtin-registry';
import { satisfiesOpenmakeRange } from '../addon-host/manifest';
import { APP_VERSION } from '../config/constants';
import { BASE_CAPABILITY_OWNER, type JsonSchema } from '../capability-contract/types';
import { readAddonStateStrict } from './addon/addon-state';

export interface CapabilityCatalogEntry {
    id: string;
    label: string;
    group: string;
    order: number;
    assignable: boolean;
    plannable: boolean;
    inputSchema: JsonSchema;
    settingsSchema: JsonSchema;
    executionMode: 'sync' | 'job';
    owner: string;
    availability: AddonAvailability;
}

export interface CapabilityCatalog {
    registryRevision: number;
    entries: CapabilityCatalogEntry[];
}

async function addonAvailability(addonId: string): Promise<AddonAvailability> {
    if (addonId === BASE_CAPABILITY_OWNER.addonId) return 'available';
    const manifest = listBuiltinAddonDefs().find(a => a.id === addonId)?.manifest;
    const state = await readAddonStateStrict(addonId);
    return resolveAddonActivation({
        addonId,
        hasRuntimeEntry: !!manifest?.entry?.runtime,
        versionCompatible: manifest ? satisfiesOpenmakeRange(APP_VERSION, manifest.requires.openmake) : true,
        row: state.known
            ? { known: true, desiredState: state.desiredState, state: state.state, stateRevision: state.stateRevision, lastFailureCode: state.lastFailureCode }
            : { known: false },
    }).effectiveAvailability;
}

export async function buildCapabilityCatalog(): Promise<CapabilityCatalog> {
    ensureLegacyCapabilityBridge();
    const snap = snapshotForExecution();
    const byOwner = new Map<string, AddonAvailability>();
    const entries: CapabilityCatalogEntry[] = [];
    for (const { definition: d, owner } of snap.capabilities) {
        if (!byOwner.has(owner.addonId)) byOwner.set(owner.addonId, await addonAvailability(owner.addonId));
        entries.push({
            id: d.id, label: d.display.label, group: d.display.group, order: d.display.order,
            assignable: d.assignable, plannable: d.plannable, inputSchema: d.inputSchema, settingsSchema: d.settingsSchema,
            executionMode: d.execution.mode, owner: owner.addonId, availability: byOwner.get(owner.addonId)!,
        });
    }
    // 등록되지 않은 배정 대상 — 꺼진 add-on 의 capability. 설정은 보존하고 '중지됨' 으로 표시한다
    const registered = new Set(entries.map(e => e.id));
    for (const id of ASSIGNABLE_CAPABILITIES as readonly Capability[]) {
        if (registered.has(id)) continue;
        entries.push({
            id, label: CAPABILITY_LABELS_KO[id], group: id.split('.')[0], order: 999, assignable: true, plannable: false,
            inputSchema: { type: 'object', properties: {} }, settingsSchema: { type: 'object', properties: {} },
            executionMode: 'sync', owner: 'none', availability: 'disabled',
        });
    }
    entries.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    return { registryRevision: snap.registryRevision, entries };
}
