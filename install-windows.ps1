param(
  [string]$InstallDir = "$env:LOCALAPPDATA\Programs\Cisco Switch Console"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Version = (Get-Content -LiteralPath (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json).version
$SourceDir = Join-Path $ProjectRoot "dist\win-unpacked"
$Executable = Join-Path $SourceDir "Cisco Switch Console.exe"

if (-not (Test-Path -LiteralPath $Executable)) {
  throw "No se encontro la aplicacion construida. Ejecute primero: npm run dist:win:dir"
}

$ResolvedInstallParent = Resolve-Path -LiteralPath (Split-Path -Parent $InstallDir) -ErrorAction SilentlyContinue
if (-not $ResolvedInstallParent) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $InstallDir) -Force | Out-Null
}

if (Test-Path -LiteralPath $InstallDir) {
  Remove-Item -LiteralPath $InstallDir -Recurse -Force
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item -Path (Join-Path $SourceDir "*") -Destination $InstallDir -Recurse -Force

$StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Cisco Switch Console"
New-Item -ItemType Directory -Path $StartMenuDir -Force | Out-Null

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut((Join-Path $StartMenuDir "Cisco Switch Console.lnk"))
$Shortcut.TargetPath = Join-Path $InstallDir "Cisco Switch Console.exe"
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.Save()

$UninstallShortcut = $Shell.CreateShortcut((Join-Path $StartMenuDir "Desinstalar Cisco Switch Console.lnk"))
$UninstallShortcut.TargetPath = "powershell.exe"
$UninstallShortcut.Arguments = "-ExecutionPolicy Bypass -File `"$ProjectRoot\uninstall-windows.ps1`""
$UninstallShortcut.WorkingDirectory = $ProjectRoot
$UninstallShortcut.Save()

$UninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CiscoSwitchConsole"
New-Item -Path $UninstallKey -Force | Out-Null
New-ItemProperty -Path $UninstallKey -Name "DisplayName" -Value "Cisco Switch Console" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $UninstallKey -Name "DisplayVersion" -Value $Version -PropertyType String -Force | Out-Null
New-ItemProperty -Path $UninstallKey -Name "Publisher" -Value "JCV" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $UninstallKey -Name "InstallLocation" -Value $InstallDir -PropertyType String -Force | Out-Null
New-ItemProperty -Path $UninstallKey -Name "DisplayIcon" -Value (Join-Path $InstallDir "Cisco Switch Console.exe") -PropertyType String -Force | Out-Null
New-ItemProperty -Path $UninstallKey -Name "UninstallString" -Value "powershell.exe -ExecutionPolicy Bypass -File `"$ProjectRoot\uninstall-windows.ps1`"" -PropertyType String -Force | Out-Null

Write-Host "Cisco Switch Console $Version instalado en: $InstallDir"
Write-Host "Acceso directo creado en el menu Inicio."
