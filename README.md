https://sambitbasu2007.github.io/PhoneDuoDemo/

# iPhone Duo · Fold Preview

A browser-based study of foldable screen transitions, built with Three.js. The Apple iPhone Duo (Star White) reference model is rendered in real time and folds from fully open to fully closed, with its inner display bending around the hinge while the outer cover screen takes over.


## What it does

- **Fold animation.** Only the cover half of the device rotates; the rear-camera half stays fixed, matching the real hardware's motion. The play button runs the full open-to-close cycle; the slider scrubs the fold manually (180° is fully open, 0° is closed).
- **Projected screen UI.** The two screen meshes are detached from the model at load and given a custom shader that projects the launcher interface onto the unfolded screen planes from a fixed front view. The UI stays crisp at any fold angle, bending and fading with the display instead of smearing with it.
- **Transition effects.** Blur and darkening follow the image coordinates, including the image edges. Maximum blur radius is 72 source pixels; darkening uses twice the transition strength, capped at black.
- **Launcher screens only.** The Apple HIG Launcher layout is applied to both screens on load. The inner screen contains the whole layout; the outer screen crops to the right-hand portion and aligns that portion to its left edge. The outer screen turns off at full opening.
- **Interactive 3D viewport.** Drag to orbit, scroll to zoom (clamped between sensible limits), rendered with a generated studio environment, ACES filmic tone mapping, and a three-point light rig.
- **Responsive layout.** A single centered column: header, canvas hero, glass control dock, and a structured about section — desktop and mobile.

## Project structure

```
.
├── index.html                  Page markup: header, fold preview section, about, footer
├── style.css                   Layout, theming, and responsive rules
├── main.js                     Three.js scene, fold deformation, projected UI, blur, darkening
├── ui.js                       Launcher screen layout composited onto the two displays
├── scripts/
│   └── prepare-assets.py       Downloads and preprocesses the Apple reference assets
├── requirements-assets.txt     Python dependency for the asset script (usd-core)
├── vercel.json                 Build config: runs the asset script during Vercel builds
├── .vercelignore               Keeps credentials/metadata out of deployments
├── vendor/
│   └── three/                  Bundled Three.js 0.186.0 runtime and required add-ons
│       ├── build/              three.module.js / three.core.js
│       └── examples/jsm/       USDLoader, OrbitControls, RoomEnvironment, fflate
└── assets/                     (generated, not stored in the repo)
    ├── iPhone_Duo_Star_White.usdz      Original Apple model
    ├── iPhone_Duo_Render.usdc          Flattened, landscape-pose version the app loads
    ├── textures/                       45 model textures, paths rewritten for the browser
    └── ui/                             launcher-inner.png, launcher-outer.png
```

## How the assets work

The app is fully static — no build step, no CDN calls at runtime; Three.js is bundled in `vendor/three/`. The Apple model and screen images are not stored in the repository. `scripts/prepare-assets.py` downloads the original Star White USDZ from apple.com, selects the model's landscape pose, flattens its references into a single USD crate, extracts its 45 textures, and rewrites their paths for the browser. The prepared files land in the git-ignored `assets/` directory, and `vercel.json` runs the same script during every Vercel build so deployments include the model without ever storing it.

## License and credits

Original application code is released under the [MIT license](LICENSE).

**Three.js** (bundled in `vendor/three/`) — MIT license, preserved in `vendor/three/LICENSE`.
**fflate** (bundled in `vendor/three/examples/jsm/libs/fflate.module.js`) — MIT license, preserved in `fflate.LICENSE`.

**Apple reference assets.** The iPhone Duo model, textures, and launcher screenshots belong to Apple and/or their respective rights holders. They are excluded from this repository and from the MIT license; the asset script links to their original sources and does not grant rights to these assets. Their use is subject to Apple's terms.

- [Apple iPhone Duo](https://www.apple.com/iphone-duo/)
- [Apple HIG: Designing for iPhone Duo](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo)
- [Apple website terms](https://www.apple.com/legal/internet-services/terms/site.html)

This is an independent animation study, not an Apple product and not endorsed by Apple. iPhone and Apple are trademarks of Apple Inc.

- [Three.js](https://threejs.org/)
- [fflate](https://github.com/101arrowz/fflate)
