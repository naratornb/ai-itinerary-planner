# Web

Next.js 15 + Tailwind 4 frontend for the Influencer Travel Marketplace. Talks to the Flask API and to Supabase auth directly.

## Run

Env comes from the root `.env` via the `.env.local` symlink (see repo README):

```sh
ln -sf ../../.env .env.local   # once
npm install
npm run dev
```

Open <http://localhost:3000>.

## Scripts

- `npm run dev` — dev server with HMR
- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — Next.js lint
