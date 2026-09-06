/**
 * ============================================================
 * 도구 이름 코덱 — provider 경계에서만 이름을 인코딩/복원
 * ============================================================
 *
 * 내부 도구 이름은 `server::tool` 네임스페이스(`MCP_NAMESPACE_SEPARATOR`)를 쓰고,
 * 역할 게이트·병렬 판정·헬스 서킷이 그 구분자를 전제로 한다. 반면 OpenAI 함수 이름
 * 규약(`^[a-zA-Z0-9_-]{1,64}$`)을 그대로 검증하는 provider 가 있어(Codex, NVIDIA NIM
 * 2026-09-04·06 실측 `Function at index 1 has an invalid name`) `::` 가 섞이면 요청
 * 전체가 400 으로 거절된다. 그래서 내부 표현은 유지하고, 요청 방향으로만 안전한 이름으로
 * 치환한 뒤 응답 tool call 을 원래 이름으로 되돌린다(dispatch 는 원래 이름으로 동작).
 *
 * 원래 `providers/chatgpt-oauth/responses-mapping.ts` 에 Codex 전용으로 있던 것을
 * openai-compat 경로와 공유하기 위해 provider 중립 모듈로 옮겼다 (2026-09-06).
 *
 * @module providers/tool-name-codec
 */

/** OpenAI 함수 이름 규약 — Codex·NVIDIA NIM 등이 그대로 검증한다. */
export const OPENAI_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
/** OpenAI 함수 이름 길이 상한 */
export const OPENAI_TOOL_NAME_MAX = 64;

/**
 * 도구 이름 정규화 코덱.
 *
 * MCP 서버가 등록하는 도구 이름에는 provider 가 거부하는 문자(공백·점·콜론 등)가
 * 섞일 수 있다. 요청 방향으로는 안전한 이름으로 치환하고, 응답의 tool call 은
 * 원래 이름으로 되돌려 도구 실행 계층(이름으로 dispatch)이 그대로 동작하게 한다.
 * 인스턴스는 요청 1회 단위로 만든다(등록 순서에 따라 충돌 suffix 가 달라질 수 있음).
 */
export class ToolNameCodec {
    private readonly toSanitized = new Map<string, string>();
    private readonly toOriginal = new Map<string, string>();

    /** 원래 이름 → 안전 이름 (멱등, 충돌 시 suffix 부여) */
    register(original: string): string {
        const existing = this.toSanitized.get(original);
        if (existing) return existing;

        let candidate = original
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .slice(0, OPENAI_TOOL_NAME_MAX);
        if (!candidate || !OPENAI_TOOL_NAME_PATTERN.test(candidate)) {
            candidate = `tool_${this.toSanitized.size}`;
        }
        // 서로 다른 원본이 같은 안전 이름으로 접히면 dispatch 가 깨진다 — suffix 로 분리
        let unique = candidate;
        let n = 1;
        while (this.toOriginal.has(unique) && this.toOriginal.get(unique) !== original) {
            const suffix = `_${n++}`;
            unique = `${candidate.slice(0, OPENAI_TOOL_NAME_MAX - suffix.length)}${suffix}`;
        }

        this.toSanitized.set(original, unique);
        this.toOriginal.set(unique, original);
        return unique;
    }

    /** 안전 이름 → 원래 이름 (미등록 이름은 그대로 통과) */
    restore(sanitized: string): string {
        return this.toOriginal.get(sanitized) ?? sanitized;
    }

    /** 정규화가 실제로 일어난 항목 (관측/로깅용) */
    renamed(): Array<{ from: string; to: string }> {
        return [...this.toSanitized.entries()]
            .filter(([from, to]) => from !== to)
            .map(([from, to]) => ({ from, to }));
    }
}
