const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash("sha256").update(`local:${ADMIN_USERNAME}:${ADMIN_PASSWORD}`).digest("hex");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, "data");
const DATA_FILE = path.join(DATA_DIR, "brackets.json");
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const SUPABASE_TABLE = "app_state";
const SUPABASE_DATA_KEY = "bracket-data";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const BRACKET_THEMES = new Set([
  "classic-light",
  "classic-dark",
  "modern-light",
  "modern-dark",
  "card-light",
  "card-dark"
]);
const BRACKET_FORMATS = new Set(["single", "double", "round-robin", "swiss", "group"]);
const BRACKET_SIZES = new Set([4, 6, 8, 10, 12, 16, 20, 24, 32]);

const sessions = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".ico": "image/x-icon"
};

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    const demo = createDemoTournament();
    fs.writeFileSync(DATA_FILE, JSON.stringify({ tournaments: [demo] }, null, 2));
  }
}

async function readSupabaseData() {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?key=eq.${encodeURIComponent(SUPABASE_DATA_KEY)}&select=data`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Supabase read failed: ${response.status} ${await response.text()}`);
  }

  const rows = await response.json();
  if (rows[0]?.data && Array.isArray(rows[0].data.tournaments)) {
    return rows[0].data;
  }

  const initialData = readFileData();
  await writeSupabaseData(initialData);
  return initialData;
}

async function writeSupabaseData(data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify({
      key: SUPABASE_DATA_KEY,
      data,
      updated_at: new Date().toISOString()
    })
  });

  if (!response.ok) {
    throw new Error(`Supabase write failed: ${response.status} ${await response.text()}`);
  }
}

function readFileData() {
  ensureDataFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!Array.isArray(parsed.tournaments)) {
      return { tournaments: [] };
    }
    return parsed;
  } catch (error) {
    console.error("Failed to read data file:", error);
    return { tournaments: [] };
  }
}

async function readData() {
  if (USE_SUPABASE) {
    try {
      return await readSupabaseData();
    } catch (error) {
      console.error(error);
      return readFileData();
    }
  }

  return readFileData();
}

function writeFileData(data) {
  ensureDataFile();
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

async function writeData(data) {
  if (USE_SUPABASE) {
    try {
      await writeSupabaseData(data);
      return;
    } catch (error) {
      console.error(error);
    }
  }

  writeFileData(data);
}

function createId(prefix) {
  return `${prefix}-${crypto.randomBytes(5).toString("hex")}`;
}

function cleanTeamNames(teams) {
  const source = Array.isArray(teams) ? teams : String(teams || "").split(/\r?\n/);
  const unique = [];
  const seen = new Set();

  for (const rawName of source) {
    const name = String(rawName || "").trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      unique.push(name);
      seen.add(key);
    }
  }

  return unique;
}

function shuffleTeamNames(teams) {
  const shuffled = [...teams];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function sanitizeBracketTheme(value) {
  return BRACKET_THEMES.has(value) ? value : "modern-light";
}

function sanitizeBracketFormat(value) {
  return BRACKET_FORMATS.has(value) ? value : "single";
}

function sanitizeSlotCount(value, fallback = 8) {
  const number = Number(value);
  const safeFallback = BRACKET_SIZES.has(Number(fallback)) ? Number(fallback) : 8;
  return BRACKET_SIZES.has(number) ? number : safeFallback;
}

function createSlots(teamInput, slotCount) {
  const teams = cleanTeamNames(teamInput);
  const slots = [...teams];

  while (slots.length < slotCount) {
    slots.push(`Slot ${slots.length + 1}`);
  }

  return slots.slice(0, slotCount);
}

function nextPowerOfTwo(value) {
  let size = 2;
  while (size < value) size *= 2;
  return size;
}

function getRoundName(index, total) {
  if (index === total - 1) return "Final";
  if (index === total - 2) return "Semifinal";
  if (index === total - 3) return "Perempat Final";
  return `Babak ${index + 1}`;
}

function emptySide(name = "", sourceMatchId = null) {
  return {
    name,
    sourceMatchId,
    score: null
  };
}

function generateSingleElimination(teamInput, options = {}) {
  const teams = cleanTeamNames(teamInput);
  const requestedSlotCount = sanitizeSlotCount(options.slotCount, 8);
  const slotCount = nextPowerOfTwo(
    teams.length ? Math.max(requestedSlotCount, teams.length, 2) : Math.max(requestedSlotCount, 2)
  );
  const roundCount = Math.log2(slotCount);
  const slots = [...teams];

  while (slots.length < slotCount) {
    slots.push(`Slot ${slots.length + 1}`);
  }

  const rounds = [];
  let matchNumber = 1;

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const matchCount = slotCount / 2 ** (roundIndex + 1);
    const round = {
      id: createId("round"),
      name: getRoundName(roundIndex, roundCount),
      matches: []
    };

    for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
      const homeSource =
        roundIndex === 0 ? null : rounds[roundIndex - 1].matches[matchIndex * 2].id;
      const awaySource =
        roundIndex === 0 ? null : rounds[roundIndex - 1].matches[matchIndex * 2 + 1].id;
      const homeSourceCode =
        roundIndex === 0 ? null : rounds[roundIndex - 1].matches[matchIndex * 2].code;
      const awaySourceCode =
        roundIndex === 0 ? null : rounds[roundIndex - 1].matches[matchIndex * 2 + 1].code;
      const homeName =
        roundIndex === 0 ? slots[matchIndex * 2] : `Pemenang ${homeSourceCode}`;
      const awayName =
        roundIndex === 0 ? slots[matchIndex * 2 + 1] : `Pemenang ${awaySourceCode}`;
      const match = {
        id: createId("match"),
        code: `M${matchNumber}`,
        slot: matchIndex + 1,
        home: emptySide(homeName, homeSource),
        away: emptySide(awayName, awaySource),
        status: "scheduled",
        winner: null,
        scheduledAt: "",
        note: ""
      };

      round.matches.push(match);
      matchNumber += 1;
    }

    rounds.push(round);
  }

  for (let roundIndex = 0; roundIndex < rounds.length - 1; roundIndex += 1) {
    rounds[roundIndex].matches.forEach((match, matchIndex) => {
      const nextMatch = rounds[roundIndex + 1].matches[Math.floor(matchIndex / 2)];
      match.feedsTo = {
        matchId: nextMatch.id,
        side: matchIndex % 2 === 0 ? "home" : "away"
      };
    });
  }

  rounds.at(-1).matches[0].feedsTo = null;

  applyByeWinners(rounds[0].matches);
  return rounds;
}

function generateDoubleElimination(teamInput, options = {}) {
  const teams = cleanTeamNames(teamInput);
  const requestedSlotCount = sanitizeSlotCount(options.slotCount, 8);

  if (requestedSlotCount === 6 || teams.length === 6) {
    return generateSixSlotDoubleElimination(teamInput, options);
  }

  const effectiveSlotCount = nextPowerOfTwo(
    teams.length ? Math.max(requestedSlotCount, teams.length, 2) : Math.max(requestedSlotCount, 2)
  );

  if (effectiveSlotCount === 16) {
    return generateSixteenSlotDoubleElimination(teamInput, options);
  }

  const upperRounds = generateSingleElimination(teamInput, options);
  const firstUpper = upperRounds[0]?.matches || [];

  if (firstUpper.length === 4) {
    return generateEightSlotDoubleElimination(upperRounds);
  }

  let matchNumber =
    upperRounds.reduce((total, round) => total + round.matches.length, 0) + 1;
  const lowerRounds = [];

  for (let upperRoundIndex = 0; upperRoundIndex < Math.max(1, upperRounds.length - 1); upperRoundIndex += 1) {
    const sourceRound = upperRounds[upperRoundIndex]?.matches || [];
    const sourceCount = Math.max(1, Math.floor(sourceRound.length / 2));
    const round = {
      id: createId("round"),
      name: `Lower R${upperRoundIndex + 1}`,
      bracketSide: "lower",
      matches: []
    };

    for (let matchIndex = 0; matchIndex < sourceCount; matchIndex += 1) {
      const firstSource = sourceRound[matchIndex * 2] || firstUpper[matchIndex * 2];
      const secondSource = sourceRound[matchIndex * 2 + 1] || firstUpper[matchIndex * 2 + 1];
      const homeName =
        upperRoundIndex === 0 && firstSource
          ? `Kalah ${firstSource.code}`
          : `Pemenang Lower R${upperRoundIndex}-${matchIndex + 1}`;
      const awayName =
        upperRoundIndex === 0 && secondSource
          ? `Kalah ${secondSource.code}`
          : `Kalah ${sourceRound[matchIndex]?.code || `Upper R${upperRoundIndex + 1}`}`;

      round.matches.push(createFlatMatch(`M${matchNumber}`, matchIndex + 1, homeName, awayName));
      matchNumber += 1;
    }

    lowerRounds.push(round);
  }

  const upperFinal = upperRounds.at(-1)?.matches[0];
  const needsFourSlotLowerFinal = upperRounds.length === 2 && lowerRounds.length === 1 && upperFinal;

  if (needsFourSlotLowerFinal) {
    const finalRound = {
      id: createId("round"),
      name: "Lower Final",
      bracketSide: "lower",
      matches: [
        createFlatMatch(
          `M${matchNumber}`,
          1,
          `Pemenang ${lowerRounds[0].matches[0]?.code || "Lower Match 1"}`,
          `Kalah ${upperFinal.code}`
        )
      ]
    };
    lowerRounds.push(finalRound);
    matchNumber += 1;
  } else if (lowerRounds.length > 1) {
    const finalRound = {
      id: createId("round"),
      name: "Lower Final",
      bracketSide: "lower",
      matches: [
        createFlatMatch(
          `M${matchNumber}`,
          1,
          `Pemenang ${lowerRounds.at(-2).matches[0]?.code || "Lower"}`,
          `Pemenang ${lowerRounds.at(-1).matches[0]?.code || "Lower"}`
        )
      ]
    };
    lowerRounds.push(finalRound);
    matchNumber += 1;
  }

  const lowerFinal = lowerRounds.at(-1)?.matches[0];
  const lowerFinalRound = lowerRounds.at(-1);
  const grandFinal = {
    id: createId("round"),
    name: "Grand Final",
    bracketSide: "grand",
    matches: [
      createFlatMatch(
        `M${matchNumber}`,
        1,
        upperFinal ? `Pemenang ${upperFinal.code}` : "Juara Upper",
        lowerFinal ? `Pemenang ${lowerFinal.code}` : "Juara Lower"
      )
    ]
  };

  lowerRounds.forEach((round, roundIndex) => {
    const nextRound = lowerRounds[roundIndex + 1];
    if (!nextRound) return;

    round.matches.forEach((match, matchIndex) => {
      const nextMatch = nextRound.matches[Math.floor(matchIndex / 2)] || nextRound.matches[0];
      match.feedsTo = {
        matchId: nextMatch.id,
        side: matchIndex % 2 === 0 ? "home" : "away"
      };
    });
  });

  if (upperFinal) {
    upperFinal.feedsTo = {
      matchId: grandFinal.matches[0].id,
      side: "home"
    };
  }

  if (lowerFinal) {
    lowerFinal.feedsTo = {
      matchId: grandFinal.matches[0].id,
      side: "away"
    };
  }

  upperRounds.forEach((round) => {
    round.bracketSide = "upper";
    round.name = `Upper ${round.name}`;
  });

  return [...upperRounds, ...lowerRounds, grandFinal];
}

function generateSixSlotDoubleElimination(teamInput, options = {}) {
  const slots = createSlots(teamInput, sanitizeSlotCount(options.slotCount, 6));
  const [seed1, seed2, seed3, seed4, seed5, seed6] = slots;

  const upperRound1 = {
    id: createId("round"),
    name: "Upper Babak 1",
    bracketSide: "upper",
    matches: [
      createFlatMatch("M1", 1, seed3, seed6),
      createFlatMatch("M2", 2, seed4, seed5)
    ]
  };

  const [upperMatch1, upperMatch2] = upperRound1.matches;
  const upperRound2 = {
    id: createId("round"),
    name: "Upper Babak 2",
    bracketSide: "upper",
    matches: [
      createFlatMatch("M3", 1, seed1, `Pemenang ${upperMatch1.code}`),
      createFlatMatch("M4", 2, seed2, `Pemenang ${upperMatch2.code}`)
    ]
  };

  const [upperMatch3, upperMatch4] = upperRound2.matches;
  upperMatch3.away.sourceMatchId = upperMatch1.id;
  upperMatch4.away.sourceMatchId = upperMatch2.id;

  const upperFinalRound = {
    id: createId("round"),
    name: "Upper Final",
    bracketSide: "upper",
    matches: [
      createFlatMatch("M5", 1, `Pemenang ${upperMatch3.code}`, `Pemenang ${upperMatch4.code}`)
    ]
  };

  const upperFinal = upperFinalRound.matches[0];
  upperFinal.home.sourceMatchId = upperMatch3.id;
  upperFinal.away.sourceMatchId = upperMatch4.id;

  const lowerRound1 = {
    id: createId("round"),
    name: "Lower R1",
    bracketSide: "lower",
    matches: [
      createFlatMatch("M6", 1, `Kalah ${upperMatch1.code}`, `Kalah ${upperMatch2.code}`)
    ]
  };

  const lowerMatch1 = lowerRound1.matches[0];
  const lowerRound2 = {
    id: createId("round"),
    name: "Lower R2",
    bracketSide: "lower",
    matches: [
      createFlatMatch("M7", 1, `Pemenang ${lowerMatch1.code}`, `Kalah ${upperMatch3.code}`)
    ]
  };

  const lowerMatch2 = lowerRound2.matches[0];
  lowerMatch2.home.sourceMatchId = lowerMatch1.id;

  const lowerFinalRound = {
    id: createId("round"),
    name: "Lower Final",
    bracketSide: "lower",
    matches: [
      createFlatMatch("M8", 1, `Pemenang ${lowerMatch2.code}`, `Kalah ${upperMatch4.code}`)
    ]
  };

  const lowerFinal = lowerFinalRound.matches[0];
  lowerFinal.home.sourceMatchId = lowerMatch2.id;

  const grandFinal = {
    id: createId("round"),
    name: "Grand Final",
    bracketSide: "grand",
    matches: [
      createFlatMatch("M9", 1, `Pemenang ${upperFinal.code}`, `Pemenang ${lowerFinal.code}`)
    ]
  };

  const grandFinalMatch = grandFinal.matches[0];
  grandFinalMatch.home.sourceMatchId = upperFinal.id;
  grandFinalMatch.away.sourceMatchId = lowerFinal.id;

  upperMatch1.feedsTo = { matchId: upperMatch3.id, side: "away" };
  upperMatch2.feedsTo = { matchId: upperMatch4.id, side: "away" };
  upperMatch3.feedsTo = { matchId: upperFinal.id, side: "home" };
  upperMatch4.feedsTo = { matchId: upperFinal.id, side: "away" };
  upperFinal.feedsTo = { matchId: grandFinalMatch.id, side: "home" };
  lowerMatch1.feedsTo = { matchId: lowerMatch2.id, side: "home" };
  lowerMatch2.feedsTo = { matchId: lowerFinal.id, side: "home" };
  lowerFinal.feedsTo = { matchId: grandFinalMatch.id, side: "away" };

  upperMatch1.losesTo = { matchId: lowerMatch1.id, side: "home" };
  upperMatch2.losesTo = { matchId: lowerMatch1.id, side: "away" };
  upperMatch3.losesTo = { matchId: lowerMatch2.id, side: "away" };
  upperMatch4.losesTo = { matchId: lowerFinal.id, side: "away" };

  return [
    upperRound1,
    upperRound2,
    upperFinalRound,
    lowerRound1,
    lowerRound2,
    lowerFinalRound,
    grandFinal
  ];
}

function generateEightSlotDoubleElimination(upperRounds) {
  let matchNumber =
    upperRounds.reduce((total, round) => total + round.matches.length, 0) + 1;
  const firstUpper = upperRounds[0]?.matches || [];
  const secondUpper = upperRounds[1]?.matches || [];
  const upperFinal = upperRounds.at(-1)?.matches[0];

  const lowerRound1 = {
    id: createId("round"),
    name: "Lower R1",
    bracketSide: "lower",
    matches: [
      createFlatMatch(`M${matchNumber}`, 1, `Kalah ${firstUpper[0]?.code || "M1"}`, `Kalah ${firstUpper[1]?.code || "M2"}`),
      createFlatMatch(`M${matchNumber + 1}`, 2, `Kalah ${firstUpper[2]?.code || "M3"}`, `Kalah ${firstUpper[3]?.code || "M4"}`)
    ]
  };
  matchNumber += 2;

  const lowerRound2 = {
    id: createId("round"),
    name: "Lower R2",
    bracketSide: "lower",
    matches: [
      createFlatMatch(
        `M${matchNumber}`,
        1,
        `Pemenang ${lowerRound1.matches[0].code}`,
        `Pemenang ${lowerRound1.matches[1].code}`
      )
    ]
  };
  matchNumber += 1;

  const lowerRound3 = {
    id: createId("round"),
    name: "Lower R3",
    bracketSide: "lower",
    matches: [
      createFlatMatch(
        `M${matchNumber}`,
        1,
        `Kalah ${secondUpper[0]?.code || "M5"}`,
        `Pemenang ${lowerRound2.matches[0].code}`
      )
    ]
  };
  matchNumber += 1;

  const lowerRound4 = {
    id: createId("round"),
    name: "Lower R4",
    bracketSide: "lower",
    matches: [
      createFlatMatch(
        `M${matchNumber}`,
        1,
        `Kalah ${secondUpper[1]?.code || "M6"}`,
        `Pemenang ${lowerRound3.matches[0].code}`
      )
    ]
  };
  matchNumber += 1;

  const lowerFinalRound = {
    id: createId("round"),
    name: "Lower Final",
    bracketSide: "lower",
    matches: [
      createFlatMatch(
        `M${matchNumber}`,
        1,
        `Pemenang ${lowerRound4.matches[0].code}`,
        upperFinal ? `Kalah ${upperFinal.code}` : "Kalah Upper Final"
      )
    ]
  };
  matchNumber += 1;

  const grandFinal = {
    id: createId("round"),
    name: "Grand Final",
    bracketSide: "grand",
    matches: [
      createFlatMatch(
        `M${matchNumber}`,
        1,
        upperFinal ? `Pemenang ${upperFinal.code}` : "Juara Upper",
        `Pemenang ${lowerFinalRound.matches[0].code}`
      )
    ]
  };

  lowerRound1.matches[0].feedsTo = { matchId: lowerRound2.matches[0].id, side: "home" };
  lowerRound1.matches[1].feedsTo = { matchId: lowerRound2.matches[0].id, side: "away" };
  lowerRound2.matches[0].feedsTo = { matchId: lowerRound3.matches[0].id, side: "away" };
  lowerRound3.matches[0].feedsTo = { matchId: lowerRound4.matches[0].id, side: "away" };
  lowerRound4.matches[0].feedsTo = { matchId: lowerFinalRound.matches[0].id, side: "home" };
  lowerFinalRound.matches[0].feedsTo = { matchId: grandFinal.matches[0].id, side: "away" };

  lowerRound2.matches[0].home.sourceMatchId = lowerRound1.matches[0].id;
  lowerRound2.matches[0].away.sourceMatchId = lowerRound1.matches[1].id;
  lowerRound3.matches[0].away.sourceMatchId = lowerRound2.matches[0].id;
  lowerRound4.matches[0].away.sourceMatchId = lowerRound3.matches[0].id;
  lowerFinalRound.matches[0].home.sourceMatchId = lowerRound4.matches[0].id;
  grandFinal.matches[0].away.sourceMatchId = lowerFinalRound.matches[0].id;

  if (secondUpper[0]) {
    secondUpper[0].losesTo = { matchId: lowerRound3.matches[0].id, side: "home" };
  }

  if (secondUpper[1]) {
    secondUpper[1].losesTo = { matchId: lowerRound4.matches[0].id, side: "home" };
  }

  if (upperFinal) {
    upperFinal.feedsTo = {
      matchId: grandFinal.matches[0].id,
      side: "home"
    };
    upperFinal.losesTo = {
      matchId: lowerFinalRound.matches[0].id,
      side: "away"
    };
    grandFinal.matches[0].home.sourceMatchId = upperFinal.id;
  }

  firstUpper.forEach((match, index) => {
    const target = lowerRound1.matches[Math.floor(index / 2)];
    if (!target) return;
    match.losesTo = {
      matchId: target.id,
      side: index % 2 === 0 ? "home" : "away"
    };
  });

  upperRounds.forEach((round) => {
    round.bracketSide = "upper";
    round.name = `Upper ${round.name}`;
  });

  return [...upperRounds, lowerRound1, lowerRound2, lowerRound3, lowerRound4, lowerFinalRound, grandFinal];
}

function generateSixteenSlotDoubleElimination(teamInput, options = {}) {
  const slots = createSlots(teamInput, Math.max(16, sanitizeSlotCount(options.slotCount, 16)));

  const upperRound1 = {
    id: createId("round"),
    name: "Upper Round 1",
    bracketSide: "upper",
    matches: Array.from({ length: 8 }, (_, index) =>
      createFlatMatch(`M${index + 1}`, index + 1, slots[index * 2], slots[index * 2 + 1])
    )
  };

  const upperRound2 = {
    id: createId("round"),
    name: "Upper Round 2",
    bracketSide: "upper",
    matches: Array.from({ length: 4 }, (_, index) =>
      createFlatMatch(
        `M${index + 9}`,
        index + 1,
        `Pemenang ${upperRound1.matches[index * 2].code}`,
        `Pemenang ${upperRound1.matches[index * 2 + 1].code}`
      )
    )
  };

  const upperRound3 = {
    id: createId("round"),
    name: "Upper Round 3",
    bracketSide: "upper",
    matches: [
      createFlatMatch("M13", 1, "Pemenang M9", "Pemenang M10"),
      createFlatMatch("M14", 2, "Pemenang M11", "Pemenang M12")
    ]
  };

  const upperFinalRound = {
    id: createId("round"),
    name: "Upper Final",
    bracketSide: "upper",
    matches: [createFlatMatch("M15", 1, "Pemenang M13", "Pemenang M14")]
  };

  const lowerRound1 = {
    id: createId("round"),
    name: "Lower R1",
    bracketSide: "lower",
    matches: [
      createFlatMatch("M16", 1, "Kalah M1", "Kalah M2"),
      createFlatMatch("M17", 2, "Kalah M3", "Kalah M4"),
      createFlatMatch("M18", 3, "Kalah M5", "Kalah M6"),
      createFlatMatch("M19", 4, "Kalah M7", "Kalah M8")
    ]
  };

  const lowerRound2 = {
    id: createId("round"),
    name: "Lower R2",
    bracketSide: "lower",
    matches: [
      createFlatMatch("M20", 1, "Pemenang M16", "Kalah M9"),
      createFlatMatch("M21", 2, "Pemenang M17", "Kalah M10"),
      createFlatMatch("M22", 3, "Pemenang M18", "Kalah M11"),
      createFlatMatch("M23", 4, "Pemenang M19", "Kalah M12")
    ]
  };

  const lowerRound3 = {
    id: createId("round"),
    name: "Lower R3",
    bracketSide: "lower",
    matches: [
      createFlatMatch("M24", 1, "Pemenang M20", "Pemenang M21"),
      createFlatMatch("M25", 2, "Pemenang M22", "Pemenang M23")
    ]
  };

  const lowerRound4 = {
    id: createId("round"),
    name: "Lower R4",
    bracketSide: "lower",
    matches: [
      createFlatMatch("M26", 1, "Pemenang M24", "Kalah M13"),
      createFlatMatch("M27", 2, "Pemenang M25", "Kalah M14")
    ]
  };

  const lowerRound5 = {
    id: createId("round"),
    name: "Lower R5",
    bracketSide: "lower",
    matches: [createFlatMatch("M28", 1, "Pemenang M26", "Pemenang M27")]
  };

  const lowerFinalRound = {
    id: createId("round"),
    name: "Lower Final",
    bracketSide: "lower",
    matches: [createFlatMatch("M29", 1, "Pemenang M28", "Kalah M15")]
  };

  const grandFinal = {
    id: createId("round"),
    name: "Grand Final",
    bracketSide: "grand",
    matches: [createFlatMatch("M30", 1, "Pemenang M15", "Pemenang M29")]
  };

  const matchByCode = new Map(
    [
      upperRound1,
      upperRound2,
      upperRound3,
      upperFinalRound,
      lowerRound1,
      lowerRound2,
      lowerRound3,
      lowerRound4,
      lowerRound5,
      lowerFinalRound,
      grandFinal
    ].flatMap((round) => round.matches.map((match) => [match.code, match]))
  );

  const feedWinner = (fromCode, toCode, side) => {
    const from = matchByCode.get(fromCode);
    const to = matchByCode.get(toCode);
    from.feedsTo = { matchId: to.id, side };
    to[side].sourceMatchId = from.id;
  };

  const feedLoser = (fromCode, toCode, side) => {
    const from = matchByCode.get(fromCode);
    const to = matchByCode.get(toCode);
    from.losesTo = { matchId: to.id, side };
  };

  [
    ["M1", "M9", "home"],
    ["M2", "M9", "away"],
    ["M3", "M10", "home"],
    ["M4", "M10", "away"],
    ["M5", "M11", "home"],
    ["M6", "M11", "away"],
    ["M7", "M12", "home"],
    ["M8", "M12", "away"],
    ["M9", "M13", "home"],
    ["M10", "M13", "away"],
    ["M11", "M14", "home"],
    ["M12", "M14", "away"],
    ["M13", "M15", "home"],
    ["M14", "M15", "away"],
    ["M15", "M30", "home"],
    ["M16", "M20", "home"],
    ["M17", "M21", "home"],
    ["M18", "M22", "home"],
    ["M19", "M23", "home"],
    ["M20", "M24", "home"],
    ["M21", "M24", "away"],
    ["M22", "M25", "home"],
    ["M23", "M25", "away"],
    ["M24", "M26", "home"],
    ["M25", "M27", "home"],
    ["M26", "M28", "home"],
    ["M27", "M28", "away"],
    ["M28", "M29", "home"],
    ["M29", "M30", "away"]
  ].forEach(([fromCode, toCode, side]) => feedWinner(fromCode, toCode, side));

  [
    ["M1", "M16", "home"],
    ["M2", "M16", "away"],
    ["M3", "M17", "home"],
    ["M4", "M17", "away"],
    ["M5", "M18", "home"],
    ["M6", "M18", "away"],
    ["M7", "M19", "home"],
    ["M8", "M19", "away"],
    ["M9", "M20", "away"],
    ["M10", "M21", "away"],
    ["M11", "M22", "away"],
    ["M12", "M23", "away"],
    ["M13", "M26", "away"],
    ["M14", "M27", "away"],
    ["M15", "M29", "away"]
  ].forEach(([fromCode, toCode, side]) => feedLoser(fromCode, toCode, side));

  return [
    upperRound1,
    upperRound2,
    upperRound3,
    upperFinalRound,
    lowerRound1,
    lowerRound2,
    lowerRound3,
    lowerRound4,
    lowerRound5,
    lowerFinalRound,
    grandFinal
  ];
}

function createFlatMatch(code, slot, homeName, awayName) {
  return {
    id: createId("match"),
    code,
    slot,
    home: emptySide(homeName),
    away: emptySide(awayName),
    status: "scheduled",
    winner: null,
    scheduledAt: "",
    note: "",
    feedsTo: null
  };
}

function generateRoundRobin(teamInput, options = {}) {
  const slotCount = sanitizeSlotCount(options.slotCount, 8);
  let slots = createSlots(teamInput, slotCount);
  const rounds = [];
  let matchNumber = 1;

  for (let roundIndex = 0; roundIndex < slotCount - 1; roundIndex += 1) {
    const round = {
      id: createId("round"),
      name: `Matchday ${roundIndex + 1}`,
      matches: []
    };

    for (let pairIndex = 0; pairIndex < slotCount / 2; pairIndex += 1) {
      const left = slots[pairIndex];
      const right = slots[slotCount - 1 - pairIndex];
      const homeName = roundIndex % 2 === 0 ? left : right;
      const awayName = roundIndex % 2 === 0 ? right : left;
      round.matches.push(createFlatMatch(`M${matchNumber}`, pairIndex + 1, homeName, awayName));
      matchNumber += 1;
    }

    rounds.push(round);
    slots = [slots[0], slots[slotCount - 1], ...slots.slice(1, slotCount - 1)];
  }

  return rounds;
}

function generateSwissManual(teamInput, options = {}) {
  const slotCount = sanitizeSlotCount(options.slotCount, 8);
  const slots = createSlots(teamInput, slotCount);
  const roundCount = Math.ceil(Math.log2(slotCount));
  const rounds = [];
  let matchNumber = 1;

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const round = {
      id: createId("round"),
      name: `Swiss R${roundIndex + 1}`,
      matches: []
    };

    for (let pairIndex = 0; pairIndex < slotCount / 2; pairIndex += 1) {
      const homeName = roundIndex === 0 ? slots[pairIndex * 2] : `Pairing R${roundIndex + 1}-${pairIndex * 2 + 1}`;
      const awayName =
        roundIndex === 0 ? slots[pairIndex * 2 + 1] : `Pairing R${roundIndex + 1}-${pairIndex * 2 + 2}`;
      round.matches.push(createFlatMatch(`M${matchNumber}`, pairIndex + 1, homeName, awayName));
      matchNumber += 1;
    }

    rounds.push(round);
  }

  return rounds;
}

function getGroupName(index) {
  return `Grup ${String.fromCharCode(65 + index)}`;
}

function getGroupRoundPairings(groupSlots) {
  let slots = groupSlots.length % 2 === 0 ? [...groupSlots] : [...groupSlots, "BYE"];
  const rounds = [];

  for (let roundIndex = 0; roundIndex < slots.length - 1; roundIndex += 1) {
    const matches = [];
    for (let pairIndex = 0; pairIndex < slots.length / 2; pairIndex += 1) {
      const left = slots[pairIndex];
      const right = slots[slots.length - 1 - pairIndex];
      if (left !== "BYE" && right !== "BYE") {
        matches.push([left, right]);
      }
    }
    rounds.push(matches);
    slots = [slots[0], slots[slots.length - 1], ...slots.slice(1, slots.length - 1)];
  }

  return rounds;
}

function getGroupCount(slotCount) {
  return Math.max(1, Math.ceil(slotCount / 4));
}

function splitIntoGroups(slots, groupCount) {
  const groups = Array.from({ length: groupCount }, () => []);
  slots.forEach((slot, index) => {
    groups[index % groupCount].push(slot);
  });
  return groups;
}

function generateGroupOnly(teamInput, options = {}) {
  const slotCount = sanitizeSlotCount(options.slotCount, 8);
  const slots = createSlots(teamInput, slotCount);
  const groupCount = getGroupCount(slotCount);
  const groups = splitIntoGroups(slots, groupCount);
  const groupPairings = groups.map(getGroupRoundPairings);
  const maxRoundCount = Math.max(...groupPairings.map((pairings) => pairings.length), 0);
  const rounds = [];
  let matchNumber = 1;

  for (let roundIndex = 0; roundIndex < maxRoundCount; roundIndex += 1) {
    const round = {
      id: createId("round"),
      name: `Jadwal Grup ${roundIndex + 1}`,
      bracketSide: "group",
      matches: []
    };

    groupPairings.forEach((pairings, groupIndex) => {
      (pairings[roundIndex] || []).forEach(([homeName, awayName]) => {
        const match = createFlatMatch(`M${matchNumber}`, round.matches.length + 1, homeName, awayName);
        match.note = getGroupName(groupIndex);
        match.groupName = getGroupName(groupIndex);
        round.matches.push(match);
        matchNumber += 1;
      });
    });

    rounds.push(round);
  }

  return rounds;
}

function generateGroupPlayoff(teamInput, options = {}) {
  const slotCount = sanitizeSlotCount(options.slotCount, 8);
  const slots = createSlots(teamInput, slotCount);
  const groupCount = slotCount <= 8 ? 2 : 4;
  const groups = splitIntoGroups(slots, groupCount);
  const groupSize = Math.max(...groups.map((group) => group.length));
  const groupPairings = groups.map(getGroupRoundPairings);
  const rounds = [];
  let matchNumber = 1;

  for (let roundIndex = 0; roundIndex < groupSize - 1; roundIndex += 1) {
    const round = {
      id: createId("round"),
      name: `Fase Grup R${roundIndex + 1}`,
      matches: []
    };

    groupPairings.forEach((pairings, groupIndex) => {
      (pairings[roundIndex] || []).forEach(([homeName, awayName], pairIndex) => {
        const match = createFlatMatch(`M${matchNumber}`, round.matches.length + 1, homeName, awayName);
        match.note = getGroupName(groupIndex);
        match.groupName = getGroupName(groupIndex);
        round.matches.push(match);
        matchNumber += 1;
      });
    });

    rounds.push(round);
  }

  if (groupCount === 2) {
    rounds.push({
      id: createId("round"),
      name: "Final",
      matches: [createFlatMatch(`M${matchNumber}`, 1, "Juara Grup A", "Juara Grup B")]
    });
  } else {
    const semifinal = {
      id: createId("round"),
      name: "Semifinal",
      matches: [
        createFlatMatch(`M${matchNumber}`, 1, "Juara Grup A", "Runner-up Grup B"),
        createFlatMatch(`M${matchNumber + 1}`, 2, "Juara Grup C", "Runner-up Grup D")
      ]
    };
    matchNumber += 2;
    const final = {
      id: createId("round"),
      name: "Final",
      matches: [createFlatMatch(`M${matchNumber}`, 1, `Pemenang ${semifinal.matches[0].code}`, `Pemenang ${semifinal.matches[1].code}`)]
    };
    semifinal.matches[0].feedsTo = { matchId: final.matches[0].id, side: "home" };
    semifinal.matches[1].feedsTo = { matchId: final.matches[0].id, side: "away" };
    rounds.push(semifinal, final);
  }

  return rounds;
}

function generateBracket(teamInput, options = {}) {
  const format = sanitizeBracketFormat(options.bracketFormat);

  if (format === "round-robin") {
    return generateRoundRobin(teamInput, options);
  }

  if (format === "double") {
    return generateDoubleElimination(teamInput, options);
  }

  if (format === "swiss") {
    return generateSwissManual(teamInput, options);
  }

  if (format === "group") {
    return generateGroupOnly(teamInput, options);
  }

  return generateSingleElimination(teamInput, options);
}

function applyByeWinners(matches) {
  for (const match of matches) {
    const homeBye = match.home.name === "BYE";
    const awayBye = match.away.name === "BYE";

    if (homeBye && !awayBye) {
      match.status = "finished";
      match.winner = "away";
    }

    if (awayBye && !homeBye) {
      match.status = "finished";
      match.winner = "home";
    }
  }
}

function getAllMatches(tournament) {
  return tournament.rounds.flatMap((round) =>
    round.matches.map((match) => ({
      round,
      match
    }))
  );
}

function findMatch(tournament, matchId) {
  return getAllMatches(tournament).find(({ match }) => match.id === matchId);
}

function recalculateAdvancement(tournament) {
  const matchMap = new Map(getAllMatches(tournament).map(({ match }) => [match.id, match]));

  tournament.rounds.forEach((round, roundIndex) => {
    if (roundIndex === 0) return;

    round.matches.forEach((match) => {
      ["home", "away"].forEach((side) => {
        const sourceId = match[side].sourceMatchId;
        if (!sourceId) return;

        const sourceMatch = sourceId ? matchMap.get(sourceId) : null;
        match[side].name = sourceMatch ? `Pemenang ${sourceMatch.code}` : "";
        match[side].score = null;
      });
    });
  });

  tournament.rounds.forEach((round) => {
    round.matches.forEach((match) => {
      if (!match.losesTo) return;

      const nextMatch = matchMap.get(match.losesTo.matchId);
      if (!nextMatch) return;

      nextMatch[match.losesTo.side].name = `Kalah ${match.code}`;
      nextMatch[match.losesTo.side].score = null;
    });
  });

  tournament.rounds.forEach((round) => {
    round.matches.forEach((match) => {
      if (!match.winner) return;

      const winnerSide = match.winner === "away" ? match.away : match.home;
      const loserSide = match.winner === "away" ? match.home : match.away;

      if (match.feedsTo) {
        const nextMatch = matchMap.get(match.feedsTo.matchId);
        if (nextMatch && winnerSide.name && winnerSide.name !== "BYE") {
          nextMatch[match.feedsTo.side].name = winnerSide.name;
        }
      }

      if (match.losesTo) {
        const nextMatch = matchMap.get(match.losesTo.matchId);
        if (nextMatch && loserSide.name && loserSide.name !== "BYE") {
          nextMatch[match.losesTo.side].name = loserSide.name;
        }
      }
    });
  });

  tournament.updatedAt = new Date().toISOString();
}

function syncTournamentTeams(tournament) {
  const rounds = tournament.rounds || [];
  if (!rounds.length) return;

  const teams = [];
  for (const round of rounds) {
    for (const match of round.matches) {
      [match.home.name, match.away.name].forEach((name) => {
        const cleanName = String(name || "").trim();
        if (
          cleanName &&
          cleanName !== "BYE" &&
          !cleanName.startsWith("Slot ") &&
          !cleanName.startsWith("Pemenang ") &&
          !cleanName.startsWith("Kalah ") &&
          !cleanName.startsWith("Pairing ") &&
          !cleanName.startsWith("Juara Grup ") &&
          !cleanName.startsWith("Runner-up Grup ") &&
          !teams.some((team) => team.toLowerCase() === cleanName.toLowerCase())
        ) {
          teams.push(cleanName);
        }
      });
    }
  }

  tournament.teams = teams;
}

function createTournament(payload) {
  const cleanedTeams = cleanTeamNames(payload.teams);
  const teamNames = payload.shuffleTeams === true ? shuffleTeamNames(cleanedTeams) : cleanedTeams;
  const bracketFormat = sanitizeBracketFormat(payload.bracketFormat);
  const requestedSlotCount = sanitizeSlotCount(
    payload.slotCount,
    nextPowerOfTwo(Math.max(teamNames.length, 8))
  );
  const slotCount =
    teamNames.length > requestedSlotCount
      ? bracketFormat === "group"
        ? teamNames.length
        : nextPowerOfTwo(teamNames.length)
      : requestedSlotCount;
  const tournament = {
    id: createId("tournament"),
    name: String(payload.name || "Turnamen Baru").trim(),
    game: String(payload.game || "Open Tournament").trim(),
    venue: String(payload.venue || "").trim(),
    startDate: String(payload.startDate || "").trim(),
    status: ["draft", "live", "finished"].includes(payload.status) ? payload.status : "draft",
    slotCount,
    bracketTheme: sanitizeBracketTheme(payload.bracketTheme),
    bracketFormat,
    teams: teamNames,
    rounds: generateBracket(teamNames, {
      slotCount,
      bracketFormat
    }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  recalculateAdvancement(tournament);
  return tournament;
}

function createDemoTournament() {
  const demo = createTournament({
    name: "Liga Komunitas 2026",
    game: "Mobile Legends",
    venue: "Arena Nusantara",
    startDate: "2026-06-21",
    status: "live",
    teams: [
      "Garuda Prime",
      "Volt Esports",
      "Orion Squad",
      "Northwind",
      "Rift Hunters",
      "Satria Muda",
      "Apex Nine",
      "Byte Force"
    ]
  });

  const firstRound = demo.rounds[0].matches;
  firstRound[0].home.score = 2;
  firstRound[0].away.score = 1;
  firstRound[0].winner = "home";
  firstRound[0].status = "finished";
  firstRound[1].home.score = 0;
  firstRound[1].away.score = 2;
  firstRound[1].winner = "away";
  firstRound[1].status = "finished";
  firstRound[2].home.score = 1;
  firstRound[2].away.score = 1;
  firstRound[2].status = "live";
  recalculateAdvancement(demo);

  return demo;
}

function sendJson(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(body));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...value] = part.split("=");
        return [decodeURIComponent(key), decodeURIComponent(value.join("="))];
      })
  );
}

function sign(value) {
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
  return `${value}.${signature}`;
}

function verifySigned(value) {
  if (!value || !value.includes(".")) return null;
  const index = value.lastIndexOf(".");
  const raw = value.slice(0, index);
  const signature = value.slice(index + 1);
  const expected = sign(raw).slice(index + 1);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) return null;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer) ? raw : null;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const sessionId = verifySigned(cookies.admin_session);
  if (!sessionId) return null;

  const session = sessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function authHeadersForSession(sessionId) {
  return {
    "Set-Cookie": `admin_session=${encodeURIComponent(sign(sessionId))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(
      SESSION_TTL_MS / 1000
    )}`
  };
}

function clearAuthHeaders() {
  return {
    "Set-Cookie": "admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
  };
}

function safeString(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function sanitizeScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.floor(number));
}

function updateMatch(match, payload) {
  match.home.name = safeString(payload.homeName, match.home.name);
  match.away.name = safeString(payload.awayName, match.away.name);
  match.home.score = sanitizeScore(payload.homeScore);
  match.away.score = sanitizeScore(payload.awayScore);
  match.status = ["scheduled", "live", "finished"].includes(payload.status)
    ? payload.status
    : match.status;
  match.winner = ["home", "away"].includes(payload.winner) ? payload.winner : null;
  match.scheduledAt = safeString(payload.scheduledAt, match.scheduledAt);
  match.note = safeString(payload.note, match.note);

  if (match.status === "finished" && !match.winner) {
    const home = match.home.score;
    const away = match.away.score;
    if (home !== null && away !== null && home !== away) {
      match.winner = home > away ? "home" : "away";
    }
  }
}

async function handleApi(req, res, pathname) {
  const session = getSession(req);
  const isAdmin = Boolean(session);

  if (pathname === "/api/session" && req.method === "GET") {
    sendJson(res, 200, {
      authenticated: isAdmin,
      username: isAdmin ? session.username : null
    });
    return;
  }

  if (pathname === "/api/login" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const username = safeString(body.username);
    const password = String(body.password || "");

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      const sessionId = crypto.randomBytes(24).toString("base64url");
      sessions.set(sessionId, {
        username,
        expiresAt: Date.now() + SESSION_TTL_MS
      });
      sendJson(res, 200, { authenticated: true, username }, authHeadersForSession(sessionId));
      return;
    }

    sendJson(res, 401, { error: "Username atau password salah." });
    return;
  }

  if (pathname === "/api/logout" && req.method === "POST") {
    const cookies = parseCookies(req);
    const sessionId = verifySigned(cookies.admin_session);
    if (sessionId) sessions.delete(sessionId);
    sendJson(res, 200, { ok: true }, clearAuthHeaders());
    return;
  }

  if (pathname === "/api/tournaments" && req.method === "GET") {
    sendJson(res, 200, await readData());
    return;
  }

  if (pathname === "/api/tournaments" && req.method === "POST") {
    if (!isAdmin) {
      sendJson(res, 403, { error: "Akses admin diperlukan." });
      return;
    }

    const body = await parseJsonBody(req);
    const data = await readData();
    const tournament = createTournament(body);
    data.tournaments.unshift(tournament);
    await writeData(data);
    sendJson(res, 201, tournament);
    return;
  }

  const tournamentMatch = pathname.match(/^\/api\/tournaments\/([^/]+)$/);
  if (tournamentMatch) {
    if (!isAdmin && req.method !== "GET") {
      sendJson(res, 403, { error: "Akses admin diperlukan." });
      return;
    }

    const data = await readData();
    const tournament = data.tournaments.find((item) => item.id === tournamentMatch[1]);
    if (!tournament) {
      sendJson(res, 404, { error: "Turnamen tidak ditemukan." });
      return;
    }

    if (req.method === "GET") {
      sendJson(res, 200, tournament);
      return;
    }

    if (req.method === "PUT") {
      const body = await parseJsonBody(req);
      tournament.name = safeString(body.name, tournament.name);
      tournament.game = safeString(body.game, tournament.game);
      tournament.venue = safeString(body.venue, tournament.venue);
      tournament.startDate = safeString(body.startDate, tournament.startDate);
      tournament.status = ["draft", "live", "finished"].includes(body.status)
        ? body.status
        : tournament.status;
      tournament.bracketTheme = sanitizeBracketTheme(body.bracketTheme || tournament.bracketTheme);
      tournament.bracketFormat = sanitizeBracketFormat(body.bracketFormat || tournament.bracketFormat);

      if (body.regenerate === true) {
        const cleanedTeams = cleanTeamNames(body.teams);
        const teams = body.shuffleTeams === true ? shuffleTeamNames(cleanedTeams) : cleanedTeams;
        const requestedSlotCount = sanitizeSlotCount(body.slotCount, tournament.slotCount || 8);
        tournament.slotCount =
          teams.length > requestedSlotCount
            ? tournament.bracketFormat === "group"
              ? teams.length
              : nextPowerOfTwo(teams.length)
            : requestedSlotCount;
        tournament.teams = teams;
        tournament.rounds = generateBracket(teams, {
          slotCount: tournament.slotCount,
          bracketFormat: tournament.bracketFormat
        });
      }

      syncTournamentTeams(tournament);
      recalculateAdvancement(tournament);
      await writeData(data);
      sendJson(res, 200, tournament);
      return;
    }

    if (req.method === "DELETE") {
      const index = data.tournaments.findIndex((item) => item.id === tournament.id);
      data.tournaments.splice(index, 1);
      await writeData(data);
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  const matchRoute = pathname.match(/^\/api\/tournaments\/([^/]+)\/matches\/([^/]+)$/);
  if (matchRoute) {
    if (!isAdmin) {
      sendJson(res, 403, { error: "Akses admin diperlukan." });
      return;
    }

    const data = await readData();
    const tournament = data.tournaments.find((item) => item.id === matchRoute[1]);
    if (!tournament) {
      sendJson(res, 404, { error: "Turnamen tidak ditemukan." });
      return;
    }

    const found = findMatch(tournament, matchRoute[2]);
    if (!found) {
      sendJson(res, 404, { error: "Match tidak ditemukan." });
      return;
    }

    if (req.method === "PUT") {
      const body = await parseJsonBody(req);
      updateMatch(found.match, body);
      recalculateAdvancement(tournament);
      syncTournamentTeams(tournament);
      await writeData(data);
      sendJson(res, 200, tournament);
      return;
    }
  }

  sendJson(res, 404, { error: "Endpoint tidak ditemukan." });
}

function serveStatic(req, res, pathname) {
  const targetPath = pathname === "/" ? "/index.html" : pathname;
  const normalized = path.normalize(decodeURIComponent(targetPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Cache-Control": [".html", ".css", ".js"].includes(ext) ? "no-store" : "public, max-age=600"
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
      return;
    }

    serveStatic(req, res, pathname);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Terjadi kesalahan server." });
  }
});

ensureDataFile();
server.listen(PORT, () => {
  console.log(`Bracket Tournament running at http://localhost:${PORT}`);
  console.log(`Admin username: ${ADMIN_USERNAME}`);
});
