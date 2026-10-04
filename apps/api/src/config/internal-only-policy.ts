/**
 * 내부 전용 처리 정책 (Companion P1-5, 2026-10-04) — 로컬 실행 작업은 업무 자료를 OpenMake 밖으로 내보내지 않는다.
 *
 * 대상: 로컬 실행기(executor='local')로 도는 에이전트 작업 전부. 사용자 PC 의 파일·화면 내용이 모델과 도구로 흘러가므로,
 *   - 모델: 외부 제공자로 해석되면 쓰지 않고 내부 모델로 돌린다. 내부 모델을 쓸 수 없으면 작업이 실패한다(외부로 넘기지 않는다).
 *   - 도구: 호스트에서 도는 추가 도구(검색·외부 MCP 등)는 목록에서 뺀다 — 모델에게 보이지 않으므로 호출될 수 없다.
 *     작업 디렉토리 안에서 도는 작업 도구(파일·셸·계획)는 그대로다. 내부에서만 도는 추가 도구는 허용 목록으로 남긴다.
 * 판정은 설정뿐이다 — 판정을 위해 모델을 부르지 않는다(A형 금지).
 * 브라우저로 외부 사이트에 입력하는 것은 이 정책이 아니라 사이트 정책이 다룬다.
 *
 * 예외는 관리자 설정으로만: `LOCAL_EXECUTOR_INTERNAL_ONLY=false` 로 끈다. 기본 켜짐 — 로컬 실행 자체가
 * `LOCAL_EXECUTOR_ENABLED`(기본 꺼짐) 뒤에 있어 이 값만으로 동작이 바뀌지 않는다.
 *
 * @module config/internal-only-policy
 */
import { LOCAL_BRIDGE } from './local-bridge';

export const INTERNAL_ONLY = {
    /** 로컬 실행 작업에 내부 전용을 적용할지. LOCAL_EXECUTOR_INTERNAL_ONLY(기본 켜짐) */
    LOCAL_TASKS_ENABLED: process.env.LOCAL_EXECUTOR_INTERNAL_ONLY !== 'false',
    /**
     * 내부 전용에서도 남기는 추가(호스트 실행) 도구 — 외부로 나가지 않는 것만. LOCAL_EXECUTOR_INTERNAL_ONLY_TOOLS(쉼표 구분).
     * 기본은 스킬 불러오기(load_skill, 내부 스킬 저장소 조회)뿐이다.
     */
    ALLOWED_EXTRA_TOOLS: (process.env.LOCAL_EXECUTOR_INTERNAL_ONLY_TOOLS ?? 'load_skill').split(',').map((s) => s.trim()).filter(Boolean),
} as const;

/** PURE(설정 읽기): 이 실행이 내부 전용 대상인가. */
export function isInternalOnlyRun(input: { executor?: string }): boolean {
    return input.executor === 'local' && LOCAL_BRIDGE.ENABLED && INTERNAL_ONLY.LOCAL_TASKS_ENABLED;
}

/** PURE: 추가 도구 목록에서 내부 전용에 남길 것과 뺄 것을 나눈다. */
export function splitInternalOnlyTools<T extends { function: { name: string } }>(
    tools: readonly T[],
    allowed: readonly string[] = INTERNAL_ONLY.ALLOWED_EXTRA_TOOLS,
): { kept: T[]; removed: string[] } {
    const kept: T[] = [];
    const removed: string[] = [];
    for (const t of tools) {
        if (allowed.includes(t.function.name)) kept.push(t);
        else removed.push(t.function.name);
    }
    return { kept, removed };
}
