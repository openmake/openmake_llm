"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("sidebar");
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <button
      type="button"
      aria-label={t("themeToggle")}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className={
        "inline-flex h-9 w-9 items-center justify-center rounded-md text-muted transition hover:bg-surface-2 hover:text-fg " +
        (className ?? "")
      }
    >
      {mounted && theme === "dark" ? (
        <Sun className="h-[18px] w-[18px]" />
      ) : (
        <Moon className="h-[18px] w-[18px]" />
      )}
    </button>
  );
}
