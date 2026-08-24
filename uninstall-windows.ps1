param(
  [string]$InstallDir = "$env:LOCALAPPDATA\Programs\Cisco Switch Console"
)

$ErrorActionPreference = "Stop"

$ExpectedParent = [System.IO.Path]::GetFullPath("$env:LOCALAPPDATA\Programs")
$ResolvedInstallDir = [System.IO.Path]::GetFullPath($InstallDir)

if (-not $ResolvedInstallDir.StartsWith($ExpectedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Ruta de desinstalacion fuera del perfil permitido: $ResolvedInstallDir"
}

if (Test-Path -LiteralPath $InstallDir) {
  Remove-Item -LiteralPath $InstallDir -Recurse -Force
}

$StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Cisco Switch Console"
if (Test-Path -LiteralPath $StartMenuDir) {
  Remove-Item -LiteralPath $StartMenuDir -Recurse -Force
}

$UninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CiscoSwitchConsole"
if (Test-Path -LiteralPath $UninstallKey) {
  Remove-Item -LiteralPath $UninstallKey -Recurse -Force
}

Write-Host "Cisco Switch Console desinstalado."
