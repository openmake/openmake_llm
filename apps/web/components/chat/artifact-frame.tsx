"use client";

import { useTranslations } from "next-intl";

/**
 * 아티팩트 라이브 렌더용 샌드박스 iframe.
 *
 * 🔒 sandbox="allow-scripts" 만 부여하고 allow-same-origin 은 **절대** 부여하지 않는다.
 *    → iframe 은 null(opaque) origin 으로 격리되어 앱 쿠키/localStorage/부모 DOM 에
 *      접근할 수 없다. (둘을 동시에 주면 샌드박스가 무력화되어 세션 탈취가 가능해진다.)
 */
export function ArtifactFrame({ srcDoc, title }: { srcDoc: string; title?: string }) {
  const t = useTranslations("artifacts");
  return (
    <iframe
      title={title ?? t("framePreviewTitle")}
      sandbox="allow-scripts allow-popups allow-modals"
      srcDoc={srcDoc}
      className="h-full w-full border-0 bg-white"
      referrerPolicy="no-referrer"
    />
  );
}
