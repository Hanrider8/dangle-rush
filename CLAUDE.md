@AGENTS.md

## Poznámky pre Claude Code

- Odpovedaj po slovensky.
- **Po každej zmene nasaď** (commit + push do `main`, potom `gh run watch` a `curl` na bundle) a pošli link
  https://hanrider8.github.io/dangle-rush/. Používateľ to overuje na skutočnom Queste.
- Neinteraktívny shell má predvolene Node 20. Pred `npm`/`npx` daj
  `export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"`.
- **Emulátor v paneli prehliadača:**
  - spusti `preview_start` s menom `dangle-rush-usb` z `.claude/launch.json`,
  - otvor `http://localhost:5173/?demo=1` na živú ukážku, ktorú môže sledovať aj používateľ,
  - na testy použi `window.__dr` cez `javascript_tool` a `__dr.advance()` na deterministický posun času.
- Po skončení zastav dev server (`preview_stop`). Port 5173 má `strictPort`, takže by blokoval `npm run dev` používateľa.
