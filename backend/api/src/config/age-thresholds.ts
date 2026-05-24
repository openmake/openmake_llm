/**
 * ============================================================
 * Age Thresholds — GDPR Phase D (14세 미만 셀프 동의)
 * ============================================================
 *
 * Locale 별 디지털 동의 연령 임계값. 미달 시 법정대리인 동의 필수.
 *
 * 법적 근거:
 *   - 한국 (ko): 정보통신망법 §31 + 개인정보 보호법 §39-3 — 14세 미만
 *   - EU (de/fr/it/...): GDPR Article 8 — default 16세, member state 13세 lower 가능
 *     (본 구현은 보수적 16세 일괄 적용)
 *   - 기타 (default): US COPPA 13세 + 보수적 default
 *
 * @module config/age-thresholds
 */

/**
 * Locale → 디지털 동의 연령 임계값 (만 나이).
 * 명시되지 않은 locale 은 DEFAULT_AGE_THRESHOLD 사용.
 */
export const AGE_THRESHOLDS: Readonly<Record<string, number>> = Object.freeze({
    // 한국 (정통망법 §31, 개보법 §39-3)
    ko: 14,
    // EU 회원국 — GDPR Article 8 default 16 (member state 13세 lower 가능, 보수적으로 16)
    en: 16,  // 영어권 기본 — EU 사용자 가능성 + 미국 13 보다 보수적
    de: 16, fr: 16, it: 16, es: 16, nl: 16, pt: 16,
    sv: 16, da: 16, no: 16, fi: 16,
    pl: 16, cs: 16, hu: 16, ro: 16, bg: 16, sk: 16, sl: 16, hr: 16,
    // 명시 안 된 기타 locale → DEFAULT_AGE_THRESHOLD
});

/**
 * 명시되지 않은 locale 의 기본 임계값. US COPPA (13) 기준.
 */
export const DEFAULT_AGE_THRESHOLD = 13;

/**
 * locale 의 임계값 반환. 명시 안 된 locale 은 DEFAULT_AGE_THRESHOLD.
 * locale 은 BCP-47 (예: 'ko', 'ko-KR', 'en-US') — '-' 앞 prefix 만 사용.
 */
export function getAgeThreshold(locale: string | undefined | null): number {
    if (!locale) return DEFAULT_AGE_THRESHOLD;
    const prefix = locale.toLowerCase().split('-')[0];
    return AGE_THRESHOLDS[prefix] ?? DEFAULT_AGE_THRESHOLD;
}

/**
 * 만 나이 계산 (ISO YYYY-MM-DD birthDate vs NOW).
 * 생일 안 지났으면 -1 한 값 반환.
 */
export function calculateAge(birthDateIso: string, now: Date = new Date()): number {
    const birth = new Date(birthDateIso + 'T00:00:00Z');
    if (Number.isNaN(birth.getTime())) {
        throw new Error(`Invalid birthDate: ${birthDateIso}`);
    }
    let age = now.getUTCFullYear() - birth.getUTCFullYear();
    const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
    const dayDiff = now.getUTCDate() - birth.getUTCDate();
    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age--;
    return age;
}
