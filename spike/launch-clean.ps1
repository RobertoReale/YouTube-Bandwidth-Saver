# Lancia Chrome in un profilo isolato, senza altre estensioni e senza cookie
# ereditati. Serve perché il profilo normale (con uBlock Origin) fa scattare il
# muro anti-adblock di YouTube, che impedisce qualunque verifica sensata.
#
#   .\launch-clean.ps1 -Build      → la build di produzione (.output/chrome-mv3)
#   .\launch-clean.ps1             → lo spike di Fase 0 (questa cartella)
#   .\launch-clean.ps1 -Baseline   → nessuna estensione, per il confronto
#
# Aggiungi -Reset per azzerare il profilo, e -Url per aprire un video preciso.

param(
  [switch]$Build,
  [switch]$Baseline,
  [switch]$Reset,
  [string]$Url = 'https://www.youtube.com/'
)

$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $chrome)) { throw "Chrome non trovato in $chrome" }

$spikeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoDir = Split-Path -Parent $spikeDir
$buildDir = Join-Path $repoDir '.output\chrome-mv3'

if ($Baseline) {
  $label = 'BASELINE (nessuna estensione)'
  $profileName = 'yt-spike-baseline'
  $extension = $null
} elseif ($Build) {
  if (-not (Test-Path (Join-Path $buildDir 'manifest.json'))) {
    throw "Build assente in $buildDir - esegui prima: pnpm build"
  }
  $label = 'BUILD DI PRODUZIONE'
  $profileName = 'yt-build-profile'
  $extension = $buildDir
} else {
  $label = 'SPIKE FASE 0'
  $profileName = 'yt-spike-profile'
  $extension = $spikeDir
}

$profileDir = Join-Path $env:TEMP $profileName

if ($Reset -and (Test-Path $profileDir)) {
  Remove-Item -Recurse -Force $profileDir
  Write-Host "Profilo azzerato: $profileDir"
}

$chromeArgs = @(
  "--user-data-dir=$profileDir"
  '--no-first-run'
  '--no-default-browser-check'
  '--auto-open-devtools-for-tabs'
)

# ★ NON usare --load-extension né --disable-extensions-except.
#
#   Chrome 150 ignora --load-extension (rimosso dal canale stabile), ma onora
#   ancora --disable-extensions-except: il risultato è che ogni estensione
#   caricata a mano viene disabilitata e NASCOSTA da chrome://extensions, con un
#   toast "Extension loaded" che mente. Ore di diagnosi per niente.
#
#   Il flag era comunque superfluo: un profilo temporaneo appena creato non ha
#   estensioni, quindi l'isolamento c'è già. L'estensione si carica a mano da
#   chrome://extensions, una volta sola per profilo.
if ($null -ne $extension) {
  Set-Clipboard -Value $extension
  Write-Host ''
  Write-Host 'Percorso copiato negli appunti. Nella finestra che si apre:' -ForegroundColor Yellow
  Write-Host '  1. chrome://extensions  →  Modalita sviluppatore  →  Carica estensione non pacchettizzata'
  Write-Host '  2. incolla il percorso (Ctrl+V) e conferma'
  Write-Host '  Serve una volta sola: il profilo lo ricorda.' -ForegroundColor DarkGray
  Write-Host ''
}

$chromeArgs += $Url

Write-Host $label -ForegroundColor Cyan
if ($null -ne $extension) { Write-Host "Estensione: $extension" }
Write-Host "Profilo:    $profileDir"

& $chrome @chromeArgs
