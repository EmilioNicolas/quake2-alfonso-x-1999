# Quake 2 - Instituto Alfonso X, Murcia (1999)

Salva al Instituto Alfonso X de la invasion alienigena. Recorre sus pasillos, clases y el salon de actos en estos mapas custom de Quake II creados en 1999 con texturas originales.

**Creado por [Emilio](https://x.com/emailnicolas) y [Javi](https://x.com/javilop) en 1999.**

## Jugar online

**[https://emilionicolas.github.io/quake2-alfonso-x-1999/](https://emilionicolas.github.io/quake2-alfonso-x-1999/)** - Jugable directamente en el navegador.

## Controles

| Tecla | Accion |
|-------|--------|
| WASD | Movimiento |
| Mouse | Mirar |
| Click izquierdo | Disparar |
| Space | Saltar |
| Shift izquierdo | Agacharse |
| 1-9 | Cambiar arma |
| E | Usar item |
| Scroll | Cambiar arma |

Haz click en el juego para capturar el raton; Escape lo libera. Si no se captura al iniciar, vuelve a hacer click.

En movil, arrastra la mitad izquierda para moverte y la derecha para mirar. Puedes combinar movimiento, mirada, disparo y salto con varios dedos. Los botones FIRE mantienen el disparo mientras los pulsas; un toque breve en la zona derecha tambien dispara.

## Comprobar cambios

Sirve la carpeta con `python3 -m http.server 8000` y abre `http://localhost:8000`. El juego descarga unos 187 MB de recursos desde el CDN al pulsar JUGAR.

Ejecuta `node --test tests/*.test.cjs` con Node.js 18 o posterior. Las pruebas usan eventos y descargas simulados para comprobar carga, errores y controles; no ejecutan WebAssembly ni sustituyen las pruebas de juego en navegador. No necesitan dependencias ni red.

La descarga reintenta tras 30 segundos sin recibir cabeceras o nuevos bytes, incluso si una lectura no responde a la cancelacion. Si el navegador no expone un cuerpo legible por streaming, usa `arrayBuffer()` con un limite de 120 segundos por archivo; en ese modo solo puede contar los bytes al terminar el archivo. El progreso muestra bytes o KB antes de llegar al primer MB.

Las regresiones de carga cubren lecturas bloqueadas, respuestas tardias, reintentos y navegadores sin streaming. Las pruebas de memoria comprueban las copias de los archivos y ejecutan las funciones FS/MEMFS incluidas en `index.js` para verificar que el sistema de archivos adopta los buffers finales sin duplicarlos. Estas pruebas no miden la memoria de un dispositivo fisico.

## Creditos

- **Mapas y texturas:** [Emilio](https://x.com/emailnicolas) y [Javi](https://x.com/javilop), 1999
- **Motor:** [Quake II](https://github.com/id-Software/Quake-2) (id Software, 1997)
- **Port web:** [Qwasm2](https://github.com/GMH-Code/Qwasm2) (WebAssembly port de Yamagi Quake II)
