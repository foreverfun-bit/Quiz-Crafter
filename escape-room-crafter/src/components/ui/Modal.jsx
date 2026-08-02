import { useEffect } from 'react';
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-12 sm:pt-20">
      <div
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-xl border border-stone-800 bg-stone-900 shadow-2xl`}
      >
        <div className="flex items-center justify-between border-b border-stone-800 p-4">
          <h2 className="text-sm font-semibold text-stone-100">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-stone-800 p-4">{footer}</div>}
      </div>
    </div>
  );
}
