#!/usr/bin/env bash
# colima-boot-guard.cjs 시험 — 실제 node·/usr/bin/lockf·fs 로, 가짜 colima·sysctl(부팅 시각)·ps(프로세스 목록)와 임시 COLIMA_HOME 만 다룬다.
# 실제 VM·launchd·프로세스 신호는 쓰지 않는다. lockf 가 macOS 전용이라 macOS 에서만 돈다.
#   bash scripts/setup/colima-boot-guard.test.sh          (GUARD_NODE=<node> 로 다른 node 를 쓸 수 있다)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$(uname -s)" != Darwin ]] || [[ ! -x /usr/bin/lockf ]]; then echo "SKIP colima-boot-guard.test (macOS 전용)"; exit 0; fi
GNODE="${GUARD_NODE:-$(command -v node)}"
[[ -x "$GNODE" ]] || { echo "SKIP colima-boot-guard.test (node 없음)"; exit 0; }
GNODE="$("$GNODE" -p process.execPath)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
GUARD="$HERE/colima-boot-guard.cjs"

FB="$TMP/fakebin"; mkdir -p "$FB"
# colima: 받은 인자와 부모·조부모 명령을 기록하고 $TMP/colima-rc 로 끝난다
printf '#!/bin/sh\nprintf "%%s " "$@" > "%s/colima-called"\n/bin/ps -o command= -p $PPID > "%s/colima-parent"\n/bin/ps -o command= -p $(/bin/ps -o ppid= -p $PPID) >> "%s/colima-parent"\nexit $(cat "%s/colima-rc" 2>/dev/null || echo 0)\n' "$TMP" "$TMP" "$TMP" "$TMP" > "$FB/colima"
# sysctl: 부팅 시각은 $TMP/boot (초). $TMP/sysctl-hook 이 있으면 먼저 실행 (첫 스냅숏과 분류 사이에 파일을 바꾸는 시험)
printf '#!/bin/sh\n[ -f "%s/sysctl-hook" ] && sh "%s/sysctl-hook"\n[ "$2" = kern.boottime ] && printf "{ sec = %%s, usec = 0 } Wed Oct 21 06:12:33 2026\\n" "$(cat "%s/boot")"\n' "$TMP" "$TMP" "$TMP" > "$FB/sysctl"
# ps: 프로세스 목록은 $TMP/ps. $TMP/ps-hook 이 있으면 먼저 실행 (분류 뒤 정리 직전에 파일을 바꾸는 시험)
printf '#!/bin/sh\n[ -f "%s/ps-hook" ] && sh "%s/ps-hook"\ncat "%s/ps" 2>/dev/null\n' "$TMP" "$TMP" "$TMP" > "$FB/ps"
chmod +x "$FB/colima" "$FB/sysctl" "$FB/ps"
ME="$(id -u)"

PASS=0; FAIL=0
eq() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$3" "$2"; fi; }
ok() { if eval "$2"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s  (%s)\n' "$1" "$2"; fi; }

CH="$TMP/Ext & 'Colima'"; INST="$CH/_lima/colima-openmake"; OUT="$TMP/out"
LOCKDIR="$TMP/.local/share/openmake/.locks"; EXT="$CH/.openmake-boot-guard"
run_guard() { # $1=프로필 [시작 플래그…] → 종료 코드 (출력은 $OUT)
    local rc=0
    rm -f "$TMP/colima-called" "$TMP/colima-parent"
    env -i HOME="$TMP" PATH="$FB:/usr/bin:/bin:/usr/sbin:/sbin" COLIMA_HOME="$CH" "$GNODE" "$GUARD" "$FB/colima" "$@" > "$OUT" 2>&1 || rc=$?
    printf '%s' "$rc"
}
guard() { run_guard openmake "$@"; }
called() { cat "$TMP/colima-called" 2>/dev/null; }
now() { date +%s; }
stale_boot() { echo $(( $(now) + 1000 )) > "$TMP/boot"; }   # 지금 만든 파일 = 부팅 전 것
fresh_boot() { echo $(( $(now) - 1000 )) > "$TMP/boot"; }   # 지금 만든 파일 = 이번 부팅 것
pidfiles() { printf '1\n' > "$INST/vz.pid"; printf '%s\n' "$$" > "$INST/ha.pid"; }
q() { ls "$EXT/quarantine" 2>/dev/null; }
fingerprint() { (cd "$INST" && ls -li ha.pid vz.pid 2>/dev/null; cat ha.pid vz.pid 2>/dev/null); }
: > "$TMP/ps"

# ── 프로필·인스턴스가 없으면 아무것도 하지 않는다 (새 VM 없음) ──
stale_boot
eq "프로필 없음: 78" "$(guard)" "78"
eq "프로필 없음: colima 실행 안 함" "$(called)" ""
mkdir -p "$CH/openmake"; : > "$CH/openmake/colima.yaml"
eq "Lima 인스턴스 없음: 78" "$(guard)" "78"
eq "Lima 인스턴스 없음: colima 실행 안 함" "$(called)" ""
ok "Lima 인스턴스 없음: 이유" 'grep -q "no replacement VM" "$OUT"'
mkdir -p "$INST"; : > "$INST/lima.yaml"

# ── pid 파일이 없으면 그대로 기존 프로필을 띄운다 — 외장 볼륨에는 아무것도 쓰지 않는다 ──
eq "pid 파일 없음: 0" "$(guard)" "0"
eq "pid 파일 없음: 기존 프로필만" "$(called)" "start --profile openmake --activate=false "
ok "pid 파일 없음: 외장 볼륨에 쓰지 않음" '[[ ! -e "$EXT" ]]'
ok "pid 파일 없음: 잠금 디렉터리는 내장 HOME (lockf 가 끝나면 잠금 파일을 지운다)" '[[ -d "$LOCKDIR" && ! -e "$LOCKDIR/colima-openmake.lock" ]]'
eq "알려진 플래그 유지" "$(guard --save-config=false; called)" "0start --profile openmake --save-config=false --activate=false "
# 실행 사슬: node(가드) → lockf → 같은 node(가드) → colima. bash 부모 없음
P1="$(sed -n 1p "$TMP/colima-parent")"; P2="$(sed -n 2p "$TMP/colima-parent")"
eq "사슬: colima 의 부모는 같은 node 의 가드" "${P1%% *}|$([[ "$P1" == *"$GUARD"* ]] && echo guard)" "$GNODE|guard"
eq "사슬: 그 부모는 /usr/bin/lockf" "${P2%% *}" "/usr/bin/lockf"
ok "사슬: lockf 가 같은 node 로 가드를 실행" '[[ "$P2" == *" $GNODE $GUARD "* ]]'
echo 3 > "$TMP/colima-rc"
eq "colima 종료 코드를 그대로 돌려준다" "$(guard)" "3"
rm -f "$TMP/colima-rc"

# ── 부팅 전 pid 파일 (안의 PID 는 지금 살아 있는 다른 프로세스: 1·이 셸) → 보관 후 시작. 신호는 쓰지 않는다 ──
pidfiles; stale_boot; BEFORE_VZ="$(ls -i "$INST/vz.pid" | awk '{print $1}')"
eq "부팅 전 pid: 0" "$(guard)" "0"
eq "부팅 전 pid: 시작" "$(called)" "start --profile openmake --activate=false "
ok "부팅 전 pid: 인스턴스에서 치움" '[[ ! -e "$INST/vz.pid" && ! -e "$INST/ha.pid" ]]'
QD="$EXT/quarantine/$(q | head -1)"
eq "부팅 전 pid: 원본 보관 (같은 inode·내용)" "$(ls -i "$QD/vz.pid" | awk '{print $1}')|$(cat "$QD/vz.pid")" "$BEFORE_VZ|1"
eq "부팅 전 pid: 보관 파일 0600" "$(stat -f %Lp "$QD/vz.pid")|$(stat -f %Lp "$QD/ha.pid")|$(stat -f %Lp "$QD/evidence.txt")" "600|600|600"
ok "부팅 전 pid: 근거 기록 (부팅 시각·mtime·ctime)" 'grep -q "boottime=" "$QD/evidence.txt" && grep -q "vz.pid .*mtimeMs=.*ctimeMs=" "$QD/evidence.txt"'
ok "부팅 전 pid: 기록" 'grep -q "quarantined" "$OUT"'
ok "가드는 프로세스에 신호를 보내지 않는다 (kill 없음)" '! grep -qE "kill" "$GUARD"'
ok "가드는 colima stop·delete 를 부르지 않는다" '! grep -qE "'"'"'(stop|delete)'"'"'" "$GUARD"'

# ── 이번 부팅에 만들어진 pid 파일은 그대로 (colima 에 맡긴다) ──
rm -rf "$EXT"; pidfiles; fresh_boot; B="$(fingerprint)"
eq "이번 부팅 pid: 0" "$(guard)" "0"
eq "이번 부팅 pid: 그대로" "$(fingerprint)" "$B"
ok "이번 부팅 pid: 외장 볼륨에 쓰지 않음" '[[ ! -e "$EXT" ]]'
# mtime 만 옛날이고 ctime 이 이번 부팅이면 부팅 전 것으로 보지 않는다
touch -t 202001010000 "$INST/vz.pid"; echo $(( $(stat -f %c "$INST/vz.pid") - 1 )) > "$TMP/boot"
B="$(fingerprint)"
eq "mtime 만 옛날: 0" "$(guard)" "0"
eq "mtime 만 옛날: 그대로" "$(fingerprint)" "$B"
eq "mtime 만 옛날: 보관 없음" "$(q)" ""

# ── 이번 부팅의 전용 host agent 가 보이면 정리도 시작도 하지 않는다 ──
pidfiles; stale_boot; B="$(fingerprint)"
printf '%s /opt/homebrew/bin/limactl hostagent --pidfile %s/ha.pid colima-openmake\n' "$ME" "$INST" > "$TMP/ps"
eq "host agent 실행 중: 거부" "$(guard)" "75"
eq "host agent 실행 중: 파일 그대로" "$(fingerprint)" "$B"
eq "host agent 실행 중: colima 실행 안 함" "$(called)" ""
# 다른 사용자·다른 인스턴스의 프로세스는 증거가 아니다 (재사용된 PID 1067 = UID 247 distnoted)
printf '247 /usr/sbin/distnoted agent\n%s /opt/homebrew/bin/limactl hostagent --pidfile /x/ha.pid colima\n0 limactl hostagent colima-openmake\n' "$ME" > "$TMP/ps"
eq "무관한 프로세스: 0" "$(guard)" "0"
ok "무관한 프로세스: 정리됨" '[[ ! -e "$INST/vz.pid" ]]'
: > "$TMP/ps"

# ── 소유자·종류가 다르면 거부 ──
rm -rf "$EXT"; rm -f "$INST/ha.pid" "$INST/vz.pid"; stale_boot
if ln /private/etc/hosts "$INST/vz.pid" 2>/dev/null; then   # 실제 root 소유 일반 파일 (하드 링크)
    ROOTINO="$(stat -f %i /private/etc/hosts)"
    eq "다른 소유자(root): 거부" "$(guard)" "78"
    eq "다른 소유자(root): 그대로" "$(stat -f '%u %i' "$INST/vz.pid")" "0 $ROOTINO"
    eq "다른 소유자(root): colima 실행 안 함" "$(called)" ""
    ok "다른 소유자(root): 외장 볼륨에 쓰지 않음" '[[ ! -e "$EXT" ]]'
    rm -f "$INST/vz.pid"
else
    echo "SKIP 다른 소유자: 이 볼륨에서 root 파일 하드 링크 불가"
fi
ln -s "$TMP/elsewhere" "$INST/vz.pid"; printf '9\n' > "$TMP/elsewhere"
eq "심볼릭 링크 pid: 거부" "$(guard)" "78"
ok "심볼릭 링크 pid: 링크·대상 그대로" '[[ -L "$INST/vz.pid" && "$(cat "$TMP/elsewhere")" == 9 ]]'
eq "심볼릭 링크 pid: colima 실행 안 함" "$(called)" ""
rm -f "$INST/vz.pid" "$INST/ha.pid"
# 인스턴스 경로가 링크로 밖을 가리키면 거부
mv "$INST" "$TMP/real-inst"; ln -s "$TMP/real-inst" "$INST"; printf '1\n' > "$TMP/real-inst/vz.pid"
eq "인스턴스 링크: 거부" "$(guard)" "78"
ok "인스턴스 링크: 대상 파일 그대로" '[[ -f "$TMP/real-inst/vz.pid" ]]'
rm -f "$INST"; mv "$TMP/real-inst" "$INST"; rm -f "$INST/vz.pid"

# ── 분류 뒤 정리 직전에 파일이 바뀌면 정리하지 않는다 ──
pidfiles; stale_boot
printf 'printf "2\\n" >> "%s/vz.pid"\n' "$INST" > "$TMP/ps-hook"
eq "검사 후 변경: 거부" "$(guard)" "78"
ok "검사 후 변경: 파일 그대로 (바뀐 내용)" '[[ "$(cat "$INST/vz.pid")" == "$(printf "1\n2")" ]]'
eq "검사 후 변경: colima 실행 안 함" "$(called)" ""
ok "검사 후 변경: 이유" 'grep -q "changed" "$OUT"'
rm -f "$TMP/ps-hook"

# 분류 뒤 짝 파일(ha.pid)이 새로 생기면(이번 부팅 host agent 시작) 부팅 전 vz.pid 도 치우지 않는다
rm -f "$INST/vz.pid" "$INST/ha.pid"; printf '1\n' > "$INST/vz.pid"; stale_boot
printf '[ -e "%s/ha.pid" ] || printf "777\\n" > "%s/ha.pid"\n' "$INST" "$INST" > "$TMP/ps-hook"
eq "검사 후 짝 파일 생성: 거부" "$(guard)" "78"
ok "검사 후 짝 파일 생성: vz.pid 그대로" '[[ "$(cat "$INST/vz.pid")" == 1 ]]'
ok "검사 후 짝 파일 생성: 새 ha.pid 그대로" '[[ "$(cat "$INST/ha.pid")" == 777 ]]'
eq "검사 후 짝 파일 생성: colima 실행 안 함" "$(called)" ""
rm -f "$TMP/ps-hook" "$INST/vz.pid" "$INST/ha.pid"

# 첫 스냅숏과 분류 사이에 짝 파일이 생기거나(sysctl 호출 시점) 내용이 바뀌어도 받아들이지 않는다
for hook in companion change; do
    rm -rf "$EXT"; rm -f "$INST/ha.pid"; printf '1\n' > "$INST/vz.pid"; stale_boot
    VZ="$(ls -i "$INST/vz.pid")"
    if [[ $hook == companion ]]; then printf 'printf "888\\n" > "%s/ha.pid"\n' "$INST" > "$TMP/sysctl-hook"
    else printf '[ -e "%s/ha.pid" ] || printf "888\\n" > "%s/ha.pid"; touch -t 202001010000 "%s/ha.pid"\n' "$INST" "$INST" "$INST" > "$TMP/sysctl-hook"; fi
    guard >/dev/null
    eq "분류 전 $hook: vz.pid 그대로" "$(ls -i "$INST/vz.pid" 2>/dev/null)|$(cat "$INST/vz.pid" 2>/dev/null)" "$VZ|1"
    eq "분류 전 $hook: 새 ha.pid 그대로" "$(cat "$INST/ha.pid" 2>/dev/null)" "888"
    eq "분류 전 $hook: 보관 없음" "$(find "$EXT/quarantine" -name '*.pid' 2>/dev/null | wc -l | tr -d ' ')" "0"
done
rm -f "$TMP/sysctl-hook" "$INST/ha.pid" "$INST/vz.pid"

# ── 전용 프로필(openmake)만 — 다른 프로필·기본 프로필·경로는 잠금·상태도 만들지 않고 거부 ──
for bad in default colima ../openmake other; do
    rm -rf "$EXT" "$LOCKDIR"; mkdir -p "$CH/$bad"; : > "$CH/$bad/colima.yaml" 2>/dev/null
    eq "프로필 $bad: 거부" "$(run_guard "$bad")|$(called)" "78|"
    ok "프로필 $bad: 잠금·상태를 만들지 않음" '[[ ! -e "$EXT" && ! -e "$LOCKDIR" ]]'
done

# ── 가드는 한 번에 하나 — 다른 가드가 잠금을 쥐고 있으면 바로 끝낸다 ──
rm -rf "$EXT"; pidfiles; stale_boot; B="$(fingerprint)"
mkdir -p "$LOCKDIR"
/usr/bin/lockf -t 0 "$LOCKDIR/colima-openmake.lock" sleep 3 & HOLDER=$!
sleep 1
eq "동시 가드: 75" "$(guard)" "75"
eq "동시 가드: 파일 그대로" "$(fingerprint)" "$B"
eq "동시 가드: colima 실행 안 함" "$(called)" ""
wait "$HOLDER"
eq "잠금이 풀리면 진행" "$(guard)" "0"

printf '\ncolima-boot-guard.test: %d passed, %d failed (node %s)\n' "$PASS" "$FAIL" "$("$GNODE" -v)"
[[ $FAIL -eq 0 ]]
