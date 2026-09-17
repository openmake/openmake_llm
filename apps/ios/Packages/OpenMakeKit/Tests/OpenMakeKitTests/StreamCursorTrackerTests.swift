import XCTest
@testable import OpenMakeKit

final class StreamCursorTrackerTests: XCTestCase {
    private func frame(_ json: String) -> Data { Data(json.utf8) }

    func testFramesWithoutEnvelopeAreAppliedAndDoNotMoveCursor() {
        var t = StreamCursorTracker()
        XCTAssertTrue(t.accept(frame(#"{"type":"build_id","buildId":"x"}"#)))
        XCTAssertNil(t.streamId)
        XCTAssertEqual(t.resumeMessage(), #"{"type":"resume"}"#)
    }

    func testDuplicateSeqInSameStreamIsDropped() {
        var t = StreamCursorTracker()
        XCTAssertTrue(t.accept(frame(#"{"type":"token","token":"a","streamId":"s1","seq":1}"#)))
        XCTAssertTrue(t.accept(frame(#"{"type":"token","token":"b","streamId":"s1","seq":2}"#)))
        XCTAssertFalse(t.accept(frame(#"{"type":"artifact_chunk","streamId":"s1","seq":2}"#)))
        XCTAssertTrue(t.accept(frame(#"{"type":"done","streamId":"s1","seq":3}"#)))
        XCTAssertEqual(t.lastSeq, 3)
        XCTAssertEqual(t.resumeMessage(), #"{"afterSeq":3,"streamId":"s1","type":"resume"}"#)
    }

    func testNewStreamResetsCursor() {
        var t = StreamCursorTracker()
        _ = t.accept(frame(#"{"type":"done","streamId":"s1","seq":40}"#))
        XCTAssertTrue(t.accept(frame(#"{"type":"token","streamId":"s2","seq":1}"#)))
        XCTAssertEqual(t.streamId, "s2")
        XCTAssertEqual(t.lastSeq, 1)
    }

    func testStreamResumeKeepsAfterSeqForSameStreamAndResetsForOther() {
        var t = StreamCursorTracker()
        _ = t.accept(frame(#"{"type":"artifact_start","streamId":"s1","seq":7}"#))
        XCTAssertTrue(t.accept(frame(#"{"type":"stream_resume","content":"x","finished":false,"streamId":"s1","lastSeq":9}"#)))
        XCTAssertEqual(t.lastSeq, 7)
        XCTAssertTrue(t.accept(frame(#"{"type":"artifact_chunk","streamId":"s1","seq":8}"#)))
        XCTAssertTrue(t.accept(frame(#"{"type":"stream_resume","content":"y","finished":false,"streamId":"s9","lastSeq":3}"#)))
        XCTAssertEqual(t.streamId, "s9")
        XCTAssertEqual(t.lastSeq, 0)
        XCTAssertTrue(t.accept(frame(#"{"type":"artifact_start","streamId":"s9","seq":2}"#)))
    }
}
