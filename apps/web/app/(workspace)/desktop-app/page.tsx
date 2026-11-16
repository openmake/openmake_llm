"use client";

import { useTranslations } from "next-intl";
import { PageHeader, PageBody } from "@/components/ui/primitives";
import { DeveloperTabs } from "@/components/hub-tabs";
import { DesktopAppDownloads } from "@/components/desktop-app/desktop-app-downloads";

/** 개발자 허브 — 데스크톱 앱(Companion) 내려받기 */
export default function DesktopAppPage() {
  const t = useTranslations("desktopApp");
  return (
    // 루트를 fragment 로 둬야 헤더·탭·본문이 <main>(flex flex-col) 의 직접 자식이 되어 PageBody 가 스크롤 영역이 된다.
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <DeveloperTabs />
      <PageBody className="space-y-5">
        <DesktopAppDownloads />
      </PageBody>
    </>
  );
}
