param([string]$DestinationDirectory)
$ErrorActionPreference = 'Stop'
function Get-Sha256([string]$FilePath) {
  $stream = [IO.File]::OpenRead($FilePath)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
}
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $desktopRoot 'package.json') -Raw | ConvertFrom-Json).version
$runtimeDirectory = Join-Path $desktopRoot 'release\build\win-unpacked'
$outputDirectory = if ($DestinationDirectory) { [IO.Path]::GetFullPath($DestinationDirectory) } else { Join-Path $desktopRoot "release\v$version" }
$buildDirectory = Join-Path $desktopRoot 'release\build'
if (-not (Test-Path -LiteralPath (Join-Path $runtimeDirectory 'AnchorProposal.exe'))) { throw 'Build the Windows runtime first.' }
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$payloadPath = Join-Path $buildDirectory 'portable-payload.zip'
if (Test-Path -LiteralPath $payloadPath) { Remove-Item -LiteralPath $payloadPath -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($runtimeDirectory, $payloadPath, [IO.Compression.CompressionLevel]::Fastest, $false)
$payloadHash = Get-Sha256 $payloadPath
$executableHash = Get-Sha256 (Join-Path $runtimeDirectory 'AnchorProposal.exe')
$appHash = Get-Sha256 (Join-Path $runtimeDirectory 'resources\app.asar')
$source = (Get-Content -LiteralPath (Join-Path $desktopRoot 'launcher\PortableLauncher.cs') -Raw).Replace('__BUILD_HASH__', $payloadHash).Replace('__EXE_HASH__', $executableHash).Replace('__APP_HASH__', $appHash).Replace('__APP_VERSION__', ($version.Split('-')[0] + '.0'))
$sourcePath = Join-Path $buildDirectory 'PortableLauncher.generated.cs'
[IO.File]::WriteAllText($sourcePath, $source)
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$executable = Join-Path $outputDirectory 'AnchorProposal.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.Core.dll "/win32icon:$desktopRoot\assets\icon.ico" "/resource:$payloadPath,AnchorPayload" "/out:$executable" $sourcePath
if ($LASTEXITCODE -ne 0) { throw 'Portable launcher compilation failed.' }
$metadata = [pscustomobject]@{ Version = $version; BuildHash = $payloadHash; ExecutableHash = $executableHash; AppHash = $appHash; Portable = $executable; Bytes = (Get-Item -LiteralPath $executable).Length } | ConvertTo-Json
$metadataPath = Join-Path $buildDirectory 'portable-build.json'
[IO.File]::WriteAllText(($metadataPath + '.new'), $metadata, (New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath ($metadataPath + '.new') -Destination $metadataPath -Force
Write-Output "Fast portable executable: $executable"
