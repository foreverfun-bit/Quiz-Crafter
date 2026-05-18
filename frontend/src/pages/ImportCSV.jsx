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
} from "lucide-react";
import { toast } from "sonner";

const SERVER_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;

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
    return `This PDF is ${sizeMb} MB, which is too large for Vercel's direct preview upload limit. Export it from the source as CSV/text, split the PDF into smaller files under 4 MB, or compress it before importing.`;
  }

  return `This file is ${sizeMb} MB, which is too large for direct preview. Try a smaller export or split it into smaller files under 4 MB.`;
};

const ImportCSV = () => {
  const [file, setFile] = useState(null);
  const [source, setSource] = useState("auto");
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
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
    setPreviewError(null);
    setResult(null);

    const largeFileMessage = getLargeFileMessage(selectedFile);
    if (largeFileMessage) {
      setPreviewError(largeFileMessage);
      return;
    }

    await handlePreview(selectedFile, source);
  };

  const parseJsonResponse = async (response, fallbackMessage) => {
    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      const raw = text ? ` Server said: ${text.slice(0, 240)}` : "";
      throw new Error(`${fallbackMessage}.${raw}`);
    }

    if (!response.ok) {
      const debugText = data?.debug
        ? ` (${Object.entries(data.debug).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`).join("; ")})`
        : "";
      throw new Error(`${data?.error || fallbackMessage}${debugText}`);
    }

    return data || {};
  };

  const buildFormData = (selectedFile, action, selectedSource) => {
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("action", action);
    formData.append("source", selectedSource);
    return formData;
  };

  const handlePreview = async (selectedFile = file, selectedSource = source) => {
    if (!selectedFile) return;

    const largeFileMessage = getLargeFileMessage(selectedFile);
    if (largeFileMessage) {
      setPreview(null);
      setPreviewError(largeFileMessage);
      return;
    }

    setPreviewing(true);
    setPreviewError(null);

    try {
      const response = await fetch("/api/import-questions", {
        method: "POST",
        body: buildFormData(selectedFile, "preview", selectedSource),
      });

      const data = await parseJsonResponse(response, "Failed to preview import file");
      setPreview(data);
    } catch (error) {
      console.error("Preview failed:", error);
      setPreview(null);
      setPreviewError(error.message || "Preview failed");
      toast.error(error.message || "Preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  const handleSourceChange = async (value) => {
    setSource(value);
    setPreview(null);
    setPreviewError(null);
    setResult(null);
    if (file) await handlePreview(file, value);
  };

  const handleImport = async () => {
    if (!file) {
      toast.error("Please select a file first");
      return;
    }

    const largeFileMessage = getLargeFileMessage(file);
    if (largeFileMessage) {
      setPreviewError(largeFileMessage);
      return;
    }

    setImporting(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const userId = session?.user?.id;
      if (!userId) throw new Error("You must be signed in");

      const formData = buildFormData(file, "import", source);
      formData.append("sessionUserId", userId);

      const response = await fetch("/api/import-questions", {
        method: "POST",
        body: formData,
      });

      const data = await parseJsonResponse(response, "Import failed");
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
    }
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
            {["PDF under 4 MB", "CrowdPurr CSV", "TriviaNow CSV", "Generic CSV", "TSV", "TXT"].map((col) => (
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
              <span className="text-zinc-500">Analyzing file...</span>
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
              {preview.columns?.length > 0 && (
                <div className="mb-3">
                  <p className="text-zinc-500 text-sm mb-2">Detected Fields:</p>
                  <div className="flex flex-wrap gap-2">
                    {preview.columns.slice(0, 18).map((col, idx) => <Badge key={`${col}-${idx}`} className="bg-zinc-800 text-zinc-300">{col}</Badge>)}
                    {preview.columns.length > 18 && <span className="text-zinc-500 text-sm">+{preview.columns.length - 18} more</span>}
                  </div>
                </div>
              )}
              {preview.preview?.length > 0 && (
                <div className="overflow-x-auto">
                  <p className="text-zinc-500 text-sm mb-2">First {preview.preview.length} question(s):</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/10">
                        {["question", "type", "category", "answer", "wrong answers"].map((col) => <th key={col} className="text-left py-1 px-2 text-zinc-400 font-medium">{col}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview.map((row, idx) => (
                        <tr key={idx} className="border-b border-white/5">
                          <td className="py-1 px-2 text-zinc-300 max-w-[280px] truncate">{row.question || "-"}</td>
                          <td className="py-1 px-2 text-zinc-300">{row.questionType || "-"}</td>
                          <td className="py-1 px-2 text-zinc-300">{row.category || "-"}</td>
                          <td className="py-1 px-2 text-zinc-300 max-w-[160px] truncate">{row.correctAnswer || "-"}</td>
                          <td className="py-1 px-2 text-zinc-300 max-w-[180px] truncate">{row.incorrectAnswers || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {preview.warnings?.length > 0 && (
                <div className="mt-3 p-2 bg-amber-500/10 rounded text-xs text-amber-300">
                  {preview.warnings.slice(0, 4).map((warning, i) => <p key={i}>{warning}</p>)}
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex justify-center">
            <Button onClick={handleImport} disabled={!file || importing || previewing || !preview?.row_count} className="gradient-btn px-8">
              {importing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing...</> : <><Upload className="mr-2" size={18} />Import Questions</>}
            </Button>
          </div>

          {result && (
            <div className={`mt-6 p-4 rounded-lg ${result.error ? "bg-red-500/10 border border-red-500/20" : "bg-emerald-500/10 border border-emerald-500/20"}`}>
              <div className="flex items-start gap-3">
                {result.error ? <AlertCircle className="text-red-400 flex-shrink-0" size={20} /> : <CheckCircle className="text-emerald-400 flex-shrink-0" size={20} />}
                <div>
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

export default ImportCSV;
