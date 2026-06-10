const express = require('express');
const { execFile } = require('child_process');
const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const TOOLS = {
  jupyter: { container: 'omnibioai-jupyter', port: 8888 },
  rstudio: { container: 'omnibioai-rstudio', port: 8787 },
  vscode:  { container: 'omnibioai-vscode',  port: 8083 },
};

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

app.get('/api/launcher/status/:tool', async (req, res) => {
  const tool = TOOLS[req.params.tool];
  if (!tool) return res.status(400).json({ error: 'unknown tool' });
  try {
    const status = await run('docker', ['inspect', tool.container,
      '--format', '{{.State.Status}}']);
    res.json({ status });
  } catch {
    res.json({ status: 'stopped' });
  }
});

app.post('/api/launcher/start/:tool', async (req, res) => {
  const tool = TOOLS[req.params.tool];
  if (!tool) return res.status(400).json({ error: 'unknown tool' });
  try {
    await run('docker', ['start', tool.container]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/launcher/stop/:tool', async (req, res) => {
  const tool = TOOLS[req.params.tool];
  if (!tool) return res.status(400).json({ error: 'unknown tool' });
  try {
    await run('docker', ['stop', tool.container]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(3001, () => console.log('launcher api listening on 3001'));
