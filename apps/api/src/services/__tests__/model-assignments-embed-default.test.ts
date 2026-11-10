/**
 * 통합 배정 서비스 — text.embed 실효(effective)는 개인 → 전역만 따르고, 둘 다 없으면 none/CAPABILITY_UNASSIGNED (2026-11-10).
 * 저장소만 메모리로 바꾸고 실제 capability-resolver·config(CAPABILITY_DEFAULTS)를 태운다 — 라우트의 서비스 mock 만으로
 * 정책을 증명하지 않는다. PUT/DELETE 뒤 재조회로 전역 캐시 무효화까지 확인한다.
 */
interface MockRow { scope: string; slot: string; fullId: string; params: Record<string, string>; updatedAt: Date }
const mockStore = new Map<string, MockRow>();
const mockKey = (scope: string, slot: string) => `${scope}\u0000${slot}`;
const mockConfig = { llmBaseUrl: 'http://127.0.0.1:13401/', llmApiKey: 'master', llmGatewayProviders: [] as string[] };

jest.mock('../../config', () => ({ ...jest.requireActual('../../config'), getConfig: () => mockConfig }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../capability-catalog', () => ({ buildCapabilityCatalog: async () => ({ entries: [] }) }));
jest.mock('../model-role-resolver', () => ({
    resolveRoleClientForUser: async () => ({ fullId: 'local-llm:fixture-chat', source: 'default' }),
    clearGlobalRolesCache: () => undefined,
}));
jest.mock('../../data/repositories/model-assignments-repo', () => ({
    ModelAssignmentsRepository: class {
        async listByScope(scope: string): Promise<MockRow[]> {
            return [...mockStore.values()].filter((r) => r.scope === scope).sort((a, b) => a.slot.localeCompare(b.slot));
        }
        async get(scope: string, slot: string): Promise<MockRow | null> {
            return mockStore.get(mockKey(scope, slot)) ?? null;
        }
        async upsert(scope: string, slot: string, fullId: string, params: Record<string, string>) {
            const previous = mockStore.get(mockKey(scope, slot))?.fullId ?? null;
            const row = { scope, slot, fullId, params, updatedAt: new Date('2026-11-10T00:00:00.000Z') };
            mockStore.set(mockKey(scope, slot), row);
            return { row, previous };
        }
        async delete(scope: string, slot: string) {
            const prev = mockStore.get(mockKey(scope, slot));
            mockStore.delete(mockKey(scope, slot));
            return { deleted: !!prev, previous: prev?.fullId ?? null };
        }
        async insertIfAbsent(): Promise<boolean> { return false; }
    },
}));

import { buildAssignmentsResponse, putAssignment, deleteAssignment } from '../model-assignments-service';
import { clearGlobalCapabilityCache } from '../orchestrator/capability-resolver';
import { CAPABILITY_DEFAULTS, GLOBAL_CAPABILITY_SCOPE } from '../../config/capabilities';

const USER = 'u-fixture';
const GLOBAL_EMBED = 'local-llm:fixture-embed-global';
const USER_EMBED = 'local-llm:fixture-embed-user';

async function embedEffective(scope: 'user' | 'global') {
    const res = scope === 'user'
        ? await buildAssignmentsResponse({ scope: USER, resolutionUserId: USER })
        : await buildAssignmentsResponse({ scope: GLOBAL_CAPABILITY_SCOPE, resolutionUserId: undefined });
    return res.effective.find((e) => e.slot === 'text.embed');
}

beforeEach(() => {
    mockStore.clear();
    clearGlobalCapabilityCache();
});

describe('buildAssignmentsResponse — text.embed 실효 모델', () => {
    it('개인·전역 모두 없음 → 개인/관리자 모두 fullId null · source none · CAPABILITY_UNASSIGNED (코드 기본값 없음)', async () => {
        expect(CAPABILITY_DEFAULTS['text.embed']).toBeUndefined();
        for (const scope of ['user', 'global'] as const) {
            expect(await embedEffective(scope)).toMatchObject({ slot: 'text.embed', fullId: null, source: 'none', code: 'CAPABILITY_UNASSIGNED' });
        }
    });

    it('전역 배정 → 개인 미배정 사용자는 상속(source global), 관리자는 actor-byok 표시', async () => {
        await putAssignment({ scope: GLOBAL_CAPABILITY_SCOPE, slotId: 'text.embed', admin: true, model: GLOBAL_EMBED });
        expect(await embedEffective('user')).toEqual({ slot: 'text.embed', fullId: GLOBAL_EMBED, source: 'global' });
        expect(await embedEffective('global')).toEqual({ slot: 'text.embed', fullId: GLOBAL_EMBED, source: 'global', keyPolicy: 'actor-byok' });
    });

    it('개인 배정은 전역보다 우선, 개인 삭제 → 전역 상속, 전역 삭제 → none (캐시 무효화 반영)', async () => {
        await putAssignment({ scope: GLOBAL_CAPABILITY_SCOPE, slotId: 'text.embed', admin: true, model: GLOBAL_EMBED });
        await putAssignment({ scope: USER, slotId: 'text.embed', admin: false, model: USER_EMBED });
        expect(await embedEffective('user')).toMatchObject({ fullId: USER_EMBED, source: 'user' });

        await deleteAssignment({ scope: USER, slotId: 'text.embed', admin: false });
        expect(await embedEffective('user')).toMatchObject({ fullId: GLOBAL_EMBED, source: 'global' });

        await deleteAssignment({ scope: GLOBAL_CAPABILITY_SCOPE, slotId: 'text.embed', admin: true });
        expect(await embedEffective('user')).toMatchObject({ fullId: null, source: 'none', code: 'CAPABILITY_UNASSIGNED' });
        expect(await embedEffective('global')).toMatchObject({ fullId: null, source: 'none', code: 'CAPABILITY_UNASSIGNED' });
    });

    it('개인 배정만 있으면 전역 없이도 동작, 관리자 전역 조회는 개인 배정을 보지 않는다', async () => {
        await putAssignment({ scope: USER, slotId: 'text.embed', admin: false, model: USER_EMBED });
        expect(await embedEffective('user')).toMatchObject({ fullId: USER_EMBED, source: 'user' });
        expect(await embedEffective('global')).toMatchObject({ fullId: null, source: 'none', code: 'CAPABILITY_UNASSIGNED' });
    });
});
