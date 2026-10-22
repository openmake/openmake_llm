/**
 * W3 secure/stable-by-default — 안전장치 기본값을 운영(`NODE_ENV=production`)에서만 ON 으로 둔다.
 *
 * 명시한 `'true'`/`'false'`(대소문자·공백 무시)는 언제나 우선하고, 그 밖(미설정·빈 문자열·다른 값)은
 * 운영이면 prodDefault, 개발·테스트면 devDefault 를 따른다. NODE_ENV 는 호출 시점에 읽는다.
 *
 * @module config/secure-defaults
 */

/** 운영 환경 여부 — `NODE_ENV === 'production'`. */
export function isProductionEnv(): boolean {
    return process.env.NODE_ENV === 'production';
}

/** env 불리언 — 명시 true/false 우선, 아니면 운영은 prodDefault·그 밖은 devDefault. */
export function boolEnvDefault(raw: string | undefined, prodDefault: boolean, devDefault = false): boolean {
    const value = raw?.trim().toLowerCase();
    if (value === 'true') return true;
    if (value === 'false') return false;
    return isProductionEnv() ? prodDefault : devDefault;
}
