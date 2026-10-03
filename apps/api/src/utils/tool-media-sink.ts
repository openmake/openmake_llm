/**
 * 도구 결과 미디어 저장처 — 실행 중인 도구 호출이 속한 작업 공간에 파일을 쓰는 통로를 호출 경로 아래
 * (외부 MCP 클라이언트)까지 인자 없이 전한다(utils/tool-call-context 와 같은 방식).
 *
 * 에이전트 작업의 도구 호출은 작업 공간이 있어, 외부 도구가 돌려준 이미지·오디오를 파일로 저장할 수 있다.
 * 문맥 밖(채팅 경로 등)에서는 저장처가 없다 — 그때는 호출부가 생략 안내만 적는다.
 *
 * @module utils/tool-media-sink
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface ToolMediaSink {
    /** 작업 공간 상대경로에 저장한다(경로 가드·쿼터는 저장처가 적용). 실패하면 throw. */
    save(relPath: string, data: Buffer): Promise<void>;
}

const storage = new AsyncLocalStorage<ToolMediaSink>();

/** sink 가 없으면 문맥을 열지 않고 그대로 실행한다. */
export function runWithToolMediaSink<T>(sink: ToolMediaSink | undefined, fn: () => T): T {
    return sink ? storage.run(sink, fn) : fn();
}

/** 지금 실행 중인 도구 호출의 미디어 저장처 — 문맥 밖이면 undefined. */
export function getToolMediaSink(): ToolMediaSink | undefined {
    return storage.getStore();
}

/**
 * 작업 런타임 → 저장처. 서버 쪽 작업 공간이 있을 때만 준다 — 로컬 실행 작업의 작업 공간은 사용자의 실제 폴더라
 * 도구 결과를 말없이 써 넣지 않는다.
 */
export function toolMediaSinkFor(
    runtime: { localWorkdir: string | null; writeWorkspaceFile(relPath: string, content: Buffer): Promise<void> } | null | undefined,
): ToolMediaSink | undefined {
    return runtime && runtime.localWorkdir !== null
        ? { save: (relPath, data) => runtime.writeWorkspaceFile(relPath, data) }
        : undefined;
}
