<#
.SYNOPSIS
  omk — Windows 부트스트랩. WSL2(Ubuntu)를 준비하고 그 안에서 omk.sh 를 실행한다.

.DESCRIPTION
  OpenMake 의 설치기(install.sh / openmake_llm.sh / omk.sh)는 bash 다. Windows 에서는 WSL2 안에서
  Linux 와 100% 같은 코드로 돈다 — 이 스크립트는 그 입구만 만든다:
    1) WSL2 + Ubuntu 배포판 확인 (없으면 `wsl --install -d Ubuntu` 안내 — 재부팅 필요)
    2) Docker Desktop(WSL2 백엔드) 확인 — WSL 안에서 `docker` 가 보여야 한다
    3) WSL 안에서 omk.sh 를 받아 같은 인자로 실행

.EXAMPLE
  # PowerShell
  irm https://raw.githubusercontent.com/openmake/openmake_llm/main/scripts/env/omk.ps1 -OutFile omk.ps1
  .\omk.ps1 env install staging --public-url https://chat-staging.example.com
  .\omk.ps1 env status staging

.NOTES
  환경변수: OMK_DISTRO(기본 Ubuntu)  OMK_REF(omk.sh 를 받을 브랜치, 기본 main)  OMK_RAW_BASE(원본 URL 베이스)
#>
$ErrorActionPreference = 'Stop'

$Distro  = if ($env:OMK_DISTRO)   { $env:OMK_DISTRO }   else { 'Ubuntu' }
$Ref     = if ($env:OMK_REF)      { $env:OMK_REF }      else { 'main' }
$RawBase = if ($env:OMK_RAW_BASE) { $env:OMK_RAW_BASE } else { 'https://raw.githubusercontent.com/openmake/openmake_llm' }
$OmkUrl  = "$RawBase/$Ref/scripts/env/omk.sh"

function Fail($msg) { Write-Host "[ERR]   $msg" -ForegroundColor Red; exit 1 }
function Info($msg) { Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "[OK]    $msg" -ForegroundColor Green }

# 1) WSL2 + 배포판
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    Fail "WSL 이 없습니다 — 관리자 PowerShell 에서 'wsl --install -d $Distro' 실행 후 재부팅하고 다시 시도하세요."
}
# wsl -l 출력은 UTF-16 이라 널 문자를 걷어내야 비교가 된다.
$distros = (wsl.exe -l -q 2>$null) -replace "`0", '' | Where-Object { $_.Trim() -ne '' }
if (-not ($distros | Where-Object { $_.Trim() -eq $Distro })) {
    Fail "WSL 배포판 '$Distro' 이 없습니다 — 'wsl --install -d $Distro' 실행(재부팅 필요할 수 있음) 후 다시 시도하세요. 다른 배포판은 OMK_DISTRO 로 지정."
}
Ok "WSL 배포판: $Distro"

# 2) Docker — WSL 안에서 보이는지 (Docker Desktop → Settings → Resources → WSL integration)
wsl.exe -d $Distro -- bash -lc "command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1"
if ($LASTEXITCODE -ne 0) {
    Info "WSL 안에서 docker 가 동작하지 않습니다 — install.sh 가 Linux 용 Docker 설치를 시도합니다."
    Info "Docker Desktop 을 쓴다면: 설치 후 Settings → Resources → WSL integration 에서 '$Distro' 를 켜세요."
}

# 3) WSL 안에서 omk.sh 실행 — 인자는 그대로 전달 (작은따옴표 이스케이프)
$quoted = ($args | ForEach-Object { "'" + ($_ -replace "'", "'\''") + "'" }) -join ' '
Info "WSL($Distro) 안에서 실행: omk $($args -join ' ')"
wsl.exe -d $Distro -- bash -lc "curl -fsSL '$OmkUrl' | bash -s -- $quoted"
exit $LASTEXITCODE
