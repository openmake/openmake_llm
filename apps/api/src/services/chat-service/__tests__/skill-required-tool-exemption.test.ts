/**
 * 스킬 required 도구의 distractor 억제 면제 회귀 테스트 (2026-08-14).
 *
 * 아티팩트/지도 의도 턴은 generate_image 등 distractor 도구를 억제하는데
 * (2026-06-23 통제실험), 활성 스킬이 required 로 바인딩한 도구까지 함께 잘려
 * 스킬 워크플로우(예: 발표자료 스킬의 병렬 삽화 생성)가 막히던 갭을 면제로 해소.
 * 스킬의 명시 의도 > 일반화된 distractor 휴리스틱.
 */
import { buildExternalToolPlan } from '../external-tool-plan';
import type { ChatMessageRequest } from '../../chat-service-types';
import type { ToolDefinition } from '../../../llm';

const makeTool = (name: string): ToolDefinition => ({
    type: 'function',
    function: { name, description: name, parameters: { type: 'object', properties: {} } },
});

const toolNames = (plan: { tools: ToolDefinition[] }) => plan.tools.map((t) => t.function.name);

describe('buildExternalToolPlan — 스킬 required 도구 억제 면제', () => {
    const generateImage = makeTool('generate_image');
    const odCreate = makeTool('open-design::create_artifact');
    const base = {
        allowedTools: [generateImage, odCreate],
        toolCalling: true,
        wantsMap: false,
        orchestration: { discussion: false, taskDelegate: false },
    };
    // ARTIFACT_INTENT_PATTERNS 매칭 문구 ("html ... 만들어줘")
    const artifactReq = { message: 'html 페이지로 만들어줘' } as ChatMessageRequest;

    it('아티팩트 의도면 generate_image 를 억제한다 (기존 동작 보존)', () => {
        const plan = buildExternalToolPlan({ ...base, req: artifactReq });
        expect(toolNames(plan)).not.toContain('generate_image');
    });

    it('스킬 required 바인딩이면 아티팩트 의도에도 generate_image 를 유지한다', () => {
        const plan = buildExternalToolPlan({
            ...base,
            req: artifactReq,
            skillRequiredToolNames: ['generate_image'],
        });
        expect(toolNames(plan)).toContain('generate_image');
        expect(toolNames(plan)).toContain('open-design::create_artifact');
    });

    it('스킬 required 바인딩이면 지도 의도에도 generate_image 를 유지한다', () => {
        const plan = buildExternalToolPlan({
            ...base,
            req: { message: '근처 카페 지도 보여줘' } as ChatMessageRequest,
            wantsMap: true,
            skillRequiredToolNames: ['generate_image'],
        });
        expect(toolNames(plan)).toContain('generate_image');
    });

    it('required 목록에 없는 도구는 여전히 억제된다 (면제 스코프 한정)', () => {
        const plan = buildExternalToolPlan({
            ...base,
            req: artifactReq,
            skillRequiredToolNames: ['open-design::create_artifact'],
        });
        expect(toolNames(plan)).not.toContain('generate_image');
    });
});
