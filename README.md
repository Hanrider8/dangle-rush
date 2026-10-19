# DangleRush MR

Hokejový drill v mixed reality pre **Meta Quest 3** (WebXR, passthrough). Stojíš so skutočnou hokejkou, miešaš skutočný puk po podlahe a prevádzaš ho cez virtuálne prekážky. Hra pozná iba pózu headsetu a ovláda sa **pohľadom**: pozrieš sa na tlačidlo a chvíľu podržíš pohľad. Ruky tak ostávajú na hokejke.

Hra trénuje hlavne **miešanie puku**. Väčšina vĺn sú prekážky na zemi, obrancovia prídu len občas.

- **Prekážky na zemi** ukazujú, kam s pukom. Modrá farba na zemi (ako modrá čiara na ľade) vždy označuje, kadiaľ má ísť puk. Bez kamery hra puk nevidí a prekážky len počíta (počítadlo „Puk“ v HUD). So sledovaním puku kamerou (pozri nižšie) každý prvok posúdi: keď ním puk prejde, prvok zozelenie, zmizne a zaznie tón (body a combo); minutý prvok zošedne:
  - brána z dvoch oranžových tréningových kužeľov,
  - nízka hokejka na zemi z jednej strany,
  - slalom: 3–5 kužeľov v rade, puk ich obchádza striedavo zľava a sprava,
  - puky na červených bodoch buly (v kóde „hviezdy“), cez ktoré prevedieš svoj puk,
  - široké miesanie: brána úplne na jednej strane a hneď nato na druhej,
  - pohyblivá hokejka obrancu (poke check), ktorá sa po zemi presunie na druhú stranu, a puk musíš stiahnuť do medzery, ktorá sa otvorí.
- **Obrancovia** (hokejisti súpera v červených dresoch) sa vyhodnocujú podľa polohy hlavy; obídený obranca sa zosunie do podlahy:
  - jeden obranca: úkrok alebo náklon na druhú stranu,
  - dvaja obrancovia: hlavou cez medzeru.
- **Hlava hore** (v nastaveniach, predvolene zap): ďaleko vpredu sa občas objaví spoluhráč v bielom domácom drese so značkou nad hlavou a čaká, kým sa naňho pozrieš. Kým sa nepozrieš, obraz stále viac tmavne (najprv podlaha, potom takmer všetko okrem spoluhráča), bliká a ozýva sa píšťalka. Pohľad naňho vráti všetko do normálu; čím skôr, tým viac bodov.
- **Obtiažnosť** (v nastaveniach) má 5 pevných úrovní a počas hry sa nič nezrýchľuje:

  | Úroveň | Rýchlosť | Vlna každých | Prekážky |
  |---|---|---|---|
  | Rozcvička | 1,5 m/s | 2,6 s | brány, hviezdy, nízka tyč |
  | Ľahká (predvolená) | 2,0 m/s | 2,2 s | + slalom, široké miesanie, jeden obranca |
  | Stredná | 2,7 m/s | 1,8 s | + poke check, dvaja obrancovia, kombinácie |
  | Ťažká | 3,5 m/s | 1,4 s | všetko |
  | Pro | 4,5 m/s | 1,1 s | všetko, najviac obrancov |

  Zmena platí od novej hry a rekord sa vedie pre každú úroveň zvlášť.
- Máš 3 životy a strácaš ich len pri zásahu obrancom. Skóre rastie za obídených obrancov (combo násobiteľ) a za čas prežitia.
- Vysoká tyč (zohýbanie) je v hre stále naprogramovaná, ale v predvolenom mixe je vypnutá (`spawn.bodyWeights.highBar` v configu).

**Vzhľad:** hokejisti v dresoch s číslami, tréningové kužele, puky a hokejky majú fyzikálne materiály (PBR) s osvetlením z prostredia. Všetko je stále poskladané z primitív v kóde (bez 3D modelov), takže to nie je úroveň hier s profesionálnymi modelmi. Menu a HUD sú v štýle televízneho prenosu (tmavomodrá, biela, zlatá, červený pás).

Technológie: Three.js, TypeScript, Vite a Vitest. Na vývoj bez headsetu slúži IWER (emulátor WebXR od Meta). Zvuky sú syntetizované cez Web Audio a modely poskladané z primitív, takže hra nepoužíva žiadne externé assety.

## Ako spustiť hru lokálne

Potrebuješ Node.js 24 LTS (verzia je v `.nvmrc`) a npm.

```bash
nvm use
```

```bash
npm install
```

```bash
npm run dev:usb
```

Otvor http://localhost:5173. Na počítači sa automaticky zapne emulátor IWER (Meta Quest 3).

- Klikni na **Spustiť**. Headset a ovládače ovládaš v paneli DevUI, kde je aj „play mode“ s myšou a klávesnicou.
- `?demo=1` spustí ukážku: AR session aj autopilota, ktorý hrá sám a ukazuje virtuálny puk.
- `?iwer=0` emulátor vypne.
- `?debug=1` zapne debug overlay. Na počítači ho prepína aj kláves `` ` `` alebo F2.
- V dev režime je v konzole objekt `window.__dr` na skriptované testovanie, napríklad `__dr.lookAt('start')`, `__dr.advance(1.5)`, `__dr.state` alebo `__dr.place('slalom', -3, 1)`.

Ďalšie príkazy:

| Príkaz | Čo robí |
|---|---|
| `npm run dev` | dev server cez HTTPS na všetkých rozhraniach (pre Quest v lokálnej sieti) |
| `npm run dev:usb` | dev server cez HTTP na porte 5173 (pre `adb reverse` a emulátor) |
| `npm test` | unit testy hernej logiky (Vitest) |
| `npm run typecheck` | kontrola typov (`tsc --noEmit`) |
| `npm run build` | produkčný build do `dist/` (bez IWER) |
| `npm run preview` | náhľad produkčného buildu cez HTTPS na porte 4173 |
| `npm run check` | typecheck, testy aj build naraz |

## Ako otvoriť hru na Queste

WebXR vyžaduje secure context, teda HTTPS alebo `localhost`. Sú dve možnosti.

### a) Cez USB a `adb reverse`

1. Zapni na Queste režim pre vývojárov: v aplikácii Meta Horizon v telefóne otvor **Zariadenia → Nastavenia headsetu → Režim pre vývojárov**.
2. Nainštaluj adb (na Macu):
   ```bash
   brew install --cask android-platform-tools
   ```
3. Prepoj Quest s počítačom USB-C káblom a v headsete povoľ USB ladenie. Over, že ho adb vidí:
   ```bash
   adb devices
   ```
4. Spusti dev server:
   ```bash
   npm run dev:usb
   ```
5. Presmeruj port z Questu na počítač:
   ```bash
   adb reverse tcp:5173 tcp:5173
   ```
6. V prehliadači Meta Quest Browser otvor **http://localhost:5173**.

Na Queste sa emulátor nezapne, lebo ten sa inštaluje len tam, kde chýba natívne `immersive-ar`.

### b) Cez HTTPS v lokálnej sieti

1. Spusti dev server:
   ```bash
   npm run dev
   ```
   Vite vypíše adresu typu `Network: https://192.168.x.y:5173`.
2. Quest a počítač musia byť v tej istej Wi-Fi sieti.
3. V Meta Quest Browseri otvor túto adresu. Certifikát je self-signed, preto prehliadač zobrazí varovanie. Zvoľ **Rozšírené → Pokračovať**.

## Ako nasadiť hru na GitHub Pages cez GitHub Actions

Workflow je pripravený v [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Pri pushi do vetvy `main` spustí typecheck, testy a build a nasadí `dist/` na GitHub Pages.

1. Na GitHube vytvor repozitár, napríklad `dangle-rush`, a pushni doň projekt:
   ```bash
   git remote add origin git@github.com:<používateľ>/dangle-rush.git
   ```
   ```bash
   git push -u origin main
   ```
2. V repozitári otvor **Settings → Pages** a ako **Source** nastav **GitHub Actions**.
3. Po dobehnutí workflowu (záložka **Actions**) beží hra na `https://<používateľ>.github.io/dangle-rush/`. Je to HTTPS, takže ju Quest otvorí priamo, bez dev servera.

Build používa relatívne cesty (`base: './'`), preto funguje v ľubovoľnom podadresári. GitHub Pages pre súkromný repozitár vyžaduje platený plán, pri bezplatnom účte použi verejný repozitár.

## Ako začať hrať

1. Otvor stránku na Queste.
2. Raz klikni ovládačom na **Spustiť**. WebXR na otvorenie AR session vyžaduje gesto používateľa.
3. **Ovládače odlož.** Ďalej sa všetko ovláda pohľadom.
4. Pri prvom spustení sa postav vzpriamene a pozri sa na tlačidlo **Kalibrovať**. Hra si uloží výšku tvojej hlavy a vycentruje plochu podľa smeru tvojho pohľadu.
5. Chyť hokejku a polož puk do **stredu plochy** (krúžok na priesvitnej ploche pred tebou).
6. Pozri sa na **Štart** a podrž pohľad, kým sa nenaplní kruh. Po odpočte začnú prichádzať prekážky.
7. **Pauza** je bokom vo výške očí, 60° od smeru hry (predvolene vpravo). V pauze sú tlačidlá Pokračovať, Nová hra, Vycentrovať a Nastavenia.

Ďalšie ovládanie:

- **Vycentrovať** dá 3 sekundy na otočenie sa smerom hry a potom presunie plochu.
- **Nastavenia** sa ukladajú v prehliadači: čas pohľadu, strana a poloha pauzy (bok alebo hore), obtiažnosť, prekážky na zemi, dĺžka odpočtu, nová kalibrácia, debug a **Snímky** (obnovovacia frekvencia 72 / 90 / 120 Hz, predvolene 90 Hz; ak ju hra nestíha, sama sa zníži o stupeň, debug overlay ukazuje skutočnú, napr. „90 Hz (auto z 120)“). So sledovaním puku pribudne **Kalibrácia puku**.
- Hra sa sama pozastaví, keď otvoríš Quest menu, keď sa stratí tracking alebo keď sa zmení priestor.

## Sledovanie puku kamerou

Kamera headsetu sleduje zelený biscuit alebo oranžovú loptičku a hra podľa toho posudzuje prekážky na zemi.
Je to priamo na **https://hanrider8.github.io/dangle-rush/**, bez parametra (`?cam=0` sledovanie vypne). Kým
nepovolíš kameru, hra beží bez nej.

1. Na úvodnej stránke vyber, čo sledovať (najlepšie **zelený biscuit**: na svetlom dreve je zelená výrazná, oranžová
   má podobný odtieň ako drevo), a klikni na **Povoliť kameru**. Povolenie „Kamery headsetu“ sa dá dať len tu, nie v AR.
2. V náhľade má byť puk fialový a v žltom krúžku.
3. Klikni na **Spustiť**. Okolo puku na podlahe jemne svieti žiara. Ak nesedí na puku, otvor **Nastavenia →
   Kalibrácia puku**: polož puk asi meter pred seba a asi 10 sekúnd sa pomaly pozeraj okolo neho (vľavo, vpravo,
   bližšie, ďalej). Panel ukáže náhľad kamery a stav, modrý obrys to, čo kamera vidí. Kalibrácia sa uloží.
4. Pri hre: prvok, ktorým puk prešiel (brána, hviezda, správna strana kužeľa, medzera pri tyči), zozelenie, zmizne
   a zaznie tón, ktorý v sérii stúpa. Minutý prvok zošedne a combo sa vynuluje. HUD ukazuje „Puk úspechy/všetky“.
5. Dole na stránke je **Správa z testu kamery** pre vývoj (plynulosť snímok, kamera, kalibrácia).

## Bezpečnosť

- Uvoľni **voľný priestor aspoň 2,5 × 2,5 m**.
- **Guardian (hranicu) nevypínaj.**
- Pozor na nábytok, televízor, lampy, okná a ľudí okolo, hlavne pri švihoch hokejkou.
- Plocha musí ležať na skutočnej podlahe. Ak „pláva“ alebo je pod podlahou, nastav v Queste znova výšku podlahy (Guardian).
- Pri závrate alebo nevoľnosti prestaň hrať.
- Ak máš zapnuté automatické prepínanie na sledovanie rúk, gesto otvorenia menu môže pri držaní hokejky hru občas pozastaviť. Ak to prekáža, vypni ho v nastaveniach Questu.

## Ladenie konštánt

Všetky laditeľné hodnoty sú v [`src/config.ts`](src/config.ts). Ako prvé sa oplatí ladiť:

| Konštanta | Predvolená hodnota | Kedy ju meniť |
|---|---|---|
| `gaze.dwellTime` | 1,2 s | Tlačidlá reagujú pomaly alebo sa aktivujú omylom (dá sa meniť aj v Nastaveniach). |
| `gaze.hysteresisDeg`, `gaze.graceTime` | 3°, 150 ms | Plnenie sa prerušuje pri chvení hlavy. |
| `pauseButton.sideAzimuthDeg` | 60° | Pauza je príliš na očiach alebo sa naň ťažko pozerá. |
| `pauseButton.topElevationDeg` | 35° | Pauza v polohe „hore“ je príliš vysoko alebo nízko. |
| `pauseButton.distance` | 1,6 m | Pauza je príliš blízko alebo ďaleko. |
| `ui.buttonDeg` | 11° × 4,5° | Tlačidlá sú príliš veľké alebo malé. |
| `ui.minButtonGapDeg` | 7° | Pohľad trafí susedné tlačidlo. |
| `head.radius` | 12 cm | Zásahy prichádzajú príliš ľahko alebo príliš ťažko. |
| `spawn.bodyShareMin`, `.bodyShareMax` | 12 % → 25 % | Ako často príde obranca (zvyšok sú prekážky na zemi). |
| `spawn.floorWeights` | — | Pomer typov prekážok na zemi (slalom, hviezdy, široké miesanie…). |
| `spawn.bodyWeights.highBar` | 0 | Kladná hodnota zapne vysokú tyč (zohýbanie). |
| `obstacles.slalom`, `.stars`, `.wideDangle`, `.pokeCheck` | — | Počty prvkov, rozostupy (časy medzi prvkami) a šírky vzorov. |
| `fairness.maxPuckShiftSpeed` | 1,5 m/s | Ako rýchlo musíš najviac presúvať puk medzi prekážkami. |
| `obstacles.sideBlock.innerX` | 0,1 m | Aký veľký úkrok je pri obrancovi potrebný. |
| `playArea.width`, `.depth`, `.centerDistance` | 1,5 × 1,0 m, 0,55 m | Rozmery a poloha plochy pre puk (šírka obmedzuje aj bočné posuny prekážok). |
| `puck.*` | — | Tolerancie posudzovania puku (brána, hviezda, slalom) a body za prvok. |
| `playArea.showWhilePlaying`, `.showTrack` | vyp, vyp | Plocha aj počas hrania; čiary dráhy k miestu spawnu. |
| `difficulty.levels` | 1,5–4,5 m/s | Pevné úrovne: rýchlosť, interval medzi vlnami a `level` (odomykanie typov, podiel obrancov). |

## Štruktúra projektu

```
src/
├── config.ts      všetky laditeľné konštanty
├── main.ts        úvodná stránka, štart AR session (gesto „Spustiť“)
├── app.ts         zapojenie: XR → hra → udalosti (zvuk, efekty) → render a UI
├── core/          čistá herná logika bez three.js a DOM: stavový automat, pohľad (dwell),
│                  rozloženie tlačidiel, spawn a spravodlivosť, swept kolízie, skóre,
│                  obtiažnosť, nastavenia; deterministická, s fixným krokom 1/120 s
├── tracking/      sledovanie puku kamerou: hľadanie farebného puku, model kamery, samokalibrácia
├── camera/        sledovanie puku kamerou (getUserMedia, workery, krúžok a panel v AR, správa)
├── xr/            session (immersive-ar + local-floor), póza hlavy, strata trackingu,
│                  ignorovanie vstupov z ovládačov a rúk
├── render/        scéna, plocha pre puk, meshe prekážok, kurzor pohľadu, vinieta
├── ui/            tlačidlá a panely v priestore (CanvasTexture), HUD, debug overlay, texty
├── audio/         zvuky syntetizované cez Web Audio API
└── dev/           len pre vývoj: IWER a nástroje na skriptované testovanie
tests/             unit testy (Vitest)
```

## Testy

`npm test` spustí unit testy hernej logiky:

- dwell, hysteréza, krátke výpadky pohľadu, cooldown a kurzor,
- prechody stavového automatu,
- pauza zmrazí prekážky, čas, spawn aj hlavu hore,
- pokračovanie ide presne odtiaľ, kde hra stála: rovnaký výsledok ako hra bez pauzy,
- swept kolízie hlavy (zohnutie, úkrok, medzera, rýchla prekážka pri veľkom kroku, tesné minutie),
- skóre, combo, životy, pevné úrovne obtiažnosti (hra sa nezrýchľuje),
- spravodlivosť spawnu: property test na 300 seedoch × 5 úrovniach × 5 minút,
- rozostupy tlačidiel,
- simulácia 5 minút bežného hrania, počas ktorej sa Pauza sama nespustí,
- sledovanie puku kamerou: nájdenie zeleného biscuitu a oranžovej loptičky na dreve, premietnutie na podlahu,
  samokalibrácia (nájde ohnisko, natočenie a oneskorenie kamery aj polohu puku, hýbajúci sa puk neprijme).
