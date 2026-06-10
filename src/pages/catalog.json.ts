import { catalog } from "../lib/catalog";

export function GET() {
  return new Response(JSON.stringify(catalog), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
