export async function onRequestGet({ env }) {
  // Approved agencies only
  const res = await env.DB.prepare(`
    SELECT id, name, website, location, primary_service, services_json, industries_json,
           score, confidence, verification, highlights_json, updated_at
    FROM agencies
    ORDER BY score DESC, updated_at DESC
    LIMIT 200
  `).all();

  const agencies = (res.results || []).map(a => ({
    ...a,
    services: safeJson(a.services_json, []),
    industries: safeJson(a.industries_json, []),
    highlights: safeJson(a.highlights_json, [])
  }));

  return new Response(JSON.stringify(agencies), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function safeJson(s, fallback) {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}
