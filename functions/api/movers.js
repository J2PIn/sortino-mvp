export async function onRequestGet({ env }) {
  // Show agencies where we have a previous score
  const res = await env.DB.prepare(`
    SELECT id, name, score, score_prev,
           (score - score_prev) AS delta,
           score_updated_at
    FROM agencies
    WHERE score_prev IS NOT NULL
    ORDER BY delta DESC
    LIMIT 10
  `).all();

  return new Response(JSON.stringify(res.results || []), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
