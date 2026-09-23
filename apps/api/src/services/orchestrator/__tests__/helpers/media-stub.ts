/**
 * 테스트 전용 — add-on 으로 옮긴 미디어 capability(image.generate·image.edit·music.generate)를 Base 소유로 Registry 에 세운다.
 * P04·P06 부터 이 ID 들은 image-runtime·music-runtime 소유라 Base bridge 에 없다. Base 테스트는 add-on 모듈을 import 하지 않으므로
 * (eslint no-restricted-imports) 종전 Base 실행기(`executors/{image,music}.ts`, P10 에서 삭제 예정)를 스텁으로 등록해 종전 기대값을 유지한다.
 * music 의 로컬 전용 제약은 add-on 과 같은 `describeProviderSupport` 로 선언한다(배정 검증 경로가 Registry 를 읽는다).
 */
import { getCapabilityRegistry, resetCapabilityRuntimeForTest } from '../../../../runtime-ports/capability-runtime';
import { ensureLegacyCapabilityBridge, legacyCapabilityDefinition, resetLegacyCapabilityBridgeForTest } from '../../../../addon-host/legacy-capability-bridge';
import { BASE_CAPABILITY_OWNER } from '../../../../capability-contract/types';
import { imageEditExecutor, imageGenerateExecutor } from '../../executors/image';
import { musicGenerateExecutor } from '../../executors/music';
import type { ExecContext } from '../../types';

export function registerMediaStubForTest(): void {
    resetCapabilityRuntimeForTest(); resetLegacyCapabilityBridgeForTest(); ensureLegacyCapabilityBridge();
    const tx = getCapabilityRegistry().beginRegistration(BASE_CAPABILITY_OWNER);
    tx.register(legacyCapabilityDefinition('image.generate'), { execute: (t, c) => imageGenerateExecutor(t, c as unknown as ExecContext) });
    tx.register(legacyCapabilityDefinition('image.edit'), { execute: (t, c) => imageEditExecutor(t, c as unknown as ExecContext) });
    tx.register(legacyCapabilityDefinition('music.generate'), {
        execute: (t, c) => musicGenerateExecutor(t, c as unknown as ExecContext),
        describeProviderSupport: (m) => (m.isExternal
            ? { supported: false, reason: `음악 생성은 로컬 음악 서버(ACE-Step)만 지원합니다 — '${m.fullId}' 는 배정할 수 없습니다` }
            : { supported: true }),
    });
    tx.commit();
}
