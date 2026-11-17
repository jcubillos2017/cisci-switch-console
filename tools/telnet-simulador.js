// Simulador de switch Cisco por Telnet para probar Cisco Switch Console sin equipos.
// Uso:  node tools/telnet-simulador.js [puerto]      (por defecto 2323, solo 127.0.0.1)
// Login: cualquier usuario y clave. Enable secret: cisco-lab
const net = require('net');

const PORT = Number(process.argv[2] || 2323);
const HOST = 'SIM-SW';
const ENABLE = 'cisco-lab';
const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;
const NAMES = { 1: 'ECHO', 3: 'SGA', 24: 'TTYPE', 31: 'NAWS', 32: 'TSPEED', 34: 'LINEMODE' };
const VERBS = { [DO]: 'DO', [DONT]: 'DONT', [WILL]: 'WILL', [WONT]: 'WONT' };

const RUNNING = [
  'Building configuration...', '', 'Current configuration : 1024 bytes', '!',
  'version 17.9', `hostname ${HOST}`, '!',
  'banner motd ^C', 'Bienvenido a SIM-SW: acceso solo autorizado (año 2026)', '^C', '!',
  'vlan 10', ' name Gestion', 'vlan 20', ' name Usuarios', '!',
  'interface GigabitEthernet1/0/1', ' switchport access vlan 20', ' switchport mode access', '!',
  'interface GigabitEthernet1/0/48', ' switchport mode trunk', ' switchport trunk allowed vlan 10,20', '!',
  'interface Vlan10', ' ip address 192.168.10.2 255.255.255.0', '!',
  'line vty 0 15', ' login local', ' transport input ssh telnet', '!', 'end'
];

function log(id, text) {
  console.log(`[${new Date().toLocaleTimeString()}] cliente ${id}: ${text}`);
}

let nextId = 1;
net.createServer((socket) => {
  const id = nextId++;
  const s = { stage: 'user', line: '', privileged: false, width: 80, height: 24, ttype: '?', length: 24, paging: null, sb: null, iac: null };
  const send = (text) => socket.write(Buffer.from(text.replace(/\n/g, '\r\n'), 'utf8'));
  const raw = (bytes) => socket.write(Buffer.from(bytes));
  const prompt = () => send(`\n${HOST}${s.privileged ? '#' : '>'}`);
  log(id, 'conectado');

  // El servidor inicia la negociacion como IOS.
  raw([IAC, WILL, 1, IAC, WILL, 3, IAC, DO, 24, IAC, DO, 31, IAC, DO, 32]);
  send('\n\nUser Access Verification\n\nUsername: ');

  const showPage = () => {
    const { lines } = s.paging;
    const take = s.length === 0 ? lines.length : Math.max(1, s.length - 1);
    send(lines.splice(0, take).join('\n'));
    if (lines.length) send('\n --More-- ');
    else { s.paging = null; prompt(); }
  };

  const run = (command) => {
    const cmd = command.trim();
    if (s.stage === 'user') { s.user = cmd; s.stage = 'pass'; send('\nPassword: '); return; }
    if (s.stage === 'pass') { s.stage = 'exec'; log(id, `login usuario "${s.user}"`); prompt(); return; }
    if (s.stage === 'enable') {
      s.stage = 'exec';
      if (cmd === ENABLE) s.privileged = true; else send('\n% Bad secrets\n');
      prompt();
      return;
    }
    if (!cmd) { prompt(); return; }
    if (cmd === 'enable' || cmd === 'en') { s.stage = 'enable'; send('\nPassword: '); return; }
    if (['exit', 'logout', 'quit'].includes(cmd)) { send('\n'); socket.end(); return; }
    if (cmd === 'disable') { s.privileged = false; prompt(); return; }
    if (/^terminal length (\d+)$/.test(cmd)) { s.length = Number(cmd.split(' ')[2]); prompt(); return; }
    if (cmd === 'show terminal' || cmd === 'sh term') {
      send(`\nLine 1, Location: "", Type: "${s.ttype}"\nLength: ${s.length} lines, Width: ${s.width} columns\nVentana negociada (NAWS): ${s.width}x${s.height}`);
      prompt(); return;
    }
    if (cmd === 'show users' || cmd === 'sh users') { send(`\n    Line       User       Host(s)              Idle       Location\n*  1 vty 0     ${s.user.padEnd(10)} idle                 00:00:00 127.0.0.1`); prompt(); return; }
    if (cmd === 'show version' || cmd === 'sh ver') { send('\nCisco IOS XE Software, Version 17.09.04 (simulador)\nSIM-SW uptime is 1 hour\nModel Number : C9200L-48T-4G'); prompt(); return; }
    if (/^sh(ow)? (run|running-config)$/.test(cmd)) {
      if (!s.privileged) { send("\n                ^\n% Invalid input detected at '^' marker.\n"); prompt(); return; }
      send('\n'); s.paging = { lines: RUNNING.slice() }; showPage(); return;
    }
    if (cmd === 'show privilege') { send(`\nCurrent privilege level is ${s.privileged ? 15 : 1}`); prompt(); return; }
    send(`\n${' '.repeat(HOST.length + 1)}^\n% Invalid input detected at '^' marker.\n`);
    prompt();
  };

  const onByte = (byte) => {
    // --More--: cualquier tecla continua; q corta.
    if (s.paging) {
      send('\b\b\b\b\b\b\b\b\b\b          \b\b\b\b\b\b\b\b\b\b');
      if (byte === 0x71) { s.paging = null; prompt(); } else showPage();
      return;
    }
    if (byte === 13) { s.cr = true; const line = s.line; s.line = ''; run(line); return; }
    if ((byte === 0 || byte === 10) && s.cr) { s.cr = false; return; } // CR NUL / CR LF
    s.cr = false;
    if (byte === 0x7f || byte === 8) {
      if (s.line) { s.line = s.line.slice(0, -1); if (s.stage !== 'pass' && s.stage !== 'enable') send('\b \b'); }
      return;
    }
    if (byte === 3) { s.line = ''; prompt(); return; } // Ctrl+C
    if (byte < 32) return;
    const char = String.fromCharCode(byte);
    s.line += char;
    if (s.stage !== 'pass' && s.stage !== 'enable') send(char); // sin eco en claves
  };

  socket.on('data', (buffer) => {
    for (const byte of buffer) {
      if (s.sb) {
        if (s.sb.iac) {
          s.sb.iac = false;
          if (byte === SE) {
            const [opt, ...rest] = s.sb.bytes;
            if (opt === 31 && rest.length >= 4) { s.width = rest[0] * 256 + rest[1]; s.height = rest[2] * 256 + rest[3]; log(id, `NAWS ${s.width}x${s.height}`); }
            if (opt === 24 && rest[0] === 0) { s.ttype = Buffer.from(rest.slice(1)).toString(); log(id, `TTYPE ${s.ttype}`); }
            s.sb = null;
          } else s.sb.bytes.push(byte);
        } else if (byte === IAC) s.sb.iac = true;
        else s.sb.bytes.push(byte);
        continue;
      }
      if (s.iac === 'cmd') {
        if (VERBS[byte]) { s.iac = byte; continue; }
        if (byte === SB) { s.sb = { bytes: [], iac: false }; s.iac = null; continue; }
        if (byte === IAC) { s.iac = null; onByte(IAC); continue; }
        s.iac = null; continue;
      }
      if (s.iac) {
        log(id, `negociacion ${VERBS[s.iac]} ${NAMES[byte] || byte}`);
        if (s.iac === WILL && byte === 24) raw([IAC, SB, 24, 1, IAC, SE]); // pedir tipo de terminal
        s.iac = null; continue;
      }
      if (byte === IAC) { s.iac = 'cmd'; continue; }
      onByte(byte);
    }
  });
  socket.on('close', () => log(id, 'desconectado'));
  socket.on('error', () => {});
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Simulador Telnet ${HOST} escuchando en 127.0.0.1:${PORT}`);
  console.log(`Login: cualquier usuario/clave. Enable secret: ${ENABLE}. Ctrl+C para detener.`);
});
