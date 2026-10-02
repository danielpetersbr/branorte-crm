[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ExtensionDirectory,
  [string]$KeyPath = "$env:USERPROFILE/.branorte-vps/vps_ed25519",
  [string]$KnownHostsPath = "$env:USERPROFILE/.branorte-vps/known_hosts",
  [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath $ExtensionDirectory).Path
$target = '/opt/branorte/ext-ana'
$remote = 'root@179.236.225.16'
$sshArgs = @('-i', $KeyPath, '-o', "UserKnownHostsFile=$KnownHostsPath", '-o', 'StrictHostKeyChecking=yes', '-o', 'BatchMode=yes')
$baseline = [ordered]@{
  'background.js' = '544c8c55924dc153004252d28da09435f8468e5929494c88ad1f48631ccace6a'
  'bsb-detect-chat.js' = 'ed65bd0b92b2d6ed1c9efcf3399ee6263e5bda04462c48d192635f0c47a56735'
  'manifest.json' = 'ea36bcf10005bbe25641192d4601a716fd66800541562a6b44b3a217ba8b7f0c'
  'painel-worker.js' = '27211abda0de6bea8fc85c2b413b5d02690f58dd7e5d52050bf0c00cc1b22d17'
}
$approved = [ordered]@{
  'background.js' = '58e487888a6f1f88c3141f72b1d384d5ae5cbb5c7a8001c4cd133b05c3ed10bc'
  'bsb-detect-chat.js' = '96b12a5a865067a5857b3a773e41dc9b30921963ca91d597fd59a46e6f77a088'
  'manifest.json' = '25a4b13694f2ac8b57ff7c9a0eda5db15b97d50a28f612e86e5e01f67e240e0e'
  'painel-worker.js' = '315860b149a688899aee4ca85837a8b6cfa12913b1bfe93c4e6014862d8be215'
}
foreach ($file in $approved.Keys) {
  $source = Join-Path $taskRoot $file
  if (!(Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing source: $file" }
  $actual = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $approved[$file]) { throw "Unreviewed source hash: $file" }
}
$manifest = Get-Content -LiteralPath (Join-Path $taskRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne '1.70.29') { throw 'Unexpected manifest version' }
foreach ($file in @('background.js', 'bsb-detect-chat.js', 'painel-worker.js')) {
  $source = Get-Content -LiteralPath (Join-Path $taskRoot $file) -Raw
  $versionPattern = if ($file -eq 'bsb-detect-chat.js') { "var AGENTE_V = '1.70.29'" } else { "const BG_VERSAO = '1.70.29'" }
  if (!$source.Contains($versionPattern)) { throw "Version mismatch: $file" }
  & "$env:ProgramFiles/nodejs/node.exe" --check (Join-Path $taskRoot $file)
  if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $file" }
}
function Invoke-RemoteScript([string]$Script) {
  # PowerShell's text pipe adds CRLF; remove CR before Bash parses the script.
  $result = $Script | & ssh @sshArgs $remote "tr -d '\r' | bash -s"
  if ($LASTEXITCODE -ne 0) { throw 'Remote verification/deployment failed; stop and inspect the backup before retrying.' }
  return $result
}
$preflight = @'
set -eu
target='/opt/branorte/ext-ana'
test "$(readlink -f "$target")" = "$target"
for file in background.js bsb-detect-chat.js painel-worker.js manifest.json; do
  test -f "$target/$file" && test ! -L "$target/$file"
done
sha256sum "$target/background.js" "$target/bsb-detect-chat.js" "$target/painel-worker.js" "$target/manifest.json"
'@
$lines = @(Invoke-RemoteScript $preflight)
if ($lines.Count -ne 4) { throw 'Unexpected remote hash inventory' }
foreach ($line in $lines) {
  if ($line -notmatch '^([a-f0-9]{64})\s+/opt/branorte/ext-ana/([^/]+)$') { throw 'Unexpected remote hash line' }
  $hash = $Matches[1]; $file = $Matches[2]
  if (!$baseline.Contains($file) -or $baseline[$file] -ne $hash) { throw "Remote baseline changed: $file" }
}
if ($ValidateOnly) { Write-Output 'Validated reviewed files, syntax and remote baseline; no remote changes.'; return }
$tag = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$stage = "/opt/branorte/staging/crm-media-1.70.29-$tag"
$backup = "/opt/branorte/backups/crm-media-1.70.29-$tag"
Invoke-RemoteScript "set -eu`ntest ! -e '$stage'`ninstall -d -m 700 '$stage'" | Out-Null
foreach ($file in $approved.Keys) {
  & scp @sshArgs (Join-Path $taskRoot $file) "${remote}:${stage}/$file"
  if ($LASTEXITCODE -ne 0) { throw "Staging upload failed: $file" }
}
$publish = @'
set -eu
umask 077
target='/opt/branorte/ext-ana'
stage='__STAGE__'
backup='__BACKUP__'
test "$(readlink -f "$target")" = "$target"
case "$stage" in /opt/branorte/staging/crm-media-1.70.29-*) ;; *) exit 1;; esac
case "$backup" in /opt/branorte/backups/crm-media-1.70.29-*) ;; *) exit 1;; esac
test ! -e "$backup"
check() {
  test -f "$1" && test ! -L "$1"
  actual=$(sha256sum "$1" | cut -d ' ' -f 1)
  if [ "$actual" != "$2" ]; then echo "Hash mismatch: $1" >&2; exit 1; fi
}
check "$target/background.js" '__OLD_BG__'
check "$target/bsb-detect-chat.js" '__OLD_AGENT__'
check "$target/manifest.json" '__OLD_MANIFEST__'
check "$target/painel-worker.js" '__OLD_WORKER__'
check "$stage/background.js" '__NEW_BG__'
check "$stage/bsb-detect-chat.js" '__NEW_AGENT__'
check "$stage/manifest.json" '__NEW_MANIFEST__'
check "$stage/painel-worker.js" '__NEW_WORKER__'
install -d -m 700 "$backup"
for file in background.js bsb-detect-chat.js painel-worker.js manifest.json; do
  cp --preserve=mode,ownership,timestamps "$target/$file" "$backup/$file"
  stat -c '%a %u %g %n' "$target/$file" >> "$backup/metadata.txt"
  chown 0:0 "$backup/$file"
  chmod 600 "$backup/$file"
done
check "$backup/background.js" '__OLD_BG__'
check "$backup/bsb-detect-chat.js" '__OLD_AGENT__'
check "$backup/manifest.json" '__OLD_MANIFEST__'
check "$backup/painel-worker.js" '__OLD_WORKER__'
publish() {
  file="$1"
  check "$target/$file" "$2"
  tmp="$target/.crm-media-1.70.29-$file.tmp"
  test ! -e "$tmp"
  cp "$stage/$file" "$tmp"
  chmod --reference="$target/$file" "$tmp"
  chown --reference="$target/$file" "$tmp"
  check "$tmp" "$3"
  mv -T "$tmp" "$target/$file"
  check "$target/$file" "$3"
}
publish background.js '__OLD_BG__' '__NEW_BG__'
publish bsb-detect-chat.js '__OLD_AGENT__' '__NEW_AGENT__'
publish painel-worker.js '__OLD_WORKER__' '__NEW_WORKER__'
publish manifest.json '__OLD_MANIFEST__' '__NEW_MANIFEST__'
sha256sum "$target/background.js" "$target/bsb-detect-chat.js" "$target/painel-worker.js" "$target/manifest.json"
printf 'BACKUP=%s\n' "$backup"
'@
$publish = $publish.Replace('__STAGE__', $stage).Replace('__BACKUP__', $backup)
$publish = $publish.Replace('__OLD_BG__', $baseline['background.js']).Replace('__OLD_AGENT__', $baseline['bsb-detect-chat.js']).Replace('__OLD_MANIFEST__', $baseline['manifest.json'])
$publish = $publish.Replace('__NEW_BG__', $approved['background.js']).Replace('__NEW_AGENT__', $approved['bsb-detect-chat.js']).Replace('__NEW_MANIFEST__', $approved['manifest.json'])
$publish = $publish.Replace('__OLD_WORKER__', $baseline['painel-worker.js']).Replace('__NEW_WORKER__', $approved['painel-worker.js'])
Invoke-RemoteScript $publish
