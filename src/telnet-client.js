// Cliente Telnet (RFC 854/855) para equipos Cisco:
// parser IAC con estado (tolera secuencias partidas entre paquetes), negociacion de opciones
// sin bucles, NAWS (tamano de ventana), TTYPE, timeout de conexion y errores legibles.
const net = require('net');
const { EventEmitter } = require('events');
const { StringDecoder } = require('string_decoder');

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;

const OPT_ECHO = 1;
const OPT_SGA = 3;
const OPT_TTYPE = 24;
const OPT_NAWS = 31;
const TTYPE_IS = 0;
const TTYPE_SEND = 1;

// Opciones que este cliente activa de su lado y las que acepta del servidor.
const LOCAL_SUPPORTED = new Set([OPT_SGA, OPT_TTYPE, OPT_NAWS]);
const REMOTE_SUPPORTED = new Set([OPT_ECHO, OPT_SGA]);

const STATE_DATA = 0;
const STATE_IAC = 1;
const STATE_OPTION = 2;
const STATE_SB = 3;
const STATE_SB_IAC = 4;

function readableTelnetError(error, host, port, timeoutMs) {
  const target = `${host}:${port}`;
  switch (error && error.code) {
    case 'ECONNREFUSED':
      return `Conexion rechazada en ${target}: el puerto no acepta Telnet (line vty con "transport input ssh" o puerto incorrecto).`;
    case 'ETIMEDOUT':
      return `Sin respuesta de ${target} en ${Math.round(timeoutMs / 1000)} s: host apagado, inalcanzable o filtrado por ACL/firewall.`;
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `Host ${target} inalcanzable: revise IP, gateway o VLAN de gestion.`;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `No se pudo resolver el nombre "${host}".`;
    case 'ECONNRESET':
      return `El equipo cerro la conexion (access-class en line vty, limite de sesiones o puerto ocupado).`;
    default:
      return error && error.message ? error.message : 'Error Telnet';
  }
}

class TelnetClient extends EventEmitter {
  constructor({ cols = 100, rows = 32, terminalType = 'XTERM' } = {}) {
    super();
    this.cols = cols;
    this.rows = rows;
    this.terminalType = terminalType;
    this.socket = null;
    this.connected = false;
    this.state = STATE_DATA;
    this.verb = 0;
    this.sbBuffer = [];
    this.local = new Set();
    this.remote = new Set();
    this.refusedLocal = new Set();
    this.refusedRemote = new Set();
    this.decoder = new StringDecoder('utf8');
  }

  connect({ host, port = 23, timeout = 15000 }) {
    const socket = net.createConnection({ host, port });
    this.socket = socket;
    socket.setTimeout(timeout);

    socket.on('connect', () => {
      this.connected = true;
      socket.setTimeout(0);
      socket.setKeepAlive(true, 30000);
      this.emit('connect');
    });
    socket.on('timeout', () => {
      if (this.connected) return;
      const error = new Error('timeout');
      error.code = 'ETIMEDOUT';
      socket.destroy(error);
    });
    socket.on('data', (buffer) => this.receive(buffer));
    socket.on('error', (error) => {
      this.emit('error', new Error(readableTelnetError(error, host, port, timeout)));
    });
    socket.on('close', () => {
      const rest = this.decoder.end();
      if (rest) this.emit('data', rest);
      this.emit('close');
    });
    return this;
  }

  receive(buffer) {
    const data = [];
    for (const byte of buffer) {
      switch (this.state) {
        case STATE_DATA:
          if (byte === IAC) this.state = STATE_IAC;
          else if (byte !== 0) data.push(byte); // NUL de "CR NUL" (NVT) se descarta
          break;
        case STATE_IAC:
          if (byte === IAC) {
            data.push(IAC);
            this.state = STATE_DATA;
          } else if (byte === WILL || byte === WONT || byte === DO || byte === DONT) {
            this.verb = byte;
            this.state = STATE_OPTION;
          } else if (byte === SB) {
            this.sbBuffer = [];
            this.state = STATE_SB;
          } else {
            this.state = STATE_DATA; // NOP, GA, AYT, etc.
          }
          break;
        case STATE_OPTION:
          this.negotiate(this.verb, byte);
          this.state = STATE_DATA;
          break;
        case STATE_SB:
          if (byte === IAC) this.state = STATE_SB_IAC;
          else this.sbBuffer.push(byte);
          break;
        case STATE_SB_IAC:
          if (byte === SE) {
            this.subnegotiate(this.sbBuffer);
            this.state = STATE_DATA;
          } else {
            if (byte === IAC) this.sbBuffer.push(IAC);
            this.state = STATE_SB;
          }
          break;
        default:
          this.state = STATE_DATA;
      }
    }
    if (data.length) {
      const text = this.decoder.write(Buffer.from(data));
      if (text) this.emit('data', text);
    }
  }

  sendRaw(bytes) {
    if (this.socket && !this.socket.destroyed) this.socket.write(Buffer.from(bytes));
  }

  // Responde solo cuando cambia el estado de la opcion (evita bucles de negociacion).
  negotiate(verb, option) {
    if (verb === DO) {
      if (LOCAL_SUPPORTED.has(option)) {
        if (!this.local.has(option)) {
          this.local.add(option);
          this.sendRaw([IAC, WILL, option]);
        }
        if (option === OPT_NAWS) this.sendWindowSize();
      } else if (!this.refusedLocal.has(option)) {
        this.refusedLocal.add(option);
        this.sendRaw([IAC, WONT, option]);
      }
    } else if (verb === DONT) {
      if (this.local.has(option)) {
        this.local.delete(option);
        this.sendRaw([IAC, WONT, option]);
      }
    } else if (verb === WILL) {
      if (REMOTE_SUPPORTED.has(option)) {
        if (!this.remote.has(option)) {
          this.remote.add(option);
          this.sendRaw([IAC, DO, option]);
        }
      } else if (!this.refusedRemote.has(option)) {
        this.refusedRemote.add(option);
        this.sendRaw([IAC, DONT, option]);
      }
    } else if (verb === WONT) {
      if (this.remote.has(option)) {
        this.remote.delete(option);
        this.sendRaw([IAC, DONT, option]);
      }
    }
  }

  subnegotiate(bytes) {
    if (bytes[0] === OPT_TTYPE && bytes[1] === TTYPE_SEND && this.local.has(OPT_TTYPE)) {
      this.sendRaw([IAC, SB, OPT_TTYPE, TTYPE_IS, ...Buffer.from(this.terminalType, 'ascii'), IAC, SE]);
    }
  }

  sendWindowSize() {
    if (!this.local.has(OPT_NAWS)) return;
    const values = [this.cols >> 8, this.cols & 0xff, this.rows >> 8, this.rows & 0xff]
      .flatMap((value) => (value === IAC ? [IAC, IAC] : [value]));
    this.sendRaw([IAC, SB, OPT_NAWS, ...values, IAC, SE]);
  }

  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.sendWindowSize();
  }

  // Datos del usuario: IAC se duplica y un CR suelto se envia como CR NUL (NVT).
  write(text) {
    const input = Buffer.from(String(text), 'utf8');
    const out = [];
    for (let index = 0; index < input.length; index += 1) {
      const byte = input[index];
      if (byte === IAC) out.push(IAC, IAC);
      else if (byte === 13 && input[index + 1] !== 10) out.push(13, 0);
      else out.push(byte);
    }
    this.sendRaw(out);
  }

  end() {
    if (this.socket) this.socket.end();
  }

  destroy() {
    if (this.socket) this.socket.destroy();
  }
}

module.exports = { TelnetClient, readableTelnetError, constants: { IAC, DONT, DO, WONT, WILL, SB, SE, OPT_ECHO, OPT_SGA, OPT_TTYPE, OPT_NAWS } };
