export async function onRequestPost({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Accept either raw text/csv OR multipart file upload
  let csvText = "";
  const ct = (request.headers.get("Content-Type") || "").toLowerCase();

  if (ct.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!file) return new Response("Missing file", { status: 400 });
    csvText = await file.text();
  } else {
    csvText = await request.text();
  }

  const rows = parseCSV(csvText);
  if (!rows.length) return new Response("No rows", { status: 400 });

  // normalize headers
  const headers = rows[0].map(h => String(h || "").trim().toLowerCase());
  const dataRows = rows.slice(1).filter(r => r.some(cell => String(cell || "").trim() !== ""));

  const idx = (name) => headers.indexOf(name);

  const iName = idx("name");
  const iWebsite = idx("website");
  if (iName === -1 || iWebsite === -1) {
    return new Response("CSV must include at least: name, website", { status: 400 });
  }

  const iLoc = idx("location");
  const iPrimary = idx("primary_service");
  const iServices = idx("services");
  const iIndustries = idx("industries");
  const iSource = idx("source");

  const now = new Date().toISOString();
  let imported = 0;
  let skipped = 0;
  const errors = [];

  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];

    const name = (row[iName] || "").trim();
    const website = normalizeUrl((row[iWebsite] || "").trim());
    if (!name || !website) { skipped++; continue; }

    const location = iLoc !== -1 ? (row[iLoc] || "").trim() : "";
    const primary = iPrimary !== -1 ? (row[iPrimary] || "").trim() : "";
    const services = iServices !== -1 ? splitSemi(row[iServices]) : [];
    const industries = iIndustries !== -1 ? splitSemi(row[iIndustries]) : [];
    const source = iSource !== -1 ? (row[iSource] || "").trim() : "Seeded";

    const id = await stableId(`${website}|${name}`);

    const highlights = JSON.stringify([
      `Seeded listing (${source})`,
      "Unverified (claim to update / verify)"
    ]);

    const services_json = JSON.stringify(services.length ? services : (primary ? [primary] : []));
    const industries_json = JSON.stringify(industries);

    try {
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
        id,
        name,
        website,
        location || null,
        primary || null,
        services_json,
        industries_json,
        highlights,
        10,                 // seeded baseline score (keeps them low but present)
        "Low",
        "Unverified",
        now,
        now
      ).run();

      imported++;
    } catch (e) {
      errors.push({ row: r + 2, message: String(e) });
    }
  }

  return new Response(JSON.stringify({ ok: true, imported, skipped, errors }), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

/** CSV parser that handles quoted commas */
function parseCSV(text) {
  const out = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { inQuotes = false; continue; }
      cur += ch;
      continue;
    }

    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { row.push(cur); cur = ""; continue; }
    if (ch === "\n") { row.push(cur); out.push(row); row = []; cur = ""; continue; }
    if (ch === "\r") continue;
    cur += ch;
  }

  row.push(cur);
  out.push(row);
  return out.map(r => r.map(c => String(c ?? "").trim()));
}

function splitSemi(v) {
  return String(v || "")
    .split(";")
    .map(x => x.trim())
    .filter(Boolean);
}

function normalizeUrl(u) {
  try {
    // If missing scheme, add https
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    const url = new URL(u);
    // normalize: lowercase host, strip trailing slash
    const norm = `${url.protocol}//${url.hostname}${url.pathname}`.replace(/\/+$/, "");
    return norm;
  } catch {
    return "";
  }
}

async function stableId(input) {
  const enc = new TextEncoder();
  const buf = enc.encode(input.toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = Array.from(new Uint8Array(digest));
  // 16 bytes hex = 32 chars is plenty
  return bytes.slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}
