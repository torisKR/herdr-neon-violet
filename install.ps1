# herdr-neon-violet installer for Windows.
# Backs up your current herdr config, installs the theme config, links the plugin,
# and adds the "Neon Violet" color scheme to Windows Terminal.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$cfgDir = Join-Path $env:APPDATA 'herdr'

if (-not (Get-Command herdr -ErrorAction SilentlyContinue)) { throw 'herdr is not installed: https://herdr.dev' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Warning 'node (18+) not found - the plugin panes need it' }

New-Item -ItemType Directory -Force $cfgDir | Out-Null
$cfg = Join-Path $cfgDir 'config.toml'
if (Test-Path $cfg) {
  $backup = "$cfg.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
  Copy-Item $cfg $backup
  "backed up existing config -> $backup"
}
Copy-Item (Join-Path $here 'config\config.toml') $cfg -Force
"installed config -> $cfg"

$ErrorActionPreference = 'Continue'
& herdr plugin link (Join-Path $here 'plugin') 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { 'linked plugin neon-violet' }
else { Write-Warning 'could not link the plugin (is herdr running as administrator?). Run in that terminal: herdr plugin link "<repo>\plugin"' }

$frag = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Terminal\Fragments\herdr-neon-violet'
New-Item -ItemType Directory -Force $frag | Out-Null
Copy-Item (Join-Path $here 'terminal\windows-terminal.json') (Join-Path $frag 'neon-violet.json') -Force
'added Windows Terminal color scheme "Neon Violet" (restart Windows Terminal, then pick it in Settings > Profile > Appearance)'

& herdr server reload-config 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { 'herdr is not running or not reachable from this terminal - press prefix+shift+r inside herdr to reload the config.' }
'done.'
