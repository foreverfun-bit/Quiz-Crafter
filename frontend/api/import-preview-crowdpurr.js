const Papa = require("papaparse");

exports.config = {
  api: {
    bodyParser: false,
  },
};

function readFileFromRequest(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function extractMultipartParts(buffer) {
  const text = buffer.toString("utf8");
  const boundary = text.split("\r\n")[0];

  if (!boundary) return {};

  const parts = text
    .split(boundary)
    .filter((part) => part && part !== "--\r\n" && part !== "--");

  const result = {};

  for (const part of parts) {
    const nameMatch = part.match(/name="([^"]+)"/);
    if (!nameMatch) continue;

    const fieldName = nameMatch[1];
    const splitIndex = part.indexOf("\r\n\r\n");
    if (splitIndex === -1) continue;

    let value = part.slice(splitIndex + 4);
    value = value.replace(/\r\n--$/, "");
    value = value.replace(/\r\n$/, "");

    result[fieldName] = value;
  }

  return result;
}

function normalizeHeader(header, seen) {
  const cleaned = String(header || "").trim();
  const key = cleaned.toLowerCase();

  if (!seen[key]) {
    seen[key] = 1;
    return cleaned;
  }

  const suffix = seen[key];
  seen[key] += 1;
  return `${cleaned}_${suffix}`;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const rawBuffer = await readFileFromRequest(req);
    const parts = extractMultipartParts(rawBuffer);
    const csvText = parts.file || "";

    if (!csvText.trim()) {
      return res.status(400).json({ error: "No CSV content found" });
    }

    const seen = {};
    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => normalizeHeader(header, seen),
    });

    // Never fail preview just because Papa reported duplicate header warnings.
    const previewRows = Array.isArray(parsed.data) ? parsed.data.slice(0, 5) : [];
    const fields = parsed.meta?.fields || [];
    const warnings = (parsed.errors || []).map((e) => e.message);

    return res.status(200).json({
      format: "crowdpurr",
      columns: fields,
      row_count: Array.isArray(parsed.data) ? parsed.data.length : 0,
      preview: previewRows,
      warnings,
    });
  } catch (error) {
    console.error("import-preview-crowdpurr error:", error);
    return res.status(500).json({
      error: error.message || "Failed to preview Crowdpurr CSV",
    });
  }
};
