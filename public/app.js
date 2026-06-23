const state = {
  tournaments: [],
  selectedId: null,
  isAdmin: false,
  username: null,
  activeMatch: null
};

const statusLabels = {
  draft: "Draft",
  live: "Berlangsung",
  finished: "Selesai",
  scheduled: "Terjadwal"
};

const formatLabels = {
  single: "Single Elimination",
  double: "Double Elimination",
  "round-robin": "Round Robin",
  swiss: "Swiss Manual",
  group: "Grup",
  "group-playoff": "Grup + Playoff"
};

const $ = (selector) => document.querySelector(selector);

const els = {
  adminState: $("#adminState"),
  addTournamentButton: $("#addTournamentButton"),
  loginButton: $("#loginButton"),
  logoutButton: $("#logoutButton"),
  tournamentCount: $("#tournamentCount"),
  tournamentList: $("#tournamentList"),
  tournamentHead: $("#tournamentHead"),
  bracketScroll: $("#bracketScroll"),
  loginDialog: $("#loginDialog"),
  loginForm: $("#loginForm"),
  loginError: $("#loginError"),
  usernameInput: $("#usernameInput"),
  passwordInput: $("#passwordInput"),
  tournamentDialog: $("#tournamentDialog"),
  tournamentForm: $("#tournamentForm"),
  tournamentDialogTitle: $("#tournamentDialogTitle"),
  tournamentDialogHint: $("#tournamentDialogHint"),
  tournamentIdInput: $("#tournamentIdInput"),
  tournamentNameInput: $("#tournamentNameInput"),
  gameInput: $("#gameInput"),
  startDateInput: $("#startDateInput"),
  statusInput: $("#statusInput"),
  venueInput: $("#venueInput"),
  bracketFormatInput: $("#bracketFormatInput"),
  bracketSizeInput: $("#bracketSizeInput"),
  bracketThemeInput: $("#bracketThemeInput"),
  regenerateRow: $("#regenerateRow"),
  regenerateInput: $("#regenerateInput"),
  tournamentError: $("#tournamentError"),
  matchDialog: $("#matchDialog"),
  matchForm: $("#matchForm"),
  matchDialogTitle: $("#matchDialogTitle"),
  matchDialogHint: $("#matchDialogHint"),
  matchIdInput: $("#matchIdInput"),
  homeNameInput: $("#homeNameInput"),
  homeScoreInput: $("#homeScoreInput"),
  awayNameInput: $("#awayNameInput"),
  awayScoreInput: $("#awayScoreInput"),
  scheduledAtInput: $("#scheduledAtInput"),
  matchStatusInput: $("#matchStatusInput"),
  winnerInput: $("#winnerInput"),
  noteInput: $("#noteInput"),
  matchError: $("#matchError"),
  clearMatchButton: $("#clearMatchButton")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Permintaan gagal.");
  }

  return data;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: value.includes("T") ? "short" : undefined
  }).format(date);
}

function formatMatchSchedule(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getSelectedTournament() {
  return state.tournaments.find((item) => item.id === state.selectedId) || state.tournaments[0];
}

function getTeamsCount(tournament) {
  return Number(tournament?.slotCount || tournament?.teams?.length || 0);
}

function getMatchCount(tournament) {
  return (tournament?.rounds || []).reduce((total, round) => total + round.matches.length, 0);
}

function getChampion(tournament) {
  if (getBracketFormat(tournament) === "group") {
    const leaders = getGroupedMatches(tournament)
      .flatMap(([, matchEntries]) => computeGroupStandings(matchEntries).slice(0, 1))
      .map((standing) => standing.teamName);
    return leaders.length ? leaders.join(", ") : "-";
  }

  const finalMatch = tournament?.rounds?.at(-1)?.matches?.[0];
  if (!finalMatch?.winner) return "-";
  return finalMatch[finalMatch.winner]?.name || "-";
}

function getTeamSummary(tournament) {
  const teams = tournament.teams || [];
  const slotCount = getTeamsCount(tournament);
  return teams.length ? `${teams.length} peserta terisi dari ${slotCount} slot` : `${slotCount} slot bracket`;
}

function getStatusClass(status) {
  return statusLabels[status] ? status : "scheduled";
}

function getMatchStatusText(match) {
  const label = statusLabels[match.status] || match.status;
  const schedule = formatMatchSchedule(match.scheduledAt);
  return schedule ? `${schedule} - ${label}` : label;
}

function getBracketTheme(tournament) {
  return tournament?.bracketTheme || "modern-light";
}

function getBracketFormat(tournament) {
  return tournament?.bracketFormat || "single";
}

function render() {
  document.body.classList.toggle("is-admin", state.isAdmin);
  els.adminState.textContent = state.isAdmin ? `Admin: ${state.username}` : "Mode publik";
  renderTournamentList();
  renderBracket();
}

function renderTournamentList() {
  els.tournamentCount.textContent = String(state.tournaments.length);

  if (!state.tournaments.length) {
    els.tournamentList.innerHTML = `
      <div class="empty-state">
        <div>
          <strong>Belum ada turnamen</strong>
          <span>Login admin untuk membuat bracket pertama.</span>
        </div>
      </div>
    `;
    return;
  }

  els.tournamentList.innerHTML = state.tournaments
    .map((tournament) => {
      const active = tournament.id === getSelectedTournament()?.id ? " active" : "";
      return `
        <article class="tournament-card${active}" data-select-tournament="${escapeHtml(tournament.id)}">
          <div class="card-meta">
            <span class="status ${getStatusClass(tournament.status)}">${statusLabels[tournament.status] || tournament.status}</span>
            <span>${escapeHtml(tournament.game || "Open")}</span>
          </div>
          <h3>${escapeHtml(tournament.name)}</h3>
          <div class="card-meta">
            <span>${getTeamsCount(tournament)} slot</span>
            <span>${getMatchCount(tournament)} match</span>
          </div>
          ${
            state.isAdmin
              ? `<div class="card-actions">
                  <button class="button ghost" type="button" data-edit-tournament="${escapeHtml(tournament.id)}">Edit</button>
                  <button class="button danger" type="button" data-delete-tournament="${escapeHtml(tournament.id)}">Hapus</button>
                </div>`
              : ""
          }
        </article>
      `;
    })
    .join("");
}

function renderBracket() {
  const tournament = getSelectedTournament();

  if (!tournament) {
    els.tournamentHead.innerHTML = "";
    els.bracketScroll.innerHTML = `
      <div class="empty-state">
        <div>
          <strong>Bracket kosong</strong>
          <span>Belum ada turnamen yang bisa ditampilkan.</span>
        </div>
      </div>
    `;
    return;
  }

  state.selectedId = tournament.id;
  els.tournamentHead.innerHTML = `
    <div class="tournament-title">
      <div class="head-meta">
        <span class="status ${getStatusClass(tournament.status)}">${statusLabels[tournament.status] || tournament.status}</span>
        <span>${escapeHtml(tournament.game || "Open Tournament")}</span>
        <span>${escapeHtml(formatLabels[getBracketFormat(tournament)] || getBracketFormat(tournament))}</span>
        <span>${formatDate(tournament.startDate)}</span>
        <span>${escapeHtml(tournament.venue || "Online")}</span>
      </div>
      <h1>${escapeHtml(tournament.name)}</h1>
      <p>${escapeHtml(getTeamSummary(tournament))}</p>
      ${
        state.isAdmin
          ? `<div class="tournament-actions">
              <button class="button primary" type="button" data-shuffle-tournament="${escapeHtml(tournament.id)}">Acak Tim</button>
            </div>`
          : ""
      }
    </div>
    <div class="stat-strip">
      <div class="stat"><span>Slot</span><strong>${getTeamsCount(tournament)}</strong></div>
      <div class="stat"><span>Format</span><strong>${escapeHtml(formatLabels[getBracketFormat(tournament)] || "-")}</strong></div>
      <div class="stat"><span>Match</span><strong>${getMatchCount(tournament)}</strong></div>
      <div class="stat"><span>${getBracketFormat(tournament) === "group" ? "Peringkat 1" : "Juara"}</span><strong>${escapeHtml(getChampion(tournament))}</strong></div>
    </div>
  `;

  els.bracketScroll.innerHTML = `
    <div class="bracket-stage">
      <svg class="connector-layer" aria-hidden="true"></svg>
      <div class="bracket theme-${escapeHtml(getBracketTheme(tournament))} format-${escapeHtml(getBracketFormat(tournament))}">
        ${
          getBracketFormat(tournament) === "group"
            ? renderGroupStage(tournament)
            : renderBracketRounds(tournament)
        }
      </div>
    </div>
  `;
  window.requestAnimationFrame(drawBracketConnectors);
}

function getMatchGroupName(match) {
  return match.groupName || match.note || "Grup A";
}

function getGroupedMatches(tournament) {
  const groups = new Map();

  (tournament.rounds || []).forEach((round) => {
    (round.matches || []).forEach((match) => {
      const groupName = getMatchGroupName(match);
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName).push({ round, match });
    });
  });

  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, "id-ID"));
}

function getEmptyStanding(teamName) {
  return {
    teamName,
    played: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    scored: 0,
    conceded: 0,
    points: 0
  };
}

function computeGroupStandings(matchEntries) {
  const standings = new Map();

  matchEntries.forEach(({ match }) => {
    [match.home.name, match.away.name].forEach((name) => {
      const teamName = String(name || "").trim();
      if (!teamName || teamName === "BYE") return;
      if (!standings.has(teamName)) standings.set(teamName, getEmptyStanding(teamName));
    });

    if (match.status !== "finished" || match.home.score === null || match.away.score === null) return;

    const home = standings.get(match.home.name);
    const away = standings.get(match.away.name);
    if (!home || !away) return;

    home.played += 1;
    away.played += 1;
    home.scored += match.home.score;
    home.conceded += match.away.score;
    away.scored += match.away.score;
    away.conceded += match.home.score;

    if (match.home.score === match.away.score) {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    } else if (match.home.score > match.away.score) {
      home.wins += 1;
      away.losses += 1;
      home.points += 3;
    } else {
      away.wins += 1;
      home.losses += 1;
      away.points += 3;
    }
  });

  return [...standings.values()].sort((left, right) => {
    const diff = (right.scored - right.conceded) - (left.scored - left.conceded);
    return (
      right.points - left.points ||
      diff ||
      right.scored - left.scored ||
      left.teamName.localeCompare(right.teamName, "id-ID")
    );
  });
}

function renderGroupStage(tournament) {
  const displayContext = buildBracketDisplayContext(tournament);
  let displayNumber = 1;
  const getNextDisplayNumber = () => displayNumber++;
  const groupedMatches = getGroupedMatches(tournament);

  return `
    <div class="group-stage">
      ${groupedMatches
        .map(([groupName, matchEntries]) => {
          const standings = computeGroupStandings(matchEntries);
          return `
            <section class="group-card" aria-label="${escapeHtml(groupName)}">
              <header class="group-card-head">
                <h2>${escapeHtml(groupName)}</h2>
                <span>${matchEntries.length} match</span>
              </header>
              <div class="standings-wrap">
                <table class="standings-table">
                  <thead>
                    <tr>
                      <th>Pos</th>
                      <th>Tim</th>
                      <th>P</th>
                      <th>W</th>
                      <th>D</th>
                      <th>L</th>
                      <th>+/-</th>
                      <th>Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${standings
                      .map(
                        (row, index) => `
                          <tr>
                            <td>${index + 1}</td>
                            <td>${escapeHtml(row.teamName)}</td>
                            <td>${row.played}</td>
                            <td>${row.wins}</td>
                            <td>${row.draws}</td>
                            <td>${row.losses}</td>
                            <td>${row.scored - row.conceded}</td>
                            <td>${row.points}</td>
                          </tr>
                        `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
              <div class="group-match-list">
                ${matchEntries
                  .map(({ round, match }, index) =>
                    renderMatch({ ...match, note: "" }, round, getNextDisplayNumber, index, displayContext)
                  )
                  .join("")}
              </div>
            </section>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderBracketRounds(tournament) {
  const format = getBracketFormat(tournament);
  const rounds = tournament.rounds || [];
  const displayContext = buildBracketDisplayContext(tournament);
  let displayNumber = 1;
  const getNextDisplayNumber = () => displayNumber++;

  if (format !== "double") {
    return `<div class="bracket-lane">${rounds.map((round, index) => renderRound(round, getRoundDisplayName(round, index), getNextDisplayNumber, displayContext)).join("")}</div>`;
  }

  const upperRounds = rounds.filter((round) => round.bracketSide === "upper");
  const lowerRounds = rounds.filter((round) => round.bracketSide === "lower");
  const grandRounds = rounds.filter((round) => round.bracketSide === "grand");

  return `
    <div class="bracket-lane bracket-lane-upper">
      ${upperRounds.map((round, index) => renderRound(round, `Round ${index + 1}`, getNextDisplayNumber, displayContext)).join("")}
      ${grandRounds.map((round) => renderRound(round, "Grand Final", getNextDisplayNumber, displayContext)).join("")}
    </div>
    <div class="bracket-lane bracket-lane-lower">
      ${lowerRounds.map((round, index) => renderRound(round, `Lower ${index + 1}`, getNextDisplayNumber, displayContext)).join("")}
    </div>
  `;
}

function buildBracketDisplayContext(tournament) {
  const rounds = tournament?.rounds || [];
  const matchTitleById = new Map();
  const titleByCode = new Map();
  const lowerMatches = rounds.flatMap((round) =>
    round.bracketSide === "lower"
      ? round.matches.map((match) => ({ round, match }))
      : []
  );
  const useSequentialLowerNames = lowerMatches.length > 2;
  let lowerIndex = 1;

  rounds.forEach((round) => {
    round.matches.forEach((match, matchIndex) => {
      let title = "";

      if (round.bracketSide === "grand") {
        title = "Grand Final";
      } else if (round.bracketSide === "lower") {
        title = useSequentialLowerNames
          ? `Lower Match ${lowerIndex++}`
          : getMatchDisplayTitle(match, round, matchIndex);
      } else {
        title = getMatchDisplayTitle(match, round, matchIndex);
      }

      matchTitleById.set(match.id, title);
      titleByCode.set(match.code, title);
    });
  });

  return { matchTitleById, titleByCode };
}

function getRoundDisplayName(round, index) {
  if (round.bracketSide === "grand") return "Grand Final";
  if (round.bracketSide === "lower") return `Lower ${index + 1}`;
  return `Round ${index + 1}`;
}

function getRoundMeta(round) {
  const matches = round.matches || [];
  const live = matches.some((match) => match.status === "live");
  const finished = matches.length > 0 && matches.every((match) => match.status === "finished");
  const firstSchedule = matches
    .map((match) => match.scheduledAt)
    .filter(Boolean)
    .sort()[0];
  const scheduleText = firstSchedule ? formatMatchSchedule(firstSchedule) : "";
  const statusText = live ? "Berlangsung" : finished ? "Selesai" : "Terjadwal";

  return [scheduleText, statusText].filter(Boolean).join(" - ");
}

function renderRound(
  round,
  displayName = round.name,
  getNextDisplayNumber = () => "",
  displayContext = buildBracketDisplayContext()
) {
  const roundMeta = getRoundMeta(round);
  return `
    <section class="round round-${escapeHtml(round.bracketSide || "main")}" aria-label="${escapeHtml(round.name)}">
      <div class="round-title">
        <span class="round-name">${escapeHtml(displayName)}</span>
        <span class="round-meta">${escapeHtml(roundMeta)}</span>
      </div>
      <div class="round-matches">
        ${round.matches
          .map((match, matchIndex) =>
            renderMatch(match, round, getNextDisplayNumber, matchIndex, displayContext)
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderMatch(
  match,
  round,
  getNextDisplayNumber = () => "",
  matchIndex = 0,
  displayContext = buildBracketDisplayContext()
) {
  const details = [
    match.note ? `<span>${escapeHtml(match.note)}</span>` : ""
  ]
    .filter(Boolean)
    .join("");

  return `
    <article class="match-card is-${getStatusClass(match.status)}" data-match-id="${escapeHtml(match.id)}">
      <div class="match-top">
        <span class="match-code">${escapeHtml(
          displayContext.matchTitleById.get(match.id) || getMatchDisplayTitle(match, round, matchIndex)
        )}</span>
        <span class="match-status-text">${escapeHtml(statusLabels[match.status] || "Terjadwal")}</span>
      </div>
      ${renderTeam(match.home, match.winner === "home", getNextDisplayNumber(), displayContext)}
      ${renderTeam(match.away, match.winner === "away", getNextDisplayNumber(), displayContext)}
      ${details ? `<div class="match-details">${details}</div>` : ""}
      ${
        state.isAdmin
          ? `<button class="match-edit-button" type="button" data-edit-match="${escapeHtml(match.id)}" data-round="${escapeHtml(round.id)}">Edit</button>`
          : ""
      }
      <div class="match-footer">
        <div class="match-meta">
          ${match.note ? `<span>${escapeHtml(match.note)}</span>` : ""}
        </div>
        ${
          state.isAdmin
            ? `<button class="button ghost" type="button" data-edit-match="${escapeHtml(match.id)}" data-round="${escapeHtml(round.id)}">Edit</button>`
            : ""
        }
      </div>
    </article>
  `;
}

function getMatchNumber(match) {
  const [, number] = String(match.code || "").match(/^M(\d+)$/) || [];
  return number || match.slot || "";
}

function getMatchDisplayTitle(match, round, matchIndex = 0) {
  const number = getMatchNumber(match);

  if (round.bracketSide === "grand") return "Grand Final";
  if (round.bracketSide === "lower") {
    if (/final/i.test(round.name)) {
      return "Lower Final";
    }
    return `Lower Match ${matchIndex + 1}`;
  }
  if (round.bracketSide === "upper" && round.matches.length === 1) {
    return `Match ${number} (Upper Final)`;
  }

  return `Match ${number}`;
}

function formatDisplayTitleForParticipant(title) {
  return title
    .replace(/^Grand Final$/i, "Grand Final")
    .replace(/^Lower Match /i, "Lower Match ")
    .replace(/^Match /i, "Match ");
}

function formatParticipantName(name, displayContext = buildBracketDisplayContext()) {
  let value = String(name || "-");

  displayContext.titleByCode.forEach((title, code) => {
    value = value.replace(
      new RegExp(`\\b${code}\\b`, "g"),
      formatDisplayTitleForParticipant(title)
    );
  });

  return value
    .replace(/Pemenang Lower R(\d+)-(\d+)/g, "Pemenang Lower Match $2")
    .replace(/Juara Upper/g, "Pemenang Upper Final")
    .replace(/Juara Lower/g, "Pemenang Lower Final")
    .replace(/\(Upper Final\)\s+\(Upper Final\)/g, "(Upper Final)");
}

function drawBracketConnectors() {
  const tournament = getSelectedTournament();
  const format = getBracketFormat(tournament);
  const canDraw = ["single", "double"].includes(format);
  const stage = els.bracketScroll.querySelector(".bracket-stage");
  const svg = els.bracketScroll.querySelector(".connector-layer");

  if (!stage || !svg) return;
  svg.innerHTML = "";

  if (!canDraw || !tournament) return;

  const stageRect = stage.getBoundingClientRect();
  const width = Math.max(stage.scrollWidth, stageRect.width);
  const height = Math.max(stage.scrollHeight, stageRect.height);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);

  const matches = tournament.rounds.flatMap((round) => round.matches);
  const matchById = new Map(matches.map((match) => [match.id, match]));

  matches.forEach((match) => {
    if (!match.feedsTo || !matchById.has(match.feedsTo.matchId)) return;

    const source = stage.querySelector(`[data-match-id="${CSS.escape(match.id)}"]`);
    const target = stage.querySelector(`[data-match-id="${CSS.escape(match.feedsTo.matchId)}"]`);
    if (!source || !target) return;

    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const x1 = sourceRect.right - stageRect.left + stage.scrollLeft;
    const y1 = sourceRect.top + sourceRect.height / 2 - stageRect.top + stage.scrollTop;
    const x2 = targetRect.left - stageRect.left + stage.scrollLeft;
    const y2 = targetRect.top + targetRect.height / 2 - stageRect.top + stage.scrollTop;
    const midX = x1 + Math.max(24, (x2 - x1) / 2);

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`);
    path.setAttribute("class", "connector-path");
    svg.appendChild(path);
  });
}

function renderTeam(team, isWinner, displayNumber = "", displayContext = buildBracketDisplayContext()) {
  const displayName = formatParticipantName(team.name, displayContext);
  const isPlaceholder =
    displayName.startsWith("Pemenang ") ||
    displayName.startsWith("Kalah ") ||
    displayName.startsWith("Slot ") ||
    displayName.startsWith("Pairing ") ||
    displayName.startsWith("Juara Grup ") ||
    displayName.startsWith("Runner-up Grup ") ||
    displayName === "BYE";
  return `
    <div class="team-row ${isWinner ? "winner" : ""} ${isPlaceholder ? "placeholder" : ""}">
      <span class="team-seed">${escapeHtml(String(displayNumber))}</span>
      <span class="team-name">${escapeHtml(displayName)}</span>
      <span class="team-score">${team.score ?? "-"}</span>
    </div>
  `;
}

async function loadSession() {
  const session = await api("/api/session");
  state.isAdmin = session.authenticated;
  state.username = session.username;
}

async function loadTournaments() {
  const data = await api("/api/tournaments");
  state.tournaments = data.tournaments || [];
  if (!state.selectedId || !state.tournaments.some((item) => item.id === state.selectedId)) {
    state.selectedId = state.tournaments[0]?.id || null;
  }
}

function openDialog(dialog) {
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function closeDialog(dialog) {
  dialog.close();
}

function openTournamentForm(tournament = null) {
  els.tournamentError.textContent = "";
  els.tournamentForm.reset();
  els.tournamentIdInput.value = tournament?.id || "";
  els.tournamentDialogTitle.textContent = tournament ? "Edit Turnamen" : "Tambah Turnamen";
  els.tournamentDialogHint.textContent = tournament
    ? "Perbarui info turnamen atau pilih ulang tampilan bracket."
    : "Pilih tampilan dan ukuran bracket awal.";
  els.regenerateRow.style.display = tournament ? "grid" : "none";
  els.regenerateInput.checked = !tournament;
  els.tournamentNameInput.value = tournament?.name || "";
  els.gameInput.value = tournament?.game || "";
  els.startDateInput.value = tournament?.startDate || "";
  els.statusInput.value = tournament?.status || "draft";
  els.venueInput.value = tournament?.venue || "";
  els.bracketFormatInput.value = getBracketFormat(tournament);
  els.bracketSizeInput.value = String(tournament?.slotCount || getTeamsCount(tournament) || 8);
  els.bracketThemeInput.value = getBracketTheme(tournament);
  updateThemeSelection();
  openDialog(els.tournamentDialog);
}

function findMatchById(matchId) {
  const tournament = getSelectedTournament();
  for (const round of tournament?.rounds || []) {
    const match = round.matches.find((item) => item.id === matchId);
    if (match) return { round, match };
  }
  return null;
}

function openMatchForm(matchId) {
  const found = findMatchById(matchId);
  if (!found) return;

  state.activeMatch = found.match;
  els.matchError.textContent = "";
  els.matchForm.reset();
  els.matchIdInput.value = found.match.id;
  els.matchDialogTitle.textContent = `${found.match.code} - ${found.round.name}`;
  els.matchDialogHint.textContent = `${found.match.home.name} vs ${found.match.away.name}`;
  els.homeNameInput.value = found.match.home.name || "";
  els.homeScoreInput.value = found.match.home.score ?? "";
  els.awayNameInput.value = found.match.away.name || "";
  els.awayScoreInput.value = found.match.away.score ?? "";
  els.scheduledAtInput.value = found.match.scheduledAt || "";
  els.matchStatusInput.value = found.match.status || "scheduled";
  els.winnerInput.value = found.match.winner || "";
  els.noteInput.value = found.match.note || "";
  openDialog(els.matchDialog);
}

async function refresh() {
  await loadTournaments();
  render();
}

async function submitLogin(event) {
  event.preventDefault();
  els.loginError.textContent = "";

  try {
    const session = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: els.usernameInput.value,
        password: els.passwordInput.value
      })
    });
    state.isAdmin = session.authenticated;
    state.username = session.username;
    els.passwordInput.value = "";
    closeDialog(els.loginDialog);
    render();
  } catch (error) {
    els.loginError.textContent = error.message;
  }
}

async function logout() {
  await api("/api/logout", { method: "POST", body: "{}" });
  state.isAdmin = false;
  state.username = null;
  render();
}

async function submitTournament(event) {
  event.preventDefault();
  els.tournamentError.textContent = "";

  const tournamentId = els.tournamentIdInput.value;
  const regenerate = !tournamentId || els.regenerateInput.checked;
  const body = {
    name: els.tournamentNameInput.value,
    game: els.gameInput.value,
    startDate: els.startDateInput.value,
    status: els.statusInput.value,
    venue: els.venueInput.value,
    bracketFormat: els.bracketFormatInput.value,
    slotCount: Number(els.bracketSizeInput.value),
    bracketTheme: els.bracketThemeInput.value,
    regenerate,
    shuffleTeams: false
  };

  try {
    if (tournamentId) {
      await api(`/api/tournaments/${encodeURIComponent(tournamentId)}`, {
        method: "PUT",
        body: JSON.stringify(body)
      });
    } else {
      const created = await api("/api/tournaments", {
        method: "POST",
        body: JSON.stringify(body)
      });
      state.selectedId = created.id;
    }

    closeDialog(els.tournamentDialog);
    await refresh();
  } catch (error) {
    els.tournamentError.textContent = error.message;
  }
}

async function submitMatch(event) {
  event.preventDefault();
  els.matchError.textContent = "";

  try {
    await saveMatch({
      homeName: els.homeNameInput.value,
      homeScore: els.homeScoreInput.value,
      awayName: els.awayNameInput.value,
      awayScore: els.awayScoreInput.value,
      scheduledAt: els.scheduledAtInput.value,
      status: els.matchStatusInput.value,
      winner: els.winnerInput.value,
      note: els.noteInput.value
    });
    closeDialog(els.matchDialog);
  } catch (error) {
    els.matchError.textContent = error.message;
  }
}

async function saveMatch(body) {
  const tournament = getSelectedTournament();
  const matchId = els.matchIdInput.value;
  const updated = await api(
    `/api/tournaments/${encodeURIComponent(tournament.id)}/matches/${encodeURIComponent(matchId)}`,
    {
      method: "PUT",
      body: JSON.stringify(body)
    }
  );
  const index = state.tournaments.findIndex((item) => item.id === updated.id);
  if (index >= 0) {
    state.tournaments[index] = updated;
  }
  render();
}

async function clearMatchResult() {
  try {
    await saveMatch({
      homeName: els.homeNameInput.value,
      homeScore: null,
      awayName: els.awayNameInput.value,
      awayScore: null,
      scheduledAt: els.scheduledAtInput.value,
      status: "scheduled",
      winner: null,
      note: els.noteInput.value
    });
    closeDialog(els.matchDialog);
  } catch (error) {
    els.matchError.textContent = error.message;
  }
}

async function deleteTournament(tournamentId) {
  const tournament = state.tournaments.find((item) => item.id === tournamentId);
  if (!tournament) return;

  const confirmed = window.confirm(`Hapus "${tournament.name}"?`);
  if (!confirmed) return;

  await api(`/api/tournaments/${encodeURIComponent(tournamentId)}`, {
    method: "DELETE",
    body: "{}"
  });
  await refresh();
}

async function shuffleTournamentTeams(tournamentId) {
  const tournament = state.tournaments.find((item) => item.id === tournamentId);
  if (!tournament) return;

  const confirmed = window.confirm(
    `Acak tim untuk "${tournament.name}"?\n\nBracket akan dibuat ulang dari peserta yang sama. Skor, pemenang, jadwal match, dan catatan match sebelumnya akan hilang.`
  );
  if (!confirmed) return;

  const updated = await api(`/api/tournaments/${encodeURIComponent(tournament.id)}`, {
    method: "PUT",
    body: JSON.stringify({
      name: tournament.name,
      game: tournament.game,
      venue: tournament.venue,
      startDate: tournament.startDate,
      status: tournament.status,
      teams: tournament.teams,
      slotCount: tournament.slotCount || getTeamsCount(tournament),
      bracketTheme: getBracketTheme(tournament),
      bracketFormat: getBracketFormat(tournament),
      regenerate: true,
      shuffleTeams: true
    })
  });

  const index = state.tournaments.findIndex((item) => item.id === updated.id);
  if (index >= 0) {
    state.tournaments[index] = updated;
  }
  state.selectedId = updated.id;
  render();
}

function updateThemeSelection() {
  document.querySelectorAll("[data-theme-option]").forEach((button) => {
    button.classList.toggle("active", button.dataset.themeOption === els.bracketThemeInput.value);
  });
}

function bindEvents() {
  els.loginButton.addEventListener("click", () => openDialog(els.loginDialog));
  els.addTournamentButton.addEventListener("click", () => openTournamentForm());
  els.logoutButton.addEventListener("click", logout);
  els.loginForm.addEventListener("submit", submitLogin);
  els.tournamentForm.addEventListener("submit", submitTournament);
  els.matchForm.addEventListener("submit", submitMatch);
  els.clearMatchButton.addEventListener("click", clearMatchResult);
  els.bracketThemeInput.addEventListener("change", updateThemeSelection);
  els.bracketFormatInput.addEventListener("change", () => {
    if (els.tournamentIdInput.value) {
      els.regenerateInput.checked = true;
    }
  });
  els.bracketSizeInput.addEventListener("change", () => {
    if (els.tournamentIdInput.value) {
      els.regenerateInput.checked = true;
    }
  });
  window.addEventListener("resize", () => window.requestAnimationFrame(drawBracketConnectors));

  document.addEventListener("click", (event) => {
    const closeTarget = event.target.closest("[data-close]");
    if (closeTarget) {
      closeDialog(document.getElementById(closeTarget.dataset.close));
      return;
    }

    const editTournament = event.target.closest("[data-edit-tournament]");
    if (editTournament) {
      event.stopPropagation();
      const tournament = state.tournaments.find((item) => item.id === editTournament.dataset.editTournament);
      openTournamentForm(tournament);
      return;
    }

    const deleteTournamentButton = event.target.closest("[data-delete-tournament]");
    if (deleteTournamentButton) {
      event.stopPropagation();
      deleteTournament(deleteTournamentButton.dataset.deleteTournament);
      return;
    }

    const tournamentCard = event.target.closest("[data-select-tournament]");
    if (tournamentCard) {
      state.selectedId = tournamentCard.dataset.selectTournament;
      render();
      return;
    }

    const editMatch = event.target.closest("[data-edit-match]");
    if (editMatch) {
      openMatchForm(editMatch.dataset.editMatch);
      return;
    }

    const shuffleTournament = event.target.closest("[data-shuffle-tournament]");
    if (shuffleTournament) {
      shuffleTournamentTeams(shuffleTournament.dataset.shuffleTournament);
      return;
    }

    const themeOption = event.target.closest("[data-theme-option]");
    if (themeOption) {
      els.bracketThemeInput.value = themeOption.dataset.themeOption;
      updateThemeSelection();
    }
  });
}

async function init() {
  bindEvents();
  await Promise.all([loadSession(), loadTournaments()]);
  render();
}

init().catch((error) => {
  els.bracketScroll.innerHTML = `
    <div class="empty-state">
      <div>
        <strong>Gagal memuat website</strong>
        <span>${escapeHtml(error.message)}</span>
      </div>
    </div>
  `;
});
