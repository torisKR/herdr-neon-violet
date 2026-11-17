# Puts the nv binary at bin\nv.exe: builds it when cargo is installed,
# otherwise downloads the build attached to the latest GitHub release.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force bin | Out-Null

if (Get-Command cargo -ErrorAction SilentlyContinue) {
  & cargo build --release
  if ($LASTEXITCODE -ne 0) { throw 'cargo build failed' }
  Copy-Item target\release\nv.exe bin\nv.exe -Force
  'built bin\nv.exe with cargo'
  exit 0
}

$asset = 'nv-x86_64-pc-windows-msvc.exe'
$url = "https://github.com/torisKR/herdr-neon-violet/releases/latest/download/$asset"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $url -OutFile bin\nv.exe -UseBasicParsing
"downloaded bin\nv.exe ($asset)"
