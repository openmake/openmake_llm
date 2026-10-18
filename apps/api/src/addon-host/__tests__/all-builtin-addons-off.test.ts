/**
 * 내장 add-on 을 env(`ADDON_BUILTIN_DISABLED`)로 **모두** 끈 배포 — Base 가 add-on 코드를 한 줄도 불러오지 않고 선다
 * (개발 원칙 "add-on 을 전부 꺼도 Base 만으로 채팅·에이전트 작업·아티팩트가 동작").
 *
 * add-on 코드는 `enabledBuiltinAddons()` → `loadAddonEntry()` 한 길로만 올라온다. 로더를 부르면 실패하게 막고,
 * 확장점(채팅 통합·채팅 모드·기여·라우트·worker)마다 빈 결과인지, 미디어 capability 실행이 명시 거절되는지 본다.
 * 그 상태에서 채팅 경계 함수의 중립값은 `services/chat-service/__tests__/base-only-addons-off.test.ts` 가 본다.
 */
import type { Application, Router } from 'express';

const loadAddonEntry = jest.fn((addon: { id: string }, ref: string) => {
    throw new Error(`꺼진 add-on 의 코드를 불러왔다: ${addon.id} ${ref}`);
});
jest.mock('../entry-loader', () => ({ loadAddonEntry: (addon: { id: string }, ref: string) => loadAddonEntry(addon, ref) }));

import { builtinAddonIds, enabledBuiltinAddons, listBuiltinAddonDefs } from '../builtin-registry';
import { loadEnabledChatIntegrations } from '../chat-integrations';
import { loadEnabledChatModes } from '../chat-modes';
import {
    contributedApiKeyScopes, contributedAuditActions, contributedCliCommands, contributedSettings, contributedToolRisk, runFirstRunHooks,
} from '../contributions';
import { mountAddonRoutes, mountAddonV1Routes } from '../routes';
import { AddonWorkerConfigError, loadAddonWorker } from '../worker-entry';
import { admitCapability } from '../../capability-contract/admission';

const ENV_KEY = 'ADDON_BUILTIN_DISABLED';
const before = process.env[ENV_KEY];

beforeAll(() => { process.env[ENV_KEY] = builtinAddonIds().join(','); });
afterAll(() => { if (before === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = before; });
afterEach(() => expect(loadAddonEntry).not.toHaveBeenCalled());

const fakeMount = () => {
    const paths: string[] = [];
    const target = { use: (path: string) => { paths.push(path); } };
    return { paths, app: target as unknown as Application, router: target as unknown as Router };
};

describe('내장 add-on 을 모두 끈 배포', () => {
    it('끌 add-on 이 실제로 있고(대조), 켜진 것은 0개다', () => {
        expect(listBuiltinAddonDefs().length).toBeGreaterThan(10);
        expect(enabledBuiltinAddons()).toEqual([]);
    });

    it('채팅 통합·채팅 모드가 비어 있다', () => {
        expect(loadEnabledChatIntegrations()).toEqual([]);
        expect(loadEnabledChatModes()).toEqual([]);
    });

    it('설정 키·API 키 스코프·감사 action·CLI·도구 위험 등급·첫 실행 훅 기여가 없다', () => {
        expect(contributedSettings()).toEqual([]);
        expect(contributedApiKeyScopes()).toEqual([]);
        expect(contributedAuditActions()).toEqual({});
        expect(contributedCliCommands()).toEqual([]);
        expect(contributedToolRisk()).toEqual({});
        expect(runFirstRunHooks('/nonexistent/.env')).toEqual([]);
    });

    it('add-on 라우트는 하나도 걸리지 않고 목록 API(/api/addons)만 남는다', () => {
        const app = fakeMount();
        mountAddonRoutes(app.app);
        expect(app.paths).toEqual(['/api/addons']);
        const v1 = fakeMount();
        mountAddonV1Routes(v1.router);
        expect(v1.paths).toEqual([]);
    });

    it('add-on worker 는 꺼짐으로 거절한다(별도 프로세스 기동 설정 오류)', () => {
        const workers = listBuiltinAddonDefs().flatMap((a) => (a.manifest.entry?.workers ?? []).map((w) => w.name));
        expect(workers.length).toBeGreaterThan(0);
        for (const name of workers) expect(() => loadAddonWorker(name)).toThrow(AddonWorkerConfigError);
    });

    it('미디어 capability 실행은 제공 add-on 없음으로 명시 거절한다(예외 없이)', async () => {
        for (const capability of ['image.generate', 'music.generate', 'video.generate']) {
            await expect(admitCapability(capability)).resolves.toMatchObject({ ok: false, code: 'CAPABILITY_NOT_REGISTERED' });
        }
    });
});
