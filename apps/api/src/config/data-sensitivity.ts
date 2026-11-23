/**
 * 데이터 민감도 분류 (하네스 P0-2) — 요청 본문·첨부 텍스트에서 결정적 규칙으로 민감도 등급을 매긴다.
 *
 * 등급: normal < confidential < restricted.
 *   - restricted: 자격증명(키·토큰·개인키)·주민등록번호·카드번호처럼 밖으로 나가면 바로 피해가 나는 값.
 *   - confidential: 문서가 스스로 대외비라고 밝힌 표시(대외비·기밀·사내 한정·confidential·internal use only 등)·계좌 정보.
 *   - normal: 그 밖.
 * 판정은 정규식뿐이다 — 판정을 위해 모델을 부르지 않는다(A형 금지). 무엇에 걸렸는지는 패턴 이름만 남기고 값은 남기지 않는다.
 * 반출 정책(config/egress-policy)이 이 등급을 기준값과 비교한다.
 *
 * 패턴은 env 로 바꾼다 — DATA_SENSITIVITY_RESTRICTED_PATTERNS·DATA_SENSITIVITY_CONFIDENTIAL_PATTERNS
 * ('|||' 구분 정규식, 대소문자 무시, 기본값을 대체). 잘못된 정규식은 버리고 경고한다.
 *
 * @module config/data-sensitivity
 */
import { createLogger } from '../utils/logger';

const logger = createLogger('DataSensitivity');

export type DataSensitivity = 'normal' | 'confidential' | 'restricted';

export const DATA_SENSITIVITY_LEVELS: readonly DataSensitivity[] = ['normal', 'confidential', 'restricted'];

/** 이름 붙인 패턴 — 이름은 감사 기록·로그에 남는다(값은 남기지 않는다). */
interface NamedPattern { name: string; re: RegExp }

const DEFAULT_RESTRICTED: Readonly<Record<string, string>> = {
    private_key: '-----BEGIN [A-Z ]*PRIVATE KEY-----',
    api_key: '\\b(?:sk-[a-z0-9_-]{16,}|omk_live_[a-z0-9]{8,}|gh[pousr]_[a-z0-9]{20,}|xox[abpr]-[a-z0-9-]{10,}|AKIA[0-9A-Z]{16})\\b',
    bearer_token: 'bearer\\s+[a-z0-9._-]{20,}',
    resident_id: '\\b\\d{6}-[1-4]\\d{6}\\b',
    card_number: '\\b(?:\\d{4}[ -]){3}\\d{4}\\b',
};

const DEFAULT_CONFIDENTIAL: Readonly<Record<string, string>> = {
    marking_ko: '대외비|극비|기밀\\s*(?:문서|자료|정보|사항)|사내\\s*한정|외부\\s*유출\\s*금지|社外秘',
    marking_en: '\\b(?:confidential|internal use only|do not distribute|proprietary and confidential|strictly private)\\b',
    bank_account: '계좌번호|\\biban\\b',
};

function compile(envKey: string, defaults: Readonly<Record<string, string>>): NamedPattern[] {
    const raw = process.env[envKey];
    const entries: Array<[string, string]> = raw
        ? raw.split('|||').map((p, i) => [`${envKey.toLowerCase()}_${i}`, p.trim()] as [string, string]).filter(([, p]) => p.length > 0)
        : Object.entries(defaults);
    const out: NamedPattern[] = [];
    for (const [name, src] of entries) {
        try { out.push({ name, re: new RegExp(src, 'i') }); } catch (e) {
            logger.warn(`${envKey}: 잘못된 정규식이라 버림 — ${name}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    return out;
}

const RESTRICTED = compile('DATA_SENSITIVITY_RESTRICTED_PATTERNS', DEFAULT_RESTRICTED);
const CONFIDENTIAL = compile('DATA_SENSITIVITY_CONFIDENTIAL_PATTERNS', DEFAULT_CONFIDENTIAL);

/** 한 번에 검사하는 글자 수 상한 — 큰 첨부도 앞부분만 본다(정규식 비용 상한). DATA_SENSITIVITY_SCAN_MAX_CHARS(기본 200000). */
const SCAN_MAX_CHARS = Math.max(1000, parseInt(process.env.DATA_SENSITIVITY_SCAN_MAX_CHARS || '200000', 10) || 200000);

export interface SensitivityVerdict {
    level: DataSensitivity;
    /** 걸린 패턴 이름(값 아님) */
    matched: string[];
}

/** PURE(설정 읽기): 텍스트들의 민감도 — 가장 높은 등급과 걸린 패턴 이름. */
export function classifySensitivity(texts: ReadonlyArray<string | undefined | null>): SensitivityVerdict {
    let budget = SCAN_MAX_CHARS;
    const chunks: string[] = [];
    for (const t of texts) {
        if (!t || budget <= 0) continue;
        chunks.push(t.length > budget ? t.slice(0, budget) : t);
        budget -= t.length;
    }
    const text = chunks.join('\n');
    if (!text) return { level: 'normal', matched: [] };
    const restricted = RESTRICTED.filter((p) => p.re.test(text)).map((p) => p.name);
    if (restricted.length > 0) return { level: 'restricted', matched: restricted };
    const confidential = CONFIDENTIAL.filter((p) => p.re.test(text)).map((p) => p.name);
    if (confidential.length > 0) return { level: 'confidential', matched: confidential };
    return { level: 'normal', matched: [] };
}

/** PURE: a 가 b 이상인가. */
export function sensitivityAtLeast(a: DataSensitivity, b: DataSensitivity): boolean {
    return DATA_SENSITIVITY_LEVELS.indexOf(a) >= DATA_SENSITIVITY_LEVELS.indexOf(b);
}
