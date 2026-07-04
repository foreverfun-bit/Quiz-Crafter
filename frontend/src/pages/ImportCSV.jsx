import { useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
  Loader2,
  Eye,
  FileUp,
  FileSpreadsheet,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

const SERVER_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;
const PDF_BATCH_SIZE = 6;
const PDF_JOB_STORAGE_PREFIX = "quiz-crafter-pdf-import-job";

const sourceOptions = [
  { value: "auto", label: "Auto Detect", description: "Best choice for most files" },
  { value: "crowdpurr", label: "CrowdPurr", description: "CrowdPurr CSV exports" },
  { value: "trivianow", label: "TriviaNow", description: "TriviaNow CSV exports" },
  { value: "generic", label: "Generic CSV", description: "Question/answer spreadsheets" },
  { value: "pdf", label: "PDF", description: "PDF rounds or question sheets" },
];

const getLargeFileMessage = (selectedFile) => {
  if (!selectedFile || selectedFile.size <= SERVER_UPLOAD_LIMIT_BYTES) return "";

  const sizeMb = (selectedFile.size / 1024 / 1024).toFixed(1);
  if (selectedFile.name.toLowerCase().endsWith(".pdf")) {
    return `This PDF is ${sizeMb} MB, so Quiz Crafter will extract its text in your browser before importing. Canva PDFs can take a few extra seconds.`;
  }

  return `This file is ${sizeMb} MB, which is too large for direct preview. Try a smaller export or split it into smaller files under 4 MB.`;
};

const isPdfFile = (selectedFile) => selectedFile?.name?.toLowerCase().endsWith(".pdf") || selectedFile?.type === "application/pdf";
const shouldExtractPdfInBrowser = (selectedFile) => isPdfFile(selectedFile);

const ImportCSV = () => {
  const [file, setFile] = useState(null);
  const [source, setSource] = useState("auto");
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [reviewRows, setReviewRows] = useState([]);
  const [previewError, setPreviewError] = useState(null);
  const [pdfProgress, setPdfProgress] = useState("");
  const [result, setResult] = useState(null);

  const fileInputRef = useRef(null);

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const lowerName = selectedFile.name.toLowerCase();
    const supported = [".csv", ".tsv", ".txt", ".pdf"].some((extension) => lowerName.endsWith(extension));
    if (!supported) {
      toast.error("Please select a CSV, TSV, TXT, or PDF file");
      return;
    }

    setFile(selectedFile);
    setPreview(null);
    setReviewRows([]);
    setPreviewError(null);
    setPdfProgress("");
    setResult(null);

    const largeFileMessage = getLargeFileMessage(selectedFile);
    if (largeFileMessage && !isPdfFile(selectedFile)) {
      setPreviewError(largeFileMessage);
      return;
    }

    await handlePreview(selectedFile, source);
  };

  const parseJsonText = (text, ok, fallbackMessage) => {
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      const raw = text ? ` Server said: ${text.slice(0, 240)}` : "";
      throw new Error(`${fallbackMessage}.${raw}`);
    }

    if (!ok) {
      const debugText = data?.debug
        ? ` (${Object.entries(data.debug).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`).join("; ")})`
        : "";
      throw new Error(`${data?.error || fallbackMessage}${debugText}`);
    }

    return data || {};
  };

  const parseJsonResponse = async (response, fallbackMessage) => {
    const text = await response.text();
    return parseJsonText(text, response.ok, fallbackMessage);
  };

  const postFormData = (formData, fallbackMessage) => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/import-questions");
      xhr.onload = () => {
        try {
          resolve(parseJsonText(xhr.responseText || "", xhr.status >= 200 && xhr.status < 300, fallbackMessage));
        } catch (error) {
          reject(error);
        }
      };
      xhr.onerror = () => reject(new Error(fallbackMessage));
      xhr.send(formData);
    });
  };

  const buildFormData = (selectedFile, action, selectedSource) => {
    const formData = new FormData();
    formData.append("file", selectedFile, selectedFile.name);
    formData.append("action", action);
    formData.append("source", selectedSource);
    return formData;
  };

  const handlePreview = async (selectedFile = file, selectedSource = source) => {
    if (!selectedFile) return;

    const largeFileMessage = getLargeFileMessage(selectedFile);
    if (largeFileMessage && !isPdfFile(selectedFile)) {
      setPreview(null);
      setPreviewError(largeFileMessage);
      return;
    }

    setPreviewing(true);
    setPdfProgress("");
    setPreviewError(isPdfFile(selectedFile) && largeFileMessage ? largeFileMessage : null);

    try {
      const response = shouldExtractPdfInBrowser(selectedFile)
        ? null
        : await fetch("/api/import-questions", {
          method: "POST",
          body: buildFormData(selectedFile, "preview", selectedSource),
        });

      const data = shouldExtractPdfInBrowser(selectedFile)
        ? await processPdfImportJob(selectedFile, selectedSource, setPdfProgress)
        : await parseJsonResponse(response, "Failed to preview import file");
      setPreview(data);
      setReviewRows(normalizeReviewRows(data.questions || data.preview || []));
    } catch (error) {
      console.error("Preview failed:", error);
      setPreview(null);
      setPreviewError(error.message || "Preview failed");
      toast.error(error.message || "Preview failed");
    } finally {
      setPreviewing(false);
      setPdfProgress("");
    }
  };

  const handleSourceChange = async (value) => {
    setSource(value);
    setPreview(null);
    setReviewRows([]);
    setPreviewError(null);
    setPdfProgress("");
    setResult(null);
    if (file) await handlePreview(file, value);
  };

  const handleImport = async () => {
    if (!file) {
      toast.error("Please select a file first");
      return;
    }

    const largeFileMessage = getLargeFileMessage(file);
    if (largeFileMessage && !isPdfFile(file)) {
      setPreviewError(largeFileMessage);
      return;
    }

    setImporting(true);
    setPdfProgress("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const userId = session?.user?.id;
      if (!userId) throw new Error("You must be signed in");

      if (!reviewRows.length) throw new Error("Review the detected rows before importing.");
      const data = await postReviewedQuestions(reviewRows, source, userId, file.name);
      setResult(data);

      if (data.imported > 0) toast.success(`Imported ${data.imported} question${data.imported === 1 ? "" : "s"}`);
      else toast.info("No new questions were imported");

      if (data.session_error) toast.error(`Questions imported, but past session failed: ${data.session_error}`);
      else if (data.sessions_created > 0) toast.success("Past session created!");
    } catch (error) {
      console.error("Import failed:", error);
      setResult({ error: true, message: error.message || "Import failed" });
      toast.error(error.message || "Import failed");
    } finally {
      setImporting(false);
      setPdfProgress("");
    }
  };

  const handleExportPreviewCsv = () => {
    if (!reviewRows.length) return;
    const csv = toImportCsv(reviewRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(file?.name || "quiz-crafter-import").replace(/\.[^.]+$/, "")}-review.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const updateReviewRow = (index, field, value) => {
    setReviewRows((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  };

  const removeReviewRow = (index) => {
    setReviewRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
  };

  const selectedSource = sourceOptions.find((option) => option.value === source) || sourceOptions[0];

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
          <span className="gradient-text">Import</span> Questions
        </h1>
        <p className="text-zinc-500">Bring in PDF question sheets, CrowdPurr exports, TriviaNow exports, or standard question spreadsheets.</p>
      </div>

      <Card className="glass-card mb-6">
        <CardHeader>
          <CardTitle className="text-white text-lg">Import Source</CardTitle>
          <CardDescription className="text-zinc-500">Auto Detect is usually enough, but you can force a source when the preview looks wrong.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 items-end">
            <div className="space-y-2">
              <Label className="text-zinc-300">Source</Label>
              <Select value={source} onValueChange={handleSourceChange}>
                <SelectTrigger className="bg-zinc-950/50 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-white/10 text-white">
                  {sourceOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg border border-white/10 bg-zinc-950/40 p-4">
              <p className="text-white font-medium">{selectedSource.label}</p>
              <p className="text-zinc-500 text-sm mt-1">{selectedSource.description}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card mb-6">
        <CardHeader>
          <CardTitle className="text-white text-lg">Supported Files</CardTitle>
          <CardDescription className="text-zinc-500">The importer maps your file into saved library questions and creates a past session when possible.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {["Large PDFs", "CrowdPurr CSV", "TriviaNow CSV", "Generic CSV", "TSV", "TXT"].map((col) => (
              <Badge key={col} className="bg-zinc-800 text-zinc-300">{col}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardContent className="p-8">
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${file ? "border-[#71E0DC]/50 bg-[#71E0DC]/5" : "border-zinc-700 hover:border-zinc-500"}`}
          >
            <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt,.pdf,text/csv,application/pdf" onChange={handleFileChange} className="hidden" />
            <div className="flex flex-col items-center">
              {file ? (
                <>
                  <div className="w-16 h-16 rounded-full bg-[#71E0DC]/20 flex items-center justify-center mb-4">
                    {file.name.toLowerCase().endsWith(".pdf") ? <FileText className="text-[#71E0DC]" size={32} /> : <FileSpreadsheet className="text-[#71E0DC]" size={32} />}
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
                  <p className="text-white font-semibold mb-1">Upload questions</p>
                  <p className="text-zinc-500 text-sm">CSV, TSV, TXT, or PDF</p>
                </>
              )}
            </div>
          </div>

          {previewing && (
            <div className="mt-6 flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-500 mr-2" />
              <span className="text-zinc-500">{pdfProgress || "Analyzing file..."}</span>
            </div>
          )}

          {previewError && !previewing && (
            <div className="mt-6 p-4 rounded-lg bg-red-500/10 border border-red-500/20">
              <div className="flex items-start gap-3">
                <AlertCircle className="text-red-400 flex-shrink-0" size={20} />
                <div>
                  <p className="text-red-300 font-semibold">Preview failed</p>
                  <p className="text-red-200/80 text-sm mt-1 break-words">{previewError}</p>
                </div>
              </div>
            </div>
          )}

          {preview && !previewing && (
            <div className="mt-6 p-4 rounded-lg bg-zinc-900/50 border border-white/10">
              <div className="flex items-center gap-2 mb-3">
                <Eye size={16} className="text-[#71E0DC]" />
                <span className="text-white font-medium">Preview</span>
              </div>
              <div className="mb-3 space-y-2 text-sm">
                <p className="text-zinc-300">Format detected: <span className="text-[#71E0DC]">{preview.format}</span></p>
                <p className="text-zinc-300">Questions found: <span className="text-[#71E0DC]">{preview.row_count}</span></p>
              </div>
              {reviewRows.length > 0 && (
                <div className="mb-4">
                  <Button type="button" variant="outline" size="sm" onClick={handleExportPreviewCsv} className="border-white/20 text-white hover:bg-zinc-800">
                    Export Review CSV
                  </Button>
                </div>
              )}
              {preview.columns?.length > 0 && (
                <div className="mb-3">
                  <p className="text-zinc-500 text-sm mb-2">Detected Fields:</p>
                  <div className="flex flex-wrap gap-2">
                    {preview.columns.slice(0, 18).map((col, idx) => <Badge key={`${col}-${idx}`} className="bg-zinc-800 text-zinc-300">{col}</Badge>)}
                    {preview.columns.length > 18 && <span className="text-zinc-500 text-sm">+{preview.columns.length - 18} more</span>}
                  </div>
                </div>
              )}
              {preview.categoryLists?.length > 0 && (
                <div className="mb-4 rounded-lg border border-[#71E0DC]/20 bg-[#71E0DC]/5 p-3">
                  <p className="text-[#71E0DC] text-sm font-semibold mb-2">Extracted Round Categories</p>
                  <div className="space-y-2">
                    {preview.categoryLists.map((list, index) => (
                      <div key={`${list.round}-${index}`} className="text-xs text-zinc-300">
                        <span className="text-white font-medium">{list.round}:</span>{" "}
                        {(list.categories || []).join(", ")}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {reviewRows.length > 0 && (
                <div className="overflow-x-auto">
                  <p className="text-zinc-500 text-sm mb-2">Review and edit every detected row before importing:</p>
                  <table className="w-full min-w-[1500px] text-xs">
                    <thead>
                      <tr className="border-b border-white/10">
                        {["round", "#", "category", "type", "question", "option a", "option b", "option c", "option d", "answer", "fun fact", "image url", ""].map((col) => <th key={col} className="text-left py-1 px-2 text-zinc-400 font-medium">{col}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {reviewRows.map((row, idx) => (
                        <tr key={idx} className="border-b border-white/5">
                          <td className="py-2 px-1"><ReviewInput value={row.round} onChange={(value) => updateReviewRow(idx, "round", value)} className="w-24" /></td>
                          <td className="py-2 px-1"><ReviewInput value={row.questionNumber} onChange={(value) => updateReviewRow(idx, "questionNumber", value)} className="w-14" /></td>
                          <td className="py-2 px-1"><ReviewInput value={row.category} onChange={(value) => updateReviewRow(idx, "category", value)} className="w-32" /></td>
                          <td className="py-2 px-1">
                            <select value={row.questionType} onChange={(e) => updateReviewRow(idx, "questionType", e.target.value)} className="h-9 w-36 rounded-md bg-zinc-950/80 border border-white/10 text-white px-2">
                              <option value="true_false">True/False</option>
                              <option value="multiple_choice">Multiple Choice</option>
                              <option value="written">Written</option>
                              <option value="picture">Image</option>
                            </select>
                          </td>
                          <td className="py-2 px-1"><ReviewTextarea value={row.question} onChange={(value) => updateReviewRow(idx, "question", value)} className="w-72" /></td>
                          <td className="py-2 px-1"><ReviewInput value={row.optionA} onChange={(value) => updateReviewRow(idx, "optionA", value)} className="w-28" /></td>
                          <td className="py-2 px-1"><ReviewInput value={row.optionB} onChange={(value) => updateReviewRow(idx, "optionB", value)} className="w-28" /></td>
                          <td className="py-2 px-1"><ReviewInput value={row.optionC} onChange={(value) => updateReviewRow(idx, "optionC", value)} className="w-28" /></td>
                          <td className="py-2 px-1"><ReviewInput value={row.optionD} onChange={(value) => updateReviewRow(idx, "optionD", value)} className="w-28" /></td>
                          <td className="py-2 px-1"><ReviewInput value={row.correctAnswer} onChange={(value) => updateReviewRow(idx, "correctAnswer", value)} className="w-32" /></td>
                          <td className="py-2 px-1"><ReviewTextarea value={row.funFact} onChange={(value) => updateReviewRow(idx, "funFact", value)} className="w-64" /></td>
                          <td className="py-2 px-1"><ReviewInput value={row.imageUrl} onChange={(value) => updateReviewRow(idx, "imageUrl", value)} className="w-44" /></td>
                          <td className="py-2 px-1">
                            <Button type="button" variant="ghost" size="icon" onClick={() => removeReviewRow(idx)} className="text-red-300 hover:bg-red-500/10">
                              <Trash2 size={15} />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {preview.warnings?.length > 0 && (
                <div className="mt-3 p-2 bg-amber-500/10 rounded text-xs text-amber-300">
                  {preview.warnings.map((warning, i) => <p key={i}>{warning}</p>)}
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex justify-center">
            <Button onClick={handleImport} disabled={!file || importing || previewing || !reviewRows.length} className="gradient-btn px-8">
              {importing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing...</> : <><Upload className="mr-2" size={18} />Import Questions</>}
            </Button>
          </div>

          {result && (
            <div className={`mt-6 p-4 rounded-lg ${result.error ? "bg-red-500/10 border border-red-500/20" : "bg-emerald-500/10 border border-emerald-500/20"}`}>
              <div className="flex items-start gap-3">
                {result.error ? <AlertCircle className="text-red-400 flex-shrink-0" size={20} /> : <CheckCircle className="text-emerald-400 flex-shrink-0" size={20} />}
                <div className="w-full min-w-0">
                  {result.error ? <p className="text-red-400">{result.message}</p> : (
                    <>
                      <p className="text-emerald-400 font-semibold mb-2">Import Complete</p>
                      <ul className="text-sm space-y-1">
                        <li className="text-zinc-300">Format detected: <span className="text-[#71E0DC]">{result.format}</span></li>
                        <li className="text-zinc-300"><span className="text-emerald-400">{result.imported || 0}</span> imported</li>
                        <li className="text-zinc-300"><span className="text-zinc-500">{result.skipped || 0}</span> skipped</li>
                        <li className="text-zinc-300"><span className="text-[#AEB2EF]">{result.sessions_created || 0}</span> past session{(result.sessions_created || 0) === 1 ? "" : "s"} created</li>
                        {result.session_name && <li className="text-zinc-300">Session name: <span className="text-white">{result.session_name}</span></li>}
                      </ul>
                      {result.skipped_details?.length > 0 && (
                        <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                          <p className="text-amber-300 font-semibold text-sm mb-2">Skipped Questions</p>
                          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                            {result.skipped_details.slice(0, 20).map((item, index) => (
                              <div key={`${item.question}-${index}`} className="rounded-md bg-zinc-950/40 border border-white/10 p-3 text-xs">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  {item.row && <Badge className="bg-zinc-800 text-zinc-300">#{item.row}</Badge>}
                                  {item.round && <Badge className="bg-zinc-800 text-zinc-300">{item.round}</Badge>}
                                  {item.category && <Badge className="bg-zinc-800 text-zinc-300">{item.category}</Badge>}
                                </div>
                                <p className="text-zinc-200 leading-relaxed break-words">{item.question}</p>
                                <p className="text-amber-200/90 mt-1">Reason: {item.reason}</p>
                              </div>
                            ))}
                            {result.skipped_details.length > 20 && <p className="text-zinc-500 text-xs">+{result.skipped_details.length - 20} more skipped questions</p>}
                          </div>
                        </div>
                      )}
                      {result.session_error && <div className="mt-3 p-2 bg-amber-500/10 rounded text-xs text-amber-300">Past session was not created: {result.session_error}</div>}
                      {result.errors?.length > 0 && <div className="mt-3 p-2 bg-red-500/10 rounded text-xs text-red-400">{result.errors.slice(0, 5).map((err, i) => <p key={i}>{err}</p>)}</div>}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const buildImportFormData = (selectedFile, selectedSource, userId) => {
  const formData = new FormData();
  formData.append("file", selectedFile, selectedFile.name);
  formData.append("action", "import");
  formData.append("source", selectedSource);
  formData.append("sessionUserId", userId);
  return formData;
};

const ReviewInput = ({ value, onChange, className = "" }) => (
  <input
    value={value ?? ""}
    onChange={(e) => onChange(e.target.value)}
    className={`h-9 rounded-md bg-zinc-950/80 border border-white/10 text-white px-2 outline-none focus:border-[#71E0DC]/70 ${className}`}
  />
);

const ReviewTextarea = ({ value, onChange, className = "" }) => (
  <textarea
    value={value ?? ""}
    onChange={(e) => onChange(e.target.value)}
    className={`min-h-[54px] rounded-md bg-zinc-950/80 border border-white/10 text-white px-2 py-2 outline-none focus:border-[#71E0DC]/70 ${className}`}
  />
);

async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;

  await new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-pdfjs-loader='true']");
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
    script.async = true;
    script.dataset.pdfjsLoader = "true";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load the browser PDF reader. Please check your connection and retry."));
    document.head.appendChild(script);
  });

  if (!window.pdfjsLib) throw new Error("Could not start the browser PDF reader.");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  return window.pdfjsLib;
}

async function extractPdfPagesInBrowser(file, onProgress) {
  const pdfjs = await loadPdfJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes, disableWorker: true });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    if (typeof onProgress === "function") onProgress(`Processing page ${pageNumber} of ${pdf.numPages}.`);
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = [];
    let lastY = null;
    let currentLine = [];

    content.items.forEach((item) => {
      const text = String(item.str || "").trim();
      if (!text) return;
      const y = Math.round(item.transform?.[5] || 0);
      if (lastY !== null && Math.abs(y - lastY) > 4 && currentLine.length) {
        lines.push(currentLine.join(" "));
        currentLine = [];
      }
      currentLine.push(text);
      lastY = y;
    });

    if (currentLine.length) lines.push(currentLine.join(" "));
    pages.push({ pageNumber, text: lines.join("\n") });
  }

  return pages;
}

async function processPdfImportJob(file, selectedSource, onProgress) {
  const jobKey = getPdfJobKey(file, selectedSource);
  const pages = await extractPdfPagesInBrowser(file, onProgress);
  const savedJob = readPdfJob(jobKey);
  const job = savedJob?.totalPages === pages.length
    ? savedJob
    : { totalPages: pages.length, nextPageIndex: 0, rows: [], warnings: [] };

  for (let pageIndex = job.nextPageIndex || 0; pageIndex < pages.length; pageIndex += PDF_BATCH_SIZE) {
    const ownedPages = pages.slice(pageIndex, Math.min(pageIndex + PDF_BATCH_SIZE, pages.length));
    const lookaheadPage = pages[pageIndex + PDF_BATCH_SIZE];
    const batchPages = lookaheadPage ? [...ownedPages, lookaheadPage] : ownedPages;
    const endPage = ownedPages[ownedPages.length - 1]?.pageNumber || pageIndex + 1;
    if (typeof onProgress === "function") onProgress(`Parsing pages ${ownedPages[0]?.pageNumber || pageIndex + 1}-${endPage} of ${pages.length}.`);

    const batch = await postPdfPageBatch(batchPages, ownedPages.map((page) => page.pageNumber), selectedSource, file.name);
    job.rows = renumberReviewRows(mergeReviewRows(job.rows, normalizeReviewRows(batch.questions || [])));
    job.warnings = [...new Set([...(job.warnings || []), ...(batch.warnings || [])])];
    job.nextPageIndex = pageIndex + PDF_BATCH_SIZE;
    writePdfJob(jobKey, job);
  }

  return {
    format: "PDF",
    source: "pdf",
    columns: IMPORT_CSV_HEADER,
    row_count: job.rows.length,
    preview: renumberReviewRows(job.rows).slice(0, 8),
    questions: renumberReviewRows(job.rows),
    warnings: job.warnings || [],
    categoryLists: [],
  };
}

async function postPdfPageBatch(pages, ownedPageNumbers, selectedSource, filename) {
  const response = await fetch("/api/import-questions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "parse-page-batch",
      source: selectedSource === "auto" ? "pdf" : selectedSource,
      filename,
      pages,
      ownedPageNumbers,
    }),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Failed to parse PDF page batch. Server said: ${text.slice(0, 240)}`);
  }
  if (!response.ok) throw new Error(data.error || "Failed to parse PDF page batch");
  return data;
}

async function postReviewedQuestions(rows, selectedSource, userId, filename) {
  const response = await fetch("/api/import-questions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "import-reviewed",
      source: selectedSource === "auto" ? "generic" : selectedSource,
      filename,
      sessionUserId: userId,
      questions: rows,
    }),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Import failed. Server said: ${text.slice(0, 240)}`);
  }
  if (!response.ok) throw new Error(data.error || "Import failed");
  return data;
}

function getPdfJobKey(file, selectedSource) {
  return `${PDF_JOB_STORAGE_PREFIX}:${selectedSource}:${file.name}:${file.size}:${file.lastModified}`;
}

function readPdfJob(jobKey) {
  try {
    return JSON.parse(localStorage.getItem(jobKey) || "null");
  } catch {
    return null;
  }
}

function writePdfJob(jobKey, job) {
  try {
    localStorage.setItem(jobKey, JSON.stringify(job));
  } catch {
    // A full browser storage cache should not block the import preview.
  }
}

function normalizeReviewRows(rows) {
  return (rows || []).map((row, index) => {
    const options = optionValues(row);
    return {
      round: row.round || row.round_name || "",
      questionNumber: row.questionNumber || row.source_order || index + 1,
      category: row.category || "",
      questionType: row.questionType || row.question_type || "written",
      question: row.question || row.question_text || "",
      optionA: row.optionA || options[0] || "",
      optionB: row.optionB || options[1] || "",
      optionC: row.optionC || options[2] || "",
      optionD: row.optionD || options[3] || "",
      correctAnswer: row.correctAnswer || row.correct_answer || "",
      incorrectAnswers: row.incorrectAnswers || row.incorrect_answers || "",
      funFact: row.funFact || row.fun_fact || "",
      imageUrl: row.imageUrl || row.image_url || "",
      pageNumber: row.pageNumber || row.page_number || null,
    };
  });
}

function mergeReviewRows(existingRows, newRows) {
  const seen = new Set(existingRows.map(reviewRowKey));
  const merged = [...existingRows];
  newRows.forEach((row) => {
    const key = reviewRowKey(row);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(row);
  });
  return merged;
}

function renumberReviewRows(rows) {
  return rows.map((row, index) => ({ ...row, questionNumber: index + 1 }));
}

function reviewRowKey(row) {
  return [row.pageNumber || "", row.round || "", row.question || "", row.correctAnswer || ""].join("|").toLowerCase().replace(/[^a-z0-9|]/g, "");
}

const IMPORT_CSV_HEADER = ["Round", "Question Number", "Category", "Type", "Question", "Option A", "Option B", "Option C", "Option D", "Answer", "Fun Fact", "Image URL"];

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function optionValues(question) {
  const options = Array.isArray(question.options) ? question.options : String(question.incorrectAnswers || question.incorrect_answers || "").split(";").map((item) => item.trim()).filter(Boolean);
  const answer = question.correctAnswer || question.correct_answer || "";
  if (question.questionType === "true_false" || question.question_type === "true_false") return ["True", "False", "", ""];
  const merged = [answer, ...options].filter(Boolean);
  return [merged[0] || "", merged[1] || "", merged[2] || "", merged[3] || ""];
}

function toImportCsv(questions) {
  const rows = questions.map((question, index) => {
    const options = optionValues(question);
    return [
      question.round || question.round_name || "",
      question.questionNumber || question.source_order || index + 1,
      question.category || "",
      question.questionType || question.question_type || "",
      question.question || question.question_text || "",
      ...options,
      question.correctAnswer || question.correct_answer || "",
      question.funFact || question.fun_fact || "",
      question.imageUrl || question.image_url || "",
    ];
  });
  return [IMPORT_CSV_HEADER, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

export default ImportCSV;
