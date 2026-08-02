import { useOutletContext } from 'react-router-dom';
import { useState } from 'react';
import { Plus, Puzzle as PuzzleIcon, Pencil, Trash2, Lightbulb, ArrowRight } from 'lucide-react';
import { useRooms, usePuzzles, useZones } from '../store/RoomsContext.jsx';
import Button from '../components/ui/Button.jsx';
import { Card, CardBody } from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import PuzzleFormModal from '../components/PuzzleFormModal.jsx';

export default function Puzzles() {
  const { room } = useOutletContext();
  const { addPuzzle, updatePuzzle, deletePuzzle } = useRooms();
  const puzzles = usePuzzles(room.id);
  const zones = useZones(room.id);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const puzzleName = (id) => puzzles.find((p) => p.id === id)?.name || 'Unknown';
  const zoneName = (id) => zones.find((z) => z.id === id)?.name;
  const unlocksOf = (id) => puzzles.filter((p) => p.dependsOn.includes(id));

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (p) => {
    setEditing(p);
    setFormOpen(true);
  };
  const handleSubmit = (values) => {
    if (editing) updatePuzzle(editing.id, values);
    else addPuzzle(room.id, values);
  };
  const handleDelete = (p) => {
    if (window.confirm(`Delete puzzle "${p.name}"? This removes it from any chains, zones, and props.`)) {
      deletePuzzle(p.id);
    }
  };

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-stone-100">Puzzles & clues</h1>
          <p className="mt-1 text-sm text-stone-500">{puzzles.length} puzzle{puzzles.length === 1 ? '' : 's'}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} />
          New puzzle
        </Button>
      </div>

      {puzzles.length === 0 ? (
        <EmptyState
          icon={PuzzleIcon}
          title="No puzzles yet"
          description="Add your first puzzle: its solution, hints, and what it depends on to build the chain."
          action={
            <Button size="sm" onClick={openCreate}>
              <Plus size={14} />
              New puzzle
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {puzzles.map((p) => {
            const unlocks = unlocksOf(p.id);
            return (
              <Card key={p.id}>
                <CardBody>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-stone-100">{p.name}</h3>
                        <Badge>{p.status}</Badge>
                        <span className="text-xs text-stone-500">{p.type}</span>
                        {zoneName(p.zoneId) && (
                          <span className="rounded-full bg-stone-800 px-2 py-0.5 text-[11px] text-stone-400">
                            {zoneName(p.zoneId)}
                          </span>
                        )}
                      </div>
                      {p.description && (
                        <p className="mt-1.5 text-sm text-stone-400">{p.description}</p>
                      )}

                      {p.dependsOn.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                          <span>Requires:</span>
                          {p.dependsOn.map((id) => (
                            <span key={id} className="rounded-full bg-stone-800 px-2 py-0.5 text-stone-300">
                              {puzzleName(id)}
                            </span>
                          ))}
                        </div>
                      )}
                      {unlocks.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                          <ArrowRight size={12} />
                          <span>Unlocks:</span>
                          {unlocks.map((u) => (
                            <span key={u.id} className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-300">
                              {u.name}
                            </span>
                          ))}
                        </div>
                      )}
                      {p.hints.length > 0 && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-stone-500">
                          <Lightbulb size={12} />
                          {p.hints.length} hint{p.hints.length === 1 ? '' : 's'}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                        <Pencil size={14} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(p)}>
                        <Trash2 size={14} className="text-rose-400" />
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <PuzzleFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
        initial={editing}
        zones={zones}
        otherPuzzles={puzzles.filter((p) => p.id !== editing?.id)}
      />
    </div>
  );
}
