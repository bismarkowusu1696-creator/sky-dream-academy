Set-Location -Path $PSScriptRoot

git add -A

$status = git status --porcelain
if (-not $status) {
    Write-Host "No changes to publish."
} else {
    $msg = "Update site - $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    git commit -m $msg
    git push
    Write-Host ""
    Write-Host "Published! GitHub Pages usually updates within a minute or two."
}

Read-Host "Press Enter to close"
