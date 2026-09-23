/**
 * image-runtime 부팅 진입점 — 매니페스트 `entry.runtime` (Base·Add-on 통합 P04, 2026-09-23).
 * 호스트가 준 문맥으로만 게시한다(소유자·선언 대조는 호스트가 한다). 네트워크 권한은 없다 — 호출은 승인된 포트뿐.
 *
 * @module addons/image-runtime/boot
 */
import type { AddonRuntimeHost } from '../../addon-host';
import { IMAGE_EDIT_DEFINITION, IMAGE_GENERATE_DEFINITION } from './definition';
import { imageEditHandler, imageGenerateHandler } from './generate';

export async function startImageRuntime(host: AddonRuntimeHost): Promise<void> {
    host.registerCapabilities([
        { definition: IMAGE_GENERATE_DEFINITION, handler: imageGenerateHandler },
        { definition: IMAGE_EDIT_DEFINITION, handler: imageEditHandler },
    ]);
}
