# 使用方法（Windows，在仓库根目录运行）：
#   powershell -ExecutionPolicy Bypass -File .\scripts\build-portable.ps1
# 可选参数：
#   -SkipInstall                 跳过前端依赖安装
#   -Run                         打包完成后启动 dist 里的 portable 程序

[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$Run
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Command {
    param(
        [string]$Name,
        [string]$Hint
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "未找到命令 $Name。$Hint"
    }
}

function Add-PathIfExists {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $paths = $env:PATH -split [System.IO.Path]::PathSeparator
    if ($paths -notcontains $Path) {
        $env:PATH = "$Path$([System.IO.Path]::PathSeparator)$env:PATH"
    }
}

function Invoke-External {
    param(
        [string]$FilePath,
        [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "命令执行失败（退出码 $LASTEXITCODE）：$FilePath $($Arguments -join ' ')"
    }
}

if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") {
    throw "portable Windows 包需要在 Windows 上构建。"
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$frontendDir = Join-Path $repoRoot "frontend"
$tauriDir = Join-Path $repoRoot "src-tauri"
$distDir = Join-Path $repoRoot "dist"
$previousLocation = Get-Location
$temporaryTauriConfig = $null

try {
    Set-Location $repoRoot

    Add-PathIfExists (Join-Path $env:USERPROFILE ".cargo\bin")

    Require-Command "pnpm" "请先安装 pnpm，或启用 corepack 后重试。"
    Require-Command "cargo" "请先安装 Rust 工具链，或确认 %USERPROFILE%\.cargo\bin 已加入 PATH 后重试。"
    Require-Command "cargo-tauri" '请先运行 cargo install tauri-cli --version "^2" 安装 Tauri CLI。'

    $metadataJson = & cargo metadata --locked --no-deps --format-version 1
    if ($LASTEXITCODE -ne 0) {
        throw "cargo metadata --locked 执行失败。"
    }
    $metadata = $metadataJson | ConvertFrom-Json
    $memberIds = @($metadata.workspace_members)
    $workspacePackages = @(
        $metadata.packages |
            Where-Object {
                $memberIds -contains $_.id -and
                $_.name -in @("dinotty-server", "dinotty-desktop")
            }
    )
    $versions = @(
        $workspacePackages |
            Select-Object -ExpandProperty version -Unique
    )
    $hasExpectedPackages =
        $workspacePackages.Count -eq 2 -and
        @($workspacePackages | Where-Object { $_.name -eq "dinotty-server" }).Count -eq 1 -and
        @($workspacePackages | Where-Object { $_.name -eq "dinotty-desktop" }).Count -eq 1
    if (-not $hasExpectedPackages -or $versions.Count -ne 1 -or $versions[0] -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') {
        throw "未能从 Cargo workspace 解析唯一的 server/desktop 版本号。"
    }
    $version = $versions[0]

    if (-not $SkipInstall) {
        Write-Step "安装前端依赖"
        Push-Location $frontendDir
        try {
            Invoke-External "pnpm" @("install", "--frozen-lockfile")
        } finally {
            Pop-Location
        }
    }

    Write-Step "构建前端"
    Push-Location $frontendDir
    try {
        Invoke-External "pnpm" @("build")
    } finally {
        Pop-Location
    }

    # tauri.conf.json 中的 hook 从仓库根目录执行，不能使用相对于 src-tauri 的 ../frontend。
    # 前端已在上一步构建；用临时配置只为本次构建禁用该 hook。
    $temporaryTauriConfig = New-TemporaryFile
    [System.IO.File]::WriteAllText(
        $temporaryTauriConfig.FullName,
        '{"build":{"beforeBuildCommand":null}}',
        (New-Object System.Text.UTF8Encoding($false))
    )

    Write-Step "构建 Tauri portable 可执行文件"
    Push-Location $repoRoot
    try {
        # Portable 包只需要 release exe，无需额外生成 NSIS 安装程序。
        Invoke-External "cargo" @(
            "tauri", "build",
            "--no-bundle",
            "--ci",
            "--config", $temporaryTauriConfig.FullName,
            "--", "--locked"
        )
    } finally {
        Pop-Location
    }

    $targetDir = [string]$metadata.target_directory
    $exeCandidates = @(
        (Join-Path $targetDir "release\dinotty-desktop.exe"),
        (Join-Path $repoRoot "target\release\dinotty-desktop.exe"),
        (Join-Path $tauriDir "target\release\dinotty-desktop.exe")
    ) | Select-Object -Unique
    $exePath = $exeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $exePath) {
        throw "未找到 release 可执行文件 dinotty-desktop.exe（Cargo target 目录：$targetDir）。"
    }

    $rustcVersion = & rustc -vV
    if ($LASTEXITCODE -ne 0) {
        throw "rustc -vV 执行失败。"
    }
    $hostLine = $rustcVersion | Where-Object { $_ -like "host:*" } | Select-Object -First 1
    if (-not $hostLine) {
        throw "未能从 rustc -vV 解析 Rust host 架构。"
    }
    $rustHost = ($hostLine -replace '^host:\s*', '').Trim()
    $arch = switch -Regex ($rustHost) {
        '^x86_64-' { "x64"; break }
        '^aarch64-' { "arm64"; break }
        '^i[3-6]86-' { "x86"; break }
        default { ($rustHost -split '-', 2)[0].ToLowerInvariant() }
    }

    New-Item -ItemType Directory -Path $distDir -Force | Out-Null

    # Tauri 当前没有单独的 portable bundle，这里复制 release exe 并按发布规则命名。
    $portableName = "Dinotty_{0}_{1}-portable.exe" -f $version, $arch
    $portablePath = Join-Path $distDir $portableName
    try {
        Copy-Item -LiteralPath $exePath -Destination $portablePath -Force
    } catch [System.IO.IOException] {
        throw "无法写入 $portablePath。请先关闭正在运行的 portable 程序，然后重试。原始错误：$($_.Exception.Message)"
    }

    $releaseHash = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash
    $portableHash = (Get-FileHash -LiteralPath $portablePath -Algorithm SHA256).Hash
    if ($releaseHash -ne $portableHash) {
        throw "portable 产物校验失败：dist 文件与本次 release 构建不一致。"
    }

    Write-Host ""
    Write-Host "portable 包已生成：" -ForegroundColor Green
    Write-Host "  $portablePath"

    if ($Run) {
        Write-Step "启动 portable 程序"
        Start-Process -FilePath $portablePath -WorkingDirectory $distDir
    }
} finally {
    if ($temporaryTauriConfig -and (Test-Path -LiteralPath $temporaryTauriConfig.FullName)) {
        Remove-Item -LiteralPath $temporaryTauriConfig.FullName -Force
    }
    Set-Location $previousLocation
}
