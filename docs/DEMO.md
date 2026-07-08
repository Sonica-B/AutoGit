# Recording the demo GIF

A short demo GIF is the single highest-converting element on the Marketplace
listing. Aim for **~10–15 seconds**, silent, loopable. Save the final file to
`images/demo.gif` — the README already references it.

> The Marketplace rasterizes SVG and blocks most embeds, but it **does** render
> animated GIFs served over HTTPS. So a real GIF (not the SVG) is what belongs
> above the fold.

## Tools

- **Windows:** [ScreenToGif](https://www.screentogif.com/) (free) — record a
  region, edit frames, export GIF.
- **macOS:** [Kap](https://getkap.co/) or [Gifox].
- **Cross-platform:** [LICEcap](https://www.cockos.com/licecap/).

## Storyboard (what to capture)

Record a clean VS Code window (hide the sidebar, use a common theme like Dark+)
in a small scratch git repo with a remote configured.

1. **(0–2s)** Click the status bar to enable — `Auto Git: OFF` → `Auto Git: ON`.
2. **(2–5s)** Edit a file (add a line) and save. Show the status bar go
   `Pending` → `Working`.
3. **(5–8s)** Show the toast: *"Committed and pushed — feat: …"* with the
   AI-generated message.
4. **(8–13s)** The money shot: paste a fake key (e.g. `AKIAIOSFODNN7EXAMPLE`)
   into a file, save, and show the **secret-scan block** notification stopping
   the commit.

That last beat is the differentiator — make sure it's in frame.

## Polish checklist

- Crop tightly to the editor + status bar; trim dead time.
- Target **< 3 MB** (Marketplace loads it inline). Reduce by lowering FPS
  (10–12 is plenty) and color count in ScreenToGif.
- Use a demo repo — never record real credentials or private code.
- Optional: also drop an MP4 into the GitHub release/README for higher quality.

Once exported, drop it at `images/demo.gif`, uncomment the image line near the
top of `README.md`, and ship it in the next release.
