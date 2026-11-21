const express = require('express');

const app = express();
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

app.post('/cart/add', (request, response) => {
  response.json({ ok: true, items: 1 });
});

app.get('/report', async (request, response) => {
  await sleep(200 + Math.random() * 200);
  response.json({ rows: 20000 });
});

app.post('/pay', (request, response) => {
  if (Math.random() < 0.05) {
    return response.status(500).json({ error: 'gateway timeout' });
  }
  response.json({ paid: true });
});

app.listen(3000, '127.0.0.1', () => {
  console.log('API: http://127.0.0.1:3000');
});
