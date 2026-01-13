export async function onRequestPost({ request, env }) {
  try {
    const form = await request.formData();

    // Turnstile
    const token = form.get("cf-turnstile-response");
    if (!token) return json({ error: "Missing Turnstile token." }, 400);

    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, token, ip);
    if (!ok) return json({ error: "Turnstile verification failed." }, 400);

    const id = crypto.randomUUID();
    const receivedAt = new Date().toISOString();

    // Optional evidence file -> R2
    let evidenceKey = null;
    let evidenceType = null;

    const file = form.get("evidence");
    if (file && typeof file === "object" && file.arrayBuffer) {
      const filename = sanitizeFilename(file.name || "evidence");
      if (!isAllowed(filename)) {
        return json({ error: "Evidence file type not allowed (use PDF/PNG/JPG)." }, 400);
      }

      evidenceKey = `submissions/${id}/evidence/${filename}`;
      evidenceType = file.type || "application/octet-stream";

      await env.SUBMISSIONS_BUCKET.put(evidenceKey, await file.arrayBuffer(), {
        httpMetadata: { contentType: evidenceType }
      });
    }

    // Insert into D1 (pending)
    const row = {
      id,
      received_at: receivedAt,
      status: "pending",
      agency_name: form.get("agency_name") || "",
      agency_website: form.get("agency_website") || "",
      agency_location: form.get("agency_location") || "",
      primary_service: form.get("primary_service") || "",
      industry_theme: form.get("industry_theme") || "",
      channel: form.get("channel") || "",
      timeframe: form.get("timeframe") || "",
      budget_band: form.get("budget_band") || "",
      region: form.get("region") || "",
      baseline: form.get("baseline") || "",
      outcome: form.get("outcome") || "",
      notes: form.get("notes") || "",
      contact_email: form.get("contact_email") || "",
      verification_intent: form.get("verification_intent") || "not_sure",
      evidence_key: evidenceKey,
      evidence_content_type: evidenceType,
      submitted_from: form.get("submitted_from") || ""
    };

    await env.DB.prepare(`
      INSERT INTO submissions (
        id, received_at, status,
        agency_name, agency_website, agency_location, primary_service,
        industry_theme, channel, timeframe, budget_band, region,
        baseline, outcome, notes, contact_email, verification_intent,
        evidence_key, evidence_content_type, submitted_from
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?
      )
    `).bind(
      row.id, row.received_at, row.status,
      row.agency_name, row.agency_website, row.agency_location, row.primary_service,
      row.industry_theme, row.channel, row.timeframe, row.budget_band, row.region,
      row.baseline, row.outcome, row.notes, row.contact_email, row.verification_intent,
      row.evidence_key, row.evidence_content_type, row.submitted_from
    ).run();

    return json({ submission_id: id, status: "pending" }, 200);
  } catch (e) {
    return json({ error: "Submission failed." }, 500);
  }
}

async function verifyTurnstile(secret, token, ip) {
  const body = new URLSearchParams();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body
  });
  const data = await res.json();
  return !!data.success;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function isAllowed(name) {
  const n = name.toLowerCase();
  return n.endsWith(".pdf") || n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg");
}
