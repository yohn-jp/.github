# yohn-jp product icon system

This directory is the canonical visual authority for the yohn-jp product family.

## Production contract

- Master canvas: **512 × 512**
- Canonical source: **SVG**
- Raster exports: **512, 256, 128, 64, 32, 16 px**
- Background: transparent
- Geometry: minimal and semantic; no product name or text inside the mark
- Downstream repositories may consume or project these assets, but must not independently redraw them

## Product marks

| Product | Semantic motif | Accent |
| --- | --- | --- |
| Mottainai | circular reuse / bounded orchestration | `#CCFF3D` |
| Nawabari | territory / ownership boundary | `#8AB4FF` |
| Inari | fox / governed issuance | `#FF4E3A` |
| Suzukuri | nest / bounded semantic view | `#A78BFA` |
| Wabachi | Japanese honeybee / canonical hive | `#FBBF24` |
| Majiwari | crossing / adapter gateway | `#22D3EE` |

## File layout

Each product directory contains one canonical `<product>.svg` and PNG exports named `<product>-<size>.png` for 512, 256, 128, 64, 32, and 16 px.

`brand-manifest.json` is the machine-readable inventory.

## Usage

Use SVG for README, documentation, and web surfaces whenever supported. Use 512 or 256 px PNG when a platform requires bitmap upload, and 32 or 16 px only for favicon-like contexts.

Do not add text, shadows, backgrounds, gradients, or product-specific redrawing to the marks downstream.
