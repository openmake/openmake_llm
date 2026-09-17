// OpenMakeKit — 스트림 이어받기 커서 (F19.11, 2026-09-17)
//
// 서버(ws-stream-registry)는 채팅 스트림 이벤트에 streamId(스트림마다 발급)·seq(1부터 단조 증가)를 붙인다.
// 이 추적기는 마지막 수신 위치를 기억해 재연결 resume 에 실어 보내고, 재생·재연결로 다시 온 이벤트(seq <= lastSeq)를
// 걸러낸다 — 웹 lib/ws-seq.ts 와 같은 규칙. 생성 모델(WsModels)과 독립적으로 원시 프레임에서 봉투만 읽는다.
import Foundation

public struct StreamCursorTracker: Sendable, Equatable {
    public private(set) var streamId: String?
    public private(set) var lastSeq: Int = 0

    public init() {}

    private struct Envelope: Decodable {
        let type: String?
        let streamId: String?
        let seq: Int?
    }

    /// 프레임을 적용해도 되는지 판정하고 커서를 갱신한다. 봉투가 없거나 해석할 수 없는 프레임은 적용(true).
    public mutating func accept(_ data: Data) -> Bool {
        guard let env = try? JSONDecoder().decode(Envelope.self, from: data) else { return true }
        if env.type == "stream_resume" {
            // 같은 스트림이면 보낸 afterSeq 를 유지해 뒤따르는 재생 이벤트를 받고, 다른 스트림이면 0 부터
            if let id = env.streamId, id != streamId {
                streamId = id
                lastSeq = 0
            }
            return true
        }
        guard let id = env.streamId, let seq = env.seq else { return true }
        if id != streamId {
            streamId = id
            lastSeq = seq
            return true
        }
        guard seq > lastSeq else { return false }
        lastSeq = seq
        return true
    }

    /// resume 요청 JSON — 받은 스트림이 없으면 커서 없이(서버 종전 동작).
    public func resumeMessage() -> String {
        var body: [String: Any] = ["type": "resume"]
        if let streamId {
            body["streamId"] = streamId
            body["afterSeq"] = lastSeq
        }
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8) else { return #"{"type":"resume"}"# }
        return text
    }
}
