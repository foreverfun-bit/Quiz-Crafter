export const ROOM_STATUSES = ['Concept', 'Designing', 'Building', 'Testing', 'Live'];

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Expert'];

export const PUZZLE_TYPES = [
  'Lock / Combination',
  'Search',
  'Logic',
  'Mechanical',
  'Tech / Electronic',
  'Wordplay',
  'Physical / Dexterity',
  'Other',
];

export const PUZZLE_STATUSES = ['Idea', 'Designing', 'Prototyping', 'Built', 'Tested'];

export const PROP_CATEGORIES = [
  'Prop',
  'Furniture',
  'Lock / Hardware',
  'Electronics',
  'Decor',
  'Consumable',
  'Other',
];

export const SOURCING_STATUSES = ['Need to source', 'Ordered', 'Acquired', 'Needs building'];

export const TASK_CATEGORIES = ['Build', 'Props', 'Puzzle', 'Testing', 'Marketing', 'Admin'];

export const TASK_STATUSES = ['To Do', 'In Progress', 'Done'];

export const TASK_PRIORITIES = ['Low', 'Medium', 'High'];

export const STATUS_COLORS = {
  // room statuses
  Concept: 'bg-stone-700 text-stone-200',
  Designing: 'bg-sky-500/20 text-sky-300',
  Building: 'bg-amber-500/20 text-amber-300',
  Testing: 'bg-violet-500/20 text-violet-300',
  Live: 'bg-emerald-500/20 text-emerald-300',
  // puzzle statuses
  Idea: 'bg-stone-700 text-stone-200',
  Prototyping: 'bg-amber-500/20 text-amber-300',
  Built: 'bg-sky-500/20 text-sky-300',
  Tested: 'bg-emerald-500/20 text-emerald-300',
  // sourcing statuses
  'Need to source': 'bg-rose-500/20 text-rose-300',
  Ordered: 'bg-amber-500/20 text-amber-300',
  Acquired: 'bg-emerald-500/20 text-emerald-300',
  'Needs building': 'bg-sky-500/20 text-sky-300',
  // task statuses
  'To Do': 'bg-stone-700 text-stone-200',
  'In Progress': 'bg-amber-500/20 text-amber-300',
  Done: 'bg-emerald-500/20 text-emerald-300',
  // priority
  Low: 'bg-stone-700 text-stone-200',
  Medium: 'bg-amber-500/20 text-amber-300',
  High: 'bg-rose-500/20 text-rose-300',
};
