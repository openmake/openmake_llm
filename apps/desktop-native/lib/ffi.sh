#!/bin/bash
# shellcheck shell=bash
# omk-ffi 정적 라이브러리 → Swift 바인딩·XCFramework (PR-3.2 D-230). build.sh·CI 가 부르는 단일 진입점.
# 사용: bash apps/desktop-native/lib/ffi.sh   (실행하면 생성, source 하면 함수만 — lib/ffi.test.mjs 가 가짜 cargo·xcodebuild 로 시험한다)
# 결과(커밋하지 않는다, .gitignore): apps/desktop-native/OpenMakeCompanion/Generated/
#   OmkFfiCore.xcframework   — libomk_ffi.a + 헤더·module.modulemap(모듈 omk_ffiFFI)
#   OmkFfi/omk_ffi.swift     — UniFFI 가 만든 Swift 소스(SwiftPM 타깃 OmkFfi)
# 사전: Rust 툴체인(apps/openmake-code/rust-toolchain.toml), Xcode(xcodebuild).

# Rust 오브젝트의 최소 macOS — Package.swift 의 platforms `.macOS(.v14)` 와 같은 값(다르면 링크 때 "built for newer macOS" 경고).
FFI_MACOS_MIN="14.0"
# Swift 링커가 늘 넣는 시스템 라이브러리 — linkerSettings 대조에서 뺀다.
FFI_DEFAULT_LIBS=" System c m "

# native-static-libs 줄의 `-framework X`·`-lY` 가 Package.swift 의 .linkedFramework("X")·.linkedLibrary("Y") 로 다 있는지.
# 의존 갱신으로 목록이 바뀌면 링크 오류 대신 원인을 바로 보인다.
ffi_check_linker_settings() {
  local nsl="$1" pkg="$2" missing="" prev="" tok
  for tok in $nsl; do
    if [[ "$prev" == "-framework" ]]; then
      grep -qF ".linkedFramework(\"$tok\")" "$pkg" || missing="$missing .linkedFramework(\"$tok\")"
    elif [[ "$tok" == -l* ]]; then
      local name="${tok#-l}"
      if [[ "$FFI_DEFAULT_LIBS" != *" $name "* ]]; then
        grep -qF ".linkedLibrary(\"$name\")" "$pkg" || missing="$missing .linkedLibrary(\"$name\")"
      fi
    fi
    prev="$tok"
  done
  if [[ -n "$missing" ]]; then
    echo "Package.swift 의 OmkFfi linkerSettings 에 없음:$missing (native-static-libs: $nsl)" >&2
    return 1
  fi
}

# ffi_generate <Rust 워크스페이스> <Generated 폴더> <Package.swift>
# 임시 폴더에 다 만든 뒤 Generated 를 통째로 바꾼다 — 중간에 실패하면 기존 Generated 는 그대로다.
ffi_generate() {
  local rust="$1" out="$2" pkg="$3"
  local target="${CARGO_TARGET_DIR:-$rust/target}"
  local lib="$target/release/libomk_ffi.a"
  local tmp
  mkdir -p "$(dirname "$out")"
  tmp="$(mktemp -d "$out.tmp.XXXXXX")" || return 1
  # native-static-libs 는 rustc 가 실제로 돌 때만 찍힌다 — 이 크레이트만 지우고(의존은 캐시 그대로) 다시 컴파일한다.
  (cd "$rust" && cargo clean --release -p omk-ffi) >"$tmp/cargo-clean.log" 2>&1 \
    || { cat "$tmp/cargo-clean.log" >&2; rm -rf "$tmp"; return 1; }
  if ! (cd "$rust" && MACOSX_DEPLOYMENT_TARGET="$FFI_MACOS_MIN" \
      cargo rustc --release --locked -p omk-ffi --lib -- --print native-static-libs) 2>"$tmp/cargo.log"; then
    tail -n 30 "$tmp/cargo.log" >&2; rm -rf "$tmp"; return 1
  fi
  local nsl
  nsl="$(sed -n 's/.*native-static-libs: //p' "$tmp/cargo.log" | tail -n 1)"
  [[ -n "$nsl" && -f "$lib" ]] || { echo "omk-ffi 정적 라이브러리·native-static-libs 를 얻지 못함: $lib" >&2; rm -rf "$tmp"; return 1; }
  ffi_check_linker_settings "$nsl" "$pkg" || { rm -rf "$tmp"; return 1; }
  # 생성기는 디버그 빌드로 충분하다(생성 결과는 같다, D-235(r2)). 모듈 이름 omk_ffiFFI 는 생성 Swift 의 `canImport(omk_ffiFFI)` 와 맞춘다.
  if ! (cd "$rust" && cargo run --locked -q -p omk-ffi-bindgen -- --swift-sources "$lib" "$tmp/swift" \
      && cargo run --locked -q -p omk-ffi-bindgen -- --headers --modulemap --module-name omk_ffiFFI \
        --modulemap-filename module.modulemap "$lib" "$tmp/headers"); then
    echo "Swift 바인딩 생성 실패" >&2; rm -rf "$tmp"; return 1
  fi
  mkdir -p "$tmp/out/OmkFfi" && cp "$tmp/swift/omk_ffi.swift" "$tmp/out/OmkFfi/" || { rm -rf "$tmp"; return 1; }
  if ! xcodebuild -create-xcframework -library "$lib" -headers "$tmp/headers" \
      -output "$tmp/out/OmkFfiCore.xcframework" >"$tmp/xcodebuild.log" 2>&1; then
    cat "$tmp/xcodebuild.log" >&2; rm -rf "$tmp"; return 1
  fi
  rm -rf "$out.old"
  if [[ -e "$out" ]]; then mv "$out" "$out.old" || { rm -rf "$tmp"; return 1; }; fi
  mv "$tmp/out" "$out" && rm -rf "$out.old" "$tmp"
}

ffi_main() {
  local here root
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  root="$(cd "$here/../../.." && pwd)"
  command -v cargo >/dev/null || { echo "Rust 툴체인이 없습니다 — rustup 설치 뒤 다시(판은 apps/openmake-code/rust-toolchain.toml)" >&2; return 1; }
  command -v xcodebuild >/dev/null || { echo "xcodebuild 가 없습니다 — Xcode 설치 필요" >&2; return 1; }
  ffi_generate "$root/apps/openmake-code" "$here/../OpenMakeCompanion/Generated" "$here/../OpenMakeCompanion/Package.swift"
  echo "omk-ffi 바인딩 생성 완료: apps/desktop-native/OpenMakeCompanion/Generated"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  ffi_main
fi
