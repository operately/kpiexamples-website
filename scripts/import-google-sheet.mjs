import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const SPREADSHEET_ID = "17rw8FVoOh9jKP6HGZARI5ba7EXTp-x3xBbWcOtoW0vs";
const WORKBOOK_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=xlsx`;
const OUTPUT_PATH = resolve("src/data/catalog.json");
const CONTENT_OUTPUT_PATH = resolve("src/data/page-content.json");
const PRODUCTION_SHEET = "Production";
const CATEGORIES_SHEET = "Categories";

const UNIT_ALLOWLIST = new Set(["money", "percentage", "time", "number", "score", "ratio", "list"]);

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const workbookPath = await downloadWorkbook();
  const existingCatalog = await readExistingCatalog();
  const workbook = readWorkbook(workbookPath);
  const productionRows = workbook.sheetRows(PRODUCTION_SHEET);
  const categoryRows = workbook.sheetRows(CATEGORIES_SHEET);
  const catalog = buildCatalog(productionRows, categoryRows, existingCatalog);
  const pageContent = buildEmptyPageContent();

  ensureUniqueKpiSlugs(catalog);

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

async function readExistingCatalog() {
  try {
    return JSON.parse(await readFile(OUTPUT_PATH, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function buildEmptyPageContent() {
  return {
    generatedAt: new Date().toISOString(),
    categories: {},
    subcategories: {},
  };
}

async function downloadWorkbook() {
  let response;

  try {
    response = await fetch(WORKBOOK_URL);
  } catch (error) {
    throw new Error(`Failed to download Google Sheet workbook: ${formatNetworkError(error)}`);
  }

  if (!response.ok) {
    throw new Error(`Failed to download Google Sheet workbook: ${response.status} ${response.statusText}`);
  }

  const workbookPath = join(tmpdir(), `kpiexamples-${Date.now()}.xlsx`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(workbookPath, bytes);
  return workbookPath;
}

function formatNetworkError(error) {
  const cause = error.cause;
  if (cause?.code && cause?.hostname) return `${cause.code} ${cause.hostname}`;
  if (cause?.code) return cause.code;
  return error.message;
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

function buildCatalog(productionRows, categoryRows, existingCatalog) {
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

  const catalog = {
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

  preserveExistingKpiMetadata(catalog, existingCatalog);
  return catalog;
}

function preserveExistingKpiMetadata(catalog, existingCatalog) {
  if (!existingCatalog) return;

  const existingKpisBySignature = new Map();

  for (const existingKpi of existingCatalog.kpis ?? []) {
    const existingCategory = existingCatalog.categories?.find((category) => category.id === existingKpi.categoryId);
    const existingSubcategory = existingCatalog.subcategories?.find(
      (subcategory) => subcategory.id === existingKpi.subcategoryId,
    );
    if (!existingCategory || !existingSubcategory) continue;

    const signature = kpiSignature(existingCategory, existingSubcategory, existingKpi);
    const existingKpis = existingKpisBySignature.get(signature) ?? [];
    existingKpis.push(existingKpi);
    existingKpisBySignature.set(signature, existingKpis);
  }

  for (const kpi of catalog.kpis) {
    const category = catalog.categories.find((candidate) => candidate.id === kpi.categoryId);
    const subcategory = catalog.subcategories.find((candidate) => candidate.id === kpi.subcategoryId);
    const signature = kpiSignature(category, subcategory, kpi);
    const existingKpis = existingKpisBySignature.get(signature);
    const existingKpi = existingKpis?.shift();
    if (!existingKpi) continue;

    kpi.slug = existingKpi.slug;
    kpi.upvoteCount = existingKpi.upvoteCount ?? 0;
  }
}

function kpiSignature(category, subcategory, kpi) {
  return `${category.slug}|${subcategory.slug}|${normalizeName(kpi.name)}`;
}

function ensureUniqueKpiSlugs(catalog) {
  const seenPaths = new Set();
  catalog.kpis = catalog.kpis.map((kpi) => {
    const category = catalog.categories.find((candidate) => candidate.id === kpi.categoryId);
    const subcategory = catalog.subcategories.find((candidate) => candidate.id === kpi.subcategoryId);
    let slug = kpi.slug;
    let path = `${category.slug}/${slug}`;

    if (seenPaths.has(path)) {
      const baseSlug = removeFriendlyIdUuid(slug);
      const suffix = stableSlugSuffix(category, subcategory, kpi);
      slug = `${baseSlug}-${suffix}`;
      path = `${category.slug}/${slug}`;
    }

    seenPaths.add(path);
    return { ...kpi, slug };
  });

  catalog.kpis = catalog.kpis.map((kpi, index) => ({ ...kpi, id: index + 1 }));
}

function removeFriendlyIdUuid(slug) {
  return slug.replace(/-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "");
}

function stableSlugSuffix(category, subcategory, kpi) {
  return stableHash(`${category.slug}|${subcategory.slug}|${kpi.name}|${kpi.description}`).slice(0, 8);
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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
