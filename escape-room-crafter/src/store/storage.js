const STORAGE_KEY = 'escape-room-crafter:data:v1';

export const emptyData = () => ({
  version: 1,
  rooms: [],
  puzzles: [],
  props: [],
  zones: [],
  tasks: [],
});

export function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw);
    return { ...emptyData(), ...parsed };
  } catch {
    return emptyData();
  }
}

export function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('Failed to save escape-room-crafter data', err);
  }
}

export function downloadJSON(data, filename = 'escape-room-crafter-backup.json') {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function parseImportedJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.rooms)) {
    throw new Error('That file does not look like an Escape Room Crafter backup.');
  }
  return { ...emptyData(), ...parsed };
}
