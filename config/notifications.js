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

module.exports = { sendExpoNotifications };
