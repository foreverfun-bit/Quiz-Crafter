import { useOutletContext } from 'react-router-dom';
import { useState } from 'react';
import { Plus, Map, Pencil, Trash2, ChevronUp, ChevronDown, ArrowDown } from 'lucide-react';
import { useRooms, useZones, usePuzzles } from '../store/RoomsContext.jsx';
import Button from '../components/ui/Button.jsx';
import { Card, CardBody } from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import ZoneFormModal from '../components/ZoneFormModal.jsx';

export default function Layout() {
  const { room } = useOutletContext();
  const { addZone, updateZone, deleteZone, moveZone, updatePuzzle } = useRooms();
  const zones = useZones(room.id);
  const puzzles = usePuzzles(room.id);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const puzzlesInZone = (zoneId) => puzzles.filter((p) => p.zoneId === zoneId);
  const unassigned = puzzles.filter((p) => !p.zoneId);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (zone) => {
    setEditing({ ...zone, puzzleIds: puzzlesInZone(zone.id).map((p) => p.id) });
    setFormOpen(true);
  };

  const handleSubmit = (values) => {
    const { puzzleIds, ...zoneFields } = values;
    const zoneId = editing ? editing.id : addZone(room.id, zoneFields);
    if (editing) updateZone(editing.id, zoneFields);

    puzzles.forEach((p) => {
      const shouldBeInZone = puzzleIds.includes(p.id);
      const isInZone = p.zoneId === zoneId;
      if (shouldBeInZone && !isInZone) updatePuzzle(p.id, { zoneId });
      else if (!shouldBeInZone && isInZone) updatePuzzle(p.id, { zoneId: null });
    });
  };

  const handleDelete = (zone) => {
    if (window.confirm(`Delete zone "${zone.name}"? Puzzles assigned to it will become unassigned.`)) {
      deleteZone(zone.id);
    }
  };

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-stone-100">Room layout & flow</h1>
          <p className="mt-1 text-sm text-stone-500">
            Zones in the order players move through them
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} />
          New zone
        </Button>
      </div>

      {zones.length === 0 ? (
        <EmptyState
          icon={Map}
          title="No zones yet"
          description="Break the physical room into zones (e.g. entryway, library, vault) and place puzzles in each to map the player's path."
          action={
            <Button size="sm" onClick={openCreate}>
              <Plus size={14} />
              New zone
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col items-stretch">
          {zones.map((zone, idx) => (
            <div key={zone.id} className="flex flex-col items-center">
              <Card className="w-full">
                <CardBody>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs font-semibold text-amber-400">
                        {idx + 1}
                      </span>
                      <div>
                        <h3 className="font-semibold text-stone-100">{zone.name}</h3>
                        {zone.description && (
                          <p className="mt-1 text-sm text-stone-400">{zone.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {puzzlesInZone(zone.id).length === 0 ? (
                            <span className="text-xs text-stone-600">No puzzles placed here yet</span>
                          ) : (
                            puzzlesInZone(zone.id).map((p) => (
                              <span
                                key={p.id}
                                className="rounded-full bg-stone-800 px-2 py-0.5 text-[11px] text-stone-300"
                              >
                                {p.name}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={idx === 0}
                        onClick={() => moveZone(zone.id, 'up')}
                      >
                        <ChevronUp size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={idx === zones.length - 1}
                        onClick={() => moveZone(zone.id, 'down')}
                      >
                        <ChevronDown size={14} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(zone)}>
                        <Pencil size={14} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(zone)}>
                        <Trash2 size={14} className="text-rose-400" />
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
              {idx < zones.length - 1 && <ArrowDown size={16} className="my-1.5 text-stone-700" />}
            </div>
          ))}
        </div>
      )}

      {unassigned.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-stone-300">Not yet placed in a zone</h2>
          <div className="flex flex-wrap gap-1.5">
            {unassigned.map((p) => (
              <Badge key={p.id} className="!bg-stone-800 !text-stone-300">
                {p.name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <ZoneFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
        initial={editing}
        puzzles={puzzles}
      />
    </div>
  );
}
