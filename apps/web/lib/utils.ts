import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind 클래스 병합 헬퍼 (shadcn 패턴). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
