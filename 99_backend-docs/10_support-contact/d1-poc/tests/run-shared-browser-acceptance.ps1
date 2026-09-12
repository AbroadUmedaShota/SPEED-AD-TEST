param(
  [int]$Port = 8796
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$wrangler = Join-Path $project 'node_modules/wrangler/bin/wrangler.js'
$config = Join-Path $project 'wrangler.shared-browser.jsonc'
$temporary = Join-Path $env:TEMP ('contact-shared-browser-' + [Guid]::NewGuid().ToString('N'))
$persistence = Join-Path $temporary 'state'
$envFile = Join-Path $temporary 'browser.env'
$stdout = Join-Path $temporary 'wrangler.out.log'
$stderr = Join-Path $temporary 'wrangler.err.log'
$agentBrowser = (Get-Command agent-browser.cmd).Source
$agentBrowserExe = Join-Path (Split-Path $agentBrowser) 'node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
$session = 'contact-d1-shared-' + [Guid]::NewGuid().ToString('N')
$server = $null

function Invoke-AgentBrowser([string[]]$Arguments) {
  $output = & $agentBrowserExe --session $session @Arguments
  if ($LASTEXITCODE -ne 0) { throw "agent-browser failed: $($Arguments[0])" }
  return ($output | Out-String).Trim()
}

function Assert-Match([string]$Actual, [string]$Pattern, [string]$Message) {
  if ($Actual -notmatch $Pattern) { throw "$Message`nActual: $Actual" }
}

function Write-Step([string]$Message) {
  Write-Output "STEP $Message"
}

try {
  New-Item -ItemType Directory -Path $temporary -Force | Out-Null
  $authRaw = node --input-type=module -e @'
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
const pair = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(pair.publicKey), alg: 'RS256', kid: 'browser-key', use: 'sig' };
const now = Math.floor(Date.now() / 1000);
const token = await new SignJWT({ email: 'operator-one@example.invalid', type: 'app' })
  .setProtectedHeader({ alg: 'RS256', kid: 'browser-key' })
  .setIssuer('https://example.cloudflareaccess.com')
  .setAudience('shared-browser-local')
  .setIssuedAt(now).setNotBefore(now - 1).setExpirationTime(now + 1800)
  .sign(pair.privateKey);
console.log(JSON.stringify({ token, jwks: JSON.stringify({ keys: [jwk] }) }));
'@
  if ($LASTEXITCODE -ne 0) { throw 'test JWT generation failed' }
  $auth = $authRaw | ConvertFrom-Json
  [IO.File]::WriteAllText($envFile, "TEST_JWKS_JSON=$($auth.jwks)")

  $env:WRANGLER_SEND_METRICS = 'false'
  $env:WRANGLER_SEND_ERROR_REPORTS = 'false'
  & node $wrangler d1 migrations apply DB --local --persist-to $persistence --config $config | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'local D1 migration failed' }
  Write-Step 'local migrations applied'

  $arguments = @(
    $wrangler, 'dev', '--local', '--ip', '127.0.0.1', '--port', [string]$Port,
    '--persist-to', $persistence, '--config', $config, '--env-file', $envFile,
    '--show-interactive-dev-session=false'
  )
  $startProcess = @{
    FilePath = (Get-Command node).Source
    ArgumentList = $arguments
    WorkingDirectory = $project
    WindowStyle = 'Hidden'
    PassThru = $true
    RedirectStandardOutput = $stdout
    RedirectStandardError = $stderr
  }
  $server = Start-Process @startProcess

  $baseUrl = "http://127.0.0.1:$Port"
  $deadline = (Get-Date).AddSeconds(90)
  do {
    if ($server.HasExited) { throw "Wrangler exited before readiness: $(Get-Content $stderr -Raw)" }
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/session" -TimeoutSec 2 | Out-Null
      $ready = $true
    } catch {
      $ready = $_.Exception.Response.StatusCode.value__ -eq 403
    }
    if (-not $ready) { Start-Sleep -Milliseconds 200 }
  } while (-not $ready -and (Get-Date) -lt $deadline)
  if (-not $ready) {
    $startupLog = (Get-Content $stdout -Raw -ErrorAction SilentlyContinue) `
      + (Get-Content $stderr -Raw -ErrorAction SilentlyContinue)
    throw "Wrangler readiness timeout`n$startupLog"
  }
  Write-Step 'local Worker ready'

  # The first invocation must not use a PowerShell pipeline. The browser daemon
  # inherits that pipe and would keep the captured stream open after the client exits.
  & $agentBrowser --session $session open about:blank
  if ($LASTEXITCODE -ne 0) { throw 'agent-browser session startup failed' }
  Write-Step 'browser session opened'
  $headers = @{ 'cf-access-jwt-assertion' = $auth.token } | ConvertTo-Json -Compress
  Invoke-AgentBrowser @('set', 'headers', $headers) | Out-Null
  Invoke-AgentBrowser @('set', 'viewport', '1440', '900') | Out-Null
  Invoke-AgentBrowser @('open', "$baseUrl/") | Out-Null
  Invoke-AgentBrowser @('wait', '500') | Out-Null
  Write-Step 'desktop page loaded'

  Assert-Match (Invoke-AgentBrowser @('get', 'text', '#principal')) '担当者1' 'principal was not rendered'
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#actor-select')) '^0$' 'actor selector is present'
  Invoke-AgentBrowser @('click', '#cases button') | Out-Null
  Invoke-AgentBrowser @('wait', '300') | Out-Null
  Assert-Match (Invoke-AgentBrowser @('get', 'text', '#subject')) '共有版の合成問い合わせ' 'case detail was not rendered'

  Invoke-AgentBrowser @('click', '#attachments button') | Out-Null
  Invoke-AgentBrowser @('wait', '300') | Out-Null
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#attachments img')) '^1$' 'attachment preview failed'
  Write-Step 'list, detail, and attachment verified'

  Invoke-AgentBrowser @('click', '#actions button:nth-child(1)') | Out-Null
  Invoke-AgentBrowser @('eval', "document.querySelector('#action-form').requestSubmit(); 'submitted'") | Out-Null
  Invoke-AgentBrowser @('wait', '300') | Out-Null
  Invoke-AgentBrowser @('click', '#actions button:nth-child(2)') | Out-Null
  Invoke-AgentBrowser @('eval', "document.querySelector('#action-form').requestSubmit(); 'submitted'") | Out-Null
  Invoke-AgentBrowser @('wait', '300') | Out-Null

  Invoke-AgentBrowser @('click', '#actions button:nth-child(3)') | Out-Null
  Invoke-AgentBrowser @('fill', 'textarea[name="note"]', 'ACK欠落後の同一要求再送') | Out-Null
  Invoke-AgentBrowser @('eval', "document.querySelector('#action-form').requestSubmit(); 'submitted'") | Out-Null
  Invoke-AgentBrowser @('wait', '500') | Out-Null
  Assert-Match (Invoke-AgentBrowser @('get', 'text', '#message')) '保存結果を確認できませんでした' 'ACK-loss state was not shown'
  Invoke-AgentBrowser @('eval', "document.querySelector('#action-form').requestSubmit(); 'retried'") | Out-Null
  Invoke-AgentBrowser @('wait', '700') | Out-Null
  $events = Invoke-AgentBrowser @('get', 'text', '#events')
  if (([regex]::Matches($events, 'note_added')).Count -ne 1) { throw 'note event was not idempotent' }
  Write-Step 'ACK-loss retry verified'

  Invoke-AgentBrowser @('click', '#actions button:nth-child(3)') | Out-Null
  Invoke-AgentBrowser @('fill', 'textarea[name="note"]', '再読込後も保持する下書き') | Out-Null
  Invoke-AgentBrowser @('click', '#reload-detail') | Out-Null
  Invoke-AgentBrowser @('wait', '300') | Out-Null
  Invoke-AgentBrowser @('click', '#actions button:nth-child(3)') | Out-Null
  Assert-Match (Invoke-AgentBrowser @('get', 'value', 'textarea[name="note"]')) '再読込後も保持する下書き' 'draft was not retained'
  Write-Step 'draft retention verified'

  Invoke-AgentBrowser @('set', 'viewport', '390', '844') | Out-Null
  Assert-Match (Invoke-AgentBrowser @('eval', 'document.documentElement.scrollWidth <= 390')) 'true' 'mobile layout overflows horizontally'
  Write-Step '390px layout verified'

  Assert-Match (Invoke-AgentBrowser @('get', 'text', '#customer')) 'customer@example.invalid' 'customer detail was absent before auth rejection'
  Assert-Match (Invoke-AgentBrowser @('get', 'text', '#body')) 'ブラウザ受入用の合成データです。' 'message body was absent before auth rejection'
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#events li')) '^3$' 'expected history was absent before auth rejection'
  Invoke-AgentBrowser @('set', 'headers', '{"cf-access-jwt-assertion":"invalid"}') | Out-Null
  Invoke-AgentBrowser @('click', '#refresh') | Out-Null
  Invoke-AgentBrowser @('wait', '300') | Out-Null
  Assert-Match (Invoke-AgentBrowser @('get', 'text', '#principal')) 'アクセスできません' 'principal remained after auth rejection'
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#cases li')) '^0$' 'case list remained after auth rejection'
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#subject')) '^0$' 'subject remained after auth rejection'
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#customer')) '^0$' 'customer detail remained after auth rejection'
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#body')) '^0$' 'message body remained after auth rejection'
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#events')) '^0$' 'history remained after auth rejection'
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#detail img')) '^0$' 'attachment remained after auth rejection'
  $safeDetail = Invoke-AgentBrowser @('get', 'text', '#detail')
  Assert-Match $safeDetail '^セッションを確認できません。再ログイン後に再読み込みしてください。$' 'detail did not reduce to the safe session message'
  Write-Step 'authentication rejection verified'

  Stop-Process -Id $server.Id
  $server.WaitForExit()
  $server = $null
  $verificationSql = @'
SELECT c.assignee_email, c.status, c.version,
       group_concat(e.event_type || ':' || e.actor_email || ':' || e.from_version || '-' || e.to_version, ',') AS event_sequence
FROM contact_cases c
JOIN contact_case_events e ON e.case_id = c.case_id
WHERE c.case_id = 'case-mvp-1'
GROUP BY c.case_id;
'@
  $dbRaw = & node $wrangler d1 execute DB --local --persist-to $persistence --config $config --command $verificationSql --json
  if ($LASTEXITCODE -ne 0) { throw 'local D1 verification query failed' }
  $dbRows = @(($dbRaw | ConvertFrom-Json)[0].results)
  if ($dbRows.Count -ne 1) { throw 'local D1 verification row was missing' }
  $dbRow = $dbRows[0]
  $wrongCaseState = $dbRow.assignee_email -ne 'operator-one@example.invalid' `
    -or $dbRow.status -ne '対応中' `
    -or [int]$dbRow.version -ne 4
  if ($wrongCaseState) {
    throw 'assign/start/note case state did not persist'
  }
  $expectedEvents = 'assigned:operator-one@example.invalid:1-2,started:operator-one@example.invalid:2-3,note_added:operator-one@example.invalid:3-4'
  $orderedEvents = (($dbRow.event_sequence -split ',') | Sort-Object {
    [int]([regex]::Match($_, ':(\d+)-').Groups[1].Value)
  }) -join ','
  if ($orderedEvents -ne $expectedEvents) {
    throw 'assigned, started, and note_added history was not contiguous for the principal'
  }
  Write-Step 'D1 case state and contiguous actor history verified'
  $log = (Get-Content $stdout -Raw) + (Get-Content $stderr -Raw)
  Assert-Match $log 'POST /api/cases/.+/actions/note 503' 'ACK-loss response was not observed'
  Assert-Match $log 'POST /api/cases/.+/actions/note 200' 'receipt replay response was not observed'
  Assert-Match $log 'GET /api/cases 403' 'auth rejection was not observed'
  Write-Output 'PASS shared browser acceptance: desktop, 390px, JWT, local D1/R2, ACK retry, draft, auth clearing'
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
    $server.WaitForExit()
  }
  try { Invoke-AgentBrowser @('close') | Out-Null } catch {}
  node -e "require('fs').rmSync(process.argv[1],{recursive:true,force:true})" $temporary
}
