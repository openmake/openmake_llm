//! `omk-helper [--server <주소>] [--resolve]` — 얇은 진입점. 나머지는 lib.

fn main() {
    omk_helper::install_panic_hook();
    let argv: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    let code = omk_helper::run(&argv);
    std::process::exit(code);
}
