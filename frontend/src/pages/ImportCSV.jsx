import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
  Loader2,
  Download,
  Eye,
  FileUp,
} from "lucide-react";
import { toast } from "sonner";

const ImportCSV = () => {
  const [importType, setImportType] = useState("csv");
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  const fileInputRef = useRef(null);

  const resetStateForNewFile = (selectedFile) => {
    setFile(selectedFile);
    setResult(null);
    setPreview(null);
  };

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const lower = selectedFile.name.toLowerCase();

    if (importType === "csv" && !lower.endsWith(".csv")) {
      toast.error("Please select a CSV file");
      return;
    }

    if (importType === "pdf" && !lower.endsWith(".pdf")) {
      toast.error("Please select a PDF file");
      return;
    }

    resetStateForNewFile(selectedFile);

    if (importType === "csv") {
      await handlePreviewCSV(selectedFile);
    } else {
      await handlePreviewPDF(selectedFile);
    }
  };

  const handlePreviewCSV = async (selectedFile) => {
    setPreviewing(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("/api/import-preview", {
        method: "POST",
        body: formData,
      });

      const raw = await response.text();
      const data = raw ? JSON.parse(raw) : {};

      if (!response.ok) {
        throw new Error(data.error || "Failed to preview CSV");
      }

      setPreview(data);
    } catch (error) {
      console.error("CSV preview failed:", error);
      toast.error(error.message || "Failed to preview CSV");
    } finally {
      setPreviewing(false);
    }
  };

  const handlePreviewPDF = async (selectedFile) => {
    setPreviewing(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("/api/import-pdf", {
        method: "POST",
        body: formData,
      });

      const raw = await response.text();
      const data = raw ? JSON.parse(raw) : {};

      if (!response.ok) {
        throw new Error(data.error || "Failed to preview PDF");
      }

      setPreview({
        mode: "pdf",
        detected_questions: data.detected_questions || 0,
        preview: data.preview || [],
        notes: data.notes || [],
      });
    } catch (error) {
      console.error("PDF preview failed:", error);
      toast.error(error.message || "Failed to preview PDF");
    } finally {
      setPreviewing(false);
    }
  };

  const handleImport = async () => {
    if (!file) {
      toast.error("Please select a file first");
      return;
    }

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const endpoint = importType === "csv" ? "/api/import-csv" : "/api/import-pdf";

      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      const raw = await response.text();
      const data = raw ? JSON.parse(raw) : {};

      if (!response.ok) {
        throw new Error(data.error || "Import failed");
      }

      setResult(data);

      if (data.imported > 0) {
        toast.success(`Successfully imported ${data.imported} question${data.imported !== 1 ? "s" : ""}!`);
      } else {
        toast.info("No new questions were imported");
      }
    } catch (error) {
      console.error("Import failed:", error);
      setResult({
        error: true,
        message: error.message || "Import failed",
      });
      toast.error(error.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const headers =
      "Category,Question,Answer,Multiple choice options,Fun Fact,Venue,Date Used";
    const example1 =
      '90s Music,Which band released "Smells Like Teen Spirit" in 1991?,Nirvana,"Pearl Jam;Nirvana;Soundgarden;Alice in Chains",The song became an anthem for Generation X,The Pub,2024-01-15';
    const example2 =
      "World Geography,What is the capital of Australia?,Canberra,,,The Pub,2024-01-08";
    const example3 =
      "Science,Water boils at 100 degrees Celsius at sea level,True,,,Bar Trivia,";

    const csv = `${headers}\n${example1}\n${example2}\n${example3}`;

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "quiz_crafter_import_template.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in" data-testid="import-page">
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
          <span className="gradient-text">Import</span> Past Trivia
        </h1>
        <p className="text-zinc-500">
          Import old trivia sessions from CSV files or PDFs
        </p>
      </div>

      <div className="mb-6">
        <div className="inline-flex rounded-lg bg-zinc-800/50 p-1 border border-white/10">
          <button
            onClick={() => {
              setImportType("csv");
              setFile(null);
              setPreview(null);
              setResult(null);
            }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              importType === "csv"
                ? "bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            CSV Import
          </button>

          <button
            onClick={() => {
              setImportType("pdf");
              setFile(null);
              setPreview(null);
              setResult(null);
            }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              importType === "pdf"
                ? "bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            PDF Import
          </button>
        </div>
      </div>

      <Card className="glass-card mb-6">
        <CardHeader>
          <CardTitle className="text-white text-lg">
            {importType === "csv" ? "CSV Format" : "PDF Import Notes"}
          </CardTitle>
          <CardDescription className="text-zinc-500">
            {importType === "csv"
              ? "Use a structured CSV file for the most accurate import"
              : "PDF import works best when the file contains clearly formatted trivia questions"}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {importType === "csv" ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left py-2 px-3 text-zinc-400">Column</th>
                      <th className="text-left py-2 px-3 text-zinc-400">Required</th>
                      <th className="text-left py-2 px-3 text-zinc-400">Description</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-300">
                    <tr className="border-b border-white/5">
                      <td className="py-2 px-3 font-mono text-[#71E0DC]">Category</td>
                      <td className="py-2 px-3">Optional</td>
                      <td className="py-2 px-3">Question category</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-2 px-3 font-mono text-[#71E0DC]">Question</td>
                      <td className="py-2 px-3 text-emerald-400">Required</td>
                      <td className="py-2 px-3">Question text</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-2 px-3 font-mono text-[#71E0DC]">Answer</td>
                      <td className="py-2 px-3 text-emerald-400">Required</td>
                      <td className="py-2 px-3">Correct answer</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-2 px-3 font-mono text-[#71E0DC]">Multiple choice options</td>
                      <td className="py-2 px-3">Optional</td>
                      <td className="py-2 px-3">Separate choices with semicolons</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-2 px-3 font-mono text-[#71E0DC]">Fun Fact</td>
                      <td className="py-2 px-3">Optional</td>
                      <td className="py-2 px-3">Extra detail about the answer</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-2 px-3 font-mono text-[#71E0DC]">Venue</td>
                      <td className="py-2 px-3">Recommended</td>
                      <td className="py-2 px-3">Venue used for grouping sessions</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-mono text-[#71E0DC]">Date Used</td>
                      <td className="py-2 px-3">Recommended</td>
                      <td className="py-2 px-3">Used to group imported past sessions</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-4">
                <Button
                  variant="outline"
                  onClick={downloadTemplate}
                  className="border-white/20 text-white hover:bg-zinc-800"
                >
                  <Download className="mr-2" size={16} />
                  Download Template
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-3 text-sm text-zinc-400">
              <p>Best results come from PDFs that have:</p>
              <ul className="space-y-2">
                <li>• Clearly separated questions and answers</li>
                <li>• Consistent round or category labels</li>
                <li>• Multiple choice answers written in a predictable way</li>
                <li>• One session per file if possible</li>
              </ul>
              <div className="mt-3 p-3 rounded-lg bg-[#71E0DC]/10 border border-[#71E0DC]/20">
                <p className="text-[#71E0DC] text-sm">
                  PDF import is more approximate than CSV import, but it is ideal for older trivia packets.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardContent className="p-8">
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
              file ? "border-[#71E0DC]/50 bg-[#71E0DC]/5" : "border-zinc-700 hover:border-zinc-500"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={importType === "csv" ? ".csv" : ".pdf"}
              onChange={handleFileChange}
              className="hidden"
            />

            <div className="flex flex-col items-center">
              {file ? (
                <>
                  <div className="w-16 h-16 rounded-full bg-[#71E0DC]/20 flex items-center justify-center mb-4">
                    <FileText className="text-[#71E0DC]" size={32} />
                  </div>
                  <p className="text-white font-semibold mb-1">{file.name}</p>
                  <p className="text-zinc-500 text-sm">{(file.size / 1024).toFixed(1)} KB</p>
                  <p className="text-zinc-600 text-sm mt-2">Click to change file</p>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mb-4">
                    <FileUp className="text-zinc-500" size={32} />
                  </div>
                  <p className="text-white font-semibold mb-1">
                    Drop your {importType.toUpperCase()} file here
                  </p>
                  <p className="text-zinc-500 text-sm">or click to browse</p>
                </>
              )}
            </div>
          </div>

          {previewing && (
            <div className="mt-6 flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-500 mr-2" />
              <span className="text-zinc-500">
                {importType === "csv" ? "Analyzing CSV..." : "Analyzing PDF..."}
              </span>
            </div>
          )}

          {preview && !previewing && (
            <div className="mt-6 p-4 rounded-lg bg-zinc-900/50 border border-white/10">
              <div className="flex items-center gap-2 mb-3">
                <Eye size={16} className="text-[#71E0DC]" />
                <span className="text-white font-medium">Preview</span>
              </div>

              {importType === "csv" ? (
                <>
                  <div className="mb-3">
                    <p className="text-zinc-500 text-sm mb-2">Detected Columns:</p>
                    <div className="flex flex-wrap gap-2">
                      {preview.columns?.map((col, idx) => (
                        <Badge key={idx} className="bg-zinc-800 text-zinc-300">
                          {col}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {preview.preview?.length > 0 && (
                    <div className="overflow-x-auto">
                      <p className="text-zinc-500 text-sm mb-2">First {preview.preview.length} row(s):</p>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-white/10">
                            {preview.columns?.slice(0, 5).map((col, idx) => (
                              <th key={idx} className="text-left py-1 px-2 text-zinc-400 font-medium">
                                {col}
                              </th>
                            ))}
                            {preview.columns?.length > 5 && (
                              <th className="text-left py-1 px-2 text-zinc-500">...</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.preview.map((row, rowIdx) => (
                            <tr key={rowIdx} className="border-b border-white/5">
                              {preview.columns?.slice(0, 5).map((col, colIdx) => (
                                <td key={colIdx} className="py-1 px-2 text-zinc-300 max-w-[150px] truncate">
                                  {row[col] || "-"}
                                </td>
                              ))}
                              {preview.columns?.length > 5 && (
                                <td className="py-1 px-2 text-zinc-500">...</td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="text-zinc-300 text-sm mb-3">
                    Detected approximately <span className="text-[#71E0DC] font-semibold">{preview.detected_questions || 0}</span>{" "}
                    question{preview.detected_questions === 1 ? "" : "s"}
                  </p>

                  {preview.preview?.length > 0 && (
                    <div className="space-y-3">
                      {preview.preview.map((item, idx) => (
                        <div key={idx} className="p-3 rounded-lg bg-zinc-950/50 border border-white/5">
                          <p className="text-white text-sm mb-1">{item.question || "Question preview unavailable"}</p>
                          <p className="text-zinc-400 text-xs">
                            Answer: <span className="text-emerald-400">{item.answer || "Unknown"}</span>
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {preview.notes?.length > 0 && (
                    <div className="mt-4">
                      <p className="text-zinc-500 text-sm mb-2">Notes:</p>
                      <ul className="space-y-1 text-xs text-zinc-400">
                        {preview.notes.map((note, idx) => (
                          <li key={idx}>• {note}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="mt-6 flex justify-center">
            <Button
              onClick={handleImport}
              disabled={!file || importing}
              className="gradient-btn px-8"
            >
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="mr-2" size={18} />
                  Import {importType.toUpperCase()}
                </>
              )}
            </Button>
          </div>

          {result && (
            <div
              className={`mt-6 p-4 rounded-lg ${
                result.error
                  ? "bg-red-500/10 border border-red-500/20"
                  : "bg-emerald-500/10 border border-emerald-500/20"
              }`}
            >
              <div className="flex items-start gap-3">
                {result.error ? (
                  <AlertCircle className="text-red-400 flex-shrink-0" size={20} />
                ) : (
                  <CheckCircle className="text-emerald-400 flex-shrink-0" size={20} />
                )}

                <div>
                  {result.error ? (
                    <p className="text-red-400">{result.message}</p>
                  ) : (
                    <>
                      <p className="text-emerald-400 font-semibold mb-2">Import Complete</p>
                      <ul className="text-sm space-y-1">
                        {result.imported > 0 && (
                          <li className="text-zinc-300">
                            <span className="text-emerald-400">{result.imported}</span> new questions imported
                          </li>
                        )}
                        {result.updated > 0 && (
                          <li className="text-zinc-300">
                            <span className="text-[#AEB2EF]">{result.updated}</span> questions updated
                          </li>
                        )}
                        {result.sessions_created > 0 && (
                          <li className="text-zinc-300">
                            <span className="text-[#71E0DC]">{result.sessions_created}</span> past session
                            {result.sessions_created !== 1 ? "s" : ""} created
                          </li>
                        )}
                        {result.skipped > 0 && (
                          <li className="text-zinc-300">
                            <span className="text-zinc-500">{result.skipped}</span> duplicates skipped
                          </li>
                        )}
                      </ul>

                      {result.errors?.length > 0 && (
                        <div className="mt-3 p-2 bg-red-500/10 rounded text-xs text-red-400">
                          {result.errors.slice(0, 5).map((err, i) => (
                            <p key={i}>{err}</p>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass-card mt-6">
        <CardHeader>
          <CardTitle className="text-white text-lg">Tips</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-zinc-400 text-sm">
            <li className="flex items-start gap-2">
              <CheckCircle className="text-emerald-400 flex-shrink-0 mt-0.5" size={16} />
              <span>CSV is the most accurate option for bulk importing.</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="text-emerald-400 flex-shrink-0 mt-0.5" size={16} />
              <span>PDF works best for old trivia packets when CSV is not available.</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="text-emerald-400 flex-shrink-0 mt-0.5" size={16} />
              <span>Including Venue and Date Used helps automatically group questions into past sessions.</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};

export default ImportCSV;
