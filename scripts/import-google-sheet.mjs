import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const SPREADSHEET_ID = "17rw8FVoOh9jKP6HGZARI5ba7EXTp-x3xBbWcOtoW0vs";
const LIVE_SITE_URL = "https://kpiexamples.operately.com";
const WORKBOOK_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=xlsx`;
const OUTPUT_PATH = resolve("src/data/catalog.json");
const CONTENT_OUTPUT_PATH = resolve("src/data/page-content.json");
const PRODUCTION_SHEET = "Production";
const CATEGORIES_SHEET = "Categories";
const CLASS_NAME_MAP = {};

const UNIT_ALLOWLIST = new Set(["money", "percentage", "time", "number", "score", "ratio", "list"]);

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const workbookPath = await downloadWorkbook();
  const livePaths = await fetchLivePaths();
  const workbook = readWorkbook(workbookPath);
  const productionRows = workbook.sheetRows(PRODUCTION_SHEET);
  const categoryRows = workbook.sheetRows(CATEGORIES_SHEET);
  const catalog = buildCatalog(productionRows, categoryRows);

  assignLiveKpiSlugs(catalog, livePaths);
  removeDuplicateKpiPaths(catalog);
  await addLiveOnlyKpis(catalog, livePaths);
  const pageContent = await fetchPageContent(catalog, livePaths);

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(CONTENT_OUTPUT_PATH, `${JSON.stringify(pageContent, null, 2)}\n`);

  console.log(
    `Wrote ${catalog.categories.length} categories, ${catalog.subcategories.length} subcategories, and ${catalog.kpis.length} KPIs to ${OUTPUT_PATH}`,
  );
  console.log(
    `Wrote ${Object.keys(pageContent.categories).length} category pages and ${Object.keys(pageContent.subcategories).length} subcategory pages to ${CONTENT_OUTPUT_PATH}`,
  );
}

async function fetchLivePaths() {
  const response = await fetch(`${LIVE_SITE_URL}/sitemap`);
  if (!response.ok) {
    throw new Error(`Failed to download live sitemap: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  return new Set([...xml.matchAll(/<loc>https:\/\/kpiexamples\.operately\.com\/(.*?)<\/loc>/g)].map((match) => match[1]));
}

async function downloadWorkbook() {
  const response = await fetch(WORKBOOK_URL);

  if (!response.ok) {
    throw new Error(`Failed to download Google Sheet workbook: ${response.status} ${response.statusText}`);
  }

  const workbookPath = join(tmpdir(), `kpiexamples-${Date.now()}.xlsx`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(workbookPath, bytes);
  return workbookPath;
}

function readWorkbook(workbookPath) {
  const sharedStrings = parseSharedStrings(readZipEntry(workbookPath, "xl/sharedStrings.xml"));
  const sheets = parseSheets(readZipEntry(workbookPath, "xl/workbook.xml"));
  const relationships = parseRelationships(readZipEntry(workbookPath, "xl/_rels/workbook.xml.rels"));

  return {
    sheetRows(sheetName) {
      const sheet = sheets.find((candidate) => candidate.name === sheetName);
      if (!sheet) throw new Error(`Sheet '${sheetName}' was not found in the workbook`);

      const target = relationships.get(sheet.relationshipId);
      if (!target) throw new Error(`Sheet '${sheetName}' is missing a workbook relationship`);

      return parseWorksheet(readZipEntry(workbookPath, `xl/${target}`), sharedStrings);
    },
  };
}

function readZipEntry(workbookPath, entryPath) {
  try {
    return execFileSync("unzip", ["-p", workbookPath, entryPath], { encoding: "utf8" });
  } catch {
    throw new Error(`Failed to read '${entryPath}' from workbook. Make sure the 'unzip' command is available.`);
  }
}

function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => {
    const textRuns = [...match[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)];
    return textRuns.map((textRun) => decodeXml(textRun[1])).join("");
  });
}

function parseSheets(xml) {
  return [...xml.matchAll(/<sheet\b([^>]*)\/>/g)].map((match) => {
    const attributes = parseAttributes(match[1]);
    return {
      name: attributes.get("name"),
      relationshipId: attributes.get("r:id"),
    };
  });
}

function parseRelationships(xml) {
  return new Map(
    [...xml.matchAll(/<Relationship\b([^>]*)\/>/g)].map((match) => {
      const attributes = parseAttributes(match[1]);
      return [attributes.get("Id"), attributes.get("Target")];
    }),
  );
}

function parseWorksheet(xml, sharedStrings) {
  const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const row = [];

    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = parseAttributes(cellMatch[1]);
      const reference = attributes.get("r");
      const columnIndex = columnReferenceToIndex(reference);
      row[columnIndex] = readCellValue(cellMatch[2], attributes, sharedStrings);
    }

    return row.map((value) => value ?? "");
  });

  return rows.filter((row) => row.some((value) => value.length > 0));
}

function readCellValue(cellXml, attributes, sharedStrings) {
  const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
  if (!valueMatch) return "";

  const rawValue = decodeXml(valueMatch[1]);
  return attributes.get("t") === "s" ? sharedStrings[Number(rawValue)] ?? "" : rawValue;
}

function parseAttributes(value) {
  return new Map([...value.matchAll(/\s([:\w]+)="([^"]*)"/g)].map((match) => [match[1], decodeXml(match[2])]));
}

function columnReferenceToIndex(reference) {
  const letters = reference.match(/[A-Z]+/)?.[0];
  if (!letters) throw new Error(`Invalid cell reference '${reference}'`);

  return [...letters].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function buildCatalog(productionRows, categoryRows) {
  const categorySummaries = new Map(
    rowsWithoutHeader(categoryRows)
      .filter((row) => present(row[0]))
      .map((row) => [normalizeName(row[0]), blankToNull(row[1])]),
  );

  const categoryByName = new Map();
  const subcategoryByKey = new Map();
  const kpis = [];

  for (const row of rowsWithoutHeader(categoryRows)) {
    const [categoryName] = row;
    if (present(categoryName)) {
      findOrCreateCategory(categoryByName, categorySummaries, categoryName);
    }
  }

  for (const row of rowsWithoutHeader(productionRows)) {
    const [name, categoryName, subcategoryName, unit, description, formula, example] = row;
    if (!present(name)) continue;
    if (!present(categoryName) || !present(subcategoryName) || !present(unit) || !present(description)) {
      throw new Error(`Incomplete KPI row for '${name}'`);
    }

    const category = findOrCreateCategory(categoryByName, categorySummaries, categoryName);
    const subcategory = findOrCreateSubcategory(subcategoryByKey, category, subcategoryName);
    const normalizedUnit = unit.toLowerCase();

    if (!UNIT_ALLOWLIST.has(normalizedUnit)) {
      throw new Error(`Invalid unit '${unit}' for KPI '${name}'`);
    }

    kpis.push({
      id: kpis.length + 1,
      categoryId: category.id,
      subcategoryId: subcategory.id,
      name: name.trim(),
      slug: slugify(name),
      unit: normalizedUnit,
      description: description.trim(),
      formula: blankToNull(formula),
      example: blankToNull(example),
      upvoteCount: 0,
    });
  }

  const kpiCountsByOriginalCategoryId = countKpisByCategoryId(kpis);
  const categories = [...categoryByName.values()]
    .sort(byName)
    .map((category, index) => ({
      ...category,
      id: index + 1,
      pending: (kpiCountsByOriginalCategoryId.get(category.id) ?? 0) === 0,
    }));
  const categoryIdByName = new Map(categories.map((category) => [normalizeName(category.name), category.id]));
  const subcategories = [...subcategoryByKey.values()]
    .sort((left, right) => left.categoryName.localeCompare(right.categoryName) || left.name.localeCompare(right.name))
    .map((subcategory, index) => ({
      id: index + 1,
      categoryId: categoryIdByName.get(normalizeName(subcategory.categoryName)),
      name: subcategory.name,
      slug: subcategory.slug,
    }));
  const subcategoryIdByKey = new Map(
    subcategories.map((subcategory) => [`${subcategory.categoryId}:${normalizeName(subcategory.name)}`, subcategory.id]),
  );

  return {
    generatedAt: new Date().toISOString(),
    categories,
    subcategories,
    kpis: kpis.sort(byName).map((kpi, index) => {
      const category = categories.find((candidate) => candidate.name === categoryByOriginalId(categoryByName, kpi.categoryId));
      if (!category) throw new Error(`Missing normalized category for KPI '${kpi.name}'`);

      const subcategory = subcategories.find(
        (candidate) =>
          candidate.categoryId === category.id && candidate.name === subcategoryByOriginalId(subcategoryByKey, kpi.subcategoryId),
      );
      if (!subcategory) throw new Error(`Missing normalized subcategory for KPI '${kpi.name}'`);

      return {
        ...kpi,
        id: index + 1,
        categoryId: category.id,
        subcategoryId: subcategory.id,
      };
    }),
  };
}

function assignLiveKpiSlugs(catalog, livePaths) {
  const liveSlugsByCategoryAndBaseSlug = new Map();

  for (const path of livePaths) {
    if (!isKpiPath(path)) continue;

    const [categorySlug, kpiSlug] = path.split("/");
    const baseSlug = removeFriendlyIdUuid(kpiSlug);
    const key = `${categorySlug}/${baseSlug}`;
    const liveSlugs = liveSlugsByCategoryAndBaseSlug.get(key) ?? [];
    liveSlugs.push(kpiSlug);
    liveSlugsByCategoryAndBaseSlug.set(key, liveSlugs);
  }

  for (const liveSlugs of liveSlugsByCategoryAndBaseSlug.values()) {
    liveSlugs.sort((left, right) => Number(hasFriendlyIdUuid(left)) - Number(hasFriendlyIdUuid(right)));
  }

  const kpisByCategoryAndBaseSlug = new Map();
  for (const kpi of catalog.kpis) {
    const category = catalog.categories.find((candidate) => candidate.id === kpi.categoryId);
    const key = `${category.slug}/${removeFriendlyIdUuid(kpi.slug)}`;
    const groupedKpis = kpisByCategoryAndBaseSlug.get(key) ?? [];
    groupedKpis.push(kpi);
    kpisByCategoryAndBaseSlug.set(key, groupedKpis);
  }

  for (const [key, groupedKpis] of kpisByCategoryAndBaseSlug) {
    const liveSlugs = liveSlugsByCategoryAndBaseSlug.get(key);
    if (!liveSlugs || liveSlugs.length < groupedKpis.length) continue;

    groupedKpis.forEach((kpi, index) => {
      kpi.slug = liveSlugs[index];
    });
  }
}

function removeDuplicateKpiPaths(catalog) {
  const seenPaths = new Set();
  catalog.kpis = catalog.kpis.filter((kpi) => {
    const category = catalog.categories.find((candidate) => candidate.id === kpi.categoryId);
    const path = `${category.slug}/${kpi.slug}`;

    if (seenPaths.has(path)) return false;

    seenPaths.add(path);
    return true;
  });

  catalog.kpis = catalog.kpis.map((kpi, index) => ({ ...kpi, id: index + 1 }));
}

async function fetchPageContent(catalog, livePaths) {
  const categoriesWithKpis = catalog.categories.filter((category) => catalog.kpis.some((kpi) => kpi.categoryId === category.id));
  const subcategoryPaths = catalog.subcategories
    .map((subcategory) => {
      const category = catalog.categories.find((candidate) => candidate.id === subcategory.categoryId);
      return `${category.slug}/s/${subcategory.slug}`;
    })
    .filter((path) => livePaths.has(path));

  const categories = {};
  const subcategories = {};

  for (const category of categoriesWithKpis) {
    const html = await fetchLivePageHtml(category.slug);
    categories[category.slug] = extractStaticMainContent(html, category.slug);
  }

  for (const path of subcategoryPaths) {
    const html = await fetchLivePageHtml(path);
    subcategories[path] = extractStaticMainContent(html, path.split("/")[0]);
  }

  return {
    generatedAt: new Date().toISOString(),
    categories,
    subcategories,
  };
}

async function fetchLivePageHtml(path) {
  const response = await fetch(`${LIVE_SITE_URL}/${path}`);
  if (!response.ok) {
    throw new Error(`Failed to download live page '${path}': ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function extractStaticMainContent(html, categorySlug) {
  const match = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/);
  if (!match) throw new Error("Live page is missing a <main> element");

  return sanitizePageHtml(match[1], categorySlug);
}

function sanitizePageHtml(html, categorySlug) {
  return html
    .replace(/<meta\b[^>]*>/g, "")
    .replace(/<turbo-frame[\s\S]*?<\/turbo-frame>/g, "")
    .replace(/\sdata-[\w-]+(?:="[^"]*")?/g, "")
    .replace(/\sitemprop="[^"]*"/g, "")
    .replace(/\sitemscope/g, "")
    .replace(/\sitemtype="[^"]*"/g, "")
    .replace(/href="https:\/\/kpiexamples\.operately\.com\//g, 'href="/')
    .replace(/src="\/assets\/([a-z0-9-]+)-[0-9a-f]{64}\.jpg"/g, (_match, assetSlug) => {
      const imageSlug = assetSlug.endsWith("-bw") ? assetSlug : categorySlug;
      return `src="/images/${imageSlug}.jpg"`;
    })
    .replace(/class="([^"]*)"/g, (_match, classes) => `class="${mapTailwindClasses(classes)}"`)
    .replace(/<\/a>\s*<\/a>/g, "</a>")
    .trim();
}

function mapTailwindClasses(classes) {
  return classes
    .split(/\s+/)
    .filter((className) => !className.includes(":"))
    .map((className) => CLASS_NAME_MAP[className] ?? className)
    .join(" ");
}

async function addLiveOnlyKpis(catalog, livePaths) {
  const localPaths = new Set(
    catalog.kpis.map((kpi) => {
      const category = catalog.categories.find((candidate) => candidate.id === kpi.categoryId);
      return `${category.slug}/${kpi.slug}`;
    }),
  );
  const missingKpiPaths = [...livePaths].filter((path) => isKpiPath(path) && !localPaths.has(path)).sort();

  for (const path of missingKpiPaths) {
    const liveKpi = await fetchLiveKpi(path, catalog);
    catalog.kpis.push({
      ...liveKpi,
      id: catalog.kpis.length + 1,
    });
  }
}

async function fetchLiveKpi(path, catalog) {
  const response = await fetch(`${LIVE_SITE_URL}/${path}`);
  if (!response.ok) {
    throw new Error(`Failed to download live KPI page '${path}': ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const [categorySlug, kpiSlug] = path.split("/");
  const category = catalog.categories.find((candidate) => candidate.slug === categorySlug);
  if (!category) throw new Error(`Live KPI '${path}' references unknown category '${categorySlug}'`);

  const subcategoryName = readBreadcrumbName(html, 2);
  const subcategorySlug = readBreadcrumbSlug(html, 2);
  const subcategory = findOrAddLiveSubcategory(catalog, category, subcategoryName, subcategorySlug);

  return {
    categoryId: category.id,
    subcategoryId: subcategory.id,
    name: readHtmlText(html, /<h1[^>]*>([\s\S]*?)<\/h1>/, `title for '${path}'`),
    slug: kpiSlug,
    unit: readHtmlText(html, /<p class="text-lg text-gray-500">([\s\S]*?)<\/p>/, `unit for '${path}'`).toLowerCase(),
    description: readFirstSummaryParagraph(html, path),
    formula: readOptionalHtmlText(html, /<h2[^>]*>\s*Formula\s*<\/h2>\s*<p class="font-mono">([\s\S]*?)<\/p>/),
    example: readOptionalHtmlText(
      html,
      /<h2[^>]*>\s*Example\s*<\/h2>\s*<p>(?:\s*<p class="mb-4">)?([\s\S]*?)(?:<\/p>\s*){1,2}/,
    ),
    upvoteCount: readUpvoteCount(html),
  };
}

function findOrAddLiveSubcategory(catalog, category, name, slug) {
  const existingSubcategory = catalog.subcategories.find(
    (candidate) => candidate.categoryId === category.id && candidate.slug === slug,
  );
  if (existingSubcategory) return existingSubcategory;

  const subcategory = {
    id: catalog.subcategories.length + 1,
    categoryId: category.id,
    name,
    slug,
  };
  catalog.subcategories.push(subcategory);
  return subcategory;
}

function readBreadcrumbName(html, position) {
  const breadcrumb = readBreadcrumb(html, position);
  return readHtmlText(breadcrumb, /<span itemprop="name">([\s\S]*?)<\/span>/, `breadcrumb ${position}`);
}

function readBreadcrumbSlug(html, position) {
  const breadcrumb = readBreadcrumb(html, position);
  const href = readAttribute(breadcrumb, "href");
  return href.split("/").filter(Boolean).at(-1);
}

function readBreadcrumb(html, position) {
  const breadcrumbs = [...html.matchAll(/<li itemprop="itemListElement"[\s\S]*?<\/li>/g)];
  const breadcrumb = breadcrumbs[position - 1]?.[0];
  if (!breadcrumb) throw new Error(`Missing breadcrumb ${position}`);
  return breadcrumb;
}

function readAttribute(html, attributeName) {
  const match = html.match(new RegExp(`${attributeName}="([^"]*)"`));
  if (!match) throw new Error(`Missing '${attributeName}' attribute`);
  return decodeXml(match[1]);
}

function readFirstSummaryParagraph(html, path) {
  const contentStart = html.indexOf('<div class="text-gray-800">');
  if (contentStart < 0) throw new Error(`Missing content wrapper for '${path}'`);

  return readHtmlText(html.slice(contentStart), /<p class="mb-4">([\s\S]*?)<\/p>/, `description for '${path}'`);
}

function readHtmlText(html, pattern, label) {
  const value = readOptionalHtmlText(html, pattern);
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function readOptionalHtmlText(html, pattern) {
  const match = html.match(pattern);
  if (!match) return null;
  return decodeHtml(stripTags(match[1])).trim();
}

function readUpvoteCount(html) {
  const match = html.match(/<span class="ml-2">(\d+)<\/span>/);
  return match ? Number(match[1]) : 0;
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, "");
}

function isKpiPath(path) {
  return path.split("/").length === 2 && !path.includes("/s/");
}

function removeFriendlyIdUuid(slug) {
  return slug.replace(/-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "");
}

function hasFriendlyIdUuid(slug) {
  return /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(slug);
}

function findOrCreateCategory(categoryByName, categorySummaries, categoryName) {
  const key = normalizeName(categoryName);
  const existingCategory = categoryByName.get(key);
  if (existingCategory) return existingCategory;

  const category = {
    id: categoryByName.size + 1,
    name: categoryName.trim(),
    slug: slugify(categoryName),
    summary: categorySummaries.get(key) ?? null,
    pending: false,
  };
  categoryByName.set(key, category);
  return category;
}

function findOrCreateSubcategory(subcategoryByKey, category, subcategoryName) {
  const key = `${category.id}:${normalizeName(subcategoryName)}`;
  const existingSubcategory = subcategoryByKey.get(key);
  if (existingSubcategory) return existingSubcategory;

  const subcategory = {
    id: subcategoryByKey.size + 1,
    categoryName: category.name,
    name: subcategoryName.trim(),
    slug: slugify(subcategoryName),
  };
  subcategoryByKey.set(key, subcategory);
  return subcategory;
}

function rowsWithoutHeader(rows) {
  return rows.slice(1);
}

function countKpisByCategoryId(kpis) {
  return kpis.reduce((counts, kpi) => {
    counts.set(kpi.categoryId, (counts.get(kpi.categoryId) ?? 0) + 1);
    return counts;
  }, new Map());
}

function categoryByOriginalId(categoryByName, id) {
  return [...categoryByName.values()].find((category) => category.id === id)?.name;
}

function subcategoryByOriginalId(subcategoryByKey, id) {
  return [...subcategoryByKey.values()].find((subcategory) => subcategory.id === id)?.name;
}

function byName(left, right) {
  return left.name.localeCompare(right.name);
}

function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function blankToNull(value) {
  return present(value) ? value.trim() : null;
}

function normalizeName(value) {
  return value.trim().toLowerCase();
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function decodeXml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function decodeHtml(value) {
  return decodeXml(value)
    .replace(/&#(\d+);/g, (_match, codepoint) => String.fromCodePoint(Number(codepoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, codepoint) => String.fromCodePoint(Number.parseInt(codepoint, 16)));
}
