# Chatex brand assets

Approved direction: Portuguese azulejo tile, a speech bubble with two caption strokes, forest green, warm ivory and ochre. Generated with native Codex ImageGen; sizes and previews are deterministic Pillow exports.

## Source artwork and prompt directions

- `sources/logo-source.png`: near-square azulejo badge with restrained leaf and petal ornaments, a large caption bubble, and the exact lowercase `chatex` wordmark. Self-contained ivory tile, green border, cream outer rim and transparent surroundings; readable on light and dark backgrounds.
- `sources/icon-source.png`: separate text-free tile with a larger caption bubble and four simple green corner accents. No letters, monograms or wordmark; prioritize legibility at 16 and 32 pixels.
- `sources/social-source.png`: wide cream plaque pairing the azulejo caption emblem with a large lowercase `chatex` wordmark. No slogan; transparent surroundings and contrast-safe borders.

## Exports

`manifest.json` lists dimensions and paths. The root `logo.png` is the README export, trimmed with an even 24 px transparent margin. The webpage references assets under `/brand/web-seo/`; the build copies this directory into `dist/brand/`.

The ICO contains 16, 32 and 48 px frames. Apple touch and Open Graph exports use an opaque ivory background; source artwork and other PNG exports preserve transparency. Web manifest icons declare `purpose: any`, with app scope and start URL `/`. These graphics do not add offline support.

`preview.png` shows light, ivory, dark and checkerboard composites, 128/256 px logo previews and favicon detail. No store assets are included.
