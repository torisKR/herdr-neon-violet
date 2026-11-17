# herdr-neon-violet installer for Windows.
# Installs what applies to this machine: the terminal herdr config and plugin when `herdr`
# is installed, and the theme, layouts, mods and shortcuts when the Herdr desktop app is.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot

# 1. the nv binary (built with cargo when Rust is installed, otherwise downloaded)
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'plugin\fetch-bin.ps1')
if ($LASTEXITCODE -ne 0) { throw 'could not get the nv binary' }
$nv = Join-Path $here 'plugin\bin\nv.exe'

# 2. terminal herdr
if (Get-Command herdr -ErrorAction SilentlyContinue) {
  $cfgDir = Join-Path $env:APPDATA 'herdr'
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
  & herdr server reload-config 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { 'herdr is not running or not reachable from this terminal - press prefix+shift+r inside herdr to reload the config.' }
  $ErrorActionPreference = 'Stop'
}

$frag = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Terminal\Fragments\herdr-neon-violet'
New-Item -ItemType Directory -Force $frag | Out-Null
Copy-Item (Join-Path $here 'terminal\windows-terminal.json') (Join-Path $frag 'neon-violet.json') -Force
'added Windows Terminal color scheme "Neon Violet" (restart Windows Terminal, then pick it in Settings > Profile > Appearance)'

# 3. Herdr desktop app
$app = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $env:USERPROFILE '.config\herdr-app' }
if (Test-Path $app) {
  foreach ($d in 'themes','layouts','mods','bin') { New-Item -ItemType Directory -Force (Join-Path $app $d) | Out-Null }
  Copy-Item $nv (Join-Path $app 'bin\nv.exe') -Force
  Copy-Item (Join-Path $here 'app\themes\neon-violet.json') (Join-Path $app 'themes') -Force
  foreach ($l in 'all-agents','neon-violet') { Copy-Item (Join-Path $here "app\layouts\$l.json") (Join-Path $app 'layouts') -Force }
  foreach ($m in 'all-agents','devices','prs','todos','editor','nv-tabs','nv-new-menu','nv-files') { Copy-Item (Join-Path $here "app\mods\$m") (Join-Path $app 'mods') -Recurse -Force }
  & (Join-Path $app 'bin\nv.exe') merge-keys (Join-Path $app 'keys.json') (Join-Path $here 'app\keys.json')
  "installed Herdr app pack -> $app"
  '  layout: herdr-app do layout.switch --name neon-violet   (dark, translucent, with the to-do list)'
  '  ALL agents ctrl+shift+a · Devices ctrl+shift+d · Pull requests ctrl+shift+g · Browser ctrl+shift+u'
  '  to-do hooks for Claude Code and Codex: see the README ("To-do list")'
}
'done.'
