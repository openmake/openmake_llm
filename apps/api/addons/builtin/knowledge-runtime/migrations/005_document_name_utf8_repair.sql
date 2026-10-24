-- 이미 깨져 저장된 문서 이름 복구(2026-10-24) — 업로드 라우트가 multipart 파일명을 latin1 로 읽은 그대로 저장해
-- 한글 이름이 `ë²¤ì²˜…` 처럼 깨진 행을 UTF-8 로 되돌린다. 대상 열: knowledge_documents.logical_name,
-- knowledge_document_versions.original_filename.
-- 네임스페이스 addon:knowledge-runtime:005. 데이터만 고치고 스키마는 바꾸지 않는다. 멱등 — 복원된 이름에는
-- U+00FF 초과 문자가 생기므로 두 번째 적용에서는 대상에 걸리지 않는다(변경 0건).
-- 판별 규칙은 apps/api/src/utils/multipart-filename.ts(decodeMultipartFilename)와 같은 의미다 — 한쪽을 바꾸면 함께 바꾼다:
--   ① U+0080~U+00FF 문자가 있고 U+00FF 초과 문자는 없을 때만 시도한다(이미 UTF-8 인 한글·ASCII 는 건드리지 않는다)
--   ② latin1 바이트를 UTF-8 로 다시 읽는다 — 잘못된 UTF-8 바이트열(예: 정상 latin1 이름 `café`)이면 예외로 건너뛴다
--   ③ 결과에 U+FFFD 가 있으면 건너뛰고, 결과가 원본과 다를 때만 UPDATE 한다
-- 롤백: 별도 롤백 SQL 없음 — 복원된 이름을 되돌리면 수정 뒤 정상 업로드된 한글 이름까지 깨지는데 둘을 구분할 수 없다.
-- 코드만 되돌려도 동작한다(열·스키마 불변).

DO $$
DECLARE
    -- ① 대상 판별 — 패턴은 chr() 로 만든다(standard_conforming_strings 설정과 무관하게 같은 뜻)
    high_latin1 CONSTANT TEXT := '[' || chr(128) || '-' || chr(255) || ']';   -- U+0080~U+00FF 가 있다
    beyond_latin1 CONSTANT TEXT := '[^' || chr(1) || '-' || chr(255) || ']';  -- U+00FF 초과 문자가 있다
    replacement CONSTANT TEXT := chr(65533);                                  -- U+FFFD
    r RECORD;
    fixed TEXT;
    doc_count INTEGER := 0;
    ver_count INTEGER := 0;
BEGIN
    FOR r IN SELECT id, logical_name AS name FROM knowledge_documents
             WHERE logical_name ~ high_latin1 AND logical_name !~ beyond_latin1
    LOOP
        BEGIN
            fixed := convert_from(convert_to(r.name, 'LATIN1'), 'UTF8');  -- ②
        EXCEPTION WHEN OTHERS THEN
            fixed := NULL;  -- 잘못된 UTF-8 바이트열 — 원래 latin1 이름이다
        END;
        IF fixed IS NOT NULL AND position(replacement IN fixed) = 0 AND fixed <> r.name THEN  -- ③
            UPDATE knowledge_documents SET logical_name = fixed WHERE id = r.id;
            doc_count := doc_count + 1;
        END IF;
    END LOOP;

    FOR r IN SELECT id, original_filename AS name FROM knowledge_document_versions
             WHERE original_filename ~ high_latin1 AND original_filename !~ beyond_latin1
    LOOP
        BEGIN
            fixed := convert_from(convert_to(r.name, 'LATIN1'), 'UTF8');  -- ②
        EXCEPTION WHEN OTHERS THEN
            fixed := NULL;
        END;
        IF fixed IS NOT NULL AND position(replacement IN fixed) = 0 AND fixed <> r.name THEN  -- ③
            UPDATE knowledge_document_versions SET original_filename = fixed WHERE id = r.id;
            ver_count := ver_count + 1;
        END IF;
    END LOOP;

    RAISE NOTICE 'knowledge-runtime 005: logical_name % 건, original_filename % 건 복원', doc_count, ver_count;
END $$;
