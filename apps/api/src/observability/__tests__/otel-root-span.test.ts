/**
 * withSpan 의 root 옵션(#1478) — 진짜 tracer provider(메모리 exporter)로 본다.
 * root 를 주면 활성 부모(예: 작업을 시작한 HTTP 요청)가 있어도 ROOT_CONTEXT 에서 새 trace 를 시작하고,
 * 그 안의 span·로그 trace id 는 새 span 을 따른다. root 없는 보통 span 은 종전대로 활성 부모 아래에 붙는다.
 */
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { getCurrentTraceId, withSpan } from '../otel';

const exporter = new InMemorySpanExporter();
const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });

// sdk-trace 3.x 에는 NodeTracerProvider.register() 가 없다 — 부모·자식 연결에 필요한 컨텍스트 매니저를 직접 등록한다.
beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    trace.setGlobalTracerProvider(provider);
});
afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
});

it('root 옵션 span 은 활성 부모와 다른 trace 의 루트이고, 안쪽 span 은 그 아래, 보통 span 은 부모 아래에 붙는다', async () => {
    let traceInRun: string | undefined;
    await trace.getTracer('test').startActiveSpan('http.request', async (parent) => {
        await withSpan('agent-task', 'agent_task.run', async () => {
            await withSpan('agent-task', 'agent_task.turn', async () => undefined);
            traceInRun = getCurrentTraceId();
        }, { root: true, attributes: { 'agent_task.id': 't1' } });
        await withSpan('test', 'normal.child', async () => undefined);
        parent.end();
    });
    const byName = Object.fromEntries(exporter.getFinishedSpans().map((s) => [s.name, s]));
    const [parent, run, turn, child] = ['http.request', 'agent_task.run', 'agent_task.turn', 'normal.child'].map((n) => byName[n]);
    expect(run.parentSpanContext).toBeUndefined();
    expect(run.spanContext().traceId).not.toBe(parent.spanContext().traceId);
    expect(run.attributes['agent_task.id']).toBe('t1');
    expect(turn.parentSpanContext?.spanId).toBe(run.spanContext().spanId);
    expect(turn.spanContext().traceId).toBe(run.spanContext().traceId);
    expect(traceInRun).toBe(run.spanContext().traceId);
    expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
    expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
});
