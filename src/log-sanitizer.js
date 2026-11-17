// Log de sesion sin secretos: reconstruye cada linea como se ve en pantalla
// (ANSI, backspace, retorno de carro) y enmascara credenciales antes de escribirla.
const os = require('os');

const MASK = '<oculto>';
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b[()][A-Za-z0-9]|\x1b[=>78DEHM]/g;
const MAX_PENDING = 8192;

// IOS acepta comandos abreviados ("en sec", "usern ... pass"): se cubren los prefijos.
function abbrev(word, minLength) {
  const required = word.slice(0, minLength);
  const optional = word.slice(minLength).split('').reduceRight((tail, char) => `(?:${char}${tail})?`, '');
  return `${required}${optional}`;
}

const SECRET = abbrev('secret', 3);
const PASSWORD = abbrev('password', 3);
const COMMUNITY = abbrev('community', 4);
const TYPE = '(?:[0-9]\\s+)?';
const LEVEL = '(?:level\\s+\\d+\\s+)?';

// Cada regla conserva el grupo 1 (palabra clave) y reemplaza el grupo 2 (valor).
// El orden importa: md5 antes que authentication-key.
const RULES = [
  new RegExp(`(\\bmd5\\s+${TYPE})(\\S+)`, 'g'),
  new RegExp(`(\\b(?:${SECRET}|${PASSWORD})\\s+${LEVEL}${TYPE})(\\S+)`, 'g'),
  new RegExp(`(\\bpassword-encrypt\\s+)(\\S+)`, 'g'),
  new RegExp(`(\\bsnmp-server\\s+${COMMUNITY}\\s+)(\\S+)`, 'g'),
  /(\bsnmp-server\s+host\s+\S+(?:\s+(?:informs|traps))?(?:\s+version\s+(?:1|2c|3(?:\s+(?:auth|noauth|priv))?))?\s+)(\S+)/g,
  /(\b(?:auth\s+(?:md5|sha)|priv\s+(?:des|3des|aes(?:\s+\d+)?))\s+)(\S+)/g,
  new RegExp(`(\\b(?:key-string|authentication-key)\\s+(?!(?:[0-9]\\s+)?md5\\b)${TYPE})(\\S+)`, 'g'),
  new RegExp(`(\\b(?:tacacs-server|radius-server)\\s+key\\s+${TYPE})(\\S+)`, 'g'),
  new RegExp(`(^\\s*key\\s+(?!chain\\b|config-key\\b)${TYPE})(\\S+)`, 'g'),
  /(\bpre-shared-key\s+)(.+)/g
];

function renderLine(raw) {
  const text = String(raw).replace(ANSI, '');
  const cells = [];
  let cursor = 0;
  for (const char of text) {
    if (char === '\b' || char === '\x7f') {
      cursor = Math.max(0, cursor - 1);
    } else if (char === '\r') {
      cursor = 0;
    } else if (char === '\t' || char >= ' ') {
      cells[cursor] = char;
      cursor += 1;
    }
  }
  return Array.from(cells, (cell) => (cell === undefined ? ' ' : cell)).join('').trimEnd();
}

function sanitizeLine(line) {
  return RULES.reduce((text, rule) => text.replace(rule, (_match, keyword) => `${keyword}${MASK}`), line);
}

function createSanitizedLog(stream, eol = os.EOL) {
  let pending = '';
  const writeLine = (raw) => stream.write(`${sanitizeLine(renderLine(raw))}${eol}`);

  return {
    write(chunk) {
      pending += String(chunk);
      let index = pending.indexOf('\n');
      while (index !== -1) {
        writeLine(pending.slice(0, index));
        pending = pending.slice(index + 1);
        index = pending.indexOf('\n');
      }
      if (pending.length > MAX_PENDING) {
        writeLine(pending);
        pending = '';
      }
    },
    end() {
      const last = sanitizeLine(renderLine(pending));
      if (last) stream.write(`${last}${eol}`);
      pending = '';
      stream.end();
    }
  };
}

module.exports = { createSanitizedLog, sanitizeLine, renderLine, MASK };
