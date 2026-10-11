# AGENTS.md – DangleRush MR

Návod pre AI agentov (Claude Code, Codex, Cursor…), ako na tomto repe pracovať rýchlo a bez rozbitia hry.
Používateľ komunikuje po slovensky; po slovensky sú aj texty v hre, komentáre v kóde a commit správy.

## Čo to je

Hokejový drill pre **Meta Quest 3** vo WebXR s passthrough (`immersive-ar` + `local-floor`).
Hráč mieša skutočný puk skutočnou hokejkou a prevádza ho cez virtuálne prekážky na zemi. Občas uhne
obrancovi. Platia tieto obmedzenia:

- Hra pozná **iba pózu headsetu**. Puk ani hokejku nevidí, prekážky na zemi sa len počítajú.
- Ovládanie je **len pohľadom** (dwell na tlačidle). Vstupy z ovládačov a rúk sa ignorujú, jediný klik je
  „Spustiť“ na stránke.
- Nasadené je na **https://hanrider8.github.io/dangle-rush/** (repo `Hanrider8/dangle-rush`). Používateľ
  to overuje na skutočnom Queste práve tam.

## Pracovný postup (dodrž)

1. Uprav kód a k zmene logiky v `src/core/` pridaj alebo uprav testy v `tests/`.
2. Spusti `npm run check` (typecheck, testy a build). Pred commitom musí prejsť.
3. **Po každej zmene nasaď:** commit do `main` a `git push`. Workflow
   `.github/workflows/deploy.yml` znovu spustí typecheck, testy a build a nasadí `dist/` na GitHub Pages.
4. Over nasadenie:
   - `gh run watch <id> --exit-status`,
   - `curl` na stránku a na bundle `assets/index-*.js`, či obsahuje novú zmenu.
5. Používateľovi pošli link (pri ladení aj variant `?debug=1`) a stručne napíš, čo sa zmenilo. Uveď, čo si overil a čo
   nie (na Queste overuje on).

**Commity:**
- správa po slovensky, na konci trailer `Co-Authored-By`,
- git identita je nastavená lokálne v repe (`hanrider`, noreply e-mail účtu Hanrider8), nemeň ju,
- `gh` je prihlásené ako Hanrider8.

## Príkazy

Projekt potrebuje **Node 24** (`.nvmrc`). Vitest 5 na Node 20 nefunguje.

```bash
nvm use                # alebo v neinteraktívnom shelli: export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
npm ci
npm run dev:usb        # HTTP na :5173 – emulátor v prehliadači na PC aj `adb reverse` pre Quest
npm run dev            # HTTPS (self-signed) na :5173 v LAN pre Quest
npm test               # Vitest (len core logika, prostredie node)
npx vitest run tests/spawner.test.ts   # jeden súbor
npm run typecheck      # tsc --noEmit (TypeScript 7, natívny tsc)
npm run build          # produkčný build do dist/ (bez IWER a dev nástrojov)
npm run check          # typecheck + test + build
```

## Architektúra

```
src/config.ts   VŠETKY laditeľné konštanty (rozmery, rýchlosti, dwell, mix prekážok, spravodlivosť)
src/core/       čistá logika: bez three.js a DOM, deterministická, fixný krok 1/120 s, bez alokácií v update
  game.ts       stavový automat SETUP/READY/COUNTDOWN/PLAYING/PAUSED/GAME_OVER + podpanely, fixný krok
  gaze.ts       dwell, hysteréza, grace, cooldown, „arming“ tlačidiel, kurzor
  layout.ts     pozície panelov a tlačidiel (v stupňoch od kotvy; predná kotva a kotva pauzy)
  sim.ts        GameplaySim: pohyb a spawn prekážok, swept kolízie hlavy, životy, skóre (krokuje sa len v PLAYING)
  obstacles.ts  typy prekážok, kolízne kvádre obrancov, vzory na zemi (elemDz/elemX/elemPuckX), pokeCheckCenter
  spawner.ts    výber vĺn (mix podľa config.spawn) + pravidlá spravodlivosti
  collision.ts  swept guľa hlavy vs. AABB (zlatý rez na konvexnej funkcii)
  settings.ts   nastavenia a rekordy cez rozhranie KeyValueStorage (localStorage / MemoryStorage)
  playFrame.ts  herný priestor ↔ svet (centrovanie: pozícia + yaw hlavy)
  events.ts     predalokovaný ring buffer udalostí (core → audio a efekty)
src/xr/         session (immersive-ar, foveation, 90 Hz), póza hlavy z XRFrame, strata trackingu, ignorovanie vstupov
src/render/     scéna, plocha pre puk (len mimo hrania, dráha voliteľná), meshe prekážok (pooly), kurzor, vinieta
src/ui/         tlačidlá a panely (CanvasTexture), HUD, debug overlay, strings.ts (všetky texty, SK)
src/audio/      syntetizované zvuky (Web Audio, žiadne súbory)
src/dev/        LEN DEV (dynamický import, nie je v dist/): IWER emulátor, window.__dr, autopilot demo.ts
src/app.ts      slučka: XRFrame → hlava → Game.update → events → render/ui → renderer.render
```

Kľúčové invarianty:

- **Herný priestor:** počiatok je na podlahe pod hlavou pri centrovaní, −Z je smer hry, +X doprava. V renderi mu
  zodpovedá skupina `playRoot`. Prekážky aj tlačidlá sú world-locked voči ploche, nie voči hlave.
- **Pauza = simulácia sa nekrokuje.** Pokračovanie musí byť presne deterministické. Test
  `pauseResume.test.ts` porovnáva beh s pauzou a bez nej. V core nepoužívaj `Math.random`, `Date` ani časy snímok,
  iba seedovaný `Rng`.
- **Hlava** sa číta priamo z `XRFrame.getViewerPose`, nie z kamery three.js (tá je o snímok pozadu).
  `renderer.setAnimationLoop` sa musí nastaviť **pred** `setSession`, inak beží slučka dvakrát za snímok.
- **Bez alokácií v hernej slučke:** pooly, predalokované vektory a CanvasTexture sa prekresľuje len pri zmene.
  Cieľ je 72–90 FPS na Queste.
- **Poistky proti samovoľnému spusteniu:**
  - po aktivácii (a po vycentrovaní, `gaze.holdOff`) sa tlačidlo pod pohľadom plní, až keď z neho pohľad odíde,
  - Pauza má `requireEntry`,
  - rozostupy tlačidiel sú aspoň 2 × hysteréza (test).
- **Vzory na zemi** (slalom, hviezdy, široké miesanie): prvky sú za čelom prekážky (`elemDz ≤ 0`).
  Prekážka je prekonaná a zmizne podľa posledného prvku (`z − length`). Prvky ďalej ako `spawnDistance` render skryje.
- **Pohyblivá hokejka** závisí len od `z` (`pokeCheckCenter`), takže ju pauza zmrazí. Presun skončí `settleTime`
  pred príchodom k puku.

## Typické úlohy

**Nová prekážka na zemi:**
1. `core/types.ts`: pridaj `FloorKind`.
2. `config.ts`: `obstacles.<typ>`, `spawn.floorWeights`, `difficulty.unlock`.
3. `core/obstacles.ts`: funkcia `make<Typ>` (vyplní prvky a `elemPuckX`).
4. `core/spawner.ts`: vetva v `sampleFloor`, nastav `firstPuckX`, `lastPuckX`, `floorCount` a `floorElementTime`.
5. `core/sim.ts`: vetva v `spawnWave`.
6. `render/obstacleViews.ts`: pohľad (+ `materials.ts`) a záznam v `make` mape.
7. Testy:
   - `tests/spawner.test.ts`: `puckPath` v nezávislom checkeri,
   - `tests/obstacles.test.ts`.
8. `dev/hooks.ts`: vetva v `__dr.place`.

**Nové tlačidlo alebo panel:**
1. `types.ts`: `ButtonId`.
2. `core/layout.ts`: `computeLayout` (dodrž rozostupy).
3. `core/game.ts`: `onButton`.
4. `ui/panels.ts`: `buttonLabel`.
5. Text daj do `ui/strings.ts`.

**Ladenie hrateľnosti:** meň len `src/config.ts`, napríklad `spawn.*`, `obstacles.*`, `difficulty.*`, `gaze.*` alebo
`pauseButton.*`. Testy čítajú hodnoty z configu, kde sa dá. Po zmene spusti `npm test`, lebo property test
spravodlivosti odhalí nesplniteľné kombinácie.

## Overenie bez headsetu (emulátor)

`npm run dev:usb` → http://localhost:5173 → klik na „Spustiť“. Emulátor IWER sa nainštaluje len tam, kde chýba
natívne `immersive-ar`, takže na Queste nie.

- `?demo=1` sám spustí session a **autopilota**: hrá v reálnom čase a ukazuje virtuálny puk.
- `?debug=1` zapne debug overlay (FPS, stav, uhol pohľadu, draw cally).
- `?iwer=0` vypne emulátor.

Skriptovanie cez `window.__dr`:

| Volanie | Čo robí |
|---|---|
| `state`, `sub`, `layout`, `buttons()` | stav hry a aktívne tlačidlá |
| `lookAt('start')`, `look(yaw, pitch)`, `moveTo(x, y, z)` | ovládanie emulovaného headsetu |
| `advance(sekundy)` | posunie hru bez čakania na snímky (deterministicky) |
| `place('slalom', -3, strana)`, `clearObstacles()` | konkrétne prekážky na vizuálnu kontrolu |
| `trackingLoss(true)`, `device.updateVisibilityState('visible-blurred')` | auto-pauza |
| `log()`, `snapshot()`, `demo(true/false)` | záznam udalostí, stav simulácie, autopilot |

Statické zábery je najlepšie robiť v pauze (`game.autoPause('visibility')`), lebo prekážky stoja.

## Nástrahy

- TypeScript 7 (natívny `tsc`) so `strict`, `noUnused*` a `verbatimModuleSyntax`: importy typov píš ako `import type`.
- `@iwer/devui` si ťahá vlastné three.js, preto je v `package.json` `overrides` na jednu verziu.
- Vite má `base: './'`, takže build funguje aj na GitHub Pages v podadresári.
- Žiadne externé assety: geometrie z primitív, textúry kreslené do canvasu, zvuky syntetizované.
- Quest potrebuje HTTPS alebo localhost. Na USB slúži `npm run dev:usb` + `adb reverse tcp:5173 tcp:5173`.
