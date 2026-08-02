import { useEffect, useState } from 'react';
import Modal from './ui/Modal.jsx';
import Button from './ui/Button.jsx';
import { TextField, TextArea } from './ui/Field.jsx';
import MultiSelect from './ui/MultiSelect.jsx';

const BLANK = { name: '', description: '', puzzleIds: [], notes: '' };

export default function ZoneFormModal({ open, onClose, onSubmit, initial, puzzles }) {
  const [form, setForm] = useState(BLANK);

  useEffect(() => {
    if (open) setForm(initial ? { ...BLANK, ...initial } : BLANK);
  }, [open, initial]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit(form);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit zone' : 'New zone'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>{initial ? 'Save changes' : 'Add zone'}</Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={handleSubmit}>
        <TextField
          label="Zone name"
          required
          value={form.name}
          onChange={set('name')}
          placeholder="e.g. Entry hallway, Library, Final vault"
          autoFocus
        />
        <TextArea label="Description" value={form.description} onChange={set('description')} />
        <MultiSelect
          label="Puzzles in this zone"
          options={puzzles.map((p) => ({ value: p.id, label: p.name }))}
          selected={form.puzzleIds}
          onChange={(puzzleIds) => setForm((f) => ({ ...f, puzzleIds }))}
          emptyText="No puzzles yet."
        />
        <TextArea label="Notes" value={form.notes} onChange={set('notes')} />
      </form>
    </Modal>
  );
}
