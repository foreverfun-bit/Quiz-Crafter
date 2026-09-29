import { X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import GeneralTab from "./GeneralTab";

// Tabs beyond General (Displays, Venue, Theme) land in later phases -- only
// render tabs that actually have content so this never shows a broken-looking
// disabled placeholder.
const EventSettingsModal = ({ session, onClose, onUpdateSession }) => (
  <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 backdrop-blur-sm p-4 pt-8 md:pt-14 overflow-y-auto">
    <div className="w-full max-w-2xl rounded-xl bg-[#17181c] border border-white/10 shadow-2xl shadow-black/60 p-5 relative">
      <button type="button" onClick={onClose} className="absolute right-4 top-4 text-zinc-400 hover:text-white" aria-label="Close event settings">
        <X size={18} />
      </button>
      <h2 className="mb-5 text-xl font-bold text-white">Event Settings</h2>
      <Tabs defaultValue="general">
        <TabsList className="mb-5 rounded-full bg-zinc-900/70 border border-white/10 p-1">
          <TabsTrigger value="general" className="rounded-full data-[state=active]:bg-[#71E0DC] data-[state=active]:text-zinc-950 data-[state=active]:shadow-none">General</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="mt-0">
          <GeneralTab session={session} onUpdateSession={onUpdateSession} />
        </TabsContent>
      </Tabs>
    </div>
  </div>
);

export default EventSettingsModal;
