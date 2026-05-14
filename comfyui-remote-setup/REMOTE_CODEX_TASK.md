# Remote Codex Task: Prepare ComfyUI Inpaint Models

You are running on the ComfyUI machine.

ComfyUI target:

- Local API: `http://127.0.0.1:8188`
- LAN API from Photoshop machine: `http://192.168.1.128:8188`
- Expected ComfyUI root: `C:\ComfyUI`

Goal:

1. Install or verify the model files required by the Photoshop plugin's `comfy:flux-fill` preset.
2. Install or verify the model files required by the Photoshop plugin's `comfy:sdxl-inpaint` preset.
3. Install or verify the model file required by a smaller basic-inpaint fallback.
4. Do not delete, overwrite, rename, or move existing models.
5. Send back the final model lists and any working workflow JSON/image generated during validation.

## Why These Models

The Photoshop plugin needs two local redraw paths:

- `comfy:flux-fill`: main high-quality inpaint/outpaint path for UI removal and background repair.
- `comfy:sdxl-inpaint`: SDXL inpaint route for workflows that already use the SDXL ecosystem.
- basic fallback: smaller route using the official ComfyUI basic inpainting example.

Official ComfyUI FLUX Fill docs list these files:

```text
ComfyUI/models/diffusion_models/flux1-fill-dev.safetensors
ComfyUI/models/text_encoders/clip_l.safetensors
ComfyUI/models/text_encoders/t5xxl_fp16.safetensors
ComfyUI/models/vae/ae.safetensors
```

Official ComfyUI basic inpaint docs use:

```text
ComfyUI/models/checkpoints/512-inpainting-ema.safetensors
```

The SDXL inpaint route uses the public Diffusers SDXL inpaint UNet:

```text
ComfyUI/models/diffusion_models/sd_xl_inpainting_0.1.safetensors
```

It usually also needs an SDXL base checkpoint available to provide the matching CLIP/VAE:

```text
ComfyUI/models/checkpoints/sd_xl_base_1.0.safetensors
```

## Sources To Check

- FLUX Fill ComfyUI docs: `https://docs.comfy.org/tutorials/flux/flux-1-fill-dev`
- Basic inpaint ComfyUI docs: `https://docs.comfy.org/tutorials/basic/inpaint`
- FLUX Fill model agreement: `https://huggingface.co/black-forest-labs/FLUX.1-Fill-dev`
- SDXL inpaint model: `https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1`

The Black Forest Labs FLUX files may require accepting the Hugging Face agreement and logging in with a token.

## Runbook

Copy `install_comfyui_inpaint_models.ps1` to the ComfyUI machine, then run this first:

```powershell
cd C:\ComfyUI
powershell -ExecutionPolicy Bypass -File C:\path\to\install_comfyui_inpaint_models.ps1
```

That first run only probes the installation and reports missing files.

If the script reports missing Hugging Face files:

```powershell
python -m pip install -U huggingface_hub
huggingface-cli login
```

Open the FLUX Fill Hugging Face page in a browser and accept the agreement before downloading.

Then run the download pass:

```powershell
powershell -ExecutionPolicy Bypass -File C:\path\to\install_comfyui_inpaint_models.ps1 -Download
```

Restart ComfyUI after downloads finish, then rerun the probe:

```powershell
powershell -ExecutionPolicy Bypass -File C:\path\to\install_comfyui_inpaint_models.ps1
```

## Validation

After the files are visible in ComfyUI, validate both routes:

1. Load the official FLUX Fill inpaint workflow from the ComfyUI docs.
2. Ensure the workflow nodes select:
   - diffusion model: `flux1-fill-dev.safetensors`
   - CLIP 1 / T5: `t5xxl_fp16.safetensors`
   - CLIP 2 / CLIP-L: `clip_l.safetensors`
   - VAE: `ae.safetensors`
3. Queue one small test using an input image with an alpha mask.
4. Validate an SDXL inpaint workflow if the SDXL files are present.
5. Load the official basic inpaint workflow from the ComfyUI docs.
6. Ensure `Load Checkpoint` selects `512-inpainting-ema.safetensors`.
7. Queue one small test.

## Plugin Integration Notes

The Photoshop plugin will send:

- a crop image with enough surrounding context,
- a mask showing only the region that may change,
- a prompt such as "remove UI, text, buttons, frames; preserve original background outside the masked area exactly".

The ComfyUI workflow should composite the generated result back over the original image using the mask. This matters: the model may alter unmasked pixels internally, but the returned patch should keep unmasked pixels from the original source.

For transparent PNG sprites, do not rely on image generation preserving alpha. Use this route instead:

1. Keep the original sprite alpha untouched.
2. Generate only a fire/glow/effect layer, preferably over black.
3. Convert black/luminance to alpha.
4. Composite the RGBA effect over the original sprite.
5. Return an RGBA PNG patch.

## Deliver Back

Send back this information:

```powershell
Invoke-RestMethod http://127.0.0.1:8188/system_stats
Invoke-RestMethod http://127.0.0.1:8188/models/diffusion_models
Invoke-RestMethod http://127.0.0.1:8188/models/text_encoders
Invoke-RestMethod http://127.0.0.1:8188/models/vae
Invoke-RestMethod http://127.0.0.1:8188/models/checkpoints
```

Also send:

- any successful FLUX Fill workflow JSON,
- any successful basic inpaint workflow JSON,
- the output test image paths from `ComfyUI/output`.
