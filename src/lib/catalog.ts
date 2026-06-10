import rawCatalog from "../data/catalog.json";

export type Category = {
  id: number;
  name: string;
  slug: string;
  summary: string | null;
  pending: boolean;
};

export type Subcategory = {
  id: number;
  categoryId: number;
  name: string;
  slug: string;
};

export type Kpi = {
  id: number;
  categoryId: number;
  subcategoryId: number;
  name: string;
  slug: string;
  unit: string;
  description: string;
  formula: string | null;
  example: string | null;
  upvoteCount: number;
};

export type Catalog = {
  generatedAt: string | null;
  categories: Category[];
  subcategories: Subcategory[];
  kpis: Kpi[];
};

export const catalog = rawCatalog as Catalog;

export const categories = [...catalog.categories].sort(byName);
export const subcategories = [...catalog.subcategories].sort(byName);
export const kpis = [...catalog.kpis].sort(byName);

export function getCategoryBySlug(slug: string): Category | undefined {
  return categories.find((category) => category.slug === slug);
}

export function getSubcategoryBySlug(categoryId: number, slug: string): Subcategory | undefined {
  return subcategories.find(
    (subcategory) => subcategory.categoryId === categoryId && subcategory.slug === slug,
  );
}

export function getKpiBySlug(categoryId: number, slug: string): Kpi | undefined {
  return kpis.find((kpi) => kpi.categoryId === categoryId && kpi.slug === slug);
}

export function getSubcategoriesForCategory(categoryId: number): Subcategory[] {
  return subcategories.filter((subcategory) => subcategory.categoryId === categoryId);
}

export function getKpisForCategory(categoryId: number): Kpi[] {
  return kpis.filter((kpi) => kpi.categoryId === categoryId);
}

export function getKpisForSubcategory(subcategoryId: number): Kpi[] {
  return kpis.filter((kpi) => kpi.subcategoryId === subcategoryId);
}

export function getPopularKpisForCategory(categoryId: number, limit = 5): Kpi[] {
  return getKpisForCategory(categoryId)
    .sort((left, right) => right.upvoteCount - left.upvoteCount || left.name.localeCompare(right.name))
    .slice(0, limit);
}

export function getCategoryForKpi(kpi: Kpi): Category {
  const category = catalog.categories.find((candidate) => candidate.id === kpi.categoryId);

  if (!category) {
    throw new Error(`Missing category ${kpi.categoryId} for KPI ${kpi.id}`);
  }

  return category;
}

export function getSubcategoryForKpi(kpi: Kpi): Subcategory {
  const subcategory = catalog.subcategories.find((candidate) => candidate.id === kpi.subcategoryId);

  if (!subcategory) {
    throw new Error(`Missing subcategory ${kpi.subcategoryId} for KPI ${kpi.id}`);
  }

  return subcategory;
}

function byName(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name);
}
