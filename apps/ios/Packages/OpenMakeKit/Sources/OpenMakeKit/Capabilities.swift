// OpenMakeKit — 멀티모달 capability 레지스트리(라벨·그룹). 서버 config/capabilities.ts 와
// 웹 settings/capability-groups.tsx 의 결정적 사본 — 서버는 capability **이름**만 내려주므로
// 사람이 읽는 라벨과 화면 그룹은 클라이언트가 가진다(웹과 같은 값을 유지할 것).
import Foundation

public enum CapabilityCatalog {
    /// capability id → 한국어 라벨 (서버 CAPABILITY_LABELS_KO 와 동일)
    public static let labels: [String: String] = [
        "text.reason": "텍스트 추론·분석",
        "text.code": "코드 작성·분석",
        "text.synthesize": "최종 답변 종합(채팅 모델)",
        "text.embed": "임베딩",
        "vision.describe": "이미지 이해·설명",
        "vision.ocr": "이미지 문자 인식(OCR)",
        "image.generate": "이미지 생성",
        "image.edit": "이미지 편집",
        "audio.transcribe": "음성 인식(STT)",
        "audio.speech": "음성 합성(TTS)",
        "audio.analyze": "오디오 분석",
        "music.analyze": "음악 분석",
        "music.generate": "음악 생성",
        "video.generate": "영상 생성",
        "video.analyze": "영상 이해",
        "web.search": "웹 검색",
    ]

    /// 검증된 provider 어댑터가 없는 capability — 배정과 무관하게 실행이 `unsupported` 로 끝난다
    public static let unsupported: Set<String> = [
        "audio.analyze", "music.analyze", "music.generate", "video.analyze",
    ]

    public static func label(_ capability: String) -> String {
        labels[capability] ?? capability
    }

    /// 진행 카드용 짧은 동작 문구 — "이미지 생성" → "이미지를 생성하고 있어요"
    public static func progressText(_ capability: String) -> String {
        switch capability {
        case "image.generate": return "이미지를 생성하고 있어요"
        case "image.edit": return "이미지를 편집하고 있어요"
        case "video.generate": return "영상을 생성하고 있어요 (몇 분 걸릴 수 있어요)"
        case "audio.speech": return "음성을 합성하고 있어요"
        case "audio.transcribe": return "음성을 텍스트로 옮기고 있어요"
        case "vision.describe", "vision.ocr": return "이미지를 분석하고 있어요"
        case "text.code": return "코드를 작성하고 있어요"
        case "text.reason": return "내용을 분석하고 있어요"
        default: return "\(label(capability)) 작업을 진행하고 있어요"
        }
    }

    /// 설정 화면 그룹 — 웹 CAPABILITY_GROUPS 와 동일한 구성·순서
    public struct Group: Identifiable, Equatable, Sendable {
        public let id: String
        public let title: String
        public let description: String
        public let members: [String]
        public let adminOnly: Bool

        /// 그룹 전원이 미지원이면 "현재 미지원" 배지 대상
        public var isUnsupported: Bool { members.allSatisfy { CapabilityCatalog.unsupported.contains($0) } }
    }

    public static let groups: [Group] = [
        Group(id: "text", title: "텍스트·비전", description: "추론·분석과 이미지 이해·OCR — 비전을 지원하는 텍스트 모델 하나가 맡습니다",
              members: ["text.reason", "vision.describe", "vision.ocr"], adminOnly: false),
        Group(id: "code", title: "코드", description: "코드 작성·수정 전용 모델(비우면 텍스트 모델이 처리)",
              members: ["text.code"], adminOnly: false),
        Group(id: "image", title: "이미지", description: "이미지 생성과 편집",
              members: ["image.generate", "image.edit"], adminOnly: false),
        Group(id: "audio", title: "음성", description: "음성 인식(STT)과 합성(TTS)",
              members: ["audio.transcribe", "audio.speech"], adminOnly: false),
        Group(id: "music", title: "음악", description: "음악 생성 — 아직 실행 경로가 없어 배정만 저장됩니다",
              members: ["music.generate"], adminOnly: false),
        Group(id: "video", title: "영상", description: "영상 생성(작업 제출 후 완료 시 결과 수령)",
              members: ["video.generate"], adminOnly: false),
        Group(id: "embed", title: "임베딩(인프라)", description: "검색·임베딩용 인프라 모델(관리자 전용)",
              members: ["text.embed"], adminOnly: true),
    ]

    /// 그룹 안에 남겨 두는 미지원 capability(배지로 표시) — 나머지 미지원은 숨긴다
    static let groupedUnsupported: Set<String> = ["music.generate"]

    /// 서버가 준 배정 가능 목록을 화면 그룹으로 나눈다. 웹 resolveCapabilityGroups 와 같은 규칙:
    /// 관리자 전용 그룹은 admin 이 아니면 제외, 미지원은 groupedUnsupported 만 남기고 숨김,
    /// 어느 그룹에도 없는 항목은 "기타" 그룹으로.
    public static func resolveGroups(assignable: [String], admin: Bool) -> (groups: [Group], hiddenUnsupported: [String]) {
        let assignableSet = Set(assignable)
        let visible: (String) -> Bool = { !unsupported.contains($0) || groupedUnsupported.contains($0) }
        var placed = Set<String>()
        var result: [Group] = []
        for def in groups {
            if def.adminOnly && !admin {
                def.members.forEach { placed.insert($0) }
                continue
            }
            let members = def.members.filter { assignableSet.contains($0) && visible($0) }
            def.members.forEach { placed.insert($0) }
            if !members.isEmpty {
                result.append(Group(id: def.id, title: def.title, description: def.description, members: members, adminOnly: def.adminOnly))
            }
        }
        let others = assignable.filter { !placed.contains($0) && visible($0) }
        if !others.isEmpty {
            result.append(Group(id: "other", title: "기타", description: "그룹에 속하지 않은 기능", members: others, adminOnly: false))
        }
        let hidden = assignable.filter { unsupported.contains($0) && !groupedUnsupported.contains($0) }
        return (result, hidden)
    }
}
