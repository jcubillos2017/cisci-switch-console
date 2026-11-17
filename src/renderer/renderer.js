const state = {
  lastGeneratedConfig: '',
  inventory: { profiles: [] },
  currentProfileId: null,
  lastBackup: null
};

const els = {
  statusBadge: document.querySelector('#statusBadge'),
  savedProfiles: document.querySelector('#savedProfiles'),
  profileName: document.querySelector('#profileName'),
  connectionModel: document.querySelector('#connectionModel'),
  site: document.querySelector('#site'),
  protocol: document.querySelector('#protocol'),
  port: document.querySelector('#port'),
  host: document.querySelector('#host'),
  username: document.querySelector('#username'),
  password: document.querySelector('#password'),
  savePassword: document.querySelector('#savePassword'),
  sshTimeout: document.querySelector('#sshTimeout'),
  legacyCiscoSsh: document.querySelector('#legacyCiscoSsh'),
  enableLog: document.querySelector('#enableLog'),
  connectBtn: document.querySelector('#connectBtn'),
  disconnectBtn: document.querySelector('#disconnectBtn'),
  saveProfileBtn: document.querySelector('#saveProfileBtn'),
  deleteProfileBtn: document.querySelector('#deleteProfileBtn'),
  sessionTitle: document.querySelector('#sessionTitle'),
  sessionSubtitle: document.querySelector('#sessionSubtitle'),
  commandInput: document.querySelector('#commandInput'),
  sendCommandBtn: document.querySelector('#sendCommandBtn'),
  clearTerminalBtn: document.querySelector('#clearTerminalBtn'),
  backupActiveBtn: document.querySelector('#backupActiveBtn'),
  sendGeneratedBtn: document.querySelector('#sendGeneratedBtn'),
  inventoryRows: document.querySelector('#inventoryRows'),
  importInventoryBtn: document.querySelector('#importInventoryBtn'),
  exportInventoryJsonBtn: document.querySelector('#exportInventoryJsonBtn'),
  exportInventoryCsvBtn: document.querySelector('#exportInventoryCsvBtn'),
  backupSelectedBtn: document.querySelector('#backupSelectedBtn'),
  backupStatus: document.querySelector('#backupStatus'),
  backupResult: document.querySelector('#backupResult'),
  runningConfigText: document.querySelector('#runningConfigText'),
  startupConfigText: document.querySelector('#startupConfigText'),
  compareTextBtn: document.querySelector('#compareTextBtn'),
  diffSummary: document.querySelector('#diffSummary'),
  diffPreview: document.querySelector('#diffPreview'),
  configForm: document.querySelector('#configForm'),
  configPreview: document.querySelector('#configPreview'),
  copyConfigBtn: document.querySelector('#copyConfigBtn'),
  saveConfigBtn: document.querySelector('#saveConfigBtn'),
  confirmChangesBtn: document.querySelector('#confirmChangesBtn'),
  rollbackBadge: document.querySelector('#rollbackBadge'),
  configIssues: document.querySelector('#configIssues'),
  rollbackNote: document.querySelector('#rollbackNote')
};

// Rollbacks programados por host (sobreviven a la desconexion de la terminal).
const rollbacks = new Map();

const sessions = window.TerminalSessions.create({
  container: document.querySelector('#terminals'),
  tabBar: document.querySelector('#sessionTabs'),
  addButton: document.querySelector('#addSessionBtn'),
  api: window.switchConsole,
  initialSlots: 5,
  maxSlots: 10,
  terminalOptions: {
    cursorBlink: true,
    convertEol: true,
    fontFamily: '"Cascadia Mono", Consolas, monospace',
    fontSize: 13,
    theme: {
      background: '#05080a',
      foreground: '#d9e6ef',
      cursor: '#5eead4',
      selectionBackground: '#2f5f87'
    }
  },
  tabFlags: (slot) => ({ rollback: Boolean(slot.host && rollbacks.has(slot.host)), running: slot.scriptRunning }),
  onChange: () => renderActiveSession()
});

// "reload in": responder "no" a guardar (guardar anularia el rollback) y confirmar la programacion.
const RELOAD_IN_ANSWERS = [
  { pattern: /Save\?\s*\[yes\/no\]:\s*$/i, reply: 'no\r' },
  { pattern: /Proceed with reload\?\s*\[confirm\]\s*$/i, reply: '\r' }
];

const WEAK_SECRETS = [
  'cambiar123!', 'cambiar_enable_secret', 'cisco', 'cisco123', 'admin', 'admin123',
  'password', 'class', 'secret', '12345678', 'suclavesegura'
];


const modelTemplates = {
  'Catalyst 2960': {
    vlans: '10, Gestion\n20, Usuarios\n30, Telefonia\n99, Nativa',
    accessPorts: 'Gi0/1-12,20\nGi0/13-18,30',
    trunkPorts: 'Gi0/24,10,20,30,99',
    note: 'Plantilla capa 2 para acceso clasico.'
  },
  'Catalyst 2960-X': {
    vlans: '10, Gestion\n20, Usuarios\n30, Telefonia\n40, Impresoras\n99, Nativa',
    accessPorts: 'Gi1/0/1-24,20\nGi1/0/25-36,30',
    trunkPorts: 'Gi1/0/48,10,20,30,40,99',
    note: 'Plantilla capa 2 para acceso con uplink Gigabit.'
  },
  'Catalyst 3560': {
    vlans: '10, Gestion\n20, Usuarios\n30, Telefonia\n50, Servidores\n99, Nativa',
    accessPorts: 'Gi0/1-20,20\nGi0/21-22,30',
    trunkPorts: 'Gi0/24,10,20,30,50,99',
    note: 'Plantilla con opcion de routing inter-VLAN.'
  },
  'Catalyst 3750': {
    vlans: '10, Gestion\n20, Usuarios\n30, Telefonia\n50, Servidores\n99, Nativa',
    accessPorts: 'Gi1/0/1-24,20\nGi1/0/25-36,30',
    trunkPorts: 'Gi1/0/48,10,20,30,50,99',
    note: 'Plantilla para stack de acceso/distribucion.'
  },
  'Catalyst 9200': {
    vlans: '10, Gestion\n20, Usuarios\n30, Telefonia\n40, CCTV\n99, Nativa',
    accessPorts: 'Gi1/0/1-24,20\nGi1/0/25-36,30\nGi1/0/37-44,40',
    trunkPorts: 'Gi1/1/1,10,20,30,40,99',
    note: 'Plantilla IOS XE para acceso empresarial.'
  },
  'Catalyst 9300': {
    vlans: '10, Gestion\n20, Usuarios\n30, Telefonia\n50, Servidores\n60, WiFi\n99, Nativa',
    accessPorts: 'Gi1/0/1-24,20\nGi1/0/25-36,30\nGi1/0/37-44,60',
    trunkPorts: 'Te1/1/1,10,20,30,50,60,99',
    note: 'Plantilla IOS XE para core/acceso de mayor capacidad.'
  },
  'Small Business CBS': {
    vlans: '10, Gestion\n20, Usuarios\n30, Telefonia\n99, Nativa',
    accessPorts: 'Gi1-12,20\nGi13-18,30',
    trunkPorts: 'Gi24,10,20,30,99',
    note: 'Plantilla base; validar sintaxis segun firmware CBS.'
  }
};

function terminalSize() {
  const terminalElement = document.querySelector('#terminals');
  const width = terminalElement.clientWidth - 24;
  const height = terminalElement.clientHeight - 24;
  const cols = Math.max(80, Math.floor(width / 7.2));
  const rows = Math.max(24, Math.floor(height / 16));
  return { cols, rows };
}

function resizeTerminal() {
  sessions.resizeAll(terminalSize());
}

window.addEventListener('resize', resizeTerminal);
setTimeout(resizeTerminal, 50);

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showMessage(message) {
  els.sessionSubtitle.textContent = message;
}

// Mensaje de una terminal: se guarda en ella y se muestra si es la activa.
function slotMessage(slot, message) {
  slot.message = message;
  if (slot === sessions.active()) els.sessionSubtitle.textContent = message;
}

function slotLabel(slot) {
  return `T${slot.number} ${slot.name || slot.host}`.trim();
}

async function loadInventory() {
  state.inventory = await window.switchConsole.loadInventory();
renderActiveSession();
  renderInventory();
}

// La contrasena guardada nunca vuelve al formulario: solo se indica que existe.
function setPasswordField(profile, keepValue = false) {
  if (!keepValue) els.password.value = '';
  els.password.placeholder = profile && profile.hasPassword ? 'Guardada (cifrada) - escriba para reemplazar' : '';
  els.savePassword.checked = Boolean(profile && profile.hasPassword);
  applySecureStorageStatus();
}

function applySecureStorageStatus() {
  const status = state.inventory.secureStorage || { available: true, reason: '' };
  els.savePassword.disabled = !status.available;
  els.savePassword.parentElement.title = status.available
    ? 'Se cifra con el almacen del sistema (DPAPI en Windows, Keychain en macOS).'
    : status.reason;
  if (!status.available) els.savePassword.checked = false;
}

function renderInventory() {
  applySecureStorageStatus();
  els.savedProfiles.innerHTML = '<option value="">Nuevo perfil</option>';
  state.inventory.profiles
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((profile) => {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = `${profile.name} (${profile.host || 'sin host'})`;
      els.savedProfiles.appendChild(option);
    });
  els.savedProfiles.value = state.currentProfileId || '';

  if (!state.inventory.profiles.length) {
    els.inventoryRows.innerHTML = '<tr><td colspan="7" class="muted">Sin perfiles guardados.</td></tr>';
    return;
  }

  els.inventoryRows.innerHTML = state.inventory.profiles
    .map((profile) => `
      <tr>
        <td>${escapeHtml(profile.name)}</td>
        <td>${escapeHtml(profile.host)}</td>
        <td>${escapeHtml(profile.model)}</td>
        <td class="muted">${escapeHtml(profile.site)}</td>
        <td>${escapeHtml((profile.protocol || 'ssh').toUpperCase())}:${escapeHtml(profile.port)}</td>
        <td class="muted">${profile.hasPassword ? 'Cifrada' : '-'}</td>
        <td><button type="button" data-load-profile="${escapeHtml(profile.id)}">Cargar</button></td>
      </tr>
    `)
    .join('');

  document.querySelectorAll('[data-load-profile]').forEach((button) => {
    button.addEventListener('click', () => applyProfile(button.dataset.loadProfile));
  });
}

function applyProfile(profileId) {
  const profile = state.inventory.profiles.find((item) => item.id === profileId);
  if (!profile) {
    state.currentProfileId = null;
    els.savedProfiles.value = '';
    return;
  }

  state.currentProfileId = profile.id;
  els.savedProfiles.value = profile.id;
  els.profileName.value = profile.name || '';
  els.connectionModel.value = profile.model || 'Catalyst 2960';
  els.site.value = profile.site || '';
  els.protocol.value = profile.protocol || 'ssh';
  els.port.value = profile.port || (els.protocol.value === 'ssh' ? 22 : 23);
  els.host.value = profile.host || '';
  els.username.value = profile.username || '';
  setPasswordField(profile);
  els.sshTimeout.value = profile.sshTimeout || 45000;
  els.legacyCiscoSsh.checked = profile.legacyCiscoSsh === true;
  els.enableLog.checked = profile.enableLog !== false;
  document.querySelector('#model').value = els.connectionModel.value;
  applyTemplate(els.connectionModel.value, false);
  showMessage(`Perfil cargado: ${profile.name}`);
}

async function saveCurrentProfile() {
  const profile = connectionProfile();
  if (!profile.host) {
    showMessage('Ingrese la IP o nombre del switch antes de guardar.');
    return;
  }

  const result = await window.switchConsole.saveProfile(profile);
  if (!result.ok) return;
  state.inventory = result.inventory;
  state.currentProfileId = result.profile.id;
  renderInventory();
  // Si se cifro, se limpia el campo; si no se guardo, se conserva lo escrito para conectar.
  setPasswordField(result.profile, !result.passwordStored);

  const status = result.inventory.secureStorage || {};
  let note = 'sin contrasena guardada';
  if (result.passwordStored) note = 'contrasena cifrada';
  else if (profile.savePassword && !status.available) note = `contrasena no guardada: ${status.reason}`;
  showMessage(`Perfil guardado: ${result.profile.name} (${note}).`);
}

async function deleteCurrentProfile() {
  if (!state.currentProfileId) return;
  const confirmed = window.confirm('Eliminar el perfil seleccionado del inventario?');
  if (!confirmed) return;

  const result = await window.switchConsole.deleteProfile(state.currentProfileId);
  if (result.ok) {
    state.inventory = result.inventory;
    state.currentProfileId = null;
    els.savedProfiles.value = '';
    renderInventory();
    showMessage('Perfil eliminado.');
  }
}

els.protocol.addEventListener('change', () => {
  els.port.value = els.protocol.value === 'ssh' ? '22' : '23';
});

els.savedProfiles.addEventListener('change', () => {
  if (!els.savedProfiles.value) {
    state.currentProfileId = null;
    setPasswordField(null);
    return;
  }
  applyProfile(els.savedProfiles.value);
});

els.connectionModel.addEventListener('change', () => {
  document.querySelector('#model').value = els.connectionModel.value;
  applyTemplate(els.connectionModel.value, false);
});

els.saveProfileBtn.addEventListener('click', saveCurrentProfile);
els.deleteProfileBtn.addEventListener('click', deleteCurrentProfile);

els.importInventoryBtn.addEventListener('click', async () => {
  const result = await window.switchConsole.importInventory();
  if (result.ok) {
    state.inventory = result.inventory;
    renderInventory();
    showMessage(`Inventario importado: ${result.imported} perfiles.`);
  }
});

els.exportInventoryJsonBtn.addEventListener('click', () => window.switchConsole.exportInventory('json'));
els.exportInventoryCsvBtn.addEventListener('click', () => window.switchConsole.exportInventory('csv'));

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
    button.classList.add('active');
    document.querySelector(`#${button.dataset.tab}Tab`).classList.add('active');
    resizeTerminal();
  });
});

function setStatus(status, message) {
  setStatusBadge(status);
  els.sessionSubtitle.textContent = message || '';
}

function setStatusBadge(status) {
  els.statusBadge.className = `badge ${status}`;
  const labels = {
    idle: 'Sin sesion',
    connecting: 'Conectando',
    connected: 'Conectado',
    error: 'Error',
    closed: 'Cerrada'
  };
  els.statusBadge.textContent = labels[status] || status;
}

function renderActiveSession() {
  const slot = sessions.active();
  els.sessionTitle.textContent = slot.sessionId || slot.host
    ? `Terminal ${slot.number} - ${slot.name || slot.host}`
    : `Terminal ${slot.number}`;
  els.sessionSubtitle.textContent = slot.message;
  setStatusBadge(slot.status);
  els.disconnectBtn.disabled = !slot.sessionId;
  renderRollback();
}

function connectionProfile() {
  const { cols, rows } = terminalSize();
  return {
    id: state.currentProfileId,
    name: els.profileName.value.trim(),
    model: els.connectionModel.value,
    site: els.site.value.trim(),
    protocol: els.protocol.value,
    port: Number(els.port.value),
    host: els.host.value.trim(),
    username: els.username.value.trim(),
    password: els.password.value,
    savePassword: els.savePassword.checked,
    sshTimeout: Number(els.sshTimeout.value || 45000),
    legacyCiscoSsh: els.legacyCiscoSsh.checked,
    enableLog: els.enableLog.checked,
    cols,
    rows
  };
}

els.connectBtn.addEventListener('click', async () => {
  const profile = connectionProfile();
  if (!profile.host) {
    showMessage('Ingrese la IP o nombre del switch.');
    return;
  }

  // La pestana Terminal debe estar visible antes de crear o mostrar una terminal.
  document.querySelector('[data-tab="terminal"]').click();

  // Usa la terminal activa si esta libre; si no, la primera libre (o agrega una).
  let slot = sessions.active();
  if (slot.sessionId) slot = sessions.findFree() || sessions.addSlot();
  if (!slot) {
    showMessage(`Las ${sessions.maxSlots} terminales estan ocupadas. Desconecte una para continuar.`);
    return;
  }

  const duplicate = sessions.slots.find((other) => other !== slot && other.sessionId && other.host === profile.host);
  if (duplicate) slotMessage(slot, `Aviso: ${profile.host} ya esta abierto en la terminal ${duplicate.number}.`);

  sessions.select(slot.index);
  await sessions.connect(slot, profile);
});

els.disconnectBtn.addEventListener('click', async () => {
  await sessions.disconnect(sessions.active());
});

document.querySelector('#addSessionBtn').addEventListener('click', () => {
  const slot = sessions.addSlot();
  if (slot) sessions.select(slot.index);
});

// Alt+1..9 y Alt+0 (terminal 10) cambian de terminal.
document.addEventListener('keydown', (event) => {
  if (!event.altKey || event.ctrlKey || event.metaKey || !/^Digit[0-9]$/.test(event.code)) return;
  const digit = Number(event.code.slice(5));
  const index = digit === 0 ? 9 : digit - 1;
  if (!sessions.slots[index]) return;
  event.preventDefault();
  document.querySelector('[data-tab="terminal"]').click();
  sessions.select(index);
}, true);

function sendCommand(command) {
  if (!command.trim()) return;
  const slot = sessions.active();
  if (!slot.sessionId || !slot.connected) {
    slot.term.writeln('');
    slot.term.writeln('No hay una sesion activa en esta terminal.');
    return;
  }
  if (slot.scriptRunning) {
    slotMessage(slot, 'Hay un envio en curso. Espere o presione "Detener envio".');
    return;
  }
  if (rollbacks.has(slot.host) && /^\s*(wr|write|copy\s+run)/i.test(command)) {
    const proceed = window.confirm([
      'Hay un rollback programado (reload in).',
      'Guardar ahora hace que el reload reinicie con la configuracion nueva y se pierde la proteccion.',
      '',
      'Use "Confirmar y guardar" para cancelar el reload y guardar. Guardar de todos modos?'
    ].join('\n'));
    if (!proceed) return;
  }
  sessions.write(slot, `${command}\r`);
}

function setBackupStatus(status, message) {
  els.backupStatus.className = `badge ${status}`;
  els.backupStatus.textContent = message;
}

async function backupCurrentProfile() {
  const profile = connectionProfile();
  if (!profile.host) {
    setBackupStatus('error', 'Sin host');
    els.backupResult.value = 'Ingrese o cargue un perfil con IP/host antes de respaldar.';
    return;
  }
  if (profile.protocol === 'telnet') {
    setBackupStatus('error', 'Solo SSH');
    els.backupResult.value = 'El respaldo automatico usa SSH. Para Telnet ejecute los comandos manualmente en Terminal.';
    return;
  }

  setBackupStatus('connecting', 'Respaldando');
  els.backupResult.value = `Conectando por SSH a ${profile.host}...\nEjecutando show running-config y show startup-config.`;

  try {
    const result = await window.switchConsole.backupProfile(profile);
    if (!result.ok) throw new Error(result.error || 'No se pudo respaldar');
    state.lastBackup = result;
    els.runningConfigText.value = result.running;
    els.startupConfigText.value = result.startup;
    els.backupResult.value = [
      'Respaldo completado.',
      `Running-config: ${result.runningPath}`,
      `Startup-config: ${result.startupPath}`
    ].join('\n');
    setBackupStatus('connected', 'Completado');
    compareConfigs();
  } catch (error) {
    setBackupStatus('error', 'Error');
    els.backupResult.value = `No se pudo completar el respaldo.\n${error.message}`;
  }
}

function normalizeConfigForDiff(config) {
  return config
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith('Building configuration') && !line.startsWith('Current configuration'));
}

function compareConfigs() {
  const running = normalizeConfigForDiff(els.runningConfigText.value);
  const startup = normalizeConfigForDiff(els.startupConfigText.value);
  const runningSet = new Set(running);
  const startupSet = new Set(startup);
  const added = running.filter((line) => !startupSet.has(line));
  const removed = startup.filter((line) => !runningSet.has(line));
  const changed = added.length + removed.length;

  els.diffSummary.textContent = changed ? `${changed} diferencias` : 'Sin diferencias';
  els.diffSummary.className = `badge ${changed ? 'connecting' : 'connected'}`;

  const diffLines = [];
  if (added.length) {
    diffLines.push('Lineas presentes en running-config y ausentes en startup-config:');
    added.forEach((line) => diffLines.push(`+ ${line}`));
    diffLines.push('');
  }
  if (removed.length) {
    diffLines.push('Lineas presentes en startup-config y ausentes en running-config:');
    removed.forEach((line) => diffLines.push(`- ${line}`));
  }
  els.diffPreview.textContent = diffLines.join('\n') || 'running-config y startup-config coinciden en esta comparacion.';
}

els.sendCommandBtn.addEventListener('click', () => {
  sendCommand(els.commandInput.value);
  els.commandInput.value = '';
});

els.commandInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    sendCommand(els.commandInput.value);
    els.commandInput.value = '';
  }
});

document.querySelectorAll('.macro').forEach((button) => {
  button.addEventListener('click', () => sendCommand(button.dataset.command));
});

els.clearTerminalBtn.addEventListener('click', () => sessions.active().term.clear());
els.backupActiveBtn.addEventListener('click', backupCurrentProfile);
els.backupSelectedBtn.addEventListener('click', backupCurrentProfile);
els.compareTextBtn.addEventListener('click', compareConfigs);

function readValue(id) {
  return document.querySelector(`#${id}`).value.trim();
}

function readChecked(id) {
  return document.querySelector(`#${id}`).checked;
}

function parseCsvLines(value, expectedFields) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(',').map((part) => part.trim()))
    .filter((parts) => parts.length >= expectedFields);
}

function applyTemplate(model, announce = true) {
  const template = modelTemplates[model] || modelTemplates['Catalyst 2960'];
  document.querySelector('#model').value = model;
  els.connectionModel.value = model;
  document.querySelector('#vlans').value = template.vlans;
  document.querySelector('#accessPorts').value = template.accessPorts;
  document.querySelector('#trunkPorts').value = template.trunkPorts;
  refreshPreview();
  if (announce) showMessage(`Plantilla aplicada: ${model}. ${template.note}`);
}

function modelSpecificCommands(model) {
  if (model === 'Catalyst 3560' || model === 'Catalyst 3750') {
    return [
      'spanning-tree mode rapid-pvst',
      '! Para routing inter-VLAN, validar licenciamiento y habilitar ip routing si corresponde'
    ];
  }

  if (model === 'Catalyst 9200' || model === 'Catalyst 9300') {
    return [
      'spanning-tree mode rapid-pvst',
      'errdisable recovery cause bpduguard',
      'errdisable recovery interval 300',
      'login on-success log',
      'login on-failure log'
    ];
  }

  if (model === 'Small Business CBS') {
    return [
      '! Validar sintaxis exacta en Small Business CBS segun firmware',
      '! Algunas versiones usan comandos diferentes para trunk/access'
    ];
  }

  return ['spanning-tree mode rapid-pvst'];
}

function readRaw(id) {
  return document.querySelector(`#${id}`).value;
}

function vlanListIncludes(items, vlan) {
  const target = Number(vlan);
  return items.some((item) => {
    const [start, end] = String(item).split('-').map(Number);
    return Number.isFinite(end) ? target >= start && target <= end : target === start;
  });
}

function usesScrypt(model) {
  return model === 'Catalyst 9200' || model === 'Catalyst 9300';
}

function generateConfig(mask = false) {
  const model = readValue('model') || 'Catalyst 2960';
  const hostname = readValue('cfgHostname') || 'SWITCH';
  const mgmtVlan = readValue('mgmtVlan') || '10';
  const mgmtIp = readValue('mgmtIp');
  const mgmtMask = readValue('mgmtMask');
  const gateway = readValue('gateway');
  const domainName = readValue('domainName') || 'local';
  const localUser = readValue('localUser') || 'admin';
  const localSecret = readRaw('localSecret');
  const enableSecret = readRaw('enableSecret');
  const shown = (value) => (mask ? '********' : value);
  const secretKeyword = usesScrypt(model) ? 'algorithm-type scrypt secret' : 'secret';
  const useReloadIn = readChecked('useReloadIn');
  const vlans = parseCsvLines(readValue('vlans'), 2);
  const accessPorts = parseCsvLines(readValue('accessPorts'), 2);
  const trunkPorts = parseCsvLines(readValue('trunkPorts'), 2);

  const lines = [
    'configure terminal',
    `hostname ${hostname}`,
    'no ip domain-lookup',
    `ip domain-name ${domainName}`,
    'service password-encryption'
  ];
  if (enableSecret) lines.push(`enable ${secretKeyword} ${shown(enableSecret)}`);
  lines.push(...modelSpecificCommands(model), '');

  vlans.forEach(([id, name]) => {
    lines.push(`vlan ${id}`, ` name ${name}`, ' exit');
  });

  lines.push('', `interface vlan ${mgmtVlan}`);
  if (mgmtIp && mgmtMask) lines.push(` ip address ${mgmtIp} ${mgmtMask}`);
  lines.push(' no shutdown', ' exit');
  if (gateway) lines.push(`ip default-gateway ${gateway}`);

  lines.push('');
  if (localSecret) lines.push(`username ${localUser} privilege 15 ${secretKeyword} ${shown(localSecret)}`);
  else lines.push('! username omitido: defina el secret del usuario local');

  if (readChecked('enableSsh')) {
    lines.push(
      'crypto key generate rsa modulus 2048',
      'ip ssh version 2',
      'ip ssh time-out 60',
      'ip ssh authentication-retries 3'
    );
  }

  accessPorts.forEach(([range, vlan]) => {
    lines.push(
      '',
      `interface range ${range}`,
      ' switchport mode access',
      ` switchport access vlan ${vlan}`
    );
    if (readChecked('spanningTree')) {
      lines.push(' spanning-tree portfast', ' spanning-tree bpduguard enable');
    }
    lines.push(' no shutdown', ' exit');
  });

  trunkPorts.forEach(([range, ...vlansAllowed]) => {
    const allowed = vlansAllowed.join(',');
    lines.push(
      '',
      `interface range ${range}`,
      ' switchport mode trunk'
    );
    if (allowed) lines.push(` switchport trunk allowed vlan ${allowed}`);
    lines.push(' no shutdown', ' exit');
  });

  lines.push(
    '',
    'line con 0',
    ' logging synchronous',
    ' exit',
    'line vty 0 15',
    ' login local',
    readChecked('disableTelnet') ? ' transport input ssh' : ' transport input ssh telnet',
    ' exec-timeout 10 0',
    ' exit',
    'end'
  );

  // Con rollback no se guarda: el guardado se hace con "Confirmar y guardar" tras validar.
  if (readChecked('saveMemory') && !useReloadIn) lines.push('write memory');
  return lines.join('\n');
}

function configIssues() {
  const blocking = [];
  const warnings = [];
  const localSecret = readRaw('localSecret');
  const enableSecret = readRaw('enableSecret');

  const checkSecret = (label, value) => {
    if (value.includes('?')) blocking.push(`${label}: no puede contener "?" (la CLI de IOS lo interpreta como ayuda).`);
    if (value !== value.trim()) blocking.push(`${label}: tiene espacios al inicio o al final.`);
    if (WEAK_SECRETS.includes(value.trim().toLowerCase())) blocking.push(`${label}: es un valor por defecto o conocido.`);
    else if (value.length < 8) warnings.push(`${label}: tiene menos de 8 caracteres.`);
  };

  if (!localSecret) {
    blocking.push('Defina el secret del usuario local: las VTY usan "login local" y sin usuario puede quedar sin acceso.');
  } else {
    checkSecret('Secret usuario local', localSecret);
  }
  if (enableSecret) {
    checkSecret('Enable secret', enableSecret);
    if (enableSecret === localSecret) warnings.push('Enable secret y secret del usuario local son iguales.');
  }

  const minutes = Number(readValue('reloadMinutes'));
  if (readChecked('useReloadIn')) {
    if (!Number.isInteger(minutes) || minutes < 3 || minutes > 60) blocking.push('Rollback: indique entre 3 y 60 minutos.');
  } else {
    warnings.push('Sin rollback: si el cambio corta la sesion necesitara acceso por consola.');
  }

  const mgmtVlan = readValue('mgmtVlan') || '10';
  parseCsvLines(readValue('trunkPorts'), 2).forEach(([range, ...allowed]) => {
    if (allowed.length && !vlanListIncludes(allowed, mgmtVlan)) {
      warnings.push(`Troncal ${range}: la VLAN de gestion ${mgmtVlan} no esta en "allowed vlan".`);
    }
  });

  return { blocking, warnings };
}

function configRisks(slot) {
  const risks = [];
  const mgmtVlan = readValue('mgmtVlan') || '10';
  if (slot.protocol === 'telnet') risks.push('La sesion es Telnet: los secrets viajan en texto plano.');
  if (readValue('mgmtIp')) risks.push(`interface vlan ${mgmtVlan}: reconfigura la SVI de gestion; si cambia la IP o la VLAN se corta la sesion.`);
  if (readValue('gateway')) risks.push('ip default-gateway: un gateway incorrecto corta el acceso desde otras redes.');
  const access = parseCsvLines(readValue('accessPorts'), 2).map(([range]) => range);
  if (access.length) risks.push(`Modo access en ${access.join(', ')}: si incluye su uplink, pierde la sesion.`);
  const trunks = parseCsvLines(readValue('trunkPorts'), 2).map(([range]) => range);
  if (trunks.length) risks.push(`Troncales ${trunks.join(', ')}: "allowed vlan" reemplaza la lista actual.`);
  if (state.lastGeneratedConfig.includes('spanning-tree mode')) risks.push('spanning-tree mode: cambiar el modo provoca reconvergencia en todas las VLAN.');
  risks.push(readChecked('disableTelnet') ? 'line vty 0 15: login local y solo SSH.' : 'line vty 0 15: login local.');
  if (readChecked('enableSsh') && readChecked('replaceRsaKeys')) risks.push('Reemplaza las llaves RSA: cambia la huella SSH del equipo.');
  return risks;
}

function refreshPreview() {
  state.lastGeneratedConfig = generateConfig();
  els.configPreview.textContent = generateConfig(true);

  const useReloadIn = readChecked('useReloadIn');
  document.querySelector('#saveMemory').disabled = useReloadIn;

  const { blocking, warnings } = configIssues();
  els.configIssues.innerHTML = [
    ...blocking.map((text) => `<div class="issue blocking">${escapeHtml(text)}</div>`),
    ...warnings.map((text) => `<div class="issue warning">${escapeHtml(text)}</div>`)
  ].join('');

  els.rollbackNote.textContent = useReloadIn
    ? `"Enviar Config" ejecuta antes "reload in ${readValue('reloadMinutes') || 10}" (responde "no" a guardar). Si pierde el acceso, el switch vuelve solo a la startup-config. Tras validar use "Confirmar y guardar".`
    : 'Sin rollback: la configuracion se aplica directamente sobre la running-config.';
}

function updateActionButtons() {
  const slot = sessions.active();
  const live = Boolean(slot.sessionId && slot.connected);
  els.sendGeneratedBtn.disabled = !live && !slot.scriptRunning;
  els.sendGeneratedBtn.textContent = slot.scriptRunning ? 'Detener envio' : 'Enviar Config';
  els.confirmChangesBtn.disabled = !(live && !slot.scriptRunning && rollbacks.has(slot.host));
}

function startRollback(host, minutes) {
  rollbacks.set(host, Date.now() + minutes * 60000);
  sessions.render();
  renderRollback();
}

function clearRollback(host) {
  rollbacks.delete(host);
  sessions.render();
  renderRollback();
}

function formatRemaining(ms) {
  const minutes = String(Math.floor(ms / 60000)).padStart(2, '0');
  const seconds = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function renderRollback() {
  const now = Date.now();
  let expired = false;
  for (const [host, deadline] of rollbacks) {
    if (deadline > now) continue;
    rollbacks.delete(host);
    expired = true;
    sessions.slots
      .filter((slot) => slot.host === host)
      .forEach((slot) => {
        slotMessage(slot, `Rollback vencido: ${host} se reinicia con la startup-config.`);
        if (slot.sessionId) slot.term.writeln(`\r\n\x1b[33m*** Rollback vencido: ${host} se reinicia con la startup-config. ***\x1b[0m`);
      });
  }
  if (expired) sessions.render();

  const slot = sessions.active();
  const deadline = slot.host ? rollbacks.get(slot.host) : null;
  const others = rollbacks.size - (deadline ? 1 : 0);
  if (!deadline && !others) {
    els.rollbackBadge.hidden = true;
  } else {
    els.rollbackBadge.hidden = false;
    els.rollbackBadge.textContent = [
      deadline ? `Rollback ${slot.host} ${formatRemaining(deadline - now)}` : '',
      others ? `${deadline ? '+' : ''}${others} en otras terminales` : ''
    ].filter(Boolean).join(' ');
    els.rollbackBadge.title = Array.from(rollbacks.entries())
      .map(([host, time]) => `${host}: ${formatRemaining(time - now)}`)
      .join('\n');
  }
  updateActionButtons();
}

setInterval(renderRollback, 1000);

async function runScript(slot, task) {
  slot.scriptRunning = true;
  sessions.render();
  updateActionButtons();
  try {
    return await task();
  } finally {
    slot.scriptRunning = false;
    sessions.render();
    updateActionButtons();
  }
}

async function ensurePrivilegedExec(slot) {
  const [probe] = await slot.runner.run([{ command: '', display: '(prompt)', timeout: 8000 }]);
  if (!probe.prompt.privileged) {
    throw new Error('El equipo esta en user EXEC (>). Ejecute "enable" y vuelva a intentar.');
  }
  if (probe.prompt.mode) await slot.runner.run([{ command: 'end', timeout: 8000 }]);
}

function describeFailure(slot, error) {
  const where = error.step ? ` (linea: "${error.step.display || error.step.command}")` : '';
  const parts = [`${error.message}${where}`];
  if (error.kind === 'timeout') parts.push('Si el cambio corto la sesion, reconecte despues de que venza el rollback.');
  if (rollbacks.has(slot.host)) parts.push('El rollback sigue programado: corrija y reenvie, o deje que venza para volver a la startup-config.');
  return parts.join(' ');
}

function reportFailure(slot, prefix, error) {
  const message = `${prefix}: ${describeFailure(slot, error)}`;
  slotMessage(slot, message);
  slot.term.writeln(`\r\n\x1b[31m*** ${message} ***\x1b[0m`);
}

async function sendGeneratedConfig() {
  const slot = sessions.active();
  if (slot.scriptRunning) {
    slot.runner.abort('Envio detenido por el usuario.');
    return;
  }
  if (!slot.sessionId || !slot.connected) return;

  refreshPreview();
  const { blocking, warnings } = configIssues();
  if (blocking.length) {
    window.alert(`No se puede enviar la configuracion:\n\n- ${blocking.join('\n- ')}`);
    document.querySelector('[data-tab="wizard"]').click();
    return;
  }

  const host = slot.host;
  const useReloadIn = readChecked('useReloadIn');
  const minutes = Number(readValue('reloadMinutes'));
  const summary = [
    `Enviar la configuracion generada a ${slotLabel(slot)} (${host})?`,
    '',
    useReloadIn
      ? `Proteccion: reload in ${minutes} (rollback automatico si pierde el acceso).`
      : 'SIN rollback: si pierde la sesion necesitara acceso por consola.',
    '',
    'Puede cortar la sesion o afectar trafico:',
    ...configRisks(slot).map((risk) => `- ${risk}`),
    ...(warnings.length ? ['', 'Advertencias:', ...warnings.map((warning) => `- ${warning}`)] : [])
  ].join('\n');
  if (!window.confirm(summary)) return;

  const realLines = state.lastGeneratedConfig.split('\n');
  const maskedLines = generateConfig(true).split('\n');
  const rsaAnswer = {
    pattern: /replace them\?\s*\[yes\/no\]:\s*$/i,
    reply: readChecked('replaceRsaKeys') ? 'yes\r' : 'no\r'
  };
  const steps = realLines
    .map((line, index) => ({ command: line, display: (maskedLines[index] || '').trim() }))
    .filter((step) => step.command.trim() && !step.command.trim().startsWith('!'))
    .map((step) => (/^\s*crypto key generate/i.test(step.command) ? { ...step, answers: [rsaAnswer] } : step));

  await runScript(slot, async () => {
    try {
      await ensurePrivilegedExec(slot);
      if (useReloadIn) {
        slotMessage(slot, `Programando reload in ${minutes}...`);
        await slot.runner.run([{ command: `reload in ${minutes}`, answers: RELOAD_IN_ANSWERS, timeout: 20000 }]);
        startRollback(host, minutes);
      }
      await slot.runner.run(steps, {
        onProgress: (index, total, step) => slotMessage(slot, `Enviando ${index + 1}/${total}: ${step.display}`)
      });
      if (useReloadIn) {
        slotMessage(slot, 'Configuracion aplicada. Valide y presione "Confirmar y guardar" antes de que venza el rollback.');
        slot.term.writeln('\r\n\x1b[33m*** Config aplicada. Valide (show ip interface brief / show vlan brief / show interfaces trunk) y use "Confirmar y guardar". ***\x1b[0m');
      } else {
        slotMessage(slot, 'Configuracion aplicada.');
      }
    } catch (error) {
      reportFailure(slot, 'Envio detenido', error);
    }
  });
}

async function confirmChanges() {
  const slot = sessions.active();
  if (!slot.connected || !rollbacks.has(slot.host)) return;
  const host = slot.host;
  const proceed = window.confirm([
    `Confirmar cambios en ${slotLabel(slot)} (${host})?`,
    '',
    'Se ejecutara:',
    '  reload cancel',
    '  write memory',
    '',
    'Hagalo solo si valido la configuracion y mantiene acceso de gestion.'
  ].join('\n'));
  if (!proceed) return;

  await runScript(slot, async () => {
    try {
      await ensurePrivilegedExec(slot);
      await slot.runner.run([{ command: 'reload cancel', timeout: 15000 }]);
      clearRollback(host);
      await slot.runner.run([{ command: 'write memory' }]);
      slotMessage(slot, 'Rollback cancelado y configuracion guardada en startup-config.');
    } catch (error) {
      reportFailure(slot, 'No se pudo confirmar', error);
    }
  });
}

els.configForm.addEventListener('input', refreshPreview);
els.configForm.addEventListener('change', refreshPreview);
document.querySelector('#model').addEventListener('change', (event) => {
  applyTemplate(event.target.value);
});
document.querySelectorAll('.template-btn').forEach((button) => {
  button.addEventListener('click', () => {
    applyTemplate(button.dataset.template);
    document.querySelector('[data-tab="wizard"]').click();
  });
});
refreshPreview();

els.copyConfigBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(state.lastGeneratedConfig);
  els.copyConfigBtn.textContent = 'Copiado';
  setTimeout(() => {
    els.copyConfigBtn.textContent = 'Copiar';
  }, 1200);
});

els.saveConfigBtn.addEventListener('click', async () => {
  await window.switchConsole.saveConfig({
    defaultPath: `${readValue('cfgHostname') || 'switch'}-config.cfg`,
    content: state.lastGeneratedConfig
  });
});

els.sendGeneratedBtn.addEventListener('click', sendGeneratedConfig);
els.confirmChangesBtn.addEventListener('click', confirmChanges);

loadInventory();
renderActiveSession();
