/**
 * config/external-providers — 설정 화면 "이런 AI를 연결합니다" 스트립이 쓰는 공급자 메타
 * (homepage · keyUrl · logo). 로고 파일은 apps/web/public 에 있어야 하고(없으면 화면에 깨진
 * 이미지), 링크는 https 여야 한다. OAuth 전용 공급자는 앱 안의 디바이스 플로우가 인증 경로라
 * keyUrl 을 두지 않는다(homepage 폴백).
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { EXTERNAL_PROVIDER_CATALOG } from '../config/external-providers';

const WEB_PUBLIC = resolve(__dirname, '../../../web/public');

describe('EXTERNAL_PROVIDER_CATALOG 연결 메타', () => {
    test('모든 공급자에 https homepage 와 apps/web/public 에 실재하는 로고가 있다', () => {
        for (const e of EXTERNAL_PROVIDER_CATALOG) {
            expect(e.homepage).toMatch(/^https:\/\//);
            expect(e.logo).toMatch(/^\/images\/providers\/[a-z0-9-]+\.svg$/);
            expect(existsSync(resolve(WEB_PUBLIC, `.${e.logo}`))).toBe(true);
        }
    });

    test('keyUrl 은 https 이고, OAuth 전용 공급자는 keyUrl 없이 homepage 로 폴백한다', () => {
        for (const e of EXTERNAL_PROVIDER_CATALOG) {
            const oauthOnly = e.authMethods.includes('oauth') && !e.authMethods.includes('api_key');
            if (oauthOnly) expect(e.keyUrl).toBeUndefined();
            else expect(e.keyUrl).toMatch(/^https:\/\//);
        }
    });
});
