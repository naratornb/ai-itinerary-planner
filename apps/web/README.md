# Web

Next.js 16 + Tailwind CSS 4 frontend for the Influencer Travel Marketplace. It integrates with the FastAPI service and Supabase auth.

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
- `npm test` — run focused frontend tests
- `npm run lint` — run ESLint
- `npm run typecheck` — run TypeScript without emitting files
