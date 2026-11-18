// web-push 4.x 는 ESM 전용("type":"module") — 런타임(Node 24)은 tsc CJS 출력의 require(esm) 으로 그대로 로드하지만,
// jest CJS 런타임은 ESM 을 require 하지 못하고(createRequireEsmError) "type":"module" 패키지의 .js 는 transform 해도
// ESM 으로 판정한다. 그래서 import 만 하는 스위트가 깨지지 않게 하는 최소 shim 이다.
// 발송·키 생성을 검증하는 테스트는 jest.mock('web-push', factory) 로 직접 대체한다(factory 가 이 매퍼보다 우선).
const unavailable = (name) => () => {
    throw new Error(`web-push shim(jest): ${name} 는 테스트에서 jest.mock('web-push', ...) 로 대체해야 한다`);
};
module.exports = {
    setVapidDetails: () => undefined,
    sendNotification: unavailable('sendNotification'),
    generateVAPIDKeys: unavailable('generateVAPIDKeys'),
};
