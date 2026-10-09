# Registers the affinity-mcp-windows bridge in the global opencode config.
# Usage: pwsh -File scripts/win/setup-opencode.ps1 [-ConfigPath <path>]
param([string]$ConfigPath)

$ErrorActionPreference = 'Stop'

if (-not $ConfigPath) {
    $dir = Join-Path $env:USERPROFILE '.config\opencode'
    foreach ($name in @('opencode.json', 'opencode.jsonc')) {
        if (Test-Path (Join-Path $dir $name)) {
            $ConfigPath = Join-Path $dir $name
            break
        }
    }
    if (-not $ConfigPath) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        $ConfigPath = Join-Path $dir 'opencode.json'
    }
}

$entry = Join-Path $PSScriptRoot '..\..\dist\index.js' | Resolve-Path -ErrorAction SilentlyContinue

if (-not $entry) {
    throw "Bridge build not found. Run 'npm install' and 'npm run build' in the repo root first."
}

$config = @{}
if (Test-Path $ConfigPath) {
    $raw = Get-Content -Raw $ConfigPath
    if ($raw -match '(?m)^\s*//') {
        Write-Warning "The config contains comments. ConvertFrom-Json may fail; back it up before continuing."
    }
    $config = $raw | ConvertFrom-Json -AsHashtable
}

if (-not $config.mcp) { $config.mcp = @{} }
$config.mcp['affinity-mcp'] = @{
    type    = 'local'
    command = @('node', $entry.Path)
    enabled = $true
}

$json = $config | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($ConfigPath, $json + [Environment]::NewLine)

Write-Host "Updated $ConfigPath"
Write-Host "Restart opencode for the affinity-mcp server to load."
