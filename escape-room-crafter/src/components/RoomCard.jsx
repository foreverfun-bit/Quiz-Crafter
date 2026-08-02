import { Link } from 'react-router-dom';
import { Clock, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useRoomProgress } from '../store/RoomsContext.jsx';
import { Card, CardBody } from './ui/Card.jsx';
import Badge from './ui/Badge.jsx';
import ProgressBar from './ui/ProgressBar.jsx';

export default function RoomCard({ room, onEdit, onDelete }) {
  const progress = useRoomProgress(room.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <Card className="relative flex flex-col transition-colors hover:border-stone-700">
      <div className="absolute right-3 top-3" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded-md p-1.5 text-stone-500 hover:bg-stone-800 hover:text-stone-200"
        >
          <MoreVertical size={16} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 z-10 mt-1 w-36 overflow-hidden rounded-lg border border-stone-800 bg-stone-900 shadow-xl">
            <button
              onClick={() => {
                setMenuOpen(false);
                onEdit(room);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-stone-300 hover:bg-stone-800"
            >
              <Pencil size={14} /> Edit
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                onDelete(room);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-400 hover:bg-stone-800"
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        )}
      </div>
      <Link to={`/rooms/${room.id}`} className="flex flex-1 flex-col">
        <CardBody className="flex flex-1 flex-col">
          <Badge>{room.status}</Badge>
          <h3 className="mt-2 truncate pr-6 text-base font-semibold text-stone-100">{room.name}</h3>
          {room.theme && <p className="truncate text-sm text-stone-400">{room.theme}</p>}

          <div className="mt-3 flex items-center gap-3 text-xs text-stone-500">
            <span className="inline-flex items-center gap-1">
              <Clock size={12} /> {room.targetMinutes} min
            </span>
            <span>{room.difficulty}</span>
          </div>

          <div className="mt-4 space-y-2.5">
            <ProgressRow label="Puzzles" value={progress.puzzlesDone} total={progress.puzzlesTotal} />
            <ProgressRow label="Props" value={progress.propsReady} total={progress.propsTotal} />
            <ProgressRow label="Tasks" value={progress.tasksDone} total={progress.tasksTotal} />
          </div>
        </CardBody>
      </Link>
    </Card>
  );
}

function ProgressRow({ label, value, total }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-stone-500">
        <span>{label}</span>
        <span>
          {value}/{total}
        </span>
      </div>
      <ProgressBar value={value} total={total} />
    </div>
  );
}
