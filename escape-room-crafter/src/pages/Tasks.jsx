import { useOutletContext } from 'react-router-dom';
import { useState } from 'react';
import { Plus, ListChecks, Pencil, Trash2, ArrowLeft, ArrowRight, CalendarDays } from 'lucide-react';
import { useRooms, useTasks, usePuzzles, useProps } from '../store/RoomsContext.jsx';
import { TASK_STATUSES } from '../store/constants.js';
import Button from '../components/ui/Button.jsx';
import { Card, CardBody } from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import TaskFormModal from '../components/TaskFormModal.jsx';

export default function Tasks() {
  const { room } = useOutletContext();
  const { addTask, updateTask, deleteTask } = useRooms();
  const tasks = useTasks(room.id);
  const puzzles = usePuzzles(room.id);
  const props = useProps(room.id);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const puzzleName = (id) => puzzles.find((p) => p.id === id)?.name;
  const propName = (id) => props.find((p) => p.id === id)?.name;

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (t) => {
    setEditing(t);
    setFormOpen(true);
  };
  const handleSubmit = (values) => {
    if (editing) updateTask(editing.id, values);
    else addTask(room.id, values);
  };
  const handleDelete = (t) => {
    if (window.confirm(`Delete task "${t.title}"?`)) deleteTask(t.id);
  };
  const shiftStatus = (t, dir) => {
    const idx = TASK_STATUSES.indexOf(t.status);
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= TASK_STATUSES.length) return;
    updateTask(t.id, { status: TASK_STATUSES[nextIdx] });
  };

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-stone-100">Build tasks & timeline</h1>
          <p className="mt-1 text-sm text-stone-500">
            {tasks.filter((t) => t.status === 'Done').length}/{tasks.length} done
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} />
          New task
        </Button>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No tasks yet"
          description="Break the build into tasks with due dates so nothing slips before opening day."
          action={
            <Button size="sm" onClick={openCreate}>
              <Plus size={14} />
              New task
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {TASK_STATUSES.map((status) => {
            const columnTasks = tasks.filter((t) => t.status === status);
            const statusIdx = TASK_STATUSES.indexOf(status);
            return (
              <div key={status}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <h2 className="text-sm font-semibold text-stone-300">{status}</h2>
                  <span className="text-xs text-stone-600">{columnTasks.length}</span>
                </div>
                <div className="space-y-2">
                  {columnTasks.map((t) => (
                    <Card key={t.id}>
                      <CardBody>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-stone-100">{t.title}</p>
                          <Badge>{t.priority}</Badge>
                        </div>
                        {t.description && (
                          <p className="mt-1 text-xs text-stone-500">{t.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
                          <span className="rounded-full bg-stone-800 px-2 py-0.5">{t.category}</span>
                          {t.dueDate && (
                            <span className="inline-flex items-center gap-1">
                              <CalendarDays size={11} /> {t.dueDate}
                            </span>
                          )}
                        </div>
                        {(puzzleName(t.linkedPuzzleId) || propName(t.linkedPropId)) && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-amber-300/80">
                            {puzzleName(t.linkedPuzzleId) && <span>🧩 {puzzleName(t.linkedPuzzleId)}</span>}
                            {propName(t.linkedPropId) && <span>📦 {propName(t.linkedPropId)}</span>}
                          </div>
                        )}
                        <div className="mt-3 flex items-center justify-between">
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={statusIdx === 0}
                              onClick={() => shiftStatus(t, -1)}
                              title="Move back"
                            >
                              <ArrowLeft size={13} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={statusIdx === TASK_STATUSES.length - 1}
                              onClick={() => shiftStatus(t, 1)}
                              title="Move forward"
                            >
                              <ArrowRight size={13} />
                            </Button>
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(t)}>
                              <Pencil size={13} />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(t)}>
                              <Trash2 size={13} className="text-rose-400" />
                            </Button>
                          </div>
                        </div>
                      </CardBody>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TaskFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
        initial={editing}
        puzzles={puzzles}
        props={props}
      />
    </div>
  );
}
