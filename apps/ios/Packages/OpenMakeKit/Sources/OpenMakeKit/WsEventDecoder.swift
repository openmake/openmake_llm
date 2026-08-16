// OpenMakeKit — WS 서버 이벤트 관대(lenient) 디코더
//
// [축 1 PoC 발견 ①] 생성 모델(WsModels.swift)의 `WsServerEventType` 은 닫힌 enum 이라
// 서버가 새 이벤트 type 을 추가하면 디코딩이 실패한다. 계약(ws-chat.v1)의 forward-compat
// 규약은 "클라이언트는 미지 이벤트 type 을 무시해야 한다" — 이 디코더가 그 규약의 구현이다.
// WS 수신 경로는 반드시 이 디코더를 사용할 것 (JSONDecoder 직접 사용 금지).
import Foundation

public enum WsEventDecoder {
    private struct TypeProbe: Codable { let type: String }

    /// 서버 이벤트 디코드. 미지 type 이거나 형식 불일치면 nil (무시) — crash 없음.
    public static func decode(_ data: Data) -> WsServerEvent? {
        guard let probe = try? JSONDecoder().decode(TypeProbe.self, from: data),
              WsServerEventType(rawValue: probe.type) != nil else {
            return nil // 미지 이벤트 — forward-compat 무시
        }
        return try? JSONDecoder().decode(WsServerEvent.self, from: data)
    }
}
