/**
 * @module boot/ensure-secrets
 * @description 부팅 시크릿 자동 생성 — 패키지 배포 첫 부팅 지원.
 *
 * JWT_SECRET / API_KEY_PEPPER / TOKEN_ENCRYPTION_KEY 가 없으면 64-hex 로 생성해
 * `.env` 에 영속하고 process.env 에 주입한다 (openssl rand -hex 32 동등).
 *
 * ⚠️ 호출 시점 제약: auth/auth-core 가 모듈 로드 시 JWT_SECRET 을 읽고,
 * utils/token-crypto 가 process.env.TOKEN_ENCRYPTION_KEY 를 직접 읽으므로
 * server.ts 에서 dotenv.config() 직후·다른 앱 import 이전에 호출해야 한다.
 * 같은 이유로 이 모듈은 fs/path/crypto 외 어떤 앱 모듈도 import 하지 않는다.
 *
 * 영속 실패 시 fail-fast — 임시 시크릿으로 부팅하면 재시작마다 전 세션(JWT)·
 * 암호문(외부 키/토큰)이 무효화되는 조용한 재해라, 명시적 부팅 중단이 옳다.
 *
 * @see docs/superpowers/plans/2026-08-12-first-run-setup.md §A
 */
import * as fs from 'fs';
import * as crypto from 'crypto';

const BOOT_SECRET_KEYS = ['JWT_SECRET', 'API_KEY_PEPPER', 'TOKEN_ENCRYPTION_KEY'] as const;

/**
 * 부재 시크릿을 생성해 envPath 에 영속하고 process.env 에 주입합니다.
 * 3키가 모두 이미 있으면 no-op (기존 배포 무영향).
 *
 * @param envPath - `.env` 절대 경로 (server.ts dotenv 와 동일 경로를 넘길 것)
 * @returns 생성한 키 이름 목록 (없으면 빈 배열)
 * @throws 영속 실패(쓰기 불가·재검증 불일치) 시 — 부팅을 중단해야 하는 오류
 */
export function ensureBootSecrets(envPath: string): string[] {
    const missing = BOOT_SECRET_KEYS.filter((key) => !process.env[key]?.trim());
    if (missing.length === 0) return [];

    const generated = new Map<string, string>();
    for (const key of missing) {
        generated.set(key, crypto.randomBytes(32).toString('hex'));
    }

    const banner =
        `\n# ── 첫 부팅 자동 생성 시크릿 (${new Date().toISOString()}) ──\n` +
        `# 이 값을 분실하면 전 세션과 암호화 저장 데이터가 무효화됩니다. 안전하게 백업하세요.\n`;
    const block = banner + [...generated.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n';

    try {
        if (fs.existsSync(envPath)) {
            fs.appendFileSync(envPath, block, 'utf-8');
        } else {
            fs.writeFileSync(envPath, block, { encoding: 'utf-8', mode: 0o600 });
        }
    } catch (err) {
        throw new Error(
            `[EnsureSecrets] 시크릿을 ${envPath} 에 영속하지 못했습니다: ${err instanceof Error ? err.message : String(err)}. ` +
            '임시 시크릿으로 부팅하면 재시작마다 세션·암호문이 무효화되므로 부팅을 중단합니다. ' +
            '파일 쓰기 권한을 확인하거나 시크릿을 수동 설정하세요 (openssl rand -hex 32).',
        );
    }

    // 영속 재검증 — append 가 성공했다고 보고해도 실제 내용으로 확인한다
    const persisted = fs.readFileSync(envPath, 'utf-8');
    for (const [key, value] of generated) {
        if (!persisted.includes(`${key}=${value}`)) {
            throw new Error(`[EnsureSecrets] ${key} 영속 재검증 실패 (${envPath}) — 부팅을 중단합니다.`);
        }
    }

    for (const [key, value] of generated) {
        process.env[key] = value;
    }
    // logger 는 앱 모듈이라 여기서 못 쓴다 (호출 시점 제약) — console 로 남긴다
    console.log(`[EnsureSecrets] 시크릿 자동 생성·영속 완료: ${missing.join(', ')} → ${envPath}`);
    return [...missing];
}
