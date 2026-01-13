export async function onRequestPost({ request, env }) {
  try {
    const form = await request.formData();

    // Turnstile token
    const token = form.get("cf-turnstile-response");
    if (!token) return json({ error: "Missing Turnstile token." }, 400);

    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, token, ip);
    if (!ok) return json({ error: "Turnstile verification failed." }, 400);

    // Create submission ID
    const submissionId = crypto.randomUUID();

    // Metadata (anonymized)
    const metadata = {
      submission_id: submissionId,
      received_at: new Date().toISOString(),
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
      submitted_from: form.get("submitted_from") || ""
    };

    // Save metadata
    const metaKey = `submissions/${submissionId}/metadata.json`;
    await env.SUBMISSIONS_BUCKET.put(metaKey, JSON.stringify(metadata, null, 2), {
      httpMetadata: { contentType: "application/json; charset=utf-8" }
    });

    // Optional evidence file
    const file = form.get("evidence");
    if (file && typeof file === "object" && file.arrayBuffer) {
      const filename = sanitizeFilename(file.name || "evidence");
      if (!isAllowed(filename)) {
        return json({ error: "Evidence file type not allowed (use PDF/PNG/JPG)." }, 400);
      }

      const evidenceKey = `submissions/${submissionId}/evidence/${filename}`;
      await env.SUBMISSIONS_BUCKET.put(evidenceKey, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type || "application/octet-stream" }
      });

      // Update metadata with evidence pointer
      const meta2 = { ...metadata, evidence_key: evidenceKey, evidence_content_type: file.type || "" };
      await env.SUBMISSIONS_BUCKET.put(metaKey, JSON.stringify(meta2, null, 2), {
        httpMetadata: { contentType: "application/json; charset=utf-8" }
      });
    }

    return json({ submission_id: submissionId }, 200);
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
