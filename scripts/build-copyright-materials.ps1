$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
& node (Join-Path $repoRoot "scripts\build-copyright-materials.mjs")
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
