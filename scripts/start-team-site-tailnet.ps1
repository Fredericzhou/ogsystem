$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$tailscale = (Get-Command tailscale -ErrorAction Stop).Source
$node = (Get-Command node -ErrorAction Stop).Source
$pnpm = (Get-Command pnpm -ErrorAction Stop).Source
$tailnetStatus = (& $tailscale status --json | ConvertFrom-Json)
if ($tailnetStatus.BackendState -ne "Running") {
  throw "Tailscale is not connected. Connect this device before starting the Tailnet services."
}
$tailnetIp = ((& $tailscale ip -4) | Select-Object -First 1).Trim()
$tailnetHost = ([string]$tailnetStatus.Self.DNSName).TrimEnd(".")
if (-not $tailnetIp -or -not $tailnetHost) {
  throw "Unable to read the Tailnet IPv4 address and HTTPS DNS name."
}

Push-Location $repoRoot
try {
  & $pnpm build
  if ($LASTEXITCODE -ne 0) { throw "Framework build failed with exit code $LASTEXITCODE." }

  $stateKey = $repoRoot.ToLowerInvariant() -replace "[^a-z0-9.-]", "_"
  $stateDir = Join-Path $env:LOCALAPPDATA "OGSystem\tailnet-$stateKey"
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
  $logDir = Join-Path $stateDir "logs"
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  # Keep the visualizer's business workspace outside the source repository.
  # The repository contains its own controlled paths and must never be treated
  # as the project a user is editing from the workbench.
  $frameworkWorkdir = Join-Path $env:LOCALAPPDATA "OGSystem\visualizer-workspace"
  New-Item -ItemType Directory -Path $frameworkWorkdir -Force | Out-Null

  foreach ($service in @(
    @{ Name = "team-site"; Port = 4174; Marker = "server.mjs" },
    @{ Name = "framework"; Port = 4177; Marker = "src/visualizer/cli.ts" }
  )) {
    $pidPath = Join-Path $stateDir "$($service.Name).pid.json"
    if (Test-Path $pidPath) {
      $managed = Get-Content $pidPath -Raw | ConvertFrom-Json
      $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($managed.Id)" -ErrorAction SilentlyContinue
      if ($process -and $process.ExecutablePath -eq $node -and $process.CommandLine.Contains($service.Marker)) {
        Stop-Process -Id $managed.Id -Force
        Wait-Process -Id $managed.Id -Timeout 5 -ErrorAction SilentlyContinue
      }
      Remove-Item $pidPath -Force
    }
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $service.Port -ErrorAction SilentlyContinue
    if ($listeners) {
      throw "Port $($service.Port) is already in use. Stop that listener before starting the managed services."
    }
  }

  $env:HOST = "0.0.0.0"
  $env:PORT = "4174"
  $env:OGS_VIS_URL = "https://$tailnetHost"
  $env:OGS_VIS_WORKDIR = $frameworkWorkdir
  $site = Start-Process -FilePath $node -ArgumentList @("server.mjs") -WorkingDirectory (Join-Path $repoRoot "apps/team-site") -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir "team-site.log") -RedirectStandardError (Join-Path $logDir "team-site.err.log")
  $framework = Start-Process -FilePath $node -ArgumentList @("node_modules/tsx/dist/cli.mjs", "src/visualizer/cli.ts", "--ogs-dir", $frameworkWorkdir, "--host", "127.0.0.1", "--port", "4177") -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir "framework.log") -RedirectStandardError (Join-Path $logDir "framework.err.log")

  @{ Id = $site.Id; StartedAt = $site.StartTime.ToUniversalTime().ToString("o") } | ConvertTo-Json | Set-Content -Encoding ascii (Join-Path $stateDir "team-site.pid.json")
  @{ Id = $framework.Id; StartedAt = $framework.StartTime.ToUniversalTime().ToString("o") } | ConvertTo-Json | Set-Content -Encoding ascii (Join-Path $stateDir "framework.pid.json")

  Start-Sleep -Seconds 2
  $siteProbe = & curl.exe -sS -o NUL -w "%{http_code}" --max-time 10 "http://127.0.0.1:4174/"
  $frameworkProbe = & curl.exe -sS -o NUL -w "%{http_code}" --max-time 10 "http://127.0.0.1:4177/"
  if ($siteProbe -ne "200" -or $frameworkProbe -ne "200") {
    throw "A service did not return HTTP 200. Inspect logs in $logDir."
  }

  $serveLog = Join-Path $logDir "tailscale-serve.log"
  $serveErrorLog = Join-Path $logDir "tailscale-serve.err.log"
  $serveProcess = Start-Process -FilePath $tailscale -ArgumentList @("serve", "--bg", "http://127.0.0.1:4177") -WindowStyle Hidden -PassThru -RedirectStandardOutput $serveLog -RedirectStandardError $serveErrorLog
  $serveCompleted = $serveProcess.WaitForExit(10000)
  if (-not $serveCompleted) { Stop-Process -Id $serveProcess.Id -Force -ErrorAction SilentlyContinue }
  $serveStatus = (& $tailscale serve status 2>$null | Out-String)
  $serveConfigured = ($serveCompleted -and $serveProcess.ExitCode -eq 0) -or ($serveStatus -match "proxy http://127\.0\.0\.1:4177")
  Write-Output "Team site: http://${tailnetIp}:4174/"
  if ($serveConfigured) {
    Write-Output "Framework: https://${tailnetHost}/"
  } else {
    Write-Warning "Framework is running locally at http://127.0.0.1:4177/. Enable Tailscale Serve in the admin console to publish https://${tailnetHost}/."
    if (Test-Path $serveErrorLog) { Get-Content $serveErrorLog }
    if (Test-Path $serveLog) { Get-Content $serveLog }
  }
  Write-Output "Logs: $logDir"
} finally {
  Pop-Location
}
