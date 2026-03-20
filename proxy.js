const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 3000;

const ESPN_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?limit=100&groups=50";

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
      homeScore: home.score ?? null,
      awayTeam: away.team?.displayName || away.team?.name || "",
      awayAbbr: away.team?.abbreviation || "",
      awayLogo: away.team?.logo || "",
      awayScore: away.score ?? null,
      status: gameStatus,
      clock: comp.status?.displayClock || "",
      period: comp.status?.period ? `Period ${comp.status.period}` : "",
      startTime: event.date,
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
      const raw = await fetchJSON(ESPN_URL);
      const games = cleanGames(raw);
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
