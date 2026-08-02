import { useOutletContext } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { Plus, Package, Pencil, Trash2 } from 'lucide-react';
import { useRooms, useProps, usePuzzles } from '../store/RoomsContext.jsx';
import Button from '../components/ui/Button.jsx';
import { Card } from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import PropFormModal from '../components/PropFormModal.jsx';

export default function Props() {
  const { room } = useOutletContext();
  const { addProp, updateProp, deleteProp } = useRooms();
  const props = useProps(room.id);
  const puzzles = usePuzzles(room.id);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const puzzleName = (id) => puzzles.find((p) => p.id === id)?.name || 'Unknown';

  const totals = useMemo(() => {
    const totalCost = props.reduce((s, p) => s + p.cost * p.quantity, 0);
    const acquired = props.filter((p) => p.sourcingStatus === 'Acquired').length;
    return { totalCost, acquired };
  }, [props]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (p) => {
    setEditing(p);
    setFormOpen(true);
  };
  const handleSubmit = (values) => {
    if (editing) updateProp(editing.id, values);
    else addProp(room.id, values);
  };
  const handleDelete = (p) => {
    if (window.confirm(`Delete prop "${p.name}"?`)) deleteProp(p.id);
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-stone-100">Props & inventory</h1>
          <p className="mt-1 text-sm text-stone-500">
            {props.length} item{props.length === 1 ? '' : 's'} · {totals.acquired}/{props.length} acquired ·{' '}
            ${totals.totalCost.toFixed(2)} total
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} />
          New prop
        </Button>
      </div>

      {props.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No props tracked yet"
          description="Track every physical item you need to source or build, and link it to the puzzle it's used in."
          action={
            <Button size="sm" onClick={openCreate}>
              <Plus size={14} />
              New prop
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-stone-800 text-xs text-stone-500">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Qty</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                  <th className="px-4 py-3 font-medium">Used in</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800">
                {props.map((p) => (
                  <tr key={p.id} className="align-top hover:bg-stone-900/40">
                    <td className="px-4 py-3">
                      <p className="font-medium text-stone-100">{p.name}</p>
                      {p.source && <p className="text-xs text-stone-500">{p.source}</p>}
                    </td>
                    <td className="px-4 py-3 text-stone-400">{p.category}</td>
                    <td className="px-4 py-3 text-stone-400">{p.quantity}</td>
                    <td className="px-4 py-3">
                      <Badge>{p.sourcingStatus}</Badge>
                    </td>
                    <td className="px-4 py-3 text-stone-400">
                      ${(p.cost * p.quantity).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {p.puzzleIds.length === 0 ? (
                          <span className="text-stone-600">—</span>
                        ) : (
                          p.puzzleIds.map((id) => (
                            <span
                              key={id}
                              className="rounded-full bg-stone-800 px-2 py-0.5 text-[11px] text-stone-300"
                            >
                              {puzzleName(id)}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                          <Pencil size={14} />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(p)}>
                          <Trash2 size={14} className="text-rose-400" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <PropFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
        initial={editing}
        puzzles={puzzles}
      />
    </div>
  );
}
