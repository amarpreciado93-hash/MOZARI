# Registro de decisiones

| Fecha | Decisión | Por qué |
|---|---|---|
| 2026-10-27 | Construir software propio en lugar de asociarse con Orbe 360 | Control total del código, la marca, los clientes y los ingresos |
| 2026-10-27 | Nombre del producto: Mozari | Corto, fácil de decir en español e inglés, sin coincidencias de software encontradas |
| 2026-10-27 | Plataforma web (no app de escritorio) | Funciona en cualquier sistema, sin comisiones de tiendas, arreglos llegan a todos al instante |
| 2026-10-27 | Marzipano como motor del visor | Gratuito, uso comercial permitido, soporta multirresolución |
| 2026-10-27 | Cloudflare R2 para almacenamiento | No cobra por tráfico; un tour viral no genera facturas sorpresa |
| 2026-10-27 | Cada tour publicado guarda su versión | Evitar que actualizaciones rompan tours existentes (problema común en 3DVista) |
| 2026-10-27 | Tiler propio en Python (OpenCV) que convierte la esfera en cubo multirresolución | Control total del proceso; es la pieza que después correrá en el servidor al subir una esfera |
| 2026-10-27 | Cara del cubo de 2^n o 3·2^n px, cada nivel el doble del anterior | Regla de Marzipano; una esfera de 149 MP queda en cara de 6144 px sin perder detalle |
| 2026-10-27 | Tiles de 512 px en producción | Carga rápida: solo baja lo que se ve. La demo usa tiles grandes solo para caber en el artifact |
| 2026-10-27 | Identidad aplicada desde la Guía visual de marca: verde lima #D5FF40, negro #0B0B0B, Poppins | Interfaz con la marca desde la base; todo sale de `marca/tokens.css` |
| 2026-10-27 | Isotipo vectorizado a SVG (`marca/vectores/`) | Los PNG oficiales venían recortados y descentrados; el SVG escala sin perder calidad |
| 2026-10-27 | Tipografía única: Poppins (se descarta Gilroy) | Gratuita, ya incluida vía Google Fonts y sin problemas de licencia |
| 2026-10-27 | Hotspot por defecto: círculo lima con animación de respiración hecha en CSS; acepta un APNG propio en el campo `icono` | Funciona sin archivos extra y pesa 0 KB; cuando lleguen los APNG solo se cambia el icono |
| 2026-10-27 | Hotspots guardados en `proyecto.json` como yaw/pitch en radianes + escena destino | Formato simple que después pasa tal cual a la base de datos |
| 2026-10-27 | Editor: tocar la esfera pone un hotspot; arrastrar sigue moviendo la vista | Mismo gesto en compu y celular, sin modos confusos |
| 2026-10-27 | Hotspots, polígonos y textos como capas por escena con orden tipo Photoshop | Todo convive en una ventana y se ordena igual |
| 2026-10-27 | Proyección propia esfera → pantalla, verificada contra Marzipano | Los polígonos quedan exactos desde cualquier ángulo |
| 2026-10-27 | El software se organiza en ventanas: Proyecto, Panoramas (Lista, Mapa, Editor), luego Skin y Publicar. El tour solo se abre completo con "Vista previa" | Separar el editor de lo que ve el cliente, como 3DVista/Kuula |
| 2026-10-27 | Ventana Proyecto: nombre, thumbnail, escena inicial, Little Planet al iniciar, música de fondo (volumen, repetir) | Lo que define el arranque y la identidad del tour |
| 2026-10-27 | Little Planet generado al cortar la esfera (`herramientas/planeta.py`, estereográfica desde el cenit) | Marzipano no lo trae; una imagen ligera por escena alcanza para la intro y para las miniaturas del mapa |
| 2026-10-27 | Mapa de nodos tipo Obsidian en Panoramas con revisión de ruta: inicio, escenas fuera de la ruta, sin salida, sueltas y más de 4 hotspots | Amar enseña a diseñar rutas; el mapa da conciencia de qué está conectado con qué |
| 2026-10-28 | Navegación en dos niveles como 3DVista: ventanas arriba (Mis Tours, Proyecto, Panoramas, Media, Skin, Publicar) y subpestañas debajo | El orden de 3DVista funciona una vez aprendido; aquí con nombres más claros y menos pestañas (Fotos, Videos, Planos y Audios juntos en Media) |
| 2026-10-28 | Se quita el efecto Little Planet al iniciar el tour | Se veía raro; el tour abre directo en el panorama inicial. Las imágenes Little Planet se siguen usando en el mapa de nodos |
| 2026-10-28 | Piloto automático por panorama: punto 1 = donde inicia la esfera; luego puntos con tiempo de viaje y pausa; al terminar repite, pasa a otro panorama o se queda quieto; si el usuario toma el control, retoma después de N segundos | Guía la mirada del cliente y permite tours que avanzan solos |
| 2026-10-28 | Skin configurable por tour: logo (Mozari o del cliente) y su posición, nombre, color de acento, color y opacidad de paneles, esquinas, menú de panoramas (miniaturas o pastillas, abajo o a la izquierda) y botones (pantalla completa, música, zoom, aviso de piloto) | Cada tour se adapta al manual de identidad del cliente sin tocar código |
| 2026-10-28 | Un solo skin con dos acomodos: 16:9 y 9:16. La vista previa elige el acomodo según la pantalla (vertical = 9:16, menú abajo para el pulgar) | Menos trabajo para el operador y consistencia entre compu y celular |
| 2026-10-28 | Skin con 4 plantillas base diseñadas (Cine, Desarrollo, Dock, Brújula) que luego se personalizan: logo, colores, opacidad, esquinas, botón de contacto y elementos | El primer skin era demasiado básico y genérico; cada plantilla tiene su propia estructura y uso (premium, venta, app, terrenos) |
| 2026-10-28 | Al fijar el inicio del piloto automático se toma una foto de esa vista y se usa como miniatura del panorama en Lista y en los menús del skin | La miniatura siempre muestra lo que el operador eligió ver primero |
| 2026-10-28 | Plantilla Desarrollo: menú de panoramas solo con texto grande y número, sin miniaturas | Se lee como menú de sitio de desarrollo, más limpio |
| 2026-10-28 | Pantalla de arranque con logo Mozari y crédito "Created by R360 Team"; el crédito también aparece al pie de Mis Tours y en la vista móvil | Firma de autoría de R360 Team en el software |
| 2026-10-28 | Crédito R360 Team rehecho en SVG (`marca/vectores/created-by-r360-team.svg`) con "Created" bien escrito | Los PNG originales dicen "Creted"; el SVG escala sin perder calidad y toma el color de la interfaz |
| 2026-10-28 | Skins del tour con colores neutros por defecto (acento blanco, panel negro translúcido, sin logo); el lima queda solo para el software | Los tours son para cualquier cliente y público; la marca Mozari no debe teñir sus interfaces |
| 2026-10-28 | Los hotspots toman el color de acento del skin | Todo el tour se ve de una sola pieza con la marca del cliente |
| 2026-10-28 | Lotificación por "Terreno": puntos de referencia del suelo marcados en dos esferas (mínimo 4) y una homografía del plano del suelo lleva cada lote a las demás esferas | El suelo visto desde un dron es un plano; con 4+ puntos la conversión es exacta. Se dibuja una vez y queda en todas |
| 2026-10-28 | Capas con "Aplicar a todas las esferas": polígonos y textos vinculados se actualizan en todas al editarlos en cualquiera; borrar uno los borra en todas | Un lote es el mismo en todas las vistas |
| 2026-10-28 | Precisión visible por punto y descarte automático del punto que no coincide (con 6 o más puntos) | Un clic mal puesto no debe torcer todos los lotes |
| 2026-10-28 | Detección automática de puntos con `herramientas/terreno.py` (vista cenital + SIFT + homografía robusta); la demo Central/Frontal se calibró así y coincide con el navegador a 0.001° | Base para el botón "Detectar puntos" cuando exista el servidor |
| 2026-10-28 | Textos y hotspots "Fijos en la esfera (3D)" por defecto: perspectiva real, crecen al acercarse, se pueden inclinar, girar, rotar en diagonal y estirar; asas sobre la esfera para rotar, escalar y estirar | Se ven como parte del lugar, no flotando frente a la cámara; un hotspot inclinado queda acostado en el piso |
| 2026-10-28 | Toda capa (polígono, texto, hotspot) puede tener acción al clic: ir a panorama, abrir enlace, página en ventana o imagen en ventana | Un lote puede abrir su ficha o render; las ventanas del tour usan colores neutros |
| 2026-10-28 | Al dibujar o ajustar puntos: mira visible y lupa ×3 con detalle real de la esfera | Precisión en esquinas de lotes |
| 2026-10-28 | Deshacer y rehacer con Cmd/Ctrl + Z y Cmd/Ctrl + Shift + Z; cada gesto es un paso | Nadie trabaja sin deshacer |
| 2026-10-28 | Piloto: bloque "Vista de inicio" con encuadre de celular 9:16 y selector del panorama donde empieza el tour | Elegir el inicio pensando en cómo se verá en el teléfono |
| 2026-10-28 | En Capas y Piloto, tira vertical de panoramas a la izquierda: clic para ir, arrastrar a la esfera para conectar | Navegar sin salir del editor; conectar es un gesto, no un formulario |
| 2026-10-28 | Conexión por arrastre crea hotspot de ida donde se suelta y de regreso atrás (yaw + 180°; exacto en esferas del mismo terreno), enlazados como par | Ida y vuelta en un solo paso, como se enseña en las rutas |
| 2026-10-28 | "Al llegar: ver de frente": la vista de llegada se calcula del hotspot de regreso (su yaw + 180°) y conserva la inclinación y zoom de inicio de la esfera; también lo usa el piloto al pasar al siguiente panorama | Se siente que caminas hacia adelante; si se acomoda el regreso, el frente se corrige solo |
| 2026-10-28 | Doble clic en un hotspot dentro del editor entra al panorama destino con su vista de llegada | Probar la ruta sin abrir la vista previa |
| 2026-10-28 | Textos aplicados a varias esferas quedan siempre de frente por defecto | Su giro en 3D cambia con cada punto de vista |
| 2026-10-28 | Nuevo tipo de capa "Lote" (polígono lotificado): número, manzana, superficie, precio, medidas por lado con frente marcado y estado | Así se lotifica en la práctica; deja de llamarse "polígono" |
| 2026-10-28 | Estados Disponible / Apartado / Vendido con colores editables por proyecto; el lote toma el color de su estado | El cliente ve de un vistazo qué está libre |
| 2026-10-28 | El estado, la superficie y el precio son del lote, no de la esfera: se sincronizan por número y manzana (o por vínculo de terreno) en todas las esferas y fichas | Se cambia una vez y queda bien en todo el tour |
| 2026-10-28 | Rótulos sobre la esfera: número y manzana al centro, superficie abajo y medida de cada lado sobre su borde; se ajustan al tamaño del lote y se ocultan si no caben | Legibles de cerca y de lejos sin tapar la imagen |
| 2026-10-28 | Botón Lote con numeración automática (cada lote sigue al anterior en su manzana) | Lotificar rápido, lote tras lote |
| 2026-10-28 | Panoramas → Lotes: tabla con todos los lotes, conteo por estado, % vendido, edición de superficie, precio y estado | Actualizar disponibilidad cada semana sin buscar esfera por esfera |
| 2026-10-28 | Acción "Ficha del lote" (por defecto en lotes): ventana con estado, superficie, frente, lados, precio y botón de contacto del skin; sin precio ni botón si está vendido | Lo que el comprador necesita para decidir |
| 2026-10-28 | Rótulo del lote "Planchado en el lote" por defecto: número, manzana, superficie y medidas se pintan sobre el suelo con la perspectiva real (homografía del piso → matrix3d); opción "Siempre de frente" | El texto no sigue a la cámara: se ve impreso en el terreno |
| 2026-10-28 | Orientación fija por esfera y por lote: legible y nunca en espejo; cerca del dron sigue el frente de la vista de inicio, lejos apunta hacia afuera | Todos los rótulos de una vista se leen igual |
| 2026-10-28 | Control de tamaño y giro del rótulo, rollover opcional por lote y colores de estado editables desde el panel del lote | Control total del diseño de la lotificación |
| 2026-10-28 | Medidas dentro del lote, abajo de su borde, separadas del trazo | Se leen sin que el borde las tape |
| 2026-10-28 | Ventanas del tour (ficha, imagen, página) centradas y medidas contra su contenedor (container queries), no contra la ventana del navegador | Se ven bien en 16:9, 9:16 y dentro del marco del editor de skin |
| 2026-10-28 | Borrar panoramas desde Lista con confirmación en la tarjeta; se quitan sus capas, los hotspots que llevan a él y referencias (piloto, terreno, inicio); se puede deshacer; no reaparece aunque venga en el archivo del proyecto | Limpiar el tour sin romper conexiones |
| 2026-10-28 | Rótulos y medidas de lotes en una capa propia encima de todos los rellenos (y debajo de textos y hotspots) | El relleno de un lote vecino ya no tapa las medidas |
| 2026-10-28 | Modo presentación en Proyecto → Presentación: si nadie toca el tour durante el tiempo elegido (10 s a 5 min, 1 min por defecto), pasa solo a la siguiente esfera; al final vuelve a la primera o se queda | Pantallas en salas de venta y ferias |
| 2026-10-28 | Cada esfera decide: "Pasa a la siguiente", "Se queda aquí" o "Se salta"; el orden se cambia con flechas y es el mismo orden de Panoramas | Detener la presentación en la esfera clave sin apagarla |
| 2026-10-28 | La presentación espera a que termine el piloto automático de la esfera y llega "de frente" si hay hotspot entre las dos; no corre en el editor de skin | Que no corte recorridos ni brinque raro |
| 2026-10-28 | Medidas de lote en blanco y seminegrita con sombra fina; se corrigió un choque de nombres de estilo que las pintaba grises (parecían debajo del relleno) | Se leen sobre cualquier color y opacidad de relleno |
| 2026-10-28 | Nube en Cloudflare con dos Workers sobre un mismo R2: `mozari-estudio` (privado, detrás de Cloudflare Access) y `mozari-tours` (público, solo lectura) | Separar lo que se edita de lo que ve el público; el público no puede escribir nada |
| 2026-10-28 | El estudio exige token válido de Cloudflare Access (firma, AUD, vencimiento, emisor); sin configuración no deja entrar a nadie | Seguro por defecto |
| 2026-10-28 | "Publicar" copia el borrador a `publicado/<id>/proyecto.json`; el público nunca ve el borrador | Editar sin romper el tour que ya está en manos del cliente |
| 2026-10-28 | Despliegue automático conectando el repo de GitHub a Cloudflare (Workers Builds); cada Push origin publica | Sin comandos ni pasos manuales |
| 2026-10-28 | En línea en Cloudflare: estudio en mozari-estudio.amarpreciado93.workers.dev (protegido con Access, solo miembros de la cuenta) y tours en mozari-tours.amarpreciado93.workers.dev; ambos se publican solos con cada Push | Mozari ya vive en la nube de R360 |
| 2026-10-28 | Estudio en línea: Mis Tours lista, crea, abre y borra los tours guardados en R2; cada cambio se guarda solo en la nube (aviso "Guardado en la nube" / "Sin conexión, reintentando…") | Trabajar desde cualquier compu sin perder nada |
| 2026-10-28 | Subir esfera desde el navegador: la propia compu corta la foto en piezas multirresolución con la tarjeta de video (WebGL) y las sube de 6 en 6; una de 150 MP tarda ~1.5 min | Sin servidores que procesar ni costos extra |
| 2026-10-28 | Publicar desde el estudio: guarda lo pendiente, congela el tour y da el link para copiar | Un clic para entregar al cliente |
| 2026-10-28 | El tour público usa el mismo programa del estudio en modo "tour" (solo el visor, sin herramientas) | Un solo programa que mantener: lo que se ve en la vista previa es lo que ve el cliente |
| 2026-10-28 | herramientas/construir.py arma estudio/index.html desde el visor | Una sola fuente del programa |
| 2026-10-28 | Las capas (lotes, textos, hotspots) se pintan en el mismo cuadro que la esfera, justo después de que Marzipano dibuja | Antes iban un cuadro atrás y se veían despegadas al girar |
| 2026-10-28 | Rótulo del lote al alejarse: "Lote 3 · Mz B" → "3 · B" → "3", el primero que quepa; las versiones cortas siempre a letra legible | El número del lote nunca se borra y no se enciman |
| 2026-10-28 | El giro del rótulo se aplica después de la orientación automática: gira parejo en sentido del reloj y el programa ya no lo voltea solo | Antes brincaba 180° a medio giro |
| 2026-10-29 | En Capas, la tira de panoramas se reordena arrastrando arriba o abajo; es el orden de Panoramas y de la presentación | Ordenar el recorrido sin salir de Capas |
| 2026-10-29 | Tres estilos nuevos de hotspot con respiración propia: Regresar (flecha que empuja hacia atrás), Puerta (halo que respira) e Información (latido doble) | Distinguir a dónde lleva cada hotspot de un vistazo |
| 2026-10-29 | Panoramas → Masterplan: plano de los lotes visto desde arriba, armado solo con el suelo del terreno; conteo por estado, % vendido, m² vendidos, cambio de estado al tocar y descarga en PNG | Ver y compartir el avance de la venta sin trabajo extra |
| 2026-10-29 | Terreno con lupa ×3 y mira; desde el 5º punto marca "Aquí debería ir" en la otra esfera y gira hacia allá; avisa si un punto cae lejos de lo esperado o muy cerca del horizonte | Puntos más precisos y errores detectados al momento |
| 2026-10-29 | Guía "Cómo lograr un trazo preciso" y límites del terreno (supone suelo plano y horizonte derecho) | Saber cuándo confiar en el trazo |
| 2026-10-29 | En la nube, música, portada, miniaturas, imágenes de acciones y logo se suben como archivos del tour (archivos/…) en vez de ir incrustados en el proyecto | Suenan y se ven en el link publicado; el proyecto pesa KB, no MB |
| 2026-10-29 | Etapa 2 · Cuentas: se entra con Google (proyecto Mozari en Google Cloud); sesión firmada en cookie de 30 días; cada tour pertenece a una cuenta (cuentas/<uid>/tours/<id>) y nadie toca tours ajenos | Vender Mozari como Kuula: cada alumno o cliente con su espacio |
| 2026-10-29 | La página principal es el escaparate para quien no ha entrado y el estudio para quien sí; arriba a la derecha va tu foto y Salir | Una sola dirección para todo |
| 2026-10-29 | Cloudflare Access deja de usarse en el estudio; el dueño (ADMIN) se queda con los tours creados antes de las cuentas | Los usuarios nunca ven Cloudflare |
