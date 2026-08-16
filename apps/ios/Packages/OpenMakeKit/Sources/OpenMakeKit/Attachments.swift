// OpenMakeKit — 첨부 빌더 (축 3 Step 5)
//
// 계약(WsAttachedFile): 텍스트는 content, PDF/Office 등 바이너리 문서는 base64 `data`
// (서버 doc-extractor 가 텍스트 추출). 사진은 WsChatRequest.images[] 의 dataURL.
// 상한: 외부 경로(chat.openmake.cc)는 Cloudflare 요청당 100MB — 클라이언트 캡은 그보다
// 훨씬 보수적으로 잡는다 (WS 단일 프레임 페이로드이기도 함).
import Foundation

public enum AttachmentLimits {
    /// 텍스트 첨부 내용 캡 (초과 시 절단 + truncated 플래그 — 계약 규약)
    public static let textContentCap = 200_000
    /// 바이너리 문서(base64 이전 원본) 상한
    public static let binaryCapBytes = 20 * 1024 * 1024
}

public enum AttachmentError: Error, Sendable {
    case binaryTooLarge(bytes: Int)
}

public extension WsAttachedFile {
    /// 텍스트 파일 첨부 — 캡 초과 시 절단하고 truncated 표시
    static func text(
        id: String = UUID().uuidString,
        name: String,
        mimeType: String = "text/plain",
        content: String
    ) -> WsAttachedFile {
        let truncated = content.count > AttachmentLimits.textContentCap
        let capped = truncated ? String(content.prefix(AttachmentLimits.textContentCap)) : content
        return WsAttachedFile(
            content: capped,
            data: nil,
            id: id,
            name: name,
            size: Double(content.utf8.count),
            truncated: truncated ? true : nil,
            type: mimeType)
    }

    /// 바이너리 문서(PDF/docx 등) 첨부 — 서버가 base64 원본에서 텍스트 추출
    static func binaryDocument(
        id: String = UUID().uuidString,
        name: String,
        mimeType: String,
        data: Data
    ) throws -> WsAttachedFile {
        guard data.count <= AttachmentLimits.binaryCapBytes else {
            throw AttachmentError.binaryTooLarge(bytes: data.count)
        }
        return WsAttachedFile(
            content: nil,
            data: data.base64EncodedString(),
            id: id,
            name: name,
            size: Double(data.count),
            truncated: nil,
            type: mimeType)
    }
}

public enum DataURL {
    /// 이미지 → WsChatRequest.images[] 용 dataURL
    public static func encode(_ data: Data, mimeType: String) -> String {
        "data:\(mimeType);base64,\(data.base64EncodedString())"
    }

    /// magic bytes 기반 이미지 MIME 판별 (미지 포맷은 jpeg 폴백)
    public static func imageMimeType(of data: Data) -> String {
        if data.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "image/png" }
        if data.starts(with: [0xFF, 0xD8]) { return "image/jpeg" }
        if data.starts(with: [0x47, 0x49, 0x46]) { return "image/gif" }
        // HEIC/기타 — ftyp box 검사 (offset 4)
        if data.count > 12, data[4...7].elementsEqual([0x66, 0x74, 0x79, 0x70]) { return "image/heic" }
        return "image/jpeg"
    }
}
