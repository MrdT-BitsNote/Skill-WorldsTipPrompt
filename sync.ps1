# sync.ps1 - mirror the workspace sources into this repository.
#
# The workspace stays the working copy; this repository is a backup mirror.
# Run this after changing the skill or the plugin, then commit.
#
#   .\sync.ps1            # copy only
#   .\sync.ps1 -Commit    # copy + commit

[CmdletBinding()]
param(
    [switch]$Commit,
    [string]$Message = 'Sync from workspace'
)

$ErrorActionPreference = 'Stop'

$repo = $PSScriptRoot
# <workspace>/github/<repo> -> <workspace>
$workspace = Split-Path (Split-Path $repo -Parent) -Parent

$skillSrc = Join-Path $workspace 'skills\worldstip-prompt-polish'
$pluginSrc = Join-Path $workspace 'plugins\dsh-prompt-polish'
$evalsSrc = Join-Path $workspace 'evals\prompt-polish'
$toolsSrc = Join-Path $workspace 'tools'
$overviewSrc = Join-Path $workspace 'docs\worldstip-prompt-polish-overview.md'

foreach ($path in @($skillSrc, $pluginSrc, $evalsSrc, $toolsSrc, $overviewSrc)) {
    if (-not (Test-Path $path)) { throw "missing source: $path" }
}

foreach ($target in @('skill', 'plugin', 'evals', 'tools')) {
    $dest = Join-Path $repo $target
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
}

Copy-Item -Recurse $skillSrc (Join-Path $repo 'skill')
Copy-Item -Recurse $pluginSrc (Join-Path $repo 'plugin')
Copy-Item -Recurse $evalsSrc (Join-Path $repo 'evals')
Copy-Item -Recurse $toolsSrc (Join-Path $repo 'tools')

$docs = Join-Path $repo 'docs'
New-Item -ItemType Directory -Force -Path $docs | Out-Null
Copy-Item $overviewSrc (Join-Path $docs 'overview.md')

Get-ChildItem (Join-Path $repo 'evals') -Filter 'outputs*.json' -ErrorAction SilentlyContinue | Remove-Item -Force

Write-Host "synced into $repo"

if ($Commit) {
    git -C $repo add -A
    git -C $repo commit -m $Message
    Write-Host 'committed'
}
