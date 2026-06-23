export const VENUES_STORAGE_KEY = "quiz-crafter-venues-v1";
export const ACTIVE_VENUE_STORAGE_KEY = "quiz-crafter-active-venue-id";
export const VENUE_BUILD_DRAFT_KEY = "quiz-crafter-venue-build-draft";
export const SHOW_TEMPLATES_STORAGE_KEY = "quiz-crafter-show-templates-v1";
export const PROFILE_VENUES_KEY = "quiz_crafter_venues_v1";
export const PROFILE_ACTIVE_VENUE_KEY = "quiz_crafter_active_venue_id";
export const PROFILE_SHOW_TEMPLATES_KEY = "quiz_crafter_show_templates_v1";

export const defaultVenue = {
  name: "",
  nightName: "",
  dayOfWeek: "Tuesday",
  frequency: "weekly",
  monthlyWeek: "first",
  startTime: "19:00",
  timeZone: "America/Chicago",
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
  const frequency = ["weekly", "bi_weekly", "monthly"].includes(source.frequency) ? source.frequency : defaultVenue.frequency;
  const monthlyWeek = ["first", "second", "third", "fourth", "last"].includes(source.monthlyWeek) ? source.monthlyWeek : defaultVenue.monthlyWeek;
  return {
    ...defaultVenue,
    ...source,
    id: source.id || `venue-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: String(source.name || "").trim(),
    nightName: String(source.nightName || "").trim(),
    dayOfWeek: String(source.dayOfWeek || defaultVenue.dayOfWeek).trim(),
    frequency,
    monthlyWeek,
    startTime: String(source.startTime || defaultVenue.startTime).trim(),
    timeZone: String(source.timeZone || defaultVenue.timeZone).trim(),
    address: String(source.address || "").trim(),
    hostName: String(source.hostName || "").trim(),
    roundCount: Math.max(1, Math.min(12, Number(source.roundCount || defaultVenue.roundCount))),
    questionsPerRound: Math.max(1, Math.min(20, Number(source.questionsPerRound || defaultVenue.questionsPerRound))),
    defaultPoints: Math.max(0, Number(source.defaultPoints || defaultVenue.defaultPoints)),
    defaultTimer: Math.max(0, Number(source.defaultTimer || defaultVenue.defaultTimer)),
    defaultWagerLimit: Math.max(0, Number(source.defaultWagerLimit || 0)),
    updatedAt: source.updatedAt || "",
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
  sessionDate: new Date().toISOString().slice(0, 10),
  rounds: makeVenueRounds(defaultVenue),
  activeRoundId: "round-1",
  theme: "",
  venueId: venue?.id || "",
  venueName: venue?.name || "",
  defaultQuestionSettings: {
    points: defaultVenue.defaultPoints,
    timer_seconds: defaultVenue.defaultTimer,
    wager_limit: defaultVenue.defaultWagerLimit,
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

export const defaultShowTemplates = [
  {
    id: "template-bar-classic",
    name: "Classic Bar Night",
    description: "Five balanced rounds for a weekly bar crowd, ending with a final wager-style round.",
    roundCount: 5,
    questionsPerRound: 5,
    defaultPoints: 25,
    defaultTimer: 30,
    defaultWagerLimit: 0,
    roundPoints: [25, 25, 25, 25, 25],
    roundTimers: [30, 30, 30, 30, 30],
    roundWagerLimits: [0, 0, 0, 0, 0],
    roundQuestionTypes: ["mixed", "mixed", "mixed", "mixed", "mixed"],
    roundNames: ["Warm-Up", "General Mix", "Theme Round", "Audio/Visual", "Final Wager"],
    roundDescriptions: [
      "Accessible opener with a few satisfying pulls.",
      "Mixed categories with fair but fresher clues.",
      "A cohesive theme without repeated bar-trivia staples.",
      "Media-friendly round. Pictures can attach to any question.",
      "Higher-stakes finish with room for a wager or bonus question.",
    ],
    hostNotes: "Good default for weekly public trivia. Keep the first round welcoming and the final round more strategic.",
  },
  {
    id: "template-corporate",
    name: "Corporate Event",
    description: "Smoother pacing, lower difficulty, and no harsh penalties for casual teams.",
    roundCount: 4,
    questionsPerRound: 5,
    defaultPoints: 20,
    defaultTimer: 35,
    defaultWagerLimit: 0,
    roundPoints: [20, 20, 20, 20],
    roundTimers: [35, 35, 35, 35],
    roundWagerLimits: [0, 0, 0, 0],
    roundQuestionTypes: ["mixed", "mixed", "mixed", "mixed"],
    roundNames: ["Icebreaker", "Pop Culture", "Teamwork Round", "Final Challenge"],
    roundDescriptions: [
      "Friendly questions that get teams talking.",
      "Broad, current-ish culture without niche fandom traps.",
      "Questions designed for discussion and group recall.",
      "A slightly tougher close, but still fair for non-regulars.",
    ],
    hostNotes: "Avoid overly obscure clues and keep scoring forgiving.",
  },
  {
    id: "template-tournament",
    name: "Competitive League Night",
    description: "Harder questions, tighter timing, and clear scoring for regular teams.",
    roundCount: 6,
    questionsPerRound: 5,
    defaultPoints: 50,
    defaultTimer: 30,
    defaultWagerLimit: 0,
    roundPoints: [50, 50, 75, 75, 100, 100],
    roundTimers: [30, 30, 30, 35, 35, 45],
    roundWagerLimits: [0, 0, 0, 0, 0, 0],
    roundQuestionTypes: ["mixed", "mixed", "mixed", "mixed", "mixed", "mixed"],
    roundNames: ["Opening Mix", "Knowledge Ladder", "Theme Deep Dive", "Connections", "High Difficulty", "Final Bonus"],
    roundDescriptions: [
      "Start fair, but signal that this is a serious room.",
      "Questions climb from medium to hard.",
      "One focused category with layered clues.",
      "Answers connect through a hidden thread.",
      "Obscure-but-fair questions for top teams.",
      "Final round or bonus sequence.",
    ],
    hostNotes: "Use more written answers and avoid soft multiple-choice saves.",
  },
];

export const normalizeTemplate = (template = {}) => {
  const source = template && typeof template === "object" ? template : {};
  const roundCount = Math.max(1, Math.min(12, Number(source.roundCount || 5)));
  return {
    id: source.id || `template-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: String(source.name || "").trim() || "New Show Template",
    description: String(source.description || "").trim(),
    roundCount,
    questionsPerRound: Math.max(1, Math.min(20, Number(source.questionsPerRound || 5))),
    defaultPoints: Math.max(0, Number(source.defaultPoints || 25)),
    defaultTimer: Math.max(0, Number(source.defaultTimer || 30)),
    defaultWagerLimit: Math.max(0, Number(source.defaultWagerLimit || 0)),
    roundPoints: Array.from({ length: roundCount }, (_, index) => Math.max(0, Number(source.roundPoints?.[index] ?? source.defaultPoints ?? 25))),
    roundTimers: Array.from({ length: roundCount }, (_, index) => Math.max(0, Number(source.roundTimers?.[index] ?? source.defaultTimer ?? 30))),
    roundWagerLimits: Array.from({ length: roundCount }, (_, index) => Math.max(0, Number(source.roundWagerLimits?.[index] ?? source.defaultWagerLimit ?? 0))),
    roundQuestionTypes: Array.from({ length: roundCount }, (_, index) => ["mixed", "true_false", "multiple_choice", "written"].includes(source.roundQuestionTypes?.[index]) ? source.roundQuestionTypes[index] : ["mixed", "true_false", "multiple_choice", "written"].includes(source.questionType) ? source.questionType : "mixed"),
    roundNames: Array.from({ length: roundCount }, (_, index) => String(source.roundNames?.[index] || (index === roundCount - 1 ? "Final Round" : `Round ${index + 1}`)).trim()),
    roundDescriptions: Array.from({ length: roundCount }, (_, index) => String(source.roundDescriptions?.[index] || "").trim()),
    hostNotes: String(source.hostNotes || "").trim(),
    updatedAt: source.updatedAt || new Date().toISOString(),
  };
};

export const readLocalTemplates = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SHOW_TEMPLATES_STORAGE_KEY) || "null");
    const source = Array.isArray(parsed) && parsed.length ? parsed : defaultShowTemplates;
    return source.map(normalizeTemplate);
  } catch {
    return defaultShowTemplates.map(normalizeTemplate);
  }
};

export const writeLocalTemplates = (templates) => {
  try {
    localStorage.setItem(SHOW_TEMPLATES_STORAGE_KEY, JSON.stringify(Array.isArray(templates) ? templates : []));
  } catch {
    // Template tools should still work in memory if storage is unavailable.
  }
};

const itemUpdatedTime = (item) => {
  const time = new Date(item?.updatedAt || item?.updated_at || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
};

export const mergeProfileRecords = (remoteRecords, localRecords, normalize) => {
  const map = new Map();
  const add = (record) => {
    const normalized = normalize(record);
    const key = normalized.id;
    const current = map.get(key);
    if (!current || itemUpdatedTime(normalized) >= itemUpdatedTime(current)) {
      map.set(key, normalized);
    }
  };

  (Array.isArray(remoteRecords) ? remoteRecords : []).forEach(add);
  (Array.isArray(localRecords) ? localRecords : []).forEach(add);
  return [...map.values()];
};

export const recordsChanged = (left, right) => {
  try {
    return JSON.stringify(left || []) !== JSON.stringify(right || []);
  } catch {
    return true;
  }
};

export const makeTemplateBuildDraft = (template, venue = null) => {
  const cleanTemplate = normalizeTemplate(template);
  const date = new Date().toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "numeric" });
  const inputDate = new Date().toISOString().slice(0, 10);
  const venueName = venue?.name || "";
  return {
    sessionName: [date, venueName || cleanTemplate.name].filter(Boolean).join(" "),
    sessionDate: inputDate,
    rounds: cleanTemplate.roundNames.map((name, index) => ({
      id: `round-${index + 1}`,
      name,
      description: cleanTemplate.roundDescriptions[index] || "",
      defaultQuestionSettings: {
        points: cleanTemplate.roundPoints[index] ?? cleanTemplate.defaultPoints,
        timer_seconds: cleanTemplate.roundTimers[index] ?? cleanTemplate.defaultTimer,
        wager_limit: cleanTemplate.roundWagerLimits[index] ?? cleanTemplate.defaultWagerLimit,
      },
      questionType: cleanTemplate.roundQuestionTypes[index] || "mixed",
      questionIds: [],
    })),
    activeRoundId: "round-1",
    theme: [cleanTemplate.name, cleanTemplate.description, cleanTemplate.hostNotes].filter(Boolean).join("\n"),
    venueId: venue?.id || "",
    venueName: venue?.name || "",
    templateId: cleanTemplate.id,
    templateName: cleanTemplate.name,
    defaultQuestionSettings: {
      points: cleanTemplate.defaultPoints,
      timer_seconds: cleanTemplate.defaultTimer,
      wager_limit: cleanTemplate.defaultWagerLimit,
    },
  };
};

export const writeTemplateBuildDraft = (template, venue = null) => {
  try {
    localStorage.setItem(VENUE_BUILD_DRAFT_KEY, JSON.stringify(makeTemplateBuildDraft(template, venue)));
  } catch {
    // Builder can still open without the draft.
  }
};
