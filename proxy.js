const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 3000;

const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?limit=100&groups=50";

function dateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error("JSON parse error: " + e.message));
          }
        });
      })
      .on("error", reject);
  });
}

function cleanGames(raw) {
  const events = raw?.events || [];
  return events.map((event) => {
    const comp = event.competitions?.[0] || {};
    const competitors = comp.competitors || [];
    const home = competitors.find((c) => c.homeAway === "home") || {};
    const away = competitors.find((c) => c.homeAway === "away") || {};
    const status = comp.status?.type;

    let gameStatus = "pre";
    if (status?.completed) gameStatus = "final";
    else if (status?.state === "in") gameStatus = "in";

    return {
      id: event.id,
      name: event.name,
      shortName: event.shortName,
      homeTeam: home.team?.displayName || home.team?.name || "",
      homeAbbr: home.team?.abbreviation || "",
      homeLogo: home.team?.logo || "",
      homeSeed: home.curatedRank?.current || home.seed || null,
      homeScore: home.score ?? null,
      awayTeam: away.team?.displayName || away.team?.name || "",
      awayAbbr: away.team?.abbreviation || "",
      awayLogo: away.team?.logo || "",
      awaySeed: away.curatedRank?.current || away.seed || null,
      awayScore: away.score ?? null,
      status: gameStatus,
      clock: comp.status?.displayClock || "",
      period: comp.status?.period ? `Period ${comp.status.period}` : "",
      startTime: event.date,
      venue: comp.venue?.fullName || "",
      venueCity: [comp.venue?.address?.city, comp.venue?.address?.state].filter(Boolean).join(", "),
      tv: (comp.broadcasts || []).flatMap(b => b.names || []).join(", "),
      // Odds — prefer DraftKings, fall back to first provider
      odds: (() => {
        const allOdds = comp.odds || [];
        const dk = allOdds.find(o => (o.provider?.name || "").toLowerCase().includes("draft")) || allOdds[0];
        if (!dk) return null;
        const homeML = dk.homeTeamOdds?.moneyLine
          ?? dk.moneyline?.home?.close?.american
          ?? dk.moneyline?.home?.close
          ?? null;
        const awayML = dk.awayTeamOdds?.moneyLine
          ?? dk.moneyline?.away?.close?.american
          ?? dk.moneyline?.away?.close
          ?? null;
        return {
          provider: dk.provider?.name || "ESPN BET",
          homeML: homeML != null ? String(homeML) : null,
          awayML: awayML != null ? String(awayML) : null,
          spread: dk.details || (dk.spread != null ? String(dk.spread) : null),
          overUnder: dk.overUnder ?? null,
        };
      })(),
      // Win probability — nested inside situation.lastPlay.probability
      winProb: (() => {
        const prob = comp.situation?.lastPlay?.probability ?? comp.situation?.probability;
        if (!prob) return null;
        const h = prob.homeWinPercentage;
        if (h == null) return null;
        return { home: Math.round(h * 100), away: Math.round((prob.awayWinPercentage ?? (1 - h)) * 100) };
      })(),
    };
  });
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const server = http.createServer(async (req, res) => {
  // Handle preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/health") {
    res.writeHead(200, CORS_HEADERS);
    res.end(JSON.stringify({ status: "ok", ts: new Date().toISOString() }));
    return;
  }

  if (url.pathname === "/scores") {
    try {
      const results = await Promise.allSettled([
        fetchJSON(`${ESPN_BASE}&dates=${dateStr(-1)}`),
        fetchJSON(`${ESPN_BASE}&dates=${dateStr(0)}`),
        fetchJSON(`${ESPN_BASE}&dates=${dateStr(1)}`),
      ]);
      const seen = new Set();
      const events = results
        .filter(r => r.status === "fulfilled")
        .flatMap(r => r.value.events || [])
        .filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });
      const games = cleanGames({ events });
      res.writeHead(200, CORS_HEADERS);
      res.end(JSON.stringify(games));
    } catch (err) {
      console.error("ESPN fetch error:", err.message);
      res.writeHead(502, CORS_HEADERS);
      res.end(JSON.stringify({ error: "Failed to fetch scores", detail: err.message }));
    }
    return;
  }

  res.writeHead(404, CORS_HEADERS);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`Proxy server listening on port ${PORT}`);
});
