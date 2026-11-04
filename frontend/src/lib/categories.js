export const cleanCategory = (value) => String(value || "").replace(/\s+/g, " ").trim();

export const categoryKey = (value) => cleanCategory(value)
  .toLowerCase()
  .replace(/[’‘`]/g, "'")
  .replace(/\band\b/g, "&")
  .replace(/[^a-z0-9&]+/g, "");

export const canonicalCategory = (value, existingCategories = []) => {
  const clean = cleanCategory(value);
  if (!clean) return "";
  const key = categoryKey(clean);
  const match = existingCategories.find((category) => categoryKey(category) === key);
  return match || clean;
};

export const dedupeCategories = (values, preferredCategories = []) => {
  const byKey = new Map();
  const prefer = (value) => {
    const clean = cleanCategory(value);
    if (!clean) return;
    const key = categoryKey(clean);
    if (key && !byKey.has(key)) byKey.set(key, clean);
  };

  preferredCategories.forEach(prefer);
  values.forEach(prefer);
  return [...byKey.values()];
};

// Shared with BuildSession.jsx (moved here so HostSession.jsx's merged
// workspace reads/writes the exact same approved/rejected category list --
// a category approved from either screen should show up in both).
export const CATEGORY_PREF_KEY = "quiz-crafter-category-preferences";

export const loadLocalCategoryPrefs = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CATEGORY_PREF_KEY) || "{}");
    return {
      approved: dedupeCategories(Array.isArray(parsed.approved) ? parsed.approved : []),
      rejected: dedupeCategories(Array.isArray(parsed.rejected) ? parsed.rejected : []),
      // A category the host deleted as a stray duplicate -- distinct from
      // rejected (disliked, steered away from in AI prompts). Kept out of
      // approved the same way rejected is, but never shown as "rejected"
      // and never sent to the AI as something to avoid.
      removed: dedupeCategories(Array.isArray(parsed.removed) ? parsed.removed : []),
    };
  } catch {
    return { approved: [], rejected: [], removed: [] };
  }
};
