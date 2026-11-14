/**
 * 스트림 조각(Buffer)을 이어 디코드하며 글자 수 상한까지만 모은다 — 자식 프로세스 stdout/stderr 수집 공용.
 *
 * 조각마다 따로 `toString('utf8')` 하면 경계에 걸린 다바이트 글자가 U+FFFD 로 깨진다 — StringDecoder 로 이어 디코드한다.
 * 상한은 디코드된 문자열 길이(UTF-16 단위). 한 번 넘으면 더 붙이지 않고(가운데가 빠진 출력 금지),
 * 대리 쌍 한가운데에서 자르지 않는다. 스트림이 끝나면 `end()` 로 디코더에 남은 바이트를 붙인다.
 *
 * @module utils/capped-utf8-text
 */
import { StringDecoder } from 'string_decoder';

export interface CappedUtf8Text {
    write(chunk: Buffer | string): void;
    end(): void;
    readonly text: string;
    readonly truncated: boolean;
}

export function cappedUtf8Text(cap: number): CappedUtf8Text {
    const decoder = new StringDecoder('utf8');
    let text = '';
    let full = false;
    const append = (s: string): void => {
        if (full || !s) return;
        if (text.length + s.length > cap) {
            full = true;
            let end = Math.max(0, cap - text.length);
            const last = s.charCodeAt(end - 1);
            if (end > 0 && last >= 0xd800 && last <= 0xdbff) end -= 1; // 대리 쌍 한가운데에서 자르지 않는다
            s = s.slice(0, end);
        }
        text += s;
    };
    return {
        write: (chunk) => append(typeof chunk === 'string' ? chunk : decoder.write(chunk)),
        end: () => append(decoder.end()),
        get text() { return text; },
        get truncated() { return full; },
    };
}
