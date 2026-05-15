exports.handler = async function () {

  // ESPN public golf API — always returns the current active tournament,
  // proper JSON, no HTML scraping, no CDN caching issues.
  // Tournament ID 401811947 = 2026 PGA Championship (confirmed from ESPN URL).
  // We try with the specific ID first, then fall back to the generic leaderboard
  // which always serves the active event.
  const ts = Date.now(); // prevent any intermediate caching

  const sources = [
    {
      label: 'ESPN (PGA Championship)',
      url: `https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?tournamentId=401811947&_=${ts}`,
    },
    {
      label: 'ESPN (active event)',
      url: `https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?_=${ts}`,
    },
  ];

  const diagnostics = [];

  for (const src of sources) {
    try {
      const res = await fetch(src.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Netlify-Function/1.0)',
          'Accept': 'application/json',
          'Cache-Control': 'no-cache, no-store',
          'Pragma': 'no-cache',
        },
        cache: 'no-store',
      });

      const text = await res.text();

      diagnostics.push({
        source: src.label,
        status: res.status,
        bytes: text.length,
        preview: text.slice(0, 150).replace(/\s+/g, ' '),
      });

      if (!res.ok) {
        diagnostics[diagnostics.length - 1].error = `HTTP ${res.status}`;
        continue;
      }

      // Quick sanity check — must be valid JSON with events
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        diagnostics[diagnostics.length - 1].error = 'Invalid JSON';
        continue;
      }

      const events = parsed.events || [];
      const competitors = events.length > 0
        && events[0].competitions
        && events[0].competitions[0]
        && events[0].competitions[0].competitors;

      if (!competitors || competitors.length === 0) {
        diagnostics[diagnostics.length - 1].error = 'No competitors in response';
        continue;
      }

      diagnostics[diagnostics.length - 1].competitors = competitors.length;
      diagnostics[diagnostics.length - 1].event = events[0].name;

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        body: JSON.stringify({
          success: true,
          source: src.label,
          type: 'json',
          payload: text,
          diagnostics,
        }),
      };

    } catch (err) {
      diagnostics.push({ source: src.label, error: err.message });
    }
  }

  return {
    statusCode: 500,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
    body: JSON.stringify({ success: false, error: 'All sources failed', diagnostics }),
  };
};
