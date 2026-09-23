/**
 * 테스트 전용 — image.generate·image.edit 을 Base 소유로 Registry 에 세운다.
 * P04 부터 두 ID 는 image-runtime add-on 소유라 Base bridge 에 없다. Base 테스트는 add-on 모듈을 import 하지 않으므로
 * (eslint no-restricted-imports) 종전 Base 실행기(`executors/image.ts`, P10 에서 삭제 예정)를 스텁으로 등록해 종전 기대값을 유지한다.
 */
import { getCapabilityRegistry, resetCapabilityRuntimeForTest } from '../../../../runtime-ports/capability-runtime';
import { ensureLegacyCapabilityBridge, legacyCapabilityDefinition, resetLegacyCapabilityBridgeForTest } from '../../../../addon-host/legacy-capability-bridge';
import { BASE_CAPABILITY_OWNER } from '../../../../capability-contract/types';
import { imageEditExecutor, imageGenerateExecutor } from '../../executors/image';
import type { ExecContext } from '../../types';

export function registerImageStubForTest(): void {
    resetCapabilityRuntimeForTest(); resetLegacyCapabilityBridgeForTest(); ensureLegacyCapabilityBridge();
    const tx = getCapabilityRegistry().beginRegistration(BASE_CAPABILITY_OWNER);
    tx.register(legacyCapabilityDefinition('image.generate'), { execute: (t, c) => imageGenerateExecutor(t, c as unknown as ExecContext) });
    tx.register(legacyCapabilityDefinition('image.edit'), { execute: (t, c) => imageEditExecutor(t, c as unknown as ExecContext) });
    tx.commit();
}
