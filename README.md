# KPI Examples Website

This is the source for the static Astro version of [KPI Examples](https://kpiexamples.operately.com). It is designed to be published as a standalone static site, for example on Cloudflare Pages.

The public URL shape is:

- `/`
- `/about`
- `/contribute`
- `/faq`
- `/code-of-conduct`
- `/search`
- `/:category`
- `/:category/s/:subcategory`
- `/:category/:kpi`

The app reads its catalog from `src/data/catalog.json`.

## Refresh Data From the Public Sheet

KPI content comes from the public Google Sheet. To import the current sheet data:

```bash
npm run import:sheet
```

The importer writes:

- `src/data/catalog.json`
- `src/data/page-content.json`

It preserves existing KPI slugs and archived upvote counts from the current local `src/data/catalog.json` when it can match a KPI by category, subcategory, and name. New duplicate KPI names get deterministic unique slug suffixes.

After refreshing, run `npm run build` and commit the updated JSON files.

Comments, Google auth, admin screens, voting actions, and notification signup are intentionally not part of this static website. Upvote counts are read-only archived values.

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Cloudflare Pages

Use these build settings:

- Build command: `npm run build`
- Build output directory: `dist`
- Node version: current LTS
