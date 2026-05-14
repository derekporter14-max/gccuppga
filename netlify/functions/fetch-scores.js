exports.handler = async function () {

  const sources = [
    {
      label: 'Fox Sports',
      type: 'html',
      url: 'https://www.foxsports.com/golf/leaderboard?tab=leaderboard'
    },
    {
      label: 'ESPN',
      type: 'json',
      url: 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard'
    }
  ];

  const diagnostics = [];

  for (const source of sources) {

    try {

      const response = await fetch(source.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': '*/*'
        }
      });

      const text = await response.text();

      diagnostics.push({
        source: source.label,
        status: response.status,
        bytes: text.length
      });

      if (!response.ok) continue;

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: true,
          source: source.label,
          type: source.type,
          payload: text,
          diagnostics
        })
      };

    } catch (err) {

      diagnostics.push({
        source: source.label,
        error: err.message
      });

    }
  }

  return {
    statusCode: 500,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      success: false,
      diagnostics
    })
  };
};