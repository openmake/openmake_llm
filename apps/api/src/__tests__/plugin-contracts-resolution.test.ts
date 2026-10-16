/**
 * 계약 패키지 해석 — Jest 는 moduleNameMapper 로 소스(src/index.ts)를, tsc 는 tsconfig paths 로 dist/index.d.ts 를 본다.
 * dist 가 없어도(패키지 빌드 전) Jest 는 돌아야 하고, 워크스페이스 링크가 없어도(배포 서버) tsc 는 타입을 찾아야 한다.
 * (테스트 파일은 값 import 가 허용된다 — apps/api 소스는 type-only 만)
 */
import { PLUGIN_CONTRACT_VERSION, type PluginContractVersion } from '@openmake/plugin-contracts';

describe('@openmake/plugin-contracts 해석', () => {
    it('계약 버전 상수를 읽는다', () => {
        const version: PluginContractVersion = PLUGIN_CONTRACT_VERSION;
        expect(version).toBe('1.0.0');
    });
});
