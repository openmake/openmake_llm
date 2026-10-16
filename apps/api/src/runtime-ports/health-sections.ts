/**
 * `/api/health` 의 추가 절 — add-on 이 자기 상태 요약을 이름으로 등록하고, 헬스 라우트가 모아 최상위 키로 붙인다(2026-10-16, C4).
 * Base 는 절의 내용도 add-on 이름도 모른다. 절마다 시간 상한을 두고, 실패·초과는 그 절만 `{ error }` 로 바꾼다 —
 * 헬스 응답 자체를 늦추거나 깨지 않는다.
 *
 * @module runtime-ports/health-sections
 */
import { HEALTH_SECTION_TIMEOUT_MS } from '../config/runtime-limits';

export type HealthSectionReader = () => Promise<unknown>;

/** 헬스 응답의 기존 최상위 키 — 절 이름으로 쓰지 못한다 */
const RESERVED_NAMES: ReadonlySet<string> = new Set(['status', 'timestamp', 'uptime', 'services']);

const sections = new Map<string, HealthSectionReader>();

/** 절을 등록하고 해제 함수를 돌려준다. 같은 이름을 다시 등록하면 뒤의 것이 이긴다(앞의 해제 함수는 뒤의 것을 지우지 않는다) */
export function registerHealthSection(name: string, read: HealthSectionReader): () => void {
    if (RESERVED_NAMES.has(name)) throw new Error(`헬스 절 이름 '${name}' 은 예약돼 있다`);
    sections.set(name, read);
    return () => {
        if (sections.get(name) === read) sections.delete(name);
    };
}

function readWithin(read: HealthSectionReader, timeoutMs: number): Promise<unknown> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<unknown>((resolve) => {
        timer = setTimeout(() => resolve({ error: `timeout ${timeoutMs}ms` }), timeoutMs);
        timer.unref();
    });
    const value = Promise.resolve()
        .then(read)
        .catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
    return Promise.race([value, timeout]).finally(() => clearTimeout(timer));
}

/** 등록된 절을 모두 읽어 { 이름: 값 } 으로 — 절끼리는 병렬 */
export async function collectHealthSections(timeoutMs: number = HEALTH_SECTION_TIMEOUT_MS): Promise<Record<string, unknown>> {
    const entries = [...sections.entries()];
    const values = await Promise.all(entries.map(([, read]) => readWithin(read, timeoutMs)));
    return Object.fromEntries(entries.map(([name], i) => [name, values[i]]));
}

/** 테스트 전용 — 등록을 모두 지운다 */
export function resetHealthSectionsForTest(): void {
    sections.clear();
}
