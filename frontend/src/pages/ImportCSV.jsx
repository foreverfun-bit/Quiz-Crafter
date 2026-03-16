import { useState, useRef } from "react";
import { api } from "../App";
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
  Eye
} from "lucide-react";
import { toast } from "sonner";

const ImportCSV = () => {
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      if (!selectedFile.name.endsWith('.csv')) {
        toast.error("Please select a CSV file");
        return;
      }
      setFile(selectedFile);
      setResult(null);
      setPreview(null);
      
      // Auto-preview the file
      setPreviewing(true);
      try {
        const formData = new FormData();
        formData.append("file", selectedFile);
        const response = await api.post("/import/preview", formData, {
          headers: { "Content-Type": "multipart/form-data" }
        });
        setPreview(response.data);
      } catch (error) {
        console.error("Preview failed:", error);
      } finally {
        setPreviewing(false);
      }
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

      const response = await api.post("/import/csv", formData, {
        headers: {
          "Content-Type": "multipart/form-data"
        }
      });

      setResult(response.data);
      if (response.data.imported > 0) {
        toast.success(`Successfully imported ${response.data.imported} questions!`);
      } else {
        toast.info("No new questions were imported");
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || "Import failed");
      setResult({ error: true, message: error.response?.data?.detail || "Import failed" });
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const headers = "Category,Question,Answer,Multiple choice options,Fun Fact,Venue,Date Used";
    const example1 = "90s Music,Which band released 'Smells Like Teen Spirit' in 1991?,Nirvana,\"A. Pearl Jam, B. Nirvana, C. Soundgarden, D. Alice in Chains\",The song became an anthem for Generation X,The Pub,2024-01-15";
    const example2 = "World Geography,What is the capital of Australia?,Canberra,,,The Pub,2024-01-08";
    const example3 = "Science,Water boils at 100 degrees Celsius at sea level,True,,,Bar Trivia,";
    
    const csv = `${headers}\n${example1}\n${example2}\n${example3}`;
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trivia_template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto animate-fade-in" data-testid="import-page">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
          <span className="gradient-text">Import</span> Questions
        </h1>
        <p className="text-zinc-500">Upload your existing trivia questions from a CSV file</p>
      </div>

      {/* CSV Format Info */}
      <Card className="glass-card mb-6">
        <CardHeader>
          <CardTitle className="text-white text-lg">CSV Format</CardTitle>
          <CardDescription className="text-zinc-500">
            Your CSV file should have the following columns
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                  <td className="py-2 px-3">Question category (defaults to "Imported")</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-2 px-3 font-mono text-[#71E0DC]">Question</td>
                  <td className="py-2 px-3 text-emerald-400">Required</td>
                  <td className="py-2 px-3">The trivia question</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-2 px-3 font-mono text-[#71E0DC]">Answer</td>
                  <td className="py-2 px-3 text-emerald-400">Required</td>
                  <td className="py-2 px-3">Correct answer</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-2 px-3 font-mono text-[#71E0DC]">Multiple choice options</td>
                  <td className="py-2 px-3">Optional</td>
                  <td className="py-2 px-3">Comma-separated options (A, B, C, D)</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-2 px-3 font-mono text-[#71E0DC]">Fun Fact</td>
                  <td className="py-2 px-3">Optional</td>
                  <td className="py-2 px-3">Interesting fact about the answer</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-2 px-3 font-mono text-[#71E0DC]">Venue</td>
                  <td className="py-2 px-3">Recommended</td>
                  <td className="py-2 px-3">Where the question was used (used for session grouping)</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-mono text-[#71E0DC]">Date Used</td>
                  <td className="py-2 px-3">Recommended</td>
                  <td className="py-2 px-3">When the question was used (groups questions into past sessions)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-4 p-3 rounded-lg bg-[#71E0DC]/10 border border-[#71E0DC]/20">
            <p className="text-[#71E0DC] text-sm">
              <strong>Auto-grouping:</strong> Questions with the same Date Used will be automatically grouped into a past session named "{'"'}Venue - Date{'"'}"
            </p>
          </div>
          <div className="mt-4">
            <Button
              variant="outline"
              onClick={downloadTemplate}
              className="border-white/20 text-white hover:bg-zinc-800"
              data-testid="download-template-btn"
            >
              <Download className="mr-2" size={16} />
              Download Template
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Upload Area */}
      <Card className="glass-card">
        <CardContent className="p-8">
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
              file 
                ? 'border-[#71E0DC]/50 bg-[#71E0DC]/5' 
                : 'border-zinc-700 hover:border-zinc-500'
            }`}
            data-testid="upload-area"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
              data-testid="file-input"
            />
            
            <div className="flex flex-col items-center">
              {file ? (
                <>
                  <div className="w-16 h-16 rounded-full bg-[#71E0DC]/20 flex items-center justify-center mb-4">
                    <FileText className="text-[#71E0DC]" size={32} />
                  </div>
                  <p className="text-white font-semibold mb-1">{file.name}</p>
                  <p className="text-zinc-500 text-sm">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                  <p className="text-zinc-600 text-sm mt-2">Click to change file</p>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mb-4">
                    <Upload className="text-zinc-500" size={32} />
                  </div>
                  <p className="text-white font-semibold mb-1">Drop your CSV file here</p>
                  <p className="text-zinc-500 text-sm">or click to browse</p>
                </>
              )}
            </div>
          </div>

          {/* CSV Preview */}
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
                <span className="text-white font-medium">CSV Preview</span>
              </div>
              
              <div className="mb-3">
                <p className="text-zinc-500 text-sm mb-2">Detected Columns:</p>
                <div className="flex flex-wrap gap-2">
                  {preview.columns?.map((col, idx) => (
                    <Badge 
                      key={idx} 
                      className={`${
                        col.toLowerCase().trim().includes('date') 
                          ? 'bg-[#71E0DC]/20 text-[#71E0DC] border-[#71E0DC]/30'
                          : col.toLowerCase().trim().includes('venue') || col.toLowerCase().trim().includes('location')
                          ? 'bg-[#AEB2EF]/20 text-[#AEB2EF] border-[#AEB2EF]/30'
                          : 'bg-zinc-800 text-zinc-300'
                      }`}
                    >
                      {col}{col !== col.trim() ? ' ⚠️' : ''}
                    </Badge>
                  ))}
                </div>
                {!preview.columns?.some(c => c.toLowerCase().trim().includes('date')) && (
                  <p className="text-amber-400 text-xs mt-2">
                    ⚠️ No "Date Used" column detected. Questions won't be grouped into past sessions.
                  </p>
                )}
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
                              {row[col] || '-'}
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
            </div>
          )}

          {/* Import Button */}
          <div className="mt-6 flex justify-center">
            <Button
              onClick={handleImport}
              disabled={!file || importing}
              className="gradient-btn px-8"
              data-testid="import-btn"
            >
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="mr-2" size={18} />
                  Import Questions
                </>
              )}
            </Button>
          </div>

          {/* Result */}
          {result && (
            <div className={`mt-6 p-4 rounded-lg ${
              result.error 
                ? 'bg-red-500/10 border border-red-500/20' 
                : 'bg-emerald-500/10 border border-emerald-500/20'
            }`}>
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
                            <span className="text-[#AEB2EF]">{result.updated}</span> existing questions updated with new info
                          </li>
                        )}
                        {result.sessions_created > 0 && (
                          <li className="text-zinc-300">
                            <span className="text-[#71E0DC]">{result.sessions_created}</span> past session{result.sessions_created !== 1 ? 's' : ''} created
                          </li>
                        )}
                        {result.skipped > 0 && (
                          <li className="text-zinc-300">
                            <span className="text-zinc-500">{result.skipped}</span> unchanged duplicates skipped
                          </li>
                        )}
                        {result.errors?.length > 0 && (
                          <li className="text-zinc-300">
                            <span className="text-red-400">{result.errors.length}</span> errors
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

      {/* Tips */}
      <Card className="glass-card mt-6">
        <CardHeader>
          <CardTitle className="text-white text-lg">Tips</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-zinc-400 text-sm">
            <li className="flex items-start gap-2">
              <CheckCircle className="text-emerald-400 flex-shrink-0 mt-0.5" size={16} />
              <span>Duplicate questions (by question text) will be automatically skipped</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="text-emerald-400 flex-shrink-0 mt-0.5" size={16} />
              <span>Questions with "True" or "False" as the answer will be marked as True/False type</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="text-emerald-400 flex-shrink-0 mt-0.5" size={16} />
              <span>Questions with multiple choice options will be marked as Multiple Choice type</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="text-emerald-400 flex-shrink-0 mt-0.5" size={16} />
              <span>All other questions default to Written Answer type</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};

export default ImportCSV;
