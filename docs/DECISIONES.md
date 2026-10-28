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
