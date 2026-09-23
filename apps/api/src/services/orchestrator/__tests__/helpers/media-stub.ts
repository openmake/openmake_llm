/**
 * 테스트 전용 — add-on 소유 미디어 capability(image.generate·image.edit·music.generate·video.generate)를 Base 스텁으로 Registry 에 세운다.
 * P04·P06·P08 부터 이 ID 들은 각 runtime add-on 소유라 Base bridge 에 없고, Base 테스트는 add-on 모듈을 import 하지 않는다
 * (eslint no-restricted-imports). 실행 결과는 각 add-on 테스트가 검증하고, 여기서는 Base 가 읽는 계약 필드만 흉내 낸다:
 * 로컬 전용 음악 제약·hasa 영상 직결(describeProviderSupport)과 영상 결과 조회 주제어(jobFollowupTopic).
 */
import { getCapabilityRegistry, resetCapabilityRuntimeForTest } from '../../../../runtime-ports/capability-runtime';
import { ensureLegacyCapabilityBridge, legacyCapabilityDefinition, resetLegacyCapabilityBridgeForTest } from '../../../../addon-host/legacy-capability-bridge';
import { BASE_CAPABILITY_OWNER, type CapabilityHandler } from '../../../../capability-contract/types';

const stubExecute: CapabilityHandler['execute'] = async (task) => ({ ok: true, text: `stub ${task.capability}`, media: [] });

export function registerMediaStubForTest(): void {
    resetCapabilityRuntimeForTest(); resetLegacyCapabilityBridgeForTest(); ensureLegacyCapabilityBridge();
    const tx = getCapabilityRegistry().beginRegistration(BASE_CAPABILITY_OWNER);
    tx.register(legacyCapabilityDefinition('image.generate'), { execute: stubExecute });
    tx.register(legacyCapabilityDefinition('image.edit'), { execute: stubExecute });
    tx.register(legacyCapabilityDefinition('music.generate'), {
        execute: stubExecute,
        describeProviderSupport: (m) => (m.isExternal
            ? { supported: false, reason: `음악 생성은 로컬 음악 서버(ACE-Step)만 지원합니다 — '${m.fullId}' 는 배정할 수 없습니다` }
            : { supported: true }),
    });
    tx.register(legacyCapabilityDefinition('video.generate'), {
        execute: stubExecute,
        jobFollowupTopic: /영상|비디오|동영상|\bvideo\b|\bclip\b/i,
        describeProviderSupport: (m) => (m.isExternal && m.providerId === 'hasa' ? { supported: true, direct: { endpoint: '/videos/generations' } } : { supported: true }),
    });
    tx.commit();
}
