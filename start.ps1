$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$localNode = Join-Path $PSScriptRoot '.runtime\node-v22.23.3-win-x64\node.exe'
if (Test-Path -LiteralPath $localNode) {
    & $localNode --env-file-if-exists=.env server/server.mjs
} else {
    & node --env-file-if-exists=.env server/server.mjs
}
