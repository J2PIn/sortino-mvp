export async function onRequestGet({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const res = await env.DB.prepare(`
    SELECT id, received_at, agency_name, agency_website, primary_service,
           industry_theme, channel, timeframe, verification_intent, evidence_key
    FROM submissions
    WHERE status = 'pending'
    ORDER BY received_at DESC
    LIMIT 200
  `).all();

  return new Response(JSON.stringify(res.results || []), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
