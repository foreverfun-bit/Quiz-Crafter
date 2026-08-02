import { useRef, useState } from 'react';
import { Download, Upload, Trash2 } from 'lucide-react';
import Modal from './ui/Modal.jsx';
import Button from './ui/Button.jsx';
import { useRooms } from '../store/RoomsContext.jsx';

export default function BackupModal({ open, onClose }) {
  const { exportAll, importAll, resetAll } = useRooms();
  const fileInputRef = useRef(null);
  const [error, setError] = useState('');

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const text = await file.text();
      if (
        window.confirm(
          'Importing will replace ALL current data in this browser with the contents of the backup file. Continue?',
        )
      ) {
        importAll(text);
        onClose();
      }
    } catch (err) {
      setError(err.message || 'Could not read that file.');
    } finally {
      e.target.value = '';
    }
  };

  const handleReset = () => {
    if (
      window.confirm(
        'This will permanently delete every room, puzzle, prop, layout zone, and task stored in this browser. Export a backup first if you want to keep it. Continue?',
      )
    ) {
      resetAll();
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Backup & data">
      <div className="space-y-4 text-sm">
        <p className="text-stone-400">
          Everything you build here is saved only in this browser (local storage). Export a backup
          regularly, especially before clearing browser data or switching devices.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" className="flex-1" onClick={exportAll}>
            <Download size={14} />
            Export backup (.json)
          </Button>
          <Button variant="secondary" className="flex-1" onClick={handleImportClick}>
            <Upload size={14} />
            Import backup
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {error && <p className="text-xs text-rose-400">{error}</p>}

        <div className="border-t border-stone-800 pt-4">
          <Button variant="danger" size="sm" onClick={handleReset}>
            <Trash2 size={14} />
            Erase all data
          </Button>
        </div>
      </div>
    </Modal>
  );
}
