import { NavLink, Outlet, useParams, Link } from 'react-router-dom';
import { ArrowLeft, LayoutDashboard, Puzzle, Package, Map, ListChecks } from 'lucide-react';
import { useRoom } from '../store/RoomsContext.jsx';
import Badge from './ui/Badge.jsx';
import EmptyState from './ui/EmptyState.jsx';

const NAV_ITEMS = [
  { to: '', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: 'puzzles', label: 'Puzzles & Clues', icon: Puzzle },
  { to: 'props', label: 'Props & Inventory', icon: Package },
  { to: 'layout', label: 'Room Layout', icon: Map },
  { to: 'tasks', label: 'Build Tasks', icon: ListChecks },
];

export default function RoomLayout() {
  const { roomId } = useParams();
  const room = useRoom(roomId);

  if (!room) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Room not found"
          description="This room may have been deleted."
          action={
            <Link to="/rooms" className="text-sm text-amber-400 hover:underline">
              Back to all rooms
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
      <aside className="lg:w-56 lg:shrink-0">
        <Link
          to="/rooms"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-stone-300"
        >
          <ArrowLeft size={14} />
          All rooms
        </Link>
        <div className="mb-4">
          <p className="truncate text-base font-semibold text-stone-100">{room.name}</p>
          <div className="mt-1.5">
            <Badge>{room.status}</Badge>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={label}
              to={to || '.'}
              end={end}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:shrink ${
                  isActive
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'text-stone-400 hover:bg-stone-800 hover:text-stone-100'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet context={{ room }} />
      </div>
    </div>
  );
}
