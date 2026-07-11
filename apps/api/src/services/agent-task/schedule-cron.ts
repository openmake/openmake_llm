/**
 * Agent Task 스케줄 시각 계산 (Phase 3-A) — 순수 함수(유닛테스트 대상).
 *
 * cron 라이브러리 의존 없이 표준 5-field cron(분 시 일 월 요일) 서브셋 + interval 을 지원한다.
 * 다음 실행 시각을 fromMs 기준 분 단위 전진 탐색으로 구한다(최대 366일). 서버 로컬 타임존 기준.
 *
 * cron 필드 지원: `*` · `*​/n` · `a-b` · `a-b/n` · `a,b,c` · 단일값. 요일 0-6(0=일), 7=일 허용.
 * dom·dow 가 둘 다 제한(비-*)이면 표준 Vixie cron 대로 OR 매칭.
 *
 * @module services/agent-task/schedule-cron
 */

export interface ScheduleTiming {
    /** 5-field cron 문자열 (분 시 일 월 요일). interval 과 배타. */
    cron?: string | null;
    /** 반복 간격(초). cron 과 배타. */
    intervalSeconds?: number | null;
}

/** 366일치 분 — 유효 cron 은 이 안에서 반드시 매칭. 초과 시 무효(null)로 간주. */
const SEARCH_CAP_MINUTES = 366 * 24 * 60;

/** 단일 cron 필드를 허용값 Set 으로 파싱. 실패 시 null(=무효 표현식). */
function parseField(spec: string, min: number, max: number): Set<number> | null {
    const out = new Set<number>();
    for (const part of spec.split(',')) {
        const m = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/);
        if (!m) return null;
        const [, startRaw, endRaw, stepRaw] = m;
        const step = stepRaw ? parseInt(stepRaw, 10) : 1;
        if (step <= 0) return null;
        let lo: number;
        let hi: number;
        if (startRaw === '*') {
            lo = min; hi = max;
        } else {
            lo = parseInt(startRaw, 10);
            hi = endRaw !== undefined ? parseInt(endRaw, 10) : (stepRaw ? max : lo);
        }
        if (lo < min || hi > max || lo > hi) return null;
        for (let v = lo; v <= hi; v += step) out.add(v);
    }
    return out.size > 0 ? out : null;
}

interface ParsedCron {
    minute: Set<number>;
    hour: Set<number>;
    dom: Set<number>;
    month: Set<number>;
    dow: Set<number>;
    domRestricted: boolean;
    dowRestricted: boolean;
}

/** cron 문자열 파싱 — 실패 시 null. */
export function parseCron(expr: string): ParsedCron | null {
    const fields = expr.trim().split(/\s+/);
    if (fields.length !== 5) return null;
    const minute = parseField(fields[0], 0, 59);
    const hour = parseField(fields[1], 0, 23);
    const dom = parseField(fields[2], 1, 31);
    const month = parseField(fields[3], 1, 12);
    const dowRaw = parseField(fields[4], 0, 7);
    if (!minute || !hour || !dom || !month || !dowRaw) return null;
    // 7 → 0(일요일) 정규화.
    const dow = new Set([...dowRaw].map((d) => (d === 7 ? 0 : d)));
    return {
        minute, hour, dom, month, dow,
        domRestricted: fields[2] !== '*',
        dowRestricted: fields[4] !== '*',
    };
}

/** 특정 시각(Date)이 파싱된 cron 과 매칭되는지. */
function matches(p: ParsedCron, d: Date): boolean {
    if (!p.minute.has(d.getMinutes())) return false;
    if (!p.hour.has(d.getHours())) return false;
    if (!p.month.has(d.getMonth() + 1)) return false;
    const domOk = p.dom.has(d.getDate());
    const dowOk = p.dow.has(d.getDay());
    // dom·dow 둘 다 제한 시 OR, 하나만 제한 시 그 쪽만, 둘 다 * 면 통과.
    if (p.domRestricted && p.dowRestricted) return domOk || dowOk;
    if (p.domRestricted) return domOk;
    if (p.dowRestricted) return dowOk;
    return true;
}

/**
 * 다음 실행 시각(ms). interval 이면 fromMs+interval, cron 이면 전진 탐색.
 * 무효(둘 다 없음/파싱실패/366일 내 매칭 없음)면 null.
 */
export function computeNextRun(timing: ScheduleTiming, fromMs: number): number | null {
    if (timing.intervalSeconds && timing.intervalSeconds > 0) {
        return fromMs + timing.intervalSeconds * 1000;
    }
    if (!timing.cron) return null;
    const parsed = parseCron(timing.cron);
    if (!parsed) return null;

    // 다음 분 경계부터 탐색(초·밀리초 절삭).
    const d = new Date(fromMs);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + 1);
    for (let i = 0; i < SEARCH_CAP_MINUTES; i++) {
        if (matches(parsed, d)) return d.getTime();
        d.setMinutes(d.getMinutes() + 1);
    }
    return null;
}
