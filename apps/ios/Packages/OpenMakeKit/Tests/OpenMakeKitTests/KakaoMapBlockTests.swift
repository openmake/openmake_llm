import XCTest
@testable import OpenMakeKit

final class KakaoMapBlockTests: XCTestCase {
    func testParsesPlacesFromServerPayload() throws {
        let json = """
        {"places":[
          {"name":"스타벅스 선릉세화빌딩점","lat":37.5044,"lng":127.0489,"address":"서울 강남구 대치동 889-70","url":"http://place.map.kakao.com/1"},
          {"name":"써트커피","lat":37.5061,"lng":127.0533}
        ]}
        """
        let payload = try XCTUnwrap(KakaoMapBlock.parse(json))
        XCTAssertEqual(payload.places.count, 2)
        XCTAssertEqual(payload.places[0].name, "스타벅스 선릉세화빌딩점")
        XCTAssertEqual(payload.places[0].address, "서울 강남구 대치동 889-70")
        XCTAssertNil(payload.places[1].address)
        XCTAssertTrue(payload.route.isEmpty)
    }

    func testDropsPlacesWithInvalidCoordinates() throws {
        let json = """
        {"places":[
          {"name":"정상","lat":37.5,"lng":127.0},
          {"name":"좌표없음"},
          {"name":"문자열좌표","lat":"37.6","lng":"127.1"}
        ]}
        """
        let payload = try XCTUnwrap(KakaoMapBlock.parse(json))
        XCTAssertEqual(payload.places.map(\.name), ["정상", "문자열좌표"])
    }

    func testParsesRoutePoints() throws {
        let json = #"{"places":[],"route":[{"lat":37.5,"lng":127.0},{"lat":37.6,"lng":127.1}]}"#
        let payload = try XCTUnwrap(KakaoMapBlock.parse(json))
        XCTAssertEqual(payload.route.count, 2)
    }

    func testReturnsNilForEmptyOrInvalidPayload() {
        XCTAssertNil(KakaoMapBlock.parse("not json"))
        XCTAssertNil(KakaoMapBlock.parse(#"{"places":[]}"#))
        XCTAssertNil(KakaoMapBlock.parse(#"{"places":[{"name":"좌표없음"}]}"#))
    }

    func testPlaceIdDistinguishesSameNameDifferentBranches() {
        let a = KakaoPlace(name: "스타벅스", lat: 37.5, lng: 127.0)
        let b = KakaoPlace(name: "스타벅스", lat: 37.6, lng: 127.1)
        XCTAssertNotEqual(a.id, b.id)
    }
}
