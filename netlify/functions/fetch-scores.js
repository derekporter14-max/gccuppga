exports.handler = async function () {
  const url = `https://www.pgatour.com/leaderboard?_=${Date.now()}`;

  function normalizeName(name) {
    return String(name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseScore(value) {
    const s = String(value || '').trim();
    if (!s || s === '-' || s === '--') return null;
    if (/^e$/i.test(s)) return 0;
    if (!/^[+-]?\d+$/.test(s)) return null;
    return Number(s);
  }

  function htmlToLines(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
  }

  const POOL_PLAYERS = [
    'Cameron Young','Justin Rose','Rickie Fowler','Kurt Kitayama','Keegan Bradley','Sahith Theegala',
    'Scottie Scheffler','Russell Henley','Jason Day','Kristoffer Reitan','Brooks Koepka','Corey Conners',
    'Tyrrell Hatton','Sepp Straka','Max Homa','Sam Burns','JJ Spaun','Wyndham Clark','Adam Scott',
    'Akshay Bhatia','Aaron Rai','Shane Lowry','Harris English','Brian Harman','Patrick Cantlay',
    'Min Woo Lee','Alex Smalley','Hideki Matsuyama'
  ];

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Netlify-Function/1.0)',
        'Accept': 'text/html',
        'Cache-Control': 'no-cache, no-store',
        'Pragma': 'no-cache',
      },
    });

    const html = await res.text();

    const diagnostics = [{
      source: 'PGA TOUR official leaderboard',
      status: res.status,
      bytes: html.length,
      preview: html.slice(0, 150).replace(/\s+/g, ' '),
    }];

    if (!res.ok) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: `PGA TOUR HTTP ${res.status}`, diagnostics, players: [] }),
      };
    }

    const lines = htmlToLines(html);
    const players = [];

    for (const playerName of POOL_PLAYERS) {
      const idx = lines.findIndex(line => normalizeName(line) === normalizeName(playerName));

      let score = null;
      let thru = '--';
      let available = false;

      if (idx !== -1) {
        const nearby = lines.slice(idx + 1, idx + 10);

        for (const item of nearby) {
          const cleaned = item.trim();

          // Do not accidentally read tee times as scores.
          if (/\bAM\b|\bPM\b|:/.test(cleaned)) continue;

          const parsed = parseScore(cleaned);
          if (parsed !== null) {
            score = parsed;
            available = true;
            break;
          }

          if (/^E$/i.test(cleaned)) {
            score = 0;
            available = true;
            break;
          }
        }

        for (const item of nearby) {
          const cleaned = item.trim();
          if (/^F$/i.test(cleaned)) {
            thru = 'F';
            break;
          }
          if (/^\d+$/.test(cleaned) && Number(cleaned) <= 18) {
            thru = cleaned;
            break;
          }
        }
      }

      players.push({
        key: normalizeName(playerName),
        name: playerName,
        displayName: playerName,
        score,
        totalScore: score,
        rawScore: score,
        thru,
        cut: false,
        wd: false,
        available,
        aliases: [normalizeName(playerName)],
      });
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      body: JSON.stringify({
        success: true,
        source: 'PGA TOUR official leaderboard',
        event: 'PGA Championship',
        round: 1,
        isLive: players.some(p => p.available),
        updatedAt: new Date().toISOString(),
        players,
        diagnostics: diagnostics.concat([{
          lines: lines.length,
          poolPlayersReturned: players.length,
          availableScores: players.filter(p => p.available).length,
        }]),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: false,
        error: err.message,
        players: [],
        diagnostics: [{ source: 'PGA TOUR official leaderboard', error: err.message }],
      }),
    };
  }
};
