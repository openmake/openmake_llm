// 라이브 스모크 (opt-in) — 운영 chat.openmake.cc 대상 Kit 실전 왕복.
//
// 실행법 (기본 skip — CI 무영향):
//   OPENMAKE_LIVE_BEARER=<access-jwt> swift test --filter LiveSmokeTests
//
// 검증 범위: OpenMakeClient 의 실제 URLSession 경로 + Bearer 인증 + envelope/date-time
// 디코딩이 운영 서버 응답과 정합하는지. (모바일 로그인/refresh body 모드는 축 2 배포 후
// 라이브 검증 — 축 2 plan §6.)
import XCTest
@testable import OpenMakeKit

final class LiveSmokeTests: XCTestCase {
    func testLiveMeWithBearer() async throws {
        guard let bearer = ProcessInfo.processInfo.environment["OPENMAKE_LIVE_BEARER"], !bearer.isEmpty else {
            throw XCTSkip("OPENMAKE_LIVE_BEARER 미설정 — 라이브 스모크 생략")
        }
        let base = ProcessInfo.processInfo.environment["OPENMAKE_LIVE_BASE"] ?? "https://chat.openmake.cc"

        let store = InMemoryTokenStore()
        // refresh 는 이 스모크에서 사용하지 않는다 (401 시 실패로 종결)
        store.save(AuthTokens(access: bearer, refresh: "unused"))
        let client = OpenMakeClient(
            configuration: .init(serverURL: URL(string: base)!),
            tokenStore: store)

        let user = try await client.me()
        XCTAssertNotNil(user, "Bearer 인증 사용자 조회 실패")
        XCTAssertEqual(user?.id, "3", "테스트 계정(user 3) 규약")

        // 축 3 Step 3 verify: 웹에서 만든 세션이 Kit(계약 타입)로 조회되는지
        let sessions = try await client.sessions(limit: 5)
        XCTAssertFalse(sessions.isEmpty, "user 3 의 웹 대화가 목록에 보여야 함")
        if let first = sessions.first {
            let messages = try await client.messages(sessionId: first.id, limit: 10)
            XCTAssertFalse(messages.isEmpty, "세션 이력 메시지 조회")
        }
    }

    /// 축 3 Step 4 verify: WS Bearer 핸드셰이크 + 실시간 토큰 스트림 + done 메트릭 (운영 라이브)
    /// saveHistory=false·memoryLearning=false — 테스트 계정 이력/메모리 오염 방지.
    func testLiveWsChatStreaming() async throws {
        guard let bearer = ProcessInfo.processInfo.environment["OPENMAKE_LIVE_BEARER"], !bearer.isEmpty else {
            throw XCTSkip("OPENMAKE_LIVE_BEARER 미설정 — 라이브 스모크 생략")
        }
        let base = ProcessInfo.processInfo.environment["OPENMAKE_LIVE_BASE"] ?? "https://chat.openmake.cc"

        let socket = WsChatSocket(serverURL: URL(string: base)!)
        let events = try await socket.connect(bearer: bearer)
        try await socket.send(.chat(
            message: "1+1은? 숫자만 답해.",
            saveHistory: false,
            memoryLearning: false))

        // 워치독 — 서버 무응답 시 90초 후 강제 종료 (스트림 finish → 루프 탈출)
        let watchdog = Task {
            try? await Task.sleep(for: .seconds(90))
            await socket.disconnect()
        }

        var state = ChatStreamState()
        var tokenEventCount = 0
        for await event in events {
            if event.type == .token { tokenEventCount += 1 }
            state.apply(event)
            if state.isDone { break }
        }
        watchdog.cancel()
        await socket.disconnect()

        XCTAssertTrue(state.isDone, "done 이벤트 수신")
        XCTAssertGreaterThan(tokenEventCount, 0, "token 스트림 수신")
        XCTAssertNotNil(state.metrics, "done 메트릭")
        XCTAssertNil(state.errorMessage)
    }

    /// 축 3 Step 5 verify: 모델 카탈로그 조회 + 모델 명시 채팅 + 파일 첨부 컨텍스트 주입 (운영 라이브)
    func testLiveModelSelectionAndFileAttachment() async throws {
        guard let bearer = ProcessInfo.processInfo.environment["OPENMAKE_LIVE_BEARER"], !bearer.isEmpty else {
            throw XCTSkip("OPENMAKE_LIVE_BEARER 미설정 — 라이브 스모크 생략")
        }
        let base = ProcessInfo.processInfo.environment["OPENMAKE_LIVE_BASE"] ?? "https://chat.openmake.cc"

        let store = InMemoryTokenStore()
        store.save(AuthTokens(access: bearer, refresh: "unused"))
        let client = OpenMakeClient(
            configuration: .init(serverURL: URL(string: base)!), tokenStore: store)

        // 모델 카탈로그 라이브
        let catalog = try await client.modelCatalog()
        XCTAssertFalse(catalog.defaultModel.isEmpty)
        XCTAssertFalse(catalog.models.isEmpty)

        // 모델 명시 + 텍스트 파일 첨부 — 파일 컨텍스트 주입의 결정적 검증
        let socket = WsChatSocket(serverURL: URL(string: base)!)
        let events = try await socket.connect(bearer: bearer)
        try await socket.send(.chat(
            message: "첨부 파일 안의 비밀 코드를 숫자만 답해.",
            model: catalog.defaultModel,
            files: [.text(name: "secret.txt", content: "비밀 코드는 9427 이다.")],
            saveHistory: false,
            memoryLearning: false))

        let watchdog = Task {
            try? await Task.sleep(for: .seconds(90))
            await socket.disconnect()
        }
        var state = ChatStreamState()
        for await event in events {
            state.apply(event)
            if state.isDone { break }
        }
        watchdog.cancel()
        await socket.disconnect()

        XCTAssertTrue(state.isDone)
        XCTAssertNil(state.errorMessage)
        XCTAssertTrue(state.streamingText.contains("9427"), "파일 컨텍스트 미주입 — 응답: \(state.streamingText.prefix(200))")
    }
}
