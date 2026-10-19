# AGENTS.md – DangleRush MR

Návod pre AI agentov (Claude Code, Codex, Cursor…), ako na tomto repe pracovať rýchlo a bez rozbitia hry.
Používateľ komunikuje po slovensky; po slovensky sú aj texty v hre, komentáre v kóde a commit správy.

## Čo to je

Hokejový drill pre **Meta Quest 3** vo WebXR s passthrough (`immersive-ar` + `local-floor`).
Hráč mieša skutočný puk skutočnou hokejkou a prevádza ho cez virtuálne prekážky na zemi. Občas uhne
obrancovi. Platia tieto obmedzenia:

- Hra pozná **pózu headsetu**. Puk vidí len so sledovaním kamerou (`?cam=1`): vtedy dostáva `PuckSample` a prvky
  na zemi posudzuje (úspech / minutie). Bez kamery sa prvky len počítajú. Hokejku nevidí nikdy.
- **Hlava hore** (nastavenie, predvolene zap): ďaleko vpredu sa občas objaví spoluhráč a čaká, kým sa naňho hráč
  pozrie. Kým čaká, obraz stále viac tmavne a bliká. Pohľad naňho vráti všetko do normálu.
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
  difficulty.ts levelParams: 5 pevných úrovní (warmup/easy/medium/hard/pro) z config.difficulty.levels
  headUp.ts     HeadUpDrill (hlava hore): spoluhráč nad horizontom čaká na pohľad; escalation(), darkness(),
                spread(), blink(), pripomenutia signalNag
  obstacles.ts  typy prekážok, kolízne kvádre obrancov, vzory na zemi (elemDz/elemX/elemPuckX), pokeCheckCenter
  spawner.ts    výber vĺn (mix podľa config.spawn) + pravidlá spravodlivosti
  collision.ts  swept guľa hlavy vs. AABB (zlatý rez na konvexnej funkcii)
  settings.ts   nastavenia a rekordy cez rozhranie KeyValueStorage (localStorage / MemoryStorage)
  playFrame.ts  herný priestor ↔ svet (centrovanie: pozícia + yaw hlavy)
  events.ts     predalokovaný ring buffer udalostí (core → audio a efekty); floorHit/floorMiss/floorPass majú
                n = id prekážky × MAX_ELEMENTS + prvok, passBody n = id prekážky, signal/signalSeen
                n = poradie spoluhráča, signalNag n = eskalácia v %
src/tracking/   čistá logika sledovania puku kamerou (bez DOM, testy v tests/tracking*, calibration.test.ts,
                colorLearn.test.ts)
  detector.ts   farebná škvrna v RGBA (HSV prah + súvislé oblasti), zelený biscuit / oranžová loptička
  colorLearn.ts naučenie farby puku ťuknutím v náhľade: zárodok, rast oblasti, profil s najmenej pixelmi mimo puku
  cameraModel.ts dierková komora pripevnená k hlave: pixel ↔ lúč, priesečník s podlahou, záber na podlahe
  calibration.ts samokalibrácia z nehybného puku (Levenberg–Marquardt: f, stred, natočenie, poloha, oneskorenie)
  poseHistory.ts história pózy hlavy (póza v čase zachytenia snímky), timeSync.ts časové značky kamery → čas
  yuv.ts        zmenšenie snímky I420/NV12 priamo do malého RGBA (Quest dáva I420; canvas trval ~20 ms)
src/camera/     test `?cam=1` (dynamický import, vlastný chunk): getUserMedia + MediaStreamTrackProcessor,
                frameWorker (hľadanie puku), calibWorker, tracker (premietnutie, kalibrácia), view (krúžok,
                záber, panel), report (správa pre vývoj), cameraTest (úvodná stránka + App.frameHooks)
src/xr/         session (immersive-ar, foveation), frameRate.ts (72/90/120 Hz podľa nastavení, automatický
                ústup o stupeň, keď hra nestíha), póza hlavy z XRFrame,
                strata trackingu, ignorovanie vstupov
src/render/     scéna, plocha pre puk (len mimo hrania, dráha voliteľná), meshe prekážok (pooly), kurzor, vinieta,
                feedback.ts (duch posúdeného prvku: cyan úspech + krúžok, sivé minutie), materials.ts (paleta,
                holoMaterial: unlit ShaderMaterial s tieňovaním a fresnel okrajom, bez svetiel; markery, terče,
                hokejisti z primitív s farbami vo vertexoch, jeden draw call), headUp.ts (spoluhráč so značkou, zatmavenie:
                guľa okolo hlavy natočená voči svetu, shader podľa elevácie a okna okolo spoluhráča)
src/ui/         tlačidlá a panely (CanvasTexture), HUD, debug overlay, strings.ts (všetky texty, SK)
src/audio/      syntetizované zvuky (Web Audio, žiadne súbory)
src/dev/        LEN DEV (dynamický import, nie je v dist/): IWER emulátor, window.__dr, autopilot demo.ts,
                camSim.ts (virtuálna kamera pre `?cam=1&camsim=1`)
src/app.ts      slučka: XRFrame → hlava → Game.update → events → render/ui → renderer.render
```

Kľúčové invarianty:

- **Herný priestor:** počiatok je na podlahe pod hlavou pri centrovaní, −Z je smer hry, +X doprava. V renderi mu
  zodpovedá skupina `playRoot`. Prekážky aj tlačidlá sú world-locked voči ploche, nie voči hlave.
- **Pauza = simulácia sa nekrokuje.** Pokračovanie musí byť presne deterministické. Test
  `pauseResume.test.ts` porovnáva beh s pauzou a bez nej. V core nepoužívaj `Math.random`, `Date` ani časy snímok,
  iba seedovaný `Rng`.
- **Obnovovacia frekvencia:** Quest spúšťa WebXR na 72 Hz. `updateTargetFrameRate` sa volá až počas XR snímkov
  (`FrameRateControl.onFrame`), kým `session.frameRate` nehlási cieľ; volanie hneď po štarte session sa na Queste
  nemusí nikdy dokončiť. Predvolené je 90 Hz (nastavenie „Snímky“), použije sa najbližšia podporovaná. Keď je
  v okne 3 s viac ako 5 % snímok neskoro, frekvencia sa zníži o stupeň (najnižšie 72 Hz) do konca session.
- **Výkon:** voľné pohľady z poolov prekážok nie sú v scéne (`root.add`/`remove` pri bind/recycle), shadery sa
  skompilujú vopred (`App.precompile`), HUD a debug majú textúru bez mipmáp (`DYNAMIC_TEXTURE`) a HUD sa kvôli
  skóre a času prekreslí najviac 2× za sekundu. Žiara okolo puku z kamery je počas hrania vypnutá
  (`camera.ring.showWhilePlaying`), lebo sa s oneskorením ťahá za pukom.
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
- **Obtiažnosť je pevná:** `sim.reset` nastaví `level`, `speed` a `interval` podľa úrovne a `step` ich nemení
  (hra sa nezrýchľuje). Rekordy sú v `dangleRush.best.v2` pre každú úroveň.
- **Pohyblivá hokejka** závisí len od `z` (`pokeCheckCenter`), takže ju pauza zmrazí. Presun skončí `settleTime`
  pred príchodom k puku.
- **Posúdenie puku** (`sim.judgeFloor`): puk je vstup ako póza hlavy (`Game.update(dt, head, puck)`), takže pauza
  aj determinizmus platia. Kamera vidí puk s oneskorením `puck.age`: prvok sa posúdi, keď v čase zachytenia už
  prešiel čiarou puku (`z − speed·age ≥ puck.z`), podľa `puckPassesElement`. Výsledok je v `o.elemResult[i]`
  (render posúdený prvok skryje). Úspech: body `puck.scorePerHit` × násobiteľ a combo; minutie combo vynuluje.
  Bez puku prvok len prejde stredom plochy (ELEM_UNKNOWN, udalosť floorPass).
- **Hlava hore** (`sim.headUp`, `config.headUp`): krokuje sa v `sim.step`, takže pauza ju zmrazí. Má vlastný
  seedovaný `Rng`, takže spawner dostane rovnakú postupnosť vĺn ako bez nej. Smer pohľadu ide do simulácie ako
  vstup (`Game.headFwd`).
  - **Spoluhráč:** pri pohľade hore kamera stratí puk, preto príde len v medzere (žiadny prvok na zemi
    k čiare puku skôr ako `clearTime`, najneskôr `maxWait`). Stojí na `|azimut|` 9–30° a elevácii ~2°, teda mimo
    HUD a ďaleko od Pauzy (test). Nezmizne sám, čaká, kým sa naňho hráč pozrie.
  - **Eskalácia** (0–1, len z `age`, takže ju pauza zmrazí): začne po `graceTime`, naplno je po `escalateTime`.
    - tma `darkness()` až po `maxDarkness` (passthrough nikdy úplne nezčernie),
    - šírenie `spread()`: horná hranica tmy stúpa od `spreadStartDeg` (podlaha) po `spreadEndDeg`,
    - blikanie `blink()` s frekvenciou `blinkHzMin`–`blinkHzMax` (pod 3 Hz), pripomenutia `signalNag`,
    - okno `clearWindowDeg` okolo spoluhráča ostane svetlé; tlačidlá a HUD sa kreslia nad tmou.
  - Zachytený = pohľad do `lookAngleDeg` aspoň `lookTime`. Dá `scorePerSignal` × násobiteľ × `scoreFactor()`
    (neskorý pohľad až `lateScoreFactor`) a combo. Výsledok hry má počet a priemernú reakciu.
  - Priame testy simulácie (`sim.reset` bez 5. parametra) majú hlavu hore vypnutú.
- **Test kamery (`?cam=1`)** hru nevyhodnocuje a bez parametra sa vôbec nenačíta. Kamera headsetu ide cez
  `getUserMedia` (povolenie „Kamery headsetu“ v Quest Browseri, dá sa udeliť len mimo AR). Puk leží na zemi,
  takže stačí jedna kamera: lúč z pixelu × rovina vo výške stredu puku. Póza hlavy sa berie v čase zachytenia
  (`TimeSync` + oneskorenie z kalibrácie). Kalibrácia sa ukladá do localStorage podľa názvu kamery a rozlíšenia.
  Farba cieľa je predvolená z `config.camera.targets`, alebo naučená ťuknutím na puk v náhľade na úvodnej stránke
  (worker ju zistí z najbližšej snímky, `learnColor`). Naučená farba sa pamätá pre každý cieľ zvlášť
  (`dangleRush.camTest.v1`, pole `colors`). Na fotke hráčovej lososovej loptičky mala loptička odtieň ~10–20° a
  sýtosť ~0,4–0,7, tieň pod ňou ~20–28° a sýtosť ~0,25, podlaha (sivý laminát) sýtosť do ~0,2.
  Namerané na Queste 3 (Quest Browser 150): kamery `camera 1/2, facing back` (ľavá/pravá), 1280 × 1280 @ 30 fps,
  I420, f ≈ 862 px, sklon −10,8°, oneskorenie ≈ 44 ms (predvolený odhad v `config.camera.guess`). Panel testu sa
  počas hry skrýva (nahrávanie veľkej CanvasTexture trhalo hru); správa meria plynulosť XR snímok (`FrameStats`).

**Vzhľad („športová technológia“):** paleta je v `render/materials.ts` (`PALETTE`, `TEAMS`) a `ui/canvasPanel.ts`
(`COLORS`, `FONT_FAMILY` = Roboto Condensed na Queste). Biela, akcent cyan (puk, spoluhráč, úspech), červená len obrancovia
a zásah, jantárová pauza. Scéna nemá svetlá: nové pevné objekty kresli cez `holoMaterial`, ploché cez `MeshBasicMaterial`.

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
9. `core/obstacles.ts`: vetva v `puckPassesElement` a `render/feedback.ts`: duch prvku v `spawn`.

**Nové tlačidlo alebo panel:**
1. `types.ts`: `ButtonId`.
2. `core/layout.ts`: `computeLayout` (dodrž rozostupy).
3. `core/game.ts`: `onButton`.
4. `ui/panels.ts`: `buttonLabel`.
5. Text daj do `ui/strings.ts`.

**Ladenie hrateľnosti:** meň len `src/config.ts`, napríklad `spawn.*`, `obstacles.*`, `difficulty.*`, `gaze.*`,
`pauseButton.*` alebo `headUp.*`. Testy čítajú hodnoty z configu, kde sa dá. Po zmene spusti `npm test`, lebo property test
spravodlivosti odhalí nesplniteľné kombinácie.

## Overenie bez headsetu (emulátor)

`npm run dev:usb` → http://localhost:5173 → klik na „Spustiť“. Emulátor IWER sa nainštaluje len tam, kde chýba
natívne `immersive-ar`, takže na Queste nie.

- `?demo=1` sám spustí session a **autopilota**: hrá v reálnom čase, ukazuje virtuálny puk a na spoluhráča sa pozrie
  po ~2 s (ukážka začiatku eskalácie).
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
| `log()`, `snapshot()`, `demo(true/false)` | záznam udalostí, stav simulácie, autopilot (posiela hre virtuálny puk) |
| `demoPuckOffset(0.5)`, `app.puckSource = (now, out) => …` | ukážka minutí, vlastný puk pre spätnú väzbu |
| `signal(az)`, `mateAge(s)` | hlava hore: hneď spoluhráč, čakanie s sekúnd = eskalácia (tma len v PLAYING) |

Statické zábery je najlepšie robiť v pauze (`game.autoPause('visibility')`), lebo prekážky stoja.

**Test kamery bez headsetu:** `?cam=1&camsim=1&debug=1` nahradí kameru virtuálnou kamerou (`dev/camSim.ts`, známe
parametre v `SIM_CAMERA`), ktorá kreslí zelený biscuit na drevenej podlahe z pohľadu emulovanej hlavy
(`&camball=orange` lososovú loptičku; v teste vyber „Oranžová loptička“). Naučenie farby: klik na loptičku
v `#cam-preview` (pozri sa na ňu, napr. `__dr.look(-9, -55)`), výsledok je v `#cam-status` a v správe. Postup:
„Povoliť kameru“ → „Spustiť“ → kalibrácia výšky → asi 14 s pozerať okolo biscuitu (`__dr.look` v requestAnimationFrame)
→ `__drCam.tracker.paramsSource === 'kalibrácia'` a `__drCam.tracker.puck.playX/Z` blízko `__dr.camSim.ball`.
`__drCam.report()` vráti textovú správu. V headless Chromiu (SwiftShader) pred „Spustiť“ zmenši framebuffer
`__dr.app.renderer.xr.setFramebufferScaleFactor(0.2)`, inak má história pózy medzery nad 100 ms a kalibrácia nemá
z čoho počítať. `?cammstp=0` vynúti záložnú cestu cez `<video>`.

## Nástrahy

- TypeScript 7 (natívny `tsc`) so `strict`, `noUnused*` a `verbatimModuleSyntax`: importy typov píš ako `import type`.
- `@iwer/devui` si ťahá vlastné three.js, preto je v `package.json` `overrides` na jednu verziu.
- Vite má `base: './'`, takže build funguje aj na GitHub Pages v podadresári.
- Žiadne externé assety: geometrie z primitív, textúry kreslené do canvasu, zvuky syntetizované.
- Quest potrebuje HTTPS alebo localhost. Na USB slúži `npm run dev:usb` + `adb reverse tcp:5173 tcp:5173`.
