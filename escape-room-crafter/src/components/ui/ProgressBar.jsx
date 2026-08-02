export default function ProgressBar({ value = 0, total = 0, className = '' }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className={className}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-800">
        <div
          className="h-full rounded-full bg-amber-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
