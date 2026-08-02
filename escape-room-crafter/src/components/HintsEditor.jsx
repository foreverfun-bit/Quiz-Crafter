import { Plus, X, GripVertical } from 'lucide-react';
import Button from './ui/Button.jsx';

export default function HintsEditor({ hints, onChange }) {
  const update = (idx, value) => {
    const next = [...hints];
    next[idx] = value;
    onChange(next);
  };

  const remove = (idx) => onChange(hints.filter((_, i) => i !== idx));

  const add = () => onChange([...hints, '']);

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-stone-400">
        Hints (in escalating order)
      </label>
      <div className="space-y-2">
        {hints.map((hint, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <GripVertical size={14} className="shrink-0 text-stone-600" />
            <span className="w-5 shrink-0 text-xs text-stone-500">{idx + 1}.</span>
            <input
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-1.5 text-sm text-stone-100 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              value={hint}
              onChange={(e) => update(idx, e.target.value)}
              placeholder={`Hint ${idx + 1}`}
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              className="shrink-0 rounded-md p-1 text-stone-500 hover:bg-stone-800 hover:text-rose-400"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={add}>
        <Plus size={14} />
        Add hint
      </Button>
    </div>
  );
}
