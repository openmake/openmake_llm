/**
 * react-dom 보다 먼저 import 해 JSDOM 전역을 깔아 둔다. react-dom 은 모듈을 읽을 때 `window` 가 있어야
 * `input` 이벤트를 onChange 로 듣는다(없으면 구형 브라우저용 대체 경로라 테스트의 입력 이벤트가 상태를 바꾸지 않는다).
 * 각 테스트는 여전히 자기 JSDOM 을 전역에 다시 건다.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('');
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
