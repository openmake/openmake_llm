import {
    MODEL_ROLES,
    getModelForRole,
    getAllRoleModels,
    hasRoleEnvOverride,
    isExternalFullId,
    toLocalModelTag,
    validateModels,
} from './model-roles';

const ROLE_ENVS = [
    'OMK_CHAT_MODEL', 'OMK_AGENT_MODEL', 'OMK_JUDGE_MODEL', 'OMK_RESEARCH_MODEL',
    'OMK_SPAWN_MODEL', 'OMK_REVIEW_MODEL', 'OMK_ROUTER_MODEL', 'OMK_SUMMARY_MODEL', 'OMK_UIR_MODEL',
    'LLM_DEFAULT_MODEL',
];

describe('model-roles (Role-based Multi-Agent Orchestration)', () => {
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const k of ROLE_ENVS) {
            saved[k] = process.env[k];
            delete process.env[k];
        }
        process.env.LLM_DEFAULT_MODEL = 'qwen3.6-35b-a3b';
    });

    afterEach(() => {
        for (const k of ROLE_ENVS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    });

    describe('역할 목록', () => {
        it('8개 역할 SoT — classifier 없음 (DB CHECK 073 정합)', () => {
            expect(MODEL_ROLES).toEqual(['chat', 'agent', 'judge', 'research', 'spawn', 'review', 'router', 'summary']);
        });
    });

    describe('getModelForRole 폴백', () => {
        it('역할 env 미설정 → LLM_DEFAULT_MODEL 위임 (전 역할)', () => {
            for (const role of MODEL_ROLES) {
                expect(getModelForRole(role)).toBe('qwen3.6-35b-a3b');
            }
        });

        it('신규 역할 env 우선 (OMK_JUDGE_MODEL 등)', () => {
            process.env.OMK_JUDGE_MODEL = 'judge-model';
            process.env.OMK_SPAWN_MODEL = 'spawn-model';
            expect(getModelForRole('judge')).toBe('judge-model');
            expect(getModelForRole('spawn')).toBe('spawn-model');
            expect(getModelForRole('chat')).toBe('qwen3.6-35b-a3b');
        });

        it('router legacy OMK_UIR_MODEL 폴백 유지', () => {
            process.env.OMK_UIR_MODEL = 'legacy-router';
            expect(getModelForRole('router')).toBe('legacy-router');
            process.env.OMK_ROUTER_MODEL = 'new-router';
            expect(getModelForRole('router')).toBe('new-router');
        });

        it('hasRoleEnvOverride — env 설정 여부 판정 (legacy 포함)', () => {
            expect(hasRoleEnvOverride('judge')).toBe(false);
            process.env.OMK_JUDGE_MODEL = 'x';
            expect(hasRoleEnvOverride('judge')).toBe(true);
            expect(hasRoleEnvOverride('router')).toBe(false);
            process.env.OMK_UIR_MODEL = 'y';
            expect(hasRoleEnvOverride('router')).toBe(true);
        });

        it('getAllRoleModels — 전 역할 키 포함', () => {
            const all = getAllRoleModels();
            expect(Object.keys(all).sort()).toEqual([...MODEL_ROLES].sort());
        });
    });

    describe('fullId 판별', () => {
        it('카탈로그 외부 prefix → external', () => {
            expect(isExternalFullId('openrouter:openai/gpt-5')).toBe(true);
            expect(isExternalFullId('nvidia:meta/llama-3.3-70b')).toBe(true);
        });

        it('local-llm prefix / 무 prefix / 미등록 prefix(로컬 태그) → not external', () => {
            expect(isExternalFullId('local-llm:qwen3.6-35b-a3b')).toBe(false);
            expect(isExternalFullId('qwen3.6-35b-a3b')).toBe(false);
            // 채팅 경로 규칙과 동일: 모르는 prefix 는 로컬 모델 태그로 간주
            expect(isExternalFullId('deepseek-v3.1:671b')).toBe(false);
        });

        it('toLocalModelTag — local-llm: strip, 외부는 null, 태그는 그대로', () => {
            expect(toLocalModelTag('local-llm:qwen3.6-35b-a3b')).toBe('qwen3.6-35b-a3b');
            expect(toLocalModelTag('openrouter:openai/gpt-5')).toBeNull();
            expect(toLocalModelTag('qwen3.6-35b-a3b')).toBe('qwen3.6-35b-a3b');
        });
    });

    describe('validateModels — 전역 env 외부 fullId 거부', () => {
        const fetchOk = () =>
            jest.spyOn(global, 'fetch').mockResolvedValue({
                ok: true,
                json: async () => ({ data: [{ id: 'qwen3.6-35b-a3b' }] }),
            } as unknown as Response);

        afterEach(() => jest.restoreAllMocks());

        it('전역 env 에 외부 fullId → 경고만 (서버 공용 키 전제 — 강제는 런타임 resolver), failFast 여도 통과', async () => {
            process.env.OMK_JUDGE_MODEL = 'openrouter:openai/gpt-5';
            const spy = fetchOk();
            await expect(validateModels('http://localhost:4000', true)).resolves.toBeUndefined();
            expect(spy).toHaveBeenCalled(); // 로컬 모델 검증은 계속 수행
        });

        it("'local-llm:' prefix 는 태그로 벗겨 /v1/models 대조", async () => {
            process.env.OMK_CHAT_MODEL = 'local-llm:qwen3.6-35b-a3b';
            fetchOk();
            await expect(validateModels('http://localhost:4000', true)).resolves.toBeUndefined();
        });

        it('미노출 로컬 모델 + failFast → throw (기존 동작 유지)', async () => {
            process.env.OMK_CHAT_MODEL = 'not-served-model';
            fetchOk();
            await expect(validateModels('http://localhost:4000', true))
                .rejects.toThrow(/노출되지 않은 모델/);
        });
    });
});
