param(
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$VoiceName = 'Microsoft Yating'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$scenes = Get-Content -LiteralPath $ScriptPath -Raw -Encoding UTF8 | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'zh-TW' })
    if ($voices.Count -eq 0) { throw 'A local zh-TW speech voice is required.' }
    $selected = $voices | Where-Object { $_.VoiceInfo.Name -eq $VoiceName } | Select-Object -First 1
    if (-not $selected) { $selected = $voices[0] }
    $synth.SelectVoice($selected.VoiceInfo.Name)
    $synth.Rate = 1
    $synth.Volume = 100
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    foreach ($scene in $scenes) {
        $target = Join-Path $OutputDirectory ($scene.id + '.wav')
        $synth.SetOutputToWaveFile($target)
        $synth.Speak($scene.voice)
        $synth.SetOutputToNull()
    }
    $selected.VoiceInfo.Name | Set-Content -LiteralPath (Join-Path $OutputDirectory 'voice.txt') -Encoding UTF8
} finally {
    $synth.Dispose()
}
