/**
 * 장문 컨텍스트 평가 픽스처 (F26.5) — 시드 고정 생성기. 큰 텍스트 파일(최대 ~57만 자)을 레포에 두지 않고
 * 실행 때마다 같은 바이트를 만든다. 필요한 사실(needle)을 문서의 25·50·75·100% 지점에 심는다.
 *
 * 크기는 채움말의 실측 문자/토큰 비로 맞춘다(2026-09-17 qwen3.8-27b vLLM /tokenize: 5.84~5.88자/토큰).
 * 채움말 문장·어휘를 바꾸면 비율이 달라지니 다시 잴 것.
 *
 * @module evaluation/long-context-fixtures
 */

export interface LongContextNeedle {
    /** 문서 내 상대 위치(0~1) */
    position: number;
    /** 심는 문장 */
    sentence: string;
}

export interface LongContextFixtureDef {
    id: string;
    approxTokens: number;
    seed: number;
    needles: LongContextNeedle[];
}

/** 채움말 문자/토큰 실측 비(qwen3.8-27b 토크나이저) */
export const FIXTURE_CHARS_PER_TOKEN = 5.85;

export const LONG_CONTEXT_FIXTURES: Readonly<Record<string, LongContextFixtureDef>> = {
    'long-8k': {
        id: 'long-8k', approxTokens: 8_000, seed: 8101,
        needles: [
            { position: 0.25, sentence: 'NOTICE: The storage locker access code for the Busan branch is KX-4827-Q.' },
            { position: 1, sentence: 'NOTICE: The quarterly audit was signed off by inspector Halvorsen-Mbeki.' },
        ],
    },
    'long-32k': {
        id: 'long-32k', approxTokens: 32_000, seed: 32203,
        needles: [
            { position: 0.25, sentence: 'NOTICE: The backup generator model installed in hall 3 is the TORVIK-990.' },
            { position: 0.5, sentence: 'NOTICE: The emergency contact extension for the night shift is 7316.' },
            { position: 0.75, sentence: 'NOTICE: The project codename approved by the board is AMBER-LANTERN.' },
            { position: 1, sentence: 'NOTICE: The final shipment left the warehouse on pallet number P-60914.' },
        ],
    },
    // ⚠️ 142k 토큰(시스템 프롬프트 포함 ~148k)은 2026-09-17 실행에서 운영 vLLM EngineCore 를 죽였다(앱 fast-fail 120초 abort 후
    // `CUDA error: operation not permitted` → 컨테이너 재시작). nightly 가 운영 vLLM 을 쓰므로 실측 통과한 ~96k 로 상한을 둔다.
    'long-96k': {
        id: 'long-96k', approxTokens: 96_000, seed: 142307,
        needles: [
            { position: 0.25, sentence: 'NOTICE: The research vessel was renamed from Aurora to the QUILLFEATHER.' },
            { position: 0.5, sentence: 'NOTICE: The calibration constant recorded for sensor bank C is 0.7291.' },
            { position: 0.75, sentence: 'NOTICE: The keynote speaker for the closing session is Dr. Ottoline Brassard.' },
            { position: 1, sentence: 'NOTICE: The vault combination was changed to 58-13-92 at the end of the year.' },
        ],
    },
};

/** 결정적 PRNG(mulberry32) */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const SUBJECTS = ['The committee', 'Each regional office', 'The maintenance crew', 'Our logistics team', 'The review board', 'A visiting consultant', 'The finance group', 'The field engineers'];
const VERBS = ['reviewed', 'documented', 'discussed', 'postponed', 'summarized', 'revisited', 'approved', 'measured'];
const OBJECTS = ['the routine inspection schedule', 'the weekly supply report', 'several minor process updates', 'the draft of the training manual', 'the seasonal staffing plan', 'the parking allocation memo', 'the updated cleaning rota', 'the list of pending purchase orders'];
const TAILS = ['without notable changes.', 'and agreed to revisit it later.', 'as part of the standard cycle.', 'with no further action required.', 'following the usual procedure.', 'before the end of the afternoon.'];

function fillerSentence(rand: () => number): string {
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    return `${pick(SUBJECTS)} ${pick(VERBS)} ${pick(OBJECTS)} ${pick(TAILS)}`;
}

/** 픽스처 텍스트 생성 — 같은 id 는 항상 같은 문자열. 모르는 id 는 예외. */
export function buildLongContextFixture(id: string): string {
    const def = LONG_CONTEXT_FIXTURES[id];
    if (!def) throw new Error(`알 수 없는 contextFixture: ${id}`);
    const targetChars = Math.round(def.approxTokens * FIXTURE_CHARS_PER_TOKEN);
    const rand = mulberry32(def.seed);
    const needles = [...def.needles].sort((a, b) => a.position - b.position);
    const paragraphs: string[] = [];
    let chars = 0;
    let next = 0;
    let section = 1;
    while (chars < targetChars) {
        const sentences: string[] = [];
        for (let i = 0; i < 6; i++) sentences.push(fillerSentence(rand));
        // 위치를 지난 needle 을 이 문단 가운데에 심는다(100% 는 마지막 문단 뒤에서 처리)
        while (next < needles.length && needles[next].position < 1 && chars / targetChars >= needles[next].position) {
            sentences.splice(3, 0, needles[next].sentence);
            next++;
        }
        const p = `Section ${section}. ${sentences.join(' ')}`;
        paragraphs.push(p);
        chars += p.length + 2;
        section++;
    }
    for (; next < needles.length; next++) {
        paragraphs.push(`Section ${section++}. ${fillerSentence(rand)} ${needles[next].sentence} ${fillerSentence(rand)}`);
    }
    return paragraphs.join('\n\n');
}
