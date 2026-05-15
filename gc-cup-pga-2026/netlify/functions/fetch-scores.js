exports.handler = async function () {

  // Cache-bust every request so Netlify CDN never serves stale data
  const ts = Date.now();

  // SOURCE ORDER:
  // 1. ESPN JSON — always returns the current active PGA Tour event,
  //    no event-ID guessing, works reliably from Netlify server IPs.
  // 2. Fox Sports specific PGA URL — event ID 4799 confirmed from Fox search results.
  //    Falls back to this if ESPN is down.
  // 3. Fox generic redirect — only useful during the active tournament week;
  //    after the event ends Fox redirects to the next event, so we validate
  //    it's actually the PGA Championship before returning it.
  const sources = [
    {
      label: 'ESPN',
      type:  'json',
      url:   `https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?_=${ts}`,
    },
    {
      label: 'Fox Sports (PGA specific)',
      type:  'html',
      url:   `https://www.foxsports.com/golf/pga-championship-pga-tour-may-14-2026-leaderboard-4799?tab=leaderboard&_=${ts}`,
    },
    {
      label: 'Fox Sports (generic redirect)',
      type:  'html',
      url:   `https://www.foxsports.com/golf/leaderboard?tab=leaderboard&_=${ts}`,
    },
  ];

  const diagnostics = [];

  for (const source of sources) {
    try {
      const response = await fetch(source.url, {
        headers: {
          'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept':          'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control':   'no-cache, no-store',
          'Pragma':          'no-cache',
        },
        cache: 'no-store',
      });

      const text = await response.text();

      diagnostics.push({
        source:  source.label,
        status:  response.status,
        bytes:   text.length,
        preview: text.slice(0, 200).replace(/\s+/g, ' '),
      });

      if (!response.ok) {
        diagnostics[diagnostics.length - 1].error = `HTTP ${response.status}`;
        continue;
      }

      // For Fox HTML sources, verify we actually got PGA Championship data.
      // Fox generic URL redirects to whatever event is "current" — after the
      // PGA ends it will point at the next tournament. Reject non-PGA pages.
      if (source.type === 'html') {
        const isPGA = /pga.championship|aronimink/i.test(text);
        diagnostics[diagnostics.length - 1].isPGA = isPGA;

        // The specific-URL source has pga-championship in its URL — trust it
        // even if the body doesn't mention Aronimink (e.g. pre-tournament tee times).
        const urlIsPGA = /pga-championship/.test(source.url);

        if (!isPGA && !urlIsPGA) {
          diagnostics[diagnostics.length - 1].error = 'Rejected — Fox served wrong event';
          continue;
        }
      }

      // Return this payload to the frontend
      return {
        statusCode: 200,
        headers: {
          'Content-Type':                'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control':               'no-cache, no-store, must-revalidate',
        },
        body: JSON.stringify({
          success:     true,
          source:      source.label,
          type:        source.type,
          payload:     text,
          diagnostics,
        }),
      };

    } catch (err) {
      diagnostics.push({
        source: source.label,
        error:  err.message,
      });
    }
  }

  // All sources failed
  return {
    statusCode: 500,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               'no-cache, no-store, must-revalidate',
    },
    body: JSON.stringify({
      success:     false,
      error:       'All sources failed',
      diagnostics,
    }),
  };
};
