# Instalacion en macOS

El `.dmg` se genera en macOS. Hay dos formas de obtenerlo.

## Opcion 1: GitHub Actions (recomendada, no requiere Mac)

El workflow `.github/workflows/build.yml` compila en runners de GitHub:

- `Cisco Switch Console-<version>-mac-arm64.dmg` (Apple Silicon: M1, M2, M3, M4)
- `Cisco Switch Console-<version>-mac-x64.dmg` (Mac con procesador Intel)
- los `.zip` equivalentes y el instalador de Windows `Cisco Switch Console-Setup-<version>.exe`

Para publicar una version:

```powershell
git tag v0.3.0
git push origin v0.3.0
```

Al terminar (unos 10-15 minutos) los archivos quedan en **GitHub > Releases**. Tambien se puede ejecutar a mano desde **Actions > Build instaladores > Run workflow**; en ese caso los archivos quedan como *artifacts* de la ejecucion.

## Opcion 2: compilar en una Mac

Requisitos: macOS 12 o superior, Node.js 20 o superior y Xcode Command Line Tools (`xcode-select --install`).

```bash
chmod +x ./build-mac.sh
./build-mac.sh          # arquitectura de esta Mac
./build-mac.sh x64      # o forzar Intel / arm64
```

Los archivos quedan en `dist`.

## Instalar en la Mac

1. Abrir el `.dmg` que corresponde al procesador (menu Apple > Acerca de esta Mac: "Apple M..." = arm64, "Intel" = x64).
2. Arrastrar `Cisco Switch Console` a `Applications`.
3. La primera vez, abrirla con **clic derecho > Abrir**. Si macOS la bloquea, ir a **Configuracion del Sistema > Privacidad y seguridad** y presionar **Abrir de todos modos**.

La app tiene firma ad-hoc, no firma de Apple Developer: macOS la muestra como de "desarrollador no verificado". Si aun asi aparece el mensaje de que la app "esta danada", quitar la marca de cuarentena:

```bash
xattr -dr com.apple.quarantine "/Applications/Cisco Switch Console.app"
```

Al guardar contrasenas en un perfil, macOS puede pedir permiso para usar el Llavero ("Cisco Switch Console Safe Storage"): presione **Permitir siempre**.

## Consola serial en Mac

- Los adaptadores aparecen como `/dev/cu.usbserial-...`, `/dev/cu.SLAB_USBtoUART` (Silicon Labs) o `/dev/cu.usbmodem...`. La app usa siempre el dispositivo `cu.*`.
- Si el puerto no aparece, instale el driver **CP210x VCP para Mac** de Silicon Labs (switches con consola micro-USB como el Catalyst 9200CX) o el del fabricante del adaptador.

## Distribucion formal

Para distribuir a otros usuarios sin avisos de seguridad, firme y notarice con una cuenta Apple Developer: configure `CSC_LINK`, `CSC_KEY_PASSWORD` y las credenciales de notarizacion como *secrets* del repositorio y cambie `mac.identity` en `package.json`.
