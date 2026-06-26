import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { parse } from 'url';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'child_process';
import { Readable } from 'stream';
import next from 'next';

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);
const pythonApiPort = parseInt(process.env.PYTHON_API_PORT || String(port + 1), 10);
const pythonHost = process.env.PYTHON_API_HOST || '127.0.0.1';
const pythonApiUrl = `http://${pythonHost}:${pythonApiPort}`;

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
let pythonProcess: ChildProcessWithoutNullStreams | null = null;

function startPythonBackend() {
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  pythonProcess = spawn(
    pythonCmd,
    ['-m', 'uvicorn', 'backend.app:app', '--host', pythonHost, '--port', String(pythonApiPort)],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      shell: process.platform === 'win32',
    }
  );

  pythonProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[python-api] ${chunk}`);
  });
  pythonProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[python-api] ${chunk}`);
  });
  pythonProcess.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM') {
      console.error(`[python-api] exited with code=${code} signal=${signal}`);
    }
  });
}

function stopPythonBackend() {
  if (pythonProcess && !pythonProcess.killed) {
    if (process.platform === 'win32') {
      // On Windows, kill the process tree via taskkill (sync
      // so it completes before Node exits)
      try {
        spawnSync('taskkill', ['/pid', String(pythonProcess.pid), '/T', '/F'], {
          stdio: 'ignore',
        });
      } catch {
        pythonProcess.kill();
      }
    } else {
      pythonProcess.kill('SIGTERM');
    }
  }
}

async function proxyToPython(req: IncomingMessage, res: ServerResponse) {
  const target = `${pythonApiUrl}${req.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    if (Array.isArray(value)) headers.set(key, value.join(', '));
    else headers.set(key, value);
  }
  headers.set('host', `${pythonHost}:${pythonApiPort}`);

  const response = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req),
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

app.prepare().then(() => {
  startPythonBackend();
  const server = createServer(async (req, res) => {
    try {
      if (req.url?.startsWith('/api/dataset/')) {
        await proxyToPython(req, res);
        return;
      }
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      }`,
    );
    console.log(`> Python dataset API proxied from ${pythonApiUrl}`);
  });
});

process.on('SIGINT', () => {
  stopPythonBackend();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopPythonBackend();
  process.exit(0);
});
// Fallback: exit fires reliably on all platforms, including
// Windows when SIGINT is not delivered to the handler.
process.on('exit', () => {
  stopPythonBackend();
});
