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
  const segments = text.split("\r\n");
  const boundary = segments[0];

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

function isCrowdpurr(fields) {
  const keys = (fields || []).map((f) => String(f).trim().toLowerCase());
  return (
    keys.includes("question") &&
    keys.includes("category") &&
    keys.includes("correctanswer")
  );
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

    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => String(header || "").trim(),
    });

    // Ignore duplicate-header warnings completely.
    const realErrors = (parsed.errors || []).filter((err) => {
      const msg = String(err.message || "");
      return !msg.includes("Duplicate headers found and renamed");
    });

    if (realErrors.length > 0) {
      console.error("PREVIEW REAL ERRORS:", realErrors);
      return res.status(400).json({
        error: realErrors[0].message || "Failed to parse CSV",
      });
    }

    const fields = parsed.meta.fields || [];

    if (!isCrowdpurr(fields)) {
      return res.status(400).json({
        error: "This importer currently supports Crowdpurr CSV only",
      });
    }

    return res.status(200).json({
      format: "crowdpurr",
      columns: fields,
      row_count: (parsed.data || []).length,
      preview: (parsed.data || []).slice(0, 5),
      warnings: (parsed.errors || [])
        .map((e) => e.message)
        .filter((msg) =>
          String(msg).includes("Duplicate headers found and renamed")
        ),
    });
  } catch (error) {
    console.error("import-preview-crowdpurr error:", error);
    return res.status(500).json({
      error: error.message || "Failed to preview Crowdpurr CSV",
    });
  }
};
