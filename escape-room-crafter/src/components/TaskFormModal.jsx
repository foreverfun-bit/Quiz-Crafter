import { useEffect, useState } from 'react';
import Modal from './ui/Modal.jsx';
import Button from './ui/Button.jsx';
import { TextField, TextArea, Select } from './ui/Field.jsx';
import { TASK_CATEGORIES, TASK_STATUSES, TASK_PRIORITIES } from '../store/constants.js';

const BLANK = {
  title: '',
  description: '',
  status: 'To Do',
  dueDate: '',
  category: 'Build',
  priority: 'Medium',
  linkedPuzzleId: '',
  linkedPropId: '',
};

export default function TaskFormModal({ open, onClose, onSubmit, initial, puzzles, props }) {
  const [form, setForm] = useState(BLANK);

  useEffect(() => {
    if (open) {
      setForm(
        initial
          ? {
              ...BLANK,
              ...initial,
              linkedPuzzleId: initial.linkedPuzzleId || '',
              linkedPropId: initial.linkedPropId || '',
            }
          : BLANK,
      );
    }
  }, [open, initial]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    onSubmit({
      ...form,
      linkedPuzzleId: form.linkedPuzzleId || null,
      linkedPropId: form.linkedPropId || null,
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit task' : 'New task'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>{initial ? 'Save changes' : 'Add task'}</Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={handleSubmit}>
        <TextField label="Title" required value={form.title} onChange={set('title')} autoFocus />
        <TextArea label="Description" value={form.description} onChange={set('description')} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Category" options={TASK_CATEGORIES} value={form.category} onChange={set('category')} />
          <Select label="Priority" options={TASK_PRIORITIES} value={form.priority} onChange={set('priority')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Status" options={TASK_STATUSES} value={form.status} onChange={set('status')} />
          <TextField label="Due date" type="date" value={form.dueDate} onChange={set('dueDate')} />
        </div>
        <Select
          label="Linked puzzle"
          value={form.linkedPuzzleId}
          onChange={set('linkedPuzzleId')}
          options={[{ value: '', label: 'None' }, ...puzzles.map((p) => ({ value: p.id, label: p.name }))]}
        />
        <Select
          label="Linked prop"
          value={form.linkedPropId}
          onChange={set('linkedPropId')}
          options={[{ value: '', label: 'None' }, ...props.map((p) => ({ value: p.id, label: p.name }))]}
        />
      </form>
    </Modal>
  );
}
