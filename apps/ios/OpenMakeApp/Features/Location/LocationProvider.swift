// 기기 GPS 위치 제공자 (폰 기능 2단계)
//
// 원칙: **옵트인 + 턴 단위** — 항상 추적하지 않고, 사용자가 컴포저의 위치 버튼을 켠
// 턴에만 1회 위치를 얻어 WsChatRequest.userLocation 으로 첨부한다. 서버는 system
// 컨텍스트에 결정적 주입해 카카오 search-places(x=lng, y=lat) 좌표 검색을 가능하게 한다.
// 위치는 서버에 저장되지 않는다(턴 단위 system 채널).
import Foundation
import CoreLocation

@MainActor
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    static let shared = LocationProvider()

    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation?, Never>?

    override private init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters // 주변 검색엔 충분 + 빠름/저전력
    }

    var isAuthorized: Bool {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: return true
        default: return false
        }
    }

    /// 현재 위치 1회 획득 — 권한 미결정이면 요청부터. 거부/실패는 nil (채팅은 위치 없이 진행).
    func currentLocation() async -> (lat: Double, lng: Double)? {
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
            // 권한 다이얼로그 응답 대기 — delegate 콜백에서 이어짐
            let granted = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
                authContinuation = cont
            }
            guard granted else { return nil }
        }
        guard isAuthorized else { return nil }
        let location = await withCheckedContinuation { (cont: CheckedContinuation<CLLocation?, Never>) in
            continuation = cont
            manager.requestLocation()
        }
        guard let location else { return nil }
        return (lat: location.coordinate.latitude, lng: location.coordinate.longitude)
    }

    // MARK: - CLLocationManagerDelegate

    private var authContinuation: CheckedContinuation<Bool, Never>?

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            guard let cont = authContinuation else { return }
            authContinuation = nil
            cont.resume(returning: status == .authorizedWhenInUse || status == .authorizedAlways)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in
            continuation?.resume(returning: locations.last)
            continuation = nil
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            continuation?.resume(returning: nil)
            continuation = nil
        }
    }
}
