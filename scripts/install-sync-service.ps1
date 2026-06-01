# Instala o daemon sync-orcamentos.mjs como SERVICO Windows com AUTO-RESTART (NSSM).
# Rode como ADMINISTRADOR no PC do escritorio (o que tem a pasta Z: mapeada):
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-sync-service.ps1
#
# Pre-requisitos:
#   - Node.js instalado (node no PATH)
#   - NSSM (https://nssm.cc/download) -> nssm.exe no PATH ou na raiz do repo
#   - .env do daemon (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEST_BASE_PATH)
#     na RAIZ do repo (AppDirectory), do mesmo jeito que voce roda hoje na mao.
#
# Por que servico + auto-restart: hoje o daemon depende de alguem iniciar na mao
# e nao tem supervisao. Se cair (ou o PC reiniciar), orcamentos param de chegar
# no Z: silenciosamente. Como servico SERVICE_AUTO_START + AppExit Restart, ele
# sobe sozinho com o Windows e se auto-recupera se travar.

param(
  [string]$ServiceName = 'BranorteOrcamentosSync',
  [string]$RepoDir = (Resolve-Path "$PSScriptRoot\..").Path
)

$ErrorActionPreference = 'Stop'

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js nao encontrado no PATH. Instale o Node primeiro.' }

$script = Join-Path $RepoDir 'scripts\sync-orcamentos.mjs'
if (-not (Test-Path $script)) { throw "Nao achei o daemon em $script" }

$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm) { $nssm = Join-Path $RepoDir 'nssm.exe' }
if (-not (Test-Path $nssm)) {
  throw "NSSM nao encontrado. Baixe em https://nssm.cc/download e ponha nssm.exe na raiz do repo ($RepoDir) ou no PATH."
}

Write-Host "node:    $node"
Write-Host "daemon:  $script"
Write-Host "nssm:    $nssm"
Write-Host "appdir:  $RepoDir"
Write-Host ""

# ATENCAO: se o daemon ja roda como processo node solto, PARE-O antes (Task
# Manager / Stop-Process) pra nao ter dois daemons. Dois nao corrompem (o
# processFile e idempotente: SKIP se ja existe + move), mas geram trabalho dobrado.

# Idempotente: remove servico antigo se existir
& $nssm stop   $ServiceName 2>$null | Out-Null
& $nssm remove $ServiceName confirm 2>$null | Out-Null

# Instala
& $nssm install $ServiceName $node $script
& $nssm set $ServiceName AppDirectory $RepoDir
& $nssm set $ServiceName AppStdout (Join-Path $env:USERPROFILE 'branorte-sync.log')
& $nssm set $ServiceName AppStderr (Join-Path $env:USERPROFILE 'branorte-sync.log')
& $nssm set $ServiceName Start SERVICE_AUTO_START
& $nssm set $ServiceName AppExit Default Restart      # se o processo sair, reinicia
& $nssm set $ServiceName AppRestartDelay 5000         # espera 5s antes de reiniciar
& $nssm set $ServiceName AppThrottle 5000             # nao reinicia em loop < 5s
& $nssm start $ServiceName

Write-Host ""
Write-Host "OK: servico '$ServiceName' instalado e iniciado."
Write-Host "Confira a tabela sync_heartbeat: last_tick deve atualizar a cada ~30s (z_ok=true)."
Write-Host "Pra ver status:   nssm status $ServiceName"
Write-Host "Pra parar:        nssm stop $ServiceName"
Write-Host "Pra desinstalar:  nssm remove $ServiceName confirm"
