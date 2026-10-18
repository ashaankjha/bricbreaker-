# Brick Surge

A neon brick breaker for phones and desktop browsers. Aim, launch a volley of balls, and break the numbered bricks before they reach your launcher lane.

No build step and no dependencies: plain HTML, CSS and JavaScript on a `<canvas>`.

## Features

- **Speed control.** Tap **Speed** to cycle 1× / 2× / 3×. Long volleys also **auto-boost** up to a further 3× after six seconds.
- **Recall.** Pull every ball back to the floor instantly when a volley drags on.
- **Power Mode.** Breaking bricks and collecting ⚡ orbs fills the power meter (the glowing border on the Power key). When it's full, tap **Power**: before a shot it arms the next volley; mid-volley it ignites the balls already in flight. Fireballs pierce straight through bricks and deal 2× damage.
- **Pickups and special bricks**
  - Green ring: +1 ball for the next turn.
  - ⚡ orb: +20% power charge.
  - Laser (↔ / ↕): every ball that touches it zaps its whole row or column. Used lasers clear at the end of the turn.
  - Bomb brick (dashed outline): explodes into the eight bricks around it. Chain reactions are allowed.
  - Riveted bricks carry double health and add more power charge.
- **Graphics.** A soft pastel look: peach-to-pink bricks shaded by remaining health (double-health bricks turn orchid and lavender), solid blue balls with see-through trails, mint rings, gentle drop shadows, debris bursts, shockwaves, screen shake, laser beams and a warm coral glow in Power Mode. Respects `prefers-reduced-motion`.
- **Sound.** Synthesised with the Web Audio API, so there are no audio files. Toggle with the speaker button.
- **Progress.** Your best level and the current run save automatically in the browser; reopen the game and choose **Continue**.
- **Installable.** Includes a web app manifest and an offline service worker, so it can be added to a phone's home screen.

## Controls

| Action | Touch / mouse | Keyboard |
| --- | --- | --- |
| Aim and launch | Drag on the board, release to fire | – |
| Cancel a shot | Drag below the board and release | – |
| Power Mode | Power key | Space or E |
| Speed | Speed key | F |
| Recall balls | Recall key | R |
| Pause | Pause key | P or Esc |

## Run it

Any static file server works:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

To install on a phone, host the folder over HTTPS (GitHub Pages works: Settings → Pages → deploy from the default branch) and use **Add to Home Screen**.

## Files

- `index.html`: page shell, HUD, control deck and menus
- `style.css`: layout and visual styling
- `game.js`: game loop, physics, rendering, sound and input
- `manifest.webmanifest`, `icon.svg`, `sw.js`: installable web app support
