/**
 * Všetky laditeľné konštanty hry na jednom mieste.
 *
 * Jednotky: metre, sekundy a stupne, ak nie je uvedené inak.
 * Herný priestor: počiatok na podlahe pod hlavou v čase centrovania, −Z je smer hry, +X doprava.
 * H je kalibrovaná výška očí hráča v stoji (výška headsetu nad podlahou).
 */
export const CONFIG = {
  /** Simulácia s fixným časovým krokom. */
  sim: {
    fixedDt: 1 / 120,
    /** Dlhší snímok (zásek, návrat z pozadia) sa oreže na túto dĺžku. */
    maxFrameDt: 0.1,
    maxStepsPerFrame: 12,
  },

  head: {
    /** Polomer gule hlavy pre kolízie s prekážkami. */
    radius: 0.12,
    /** Výška očí, kým hráč neprejde kalibráciou. */
    defaultEyeHeight: 1.65,
    /** Rozsah, ktorý kalibrácia prijme. */
    minEyeHeight: 1.0,
    maxEyeHeight: 2.2,
  },

  tracking: {
    /** Ako dlho môže chýbať tracking hlavy, kým hra automaticky pauzne. */
    lostGrace: 0.3,
  },

  playArea: {
    width: 2.0,
    depth: 1.0,
    /** Vzdialenosť stredu plochy pred hráčom. */
    centerDistance: 0.55,
    /** Plocha je vidieť pred hrou, v pauze a na konci; počas hrania len ak je toto true. */
    showWhilePlaying: false,
    /** Slabé čiary dráhy od plochy po miesto spawnu (v MR netreba, smer ukazujú prekážky). */
    showTrack: false,
  },

  gaze: {
    /** Predvolený čas dwell; v nastaveniach dwellMin až dwellMax po krokoch dwellStep. */
    dwellTime: 1.2,
    dwellMin: 0.8,
    dwellMax: 2.0,
    dwellStep: 0.2,
    /** Plnenie sa preruší, až keď pohľad prekročí hranu tlačidla o tento uhol. */
    hysteresisDeg: 3,
    /** Krátke výpadky pohľadu, ktoré plnenie nerušia. */
    graceTime: 0.15,
    /** Po aktivácii sú všetky tlačidlá na tento čas neaktívne. */
    cooldown: 1.0,
    /** Kurzor sa ukáže, len keď je pohľad do tohto uhla od niektorého aktívneho tlačidla. */
    cursorMaxAngleDeg: 20,
    /** Interval tichého tiku počas plnenia. */
    tickInterval: 0.2,
  },

  ui: {
    /** Panely SETUP, READY a GAME_OVER: vzdialenosť pred hráčom. */
    frontDistance: 2.0,
    /** Bežné tlačidlo (šírka × výška) v stupňoch zorného poľa. */
    buttonDeg: { w: 11, h: 4.5 },
    /** Dvojriadkové tlačidlo v nastaveniach. */
    settingsButtonDeg: { w: 15, h: 5.5 },
    /**
     * Uhlová medzera medzi susednými tlačidlami. Musí byť väčšia ako 2 × hysteréza: na okrajoch
     * plochého panelu sa skutočná medzera mierne zmenší.
     */
    minButtonGapDeg: 7,
    /** Rad tlačidiel na prednom paneli pod úrovňou očí (pohľad z kalibrácie naň nepadne). */
    frontRowElevationDeg: -10,
    /** Panel nastavení sa pri polohe pauzy „hore“ zníži najviac na túto výšku. */
    maxPanelElevationDeg: 20,
    /** Vycentrovať: čas na otočenie sa smerom hry, kým sa vezme póza. */
    recenterDelay: 3,
    /** Odpočet sa zobrazuje pred hráčom v tejto vzdialenosti. */
    countdownDistance: 2.6,
  },

  pauseButton: {
    distance: 1.6,
    /** Poloha „bok“: vo výške očí, takýto uhol od smeru hry. */
    sideAzimuthDeg: 60,
    /** Poloha „hore“: v smere hry, takýto uhol nad horizontom. */
    topElevationDeg: 35,
  },

  countdown: { default: 2, min: 1, max: 5 },

  obstacles: {
    /** Prekážky sa objavia takto ďaleko pred hráčom (koniec dráhy). */
    spawnDistance: 7,
    /** Zmiznú takto ďaleko za hráčom. */
    despawnBehind: 1,
    /**
     * Vysoká tyč: spodná hrana v heightRatio·H; kolízny objem siaha až po topY (nedá sa preskočiť).
     * V predvolenom mixe je vypnutá (spawn.bodyWeights.highBar = 0).
     */
    highBar: { heightRatio: 0.85, thickness: 0.08, width: 3.0, topY: 2.6 },
    /** Bočný blok: od vonkajšieho okraja (outerX) po innerX za stredom, od zeme po topRatio·H. */
    sideBlock: { topRatio: 1.1, depth: 0.3, innerX: 0.1, outerX: 1.3 },
    /** Dvojitý blok: medzera pre hlavu; jej stred je najviac gapMaxOffset od osi dráhy. */
    doubleBlock: { gapWidth: 0.45, gapMaxOffset: 0.3 },
    /** Nízka tyč na zemi: zakryje 55–65 % šírky plochy z jednej strany. */
    lowBar: { coverageMin: 0.55, coverageMax: 0.65, height: 0.06, depth: 0.06 },
    /** Brána z dvoch kužeľov. */
    coneGate: { gapWidth: 0.4, gapMaxOffset: 0.75, coneRadius: 0.08, coneHeight: 0.3 },
    /** Slalom: kužele v rade, puk ich obchádza striedavo zľava a sprava (passOffset od osi). */
    slalom: { minCones: 3, maxCones: 5, centerMaxOffset: 0.4, passOffset: 0.28, coneTime: 0.75 },
    /** Hviezdy na zemi, cez ktoré prevedieš puk; starTime = čas medzi hviezdami. */
    stars: { minStars: 2, maxStars: 4, maxOffset: 0.8, starTime: 0.6, radius: 0.13 },
    /** Široké miesanie: brána úplne na jednej strane a o gateTime neskôr na druhej. */
    wideDangle: { offset: 0.72, gapWidth: 0.38, gateTime: 1.0 },
    /**
     * Pohyblivá hokejka obrancu (poke check): leží na zemi, zakrýva coverage šírky plochy a počas
     * sweepTime sa presunie na druhú stranu. Presun skončí settleTime pred príchodom k puku.
     */
    pokeCheck: { coverageMin: 0.5, coverageMax: 0.6, sweepTime: 0.8, settleTime: 1.0 },
  },

  /** Mix vĺn: hra trénuje hlavne miesanie puku, obrancovia prídu len občas. */
  spawn: {
    /** Podiel vĺn s obrancom pri najnižšej a najvyššej úrovni (zvyšok sú prekážky na zemi). */
    bodyShareMin: 0.12,
    bodyShareMax: 0.25,
    /** Váhy prekážok pre telo; vysoká tyč (zohýbanie) je vypnutá. */
    bodyWeights: { highBar: 0, sideBlock: 1, doubleBlock: 0.6 },
    /** Váhy prekážok na zemi. */
    floorWeights: { lowBar: 0.7, coneGate: 1, slalom: 1.1, stars: 0.9, wideDangle: 0.8, pokeCheck: 0.9 },
    /** Od strednej obtiažnosti: podiel vĺn s obrancom, ktoré majú aj bránu alebo tyč na zemi. */
    comboShare: 0.5,
  },

  rules: {
    lives: 3,
    /** Prvá vlna príde po tomto čase od štartu. */
    firstSpawnDelay: 0.8,
    /** Pri zásahu zmiznú prekážky bližšie ako táto vzdialenosť pred hráčom. */
    hitClearDistance: 3.5,
    /** Po zásahu sa spawn pozastaví na tento čas. */
    hitSpawnPause: 1.5,
    scorePerBody: 100,
    /** Násobiteľ rastie o 1 po každých comboStep prekonaných prekážkach za sebou. */
    comboStep: 5,
    maxMultiplier: 5,
    timeBonusPerSecond: 10,
  },

  difficulty: {
    speedMin: 2,
    speedMax: 5,
    /** Interval medzi vlnami (2,0 → 1,0 s); po vzore sa predĺži o jeho dĺžku. */
    intervalMax: 2.0,
    intervalMin: 1.0,
    /** Úroveň d (0–1), od ktorej sa odomknú typy prekážok; 0,4 = „stredná obtiažnosť“. */
    unlock: {
      highBar: 0,
      sideBlock: 0.15,
      doubleBlock: 0.45,
      lowBar: 0,
      coneGate: 0,
      stars: 0,
      slalom: 0.05,
      wideDangle: 0.2,
      pokeCheck: 0.3,
      combos: 0.4,
    },
    presets: {
      easy: { startLevel: 0, rampSeconds: 240, maxLevel: 0.7 },
      medium: { startLevel: 0, rampSeconds: 150, maxLevel: 1 },
      hard: { startLevel: 0.45, rampSeconds: 110, maxLevel: 1 },
    },
  },

  fairness: {
    /** Minimálny čas medzi príchodmi dvoch vĺn k hráčovi. */
    minWaveGapTime: 0.9,
    /** Prekážka musí byť viditeľná aspoň takto dlho pred príchodom. */
    minReactionTime: 1.2,
    /** Úhyb na opačnú stranu najskôr po tomto čase. */
    minLateralSwitchTime: 1.2,
    /** Najväčšia požadovaná rýchlosť presunu puku medzi prekážkami na zemi. */
    maxPuckShiftSpeed: 1.5,
    /** Kombinácia s bočným blokom: medzera na zemi nesmie byť ďalej než toto na strane bloku. */
    comboSideTolerance: 0.15,
    /** Kombinácia s dvojitým blokom: medzera na zemi pri medzere bloku. */
    comboDoubleGapTolerance: 0.35,
    /** Od tejto úrovne nie sú pri zohýbaní krajné medzery na zemi. */
    highSpeedLevel: 0.7,
    highSpeedMaxFloorOffset: 0.35,
    maxAttempts: 8,
  },

  hud: {
    /** Vzdialenosť HUD pred hráčom (nad koncom dráhy). */
    distance: 7,
    /** Výška písma v stupňoch; HUD sa podľa nej zväčší alebo zmenší s vzdialenosťou. */
    fontDeg: 1.1,
    /** Medzera medzi najvyššou prekážkou a spodnou hranou HUD. */
    clearance: 0.25,
  },

  render: {
    antialias: true,
    foveation: 1,
    targetFrameRate: 90,
  },

  /**
   * Test sledovania puku kamerou headsetu (`?cam=1`). Hra ho zatiaľ nevyhodnocuje, test len ukáže,
   * čo kamera vidí, kde našla farebný puk a kam ho premietla na podlahu.
   * Pixely sú v rozlíšení kamery (napr. 1280 × 960), časy v milisekundách.
   */
  camera: {
    /**
     * Požadované rozlíšenie a snímková frekvencia. Quest 3 dáva 1280 × 1280 (väčší zvislý záber ako
     * 1280 × 960, puk ostane v obraze aj pri hlave hore) a najviac 30 fps.
     */
    width: 1280,
    height: 1280,
    frameRate: 30,
    /** Šírka zmenšeného obrazu na hľadanie puku (výška podľa pomeru strán kamery). */
    procWidth: 320,
    /** Ako často worker pošle náhľad kamery (ms). */
    previewIntervalMs: 120,
    /**
     * Farba cieľa: odtieň v stupňoch (hueMin–hueMax), najmenšia sýtosť a jas (0–1).
     * Svetlé drevo má odtieň ~25–45° a nízku sýtosť, preto má oranžová prísnejšiu sýtosť.
     * centerHeight je výška stredu cieľa nad podlahou, radius jeho polomer (m).
     */
    targets: {
      green: { hueMin: 70, hueMax: 170, satMin: 0.35, valMin: 0.16, centerHeight: 0.015, radius: 0.038 },
      orange: { hueMin: 0, hueMax: 36, satMin: 0.62, valMin: 0.3, centerHeight: 0.034, radius: 0.034 },
    },
    detector: {
      /** Najmenšia a najväčšia plocha škvrny (pixely zmenšeného obrazu, podiel obrazu). */
      minArea: 4,
      maxAreaFraction: 0.08,
      /** Plocha škvrny / plocha obdĺžnika okolo nej (kruh ≈ 0,79). */
      minFill: 0.4,
      /** Najväčší pomer strán obdĺžnika okolo škvrny (puk rozmazaný pohybom je pretiahnutý). */
      maxAspect: 3,
    },
    /**
     * Odhad kamery, kým neprebehne kalibrácia: namerané samokalibráciou na Queste 3 (pravá kamera,
     * 1280 × 1280, chyba 0,05°): f 862 px, kamera sklopená o 10,8° nadol, oneskorenie 44 ms.
     */
    guess: {
      hfovDeg: 73.2,
      /** Sklon kamery voči pohľadu (záporný = nadol). */
      pitchDeg: -10.8,
      latencyMs: 44,
      /** Poloha pravej kamery voči stredu medzi očami (m): +x doprava, +y hore, −z dopredu; ľavá má −x. */
      offset: { x: 0.034, y: -0.024, z: -0.075 },
    },
    /** Samokalibrácia: puk leží na zemi, hráč sa naň pozerá a krúži hlavou. */
    calibration: {
      /** Z akého úseku sa berú pozorovania a ako často sa rieši. */
      windowMs: 8000,
      intervalMs: 1500,
      minObservations: 60,
      /** Puk musí prejsť aspoň takú časť šírky a výšky obrazu. */
      minCoverageU: 0.25,
      minCoverageV: 0.2,
      /** Rozptyl smeru pohľadu počas pozorovaní (stupne). */
      minHeadRangeDeg: 10,
      /**
       * Prijme sa, ak je stredná chyba premietnutia najviac takýto uhol (0,8° ≈ 2,4 cm na 1,7 m).
       * Kým sa nehrá, kalibrácia beží ďalej a lepší výsledok (viac bodov, menšia chyba) nahradí horší.
       */
      maxRmsDeg: 0.8,
      /** Podiel pozorovaní, ktoré musia zostať po vyradení odľahlých. */
      minInlierRatio: 0.7,
      /** Rozsah oneskorenia kamery (ms). */
      maxLatencyMs: 300,
    },
    /** Krúžok na podlahe: po freshMs zožltne, po hideMs zmizne. */
    ring: { freshMs: 200, hideMs: 1000 },
  },

  audio: { volume: 0.6 },
};

export type Config = typeof CONFIG;
