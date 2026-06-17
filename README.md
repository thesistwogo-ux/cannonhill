# Cannonhill — Mobile (iPhone) Port

A from-scratch HTML5/touch recreation of the classic **Cannonhill** artillery
game (originally by Dirk Plate; SDL2 port by univrsal). It keeps the soul of the
original — procedurally-generated, layered mountain terrain (snow / grass / earth
/ stone), **fully destructible ground that collapses physically**, charge-and-fire
cannons, the real weapon roster, wind, and adaptive AI — rebuilt to run in a phone
browser and install as a full-screen app on iPhone.

No build step, no dependencies. Just static files.

## Files
| file | purpose |
|------|---------|
| `index.html` | UI shell, touch controls, menus, PWA meta tags |
| `game.js` | the whole game engine (terrain, physics, weapons, AI, rounds, shop) |
| `manifest.webmanifest`, `sw.js` | PWA install + offline support |
| `icons/` | app icons |
| `server.js`, `start-cannonhill.bat` | tiny local web server to play from your PC/phone |
| `make_icons.js`, `smoketest.js`, `render_preview.js` | dev tools (not needed to play) |

## How to play it on your iPhone (from Windows)

Your iPhone and PC must be on the **same Wi-Fi**.

1. **Double-click `start-cannonhill.bat`.** It prints two addresses, e.g.
   `http://192.168.1.42:8777`.
2. On your iPhone, open **Safari** and go to that `http://192.168.x.x:8777`
   address.
3. Tap the **Share** button → **Add to Home Screen**. Now it launches
   full-screen like a real app.
4. Turn the phone **landscape** and play.

> The PC must stay on with that window open while you play (it's serving the
> game over your LAN).

### Want a permanent, installable, offline app? (GitHub Pages)
Plain `http://` over Wi-Fi can't register the service worker (browsers require a
secure origin), so offline mode is off in the LAN setup above — the game still
runs fine. For a proper installable + offline PWA, deploy to **GitHub Pages**
(free HTTPS hosting). This repo already includes the deploy workflow
(`.github/workflows/deploy.yml`).

A local git repo with a first commit is already created for you. To publish:

1. Create a new **empty** repo on github.com (no README), e.g. `cannonhill-mobile`.
2. In this folder, connect it and push (replace `YOUR-NAME`):
   ```bash
   git remote add origin https://github.com/YOUR-NAME/cannonhill-mobile.git
   git push -u origin main
   ```
   (Or with the GitHub CLI: `gh repo create cannonhill-mobile --public --source=. --push`.)
3. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions.**
4. The **Actions** tab will run the deploy; when it's green, your game is live at
   `https://YOUR-NAME.github.io/cannonhill-mobile/`.
5. Open that URL on your iPhone in Safari → **Share → Add to Home Screen**.
   It now installs as a full-screen, offline-capable app.

Every future `git push` to `main` redeploys automatically.

> Works from any HTTPS static host (Netlify, Cloudflare Pages, etc.) too —
> all paths are relative.

## Controls
- **◀ ▶** swing the cannon.
- **FIRE** — hold to charge power, release to shoot (support items like Shield
  fire instantly).
- **‹ ›** switch weapons (each has its own ammo).
- Watch the **wind** arrow up top; spend cash in the **shop** between rounds.
- Last tank standing wins the round; most rounds won wins the match.

## Weapons (stats taken from the original game)
Stone (∞), Rocket, Grenade, Rifle, Laser, Acid Barrel, Snowball, Shield, Magnet,
Magnetic Rocket, Mega Bomb, Medi-Pack.

## Credits
Original game by [Dirk Plate](https://dplate.de/games/cannonhill). This is an
independent mobile recreation of the gameplay.
