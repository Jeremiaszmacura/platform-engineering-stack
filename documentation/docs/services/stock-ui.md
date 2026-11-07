# stock-ui

"Stock App": a React (Vite) web app at http://stock-ui.localhost that charts stock-app's daily prices
(line or candles, 1W–5Y). Only the Markets view uses a backend; Portfolio, Watchlist and the account menu
are mocked on purpose (`src/mocks/demoData.js`), and the indicator panels are empty placeholders.

Search filters stock-app's instrument list, so it finds companies already stored; any other ticker can be
typed in full.

```sh
cd stock-ui
npm ci
npm run dev      # dev server; VITE_STOCK_API_URL overrides http://stock.localhost
npm test         # Vitest
npm run build    # into dist/, served by non-root nginx on 8080 in the image
```
