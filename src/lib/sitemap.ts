import { categories, getCategoryForKpi, getSubcategoriesForCategory, kpis } from "./catalog";

const SITE_URL = "https://kpiexamples.operately.com";

type SitemapEntry = {
  path: string;
  priority: string;
};

export function buildSitemapResponse() {
  const entries = buildSitemapEntries();
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(renderEntry).join("\n")}
</urlset>`;

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
    },
  });
}

function buildSitemapEntries(): SitemapEntry[] {
  const staticEntries = [
    { path: "about", priority: "0.5" },
    { path: "contribute", priority: "0.5" },
  ];
  const categoryEntries = categories.map((category) => ({
    path: category.slug,
    priority: "0.9",
  }));
  const subcategoryEntries = categories.flatMap((category) =>
    getSubcategoriesForCategory(category.id).map((subcategory) => ({
      path: `${category.slug}/s/${subcategory.slug}`,
      priority: "0.7",
    })),
  );
  const kpiEntries = kpis.map((kpi) => ({
    path: `${getCategoryForKpi(kpi).slug}/${kpi.slug}`,
    priority: "0.8",
  }));

  return [...staticEntries, ...categoryEntries, ...subcategoryEntries, ...kpiEntries];
}

function renderEntry(entry: SitemapEntry) {
  return `  <url>
    <loc>${SITE_URL}/${entry.path}</loc>
    <priority>${entry.priority}</priority>
  </url>`;
}
