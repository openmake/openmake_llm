/**
 * 짝지은 비교 (RSI-A) — PURE, 무-LLM, 결정적.
 *
 * 두 셀(또는 조건)의 케이스별 통과 비율(caseId → 0~1)을 같은 케이스끼리 짝지어 차이(후보 − 기준)를 내고,
 * 케이스를 복원 추출하는 부트스트랩으로 평균 차의 95% 구간을 구한다. 구간이 0 을 포함하면 `no-change` —
 * 30건 중 1건 차이(3%p)처럼 잡음 안의 변화를 회귀·향상으로 읽지 않기 위해서다. 시드가 고정이라 같은 입력은 같은 구간이다.
 *
 * @module evaluation/paired-comparison
 */

/** 부트스트랩 반복 수 기본값 — env `OMK_EVAL_BOOTSTRAP_ITERS` 로 덮는다 */
const BOOTSTRAP_ITERS_DEFAULT = 2000;
/** 고정 시드 — 같은 입력이면 같은 구간 */
const BOOTSTRAP_SEED_DEFAULT = 20261104;
/** 양쪽 꼬리 확률 — 95% 구간 */
const CI_TAIL = 0.025;

export type PairedVerdict = 'improved' | 'regressed' | 'no-change';

export interface PairedComparison {
    /** 짝지은(공통) 케이스 수 */
    cases: number;
    /** 케이스별 (후보 − 기준) 통과 비율 차이의 평균 (−1~1) */
    meanDiff: number;
    /** 평균 차의 부트스트랩 95% 구간 [하한, 상한] */
    ci: [number, number];
    verdict: PairedVerdict;
    /** 한쪽에만 있어 비교에서 뺀 케이스 id (정렬) */
    excluded: string[];
    /** 케이스 집합 불일치 등 사유 */
    note?: string;
}

export function bootstrapIterations(): number {
    const v = Number(process.env.OMK_EVAL_BOOTSTRAP_ITERS);
    return process.env.OMK_EVAL_BOOTSTRAP_ITERS && Number.isInteger(v) && v > 0 ? v : BOOTSTRAP_ITERS_DEFAULT;
}

/** mulberry32 — 시드 고정 의사 난수 [0,1) */
function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

export function comparePaired(
    baseline: Readonly<Record<string, number>>,
    candidate: Readonly<Record<string, number>>,
    opts: { iterations?: number; seed?: number } = {},
): PairedComparison {
    if (opts.iterations !== undefined && opts.iterations < 1) throw new Error(`iterations 는 1 이상이어야 합니다: ${opts.iterations}`);
    const shared = Object.keys(baseline).filter((id) => id in candidate).sort();
    const excluded = [...Object.keys(baseline).filter((id) => !(id in candidate)), ...Object.keys(candidate).filter((id) => !(id in baseline))].sort();
    if (shared.length === 0) return { cases: 0, meanDiff: 0, ci: [0, 0], verdict: 'no-change', excluded, note: '공통 케이스가 없어 비교할 수 없습니다' };
    const note = excluded.length ? `케이스 불일치 — 교집합 ${shared.length}건만 비교 (제외 ${excluded.length}건: ${excluded.join(', ')})` : undefined;

    const diffs = shared.map((id) => candidate[id] - baseline[id]);
    const iterations = opts.iterations ?? bootstrapIterations();
    const rand = seededRandom(opts.seed ?? BOOTSTRAP_SEED_DEFAULT);
    const means: number[] = [];
    for (let i = 0; i < iterations; i++) {
        let sum = 0;
        for (let j = 0; j < diffs.length; j++) sum += diffs[Math.floor(rand() * diffs.length)];
        means.push(sum / diffs.length);
    }
    means.sort((a, b) => a - b);
    const lo = means[Math.floor(CI_TAIL * iterations)];
    const hi = means[Math.max(0, Math.ceil((1 - CI_TAIL) * iterations) - 1)];
    const verdict: PairedVerdict = lo > 0 ? 'improved' : hi < 0 ? 'regressed' : 'no-change';
    return { cases: shared.length, meanDiff: mean(diffs), ci: [lo, hi], verdict, excluded, ...(note ? { note } : {}) };
}

/** 표시용 — `-3.3%p [95% -8.0, +1.2]` */
export function formatPaired(p: Pick<PairedComparison, 'meanDiff' | 'ci'>): string {
    const pp = (x: number): string => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;
    return `${pp(p.meanDiff)}%p [95% ${pp(p.ci[0])}, ${pp(p.ci[1])}]`;
}
