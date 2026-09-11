import { route } from "../src/server.mjs";

const encode = (body) => JSON.stringify(
  body,
  (_key, value) => (typeof value === "bigint" ? value.toString() : value),
);

const json = (body, status = 200) => new Response(encode(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
});

export async function GET(request) {
  try {
    const result = await route(request.url);
    return result ? json(result.body, result.status) : json({ error: "not found" }, 404);
  } catch (error) {
    console.error("DreamDEX Reclaim API error", error);
    return json({ error: error instanceof Error ? error.message : "internal server error" }, 500);
  }
}
