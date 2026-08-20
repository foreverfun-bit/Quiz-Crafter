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
    if (incomingOrder.sequence > currentOrder.sequence) return { ...(current || {}), ...incoming };
    if (incomingOrder.sequence === currentOrder.sequence && incomingOrder.timestamp > currentOrder.timestamp) return { ...(current || {}), ...incoming };
    // A lower sequence number is always stale once either side has a real sequence --
    // a lagging durable-state poll can carry a newer wall-clock timestamp than the
    // live broadcast it's behind, so timestamp can never be allowed to override
    // sequence order. That was letting the presentation screen flash back to an
    // earlier state (e.g. the lobby/QR view) every time the fallback poll landed.
    return current;
  }
  return incomingOrder.timestamp > currentOrder.timestamp ? { ...(current || {}), ...incoming } : current;
};
