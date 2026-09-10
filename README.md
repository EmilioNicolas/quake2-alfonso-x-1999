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

En movil, mejor en horizontal: el joystick izquierdo mueve y arrastrar la derecha apunta. Mirar, tocar o mantener la zona derecha **no dispara**. Hay un unico boton **DISPARAR**, circular a la derecha: dispara mientras se mantiene pulsado, con dedos independientes del movimiento y la mirada. **SALTAR** salta; el selector **ARMAS · ANT. / SIG.** recorre todas las armas disponibles, **AGACHAR** mantiene el agachado y **USAR** activa el objeto seleccionado. Las acciones tienen objetivos tactiles de al menos 48 x 48 px; DISPARAR tiene 88 x 88 px con un circulo visible de 72 px. El margen transparente tambien acepta pulsaciones y el control se ilumina al mantenerlo.

El HUD movil muestra **salud, municion y armadura reales**, leidas del estado del jugador del servidor local del motor. Tres indicadores oscuros con detalles de laton apagado ocupan como maximo 240 x 44 px, con numeros de 24 px, etiquetas de 10 px y aviso de salud baja. El blaster indica municion ilimitada (∞), y la armadura sin equipar indica 0. La mira central blanca tiene contorno oscuro. El HUD ocupa una franja propia encima de los controles y respeta las zonas seguras. El escritorio conserva el HUD original del motor.

Si los datos dejan de estar disponibles o su lectura falla, se borran los valores anteriores y se restauran el HUD y la mira nativos. Si tambien falla la restauracion, se muestra el error con opcion de recargar.

El boton Ⅱ abre la pausa y recuerda los controles en español. Al pasar a otra app o perder el foco se sueltan las acciones y se solicita pausar la partida; CONTINUAR reanuda sin recuperar pulsaciones antiguas. La interfaz cambia de estado solo cuando el puente acepta el comando: si falta o falla, mantiene el estado anterior y registra el error. No hay autoapuntado ni disparo automatico: solo se dispara mientras hay una pulsacion explicita en DISPARAR.

La pagina pide pantalla completa y orientacion horizontal cuando el navegador lo permite; tambien funciona sin esas APIs. El juego y los controles respetan las zonas seguras de la pantalla. En movil, un cambio de tamano actualiza tambien la resolucion del motor; reinicia el renderer y conserva la partida, aunque puede producir una pausa breve. La portada permite desplazarse en pantallas bajas. Al girar, cambiar el tamano de la ventana o pasar a otra app se sueltan los controles para evitar acciones atascadas.

En dispositivos tactiles se solicitan 0 muestras MSAA y filtrado anisotropico 4x, frente a 16 y 16x en escritorio, para reducir el coste de los buffers y del filtrado. Se conservan texturas, iluminacion, sombras y sensibilidad. Es una reduccion de trabajo solicitado al renderer, no una mejora de FPS medida en un telefono.

## Comprobar cambios

Sirve la carpeta con `python3 -m http.server 8000` y abre `http://localhost:8000`. El juego descarga aproximadamente 188 MB de archivos PAK desde el CDN al pulsar JUGAR, ademas del motor servido con la pagina. La portada avisa de que puede tardar varios minutos. Muestra conexion, espera de datos, bytes recibidos y archivo actual; al terminar la descarga distingue el inicio del motor, sin asignarle un porcentaje ficticio. El indicador de espera respeta la preferencia de movimiento reducido. La cifra en MB usa unidades de 1024 x 1024 bytes, redondeadas.

Ejecuta `node --test tests/*.test.cjs` con Node.js 18 o posterior. Las pruebas usan eventos y descargas simulados para comprobar carga, errores y controles; no ejecutan WebAssembly ni sustituyen las pruebas de juego en navegador. No necesitan dependencias ni red.

La descarga reintenta tras 30 segundos sin recibir cabeceras o nuevos bytes, incluso si una lectura no responde a la cancelacion. Si el navegador no expone un cuerpo legible por streaming, usa `arrayBuffer()` con un limite de 120 segundos por archivo; en ese modo solo puede contar los bytes al terminar el archivo. El progreso muestra bytes o KB antes de llegar al primer MB.

Se mantienen hasta dos reintentos por archivo. Si una respuesta de error recuperable expone `Retry-After`, se respeta tanto en segundos como en fecha HTTP. Las esperas automaticas llegan hasta 120 segundos; si el servidor pide mas tiempo, se informa del plazo y se bloquea un nuevo intento en esa pagina hasta que termine, sin acortarlo. Sin una cabecera valida y accesible por CORS, se conserva la espera de 2 y 4 segundos. No se realizan sondeos adicionales al CDN.

Las regresiones de carga cubren lecturas bloqueadas, respuestas tardias, reintentos y navegadores sin streaming. Las pruebas de memoria comprueban las copias de los archivos y ejecutan las funciones FS/MEMFS incluidas en `index.js` para verificar que el sistema de archivos adopta los buffers finales sin duplicarlos. Estas pruebas no miden la memoria de un dispositivo fisico.

Las pruebas de controles incluyen cinco dedos simultaneos, cancelacion, giros, cambio de viewport, pausa, controles secundarios y ausencia de disparos al tocar o arrastrar la mirada. Las pruebas del puente del motor comprueban valores reales de la estructura de estado, memoria ampliada, ABI incompatible, entrada relativa de SDL y cambios de resolucion. Las pruebas de adaptacion incluyen iPad con user-agent de escritorio, pantallas anchas y fallos de las APIs de pantalla completa/orientacion. Para ver cada caso con Node.js 24 se puede usar `node --test --test-isolation=none --test-reporter=spec tests/*.test.cjs`.

Abre `http://localhost:8000/tests/responsive.html` para comprobar geometria real en ocho tamanos de ventana, de 320 x 568 a 1440 x 900. Este ejecutor comprueba contenido alcanzable, ausencia de solapamientos, objetivos tactiles y sus margenes transparentes, etiquetas en español, HUD compacto, proporcion del canvas y cambios de altura; simula las zonas seguras y bloquea la descarga del juego y la ejecucion del motor. La automatizacion por CDP puede esperar `window.layoutTestRun` y leer `window.layoutTestResults`. No sustituye una prueba de WebGL, gestos reales ni areas seguras de iOS. Antes de publicar, revisar la portada y jugar en horizontal y vertical en un navegador real, incluyendo movimiento + mirada + DISPARAR + SALTAR, giro durante un gesto y vuelta desde otra app.

Las pruebas reales por CDP estan en `tests/mobile-browser.cjs` (Node.js 22+, Chromium con depuracion remota, sin dependencias npm). Ejecutan el motor WebAssembly, descargan los PAK, envian contactos tactiles simultaneos, comprueban posicion/angulo/municion en el motor y guardan capturas. Estado de esta revision: **125/125 pruebas sin navegador y 19/19 comprobaciones de navegador superadas (incluyen ocho casos de geometria)**. Detalles, instrucciones y archivos modificados: [ajuste del HUD y controles](docs/mobile-ux-refinement.md). La [revision anterior](docs/mobile-ux-review.md) conserva capturas historicas que no muestran este diseño. Las pruebas por CDP no sustituyen una prueba fisica de Android o Safari/iOS.

## Creditos

- **Mapas y texturas:** [Emilio](https://x.com/emailnicolas) y [Javi](https://x.com/javilop), 1999
- **Motor:** [Quake II](https://github.com/id-Software/Quake-2) (id Software, 1997)
- **Port web:** [Qwasm2](https://github.com/GMH-Code/Qwasm2) (WebAssembly port de Yamagi Quake II)
