$ErrorActionPreference = "Stop"

$distDir = Join-Path $PSScriptRoot "dist"
if (-not (Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir | Out-Null
}

# Function to zip a lambda directory
function Build-Lambda {
    param (
        [string]$SourceDir,
        [string]$ZipName
    )

    $sourcePath = Join-Path $PSScriptRoot $SourceDir
    $zipPath = Join-Path $distDir $ZipName

    if (-not (Test-Path $sourcePath)) {
        Write-Warning "Source directory not found: $sourcePath"
        return
    }

    Write-Host "Building $ZipName from $SourceDir..." -ForegroundColor Cyan
    
    if (Test-Path $zipPath) {
        Remove-Item $zipPath -Force
    }

    # Compress the CONTENTS of the directory, not the directory itself
    Compress-Archive -Path "$sourcePath\*" -DestinationPath $zipPath -Force
    
    Write-Host "Created $zipPath" -ForegroundColor Green
}

# Build post-social
Build-Lambda -SourceDir "spirulina-post-social" -ZipName "post-social.zip"

# Build set-agent-permission
Build-Lambda -SourceDir "set-agent-permission" -ZipName "set-agent-permission.zip"

Write-Host "Build complete!" -ForegroundColor Green
