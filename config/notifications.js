const https = require('https');

// Send push notifications via Expo Push API
// tokens: array of Expo push token strings
// Returns the Expo API response
async function sendExpoNotifications(tokens, title, body, data = {}) {
  if (!tokens || tokens.length === 0) return;

  const messages = tokens.map(to => ({ to, title, body, data, sound: 'default' }));

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(messages);
    const req = https.request(
      {
        hostname: 'exp.host',
        path: '/--/api/v2/push/send',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Accept: 'application/json',
        },
      },
      res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve(JSON.parse(data)));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// The push tokens of users who haven't turned this kind of notification off.
// rows need expo_push_token and notification_prefs; a missing preference counts
// as on, so users created before preferences existed keep getting everything.
function tokensForPref(rows, key) {
  return rows
    .filter(r => r.expo_push_token && (r.notification_prefs?.[key] ?? true) !== false)
    .map(r => r.expo_push_token);
}

// Fire-and-forget: a failed push must never fail the request that caused it.
function notify(rows, key, title, body, data = {}) {
  const tokens = tokensForPref(rows, key);
  if (tokens.length === 0) return;
  sendExpoNotifications(tokens, title, body, data).catch(err =>
    console.warn(`Push (${key}) failed:`, err?.message || err)
  );
}

module.exports = { sendExpoNotifications, tokensForPref, notify };
