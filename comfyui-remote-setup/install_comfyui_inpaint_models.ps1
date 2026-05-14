param(
  [string]$ComfyRoot = "C:\ComfyUI",
  [string]$ComfyUrl = "http://127.0.0.1:8188",
  [switch]$Download
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
  Write-Host ""
  Write-Host "== $Message" -ForegroundColor Cyan
}

function Ensure-Dir($Path) {
  if (!(Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Get-HfCommand {
  $hf = Get-Command hf -ErrorAction SilentlyContinue
  if ($hf) { return "hf" }

  $huggingfaceCli = Get-Command huggingface-cli -ErrorAction SilentlyContinue
  if ($huggingfaceCli) { return "huggingface-cli" }

  return $null
}

function Invoke-HfDownload($Repo, $File, $TargetPath) {
  $hfCommand = Get-HfCommand
  if (!$hfCommand) {
    throw "Hugging Face CLI not found. Run: python -m pip install -U huggingface_hub"
  }

  $targetDir = Split-Path -Parent $TargetPath
  Write-Host "Downloading $Repo/$File -> $targetDir"
  if ($hfCommand -eq "hf") {
    & hf download $Repo $File --local-dir $targetDir
  } else {
    & huggingface-cli download $Repo $File --local-dir $targetDir
  }

  if ($LASTEXITCODE -ne 0) {
    throw "Hugging Face download failed for $Repo/$File. If this is gated, accept the model agreement and run huggingface-cli login."
  }

  $downloadedPath = Join-Path $targetDir $File
  if ((Test-Path -LiteralPath $downloadedPath) -and ($downloadedPath -ne $TargetPath)) {
    Copy-Item -LiteralPath $downloadedPath -Destination $TargetPath -Force
  }
}

function Test-Comfy {
  try {
    $stats = Invoke-RestMethod -Uri "$ComfyUrl/system_stats" -TimeoutSec 8
    Write-Host "ComfyUI OK: $($stats.system.comfyui_version)"
    if ($stats.devices -and $stats.devices.Count -gt 0) {
      Write-Host "GPU: $($stats.devices[0].name)"
    }
  } catch {
    Write-Warning "ComfyUI API not reachable at $ComfyUrl. Continue file checks, then restart/check ComfyUI."
  }
}

function Get-ModelList($Type) {
  try {
    $result = Invoke-RestMethod -Uri "$ComfyUrl/models/$Type" -TimeoutSec 8
    if ($null -eq $result) { return @() }
    if ($result.value) { return @($result.value) }
    return @($result)
  } catch {
    return @()
  }
}

function Ensure-Model($Spec) {
  if (Test-Path -LiteralPath $Spec.Path) {
    Write-Host "OK      $($Spec.Label)"
    Write-Host "        $($Spec.Path)"
    return $true
  }

  Write-Warning "MISSING $($Spec.Label)"
  Write-Host "        $($Spec.Path)"
  Write-Host "        Source: https://huggingface.co/$($Spec.Repo)/resolve/main/$($Spec.File)"
  if ($Spec.Gated) {
    Write-Host "        Gated: accept the Hugging Face agreement and run huggingface-cli login first."
  }

  if ($Download) {
    Invoke-HfDownload $Spec.Repo $Spec.File $Spec.Path
    if (!(Test-Path -LiteralPath $Spec.Path)) {
      throw "Download completed but target file was not found: $($Spec.Path)"
    }
    Write-Host "DOWNLOADED $($Spec.Label)"
    return $true
  }

  return $false
}

Write-Step "Check ComfyUI root"
if (!(Test-Path -LiteralPath $ComfyRoot)) {
  throw "ComfyUI root not found: $ComfyRoot"
}
Write-Host "ComfyRoot: $ComfyRoot"
Write-Host "ComfyUrl:  $ComfyUrl"
Write-Host "Download:  $Download"

$diffusionDir = Join-Path $ComfyRoot "models\diffusion_models"
$textEncoderDir = Join-Path $ComfyRoot "models\text_encoders"
$vaeDir = Join-Path $ComfyRoot "models\vae"
$checkpointDir = Join-Path $ComfyRoot "models\checkpoints"
$workflowDir = Join-Path $ComfyRoot "user\default\workflows\photoshop-plugin"

Write-Step "Create expected directories"
foreach ($dir in @($diffusionDir, $textEncoderDir, $vaeDir, $checkpointDir, $workflowDir)) {
  Ensure-Dir $dir
  Write-Host $dir
}

Write-Step "Check ComfyUI API"
Test-Comfy

$models = @(
  @{
    Label = "FLUX.1 Fill dev diffusion model"
    Path = Join-Path $diffusionDir "flux1-fill-dev.safetensors"
    Repo = "black-forest-labs/FLUX.1-Fill-dev"
    File = "flux1-fill-dev.safetensors"
    Gated = $true
  },
  @{
    Label = "FLUX CLIP-L text encoder"
    Path = Join-Path $textEncoderDir "clip_l.safetensors"
    Repo = "comfyanonymous/flux_text_encoders"
    File = "clip_l.safetensors"
    Gated = $false
  },
  @{
    Label = "FLUX T5XXL fp16 text encoder"
    Path = Join-Path $textEncoderDir "t5xxl_fp16.safetensors"
    Repo = "comfyanonymous/flux_text_encoders"
    File = "t5xxl_fp16.safetensors"
    Gated = $false
  },
  @{
    Label = "FLUX VAE ae.safetensors"
    Path = Join-Path $vaeDir "ae.safetensors"
    Repo = "black-forest-labs/FLUX.1-dev"
    File = "ae.safetensors"
    Gated = $true
  },
  @{
    Label = "SDXL base checkpoint for SDXL inpaint workflows"
    Path = Join-Path $checkpointDir "sd_xl_base_1.0.safetensors"
    Repo = "stabilityai/stable-diffusion-xl-base-1.0"
    File = "sd_xl_base_1.0.safetensors"
    Gated = $true
  },
  @{
    Label = "SDXL inpaint UNet"
    Path = Join-Path $diffusionDir "sd_xl_inpainting_0.1.safetensors"
    Repo = "diffusers/stable-diffusion-xl-1.0-inpainting-0.1"
    File = "unet/diffusion_pytorch_model.fp16.safetensors"
    Gated = $false
  },
  @{
    Label = "ComfyUI basic inpaint fallback checkpoint"
    Path = Join-Path $checkpointDir "512-inpainting-ema.safetensors"
    Repo = "Comfy-Org/stable_diffusion_2.1_repackaged"
    File = "512-inpainting-ema.safetensors"
    Gated = $false
  }
)

Write-Step "Verify required model files"
$missing = New-Object System.Collections.Generic.List[string]
foreach ($model in $models) {
  $ok = Ensure-Model $model
  if (!$ok) { $missing.Add($model.Label) | Out-Null }
}

Write-Step "Current ComfyUI model lists"
foreach ($type in @("diffusion_models", "text_encoders", "vae", "checkpoints")) {
  $items = Get-ModelList $type
  Write-Host "--- $type"
  if ($items.Count -eq 0) {
    Write-Host "  (none or API unavailable)"
  } else {
    $items | ForEach-Object { Write-Host "  $_" }
  }
}

Write-Step "Node availability check"
try {
  $objectInfo = Invoke-RestMethod -Uri "$ComfyUrl/object_info" -TimeoutSec 12
  $neededNodes = @(
    "LoadImage",
    "SaveImage",
    "CheckpointLoaderSimple",
    "UNETLoader",
    "DualCLIPLoader",
    "VAELoader",
    "CLIPTextEncode",
    "KSampler",
    "VAEDecode",
    "VAEEncodeForInpaint",
    "InpaintModelConditioning",
    "ImageCompositeMasked",
    "GrowMask",
    "FeatherMask"
  )
  foreach ($node in $neededNodes) {
    if ($objectInfo.PSObject.Properties.Name -contains $node) {
      Write-Host "OK      node $node"
    } else {
      Write-Warning "MISSING node $node"
    }
  }
} catch {
  Write-Warning "Could not read $ComfyUrl/object_info"
}

Write-Step "Result"
if ($missing.Count -eq 0) {
  Write-Host "All expected model files are present."
  Write-Host "Restart ComfyUI if any files were downloaded, then validate the official workflows."
} else {
  Write-Warning "Missing model files:"
  $missing | ForEach-Object { Write-Host "  $_" }
  if (!$Download) {
    Write-Host ""
    Write-Host "To download missing files, accept gated model agreements if needed, log in, then rerun:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File $PSCommandPath -Download"
  }
}
