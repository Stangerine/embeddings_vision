import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { parse } from 'url';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'child_process';
import { Readable } from 'stream';
import type { Socket } from 'net';
// Next does not type this internal entrypoint, but it is the same module
// `next dev` uses to mount the dev HMR websocket. The public
// `next().getUpgradeHandler()` resolves to NextServer.handleUpgrade, which is
// an empty no-op in this version, so the HMR socket never attaches and the
// browser falls back to full page reloads. router-server.initialize() returns
// an upgradeHandler that correctly routes /_next/webpack-hmr to the bundler.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { initialize } = require('next/dist/server/lib/router-server');

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);
const pythonApiPort = parseInt(process.env.PYTHON_API_PORT || String(port + 1), 10);
const pythonHost = process.env.PYTHON_API_HOST || '127.0.0.1';
const pythonApiUrl = `http://${pythonHost}:${pythonApiPort}`;

type NextHandlers = {
  requestHandler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  upgradeHandler: (req: IncomingMessage, socket: Socket, head: Buffer) => Promise<void>;
};

let pythonProcess: ChildProcessWithoutNullStreams | null = null;

function startPythonBackend() {
  // On Windows, spawn python directly (no shell) so we get the real PID.
  // shell:true made the stored PID point at cmd.exe instead of python.exe,
  // which broke taskkill. On Unix, python3 is standard.
  const pythonCmd = process.platform === 'win32' ? 'python.exe' : 'python3';
  pythonProcess = spawn(
    pythonCmd,
    ['-m', 'uvicorn', 'backend.app:app', '--host', pythonHost, '--port', String(pythonApiPort)],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      // No shell — direct spawn gives us the real python PID
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

async function main() {
  // Create our own http server so we keep full control over the Python proxy.
  // router-server.initialize() needs the server instance: in dev it attaches
  // the HMR bundler to it and returns an upgradeHandler that drives the
  // /_next/webpack-hmr websocket — the piece that next().getUpgradeHandler()
  // does not wire up in a custom server.
  const server = createServer(async (req, res) => {
    try {
      if (req.url?.startsWith('/api/dataset/')) {
        await proxyToPython(req, res);
        return;
      }
      await handlers.requestHandler(req, res);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });

  const handlers = (await initialize({
    dir: process.cwd(),
    port,
    hostname,
    dev,
    minimalMode: false,
    server,
    keepAliveTimeout: undefined,
    customServer: true,
  })) as NextHandlers;

  server.on('upgrade', (req, socket, head) => {
    void handlers.upgradeHandler(req, socket as Socket, head);
  });
  server.once('error', (err) => {
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
}

process.on('SIGINT', () => {
  stopPythonBackend();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopPythonBackend();
  process.exit(0);
});

// On Windows, tsx watch may forcefully kill this process before signal
// handlers fire. stdin closing is the most reliable "parent died" signal:
// when the terminal/tsx goes away, stdin emits 'end'. This works even
// when SIGINT/SIGTERM handlers are skipped.
process.stdin.on('end', () => {
  stopPythonBackend();
});

// Final safety net: kill anything already on the Python port.
// This runs on every start and catches orphans from previous crashed runs.
function killPort(port: number) {
  if (process.platform !== 'win32') return;
  try {
    spawnSync('cmd', ['/c', `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a`], {
      stdio: 'ignore',
      timeout: 3000,
    });
  } catch { /* best-effort */ }
}

// Clean up any orphan from a previous crashed session before starting
killPort(pythonApiPort);
startPythonBackend();

void main();
