import { useEffect, useState } from 'react';
import Modal from './ui/Modal.jsx';
import Button from './ui/Button.jsx';
import { TextField, TextArea, Select } from './ui/Field.jsx';
import MultiSelect from './ui/MultiSelect.jsx';
import HintsEditor from './HintsEditor.jsx';
import { PUZZLE_TYPES, PUZZLE_STATUSES } from '../store/constants.js';

const BLANK = {
  name: '',
  description: '',
  type: 'Logic',
  status: 'Idea',
  zoneId: '',
  solution: '',
  hints: [],
  dependsOn: [],
  notes: '',
};

export default function PuzzleFormModal({ open, onClose, onSubmit, initial, zones, otherPuzzles }) {
  const [form, setForm] = useState(BLANK);

  useEffect(() => {
    if (open) setForm(initial ? { ...BLANK, ...initial } : BLANK);
  }, [open, initial]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit({
      ...form,
      zoneId: form.zoneId || null,
      hints: form.hints.filter((h) => h.trim() !== ''),
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={initial ? 'Edit puzzle' : 'New puzzle'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>{initial ? 'Save changes' : 'Add puzzle'}</Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={handleSubmit}>
        <TextField label="Puzzle name" required value={form.name} onChange={set('name')} autoFocus />
        <TextArea
          label="Description"
          value={form.description}
          onChange={set('description')}
          placeholder="What does the player see / interact with?"
        />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Type" options={PUZZLE_TYPES} value={form.type} onChange={set('type')} />
          <Select label="Status" options={PUZZLE_STATUSES} value={form.status} onChange={set('status')} />
        </div>
        <Select
          label="Room zone"
          value={form.zoneId || ''}
          onChange={set('zoneId')}
          options={[{ value: '', label: 'Not assigned yet' }, ...zones.map((z) => ({ value: z.id, label: z.name }))]}
        />
        <TextArea label="Solution" value={form.solution} onChange={set('solution')} />
        <HintsEditor hints={form.hints} onChange={(hints) => setForm((f) => ({ ...f, hints }))} />
        <MultiSelect
          label="Depends on (must be solved first)"
          options={otherPuzzles.map((p) => ({ value: p.id, label: p.name }))}
          selected={form.dependsOn}
          onChange={(dependsOn) => setForm((f) => ({ ...f, dependsOn }))}
          emptyText="No other puzzles yet — add more puzzles to chain them together."
        />
        <TextArea label="Notes" value={form.notes} onChange={set('notes')} />
      </form>
    </Modal>
  );
}
