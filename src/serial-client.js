// Consola serial (cable de consola RJ45/USB) con la misma interfaz que los clientes TCP.
// "serialport" se carga bajo demanda: si no esta instalado, el resto de la app funciona igual.
const { EventEmitter } = require('events');
const { StringDecoder } = require('string_decoder');

let serialModule = null;
let serialLoadError = null;

function loadSerialPort() {
  if (serialModule || serialLoadError) return serialModule;
  try {
    serialModule = require('serialport');
  } catch (error) {
    serialLoadError = error;
  }
  return serialModule;
}

const MISSING = 'El modulo "serialport" no esta instalado: ejecute "npm install" en la carpeta del proyecto.';

function readableSerialError(error, path) {
  const message = String((error && error.message) || error || '');
  if (/access denied|EBUSY|resource busy|being used|Permission denied/i.test(message)) {
    return `El puerto ${path} esta en uso por otra aplicacion (PuTTY, otra terminal) o sin permisos.`;
  }
  if (/file not found|ENOENT|cannot find|no such file/i.test(message)) {
    return `No existe el puerto ${path}: revise el adaptador USB-serial y el Administrador de dispositivos.`;
  }
  return `Error en el puerto ${path}: ${message}`;
}

// macOS: /dev/tty.* espera la senal DCD (llamadas entrantes) y un cable de consola no la envia;
// para conectarse se usa el dispositivo /dev/cu.* equivalente.
function preferredPath(path, platform = process.platform) {
  return platform === 'darwin' ? String(path).replace(/^\/dev\/tty\./, '/dev/cu.') : path;
}

async function listSerialPorts() {
  const mod = loadSerialPort();
  if (!mod) return { ok: false, error: MISSING, ports: [] };
  const ports = await mod.SerialPort.list();
  const seen = new Set();
  return {
    ok: true,
    ports: ports
      .map((port) => ({ ...port, path: preferredPath(port.path) }))
      .filter((port) => !seen.has(port.path) && seen.add(port.path))
      .map((port) => ({
        path: port.path,
        description: port.friendlyName || port.manufacturer || '',
        manufacturer: port.manufacturer || '',
        serialNumber: port.serialNumber || ''
      }))
  };
}

class SerialClient extends EventEmitter {
  constructor() {
    super();
    this.port = null;
    this.connected = false;
    this.decoder = new StringDecoder('utf8');
  }

  // Cisco: 9600 8N1 sin control de flujo por defecto.
  connect({ path, baudRate = 9600, dataBits = 8, parity = 'none', stopBits = 1, flowControl = 'none' }) {
    const mod = loadSerialPort();
    if (!mod) {
      setImmediate(() => this.emit('error', new Error(MISSING)));
      return this;
    }
    if (!path) {
      setImmediate(() => this.emit('error', new Error('Seleccione un puerto serial (COM).')));
      return this;
    }

    const port = new mod.SerialPort({
      path,
      baudRate: Number(baudRate) || 9600,
      dataBits: Number(dataBits) || 8,
      parity,
      stopBits: Number(stopBits) || 1,
      rtscts: flowControl === 'rtscts',
      xon: flowControl === 'xonxoff',
      xoff: flowControl === 'xonxoff',
      autoOpen: false
    });
    this.port = port;
    this.path = path;

    port.on('data', (buffer) => {
      const text = this.decoder.write(buffer);
      if (text) this.emit('data', text);
    });
    port.on('error', (error) => {
      if (this.connected) this.emit('error', new Error(readableSerialError(error, path)));
    });
    port.on('close', (error) => {
      if (!this.connected) return;
      this.connected = false;
      if (error && error.disconnected) this.emit('notice', `Se desconecto el adaptador ${path}.`);
      this.emit('close');
    });
    port.open((error) => {
      if (error) {
        this.emit('error', new Error(readableSerialError(error, path)));
        return;
      }
      this.connected = true;
      this.emit('connect');
    });
    return this;
  }

  write(text) {
    if (this.port && this.connected) this.port.write(Buffer.from(String(text), 'utf8'));
  }

  resize() {}

  // Break: interrumpe el arranque para entrar a ROMMON (recuperacion de contrasena).
  sendBreak(durationMs = 500) {
    return new Promise((resolve, reject) => {
      if (!this.port || !this.connected) {
        reject(new Error('La consola serial no esta abierta.'));
        return;
      }
      this.port.set({ brk: true }, (error) => {
        if (error) {
          reject(error);
          return;
        }
        setTimeout(() => {
          this.port.set({ brk: false }, (releaseError) => (releaseError ? reject(releaseError) : resolve()));
        }, durationMs);
      });
    });
  }

  end() {
    if (this.port && this.port.isOpen) this.port.close();
  }
}

module.exports = { SerialClient, listSerialPorts, readableSerialError, preferredPath };
