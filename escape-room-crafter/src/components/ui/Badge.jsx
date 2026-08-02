import { STATUS_COLORS } from '../../store/constants';

export default function Badge({ children, className = '' }) {
  const color = STATUS_COLORS[children] || 'bg-stone-700 text-stone-200';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${color} ${className}`}
    >
      {children}
    </span>
  );
}
