import SwiftUI
import MapKit
import WebKit
import OpenMakeKit

/// ```kakaomap 블록을 네이티브 지도 카드로 렌더한다.
///
/// 백엔드는 카카오 search-places 결과를 이 블록으로 결정적 주입하는데, 앱에 렌더러가
/// 없어 raw JSON 코드블록으로 보였다 — 사용자에게는 "앱에서만 카카오가 안 된다"로
/// 보이던 갭(2026-08-18 실측). 지도 자체는 MapKit 으로 그리고(서드파티 0 유지),
/// 각 장소는 카카오맵 상세 페이지로 연결한다.
struct KakaoMapCard: View {
    let payload: KakaoMapPayload

    @State private var camera: MapCameraPosition = .automatic
    @State private var kakaoFailed = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 카카오 타일이 기본 — 검색 결과가 카카오 기준이라 지도도 같은 출처가 맞다.
            // SDK 키 미설정·도메인 미등록·네트워크 실패 시 MapKit 으로 되돌아간다.
            if kakaoFailed {
                mapKitView
            } else {
                KakaoMapWebView(payload: payload, onFailure: { kakaoFailed = true })
                    .frame(height: 220)
            }

            if !payload.places.isEmpty {
                Divider().overlay(Instrument.border)
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(payload.places.enumerated()), id: \.element.id) { index, place in
                        if index > 0 { Divider().overlay(Instrument.border).padding(.leading, 12) }
                        placeRow(place)
                    }
                }
            }
        }
        .background(Instrument.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Instrument.border))
    }

    private var mapKitView: some View {
        VStack(spacing: 0) {
            Map(position: $camera) {
                ForEach(payload.places) { place in
                    Marker(place.name, coordinate: place.coordinate)
                        .tint(Instrument.accent)
                }
                if payload.route.count > 1 {
                    MapPolyline(coordinates: payload.route.map(\.coordinate))
                        .stroke(Instrument.accent, lineWidth: 4)
                }
            }
            .frame(height: 220)
        }
        .onAppear { camera = .region(payload.region) }
    }

    @ViewBuilder
    private func placeRow(_ place: KakaoPlace) -> some View {
        Button {
            if let raw = place.url, let url = URL(string: raw) { openURL(url) }
        } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "mappin.circle.fill")
                    .font(.system(size: 15))
                    .foregroundStyle(Instrument.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(place.name)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Instrument.fg)
                    if let address = place.address {
                        Text(address)
                            .font(.caption)
                            .foregroundStyle(Instrument.muted)
                    }
                }
                Spacer(minLength: 0)
                if place.url != nil {
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(Instrument.faint)
                }
            }
            .padding(12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(place.url == nil)
        .accessibilityHint(place.url == nil ? "" : "카카오맵에서 열기")
    }
}

private extension KakaoPlace {
    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
}

private extension KakaoRoutePoint {
    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
}

private extension KakaoMapPayload {
    /// 모든 지점이 들어오도록 경계 상자를 잡고 여유를 준다. 한 점뿐이면 고정 배율.
    var region: MKCoordinateRegion {
        let coords = places.map { ($0.lat, $0.lng) } + route.map { ($0.lat, $0.lng) }
        guard let first = coords.first else {
            return MKCoordinateRegion(
                center: .init(latitude: 37.5665, longitude: 126.9780),
                span: .init(latitudeDelta: 0.05, longitudeDelta: 0.05))
        }
        var minLat = first.0, maxLat = first.0, minLng = first.1, maxLng = first.1
        for (lat, lng) in coords {
            minLat = min(minLat, lat); maxLat = max(maxLat, lat)
            minLng = min(minLng, lng); maxLng = max(maxLng, lng)
        }
        let center = CLLocationCoordinate2D(
            latitude: (minLat + maxLat) / 2,
            longitude: (minLng + maxLng) / 2)
        let span = MKCoordinateSpan(
            latitudeDelta: max((maxLat - minLat) * 1.4, 0.006),
            longitudeDelta: max((maxLng - minLng) * 1.4, 0.006))
        return MKCoordinateRegion(center: center, span: span)
    }
}

/// 서버가 내려주는 카카오 지도 임베드(`/api/embed/kakao-map`)를 띄우는 웹뷰.
///
/// 앱이 카카오 SDK 를 직접 부르려면 JS 키를 바이너리에 넣어야 하고 콘솔의 도메인 제한과도
/// 어긋난다. 서버 HTML 을 그대로 로드하면 키는 서버에만 남고 origin 도 서버 도메인이 된다.
/// 장소 데이터는 URL 이 아니라 로드 완료 후 JS 로 주입한다(장소가 많아도 길이 제한이 없다).
private struct KakaoMapWebView: UIViewRepresentable {
    let payload: KakaoMapPayload
    let onFailure: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(payload: payload, onFailure: onFailure) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(context.coordinator, name: "mapStatus")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false   // 카드 안이라 지도 제스처만 남긴다

        var request = URLRequest(url: AppConfig.serverURL.appendingPathComponent("api/embed/kakao-map"))
        request.timeoutInterval = Coordinator.loadTimeout
        webView.load(request)
        context.coordinator.startWatchdog()
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.webView = webView
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.cancelWatchdog()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "mapStatus")
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        static let loadTimeout: TimeInterval = 8

        private let payload: KakaoMapPayload
        private let onFailure: () -> Void
        private var didSettle = false
        private var watchdog: Task<Void, Never>?
        weak var webView: WKWebView?

        init(payload: KakaoMapPayload, onFailure: @escaping () -> Void) {
            self.payload = payload
            self.onFailure = onFailure
        }

        /// SDK 가 조용히 멈추는 경우까지 덮는다 — 시간 안에 'ready' 가 안 오면 MapKit 으로.
        func startWatchdog() {
            watchdog = Task { [weak self] in
                try? await Task.sleep(for: .seconds(Coordinator.loadTimeout))
                guard let self, !Task.isCancelled else { return }
                await MainActor.run { self.settleAsFailure() }
            }
        }

        func cancelWatchdog() {
            watchdog?.cancel()
            watchdog = nil
        }

        @MainActor
        private func settleAsFailure() {
            guard !didSettle else { return }
            didSettle = true
            cancelWatchdog()
            onFailure()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard let json = encodedPayload() else {
                Task { @MainActor in settleAsFailure() }
                return
            }
            webView.evaluateJavaScript("window.renderKakaoMap(\(json));") { [weak self] _, error in
                if error != nil { Task { @MainActor in self?.settleAsFailure() } }
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            Task { @MainActor in settleAsFailure() }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            Task { @MainActor in settleAsFailure() }
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "mapStatus", let status = message.body as? String else { return }
            Task { @MainActor in
                if status == "ready" {
                    didSettle = true
                    cancelWatchdog()
                } else {
                    settleAsFailure()
                }
            }
        }

        private func encodedPayload() -> String? {
            let places: [[String: Any]] = payload.places.map { place in
                var item: [String: Any] = ["name": place.name, "lat": place.lat, "lng": place.lng]
                if let address = place.address { item["address"] = address }
                return item
            }
            let route: [[String: Any]] = payload.route.map { ["lat": $0.lat, "lng": $0.lng] }
            let root: [String: Any] = ["places": places, "route": route]
            guard let data = try? JSONSerialization.data(withJSONObject: root),
                  let json = String(data: data, encoding: .utf8) else { return nil }
            return json
        }
    }
}
