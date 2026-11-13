//! 재연결 대기 시간 — TS `reconnectDelayMs`. 서버가 재시작하면 모든 기기가 같은 순간에 끊기므로, 구간 [d/2, d] 에서
//! 흩고(equal jitter) 실패가 이어지면 d 를 두 배씩 늘려 상한에서 멈춘다. 계산은 JS 와 같은 `f64` 다.

/// `attempt` 는 연속 실패 횟수(0 부터), `random` 은 [0, 1) 난수(범위 밖은 잘라 쓴다).
pub fn reconnect_delay_ms(attempt: u32, base_ms: u64, max_ms: u64, random: f64) -> u64 {
    let base = base_ms as f64;
    let cap = base.max(max_ms as f64);
    // 2^30 이후는 어차피 상한이다 — 넘침 방지.
    let exp = attempt.min(30) as i32;
    let d = cap.min(base * 2f64.powi(exp));
    // NaN 은 JS 에서 대기 1ms 가 되지만 Rust 는 1.0 으로 본다(주입은 테스트뿐 — D-49-6).
    let r = if random.is_nan() {
        1.0
    } else {
        random.clamp(0.0, 1.0)
    };
    js_round(d / 2.0 + (d / 2.0) * r) as u64
}

/// JS `Math.round` — `.5` 는 위로. `floor(x + 0.5)` 는 0.49999999999999994 에서 1 이 되어 쓰지 않는다.
fn js_round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 { f + 1.0 } else { f }
}

#[cfg(test)]
mod tests {
    use super::{js_round, reconnect_delay_ms};

    #[test]
    fn nan_random_is_treated_as_one() {
        assert_eq!(reconnect_delay_ms(0, 100, 1000, f64::NAN), 100);
    }

    #[test]
    fn js_round_half_up_without_float_trap() {
        assert_eq!(js_round(0.49999999999999994), 0.0);
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
    }
}
