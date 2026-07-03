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
