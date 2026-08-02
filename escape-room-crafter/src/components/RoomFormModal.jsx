import { useEffect, useState } from 'react';
import Modal from './ui/Modal.jsx';
import Button from './ui/Button.jsx';
import { TextField, TextArea, Select } from './ui/Field.jsx';
import { ROOM_STATUSES, DIFFICULTIES } from '../store/constants.js';

const BLANK = {
  name: '',
  theme: '',
  description: '',
  difficulty: 'Medium',
  targetMinutes: 60,
  status: 'Concept',
};

export default function RoomFormModal({ open, onClose, onSubmit, initial }) {
  const [form, setForm] = useState(BLANK);

  useEffect(() => {
    if (open) setForm(initial ? { ...BLANK, ...initial } : BLANK);
  }, [open, initial]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit({ ...form, targetMinutes: Number(form.targetMinutes) || 60 });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit room' : 'New escape room'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>{initial ? 'Save changes' : 'Create room'}</Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={handleSubmit}>
        <TextField
          label="Room name"
          required
          value={form.name}
          onChange={set('name')}
          placeholder="e.g. The Cartographer's Vault"
          autoFocus
        />
        <TextField
          label="Theme"
          value={form.theme}
          onChange={set('theme')}
          placeholder="e.g. Steampunk heist"
        />
        <TextArea
          label="Description"
          value={form.description}
          onChange={set('description')}
          placeholder="Premise, story, tone..."
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Difficulty"
            options={DIFFICULTIES}
            value={form.difficulty}
            onChange={set('difficulty')}
          />
          <TextField
            label="Target duration (min)"
            type="number"
            min="1"
            value={form.targetMinutes}
            onChange={set('targetMinutes')}
          />
        </div>
        <Select label="Status" options={ROOM_STATUSES} value={form.status} onChange={set('status')} />
      </form>
    </Modal>
  );
}
