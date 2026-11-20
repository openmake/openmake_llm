//! `omk-ffi` 정적 라이브러리에서 Swift 소스·헤더·modulemap 을 만든다(`apps/desktop-native/lib/ffi.sh` 가 부른다).

fn main() {
    uniffi::uniffi_bindgen_swift();
}
