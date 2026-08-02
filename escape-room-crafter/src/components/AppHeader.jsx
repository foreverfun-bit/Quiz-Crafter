import { Link } from 'react-router-dom';
import { KeyRound, DatabaseBackup } from 'lucide-react';
import { useState } from 'react';
import Button from './ui/Button.jsx';
import BackupModal from './BackupModal.jsx';

export default function AppHeader() {
  const [backupOpen, setBackupOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-stone-800 bg-stone-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <Link to="/rooms" className="flex items-center gap-2 text-stone-100">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
            <KeyRound size={18} />
          </span>
          <span className="text-sm font-semibold tracking-wide">Escape Room Crafter</span>
        </Link>
        <Button variant="ghost" size="sm" onClick={() => setBackupOpen(true)}>
          <DatabaseBackup size={14} />
          Backup
        </Button>
      </div>
      <BackupModal open={backupOpen} onClose={() => setBackupOpen(false)} />
    </header>
  );
}
