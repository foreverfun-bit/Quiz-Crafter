export const liveStateTimestamp = (state) => {
  const parsed = Date.parse(state?.updatedAt || state?.liveStateUpdatedAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
};

export const mergeNewerLiveState = (current, incoming) => {
  if (!incoming || typeof incoming !== "object") return current;
  return liveStateTimestamp(incoming) > liveStateTimestamp(current) ? { ...(current || {}), ...incoming } : current;
};
