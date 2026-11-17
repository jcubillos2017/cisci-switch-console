# Cisco Switch Console

Aplicacion de escritorio tipo PuTTY para administrar switches Cisco IOS por SSH o Telnet.

## Alcance inicial

- Conexion interactiva SSH y Telnet.
- Terminal integrada para ejecutar comandos en switches Cisco.
- Terminales multiples: 5 al iniciar y hasta 10 con el boton `+`; cambio rapido con `Alt+1`..`Alt+9` y `Alt+0`.
- Perfiles por equipo, modelo, IP, puerto y credenciales.
- Inventario persistente de switches.
- Importacion/exportacion de inventario en JSON y CSV.
- Respaldo automatico por SSH de `running-config` y `startup-config`.
- Comparacion basica entre `running-config` y `startup-config`.
- Timeout SSH configurable y modo Cisco legacy SSH para equipos antiguos.
- Generador de configuracion Cisco IOS para VLANs, interfaces, SSH, usuario local, gateway y guardado.
- Comandos rapidos y plantillas por familia Cisco Catalyst/CBS.
- Empaquetado como instalador de escritorio con Electron Builder.

> Nota: en este proyecto, "IOS" se entiende como **Cisco IOS**, el sistema operativo de los switches Cisco. No es una app movil para iOS de Apple.

## Requisitos

- Node.js 20 o superior.
- Acceso de red hacia los switches por SSH o Telnet.

## Uso en desarrollo

```powershell
npm install
npm start
```

## Crear instalador

### Windows

```powershell
npm run dist:win
```

El instalador queda en la carpeta `dist`.

Si el equipo Windows bloquea la generacion del instalador NSIS, use el instalador local:

```powershell
npm run dist:win:dir
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

Tambien puede ejecutar directamente:

```powershell
.\dist\win-unpacked\Cisco Switch Console.exe
```

### macOS

El instalador de Mac se genera desde una computadora Mac:

```bash
chmod +x ./build-mac.sh
./build-mac.sh
```

El archivo `.dmg` queda en `dist`. Ver detalles en `MAC-INSTALL.md`.

## Envio de configuracion con rollback

"Enviar Config" aplica la configuracion generada linea a linea sobre la sesion activa:

1. Verifica que el equipo este en privileged EXEC (`#`).
2. Programa `reload in N` (responde `no` a guardar) como red de seguridad.
3. Envia cada comando esperando el prompt; se detiene ante `% Invalid input`, `% Incomplete command`, timeouts o preguntas no previstas.
4. Responde automaticamente la pregunta de `crypto key generate rsa` cuando ya existen llaves (por defecto: no reemplazar).
5. Tras validar, "Confirmar y guardar" ejecuta `reload cancel` y `write memory`. Si pierde el acceso, el switch vuelve solo a la startup-config al vencer el plazo.

El generador no incluye credenciales por defecto: el secret del usuario local es obligatorio y el enable secret solo se modifica si se completa. En Catalyst 9200/9300 se usa `algorithm-type scrypt`.

## Respaldo automatico

"Respaldar" abre una sola sesion SSH y:

1. Detecta el prompt; si el usuario entra en user EXEC (`>`), ejecuta `enable` con el enable secret guardado en el perfil (un solo intento).
2. Verifica `show privilege`: con privilegio menor a 15, `show running-config` saldria parcial y el respaldo se cancela.
3. Desactiva la paginacion (`terminal length 0`, o `terminal datadump` en Small Business CBS); si el equipo no lo acepta, responde `--More--` automaticamente.
4. Captura `show running-config` y `show startup-config` esperando el prompt exacto del hostname (los banners con `#` o `% Error` no cortan la captura).
5. Solo guarda la running-config si termina en `end`; si el equipo no tiene startup-config lo informa como aviso.

## Seguridad recomendada

- Preferir SSH sobre Telnet.
- Usar usuarios individuales y contrasenas robustas.
- Guardar perfiles sin contrasena cuando el equipo sea compartido.
- "Recordar contrasena" cifra la clave con el almacen del sistema (`safeStorage`: DPAPI en Windows, Keychain en macOS). La clave cifrada solo se puede leer con el mismo usuario y equipo, y no se incluye al exportar. Los inventarios de versiones anteriores se migran automaticamente al abrir la app.
- El log de sesion registra solo lo que devuelve el equipo y enmascara secrets, passwords, communities SNMP y keys como `<oculto>`. Los respaldos `.cfg` conservan la configuracion completa (necesaria para restaurar): proteja esa carpeta.
- Validar las plantillas antes de aplicar cambios en produccion.

## Solucion de problemas

### Telnet

Telnet viaja en texto plano: uselo solo en laboratorio o para equipos sin SSH. El cliente negocia ECHO, SGA, tipo de terminal y tamano de ventana (NAWS), y usa como timeout de conexion el campo `Timeout SSH ms` (entre 5 y 30 s).

- "Conexion rechazada": el puerto no acepta Telnet; revise `transport input` en `line vty` o el puerto.
- "Sin respuesta ... en N s": host apagado o filtrado por ACL/firewall.
- "Host inalcanzable": revise IP, gateway o VLAN de gestion.
- "El equipo cerro la conexion": `access-class` en `line vty`, limite de sesiones VTY o puerto ocupado.

### Error: Timed out while waiting for handshake

Este error indica que la conexion TCP abre, pero la negociacion SSH no termina dentro del tiempo esperado.

Revise:

- Que el puerto configurado sea realmente SSH, normalmente `22`.
- Que el switch tenga SSH habilitado: `ip ssh version 2`, dominio, usuario local y llaves RSA.
- Que no este intentando SSH contra un puerto Telnet.
- Aumentar `Timeout SSH ms` a `60000` o `90000`.
- Activar `Cisco legacy SSH` si el switch usa IOS antiguo o algoritmos SHA1/CBC.

En Cisco IOS, una base tipica para SSH es:

```text
conf t
ip domain-name empresa.local
crypto key generate rsa modulus 2048
ip ssh version 2
username admin privilege 15 secret SuClaveSegura
line vty 0 15
login local
transport input ssh
end
write memory
```
