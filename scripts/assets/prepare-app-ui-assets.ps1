$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$archivePath = Join-Path $repositoryRoot 'assets\ui_pack\ccr-ui-assets.zip'
$destinationPath = Join-Path $repositoryRoot 'app\src\renderer\assets'
$markerPath = Join-Path $destinationPath '.asset-pack.sha256'

if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
  throw "Missing curated UI asset archive: $archivePath"
}

New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
$archiveStream = [System.IO.File]::OpenRead($archivePath)
try {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $archiveHash = [System.BitConverter]::ToString($sha256.ComputeHash($archiveStream)).Replace('-', '')
  } finally {
    $sha256.Dispose()
  }
} finally {
  $archiveStream.Dispose()
}
$existingHash = if (Test-Path -LiteralPath $markerPath -PathType Leaf) {
  (Get-Content -LiteralPath $markerPath -Raw).Trim()
} else {
  ''
}
$existingAssetCount = (Get-ChildItem -LiteralPath $destinationPath -Filter '*.webp' -File -Recurse).Count

if ($existingHash -eq $archiveHash -and $existingAssetCount -eq 2043) {
  Write-Output "Curated UI asset pack is already prepared ($existingAssetCount assets)."
  exit 0
}

Expand-Archive -LiteralPath $archivePath -DestinationPath $destinationPath -Force

$assetCount = (Get-ChildItem -LiteralPath $destinationPath -Filter '*.webp' -File -Recurse).Count
if ($assetCount -ne 2043) {
  throw "Expected 2,043 curated WebP assets after extraction; found $assetCount."
}

Set-Content -LiteralPath $markerPath -Value $archiveHash -Encoding ascii

Write-Output "Prepared $assetCount curated UI assets from $archivePath"
