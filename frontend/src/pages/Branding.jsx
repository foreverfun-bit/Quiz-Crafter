import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Image, Palette, Save, Upload } from "lucide-react";
import { toast } from "sonner";
import { loadHostSetupSettings, saveHostSetupSettings, updateUserMetadata } from "../lib/profileState";

const HOST_DEFAULT_BRANDING_KEY = "quiz-crafter-host-branding-defaults";
const metadataBrandingKey = "quiz_crafter_host_branding_defaults_v1";
const DEFAULT_BRANDING = { name: "Forever Fun Events", logoUrl: "/quiz-crafter-logo.svg", primaryColor: "#71E0DC", accentColor: "#AEB2EF", correctColor: "", optionColor: "#7C8496", lobbyTagline: "Let's get quizzical." };
const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } };
const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep the page usable if browser storage is full. */ } };
const sanitizeHexColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
const normalizeBranding = (branding = {}) => {
  const source = branding && typeof branding === "object" ? branding : {};
  const logoUrl = String(source.logoUrl || "").trim();
  // correctColor/optionColor/lobbyTagline are edited from the per-session Customize
  // panel on the live host screen, not here -- this just has to round-trip them so
  // saving default branding from this page doesn't wipe out what a host set there.
  return {
    name: String(source.name || "").trim() || DEFAULT_BRANDING.name,
    logoUrl: logoUrl === "/forever-fun-logo.png" ? DEFAULT_BRANDING.logoUrl : logoUrl,
    primaryColor: sanitizeHexColor(source.primaryColor, DEFAULT_BRANDING.primaryColor),
    accentColor: sanitizeHexColor(source.accentColor, DEFAULT_BRANDING.accentColor),
    correctColor: /^#[0-9a-f]{6}$/i.test(String(source.correctColor || "")) ? source.correctColor : "",
    optionColor: sanitizeHexColor(source.optionColor, DEFAULT_BRANDING.optionColor),
    lobbyTagline: String(source.lobbyTagline || "").trim() || DEFAULT_BRANDING.lobbyTagline,
  };
};
const readSavedDefaultBranding = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(HOST_DEFAULT_BRANDING_KEY) || "null");
    return parsed && typeof parsed === "object" ? normalizeBranding(parsed) : null;
  } catch {
    return null;
  }
};
const readDefaultBranding = () => normalizeBranding({ ...DEFAULT_BRANDING, ...readJson(HOST_DEFAULT_BRANDING_KEY, {}) });
const writeDefaultBranding = (branding) => writeJson(HOST_DEFAULT_BRANDING_KEY, normalizeBranding(branding));
const brandingChanged = (left, right) => JSON.stringify(normalizeBranding(left || {})) !== JSON.stringify(normalizeBranding(right || {}));
const fileToDataUrl = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });

const Branding = () => {
  const [branding, setBranding] = useState(readDefaultBranding);

  useEffect(() => {
    const loadHostBranding = async () => {
      const savedLocalBranding = readSavedDefaultBranding();
      const localBranding = savedLocalBranding || readDefaultBranding();
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        const setupSettings = await loadHostSetupSettings().catch(() => ({}));
        const setupBranding = setupSettings.branding && typeof setupSettings.branding === "object" ? normalizeBranding(setupSettings.branding) : null;
        const remoteBranding = data?.session?.user?.user_metadata?.[metadataBrandingKey];
        if (setupBranding || (remoteBranding && typeof remoteBranding === "object")) {
          const cleanBranding = normalizeBranding(setupBranding || remoteBranding);
          setBranding(cleanBranding);
          writeDefaultBranding(cleanBranding);
          if (!setupBranding) await saveHostSetupSettings({ branding: cleanBranding });
        } else if (savedLocalBranding && brandingChanged(savedLocalBranding, DEFAULT_BRANDING)) {
          await updateUserMetadata({ [metadataBrandingKey]: localBranding });
          await saveHostSetupSettings({ branding: localBranding });
        }
      } catch (error) {
        console.warn("Host branding profile sync unavailable:", error);
      }
    };
    loadHostBranding();
  }, []);

  const saveDefaultBranding = async (nextBranding) => {
    const cleanBranding = normalizeBranding(nextBranding);
    setBranding(cleanBranding);
    writeDefaultBranding(cleanBranding);
    try {
      await updateUserMetadata({ [metadataBrandingKey]: cleanBranding });
      await saveHostSetupSettings({ branding: cleanBranding });
      toast.success("Default host branding saved to your profile");
    } catch (error) {
      console.warn("Host branding profile save unavailable:", error);
      toast.success("Default host branding saved on this device");
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in" data-testid="branding-page">
      <div className="mb-6">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">Branding</h1>
        <p className="text-zinc-500">Set the default logo and colors used by host, presentation, and player screens.</p>
      </div>
      <BrandingPanel branding={branding} setBranding={setBranding} onSave={saveDefaultBranding} />
    </div>
  );
};

const Panel = ({ title, icon: Icon, children }) => <Card className="glass-card"><CardHeader><CardTitle className="text-white flex items-center gap-2"><Icon className="text-[#71E0DC]" />{title}</CardTitle></CardHeader><CardContent className="space-y-4">{children}</CardContent></Card>;

const BrandingPanel = ({ branding, setBranding, onSave }) => {
  const safeBranding = normalizeBranding(branding);
  const update = (key, value) => setBranding((current) => ({ ...normalizeBranding(current), [key]: value }));
  const uploadLogo = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Choose an image file for the logo");
    update("logoUrl", await fileToDataUrl(file));
  };
  return <Panel title="Host Branding" icon={Palette}><div className="grid grid-cols-1 lg:grid-cols-[160px_1fr] gap-4"><div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3 flex flex-col items-center justify-center min-h-36">{safeBranding.logoUrl ? <img src={safeBranding.logoUrl} alt="Host logo preview" className="max-h-24 max-w-full rounded-md bg-white object-contain p-2" /> : <div className="h-24 w-24 rounded-md border border-white/10 bg-zinc-900 flex items-center justify-center text-zinc-500"><Image size={28} /></div>}<p className="mt-3 text-sm font-bold text-white text-center">{safeBranding.name || "Host Name"}</p></div><div className="space-y-3"><div className="grid grid-cols-1 md:grid-cols-2 gap-3"><label className="text-xs text-zinc-400">Default host name<input value={safeBranding.name || ""} onChange={(event) => update("name", event.target.value)} className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label><label className="text-xs text-zinc-400">Default logo URL<input value={safeBranding.logoUrl || ""} onChange={(event) => update("logoUrl", event.target.value)} placeholder="https://..." className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label></div><div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end"><label className="text-xs text-zinc-400">Upload logo<span className="mt-1 h-10 rounded-md border border-white/10 bg-zinc-950 px-3 text-zinc-200 flex items-center gap-2 cursor-pointer hover:border-[#71E0DC]/50"><Upload size={15} />Choose file<input type="file" accept="image/*" onChange={uploadLogo} className="hidden" /></span></label><ColorField label="Primary color" value={safeBranding.primaryColor} onChange={(value) => update("primaryColor", value)} /><ColorField label="Accent color" value={safeBranding.accentColor} onChange={(value) => update("accentColor", value)} /></div><div className="flex justify-end gap-2 flex-wrap"><Button variant="outline" onClick={() => setBranding(DEFAULT_BRANDING)} className="border-white/10 text-zinc-300 hover:text-white">Reset</Button><Button onClick={() => onSave(safeBranding)} className="text-zinc-950 font-semibold hover:opacity-90" style={{ background: `linear-gradient(90deg, ${safeBranding.primaryColor}, ${safeBranding.accentColor})` }}><Save size={16} className="mr-2" />Save Default Branding</Button></div><p className="text-xs text-zinc-500">This becomes the default for future live host screens. You can still override branding inside a specific session.</p></div></div></Panel>;
};

const ColorField = ({ label, value, onChange }) => { const safeValue = sanitizeHexColor(value, DEFAULT_BRANDING.primaryColor); return <label className="text-xs text-zinc-400">{label}<div className="mt-1 flex h-10 rounded-md border border-white/10 bg-zinc-950 overflow-hidden focus-within:border-[#71E0DC]/60"><input type="color" value={safeValue} onChange={(event) => onChange(event.target.value)} className="h-10 w-12 border-0 bg-transparent p-1" /><input value={value || ""} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent px-2 text-white outline-none" /></div></label>; };

export default Branding;
