// OpenMakeKit — API JSON 코딩 규약
//
// [축 1 PoC 발견 ②] 계약의 `format: date-time` 필드는 Swift `Date` 로 매핑되는데,
// 서버 timestamp 는 밀리초 포함 ISO(`new Date().toISOString()`)라 기본 JSONDecoder
// (deferredToDate — Double 기대)로는 디코딩이 실패한다. 모든 REST 디코딩은 반드시
// 이 팩토리의 decoder/encoder 를 사용할 것.
import Foundation

public enum OpenMakeJSON {
    private static let fractionalFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let plainFormatter = ISO8601DateFormatter()

    /// 밀리초 포함/미포함 ISO8601 을 모두 수용하는 API 표준 디코더
    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            guard let date = fractionalFormatter.date(from: raw) ?? plainFormatter.date(from: raw) else {
                throw DecodingError.dataCorrupted(.init(
                    codingPath: decoder.codingPath,
                    debugDescription: "ISO8601 파싱 실패: \(raw)"
                ))
            }
            return date
        }
        return decoder
    }

    /// 밀리초 포함 ISO8601 로 인코딩하는 API 표준 인코더
    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(fractionalFormatter.string(from: date))
        }
        return encoder
    }
}
