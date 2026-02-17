import fs from "fs";

function slugify(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sqlQuote(v) {
  if (v === undefined || v === null) return "NULL";
  const s = String(v).trim();
  if (!s) return "NULL";
  return `'${s.replace(/'/g, "''")}'`;
}

function nowSql() {
  return "datetime('now')";
}

// CHANGE THIS if your file is comma-separated
const DELIM = ",";

const inputPath = process.argv[2] || "./data/agencies.tsv";
const outPath = process.argv[3] || "./import_agencies.sql";

const raw = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
const lines = raw.split(/\r?\n/).filter(l => l.trim().length);

if (lines.length < 2) {
  console.error("Need header + at least 1 data row");
  process.exit(1);
}

const headerRaw = lines[0];

// normalize: remove BOM, remove ALL \r, trim, lowercase
const header = headerRaw
  .replace(/^\uFEFF/, "")
  .replace(/\r/g, "")
  .split(DELIM)
  .map(h => h.trim().toLowerCase());

console.log("Detected headers:", header);

const idx = (col) => header.indexOf(String(col).toLowerCase());


const requiredCols = ["name", "country", "city", "website"];
for (const c of requiredCols) {
  if (idx(c) === -1) {
    console.error(`Missing required column: ${c}`);
    process.exit(1);
  }
}

const seen = new Map(); // baseId -> count
let sql = "BEGIN;\n";

for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(DELIM);

  const name = cols[idx("name")]?.trim() || "";
  if (!name) continue;

  const country = cols[idx("country")]?.trim() || "";
  const city = cols[idx("city")]?.trim() || "";
  const website = cols[idx("website")]?.trim() || "";

  const services = idx("services") >= 0 ? (cols[idx("services")]?.trim() || "") : "";
  const source = idx("source") >= 0 ? (cols[idx("source")]?.trim() || "") : "";
  const sourceUrl = idx("sourceUrl") >= 0 ? (cols[idx("sourceUrl")]?.trim() || "") : "";
  const blurb = idx("blurb") >= 0 ? (cols[idx("blurb")]?.trim() || "") : "";
  const keywords = idx("keywords") >= 0 ? (cols[idx("keywords")]?.trim() || "") : "";

  // stable id
  let baseId = slugify(name);
  if (country) baseId = `${baseId}-${slugify(country)}`;
  const n = (seen.get(baseId) || 0) + 1;
  seen.set(baseId, n);
  const id = n === 1 ? baseId : `${baseId}-${n}`;

  // optional derived fields
  const location = [city, country].filter(Boolean).join(", ") || null;
  const primary_service =
    services ? services.split(",")[0].trim() : null;

  // if you want JSON array:
  const services_json =
    services
      ? JSON.stringify(services.split(",").map(s => s.trim()).filter(Boolean))
      : null;

  sql += `INSERT INTO agencies (
  id, name, website, country, city, location,
  services, primary_service, services_json,
  source, sourceUrl, blurb, keywords,
  created_at, updated_at
) VALUES (
  ${sqlQuote(id)}, ${sqlQuote(name)}, ${sqlQuote(website)}, ${sqlQuote(country)}, ${sqlQuote(city)}, ${sqlQuote(location)},
  ${sqlQuote(services)}, ${sqlQuote(primary_service)}, ${sqlQuote(services_json)},
  ${sqlQuote(source)}, ${sqlQuote(sourceUrl)}, ${sqlQuote(blurb)}, ${sqlQuote(keywords)},
  ${nowSql()}, ${nowSql()}
)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  website=excluded.website,
  country=excluded.country,
  city=excluded.city,
  location=excluded.location,
  services=excluded.services,
  primary_service=excluded.primary_service,
  services_json=excluded.services_json,
  source=excluded.source,
  sourceUrl=excluded.sourceUrl,
  blurb=excluded.blurb,
  keywords=excluded.keywords,
  updated_at=${nowSql()};\n`;
}

sql += "COMMIT;\n";
fs.writeFileSync(outPath, sql, "utf8");
console.log(`Wrote ${outPath}`);
