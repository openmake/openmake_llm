#!/bin/bash
# ==============================================================================
# OpenMake Colima 로그인 기동 가드 — LaunchAgent com.openmake.colima 가 실행한다 (30-toolchain.sh 가 설치·등록).
# 저장소가 외장 디스크일 수 있어 ~/.local/share/openmake 에 복사돼 실행된다 — 다른 파일을 읽지 않는다. macOS bash 3.2.
#
#   colima-boot-guard.sh <colima> <profile> [시작 플래그…]     (환경: COLIMA_HOME)
#
# 1) 기존 프로필(<COLIMA_HOME>/<profile>/colima.yaml)과 기존 Lima 인스턴스(<COLIMA_HOME>/_lima/colima-<profile>)가 없으면
#    시작하지 않는다 — 새 VM 을 만들지 않는다.
# 2) 이 프로필의 가드는 한 번에 하나만 돈다 (lockf).
# 3) 지난 부팅의 비정상 종료가 남긴 ha.pid·vz.pid 만 치운다: 이 인스턴스 디렉터리 안의, 실행한 사용자 소유의
#    일반 파일(링크 아님)이고 mtime 과 ctime 이 모두 지금 부팅 시각(kern.boottime)보다 앞설 때.
#    파일 속 PID 는 보지 않는다 — 재부팅 뒤 그 번호는 무관한 프로세스일 수 있다. 신호를 보내지 않는다.
#    이번 부팅의 이 인스턴스 host agent 가 보이면 치우지도 시작하지도 않는다.
#    치우기 직전에 종류·소유자·inode·mtime·ctime·내용을 다시 보고 다르면 멈춘다. 원본은 지우지 않고 보관한다(0600).
# 4) 기존 프로필을 평소대로 시작한다: colima start --profile <profile> [플래그] --activate=false
# 하지 않는 일: 프로세스 신호·강제 정지·VM/디스크/설정 변경·다른 프로필(기본 colima 등) 접근.
#
# 종료 코드: colima start 의 것 / 75 다른 가드 실행 중·이 인스턴스 host agent 실행 중 / 78 없음·거부
# ==============================================================================
set -u

log() { printf '%s colima-boot-guard: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; }
refuse() { log "error: $1; not starting, nothing was removed (VM left untouched)"; exit "${2:-78}"; }

[ $# -ge 2 ] || refuse "usage: colima-boot-guard.sh <colima> <profile> [start flags...]"
[ -n "${COLIMA_HOME:-}" ] || refuse "COLIMA_HOME is not set"
COLIMA="$1"; PROFILE="$2"
# 전용 프로필만 — 기본 프로필(colima)·다른 프로필·경로는 잠금·상태도 만들지 않고 거부한다.
[ "$PROFILE" = openmake ] || refuse "only the dedicated OpenMake profile 'openmake' is handled (got '$PROFILE'); other profiles are left untouched"
if [ ! -f "$COLIMA_HOME/$PROFILE/colima.yaml" ]; then
    echo "OpenMake Colima profile $PROFILE is missing under $COLIMA_HOME; not starting (no replacement VM)" >&2
    exit 78
fi

STATE="$COLIMA_HOME/.openmake-boot-guard"
if [ "${OMK_COLIMA_GUARD_LOCKED:-}" != "$PROFILE" ]; then
    [ ! -L "$STATE" ] || refuse "$STATE is a symlink"
    mkdir -p "$STATE" && chmod 700 "$STATE" || refuse "cannot create $STATE"
    # 잠금을 쥔 채로 다시 실행한다 — 이미 쥐고 있으면 lockf 가 75 로 끝난다.
    OMK_COLIMA_GUARD_LOCKED="$PROFILE" exec /usr/bin/lockf -t 0 "$STATE/$PROFILE.lock" /bin/bash "$0" "$@"
fi
unset OMK_COLIMA_GUARD_LOCKED

LIMA="$COLIMA_HOME/_lima"; INST="$LIMA/colima-$PROFILE"
for d in "$LIMA" "$INST"; do
    [ ! -L "$d" ] || refuse "$d is a symlink"
    [ -d "$d" ] || refuse "Lima instance $INST is missing (no replacement VM)"
done
[ -f "$INST/lima.yaml" ] && [ ! -L "$INST/lima.yaml" ] || refuse "Lima instance $INST has no lima.yaml (no replacement VM)"

BOOT="$(sysctl -n kern.boottime 2>/dev/null | sed -n 's/^{ sec = \([0-9][0-9]*\),.*/\1/p')"
[ -n "$BOOT" ] || refuse "cannot read kern.boottime"
ME="$(id -u)"

meta() { stat -f '%HT|%u|%i|%m|%c' "$1" 2>/dev/null; }
content() { cksum < "$1" 2>/dev/null; }
# 두 pid 파일의 지금 모습 (없음 포함) — 정리 직전 비교용
snapshot() {
    local n f
    for n in ha.pid vz.pid; do
        f="$INST/$n"
        if [ -e "$f" ] || [ -L "$f" ]; then printf '%s|%s|%s\n' "$n" "$(meta "$f")" "$(content "$f")"; else printf '%s|absent\n' "$n"; fi
    done
}

# 분류 전에 두 파일의 모습을 잡아 둔다 — 분류 뒤·옮기기 직전마다 이것과 같아야 한다 (처음에 없던 짝 파일 포함).
INITIAL="$(snapshot)"
# 부팅 전 파일 목록: "이름<TAB>meta<TAB>내용"
STALE=""; CURRENT=0
for n in ha.pid vz.pid; do
    f="$INST/$n"
    [ -e "$f" ] || [ -L "$f" ] || continue
    m="$(meta "$f")" || refuse "cannot stat $f"
    IFS='|' read -r type uid ino mt ct <<EOF
$m
EOF
    [ "$type" = "Regular File" ] || refuse "$f is not a regular file ($type)"
    [ "$uid" = "$ME" ] || refuse "$f is owned by uid $uid, not $ME"
    if [ "$mt" -lt "$BOOT" ] && [ "$ct" -lt "$BOOT" ]; then
        STALE="$STALE$n	$m	$(content "$f")
"
    else
        CURRENT=1; log "$f is from the current boot (mtime $mt, ctime $ct, boot $BOOT); left for colima"
    fi
done

if [ -n "$STALE" ] && [ "$CURRENT" -eq 0 ]; then
    [ "$(snapshot)" = "$INITIAL" ] || refuse "$INST pid files changed while they were being checked"
    # 이번 부팅의 이 인스턴스 host agent·driver 가 보이면 부팅 전 파일이라도 손대지 않는다.
    if ps -axo uid=,command= 2>/dev/null | awk -v u="$ME" -v i="colima-$PROFILE" '
        $1 == u && /(limactl|hostagent)/ { for (k = 2; k <= NF; k++) if ($k == i || $k ~ ("/" i "/")) { found = 1 } }
        END { exit found ? 0 : 1 }'; then
        refuse "a host agent for colima-$PROFILE is running in this boot but its pid files predate the boot" 75
    fi
    Q="$STATE/quarantine/colima-$PROFILE-boot$BOOT-$(date +%Y%m%d%H%M%S)-$$"
    (umask 077; mkdir -p "$Q") || refuse "cannot create $Q"
    [ "$(stat -f %d "$Q")" = "$(stat -f %d "$INST")" ] || refuse "$Q is on another volume than $INST (rename would not be atomic)"
    printf 'boottime=%s user=%s instance=%s\n' "$BOOT" "$ME" "$INST" > "$Q/evidence.txt" && chmod 600 "$Q/evidence.txt" || refuse "cannot write $Q/evidence.txt"
    printf '%s' "$STALE" | while IFS='	' read -r n m c; do
        IFS='|' read -r type uid ino mt ct <<EOF
$m
EOF
        printf '%s type=%s uid=%s inode=%s mtime=%s ctime=%s cksum=%s\n' "$n" "$type" "$uid" "$ino" "$mt" "$ct" "$c" >> "$Q/evidence.txt"
    done
    printf '%s' "$STALE" | { expected="$INITIAL"; while IFS='	' read -r n m c; do
        f="$INST/$n"
        # 바로 직전에 두 파일을 모두 다시 본다 — 처음에 없던 짝 파일이 생겼거나(이번 부팅 host agent)
        # 어느 쪽이든 바뀌었으면 치우지 않는다. 이미 옮긴 파일은 없어야 한다.
        if [ -L "$f" ] || [ "$(meta "$f")" != "$m" ] || [ "$(content "$f")" != "$c" ] || [ "$(snapshot)" != "$expected" ]; then
            log "error: $INST pid files changed after they were checked; not starting, left as is (evidence in $Q)"; exit 78
        fi
        mv "$f" "$Q/$n" && chmod 600 "$Q/$n" || { log "error: could not move $f to $Q"; exit 78; }
        log "quarantined stale $f from before boot $BOOT to $Q/$n (metadata in $Q/evidence.txt)"
        expected="$(printf '%s\n' "$expected" | sed "s/^$n|.*/$n|absent/")"
    done; } || exit 78
fi

shift 2
exec "$COLIMA" start --profile "$PROFILE" "$@" --activate=false
