import Foundation

/// ```kakaomap 블록이 담는 장소 하나.
/// 백엔드(external-deterministic-append)가 search-places 도구 결과로 결정적 주입한다.
public struct KakaoPlace: Equatable, Sendable, Identifiable {
    public let name: String
    public let lat: Double
    public let lng: Double
    public let address: String?
    public let url: String?

    /// 같은 이름의 지점이 여러 개일 수 있어 좌표까지 묶어 식별자로 쓴다.
    public var id: String { "\(name)@\(lat),\(lng)" }

    public init(name: String, lat: Double, lng: Double, address: String? = nil, url: String? = nil) {
        self.name = name
        self.lat = lat
        self.lng = lng
        self.address = address
        self.url = url
    }
}

/// 경로 폴리라인 좌표.
public struct KakaoRoutePoint: Equatable, Sendable {
    public let lat: Double
    public let lng: Double

    public init(lat: Double, lng: Double) {
        self.lat = lat
        self.lng = lng
    }
}

public struct KakaoMapPayload: Equatable, Sendable {
    public let places: [KakaoPlace]
    public let route: [KakaoRoutePoint]

    public var isEmpty: Bool { places.isEmpty && route.isEmpty }
}

/// ```kakaomap 코드펜스 본문(JSON) 파서.
///
/// 앱에 렌더러가 없어 이 블록이 raw JSON 으로 노출되던 갭을 메운다 — 웹은
/// components/chat/kakao-map.tsx 가 지도로 렌더하는데 앱에는 대응이 없었다(2026-08-18 실측).
/// 좌표가 유한값이 아닌 항목은 버린다(웹 구현과 동일 규칙).
public enum KakaoMapBlock {
    public static let language = "kakaomap"

    public static func parse(_ json: String) -> KakaoMapPayload? {
        guard let data = json.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }

        let places: [KakaoPlace] = (root["places"] as? [[String: Any]] ?? []).compactMap { raw in
            guard let name = raw["name"] as? String, !name.isEmpty,
                  let lat = finiteDouble(raw["lat"]),
                  let lng = finiteDouble(raw["lng"]) else { return nil }
            let address = (raw["address"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            let url = (raw["url"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            return KakaoPlace(name: name, lat: lat, lng: lng, address: address, url: url)
        }

        let route: [KakaoRoutePoint] = (root["route"] as? [[String: Any]] ?? []).compactMap { raw in
            guard let lat = finiteDouble(raw["lat"]), let lng = finiteDouble(raw["lng"]) else { return nil }
            return KakaoRoutePoint(lat: lat, lng: lng)
        }

        let payload = KakaoMapPayload(places: places, route: route)
        return payload.isEmpty ? nil : payload
    }

    private static func finiteDouble(_ value: Any?) -> Double? {
        let number: Double?
        switch value {
        case let d as Double: number = d
        case let i as Int: number = Double(i)
        case let s as String: number = Double(s)
        default: number = nil
        }
        guard let number, number.isFinite else { return nil }
        return number
    }
}
