/**
 * 계약 버전 (설계 2026-10-16 3차 §3 C2).
 * major — 기존 add-on 이 깨지는 변경(필드 삭제·의미 변경), minor — 선택 필드·새 DTO 추가, patch — 주석·문서.
 *
 * @module plugin-contracts/version
 */
export const PLUGIN_CONTRACT_VERSION = '1.0.0' as const;
export type PluginContractVersion = typeof PLUGIN_CONTRACT_VERSION;
