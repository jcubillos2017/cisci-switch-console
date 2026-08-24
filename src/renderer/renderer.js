const state = {
  sessionId: null,
  connected: false,
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
  saveConfigBtn: document.querySelector('#saveConfigBtn')
};

const term = new Terminal({
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
});

term.open(document.querySelector('#terminal'));
term.writeln('Cisco Switch Console listo.');
term.writeln('Complete los datos de conexion y presione Conectar.');

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
  const terminalElement = document.querySelector('#terminal');
  const width = terminalElement.clientWidth - 24;
  const height = terminalElement.clientHeight - 24;
  const cols = Math.max(80, Math.floor(width / 7.2));
  const rows = Math.max(24, Math.floor(height / 16));
  return { cols, rows };
}

function resizeTerminal() {
  const { cols, rows } = terminalSize();
  term.resize(cols, rows);
  if (state.sessionId) window.switchConsole.resize(state.sessionId, cols, rows);
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

async function loadInventory() {
  state.inventory = await window.switchConsole.loadInventory();
  renderInventory();
}

function renderInventory() {
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
    els.inventoryRows.innerHTML = '<tr><td colspan="6" class="muted">Sin perfiles guardados.</td></tr>';
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
  els.password.value = profile.password || '';
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
    setStatus('error', 'Ingrese la IP o nombre del switch antes de guardar.');
    return;
  }

  const result = await window.switchConsole.saveProfile(profile);
  if (result.ok) {
    state.inventory = result.inventory;
    state.currentProfileId = result.profile.id;
    renderInventory();
    showMessage(`Perfil guardado: ${result.profile.name}`);
  }
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
  els.statusBadge.className = `badge ${status}`;
  const labels = {
    idle: 'Sin sesion',
    connecting: 'Conectando',
    connected: 'Conectado',
    error: 'Error',
    closed: 'Cerrada'
  };
  els.statusBadge.textContent = labels[status] || status;
  els.sessionSubtitle.textContent = message || '';
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
    setStatus('error', 'Ingrese la IP o nombre del switch.');
    return;
  }

  setStatus('connecting', `Conectando a ${profile.host}`);
  term.writeln('');
  term.writeln(`--- Conectando a ${profile.host}:${profile.port} por ${profile.protocol.toUpperCase()} ---`);
  const result = await window.switchConsole.connect(profile);
  if (!result.ok) {
    term.writeln(`Error: ${result.error || 'no se pudo conectar'}`);
    return;
  }

  state.sessionId = result.sessionId;
  state.connected = true;
  els.connectBtn.disabled = true;
  els.disconnectBtn.disabled = false;
  els.sendGeneratedBtn.disabled = false;
  els.sessionTitle.textContent = profile.name || profile.host;
});

els.disconnectBtn.addEventListener('click', async () => {
  if (!state.sessionId) return;
  await window.switchConsole.disconnect(state.sessionId);
});

term.onData((data) => {
  if (state.sessionId && state.connected) {
    window.switchConsole.write(state.sessionId, data);
  }
});

window.switchConsole.onData(({ sessionId, data }) => {
  if (sessionId !== state.sessionId) return;
  term.write(data);
});

window.switchConsole.onStatus(({ sessionId, status, message }) => {
  if (state.sessionId && sessionId !== state.sessionId) return;
  setStatus(status, message);
  if (status === 'closed' || status === 'error') {
    state.connected = false;
    state.sessionId = null;
    els.connectBtn.disabled = false;
    els.disconnectBtn.disabled = true;
    els.sendGeneratedBtn.disabled = true;
  }
});

function sendCommand(command) {
  if (!command.trim()) return;
  if (!state.sessionId || !state.connected) {
    term.writeln('');
    term.writeln('No hay una sesion activa.');
    return;
  }
  window.switchConsole.write(state.sessionId, `${command}\r`);
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

els.clearTerminalBtn.addEventListener('click', () => term.clear());
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

function generateConfig() {
  const model = readValue('model') || 'Catalyst 2960';
  const hostname = readValue('cfgHostname') || 'SWITCH';
  const mgmtVlan = readValue('mgmtVlan') || '10';
  const mgmtIp = readValue('mgmtIp');
  const mgmtMask = readValue('mgmtMask');
  const gateway = readValue('gateway');
  const domainName = readValue('domainName') || 'local';
  const localUser = readValue('localUser') || 'admin';
  const localSecret = readValue('localSecret') || 'Cambiar123!';
  const vlans = parseCsvLines(readValue('vlans'), 2);
  const accessPorts = parseCsvLines(readValue('accessPorts'), 2);
  const trunkPorts = parseCsvLines(readValue('trunkPorts'), 2);

  const lines = [
    'configure terminal',
    `hostname ${hostname}`,
    'no ip domain-lookup',
    `ip domain-name ${domainName}`,
    'service password-encryption',
    'enable secret Cambiar_Enable_Secret',
    ...modelSpecificCommands(model),
    ''
  ];

  vlans.forEach(([id, name]) => {
    lines.push(`vlan ${id}`, ` name ${name}`, ' exit');
  });

  lines.push('', `interface vlan ${mgmtVlan}`);
  if (mgmtIp && mgmtMask) lines.push(` ip address ${mgmtIp} ${mgmtMask}`);
  lines.push(' no shutdown', ' exit');
  if (gateway) lines.push(`ip default-gateway ${gateway}`);

  lines.push('', `username ${localUser} privilege 15 secret ${localSecret}`);

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

  if (readChecked('saveMemory')) lines.push('write memory');
  return lines.join('\n');
}

function refreshPreview() {
  state.lastGeneratedConfig = generateConfig();
  els.configPreview.textContent = state.lastGeneratedConfig;
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

els.sendGeneratedBtn.addEventListener('click', async () => {
  if (!state.sessionId || !state.connected) return;
  const confirmed = window.confirm('Enviar la configuracion generada a la sesion activa? Revise la vista previa antes de continuar.');
  if (!confirmed) return;
  const commands = state.lastGeneratedConfig.split('\n');
  for (const command of commands) {
    await window.switchConsole.write(state.sessionId, `${command}\r`);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
});

loadInventory();
