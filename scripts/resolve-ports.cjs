/**
 * 포트 해석 단일 출처(SSOT).
 *
 * 왜 필요한가 — PM2 와 Next 는 둘 다 "설정 파일을 평가하는 시점의 셸 환경"에서 포트를 읽는다.
 * 앱의 dotenv 로딩보다 앞서므로 .env 에 적어도 반영되지 않고, 기동/빌드 명령에 매번
 * `PORT=… OMK_WEB_PORT=…` 를 붙여야만 정상 동작했다. 그 주입을 한 번이라도 빠뜨리면:
 *   - PM2  : 웹이 기본 3000 으로 떨어져 다른 서비스와 EADDRINUSE 충돌
 *   - Next : NEXT_PUBLIC_* 가 기본값으로 번들에 인라인 → 채팅 WS 가 엉뚱한 포트로 붙어
 *            "서버와 연결이 끊겼습니다" 가 지속 (런타임 .env 로 보정 불가)
 * 이 모듈을 ecosystem.config.js 와 apps/web/next.config.ts 가 함께 써서, 호출자가
 * 환경변수 주입을 잊어도 .env 만으로 정답이 나오게 한다.
 *
 * 우선순위: 셸 환경변수 > 루트 .env > 기본값 (기존 규칙 유지).
 *
 * ⚠️ process.env 를 오염시키지 않는다 — .env 전체를 빌드/PM2 프로세스에 주입하면
 *    빌드 환경에 불필요한 비밀값이 노출되므로 parse 만 하고 필요한 키만 읽는다.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_PATH = path.resolve(__dirname, '..', '.env');

/** 루트 .env 를 파싱한다. 파일이 없거나 읽기 실패해도 기동을 막지 않는다(전부 기본값). */
function parseEnvFile() {
    try {
        return dotenv.parse(fs.readFileSync(ENV_PATH));
    } catch {
        return {};
    }
}

const fileEnv = parseEnvFile();

/** 셸 환경 > .env 순으로 첫 비어있지 않은 값. */
function pick(key) {
    return process.env[key] || fileEnv[key] || '';
}

/**
 * 웹 포트. install.sh 는 웹 포트를 .env 에 별도 키로 남기지 않고 OMK_APP_URL 에만 담으므로,
 * OMK_WEB_PORT 가 없으면 그 URL 끝 포트에서 역산한다 (install.sh 와 동일 규칙).
 */
function resolveWebPort() {
    const explicit = pick('OMK_WEB_PORT');
    if (explicit) return explicit;
    const fromUrl = /:(\d+)\/?$/.exec(pick('OMK_APP_URL'));
    return fromUrl ? fromUrl[1] : '3000';
}

/** 백엔드(Express + WS) 포트. */
const apiPort = pick('PORT') || '52416';
/** 프론트(Next) 포트. */
const webPort = resolveWebPort();

module.exports = { apiPort, webPort };
