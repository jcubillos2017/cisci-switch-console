const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { Client } = require('ssh2');

const sessions = new Map();

function appDataDir() {
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function inventoryPath() {
  return path.join(appDataDir(), 'inventory.json');
}

function readInventory() {
  try {
    const raw = fs.readFileSync(inventoryPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : []
    };
  } catch (_error) {
    return { profiles: [] };
  }
}

function writeInventory(inventory) {
  fs.writeFileSync(inventoryPath(), JSON.stringify(inventory, null, 2), 'utf8');
  return inventory;
}

function normalizeProfile(profile) {
  const protocol = profile.protocol === 'telnet' ? 'telnet' : 'ssh';
  return {
    id: profile.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: String(profile.name || profile.host || 'Switch').trim(),
    model: String(profile.model || 'Catalyst 2960').trim(),
    site: String(profile.site || '').trim(),
    protocol,
    host: String(profile.host || '').trim(),
    port: Number(profile.port || (protocol === 'ssh' ? 22 : 23)),
    username: String(profile.username || '').trim(),
    password: String(profile.password || ''),
    sshTimeout: Number(profile.sshTimeout || 45000),
    legacyCiscoSsh: profile.legacyCiscoSsh === true,
    enableLog: profile.enableLog !== false,
    notes: String(profile.notes || '').trim(),
    updatedAt: new Date().toISOString()
  };
}

function sshAlgorithms(profile) {
  const base = {
    serverHostKey: ['ssh-rsa', 'rsa-sha2-256', 'rsa-sha2-512', 'ecdsa-sha2-nistp256', 'ssh-ed25519']
  };

  if (!profile.legacyCiscoSsh) return base;

  return {
    kex: {
      append: [
        'diffie-hellman-group-exchange-sha1',
        'diffie-hellman-group14-sha1',
        'diffie-hellman-group1-sha1'
      ]
    },
    cipher: {
      append: ['aes256-cbc', 'aes192-cbc', 'aes128-cbc', '3des-cbc']
    },
    hmac: {
      append: ['hmac-sha1-96', 'hmac-md5', 'hmac-md5-96']
    },
    serverHostKey: {
      append: ['ssh-rsa', 'ssh-dss']
    }
  };
}

function sshReadyTimeout(profile) {
  const timeout = Number(profile.sshTimeout || 45000);
  return Math.min(Math.max(timeout, 10000), 120000);
}

function readableSshError(error) {
  const message = error && error.message ? error.message : String(error || 'Error SSH');
  if (/handshake/i.test(message) && /timed out/i.test(message)) {
    return [
      'SSH no completo el handshake a tiempo.',
      'Revise que el puerto sea SSH, que el switch tenga SSH habilitado y pruebe aumentar el timeout o activar "Cisco legacy SSH".',
      `Detalle: ${message}`
    ].join(' ');
  }
  return message;
}

function parseImportedInventory(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (filePath.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(content);
    const profiles = Array.isArray(parsed) ? parsed : parsed.profiles;
    if (!Array.isArray(profiles)) throw new Error('JSON sin lista de perfiles');
    return profiles.map(normalizeProfile);
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => index > 0 || !line.toLowerCase().startsWith('name,'))
    .map((line) => {
      const [name, host, model, site, protocol, port, username, sshTimeout, legacyCiscoSsh, notes] = line
        .split(',')
        .map((part) => part.trim());
      return normalizeProfile({
        name,
        host,
        model,
        site,
        protocol,
        port,
        username,
        sshTimeout,
        legacyCiscoSsh: /^(true|si|yes|1)$/i.test(legacyCiscoSsh || ''),
        notes
      });
    });
}

function profileToCsv(profiles) {
  const escape = (value) => {
    const text = String(value || '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = profiles.map((profile) => [
    profile.name,
    profile.host,
    profile.model,
    profile.site,
    profile.protocol,
    profile.port,
    profile.username,
    profile.sshTimeout,
    profile.legacyCiscoSsh ? 'true' : 'false',
    profile.notes
  ].map(escape).join(','));
  return ['name,host,model,site,protocol,port,username,sshTimeout,legacyCiscoSsh,notes', ...rows].join('\n');
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    title: 'Cisco Switch Console',
    backgroundColor: '#0f1720',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function sendToWindow(window, channel, payload) {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(channel, payload);
}

function appendLog(session, chunk) {
  if (!session.logStream) return;
  session.logStream.write(chunk);
}

function closeSession(sessionId, reason = 'Sesion finalizada') {
  const session = sessions.get(sessionId);
  if (!session) return;

  if (session.stream) session.stream.end();
  if (session.conn) session.conn.end();
  if (session.socket) session.socket.end();
  if (session.logStream) session.logStream.end();
  sessions.delete(sessionId);

  const status = /^(Error|No se pudo)/i.test(reason) ? 'error' : 'closed';
  sendToWindow(session.window, 'session:status', {
    sessionId,
    status,
    message: reason
  });
}

function openLogFile(profileName) {
  const safeName = String(profileName || 'switch')
    .replace(/[^a-z0-9-_]+/gi, '_')
    .replace(/^_+|_+$/g, '') || 'switch';
  const logDir = path.join(app.getPath('documents'), 'Cisco Switch Console Logs');
  fs.mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return fs.createWriteStream(path.join(logDir, `${safeName}_${stamp}.log`), { flags: 'a' });
}

function backupDir(profileName) {
  const safeName = String(profileName || 'switch')
    .replace(/[^a-z0-9-_]+/gi, '_')
    .replace(/^_+|_+$/g, '') || 'switch';
  const dir = path.join(app.getPath('documents'), 'Cisco Switch Console Backups', safeName);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function captureCiscoCommand(profile, command) {
  return new Promise((resolve, reject) => {
    if (profile.protocol === 'telnet') {
      reject(new Error('El respaldo automatico esta disponible por SSH. Para Telnet use la terminal manual.'));
      return;
    }

    const conn = new Client();
    let output = '';
    let idleTimer = null;
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      conn.end();
      if (error) reject(error);
      else resolve(cleanCiscoOutput(output, command));
    };

    conn.on('ready', () => {
      conn.shell({ term: 'vt100', cols: 160, rows: 48 }, (err, stream) => {
        if (err) {
          finish(err);
          return;
        }

        stream.on('data', (data) => {
          output += data.toString('utf8');
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => finish(), 1800);
        });
        stream.stderr.on('data', (data) => {
          output += data.toString('utf8');
        });
        stream.on('close', () => finish());

        setTimeout(() => {
          stream.write('terminal length 0\n');
          setTimeout(() => stream.write(`${command}\n`), 350);
        }, 500);
      });
    });

    conn.on('error', finish);
    conn.connect({
      host: profile.host,
      port: Number(profile.port || 22),
      username: profile.username,
      password: profile.password,
      readyTimeout: sshReadyTimeout(profile),
      keepaliveInterval: 30000,
      tryKeyboard: true,
      strictVendor: false,
      algorithms: sshAlgorithms(profile)
    });
  });
}

function cleanCiscoOutput(output, command) {
  return output
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && trimmed !== 'terminal length 0' && trimmed !== command;
    })
    .join('\n')
    .trim();
}

ipcMain.handle('session:connect', async (event, profile) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const sessionId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const protocol = profile.protocol === 'telnet' ? 'telnet' : 'ssh';
  const port = Number(profile.port || (protocol === 'ssh' ? 22 : 23));
  const logStream = profile.enableLog ? openLogFile(profile.name || profile.host) : null;

  const session = {
    sessionId,
    protocol,
    window,
    logStream,
    cols: Number(profile.cols || 100),
    rows: Number(profile.rows || 32)
  };
  sessions.set(sessionId, session);

  sendToWindow(window, 'session:status', {
    sessionId,
    status: 'connecting',
    message: `Conectando a ${profile.host}:${port} por ${protocol.toUpperCase()}`
  });

  if (protocol === 'ssh') {
    return connectSsh(session, profile, port);
  }

  return connectTelnet(session, profile, port);
});

function connectSsh(session, profile, port) {
  return new Promise((resolve) => {
    const conn = new Client();
    let settled = false;
    session.conn = conn;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    conn.on('ready', () => {
      conn.shell({
        term: 'xterm-color',
        cols: session.cols,
        rows: session.rows
      }, (err, stream) => {
        if (err) {
          sendToWindow(session.window, 'session:status', {
            sessionId: session.sessionId,
            status: 'error',
            message: err.message
          });
          closeSession(session.sessionId, 'No se pudo abrir shell SSH');
          finish({ ok: false, sessionId: session.sessionId, error: readableSshError(err) });
          return;
        }

        session.stream = stream;
        stream.on('data', (data) => {
          const text = data.toString('utf8');
          appendLog(session, text);
          sendToWindow(session.window, 'session:data', {
            sessionId: session.sessionId,
            data: text
          });
        });
        stream.stderr.on('data', (data) => {
          sendToWindow(session.window, 'session:data', {
            sessionId: session.sessionId,
            data: data.toString('utf8')
          });
        });
        stream.on('close', () => closeSession(session.sessionId));

        sendToWindow(session.window, 'session:status', {
          sessionId: session.sessionId,
          status: 'connected',
          message: 'Conexion SSH establecida'
        });
        finish({ ok: true, sessionId: session.sessionId });
      });
    });

    conn.on('error', (err) => {
      const message = readableSshError(err);
      sendToWindow(session.window, 'session:status', {
        sessionId: session.sessionId,
        status: 'error',
        message
      });
      closeSession(session.sessionId, message);
      finish({ ok: false, sessionId: session.sessionId, error: message });
    });

    conn.connect({
      host: profile.host,
      port,
      username: profile.username,
      password: profile.password,
      readyTimeout: sshReadyTimeout(profile),
      keepaliveInterval: 30000,
      tryKeyboard: true,
      strictVendor: false,
      algorithms: sshAlgorithms(profile)
    });
  });
}

function connectTelnet(session, profile, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: profile.host, port }, () => {
      sendToWindow(session.window, 'session:status', {
        sessionId: session.sessionId,
        status: 'connected',
        message: 'Conexion Telnet establecida'
      });
      resolve({ ok: true, sessionId: session.sessionId });
    });

    session.socket = socket;
    socket.setKeepAlive(true, 30000);
    socket.on('data', (data) => {
      const clean = stripTelnetNegotiation(data);
      appendLog(session, clean);
      sendToWindow(session.window, 'session:data', {
        sessionId: session.sessionId,
        data: clean
      });
    });
    socket.on('error', (err) => {
      sendToWindow(session.window, 'session:status', {
        sessionId: session.sessionId,
        status: 'error',
        message: err.message
      });
      closeSession(session.sessionId, 'Error Telnet');
      resolve({ ok: false, sessionId: session.sessionId, error: err.message });
    });
    socket.on('close', () => closeSession(session.sessionId));
  });
}

function stripTelnetNegotiation(buffer) {
  const output = [];
  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (byte === 255) {
      index += 2;
      continue;
    }
    output.push(byte);
  }
  return Buffer.from(output).toString('utf8');
}

ipcMain.handle('session:write', async (_event, { sessionId, data }) => {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: 'Sesion no encontrada' };
  appendLog(session, data);
  if (session.stream) session.stream.write(data);
  if (session.socket) session.socket.write(data);
  return { ok: true };
});

ipcMain.handle('session:resize', async (_event, { sessionId, cols, rows }) => {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false };
  session.cols = cols;
  session.rows = rows;
  if (session.stream && typeof session.stream.setWindow === 'function') {
    session.stream.setWindow(rows, cols, 0, 0);
  }
  return { ok: true };
});

ipcMain.handle('session:disconnect', async (_event, sessionId) => {
  closeSession(sessionId, 'Desconectado por el usuario');
  return { ok: true };
});

ipcMain.handle('dialog:save-config', async (_event, { defaultPath, content }) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultPath || 'cisco-config.txt',
    filters: [{ name: 'Texto', extensions: ['txt', 'cfg'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false };
  fs.writeFileSync(result.filePath, content, 'utf8');
  return { ok: true, filePath: result.filePath };
});

ipcMain.handle('inventory:load', async () => readInventory());

ipcMain.handle('inventory:save-profile', async (_event, profile) => {
  const inventory = readInventory();
  const normalized = normalizeProfile(profile);
  const index = inventory.profiles.findIndex((item) => item.id === normalized.id);
  if (index >= 0) inventory.profiles[index] = normalized;
  else inventory.profiles.push(normalized);
  writeInventory(inventory);
  return { ok: true, profile: normalized, inventory };
});

ipcMain.handle('inventory:delete-profile', async (_event, profileId) => {
  const inventory = readInventory();
  inventory.profiles = inventory.profiles.filter((profile) => profile.id !== profileId);
  writeInventory(inventory);
  return { ok: true, inventory };
});

ipcMain.handle('inventory:import', async () => {
  const result = await dialog.showOpenDialog({
    filters: [
      { name: 'Inventario', extensions: ['json', 'csv'] }
    ],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };

  const imported = parseImportedInventory(result.filePaths[0]);
  const inventory = readInventory();
  const byHost = new Map(inventory.profiles.map((profile) => [profile.host, profile]));
  imported.forEach((profile) => {
    const existing = byHost.get(profile.host);
    if (existing) {
      byHost.set(profile.host, { ...existing, ...profile, id: existing.id, updatedAt: new Date().toISOString() });
    } else {
      byHost.set(profile.host, profile);
    }
  });
  inventory.profiles = Array.from(byHost.values());
  writeInventory(inventory);
  return { ok: true, imported: imported.length, inventory };
});

ipcMain.handle('inventory:export', async (_event, { format }) => {
  const inventory = readInventory();
  const isCsv = format === 'csv';
  const result = await dialog.showSaveDialog({
    defaultPath: isCsv ? 'switch-inventory.csv' : 'switch-inventory.json',
    filters: [{ name: isCsv ? 'CSV' : 'JSON', extensions: [isCsv ? 'csv' : 'json'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false };

  const content = isCsv ? profileToCsv(inventory.profiles) : JSON.stringify(inventory, null, 2);
  fs.writeFileSync(result.filePath, content, 'utf8');
  return { ok: true, filePath: result.filePath };
});

ipcMain.handle('backup:profile', async (_event, profile) => {
  const normalized = normalizeProfile(profile);
  const dir = backupDir(normalized.name || normalized.host);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const running = await captureCiscoCommand(normalized, 'show running-config');
  const startup = await captureCiscoCommand(normalized, 'show startup-config');
  const runningPath = path.join(dir, `${stamp}_running-config.cfg`);
  const startupPath = path.join(dir, `${stamp}_startup-config.cfg`);
  fs.writeFileSync(runningPath, running, 'utf8');
  fs.writeFileSync(startupPath, startup, 'utf8');
  return {
    ok: true,
    running,
    startup,
    runningPath,
    startupPath
  };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  for (const sessionId of sessions.keys()) closeSession(sessionId);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
