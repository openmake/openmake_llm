/**
 * 민감 파일 경로 판정 (2026-09-06) — PURE.
 *
 * `SENSITIVE_FILE_PATTERNS`(config) 를 파일명 글롭으로 매칭한다. 소비처는 둘:
 *  ① 승인 게이트 — high-risk 정책에서 이 경로에 **쓰는** 호출을 승인 대상으로 올린다.
 *  ② 코드 탐색 셸 폴백 — 같은 목록을 rg/grep/find 인자로 넘긴다(디바이스 네이티브 경로는
 *     local-bridge-core 가 자체 목록으로 강제 — 양쪽 목록을 같게 유지할 것).
 *
 * ⚠️ 이것은 봉쇄가 아니다. 경로를 지목한 읽기·셸은 그대로 가능하고 각자의 게이트가 따로 있다.
 * 여기서 막는 것은 "훑다가 딸려 들어옴"과 "확인 없이 덮어씀" 두 가지다.
 *
 * @module services/task-sandbox/sensitive-paths
 */
import { SENSITIVE_FILE_PATTERNS } from '../../config/runtime-limits';

/** 파일명 글롭 → 정규식. `*` 는 경로 구분자를 넘지 않는다(basename 매칭이라 실질 무관). */
function globToRegExp(glob: string): RegExp {
    let out = '';
    for (const c of glob) {
        if (c === '*') out += '[^/]*';
        else if (c === '?') out += '[^/]';
        else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${out}$`);
}

const RES = SENSITIVE_FILE_PATTERNS.map(globToRegExp);

/**
 * 경로가 자격증명 파일을 가리키는지 — 디렉토리 부분은 무시하고 파일명만 본다.
 * 빈 값·경로 아님은 false(보수적으로 "민감하지 않음" — 판정 불가를 차단 사유로 삼지 않는다).
 */
export function isSensitivePath(p: unknown): boolean {
    if (typeof p !== 'string') return false;
    const name = p.split(/[\\/]/).filter(Boolean).pop();
    if (!name) return false;
    return RES.some((re) => re.test(name));
}
