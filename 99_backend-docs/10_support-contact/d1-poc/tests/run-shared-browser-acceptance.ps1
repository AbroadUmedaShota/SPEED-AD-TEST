param(
  [int]$Port = 0
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
$stage = 'initialization'

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

function Set-Stage([string]$Name) {
  $script:stage = $Name
  Write-Step $Name
}

function Get-LoopbackPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Test-LoopbackListener([int]$TargetPort) {
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $connection = $client.ConnectAsync([Net.IPAddress]::Loopback, $TargetPort)
    return $connection.Wait(500) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Wait-ForListResult([int]$ExpectedCount, [string]$ExpectedPage) {
  $condition = "document.querySelectorAll('#cases button').length === $ExpectedCount && document.querySelector('#page-number').textContent === '$ExpectedPage'"
  try {
    Invoke-AgentBrowser @('wait', '--fn', $condition) | Out-Null
  } catch {
    $listMessage = Invoke-AgentBrowser @('get', 'text', '#message')
    $actualCount = Invoke-AgentBrowser @('get', 'count', '#cases button')
    $actualPage = Invoke-AgentBrowser @('get', 'text', '#page-number')
    $apiRequests = Invoke-AgentBrowser @('network', 'requests', '--filter', '/api/cases')
    throw "list result did not settle at count=$ExpectedCount page=$ExpectedPage; actualCount=$actualCount actualPage=$actualPage message=$listMessage requests=$apiRequests"
  }
}

function Reset-ListFilters {
  $script = "(() => { const q = document.querySelector('#search'); q.value = ''; document.querySelector('#status-filter').value = ''; document.querySelector('#assignee-filter').value = ''; document.querySelector('#priority-filter').value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); return 'reset'; })()"
  Invoke-AgentBrowser @('eval', $script) | Out-Null
}

function Assert-ListCount([int]$Expected, [string]$Message) {
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#cases button')) "^$Expected$" $Message
}

function Click-Action([string]$Label) {
  $labelLiteral = ConvertTo-Json $Label -Compress
  $condition = "[...document.querySelectorAll('#actions button')].some(item => item.textContent === $labelLiteral)"
  $script = "(() => { const expected = $labelLiteral; const button = [...document.querySelectorAll('#actions button')].find(item => item.textContent === expected); if (!button) throw new Error('action not found'); button.click(); return 'clicked'; })()"
  try {
    Invoke-AgentBrowser @('wait', '--fn', $condition) | Out-Null
    Invoke-AgentBrowser @('eval', $script) | Out-Null
  } catch {
    $visible = try {
      Invoke-AgentBrowser @('eval', "[...document.querySelectorAll('#actions button')].map(item => item.textContent)")
    } catch {
      '[unable to read action labels]'
    }
    throw "action '$Label' was not available; visible synthetic action labels: $visible"
  }
}

function Test-ListAcceptance([int]$Width, [int]$Height) {
  Invoke-AgentBrowser @('set', 'viewport', [string]$Width, [string]$Height) | Out-Null
  Reset-ListFilters
  Wait-ForListResult 50 '1ページ'
  Assert-ListCount 50 "$Width px initial page did not contain 50 cases"
  Assert-Match (Invoke-AgentBrowser @('get', 'text', '#page-number')) '^1ページ$' "$Width px initial page number was wrong"
  Assert-Match (Invoke-AgentBrowser @('eval', "document.querySelector('#next-page').disabled")) '^false$' "$Width px next button was disabled"

  Invoke-AgentBrowser @('eval', "document.querySelector('#next-page').click(); 'clicked'") | Out-Null
  Wait-ForListResult 5 '2ページ'
  Assert-ListCount 5 "$Width px final page did not contain 5 cases"
  Assert-Match (Invoke-AgentBrowser @('get', 'text', '#page-number')) '^2ページ$' "$Width px final page number was wrong"
  Assert-Match (Invoke-AgentBrowser @('eval', "document.querySelector('#next-page').disabled")) '^true$' "$Width px final-page next button remained enabled"
  Invoke-AgentBrowser @('eval', "document.querySelector('#previous-page').click(); 'clicked'") | Out-Null
  Wait-ForListResult 50 '1ページ'
  Assert-ListCount 50 "$Width px previous-page navigation failed"

  Invoke-AgentBrowser @('eval', "document.querySelector('#next-page').click(); 'clicked'") | Out-Null
  Wait-ForListResult 5 '2ページ'
  $raceScript = "(() => { const q = document.querySelector('#search'); const next = document.querySelector('#next-page'); q.value = '一覧検索 054'; q.dispatchEvent(new Event('input', { bubbles: true })); const disabled = next.disabled; next.click(); return { disabled, page: document.querySelector('#page-number').textContent }; })()"
  $raceState = Invoke-AgentBrowser @('eval', $raceScript)
  Assert-Match $raceState '"disabled": true' "$Width px search retained the old next-page cursor"
  Assert-Match $raceState '"page": "0ページ"' "$Width px search did not synchronously reset the page"
  Wait-ForListResult 1 '1ページ'
  Assert-ListCount 1 "$Width px server search did not return the unique synthetic case"
  if ((Invoke-AgentBrowser @('get', 'text', '#message')) -match 'invalid_cursor|一覧を取得できませんでした') {
    throw "$Width px search reused an old cursor"
  }

  Reset-ListFilters
  Invoke-AgentBrowser @('select', '#status-filter', '保留') | Out-Null
  Wait-ForListResult 9 '1ページ'
  Assert-ListCount 9 "$Width px status filter returned the wrong count"
  Reset-ListFilters
  Invoke-AgentBrowser @('select', '#assignee-filter', 'unassigned') | Out-Null
  Wait-ForListResult 19 '1ページ'
  Assert-ListCount 19 "$Width px unassigned filter returned the wrong count"
  Reset-ListFilters
  Invoke-AgentBrowser @('select', '#assignee-filter', 'self') | Out-Null
  Wait-ForListResult 18 '1ページ'
  Assert-ListCount 18 "$Width px self filter returned the wrong count"
  Reset-ListFilters
  Invoke-AgentBrowser @('select', '#priority-filter', 'high') | Out-Null
  Wait-ForListResult 18 '1ページ'
  Assert-ListCount 18 "$Width px priority filter returned the wrong count"

  Invoke-AgentBrowser @('fill', '#search', '該当なしの検索値') | Out-Null
  Wait-ForListResult 0 '0ページ'
  Assert-ListCount 0 "$Width px zero-result search was not empty"
  Assert-Match (Invoke-AgentBrowser @('get', 'text', '#page-number')) '^0ページ$' "$Width px zero-result page number was wrong"
  Assert-Match (Invoke-AgentBrowser @('eval', "document.querySelector('#next-page').disabled")) '^true$' "$Width px zero-result next button remained enabled"
  Reset-ListFilters
  Wait-ForListResult 50 '1ページ'
  if ($Width -eq 390) {
    Assert-Match (Invoke-AgentBrowser @('eval', 'document.documentElement.scrollWidth <= 390')) '^true$' 'mobile layout overflows horizontally'
  }
  Write-Step "$Width px list pagination, search, and filters verified"
}

try {
  New-Item -ItemType Directory -Path $temporary -Force | Out-Null
  if ($Port -eq 0) { $Port = Get-LoopbackPort }
  $env:WRANGLER_SEND_METRICS = 'false'
  $env:WRANGLER_SEND_ERROR_REPORTS = 'false'

  Set-Stage 'build'
  $buildOutput = Join-Path $temporary 'build'
  & node $wrangler deploy --dry-run --config $config --outdir $buildOutput | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'local Worker dry-run build failed' }

  Set-Stage 'migration'
  & node $wrangler d1 migrations apply DB --local --persist-to $persistence --config $config | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'local D1 migration failed' }

  Set-Stage 'JWT'
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

  Set-Stage 'process'
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

  Set-Stage 'listen'
  $baseUrl = "http://127.0.0.1:$Port"
  $deadline = (Get-Date).AddSeconds(90)
  do {
    if ($server.HasExited) { throw 'Wrangler exited before opening its loopback listener' }
    $ready = Test-LoopbackListener $Port
    if (-not $ready) { Start-Sleep -Milliseconds 100 }
  } while (-not $ready -and (Get-Date) -lt $deadline)
  if (-not $ready) {
    throw 'Wrangler loopback listener readiness timeout'
  }
  Write-Step "loopback listener ready on port $Port"

  # The first invocation must not use a PowerShell pipeline. The browser daemon
  # inherits that pipe and would keep the captured stream open after the client exits.
  Set-Stage 'browser'
  & $agentBrowser --session $session open about:blank
  if ($LASTEXITCODE -ne 0) { throw 'agent-browser session startup failed' }
  Write-Step 'browser session opened'
  $headers = @{ 'cf-access-jwt-assertion' = $auth.token } | ConvertTo-Json -Compress
  Invoke-AgentBrowser @('set', 'headers', $headers) | Out-Null
  Invoke-AgentBrowser @('set', 'viewport', '1440', '900') | Out-Null
  Set-Stage 'bootstrap'
  Invoke-AgentBrowser @('open', "$baseUrl/") | Out-Null
  Invoke-AgentBrowser @('wait', '--fn', "document.querySelector('#principal')?.textContent.includes('担当者1')") | Out-Null
  Assert-Match (Invoke-AgentBrowser @('get', 'text', '#principal')) '担当者1' 'authenticated bootstrap did not complete'
  Write-Step 'authenticated browser bootstrap completed'

  Set-Stage 'browser'

  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#actor-select')) '^0$' 'actor selector is present'
  Test-ListAcceptance 1440 900
  Test-ListAcceptance 390 844
  $pageErrors = Invoke-AgentBrowser @('errors')
  if (-not [string]::IsNullOrWhiteSpace($pageErrors)) {
    throw "browser console/page errors were recorded: $pageErrors"
  }
  Write-Step 'browser console verified without errors'

  Invoke-AgentBrowser @('click', 'button[data-case-id="case-mvp-1"]') | Out-Null
  Invoke-AgentBrowser @('wait', '--fn', "document.querySelector('#subject')?.textContent === '共有版の合成問い合わせ'") | Out-Null
  Assert-Match (Invoke-AgentBrowser @('get', 'text', '#subject')) '共有版の合成問い合わせ' 'case detail was not rendered'

  Invoke-AgentBrowser @('eval', "document.querySelector('#attachments button').click(); 'clicked'") | Out-Null
  Invoke-AgentBrowser @('wait', '--fn', "document.querySelectorAll('#attachments img').length === 1") | Out-Null
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#attachments img')) '^1$' 'attachment preview failed'
  Write-Step 'list, detail, and attachment verified'

  Click-Action '自分を担当にする'
  Invoke-AgentBrowser @('eval', "document.querySelector('#action-form').requestSubmit(); 'submitted'") | Out-Null
  Click-Action '対応を始める'
  Invoke-AgentBrowser @('eval', "document.querySelector('#action-form').requestSubmit(); 'submitted'") | Out-Null

  $started = "document.querySelector('#status')?.textContent === '対応中' && [...document.querySelectorAll('#actions button')].some(item => item.textContent === 'メモを残す')"
  Invoke-AgentBrowser @('wait', '--fn', $started) | Out-Null
  Click-Action 'メモを残す'
  Invoke-AgentBrowser @('fill', 'textarea[name="note"]', 'ACK欠落後の同一要求再送') | Out-Null
  Invoke-AgentBrowser @('eval', "document.querySelector('#action-form').requestSubmit(); 'submitted'") | Out-Null
  Invoke-AgentBrowser @('wait', '--fn', "document.querySelector('#message')?.textContent.includes('保存結果を確認できませんでした')") | Out-Null
  Assert-Match (Invoke-AgentBrowser @('get', 'text', '#message')) '保存結果を確認できませんでした' 'ACK-loss state was not shown'
  Invoke-AgentBrowser @('eval', "document.querySelector('#action-form').requestSubmit(); 'retried'") | Out-Null
  Invoke-AgentBrowser @('wait', '--fn', "document.querySelector('#message')?.textContent.includes('保存しました。') && ([...document.querySelectorAll('#events li')].filter(item => item.textContent.includes('note_added')).length === 1)") | Out-Null
  $events = Invoke-AgentBrowser @('get', 'text', '#events')
  if (([regex]::Matches($events, 'note_added')).Count -ne 1) { throw 'note event was not idempotent' }
  Write-Step 'ACK-loss retry verified'

  Click-Action 'メモを残す'
  Invoke-AgentBrowser @('fill', 'textarea[name="note"]', '再読込後も保持する下書き') | Out-Null
  Invoke-AgentBrowser @('eval', "document.querySelector('#reload-detail').click(); 'clicked'") | Out-Null
  Click-Action 'メモを残す'
  $draftRetained = 'document.querySelector(''textarea[name="note"]'')?.value === ''再読込後も保持する下書き'''
  Invoke-AgentBrowser @('wait', '--fn', $draftRetained) | Out-Null
  Assert-Match (Invoke-AgentBrowser @('get', 'value', 'textarea[name="note"]')) '再読込後も保持する下書き' 'draft was not retained'
  Write-Step 'draft retention verified'

  Assert-Match (Invoke-AgentBrowser @('get', 'text', '#customer')) 'customer@example.invalid' 'customer detail was absent before auth rejection'
  Assert-Match (Invoke-AgentBrowser @('get', 'text', '#body')) 'ブラウザ受入用の合成データです。' 'message body was absent before auth rejection'
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#events li')) '^3$' 'expected history was absent before auth rejection'
  Invoke-AgentBrowser @('set', 'headers', '{"cf-access-jwt-assertion":"invalid"}') | Out-Null
  Invoke-AgentBrowser @('eval', "document.querySelector('#refresh').click(); 'clicked'") | Out-Null
  $authCleared = "document.querySelector('#principal')?.textContent === 'アクセスできません' && document.querySelectorAll('#cases li').length === 0 && !document.querySelector('#subject') && !document.querySelector('#customer') && !document.querySelector('#body') && !document.querySelector('#events') && document.querySelectorAll('#detail img').length === 0 && document.querySelector('#detail')?.textContent === 'セッションを確認できません。再ログイン後に再読み込みしてください。'"
  Invoke-AgentBrowser @('wait', '--fn', $authCleared) | Out-Null
  Assert-Match (Invoke-AgentBrowser @('get', 'text', '#principal')) 'アクセスできません' 'principal remained after auth rejection'
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#cases li')) '^0$' 'case list remained after auth rejection'
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#subject')) '^0$' 'subject remained after auth rejection'
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#customer')) '^0$' 'customer detail remained after auth rejection'
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#body')) '^0$' 'message body remained after auth rejection'
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#events')) '^0$' 'history remained after auth rejection'
  Assert-Match (Invoke-AgentBrowser @('get', 'count', '#detail img')) '^0$' 'attachment remained after auth rejection'
  $safeDetail = Invoke-AgentBrowser @('get', 'text', '#detail')
  Assert-Match $safeDetail '^セッションを確認できません。再ログイン後に再読み込みしてください。$' 'detail did not reduce to the safe session message'
  $pageErrors = Invoke-AgentBrowser @('errors')
  if (-not [string]::IsNullOrWhiteSpace($pageErrors)) {
    throw "browser console/page errors were recorded after auth rejection: $pageErrors"
  }
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
  Write-Output 'PASS shared browser acceptance: 55-case paging/filtering, desktop, 390px, JWT, local D1/R2, ACK retry, draft, auth clearing'
} catch {
  Write-Output "FAIL stage=$stage"
  throw
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
    $server.WaitForExit()
  }
  try { Invoke-AgentBrowser @('close') | Out-Null } catch {}
  node -e "require('fs').rmSync(process.argv[1],{recursive:true,force:true})" $temporary
}
