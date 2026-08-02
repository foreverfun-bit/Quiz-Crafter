import { useOutletContext, Link } from 'react-router-dom';
import { useState } from 'react';
import { Puzzle, Package, ListChecks, DollarSign, Pencil } from 'lucide-react';
import { useRoomProgress, useTasks, useRooms } from '../store/RoomsContext.jsx';
import { Card, CardBody } from '../components/ui/Card.jsx';
import ProgressBar from '../components/ui/ProgressBar.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import RoomFormModal from '../components/RoomFormModal.jsx';

export default function RoomOverview() {
  const { room } = useOutletContext();
  const { updateRoom } = useRooms();
  const progress = useRoomProgress(room.id);
  const tasks = useTasks(room.id);
  const [editOpen, setEditOpen] = useState(false);

  const upcoming = tasks
    .filter((t) => t.status !== 'Done')
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <Card>
        <CardBody>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold text-stone-100">{room.name}</h1>
                <Badge>{room.status}</Badge>
              </div>
              {room.theme && <p className="mt-1 text-sm text-stone-400">{room.theme}</p>}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil size={14} />
              Edit
            </Button>
          </div>
          {room.description && (
            <p className="mt-3 whitespace-pre-wrap text-sm text-stone-400">{room.description}</p>
          )}
          <div className="mt-4 flex gap-4 text-xs text-stone-500">
            <span>Difficulty: {room.difficulty}</span>
            <span>Target duration: {room.targetMinutes} min</span>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Puzzle}
          label="Puzzles tested"
          value={progress.puzzlesDone}
          total={progress.puzzlesTotal}
          to="puzzles"
        />
        <StatCard
          icon={Package}
          label="Props acquired"
          value={progress.propsReady}
          total={progress.propsTotal}
          to="props"
        />
        <StatCard
          icon={ListChecks}
          label="Tasks done"
          value={progress.tasksDone}
          total={progress.tasksTotal}
          to="tasks"
        />
        <Card>
          <CardBody>
            <div className="flex items-center gap-2 text-stone-500">
              <DollarSign size={14} />
              <span className="text-xs font-medium">Prop budget</span>
            </div>
            <p className="mt-2 text-2xl font-semibold text-stone-100">
              ${progress.totalCost.toFixed(2)}
            </p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-stone-200">Up next</h2>
            <Link to="tasks" className="text-xs font-medium text-amber-400 hover:underline">
              View all tasks
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-stone-500">No open tasks. Add some in Build Tasks.</p>
          ) : (
            <ul className="divide-y divide-stone-800">
              {upcoming.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-stone-200">{t.title}</span>
                  <div className="flex items-center gap-2">
                    {t.dueDate && <span className="text-xs text-stone-500">{t.dueDate}</span>}
                    <Badge>{t.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <RoomFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSubmit={(values) => updateRoom(room.id, values)}
        initial={room}
      />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, total, to }) {
  return (
    <Link to={to}>
      <Card className="h-full transition-colors hover:border-stone-700">
        <CardBody>
          <div className="flex items-center gap-2 text-stone-500">
            <Icon size={14} />
            <span className="text-xs font-medium">{label}</span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-stone-100">
            {value}
            <span className="text-base font-normal text-stone-500">/{total}</span>
          </p>
          <ProgressBar value={value} total={total} className="mt-2" />
        </CardBody>
      </Card>
    </Link>
  );
}
