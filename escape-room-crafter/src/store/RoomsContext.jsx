import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { loadData, saveData, downloadJSON, parseImportedJSON, emptyData } from './storage';

const RoomsContext = createContext(null);

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const now = () => new Date().toISOString();

export function RoomsProvider({ children }) {
  const [data, setData] = useState(() => loadData());

  useEffect(() => {
    saveData(data);
  }, [data]);

  // ---------- Rooms ----------
  const addRoom = useCallback((partial) => {
    const id = makeId();
    const room = {
      id,
      name: 'Untitled Room',
      theme: '',
      description: '',
      difficulty: 'Medium',
      targetMinutes: 60,
      status: 'Concept',
      createdAt: now(),
      updatedAt: now(),
      ...partial,
    };
    setData((d) => ({ ...d, rooms: [...d.rooms, room] }));
    return id;
  }, []);

  const updateRoom = useCallback((id, patch) => {
    setData((d) => ({
      ...d,
      rooms: d.rooms.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: now() } : r)),
    }));
  }, []);

  const deleteRoom = useCallback((id) => {
    setData((d) => ({
      rooms: d.rooms.filter((r) => r.id !== id),
      puzzles: d.puzzles.filter((p) => p.roomId !== id),
      props: d.props.filter((p) => p.roomId !== id),
      zones: d.zones.filter((z) => z.roomId !== id),
      tasks: d.tasks.filter((t) => t.roomId !== id),
      version: d.version,
    }));
  }, []);

  // ---------- Puzzles ----------
  const addPuzzle = useCallback((roomId, partial) => {
    const id = makeId();
    const puzzle = {
      id,
      roomId,
      name: 'Untitled Puzzle',
      description: '',
      type: 'Logic',
      solution: '',
      hints: [],
      dependsOn: [],
      zoneId: null,
      status: 'Idea',
      notes: '',
      createdAt: now(),
      updatedAt: now(),
      ...partial,
    };
    setData((d) => ({ ...d, puzzles: [...d.puzzles, puzzle] }));
    return id;
  }, []);

  const updatePuzzle = useCallback((id, patch) => {
    setData((d) => ({
      ...d,
      puzzles: d.puzzles.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: now() } : p)),
    }));
  }, []);

  const deletePuzzle = useCallback((id) => {
    setData((d) => ({
      ...d,
      puzzles: d.puzzles
        .filter((p) => p.id !== id)
        .map((p) => ({ ...p, dependsOn: p.dependsOn.filter((depId) => depId !== id) })),
      props: d.props.map((p) => ({ ...p, puzzleIds: (p.puzzleIds || []).filter((pid) => pid !== id) })),
      tasks: d.tasks.map((t) => (t.linkedPuzzleId === id ? { ...t, linkedPuzzleId: null } : t)),
    }));
  }, []);

  // ---------- Props ----------
  const addProp = useCallback((roomId, partial) => {
    const id = makeId();
    const prop = {
      id,
      roomId,
      name: 'Untitled Prop',
      category: 'Prop',
      quantity: 1,
      sourcingStatus: 'Need to source',
      cost: 0,
      source: '',
      puzzleIds: [],
      notes: '',
      createdAt: now(),
      updatedAt: now(),
      ...partial,
    };
    setData((d) => ({ ...d, props: [...d.props, prop] }));
    return id;
  }, []);

  const updateProp = useCallback((id, patch) => {
    setData((d) => ({
      ...d,
      props: d.props.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: now() } : p)),
    }));
  }, []);

  const deleteProp = useCallback((id) => {
    setData((d) => ({
      ...d,
      props: d.props.filter((p) => p.id !== id),
      tasks: d.tasks.map((t) => (t.linkedPropId === id ? { ...t, linkedPropId: null } : t)),
    }));
  }, []);

  // ---------- Zones (layout) ----------
  const addZone = useCallback((roomId, partial) => {
    const id = makeId();
    setData((d) => {
      const roomZones = d.zones.filter((z) => z.roomId === roomId);
      const maxOrder = roomZones.reduce((m, z) => Math.max(m, z.order ?? 0), -1);
      const zone = {
        id,
        roomId,
        name: 'Untitled Zone',
        description: '',
        order: maxOrder + 1,
        notes: '',
        createdAt: now(),
        updatedAt: now(),
        ...partial,
      };
      return { ...d, zones: [...d.zones, zone] };
    });
    return id;
  }, []);

  const updateZone = useCallback((id, patch) => {
    setData((d) => ({
      ...d,
      zones: d.zones.map((z) => (z.id === id ? { ...z, ...patch, updatedAt: now() } : z)),
    }));
  }, []);

  const deleteZone = useCallback((id) => {
    setData((d) => ({
      ...d,
      zones: d.zones.filter((z) => z.id !== id),
      puzzles: d.puzzles.map((p) => (p.zoneId === id ? { ...p, zoneId: null } : p)),
    }));
  }, []);

  const moveZone = useCallback((id, direction) => {
    setData((d) => {
      const zone = d.zones.find((z) => z.id === id);
      if (!zone) return d;
      const siblings = d.zones
        .filter((z) => z.roomId === zone.roomId)
        .sort((a, b) => a.order - b.order);
      const idx = siblings.findIndex((z) => z.id === id);
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= siblings.length) return d;
      const a = siblings[idx];
      const b = siblings[swapIdx];
      return {
        ...d,
        zones: d.zones.map((z) => {
          if (z.id === a.id) return { ...z, order: b.order };
          if (z.id === b.id) return { ...z, order: a.order };
          return z;
        }),
      };
    });
  }, []);

  // ---------- Tasks ----------
  const addTask = useCallback((roomId, partial) => {
    const id = makeId();
    const task = {
      id,
      roomId,
      title: 'Untitled Task',
      description: '',
      status: 'To Do',
      dueDate: '',
      category: 'Build',
      priority: 'Medium',
      linkedPuzzleId: null,
      linkedPropId: null,
      createdAt: now(),
      updatedAt: now(),
      ...partial,
    };
    setData((d) => ({ ...d, tasks: [...d.tasks, task] }));
    return id;
  }, []);

  const updateTask = useCallback((id, patch) => {
    setData((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: now() } : t)),
    }));
  }, []);

  const deleteTask = useCallback((id) => {
    setData((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }));
  }, []);

  // ---------- Backup / restore ----------
  const exportAll = useCallback(() => {
    downloadJSON(data);
  }, [data]);

  const importAll = useCallback((jsonText) => {
    const parsed = parseImportedJSON(jsonText);
    setData(parsed);
  }, []);

  const resetAll = useCallback(() => {
    setData(emptyData());
  }, []);

  const value = useMemo(
    () => ({
      data,
      addRoom,
      updateRoom,
      deleteRoom,
      addPuzzle,
      updatePuzzle,
      deletePuzzle,
      addProp,
      updateProp,
      deleteProp,
      addZone,
      updateZone,
      deleteZone,
      moveZone,
      addTask,
      updateTask,
      deleteTask,
      exportAll,
      importAll,
      resetAll,
    }),
    [
      data,
      addRoom,
      updateRoom,
      deleteRoom,
      addPuzzle,
      updatePuzzle,
      deletePuzzle,
      addProp,
      updateProp,
      deleteProp,
      addZone,
      updateZone,
      deleteZone,
      moveZone,
      addTask,
      updateTask,
      deleteTask,
      exportAll,
      importAll,
      resetAll,
    ],
  );

  return <RoomsContext.Provider value={value}>{children}</RoomsContext.Provider>;
}

export function useRooms() {
  const ctx = useContext(RoomsContext);
  if (!ctx) throw new Error('useRooms must be used within a RoomsProvider');
  return ctx;
}

// ---------- Derived selector helpers ----------

export function useRoom(roomId) {
  const { data } = useRooms();
  return useMemo(() => data.rooms.find((r) => r.id === roomId) || null, [data.rooms, roomId]);
}

export function usePuzzles(roomId) {
  const { data } = useRooms();
  return useMemo(() => data.puzzles.filter((p) => p.roomId === roomId), [data.puzzles, roomId]);
}

export function useProps(roomId) {
  const { data } = useRooms();
  return useMemo(() => data.props.filter((p) => p.roomId === roomId), [data.props, roomId]);
}

export function useZones(roomId) {
  const { data } = useRooms();
  return useMemo(
    () => data.zones.filter((z) => z.roomId === roomId).sort((a, b) => a.order - b.order),
    [data.zones, roomId],
  );
}

export function useTasks(roomId) {
  const { data } = useRooms();
  return useMemo(() => data.tasks.filter((t) => t.roomId === roomId), [data.tasks, roomId]);
}

export function useRoomProgress(roomId) {
  const puzzles = usePuzzles(roomId);
  const props = useProps(roomId);
  const tasks = useTasks(roomId);
  return useMemo(() => {
    const puzzlesDone = puzzles.filter((p) => p.status === 'Tested').length;
    const propsReady = props.filter((p) => p.sourcingStatus === 'Acquired').length;
    const tasksDone = tasks.filter((t) => t.status === 'Done').length;
    const totalCost = props.reduce((sum, p) => sum + (Number(p.cost) || 0) * (Number(p.quantity) || 1), 0);
    return {
      puzzlesTotal: puzzles.length,
      puzzlesDone,
      propsTotal: props.length,
      propsReady,
      tasksTotal: tasks.length,
      tasksDone,
      totalCost,
    };
  }, [puzzles, props, tasks]);
}
