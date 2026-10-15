/**
 * 계약만 import 하는 가상의 add-on — 계약 패키지만으로 add-on 을 쓸 수 있는지 **컴파일로** 확인한다.
 * `npm run build --workspace=@openmake/plugin-contracts` 의 두 번째 단계(tsconfig.sample.json)가 이 파일을 검사한다.
 * `@ts-expect-error` 줄은 계약이 막아야 하는 잘못된 사용이다 — 계약이 느슨해지면 "사용되지 않은 지시문"(TS2578)으로 실패한다.
 */
import {
    CAPABILITY_CONTRACT_VERSION, PLUGIN_CONTRACT_VERSION,
    type Actor, type AddonInstallationIntent, type AddonManifestDTO, type AddonRuntimeEntry, type AddonRuntimeHandle,
    type CapabilityDefinition, type CapabilityExecContextDTO, type CapabilityExecutorOutputDTO, type CapabilityTaskDTO,
    type SkillRecordDTO,
} from '@openmake/plugin-contracts';

/** 샘플 주기 작업 간격(ms) — 샘플 전용 값 */
const SAMPLE_TICK_MS = 1000;
/** 샘플 capability 실행 상한(ms) — 샘플 전용 값 */
const SAMPLE_TIMEOUT_MS = 1000;

export const contractVersion: '1.0.0' = PLUGIN_CONTRACT_VERSION;

export const manifest: AddonManifestDTO = {
    id: 'sample-addon',
    name: 'Sample',
    version: '1.0.0',
    requires: { openmake: '>=1.0.0 <2.0.0', capabilityContract: CAPABILITY_CONTRACT_VERSION },
    scope: 'organization',
    kind: 'runtime',
    components: {},
    entry: { runtime: 'index#start' },
    provides: { capabilities: ['sample.echo'] },
    permissions: ['network:internet'],
};

const definition: CapabilityDefinition = {
    id: 'sample.echo',
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    assignable: false,
    plannable: true,
    display: { label: '샘플', group: 'text', order: 1 },
    plannerHint: '입력을 그대로 돌려준다',
    inputSchema: {},
    settingsSchema: {},
    execution: { mode: 'sync', timeoutMs: SAMPLE_TIMEOUT_MS, supportsCancellation: false },
    output: { mimeTypes: ['text/plain'] },
};

/** 샘플 handler — 계약 DTO 만 쓴다(Base 의 CapabilityHandler 는 여기에 Base 포트를 더한 것이다) */
interface SampleHandler {
    execute(task: CapabilityTaskDTO, ctx: CapabilityExecContextDTO): Promise<CapabilityExecutorOutputDTO>;
}

const handler: SampleHandler = {
    async execute(task) {
        return { ok: true, text: task.instruction, media: [] };
    },
};

export const start: AddonRuntimeEntry<SampleHandler> = async (host) => {
    host.registerCapabilities([{ definition, handler }]);
    let running = true;
    const timer = host.setInterval(() => undefined, SAMPLE_TICK_MS);
    host.registerDisposable('sample-timer', () => clearInterval(timer));
    const handle: AddonRuntimeHandle = {
        async stop({ drain, signal }) {
            running = false;
            if (drain && !signal.aborted) await Promise.resolve();
        },
        async resume() {
            running = true;
        },
        health: () => ({ status: running ? 'running' : 'stopped', inflight: 0 }),
    };
    return handle;
};

export function describeActor(actor: Actor): string {
    switch (actor.kind) {
        case 'user': return `user:${actor.userId}`;
        case 'org': return `org:${actor.orgId}`;
        case 'system': return `system:${actor.reason}`;
    }
}

export const skill: SkillRecordDTO = {
    id: 's1', name: '요약', description: '', content: '# 요약', category: 'general', isPublic: true,
    status: 'active', sourcePath: null, extensionId: null, createdBy: null,
    createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z',
};

export const intent: AddonInstallationIntent = { addonId: 'sample-addon', desiredState: 'enabled', state: 'enabled' };

// ── 계약이 막아야 하는 사용 ──
// @ts-expect-error actor 종류는 user·org·system 뿐이다
export const badActor: Actor = { kind: 'admin', userId: 'x' };
// @ts-expect-error 의도(desiredState)는 enabled·disabled 뿐이다 — failed 는 부팅 결과지 의도가 아니다
export const badIntent: AddonInstallationIntent = { addonId: 'x', desiredState: 'failed', state: 'failed' };
// @ts-expect-error 매니페스트 권한 어휘 밖의 값은 거절된다
export const badPermission: AddonManifestDTO['permissions'] = ['files:read'];
// @ts-expect-error capability 계약 버전은 1 이다
export const badContract: AddonManifestDTO['requires'] = { openmake: '>=1.0.0', capabilityContract: 2 };
