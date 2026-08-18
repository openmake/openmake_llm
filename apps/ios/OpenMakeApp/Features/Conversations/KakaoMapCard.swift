import SwiftUI
import MapKit
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
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Map(position: $camera) {
                ForEach(payload.places) { place in
                    Marker(place.name, coordinate: place.coordinate)
                        .tint(Lumen.accent)
                }
                if payload.route.count > 1 {
                    MapPolyline(coordinates: payload.route.map(\.coordinate))
                        .stroke(Lumen.accent, lineWidth: 4)
                }
            }
            .frame(height: 220)
            .allowsHitTesting(true)

            if !payload.places.isEmpty {
                Divider().overlay(Lumen.border)
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(payload.places.enumerated()), id: \.element.id) { index, place in
                        if index > 0 { Divider().overlay(Lumen.border).padding(.leading, 12) }
                        placeRow(place)
                    }
                }
            }
        }
        .background(Lumen.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Lumen.border))
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
                    .foregroundStyle(Lumen.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(place.name)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Lumen.fg)
                    if let address = place.address {
                        Text(address)
                            .font(.caption)
                            .foregroundStyle(Lumen.muted)
                    }
                }
                Spacer(minLength: 0)
                if place.url != nil {
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(Lumen.faint)
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
