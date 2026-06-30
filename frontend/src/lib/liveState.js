export const liveStateTimestamp = (state) => {
  const parsed = Date.parse(state?.updatedAt || state?.liveStateUpdatedAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
};

export const liveStateOrder = (state) => {
  const sequence = Number(state?.liveSequence);
  if (Number.isFinite(sequence) && sequence > 0) return { sequence, timestamp: liveStateTimestamp(state) };
  return { sequence: 0, timestamp: liveStateTimestamp(state) };
};

export const mergeNewerLiveState = (current, incoming) => {
  if (!incoming || typeof incoming !== "object") return current;
  const incomingOrder = liveStateOrder(incoming);
  const currentOrder = liveStateOrder(current);
  if (incomingOrder.sequence || currentOrder.sequence) {
    return incomingOrder.sequence > currentOrder.sequence ? { ...(current || {}), ...incoming } : current;
  }
  return incomingOrder.timestamp > currentOrder.timestamp ? { ...(current || {}), ...incoming } : current;
};
