export const VENUES_STORAGE_KEY = "quiz-crafter-venues-v1";
export const ACTIVE_VENUE_STORAGE_KEY = "quiz-crafter-active-venue-id";
export const VENUE_BUILD_DRAFT_KEY = "quiz-crafter-venue-build-draft";

export const defaultVenue = {
  name: "",
  nightName: "",
  dayOfWeek: "Tuesday",
  startTime: "19:00",
  address: "",
  hostName: "",
  logoUrl: "",
  primaryColor: "#71E0DC",
  accentColor: "#AEB2EF",
  facebook: "",
  instagram: "",
  website: "",
  roundCount: 5,
  questionsPerRound: 5,
  defaultPoints: 25,
  defaultTimer: 30,
  defaultWagerLimit: 0,
  houseRules: "",
  hostNotes: "",
};

export const readLocalVenues = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(VENUES_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const writeLocalVenues = (venues) => {
  try {
    localStorage.setItem(VENUES_STORAGE_KEY, JSON.stringify(Array.isArray(venues) ? venues : []));
  } catch {
    // Venue tools should still work in memory if storage is unavailable.
  }
};

export const readActiveVenueId = () => {
  try {
    return localStorage.getItem(ACTIVE_VENUE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
};

export const writeActiveVenueId = (venueId) => {
  try {
    localStorage.setItem(ACTIVE_VENUE_STORAGE_KEY, venueId || "");
  } catch {
    // Ignore storage failures.
  }
};

export const normalizeVenue = (venue = {}) => {
  const source = venue && typeof venue === "object" ? venue : {};
  return {
    ...defaultVenue,
    ...source,
    id: source.id || `venue-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: String(source.name || "").trim(),
    nightName: String(source.nightName || "").trim(),
    roundCount: Math.max(1, Math.min(12, Number(source.roundCount || defaultVenue.roundCount))),
    questionsPerRound: Math.max(1, Math.min(20, Number(source.questionsPerRound || defaultVenue.questionsPerRound))),
    defaultPoints: Math.max(0, Number(source.defaultPoints || defaultVenue.defaultPoints)),
    defaultTimer: Math.max(0, Number(source.defaultTimer || defaultVenue.defaultTimer)),
    defaultWagerLimit: Math.max(0, Number(source.defaultWagerLimit || 0)),
    updatedAt: source.updatedAt || new Date().toISOString(),
  };
};

export const makeVenueSessionName = (venue) => {
  const date = new Date().toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "numeric" });
  const title = venue?.nightName || venue?.name || "Trivia";
  return `${date} ${title}`.trim();
};

export const makeVenueRounds = (venue) => Array.from({ length: Number(venue?.roundCount || defaultVenue.roundCount) }, (_, index) => ({
  id: `round-${index + 1}`,
  name: index === Number(venue?.roundCount || defaultVenue.roundCount) - 1 ? "Final Round" : `Round ${index + 1}`,
  description: "",
  questionIds: [],
}));

export const makeVenueBuildDraft = (venue) => ({
  sessionName: makeVenueSessionName(venue),
  rounds: makeVenueRounds(venue),
  activeRoundId: "round-1",
  theme: [venue?.name, venue?.nightName, venue?.houseRules, venue?.hostNotes].filter(Boolean).join("\n"),
  venueId: venue?.id || "",
  venueName: venue?.name || "",
  defaultQuestionSettings: {
    points: venue?.defaultPoints || defaultVenue.defaultPoints,
    timer_seconds: venue?.defaultTimer || defaultVenue.defaultTimer,
    wager_limit: venue?.defaultWagerLimit || 0,
  },
});

export const writeVenueBuildDraft = (venue) => {
  try {
    localStorage.setItem(VENUE_BUILD_DRAFT_KEY, JSON.stringify(makeVenueBuildDraft(venue)));
  } catch {
    // Builder can still open without the draft.
  }
};

export const readVenueBuildDraft = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(VENUE_BUILD_DRAFT_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};
