export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "500", 10), 2000);
  const country = url.searchParams.get("country");
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();

  let sql = `
    SELECT id, name, website, country, city, location, primary_service, services, score, confidence, verification, blurb, keywords
    FROM agencies
  `;
  const params = [];

  const where = [];
  if (country) { where.push("country = ?"); params.push(country); }
  if (q) {
    where.push("(lower(name) LIKE ? OR lower(city) LIKE ? OR lower(country) LIKE ? OR lower(primary_service) LIKE ? OR lower(services) LIKE ? OR lower(keywords) LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }
  if (where.length) sql += " WHERE " + where.join(" AND ");

  sql += " ORDER BY score DESC, name ASC LIMIT ?";
  params.push(limit);

  const { results } = await env.DB.prepare(sql).bind(...params).all();

  return new Response(JSON.stringify({ ok: true, n: results.length, results }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}
