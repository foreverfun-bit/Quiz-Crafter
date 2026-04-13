import { useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
  Loader2,
  Eye,
  FileUp,
} from "lucide-react";
import { toast } from "sonner";

const ImportCSV = () => {
  const [file, setFile] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  const fileInputRef = useRef(null);

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please select a CSV file");
      return;
    }

    setFile(selectedFile);
    setPreview(null);
    setResult(null);

    await handlePreview(selectedFile);
  };

  const parseJsonResponse = async (response, fallbackMessage) => {
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(fallbackMessage);
    }

    if (!response.ok) {
      throw new Error(data.error || fallbackMessage);
    }

    return data;
  };

  const handlePreview = async (selectedFile) => {
    setPreviewing(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("/api/import-preview-crowdpurr", {
        method: "POST",
        body: formData,
      });

      const data = await parseJsonResponse(response, "Failed to preview Crowdpurr CSV");
      setPreview(data);
    } catch (error) {
      console.error("Preview failed:", error);
      toast.error(error.message || "Preview failed");
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
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const userId = session?.user?.id;
      if (!userId) {
        throw new Error("You must be signed in");
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("sessionUserId", userId);

      const response = await fetch("/api/import-crowdpurr", {
        method: "POST",
        body: formData,
      });

      const data = await parseJsonResponse(response, "Import failed");
      setResult(data);

      if (data.imported > 0) {
        toast.success(`Imported ${data.imported} question${data.imported === 1 ? "" : "s"}`);
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

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
          <span className="gradient-text">Import</span> Crowdpurr CSV
        </h1>
        <p className="text-zinc-500">
          Clean import flow for Crowdpurr exports only
        </p>
      </div>

      <Card className="glass-card mb-6">
        <CardHeader>
          <CardTitle className="text-white text-lg">Supported Crowdpurr Fields</CardTitle>
          <CardDescription className="text-zinc-500">
            This rebuild only supports Crowdpurr exports for now
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {["question", "category", "correctAnswer", "incorrectAnswers", "note", "round"].map((col) => (
              <Badge key={col} className="bg-zinc-800 text-zinc-300">
                {col}
              </Badge>
            ))}
          </div>
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
              accept=".csv"
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
                  <p className="text-white font-semibold mb-1">Upload a Crowdpurr CSV</p>
                  <p className="text-zinc-500 text-sm">Click to browse</p>
                </>
              )}
            </div>
          </div>

          {previewing && (
            <div className="mt-6 flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-500 mr-2" />
              <span className="text-zinc-500">Analyzing CSV...</span>
            </div>
          )}

          {preview && !previewing && (
            <div className="mt-6 p-4 rounded-lg bg-zinc-900/50 border border-white/10">
              <div className="flex items-center gap-2 mb-3">
                <Eye size={16} className="text-[#71E0DC]" />
                <span className="text-white font-medium">Preview</span>
              </div>

              <div className="mb-3 space-y-2 text-sm">
                <p className="text-zinc-300">
                  Format detected: <span className="text-[#71E0DC]">{preview.format}</span>
                </p>
                <p className="text-zinc-300">
                  Rows found: <span className="text-[#71E0DC]">{preview.row_count}</span>
                </p>
              </div>

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
                        {["question", "category", "correctAnswer", "incorrectAnswers"].map((col) => (
                          <th key={col} className="text-left py-1 px-2 text-zinc-400 font-medium">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview.map((row, idx) => (
                        <tr key={idx} className="border-b border-white/5">
                          <td className="py-1 px-2 text-zinc-300 max-w-[200px] truncate">{row.question || "-"}</td>
                          <td className="py-1 px-2 text-zinc-300">{row.category || "-"}</td>
                          <td className="py-1 px-2 text-zinc-300">{row.correctAnswer || "-"}</td>
                          <td className="py-1 px-2 text-zinc-300 max-w-[160px] truncate">
                            {row.incorrectAnswers || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
                  Import Crowdpurr CSV
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
                        <li className="text-zinc-300">
                          Format detected: <span className="text-[#71E0DC]">{result.format}</span>
                        </li>
                        <li className="text-zinc-300">
                          <span className="text-emerald-400">{result.imported}</span> imported
                        </li>
                        <li className="text-zinc-300">
                          <span className="text-zinc-500">{result.skipped}</span> skipped
                        </li>
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
    </div>
  );
};

export default ImportCSV;
