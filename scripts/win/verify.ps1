# Affinity MCP connection checker (Windows).
# Verifies: Affinity process -> port 6767 (IPv6 loopback) -> SSE handshake.
$ErrorActionPreference = 'Continue'

Write-Host "Affinity MCP verification" -ForegroundColor Cyan
$ok = $true

$proc = Get-Process -Name Affinity -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "[ok]   Affinity is running (PID $($proc.Id -join ', '))"
} else {
    Write-Host "[FAIL] Affinity is not running." -ForegroundColor Red
    $ok = $false
}

$listener = Get-NetTCPConnection -LocalPort 6767 -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -in @('::1', '127.0.0.1') }
if ($listener) {
    Write-Host "[ok]   MCP server listening on $($listener.LocalAddress -join ', '):6767"
} else {
    Write-Host "[FAIL] Nothing is listening on port 6767." -ForegroundColor Red
    Write-Host "       In Affinity: Edit > Settings > Model Context Protocol > enable 'Enable Affinity MCP'."
    $ok = $false
}

if ($ok) {
    try {
        $tcp = [System.Net.Sockets.TcpClient]::new()
        $tcp.Connect([System.Net.IPAddress]::IPv6Loopback, 6767)
        $stream = $tcp.GetStream()
        $request = "GET /sse HTTP/1.1`r`nHost: [::1]:6767`r`nAccept: text/event-stream`r`n`r`n"
        $bytes = [System.Text.Encoding]::ASCII.GetBytes($request)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.ReadTimeout = 5000
        $buffer = New-Object byte[] 1024
        $read = $stream.Read($buffer, 0, $buffer.Length)
        $text = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $read)
        if ($text -match 'endpoint') {
            Write-Host "[ok]   SSE handshake received (event: endpoint)"
        } else {
            Write-Host "[WARN] Connected but no endpoint event was received." -ForegroundColor Yellow
            $ok = $false
        }
        $tcp.Close()
    } catch {
        Write-Host "[FAIL] TCP/HTTP check failed: $($_.Exception.Message)" -ForegroundColor Red
        $ok = $false
    }
}

if ($ok) {
    Write-Host "`nAll checks passed. The bridge can reach Affinity." -ForegroundColor Green
    exit 0
}
Write-Host "`nOne or more checks failed." -ForegroundColor Red
exit 1
