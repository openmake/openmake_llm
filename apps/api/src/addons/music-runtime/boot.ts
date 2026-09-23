/**
 * music-runtime 부팅 진입점 — 매니페스트 `entry.runtime` (P06). 호스트 문맥으로만 게시한다.
 * @module addons/music-runtime/boot
 */
import type { AddonRuntimeHost } from '../../addon-host';
import { MUSIC_GENERATE_DEFINITION } from './definition';
import { musicGenerateHandler } from './generate';

export async function startMusicRuntime(host: AddonRuntimeHost): Promise<void> {
    host.registerCapabilities([{ definition: MUSIC_GENERATE_DEFINITION, handler: musicGenerateHandler }]);
}
