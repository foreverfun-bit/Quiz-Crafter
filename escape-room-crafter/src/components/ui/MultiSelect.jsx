export default function MultiSelect({ label, options, selected, onChange, emptyText = 'Nothing available yet.' }) {
  const toggle = (id) => {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  };

  return (
    <div>
      {label && <label className="mb-1 block text-xs font-medium text-stone-400">{label}</label>}
      {options.length === 0 ? (
        <p className="text-xs text-stone-600">{emptyText}</p>
      ) : (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-stone-700 bg-stone-950 p-2">
          {options.map((opt) => (
            <label
              key={opt.value}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-stone-300 hover:bg-stone-800"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="accent-amber-500"
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
