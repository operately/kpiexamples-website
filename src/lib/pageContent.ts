import rawPageContent from "../data/page-content.json";

type PageContent = {
  generatedAt: string | null;
  categories: Record<string, string>;
  subcategories: Record<string, string>;
};

const pageContent = rawPageContent as PageContent;

export function getCategoryPageContent(categorySlug: string): string | undefined {
  return pageContent.categories[categorySlug];
}

export function getSubcategoryPageContent(categorySlug: string, subcategorySlug: string): string | undefined {
  return pageContent.subcategories[`${categorySlug}/s/${subcategorySlug}`];
}
