// 축 1 Step 6 PoC 를 이식한 계약 왕복 디코딩 테스트.
// 생성 코드(Types.swift·WsModels.swift)가 packages/api-contracts 계약과 정합함을 고정한다.
import XCTest
@testable import OpenMakeKit

final class ContractRoundTripTests: XCTestCase {

    // MARK: REST (swift-openapi-generator)

    func testChatMessageRoundTrip() throws {
        let json = #"{"role":"assistant","content":"안녕하세요","model":"local-llm:m1","tokens":12,"created_at":"2026-08-16T00:00:00.000Z"}"#.data(using: .utf8)!
        let msg = try OpenMakeJSON.decoder().decode(Components.Schemas.ChatMessage.self, from: json)
        XCTAssertEqual(msg.content, "안녕하세요")
        XCTAssertEqual(msg.tokens, 12)

        let reencoded = try OpenMakeJSON.encoder().encode(msg)
        let msg2 = try OpenMakeJSON.decoder().decode(Components.Schemas.ChatMessage.self, from: reencoded)
        XCTAssertEqual(msg2.content, msg.content)
        XCTAssertEqual(msg2.model, msg.model)
    }

    func testLoginEnvelopeDecodesDateTimeMeta() throws {
        // meta.timestamp 는 format: date-time → Date 매핑 — OpenMakeJSON 전략 없이는 실패 (PoC 발견 ②)
        let json = #"{"success":true,"data":{"success":true,"token":"at","user":{"id":"u1","email":"riskpw@openmake.cc","role":"user","created_at":"2026-08-16T00:00:00.000Z","is_active":true}},"meta":{"timestamp":"2026-08-16T00:00:00.000Z"}}"#.data(using: .utf8)!
        let login = try OpenMakeJSON.decoder().decode(
            Operations.post_sol_api_sol_auth_sol_login.Output.Ok.Body.jsonPayload.self,
            from: json)
        XCTAssertEqual(login.data.user?.email, "riskpw@openmake.cc")
    }

    func testMobileExchangeEnvelopeDecodes() throws {
        // 축 2 신설 표면 — POST /api/auth/mobile/exchange 200
        let json = #"{"success":true,"data":{"token":"at","refreshToken":"rt","user":{"id":"u1","email":"riskpw@openmake.cc","role":"user","created_at":"2026-08-16T00:00:00.000Z","is_active":true}},"meta":{"timestamp":"2026-08-16T00:00:00.000Z"}}"#.data(using: .utf8)!
        let payload = try OpenMakeJSON.decoder().decode(
            Operations.post_sol_api_sol_auth_sol_mobile_sol_exchange.Output.Ok.Body.jsonPayload.self,
            from: json)
        XCTAssertEqual(payload.data.refreshToken, "rt")
    }

    // MARK: WS (quicktype)

    func testWsServerEventRoundTrip() throws {
        let json = #"{"type":"token","token":"안녕"}"#.data(using: .utf8)!
        let event = try JSONDecoder().decode(WsServerEvent.self, from: json)
        XCTAssertEqual(event.type, .token)
        XCTAssertEqual(event.token, "안녕")

        let roundTrip = try JSONDecoder().decode(WsServerEvent.self, from: JSONEncoder().encode(event))
        XCTAssertEqual(roundTrip.type, event.type)
        XCTAssertEqual(roundTrip.token, event.token)
    }

    func testWsChatRequestDecodes() throws {
        let json = #"{"type":"chat","message":"안녕","model":"local-llm:m1","style":"concise","files":[{"id":"f1","name":"a.txt","type":"text/plain","content":"hi"}]}"#.data(using: .utf8)!
        let request = try JSONDecoder().decode(WsChatRequest.self, from: json)
        XCTAssertEqual(request.message, "안녕")
        XCTAssertEqual(request.files?.first?.name, "a.txt")
    }

    // MARK: forward-compat (PoC 발견 ①)

    func testUnknownEventTypeIsIgnoredNotCrash() {
        let unknown = #"{"type":"future_event_2027","newField":123}"#.data(using: .utf8)!
        XCTAssertNil(WsEventDecoder.decode(unknown))
    }

    func testKnownEventPassesLenientDecoder() {
        let known = #"{"type":"token","token":"안녕"}"#.data(using: .utf8)!
        XCTAssertEqual(WsEventDecoder.decode(known)?.token, "안녕")
    }

    func testUnknownFieldsOnKnownEventAreIgnored() throws {
        let extra = #"{"type":"done","messageId":"m1","someFutureField":{"a":1}}"#.data(using: .utf8)!
        XCTAssertEqual(WsEventDecoder.decode(extra)?.type, .done)
    }
}
