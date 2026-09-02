/**
 * 로컬 모델 자동 발견 — 게이트웨이 /model/info 선별 규칙 (순수 함수).
 * 샘플은 2026-09-02 운영 LiteLLM 응답 형태 그대로.
 */
import { selectLocalEntriesFromModelInfo, type GatewayModelInfoEntry } from './local-models-discovery';
import type { LocalModelEntry } from './local-models';

const QWEN_BASE = 'http://vllm-host:8002/v1';
const LIVE_SAMPLE: GatewayModelInfoEntry[] = [
    { model_name: 'qwen3.8-27b', litellm_params: { model: 'openai/qwen3.8-27b', api_base: QWEN_BASE }, model_info: {} },
    { model_name: 'qwen3.6-35b-a3b', litellm_params: { model: 'openai/qwen3.6-35b-a3b', api_base: QWEN_BASE }, model_info: {} },
    { model_name: 'bge-m3', litellm_params: { model: 'openai/bge-m3', api_base: 'http://vllm-host:8003/v1' }, model_info: {} },
    { model_name: 'gpt-3.5-turbo', litellm_params: { model: 'openai/qwen3.8-27b', api_base: QWEN_BASE }, model_info: {} },
    { model_name: 'flux2-klein', litellm_params: { model: 'openai/flux2-klein', api_base: 'http://vllm-host:8005/v1' }, model_info: { mode: 'image_generation' } },
    { model_name: 'openrouter/*', litellm_params: { model: 'openrouter/*' }, model_info: {} },
    { model_name: 'hasa/*', litellm_params: { model: 'openai/*', api_base: 'https://open.hasa.re.kr/v1' }, model_info: {} },
];

describe('selectLocalEntriesFromModelInfo', () => {
    it('provider prefix 항목·이미지 모델 제외, alias(gpt-3.5-turbo→qwen3.8-27b) 는 정식 이름 하나로 접는다', () => {
        const ids = selectLocalEntriesFromModelInfo(LIVE_SAMPLE).map((m) => `${m.id}:${m.role}`);
        expect(ids).toEqual(['qwen3.8-27b:chat', 'qwen3.6-35b-a3b:chat', 'bge-m3:embedding']);
    });

    it('vLLM 이 두 이름을 서빙해도 LiteLLM upstream 이 다르면 별개 항목 — 접는 기준은 upstream 동일성', () => {
        // qwen3.6-35b-a3b 는 upstream 이름도 다르므로(vLLM 측 alias) 게이트웨이 정보만으로는 합칠 수 없다.
        const out = selectLocalEntriesFromModelInfo(LIVE_SAMPLE);
        expect(out.find((m) => m.id === 'qwen3.6-35b-a3b')).toBeDefined();
        expect(out.find((m) => m.id === 'gpt-3.5-turbo')).toBeUndefined();
    });

    it('정식 이름이 없는 alias 그룹은 첫 항목을 대표로 쓴다', () => {
        const out = selectLocalEntriesFromModelInfo([
            { model_name: 'chat-default', litellm_params: { model: 'openai/some-upstream', api_base: QWEN_BASE } },
            { model_name: 'chat-alias', litellm_params: { model: 'openai/some-upstream', api_base: QWEN_BASE } },
        ]);
        expect(out.map((m) => m.id)).toEqual(['chat-default']);
    });

    it('mode 가 비어 있어도 id 패턴으로 임베딩/비채팅을 가른다', () => {
        const out = selectLocalEntriesFromModelInfo([
            { model_name: 'nomic-embed-text', litellm_params: { model: 'openai/nomic-embed-text', api_base: QWEN_BASE } },
            { model_name: 'whisper-large', litellm_params: { model: 'openai/whisper-large', api_base: QWEN_BASE } },
            { model_name: 'llama-x', litellm_params: { model: 'openai/llama-x', api_base: QWEN_BASE } },
        ]);
        expect(out.map((m) => `${m.id}:${m.role}`)).toEqual(['nomic-embed-text:embedding', 'llama-x:chat']);
    });

    it('이전 카탈로그의 프로브 실측치(가용성·능력·컨텍스트)를 같은 id 에 보존한다', () => {
        const prev: LocalModelEntry[] = [{
            id: 'qwen3.8-27b', displayName: 'qwen3.8-27b', description: 'd', role: 'chat',
            contextLength: 262144, contextLengthProbed: true, available: true,
            probedCapabilities: { toolCalling: true },
        }];
        const out = selectLocalEntriesFromModelInfo(LIVE_SAMPLE, prev);
        const q = out.find((m) => m.id === 'qwen3.8-27b')!;
        expect(q.contextLength).toBe(262144);
        expect(q.contextLengthProbed).toBe(true);
        expect(q.available).toBe(true);
        expect(q.probedCapabilities).toEqual({ toolCalling: true });
        expect(q.description).toBe('d');
    });

    it('빈 응답이면 빈 배열 (호출부가 카탈로그를 유지한다)', () => {
        expect(selectLocalEntriesFromModelInfo([])).toEqual([]);
    });
});
