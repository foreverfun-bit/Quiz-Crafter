import { useState } from 'react';
import { Plus, DoorOpen } from 'lucide-react';
import { useRooms } from '../store/RoomsContext.jsx';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import RoomCard from '../components/RoomCard.jsx';
import RoomFormModal from '../components/RoomFormModal.jsx';

export default function RoomList() {
  const { data, addRoom, updateRoom, deleteRoom } = useRooms();
  const [formOpen, setFormOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);

  const openCreate = () => {
    setEditingRoom(null);
    setFormOpen(true);
  };

  const openEdit = (room) => {
    setEditingRoom(room);
    setFormOpen(true);
  };

  const handleSubmit = (values) => {
    if (editingRoom) updateRoom(editingRoom.id, values);
    else addRoom(values);
  };

  const handleDelete = (room) => {
    if (window.confirm(`Delete "${room.name}" and all of its puzzles, props, layout, and tasks?`)) {
      deleteRoom(room.id);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-100">Your escape rooms</h1>
          <p className="mt-1 text-sm text-stone-500">
            {data.rooms.length} room{data.rooms.length === 1 ? '' : 's'} in your portfolio
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} />
          New room
        </Button>
      </div>

      {data.rooms.length === 0 ? (
        <EmptyState
          icon={DoorOpen}
          title="No rooms yet"
          description="Create your first escape room to start tracking puzzles, props, layout, and build tasks."
          action={
            <Button onClick={openCreate} size="sm">
              <Plus size={14} />
              New room
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.rooms.map((room) => (
            <RoomCard key={room.id} room={room} onEdit={openEdit} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <RoomFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
        initial={editingRoom}
      />
    </div>
  );
}
