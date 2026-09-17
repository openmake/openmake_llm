// OpenMakeKit — 답변 웹검색 출처 (F19.4, 2026-09-17)
//
// 스트리밍(search_sources WS 이벤트, quicktype 생성 타입)과 히스토리(REST ChatMessage.sources, openapi 생성 타입)의
// 두 표현을 화면용 하나로 맞춘다. 번호 n 은 본문 [N] 과 같다.
import Foundation

public struct ChatSourceItem: Identifiable, Hashable, Sendable {
    public let n: Int
    public let title: String
    public let url: String
    public let snippet: String
    public let domain: String

    public var id: Int { n }

    public init(n: Int, title: String, url: String, snippet: String, source: String?) {
        self.n = n
        self.title = title
        self.url = url
        self.snippet = snippet
        self.domain = source ?? URL(string: url)?.host ?? url
    }

    public init(_ ref: SearchSourceRef) {
        self.init(n: Int(ref.n), title: ref.title, url: ref.url, snippet: ref.snippet, source: ref.source)
    }

    public init(_ ref: Components.Schemas.SearchSourceRef) {
        self.init(n: ref.n, title: ref.title, url: ref.url, snippet: ref.snippet, source: ref.source)
    }

    /// 확정 메시지(REST 모델)에 실을 때
    public var contractRef: Components.Schemas.SearchSourceRef {
        .init(n: n, title: title, url: url, snippet: snippet, source: domain)
    }
}
