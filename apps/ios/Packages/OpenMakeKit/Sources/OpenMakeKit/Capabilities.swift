// OpenMakeKit — 멀티모달 capability 라벨(진행 카드용)과 모델 배정 슬롯 라벨.
// 서버는 capability·슬롯 **이름**만 내려주므로 사람이 읽는 라벨은 클라이언트가 가진다
// (서버 config/capabilities.ts·config/model-slots.ts, 웹 messages modelAssignments 와 같은 값을 유지할 것).
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
}

/// 모델 배정 슬롯 라벨·그룹 — 웹 messages `modelAssignments.slots`·`groups` 와 같은 값
public enum ModelSlotCatalog {
    public static let groupOrder = ["agents", "quality", "multimodal"]

    public static let groupTitles: [String: String] = [
        "agents": "대화·에이전트",
        "quality": "검증·요약·코드",
        "multimodal": "계획·미디어",
    ]

    public static let groupDescriptions: [String: String] = [
        "agents": "대화와 에이전트 작업을 수행하는 텍스트 모델",
        "quality": "판정·요약·코드 작업에 쓰는 텍스트 모델",
        "multimodal": "계획 수립과 이미지·음성·영상 등 미디어 처리 모델",
    ]

    /// 슬롯 id → (제목, 설명)
    public static let slots: [String: (title: String, description: String)] = [
        "agent": ("에이전트 작업", "백그라운드 에이전트 작업의 실행 모델"),
        "spawn": ("병렬 서브에이전트", "병렬로 분기되는 서브에이전트 모델"),
        "reasoning": ("추론·딥리서치", "딥리서치 파이프라인·보고서와 복잡한 추론에 쓰는 모델"),
        "judge": ("목표 판정", "에이전트 작업 완료 여부를 판정하는 모델"),
        "code": ("코드·리뷰", "코드 작성·수정, 코드·보안 리뷰, 구현 계획에 쓰는 모델"),
        "summary": ("생각 요약", "생각 과정 헤드라인을 생성하는 모델"),
        "planner": ("Planner(질문 분석·계획)", "매 턴 1회 짧은 JSON 계획을 만드는 모델 — 작고 빠른 모델 권장"),
        "vision.describe": ("이미지 이해", "이미지 내용을 설명·분석하는 비전 모델"),
        "vision.ocr": ("OCR", "이미지 속 텍스트를 인식하는 모델"),
        "image.generate": ("이미지 생성", "텍스트로 이미지를 생성하는 모델"),
        "image.edit": ("이미지 편집", "기존 이미지를 편집하는 모델"),
        "audio.transcribe": ("음성 인식(STT)", "음성을 텍스트로 옮기는 모델"),
        "audio.speech": ("음성 합성(TTS)", "텍스트를 음성으로 합성하는 모델"),
        "audio.analyze": ("오디오 분석", "오디오 내용을 분석하는 모델"),
        "music.generate": ("음악 생성", "노래·배경음악을 생성하는 모델(기본값은 로컬 ACE-Step)"),
        "music.analyze": ("음악 분석", "음악을 분석하는 모델"),
        "video.generate": ("영상 생성", "영상을 생성하는 모델(작업 제출 후 완료 시 결과 수령)"),
        "video.analyze": ("영상 이해", "영상 내용을 분석하는 모델"),
        "text.embed": ("임베딩", "검색·임베딩용 인프라 모델"),
    ]

    public static func title(_ slot: String) -> String { slots[slot]?.title ?? slot }
    public static func description(_ slot: String) -> String { slots[slot]?.description ?? "" }
    public static func groupTitle(_ group: String) -> String { groupTitles[group] ?? group }
}
