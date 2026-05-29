# Build-packager-v1.0.2.ps1
# Version 1.0.2 (2026-04-24)
# Collects build files for selected ad networks into a single delivery folder
#
# Usage:
#   .\Build-packager-v1.0.1.ps1  # Uses settings from Build-packager-config.txt

$ScriptVersion = "1.0.2"
$ErrorActionPreference = "Stop"

if ($PSScriptRoot) {
    $scriptDir = $PSScriptRoot
} elseif ($MyInvocation.MyCommand.Path) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
    $scriptDir = Get-Location
}

# Function to find the root directory of the Cocos Creator project
function Find-ProjectRoot {
    param (
        [string]$StartPath
    )
    
    $currentPath = $StartPath
    $maxLevels = 10  # Maximum levels to go up to prevent infinite loops
    $level = 0
    
    while ($level -lt $maxLevels) {
        # Check for common markers of a Cocos Creator project root
        $assetsDir = Join-Path $currentPath "assets"
        $projectJson = Join-Path $currentPath "project.json"
        $settingsDir = Join-Path $currentPath "settings"
        
        if ((Test-Path $assetsDir -PathType Container) -and 
            ((Test-Path $projectJson -PathType Leaf) -or (Test-Path $settingsDir -PathType Container))) {
            return $currentPath
        }
        
        # Move up one directory
        $parentPath = Split-Path -Parent $currentPath
        if ($parentPath -eq $currentPath) {
            # We've reached the root of the filesystem
            break
        }
        $currentPath = $parentPath
        $level++
    }
    
    # If not found, return the original directory
    Write-Host "Warning: Could not find Cocos Creator project root. Using script directory." -ForegroundColor Yellow
    return $StartPath
}

# Find project root
$projectRoot = Find-ProjectRoot $scriptDir
Write-Host "Project root: $projectRoot"

# Default values
$BuildName = "MultiballDrop_Midas"
$SourceDir = "build\super-html"
$OutputDir = "build"
$Networks = @()

# Load configuration from text file
$configFile = Join-Path $scriptDir "Build-packager-config.txt"
if (Test-Path $configFile) {
    Write-Host "Loading configuration from: $configFile"
    
    $config = Get-Content $configFile -Encoding UTF8 | Where-Object { $_ -notmatch '^\s*#' -and $_ -notmatch '^\s*$' }
    $inNetworksSection = $false
    
    foreach ($line in $config) {
        # Handle basic key=value pairs
        if ($line -match '^\s*(\w+)\s*=\s*(.+)$') {
            $key = $matches[1]
            $value = $matches[2]
            
            switch ($key) {
                "BuildName" { $BuildName = $value }
                "SourceDir" { $SourceDir = $value }
                "OutputDir" { $OutputDir = $value }
                "Networks" { 
                    # If Networks is still defined as a simple comma-separated list
                    if ($value -notmatch '^\s*\[') {
                        $Networks = $value -split ',' | ForEach-Object { $_.Trim() } 
                    }
                    else {
                        # Start of Networks section with [
                        $inNetworksSection = $true
                    }
                }
            }
        }
        # Handle networks inside [] brackets
        elseif ($inNetworksSection) {
            if ($line -match '^\s*\]') {
                # End of Networks section
                $inNetworksSection = $false
            }
            elseif ($line -match '^\s*\+\s*(\w+)') {
                # Network with + sign (included)
                $Networks += $matches[1]
            }
            # Ignore lines with - or without + (excluded networks)
        }
    }
    
    Write-Host "Configuration loaded successfully."
}

# Use paths relative to project root
$sourcePath = Join-Path $projectRoot $SourceDir
$outputPath = Join-Path (Join-Path $projectRoot $OutputDir) $BuildName

Write-Host ""
Write-Host "Build Package Collector v$ScriptVersion" -ForegroundColor Cyan
Write-Host "Build name: $BuildName"
Write-Host "Networks:   $($Networks -join ', ')"
Write-Host "Source:     $sourcePath"
Write-Host "Output:     $outputPath"
Write-Host ""

# Create output folder
if (-not (Test-Path $outputPath)) {
    New-Item -ItemType Directory -Path $outputPath | Out-Null
    Write-Host "Created folder: $outputPath"
}

# Clean up existing folders that are not in the Networks list
$existingNetworks = Get-ChildItem -Path $outputPath -Directory
foreach ($existingNetwork in $existingNetworks) {
    if ($Networks -notcontains $existingNetwork.Name) {
        Write-Host "Removing unused network folder: $($existingNetwork.Name)" -ForegroundColor Yellow
        Remove-Item $existingNetwork.FullName -Recurse -Force
    }
}

# JavaScript code to inject into Smadex HTML files
$smadexJsCode = @"
<script>
window.super_html.download = function () {
    if (window.smxTracking) {
        smxTracking.redirect();
    }
};
</script>
"@

$copiedFiles = 0
$skippedNetworks = 0

foreach ($network in $Networks) {
    # Special case for smadex - uses moloco files as base
    if ($network -eq "smadex") {
        $networkPath = Join-Path $sourcePath "moloco"
        $isSmadex = $true
        
        if (-not (Test-Path $networkPath)) {
            Write-Host "SKIP $network (source 'moloco' folder not found: $networkPath)" -ForegroundColor Yellow
            $skippedNetworks++
            continue
        }
    }
    else {
        $networkPath = Join-Path $sourcePath $network
        $isSmadex = $false
        
        if (-not (Test-Path $networkPath)) {
            Write-Host "SKIP $network (folder not found: $networkPath)" -ForegroundColor Yellow
            $skippedNetworks++
            continue
        }
    }

    # Create subfolder for this network inside output
    $destNetwork = Join-Path $outputPath $network
    if (-not (Test-Path $destNetwork)) {
        New-Item -ItemType Directory -Path $destNetwork | Out-Null
        Write-Host "Created network folder: $network"
    }

    # Copy all files from this network folder (not subfolders)
    $files = Get-ChildItem -Path $networkPath -File
    if ($files.Count -eq 0) {
        Write-Host "SKIP $network (no files)" -ForegroundColor Yellow
        continue
    }

    Write-Host "[$network]" -ForegroundColor Green
    foreach ($file in $files) {
        $fileName = $file.Name
        
        # For smadex, modify filenames from "moloco" to "smadex"
        if ($isSmadex) {
            $fileName = $fileName -replace "moloco", "smadex"
        }
        
        $destFile = Join-Path $destNetwork $fileName
        
        # For smadex HTML files, add JavaScript code before </body></html>
        if ($isSmadex -and $file.Extension -eq ".html") {
            Write-Host "  -> $fileName (modifying HTML with Smadex tracking code)"
            
            $content = Get-Content -Path $file.FullName -Raw
            # Insert smadex code right before </body> tag, with proper formatting
            $modifiedContent = $content -replace "(\s*)</body>\s*</html>", "$smadexJsCode`n$1</body></html>"
            Set-Content -Path $destFile -Value $modifiedContent -Encoding UTF8
        }
        else {
            Copy-Item $file.FullName $destFile -Force
            Write-Host "  -> $fileName"
        }
        
        $copiedFiles++
    }
}

Write-Host ""
Write-Host "Done. Copied: $copiedFiles files from $($Networks.Count - $skippedNetworks) networks" -ForegroundColor Green
Write-Host "Output folder: $outputPath"
Write-Host "Script version: $ScriptVersion"
Write-Host ""