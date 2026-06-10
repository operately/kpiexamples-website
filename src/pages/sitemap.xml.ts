import { buildSitemapResponse } from "../lib/sitemap";

export function GET() {
  return buildSitemapResponse();
}
