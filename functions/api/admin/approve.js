export async function onRequestPost({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { submission_id } = await request.json();

  // Load submission
  const sub = await env.DB.prepare(`SELECT * FROM submissions WHERE id = ?`)
    .bind(submission_id)
    .first();

  if (!sub) return new Response("Not found", { status: 404 });

  const now = new Date().toISOString();

  // MVP: use submission id as agency id
  const agencyId = sub.id;

  // Pull existing score (if agency already exists) so we can store score_prev
  const existing = await env.DB.prepare(`SELECT score FROM agencies WHERE id = ?`)
    .bind(agencyId)
    .first();

  const prevScore = existing ? existing.score : null;

  const services = JSON.stringify([sub.primary_service].filter(Boolean));
  const industries = JSON.stringify([sub.industry_theme].filter(Boolean));
  const highlights = JSON.stringify([
    "Submission received (MVP)",
    sub.evidence_key ? "Evidence uploaded (redacted)" : "No evidence uploaded"
  ]);

  // MVP scoring placeholder
  const newScore = 50;

  await env.DB.prepare(`
    INSERT INTO agencies (
      id, name, website, location, primary_service,
      services_json, industries_json, highlights_json,
      score, score_prev, score_updated_at,
      confidence, verification, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      website=excluded.website,
      location=excluded.location,
      primary_service=excluded.primary_service,
      services_json=excluded.services_json,
      industries_json=excluded.industries_json,
      highlights_json=excluded.highlights_json,
      score_prev=excluded.score_prev,
      score=excluded.score,
      score_updated_at=excluded.score_updated_at,
      confidence=excluded.confidence,
      verification=excluded.verification,
      updated_at=excluded.updated_at
  `).bind(
    agencyId,
    sub.agency_name,
    sub.agency_website,
    sub.agency_location,
    sub.primary_service,
    services,
    industries,
    highlights,
    newScore,
    prevScore,
    now,
    sub.evidence_key ? "Med" : "Low",
    sub.evidence_key ? "Evidence" : "Unverified",
    now,
    now
  ).run();

  // Mark submission approved
  await env.DB.prepare(`UPDATE submissions SET status = 'approved' WHERE id = ?`)
    .bind(submission_id)
    .run();

  return new Response(JSON.stringify({ ok: true, agency_id: agencyId }), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
