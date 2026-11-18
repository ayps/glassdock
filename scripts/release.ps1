# Builds a signed GlassDock installer and the latest.json file that lets
# installed copies update themselves from GitHub Releases.
#
# Run from the project folder:   powershell -ExecutionPolicy Bypass -File scripts\release.ps1
# Then upload BOTH files it prints to a new GitHub release tagged v<version>.
#
# The first run creates your signing key in %USERPROFILE%\.tauri\. Keep that folder
# private and backed up: it never goes into the repository, and without it you
# can't publish updates that existing installs will accept.

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$keyDir = Join-Path $env:USERPROFILE ".tauri"
$key = Join-Path $keyDir "glassdock.key"
if (-not (Test-Path $key)) {
  New-Item -ItemType Directory -Force $keyDir | Out-Null
  Write-Host "First release: creating your update-signing key. You can leave the password empty." -ForegroundColor Cyan
  npm run tauri signer generate -- -w $key
  if (-not (Test-Path $key)) { throw "The signing key wasn't created." }
}

$version = (Get-Content "src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json).version
$pub = (Get-Content "$key.pub" -Raw).Trim()

# Release-only settings: sign the installer, and build the public key into the app.
$overlay = @{ bundle = @{ createUpdaterArtifacts = $true }; plugins = @{ updater = @{ pubkey = $pub } } } | ConvertTo-Json -Depth 6
$overlayPath = Join-Path $env:TEMP "glassdock-release.json"
[IO.File]::WriteAllText($overlayPath, $overlay)

$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $key -Raw
$sec = Read-Host "Signing key password (press Enter if you left it empty)" -AsSecureString
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))

npm run tauri build -- --config $overlayPath
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

$nsis = Resolve-Path "src-tauri\target\release\bundle\nsis"
$exe = "GlassDock_${version}_x64-setup.exe"
$sig = (Get-Content (Join-Path $nsis "$exe.sig") -Raw).Trim()
$latest = [ordered]@{
  version   = $version
  notes     = "GlassDock $version"
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = @{ "windows-x86_64" = @{ signature = $sig; url = "https://github.com/ayps/glassdock/releases/download/v$version/$exe" } }
} | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $nsis "latest.json"), $latest)

Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
Write-Host ""
Write-Host "Done. Upload these two files to a GitHub release tagged v$version :" -ForegroundColor Green
Write-Host "  $(Join-Path $nsis $exe)"
Write-Host "  $(Join-Path $nsis 'latest.json')"
