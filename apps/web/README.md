# Web

Next.js 15 + Tailwind 4 frontend for the Influencer Travel Marketplace. Talks to the Flask API and to Supabase auth directly.

## Run

Via the root Docker Compose stack (recommended):

```sh
docker compose up -d web          # from repo root, after root .env is set up
```

Standalone for development:

```sh
npm install
cp .env.example .env.local        # set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_API_URL
npm run dev
```

Open <http://localhost:3000>.

## Scripts

- `npm run dev` — dev server with HMR
- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — Next.js lint
