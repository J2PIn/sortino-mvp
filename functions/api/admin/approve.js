export async function onRequestPost({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { submission_id } = await request.json();

  // Load submission
  const sub = await env.DB.prepare(`SELECT * FROM submissions WHERE id = ?`).bind(submission_id).first();
  if (!sub) return new Response("Not found", { status: 404 });

  const now = new Date().toISOString();

  // Upsert agency (simple MVP rules: base score placeholder)
  const agencyId = sub.id; // use submission id as agency id for MVP

  const services = JSON.stringify([sub.primary_service].filter(Boolean));
  const industries = JSON.stringify([sub.industry_theme].filter(Boolean));
  const highlights = JSON.stringify([
    "Submission received (MVP)",
    sub.evidence_key ? "Evidence uploaded (redacted)" : "No evidence uploaded"
  ]);

  await env.DB.prepare(`
    INSERT INTO agencies (
      id, name, website, location, primary_service,
      services_json, industries_json, highlights_json,
      score, confidence, verification, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      website=excluded.website,
      location=excluded.location,
      primary_service=excluded.primary_service,
      services_json=excluded.services_json,
      industries_json=excluded.industries_json,
      highlights_json=excluded.highlights_json,
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
    50,                              // MVP default score (you’ll compute later)
    sub.evidence_key ? "Med" : "Low",
    sub.evidence_key ? "Evidence" : "Unverified",
    now,
    now
  ).run();

  // Mark submission approved
  await env.DB.prepare(`UPDATE submissions SET status = 'approved' WHERE id = ?`)
    .bind(submission_id).run();

  return new Response(JSON.stringify({ ok: true, agency_id: agencyId }), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
