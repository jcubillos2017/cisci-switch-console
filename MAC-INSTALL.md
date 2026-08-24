# Instalacion en macOS

Esta aplicacion puede instalarse en Mac como un archivo `.dmg`, pero el `.dmg` debe generarse desde una computadora Mac o desde un servicio de compilacion que use macOS.

## Requisitos en la Mac

- macOS 12 o superior.
- Node.js 20 o superior.
- Acceso de red hacia los switches Cisco por SSH o Telnet.

## Generar instalador DMG

Desde Terminal, dentro de la carpeta del proyecto:

```bash
chmod +x ./build-mac.sh
./build-mac.sh
```

Al terminar, los archivos quedan en la carpeta `dist`:

- `Cisco Switch Console-0.2.1.dmg`
- `Cisco Switch Console-0.2.1-mac.zip`

## Instalar en la Mac

1. Abrir el archivo `.dmg`.
2. Arrastrar `Cisco Switch Console` a `Applications`.
3. Abrir la aplicacion desde `Applications`.

## Aviso de seguridad de macOS

Esta primera version queda sin firma digital de Apple. Si macOS muestra un aviso de seguridad:

1. Abrir `System Settings`.
2. Entrar a `Privacy & Security`.
3. Autorizar la apertura de `Cisco Switch Console`.

Para distribucion formal a otros usuarios, se recomienda firmar y notarizar la aplicacion con una cuenta Apple Developer.

## Comando directo

Tambien puede generarse manualmente con:

```bash
export CSC_IDENTITY_AUTO_DISCOVERY=false
npm install
npm run dist:mac
```
