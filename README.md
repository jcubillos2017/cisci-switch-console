# Cisco Switch Console

Aplicacion de escritorio tipo PuTTY para administrar switches Cisco IOS por SSH o Telnet.

## Alcance inicial

- Conexion interactiva SSH y Telnet.
- Terminal integrada para ejecutar comandos en switches Cisco.
- Perfiles por equipo, modelo, IP, puerto y credenciales.
- Inventario persistente de switches.
- Importacion/exportacion de inventario en JSON y CSV.
- Respaldo automatico por SSH de `running-config` y `startup-config`.
- Comparacion basica entre `running-config` y `startup-config`.
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

## Seguridad recomendada

- Preferir SSH sobre Telnet.
- Usar usuarios individuales y contrasenas robustas.
- Guardar perfiles sin contrasena cuando el equipo sea compartido.
- Validar las plantillas antes de aplicar cambios en produccion.
