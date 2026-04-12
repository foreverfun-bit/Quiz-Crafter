import Papa from "papaparse";

export const config = {
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

function extractCsvTextFromMultipart(buffer) {
  const text = buffer.toString("utf8");
  const parts = text.split("\r\n\r\n");
  if (parts.length < 2) return "";
  const filePart = parts.slice(1).join("\r\n\r\n");
  const endBoundaryIndex = filePart.lastIndexOf("\r\n------");
  return endBoundaryIndex >= 0 ? filePart.slice(0, endBoundaryIndex) : filePart;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const rawBuffer = await readFileFromRequest(req);
    const csvText = extractCsvTextFromMultipart(rawBuffer);

    if (!csvText.trim()) {
      return res.status(400).json({ error: "No CSV content found" });
    }

    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors?.length) {
      return res.status(400).json({
        error: parsed.errors[0].message || "Failed to parse CSV",
      });
    }

    return res.status(200).json({
      columns: parsed.meta.fields || [],
      preview: (parsed.data || []).slice(0, 5),
    });
  } catch (error) {
    console.error("import-preview error:", error);
    return res.status(500).json({
      error: error.message || "Failed to preview CSV",
    });
  }
}
