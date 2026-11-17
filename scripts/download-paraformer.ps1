$ErrorActionPreference = 'Stop'
$taskModelDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) '.cache/paraformer'
New-Item -ItemType Directory -Path $taskModelDirectory -Force | Out-Null
$taskModelFiles = Invoke-RestMethod -Uri 'https://huggingface.co/api/models/csukuangfj/streaming-paraformer-zh/tree/main'
$taskSelectedFiles = $taskModelFiles | Where-Object { $_.path -in @('model_quant.onnx','decoder_quant.onnx','tokens.txt') }
if ($taskSelectedFiles.Count -ne 3) { throw 'Official model file list is incomplete' }
$taskSelectedFiles | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskModelDirectory 'downloads.json') -Encoding utf8
foreach ($taskFile in $taskSelectedFiles) {
  $taskDownloadTarget = Join-Path $taskModelDirectory $taskFile.path
  $taskLength = if (Test-Path -LiteralPath $taskDownloadTarget) { (Get-Item -LiteralPath $taskDownloadTarget).Length } else { 0 }
  if ($taskLength -ne $taskFile.size) {
    Write-Host "Downloading $($taskFile.path) ($($taskFile.size) bytes)"
    Invoke-WebRequest -UseBasicParsing -Uri ('https://huggingface.co/csukuangfj/streaming-paraformer-zh/resolve/main/'+$taskFile.path+'?download=true') -OutFile $taskDownloadTarget -Resume -TimeoutSec 300
  }
  if ((Get-Item -LiteralPath $taskDownloadTarget).Length -ne $taskFile.size) { throw "Incomplete download: $($taskFile.path)" }
  if ($taskFile.lfs.oid -and (Get-FileHash -LiteralPath $taskDownloadTarget -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskFile.lfs.oid) { throw "Hash mismatch: $($taskFile.path)" }
}
foreach ($taskSmallFile in @('config.yaml','am.mvn')) {
  Invoke-WebRequest -UseBasicParsing -Uri ('https://huggingface.co/csukuangfj/streaming-paraformer-zh/resolve/main/'+$taskSmallFile) -OutFile (Join-Path $taskModelDirectory $taskSmallFile) -TimeoutSec 60
}
Invoke-WebRequest -UseBasicParsing -Uri 'https://isv-data.oss-cn-hangzhou.aliyuncs.com/ics/MaaS/ASR/test_audio/asr_example_zh.wav' -OutFile (Join-Path $taskModelDirectory 'asr_example_zh.wav') -TimeoutSec 60
Write-Host 'Downloaded official free model files; run npm run prepare:chinese next.'
