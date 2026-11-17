// Clientes TCP sin cifrado: TCP raw (servidores de consolas) y Rlogin (RFC 1282).
// Misma interfaz que TelnetClient: connect(), write(), resize(), end() y eventos connect/data/error/close.
const net = require('net');
const os = require('os');
const { EventEmitter } = require('events');
const { StringDecoder } = require('string_decoder');
const { readableNetError } = require('./net-errors');

class BaseTcpClient extends EventEmitter {
  constructor(protocol) {
    super();
    this.protocol = protocol;
    this.socket = null;
    this.connected = false;
    this.decoder = new StringDecoder('utf8');
  }

  // Los eventos de un socket descartado (reintento) se ignoran: solo cuenta this.socket.
  attach(socket, { host, port, timeout }) {
    this.socket = socket;
    const current = () => socket === this.socket;
    socket.setTimeout(timeout);
    socket.on('connect', () => {
      if (!current()) return;
      this.connected = true;
      socket.setTimeout(0);
      socket.setKeepAlive(true, 30000);
      this.onConnected();
      this.emit('connect');
    });
    socket.on('timeout', () => {
      if (!current() || this.connected) return;
      const error = new Error('timeout');
      error.code = 'ETIMEDOUT';
      socket.destroy(error);
    });
    socket.on('data', (buffer) => {
      if (current()) this.receive(buffer);
    });
    socket.on('error', (error) => {
      if (!current()) return;
      this.emit('error', new Error(readableNetError(error, { host, port, timeout, protocol: this.protocol })));
    });
    socket.on('close', () => {
      if (!current()) return;
      const rest = this.decoder.end();
      if (rest) this.emit('data', rest);
      this.emit('close');
    });
  }

  onConnected() {}

  receive(buffer) {
    const text = this.decoder.write(buffer);
    if (text) this.emit('data', text);
  }

  write(text) {
    if (this.socket && !this.socket.destroyed) this.socket.write(Buffer.from(String(text), 'utf8'));
  }

  resize() {}

  end() {
    if (this.socket) this.socket.end();
  }
}

// TCP raw: bytes tal cual, sin negociacion (puertos de consola en Opengear, Moxa, Lantronix, etc.).
class RawClient extends BaseTcpClient {
  constructor() {
    super('raw');
  }

  connect({ host, port, timeout = 15000 }) {
    this.attach(net.createConnection({ host, port }), { host, port, timeout });
    return this;
  }
}

// Rlogin (RFC 1282). Los servidores exigen puerto de origen 512-1023; en Windows se puede usar
// sin privilegios. Si no se puede (macOS/Linux sin root) se usa un puerto efimero y se avisa.
class RloginClient extends BaseTcpClient {
  constructor({ cols = 100, rows = 32, terminalType = 'xterm', speed = 38400, localPorts = [1023, 512] } = {}) {
    super('rlogin');
    this.cols = cols;
    this.rows = rows;
    this.terminalType = terminalType;
    this.speed = speed;
    this.localPorts = localPorts;
    this.awaitingAck = true;
    this.localPort = null;
  }

  connect({ host, port = 513, timeout = 15000, remoteUser = '', localUser }) {
    this.remoteUser = remoteUser;
    this.localUser = localUser || safeLocalUser();
    const [first, last] = this.localPorts;

    const attempt = (localPort) => {
      const options = { host, port };
      if (localPort) options.localPort = localPort;
      const socket = net.createConnection(options);
      // Registrado antes que attach(): decide si el error es de bind local y se reintenta.
      socket.once('error', (error) => {
        if (this.connected || !localPort) return;
        if (error.code === 'EADDRINUSE' && localPort > last) {
          this.socket = null;
          socket.destroy();
          attempt(localPort - 1);
        } else if (['EACCES', 'EPERM', 'EADDRINUSE'].includes(error.code)) {
          this.socket = null;
          socket.destroy();
          this.emit('notice', 'Sin puerto de origen privilegiado (512-1023): el servidor podria rechazar la sesion.');
          attempt(null);
        }
      });
      socket.once('connect', () => {
        this.localPort = localPort;
      });
      this.attach(socket, { host, port, timeout });
    };

    attempt(first);
    return this;
  }

  onConnected() {
    // Handshake: \0 usuario-local \0 usuario-remoto \0 terminal/velocidad \0
    this.socket.write(Buffer.concat([
      Buffer.from([0]),
      Buffer.from(`${this.localUser}\0${this.remoteUser}\0${this.terminalType}/${this.speed}\0`, 'utf8')
    ]));
  }

  receive(buffer) {
    let data = buffer;
    if (this.awaitingAck && data.length) {
      this.awaitingAck = false;
      if (data[0] === 0) data = data.subarray(1); // el servidor confirma con un byte 0
    }
    if (data.length) super.receive(data);
  }

  resize(cols, rows) {
    // Rlogin envia el tamano solo cuando el servidor lo pide con datos urgentes (OOB),
    // que Node no expone; enviarlo sin pedido escribiria basura en la sesion.
    this.cols = cols;
    this.rows = rows;
  }
}

function safeLocalUser() {
  try {
    return os.userInfo().username || 'console';
  } catch (_error) {
    return 'console';
  }
}

module.exports = { RawClient, RloginClient };
