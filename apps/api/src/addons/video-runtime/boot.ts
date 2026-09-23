/**
 * video-runtime 부팅 진입점 — 매니페스트 `entry.runtime` (P08). 호스트 문맥으로만 게시한다.
 * @module addons/video-runtime/boot
 */
import type { AddonRuntimeHost } from '../../addon-host';
import { VIDEO_GENERATE_DEFINITION } from './definition';
import { videoGenerateHandler } from './generate';

export async function startVideoRuntime(host: AddonRuntimeHost): Promise<void> {
    host.registerCapabilities([{ definition: VIDEO_GENERATE_DEFINITION, handler: videoGenerateHandler }]);
}
