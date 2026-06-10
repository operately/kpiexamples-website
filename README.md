# KPI Examples Static Astro Site

This is the static Astro port of the Rails app. It preserves the public URL shape:

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

## Import Data From the Public Sheet

The default import path uses the public Google Sheet for KPI content and the live sitemap for exact Render-era URL slugs:

```bash
npm run import:sheet
```

The importer writes `src/data/catalog.json` with categories, subcategories, KPIs, formulas, examples, and any live-only sitemap records needed to match the current public app.

## Export Data From Rails

After restoring a Render database snapshot into the Rails app, run this from the repository root:

```bash
bin/rails runner scripts/export_static_catalog.rb
```

That writes `astro/src/data/catalog.json` with categories, subcategories, KPIs, formulas, examples, and upvote counts.

Comments, Google auth, admin screens, voting actions, and notification signup are intentionally not part of this static build. Upvote counts are preserved as read-only snapshot data when they come from the Rails export or live-only page scrape.

## Develop

```bash
cd astro
npm install
npm run dev
```

## Build

```bash
cd astro
npm run build
```
