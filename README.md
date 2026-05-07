# locatd

Mobile-first social map built with React, TypeScript, Tailwind, Leaflet, and Supabase.

## Features

- OpenStreetMap map via `react-leaflet`
- Address/place lookup via Nominatim
- Supabase Auth sign up/sign in/sign out
- Realtime location sharing with visibility toggle
- Friend requests and friend-scoped visibility
- Tap-to-drop pins with notes, emoji, photo URL, visibility
- Emoji reactions and lightweight activity feed

## Local development

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
cp .env.example .env.local
```

3. Start the dev server:

```bash
npm run dev
```

## Environment variables

Required:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Supabase schema

SQL migrations are tracked in `supabase/migrations`. Apply them through Supabase MCP/CLI in order.

## Deploying to Vercel

- Build command: `npm run build`
- Output directory: `dist`
- Framework preset: `Vite`
- Add the same `VITE_SUPABASE_*` variables in Vercel project settings

`vercel.json` includes SPA fallback routing to `index.html`.
