export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-stone-800 py-14 text-center">
      {Icon && <Icon size={28} className="text-stone-600" />}
      <div>
        <p className="text-sm font-medium text-stone-200">{title}</p>
        {description && <p className="mt-1 max-w-sm text-sm text-stone-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
