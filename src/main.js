const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Client } = require('ssh2');
const { createSanitizedLog, renderLine } = require('./log-sanitizer');
const { TelnetClient } = require('./telnet-client');
const { RawClient, RloginClient } = require('./net-clients');
const { SerialClient, listSerialPorts } = require('./serial-client');

const PROTOCOLS = ['ssh', 'telnet', 'raw', 'rlogin', 'serial'];
const DEFAULT_PORTS = { ssh: 22, telnet: 23, rlogin: 513, raw: 0, serial: 0 };
const FLOW_CONTROLS = ['none', 'rtscts', 'xonxoff'];

function protocolOf(profile) {
  return PROTOCOLS.includes(profile.protocol) ? profile.protocol : 'ssh';
}

// Texto del destino para mensajes y logs: "host:puerto" o "COM3 @ 9600".
function targetLabel(profile, protocol, port) {
  if (protocol === 'serial') return `${profile.serialPath || profile.host} @ ${Number(profile.baudRate) || 9600}`;
  return `${profile.host}:${port}`;
}
const { create: createRunner } = require('./renderer/cisco-runner');

const sessions = new Map();

function appDataDir() {
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function inventoryPath() {
  return path.join(appDataDir(), 'inventory.json');
}

// Contrasenas de perfiles: cifradas con el almacen del sistema (DPAPI en Windows, Keychain en macOS).
function secureStorageStatus() {
  if (!safeStorage.isEncryptionAvailable()) {
    return { available: false, reason: 'El sistema no ofrece almacenamiento cifrado; las contrasenas no se guardan.' };
  }
  if (
    process.platform === 'linux'
    && typeof safeStorage.getSelectedStorageBackend === 'function'
    && safeStorage.getSelectedStorageBackend() === 'basic_text'
  ) {
    return { available: false, reason: 'Sin llavero del sistema (gnome-keyring/kwallet); las contrasenas no se guardan.' };
  }
  return { available: true, reason: '' };
}

function encryptSecret(text) {
  return safeStorage.encryptString(String(text)).toString('base64');
}

function decryptSecret(encoded) {
  try {
    return safeStorage.decryptString(Buffer.from(String(encoded), 'base64'));
  } catch (_error) {
    return '';
  }
}

function readInventory() {
  let inventory;
  try {
    const parsed = JSON.parse(fs.readFileSync(inventoryPath(), 'utf8'));
    inventory = { profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [] };
  } catch (_error) {
    return { profiles: [] };
  }

  // Migracion: versiones anteriores guardaban "password" en texto plano.
  let migrated = false;
  inventory.profiles = inventory.profiles.map((profile) => {
    if (!Object.prototype.hasOwnProperty.call(profile, 'password')) return profile;
    const { password, ...rest } = profile;
    migrated = true;
    if (password && secureStorageStatus().available) rest.passwordEnc = encryptSecret(password);
    return rest;
  });
  if (migrated) writeInventory(inventory);
  return inventory;
}

// Lo que ve el renderer: nunca la contrasena ni el cifrado, solo si existe.
function toPublicProfile(profile) {
  const { password: _password, passwordEnc, enableEnc, ...rest } = profile;
  return { ...rest, hasPassword: Boolean(passwordEnc), hasEnableSecret: Boolean(enableEnc) };
}

function publicInventory(inventory) {
  return {
    profiles: inventory.profiles.map(toPublicProfile),
    secureStorage: secureStorageStatus()
  };
}

function exportableProfile(profile) {
  const { password: _password, passwordEnc: _passwordEnc, enableEnc: _enableEnc, ...rest } = profile;
  return rest;
}

// Contrasena para conectar: la escrita en el formulario o la guardada del perfil (mismo host).
function resolveStoredSecret(profile, typed, field) {
  if (typed) return String(typed);
  if (!profile.id) return '';
  const stored = readInventory().profiles.find((item) => item.id === profile.id);
  if (!stored || !stored[field]) return '';
  if (String(stored.host || '').trim() !== String(profile.host || '').trim()) return '';
  return decryptSecret(stored[field]);
}

function resolvePassword(profile) {
  return resolveStoredSecret(profile, profile.password, 'passwordEnc');
}

function resolveEnableSecret(profile) {
  return resolveStoredSecret(profile, profile.enableSecret, 'enableEnc');
}

function writeInventory(inventory) {
  fs.writeFileSync(inventoryPath(), JSON.stringify(inventory, null, 2), 'utf8');
  return inventory;
}

function normalizeProfile(profile) {
  const protocol = protocolOf(profile);
  const serialPath = String(profile.serialPath || '').trim();
  // En serial el "host" es el puerto COM: identifica el perfil en inventario y pestanas.
  const host = protocol === 'serial' ? (serialPath || String(profile.host || '').trim()) : String(profile.host || '').trim();
  return {
    id: profile.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: String(profile.name || host || 'Switch').trim(),
    model: String(profile.model || 'Catalyst 2960').trim(),
    site: String(profile.site || '').trim(),
    protocol,
    host,
    port: Number(profile.port || DEFAULT_PORTS[protocol]) || 0,
    serialPath: protocol === 'serial' ? host : serialPath,
    baudRate: Number(profile.baudRate) || 9600,
    flowControl: FLOW_CONTROLS.includes(profile.flowControl) ? profile.flowControl : 'none',
    username: String(profile.username || '').trim(),
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
    // Exportaciones antiguas pueden traer "password" en texto plano: se cifra al importar.
    return profiles.map((profile) => ({
      ...normalizeProfile(profile),
      password: typeof profile.password === 'string' ? profile.password : ''
    }));
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => index > 0 || !line.toLowerCase().startsWith('name,'))
    .map((line) => {
      const [name, host, model, site, protocol, port, username, sshTimeout, legacyCiscoSsh, notes, serialPath, baudRate, flowControl] = line
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
        notes,
        serialPath,
        baudRate,
        flowControl
      });
    })
    .map((profile) => ({ ...profile, password: '' }));
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
    profile.notes,
    profile.serialPath,
    profile.protocol === 'serial' ? profile.baudRate : '',
    profile.protocol === 'serial' ? profile.flowControl : ''
  ].map(escape).join(','));
  return ['name,host,model,site,protocol,port,username,sshTimeout,legacyCiscoSsh,notes,serialPath,baudRate,flowControl', ...rows].join('\n');
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
  if (session.client) session.client.end();
  if (session.logStream) session.logStream.end();
  sessions.delete(sessionId);

  const status = /^(Error|No se pudo)/i.test(reason) ? 'error' : 'closed';
  sendToWindow(session.window, 'session:status', {
    sessionId,
    status,
    message: reason
  });
}

function openLogFile(profile, protocol, port) {
  const safeName = String(profile.name || profile.host || 'switch')
    .replace(/[^a-z0-9-_]+/gi, '_')
    .replace(/^_+|_+$/g, '') || 'switch';
  const logDir = path.join(app.getPath('documents'), 'Cisco Switch Console Logs');
  fs.mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = fs.createWriteStream(path.join(logDir, `${safeName}_${stamp}.log`), { flags: 'a' });
  file.write(`# Cisco Switch Console - ${targetLabel(profile, protocol, port)} ${protocol.toUpperCase()} - ${new Date().toISOString()}${os.EOL}`);
  file.write(`# Credenciales enmascaradas como <oculto>.${os.EOL}`);
  // Solo se registra lo que devuelve el equipo (incluye el eco de lo tecleado);
  // lo que se escribe no se registra para no capturar contrasenas sin eco.
  return createSanitizedLog(file);
}

function backupDir(profileName) {
  const safeName = String(profileName || 'switch')
    .replace(/[^a-z0-9-_]+/gi, '_')
    .replace(/^_+|_+$/g, '') || 'switch';
  const dir = path.join(app.getPath('documents'), 'Cisco Switch Console Backups', safeName);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// --- Respaldo por SSH: una conexion, enable si hace falta, prompt exacto y validacion del contenido.
const BACKUP_PROMPT_LINE = /^[A-Za-z0-9._\-]+(\([A-Za-z0-9._\-]+\))?[#>]\s*$/;

function openSshShell(profile) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      conn.end();
      reject(new Error(readableSshError(error)));
    };
    conn.on('ready', () => {
      conn.shell({ term: 'vt100', cols: 200, rows: 48 }, (err, stream) => {
        if (err) {
          fail(err);
          return;
        }
        settled = true;
        resolve({ conn, stream });
      });
    });
    conn.on('error', fail);
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

// Quita el eco del comando y el prompt final; reconstruye lineas (ANSI, backspace, --More--).
function cleanShowOutput(output, command) {
  const lines = String(output).split('\n').map(renderLine);
  const echo = lines.findIndex((line) => line.trim().endsWith(command));
  let start = echo === -1 ? 0 : echo + 1;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && (!lines[end - 1].trim() || BACKUP_PROMPT_LINE.test(lines[end - 1].trim()))) end -= 1;
  return lines.slice(start, end).join('\n');
}

function hasEndLine(config) {
  return /^end\s*$/m.test(config);
}

async function runBackup(profile, enableSecret, progress) {
  const { conn, stream } = await openSshShell(profile);
  const listeners = new Set();
  const dispatch = (data) => {
    const text = data.toString('utf8');
    listeners.forEach((listener) => listener(text));
  };
  let closed = false;
  const runner = createRunner({
    write: (data) => {
      if (!closed) stream.write(data);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
  stream.on('data', dispatch);
  stream.stderr.on('data', dispatch);
  stream.on('close', () => {
    closed = true;
    runner.abort('El equipo cerro la sesion SSH durante el respaldo.');
  });

  const warnings = [];
  try {
    progress('Esperando prompt del equipo...');
    let [probe] = await runner.run([{ command: '', timeout: 20000 }]);

    if (!probe.prompt.privileged) {
      if (!enableSecret) {
        throw new Error('El usuario entra en user EXEC (>). Guarde el enable secret en el perfil o use un usuario privilege 15.');
      }
      progress('Entrando a privileged EXEC (enable)...');
      try {
        [probe] = await runner.run([{
          command: 'enable',
          answers: [{ pattern: /Password:\s*$/i, reply: `${enableSecret}\r`, max: 1 }],
          timeout: 15000
        }]);
      } catch (error) {
        if (error.kind === 'rejected' || error.kind === 'cli') {
          throw new Error('El equipo rechazo el enable secret guardado en el perfil.');
        }
        throw error;
      }
      if (!probe.prompt.privileged) throw new Error('enable no fue aceptado: revise el enable secret guardado en el perfil.');
    }
    if (probe.prompt.mode) [probe] = await runner.run([{ command: 'end', timeout: 10000 }]);
    const hostname = probe.prompt.hostname;

    const [privilege] = await runner.run([{ command: 'show privilege', timeout: 15000, expectHostname: hostname }]);
    const levelMatch = /privilege level is (\d+)/i.exec(privilege.output);
    const level = levelMatch ? Number(levelMatch[1]) : null;
    if (level !== null && level < 15) {
      throw new Error(`Privilegio ${level}: show running-config mostraria solo una parte de la configuracion. Use privilege 15.`);
    }

    // Sin paginacion: IOS usa "terminal length 0"; Small Business CBS usa "terminal datadump".
    try {
      await runner.run([{ command: 'terminal length 0', timeout: 10000, expectHostname: hostname }]);
    } catch (error) {
      if (error.kind !== 'cli') throw error;
      try {
        await runner.run([{ command: 'terminal datadump', timeout: 10000, expectHostname: hostname }]);
      } catch (fallbackError) {
        if (fallbackError.kind !== 'cli') throw fallbackError;
        warnings.push('El equipo no acepto desactivar la paginacion; se respondio --More-- automaticamente.');
      }
    }
    try {
      await runner.run([{ command: 'terminal width 512', timeout: 10000, expectHostname: hostname }]);
    } catch (error) {
      if (error.kind !== 'cli') throw error;
    }

    const capture = async (command) => {
      progress(`Ejecutando ${command}...`);
      const [result] = await runner.run([{ command, timeout: 60000, expectHostname: hostname, errorScope: 'head' }]);
      return cleanShowOutput(result.output, command);
    };

    const running = await capture('show running-config');
    if (!hasEndLine(running)) {
      throw new Error('La running-config recibida no termina en "end": el respaldo estaria incompleto y no se guardo.');
    }

    let startup = await capture('show startup-config');
    if (/not present|no hay|is empty/i.test(startup) && !hasEndLine(startup)) {
      warnings.push('El equipo no tiene startup-config guardada (nunca se ejecuto write memory).');
      startup = '';
    } else if (!hasEndLine(startup)) {
      warnings.push('La startup-config recibida no termina en "end"; revise el archivo.');
    }

    try {
      await runner.run([{ command: 'exit', timeout: 3000 }]);
    } catch (_error) {
      // El equipo cierra la sesion con exit: no es un error.
    }
    return { hostname, level, running, startup, warnings };
  } finally {
    closed = true;
    conn.end();
  }
}

ipcMain.handle('session:connect', async (event, profile) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  // El renderer puede proponer el id (una terminal = una sesion) para enrutar datos desde el primer byte.
  const requestedId = typeof profile.sessionId === 'string' && /^[\w-]{1,64}$/.test(profile.sessionId)
    ? profile.sessionId
    : null;
  const sessionId = requestedId && !sessions.has(requestedId)
    ? requestedId
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const protocol = protocolOf(profile);
  const port = Number(profile.port || DEFAULT_PORTS[protocol]) || 0;
  const logStream = profile.enableLog ? openLogFile(profile, protocol, port) : null;

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
    message: protocol === 'serial'
      ? `Abriendo ${targetLabel(profile, protocol, port)}`
      : `Conectando a ${targetLabel(profile, protocol, port)} por ${protocol.toUpperCase()}`
  });

  if (protocol === 'ssh') {
    return connectSsh(session, { ...profile, password: resolvePassword(profile) }, port);
  }
  if (protocol !== 'serial' && !port) {
    closeSession(sessionId, 'No se pudo conectar: indique el puerto TCP.');
    return { ok: false, sessionId, error: 'Indique el puerto TCP.' };
  }
  return connectStreamClient(session, protocol, profile, port);
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

// Telnet, TCP raw, Rlogin y serial comparten interfaz: connect/data/error/close/notice + write/resize/end.
function createStreamClient(protocol, session, profile, port) {
  const host = profile.host;
  const timeout = Math.min(Math.max(Number(profile.sshTimeout) || 15000, 5000), 30000);
  switch (protocol) {
    case 'telnet':
      return {
        client: new TelnetClient({ cols: session.cols, rows: session.rows }),
        open: (client) => client.connect({ host, port, timeout }),
        label: 'Conexion Telnet establecida (texto plano)'
      };
    case 'raw':
      return {
        client: new RawClient(),
        open: (client) => client.connect({ host, port, timeout }),
        label: 'Conexion TCP raw establecida (texto plano)'
      };
    case 'rlogin':
      return {
        client: new RloginClient({ cols: session.cols, rows: session.rows }),
        open: (client) => client.connect({ host, port, timeout, remoteUser: profile.username || '' }),
        label: 'Conexion Rlogin establecida (texto plano)'
      };
    case 'serial':
      return {
        client: new SerialClient(),
        open: (client) => client.connect({
          path: profile.serialPath || profile.host,
          baudRate: Number(profile.baudRate) || 9600,
          flowControl: profile.flowControl || 'none'
        }),
        label: `Consola serial abierta: ${targetLabel(profile, protocol, port)}`
      };
    default:
      throw new Error(`Protocolo no soportado: ${protocol}`);
  }
}

function connectStreamClient(session, protocol, profile, port) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const { client, open, label } = createStreamClient(protocol, session, profile, port);
    session.client = client;

    client.on('connect', () => {
      sendToWindow(session.window, 'session:status', {
        sessionId: session.sessionId,
        status: 'connected',
        message: label
      });
      finish({ ok: true, sessionId: session.sessionId });
    });
    client.on('data', (text) => {
      appendLog(session, text);
      sendToWindow(session.window, 'session:data', { sessionId: session.sessionId, data: text });
    });
    // Avisos del cliente: se muestran en la terminal, no van al log.
    client.on('notice', (notice) => {
      sendToWindow(session.window, 'session:data', {
        sessionId: session.sessionId,
        data: `\r\n\x1b[33mAviso: ${notice}\x1b[0m\r\n`
      });
    });
    client.on('error', (error) => {
      sendToWindow(session.window, 'session:status', {
        sessionId: session.sessionId,
        status: 'error',
        message: error.message
      });
      closeSession(session.sessionId, error.message);
      finish({ ok: false, sessionId: session.sessionId, error: error.message });
    });
    client.on('close', () => {
      closeSession(session.sessionId);
      finish({ ok: false, sessionId: session.sessionId, error: 'La conexion se cerro.' });
    });

    open(client);
  });
}

ipcMain.handle('session:write', async (_event, { sessionId, data }) => {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: 'Sesion no encontrada' };
  if (session.stream) session.stream.write(data);
  if (session.client) session.client.write(data);
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
  if (session.client) session.client.resize(cols, rows);
  return { ok: true };
});

ipcMain.handle('session:break', async (_event, sessionId) => {
  const session = sessions.get(sessionId);
  if (!session || !session.client || typeof session.client.sendBreak !== 'function') {
    return { ok: false, error: 'Break solo esta disponible en consola serial.' };
  }
  try {
    await session.client.sendBreak();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('serial:list', async () => {
  try {
    return await listSerialPorts();
  } catch (error) {
    return { ok: false, error: error.message, ports: [] };
  }
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

ipcMain.handle('inventory:load', async () => publicInventory(readInventory()));

ipcMain.handle('inventory:save-profile', async (_event, profile) => {
  const inventory = readInventory();
  const normalized = normalizeProfile(profile);
  const index = inventory.profiles.findIndex((item) => item.id === normalized.id);
  const existing = index >= 0 ? inventory.profiles[index] : null;
  const store = secureStorageStatus();

  // "Recordar contrasenas": nueva si se escribio, la anterior si el campo quedo vacio.
  const keep = (typed, field) => {
    if (!profile.savePassword || !store.available) return '';
    if (typed) return encryptSecret(typed);
    return (existing && existing[field]) || '';
  };
  const passwordEnc = keep(profile.password, 'passwordEnc');
  const enableEnc = keep(profile.enableSecret, 'enableEnc');
  const record = { ...normalized };
  if (passwordEnc) record.passwordEnc = passwordEnc;
  if (enableEnc) record.enableEnc = enableEnc;

  if (index >= 0) inventory.profiles[index] = record;
  else inventory.profiles.push(record);
  writeInventory(inventory);
  return {
    ok: true,
    profile: toPublicProfile(record),
    inventory: publicInventory(inventory),
    passwordStored: Boolean(passwordEnc),
    enableStored: Boolean(enableEnc)
  };
});

ipcMain.handle('inventory:delete-profile', async (_event, profileId) => {
  const inventory = readInventory();
  inventory.profiles = inventory.profiles.filter((profile) => profile.id !== profileId);
  writeInventory(inventory);
  return { ok: true, inventory: publicInventory(inventory) };
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
  const store = secureStorageStatus();
  const byHost = new Map(inventory.profiles.map((profile) => [profile.host, profile]));
  imported.forEach(({ password, ...profile }) => {
    const existing = byHost.get(profile.host);
    // Sin contrasena en el archivo se conserva la guardada (CSV nunca trae contrasena).
    const passwordEnc = password && store.available
      ? encryptSecret(password)
      : (existing && existing.passwordEnc) || '';
    const merged = existing
      ? { ...existing, ...profile, id: existing.id, updatedAt: new Date().toISOString() }
      : profile;
    delete merged.passwordEnc;
    byHost.set(profile.host, passwordEnc ? { ...merged, passwordEnc } : merged);
  });
  inventory.profiles = Array.from(byHost.values());
  writeInventory(inventory);
  return { ok: true, imported: imported.length, inventory: publicInventory(inventory) };
});

ipcMain.handle('inventory:export', async (_event, { format }) => {
  const inventory = readInventory();
  const isCsv = format === 'csv';
  const result = await dialog.showSaveDialog({
    defaultPath: isCsv ? 'switch-inventory.csv' : 'switch-inventory.json',
    filters: [{ name: isCsv ? 'CSV' : 'JSON', extensions: [isCsv ? 'csv' : 'json'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false };

  const profiles = inventory.profiles.map(exportableProfile);
  const content = isCsv ? profileToCsv(profiles) : JSON.stringify({ profiles }, null, 2);
  fs.writeFileSync(result.filePath, content, 'utf8');
  return { ok: true, filePath: result.filePath };
});

ipcMain.handle('backup:profile', async (event, profile) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const progress = (message) => sendToWindow(window, 'backup:progress', { message });
  const normalized = { ...normalizeProfile(profile), password: resolvePassword(profile) };
  if (normalized.protocol !== 'ssh') {
    return { ok: false, error: 'El respaldo automatico usa SSH. Con otros protocolos ejecute los comandos manualmente en la terminal.' };
  }

  try {
    progress(`Conectando por SSH a ${normalized.host}...`);
    const result = await runBackup(normalized, resolveEnableSecret(profile), progress);
    const dir = backupDir(normalized.name || result.hostname || normalized.host);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const runningPath = path.join(dir, `${stamp}_running-config.cfg`);
    fs.writeFileSync(runningPath, `${result.running}\n`, 'utf8');
    let startupPath = '';
    if (result.startup) {
      startupPath = path.join(dir, `${stamp}_startup-config.cfg`);
      fs.writeFileSync(startupPath, `${result.startup}\n`, 'utf8');
    }
    return {
      ok: true,
      hostname: result.hostname,
      privilegeLevel: result.level,
      running: result.running,
      startup: result.startup,
      runningPath,
      startupPath,
      runningLines: result.running.split('\n').length,
      startupLines: result.startup ? result.startup.split('\n').length : 0,
      warnings: result.warnings
    };
  } catch (error) {
    const where = error.step && error.step.command ? ` (comando: "${error.step.command}")` : '';
    return { ok: false, error: `${error.message}${where}` };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  for (const sessionId of sessions.keys()) closeSession(sessionId);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
