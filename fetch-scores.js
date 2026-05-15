exports.handler = async function () {
  const ts = Date.now();

  const sources = [
    {
      label: 'ESPN PGA Championship',
      url: `https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?tournamentId=401811947&_=${ts}`,
    },
    {
      label: 'ESPN Active Event',
      url: `https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?_=${ts}`,
    },
  ];

  const diagnostics = [];

  function normalizeName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseScore(value) {
    if (value == null) return null;

    const s = String(value).trim();

    if (!s || s === '--' || s === '-') return null;
    if (/^(E|EVEN)$/i.test(s)) return 0;
    if (/^(WD|DQ|CUT|MDF|DNS)$/i.test(s)) return null;

    const match = s.match(/[+-]?\d+/);
    if (!match) return null;

    return Number(match[0]);
  }

  function getStat(competitor, names) {
    const stats = competitor.statistics || [];

    for (const stat of stats) {
      const statName = String(stat.name || '').toLowerCase();
      const statLabel = String(stat.label || '').toLowerCase();

      if (names.some(n => statName === n || statLabel === n)) {
        return stat.displayValue ?? stat.value ?? null;
      }
    }

    return null;
  }

  function parseESPN(data, sourceLabel) {
    const events = data.events || [];
    const event =
      events.find(e => /pga championship/i.test(e.name || '')) ||
      events[0];

    if (!event) {
      return null;
    }

    const competition = event.competitions && event.competitions[0];
    const competitors = competition ? competition.competitors || [] : [];

    if (!competitors.length) {
      return null;
    }

    const round =
      event.status && event.status.period
        ? Number(event.status.period)
        : null;

    const players = competitors
      .map(c => {
        const athlete = c.athlete || {};
        const name = athlete.displayName || athlete.shortName || '';

        if (!name) return null;

        const statusType = c.status && c.status.type ? c.status.type : {};
        const statusName = String(statusType.name || '');
        const statusDescription = String(statusType.description || '');
        const statusDetail = String(statusType.detail || '');
        const shortDetail = String(statusType.shortDetail || '');

        const rawTotal =
          getStat(c, ['topar', 'to par', 'score']) ??
          c.score?.displayValue ??
          c.score ??
          null;

        let totalScore = parseScore(rawTotal);

        const isCut = /cut|missed/i.test(
          `${statusName} ${statusDescription} ${statusDetail} ${shortDetail}`
        );

        const isWD = /withdraw|wd|dq|disqualified/i.test(
          `${statusName} ${statusDescription} ${statusDetail} ${shortDetail}`
        );

        let thru = shortDetail || statusDetail || '';

        const thruMatch = thru.match(/(?:thru\s*)?(\d+)$/i);
        if (thruMatch) thru = thruMatch[1];

        if (/final|finished|complete|^f$/i.test(thru)) {
          thru = 'F';
        }

        if (!thru || /not started/i.test(thru)) {
          thru = '--';
        }

        let adjustedScore = totalScore;

        // Pool rule: missed cut gets +5 Saturday and +5 Sunday.
        // Only apply when the tournament has reached those rounds.
        if (adjustedScore !== null && (isCut || isWD)) {
          if (round >= 3) adjustedScore += 5;
          if (round >= 4) adjustedScore += 5;
        }

        const key = normalizeName(name);

        return {
          key,
          name,
          displayName: name,
          totalScore,
          score: adjustedScore,
          rawScore: rawTotal,
          thru,
          cut: isCut,
          wd: isWD,
          available: totalScore !== null,
          aliases: [
            key,
            normalizeName(athlete.shortName),
            normalizeName(athlete.displayName),
            normalizeName(athlete.fullName),
          ].filter(Boolean),
        };
      })
      .filter(Boolean);

    return {
      success: true,
      source: sourceLabel,
      event: event.name || 'Unknown event',
      round,
      isLive: players.length > 0,
      updatedAt: new Date().toISOString(),
      players,
    };
  }

  for (const src of sources) {
    try {
      const res = await fetch(src.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Netlify-Function/1.0)',
          Accept: 'application/json',
          'Cache-Control': 'no-cache, no-store',
          Pragma: 'no-cache',
        },
      });

      const text = await res.text();

      const diagnostic = {
        source: src.label,
        status: res.status,
        bytes: text.length,
        preview: text.slice(0, 150).replace(/\s+/g, ' '),
      };

      diagnostics.push(diagnostic);

      if (!res.ok) {
        diagnostic.error = `HTTP ${res.status}`;
        continue;
      }

      let parsed;

      try {
        parsed = JSON.parse(text);
      } catch (err) {
        diagnostic.error = 'Invalid JSON';
        continue;
      }

      const normalized = parseESPN(parsed, src.label);

      if (!normalized || !normalized.players.length) {
        diagnostic.error = 'No normalized players found';
        continue;
      }

      diagnostic.event = normalized.event;
      diagnostic.round = normalized.round;
      diagnostic.players = normalized.players.length;

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        body: JSON.stringify({
          ...normalized,
          diagnostics,

          // Backward compatibility for your current index.html.
          // Your current front end still parses wrapped.payload itself.
          type: 'json',
          payload: text,
        }),
      };
    } catch (err) {
      diagnostics.push({
        source: src.label,
        error: err.message,
      });
    }
  }

  return {
    statusCode: 500,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
    body: JSON.stringify({
      success: false,
      error: 'All scoring sources failed',
      diagnostics,
      players: [],
    }),
  };
};
