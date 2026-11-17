// Mensajes legibles para errores de conexion TCP (Telnet, TCP raw, Rlogin).
const REFUSED_HINTS = {
  ssh: 'el puerto no acepta SSH (SSH deshabilitado, "transport input" sin ssh o puerto incorrecto)',
  telnet: 'el puerto no acepta Telnet (line vty con "transport input ssh" o puerto incorrecto)',
  raw: 'nadie escucha en ese puerto (revise el puerto TCP del servidor de consolas)',
  rlogin: 'el equipo no acepta Rlogin (IOS-XE y la mayoria de IOS no lo ofrecen como servidor)'
};

function readableNetError(error, { host, port, timeout = 15000, protocol = 'telnet' } = {}) {
  const target = `${host}:${port}`;
  switch (error && error.code) {
    case 'ECONNREFUSED':
      return `Conexion rechazada en ${target}: ${REFUSED_HINTS[protocol] || 'el puerto no acepta conexiones'}.`;
    case 'ETIMEDOUT':
      return `Sin respuesta de ${target} en ${Math.round(timeout / 1000)} s: host apagado, inalcanzable o filtrado por ACL/firewall.`;
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `Host ${target} inalcanzable: revise IP, gateway o VLAN de gestion.`;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `No se pudo resolver el nombre "${host}".`;
    case 'ECONNRESET':
      return 'El equipo cerro la conexion (access-class en line vty, limite de sesiones o puerto ocupado).';
    default:
      return error && error.message ? error.message : 'Error de conexion';
  }
}

const NET_ERROR_CODES = ['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET'];

module.exports = { readableNetError, NET_ERROR_CODES };
