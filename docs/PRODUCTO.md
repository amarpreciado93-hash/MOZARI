# Mozari · Producto

## Qué es
Editor y visor web de tours virtuales 360, como Kuula: todo en el navegador, sin descargar nada. Funciona en Mac, Windows, iPad y celular.

Meta final: la potencia de 3DVista con la facilidad de Kuula, diseño moderno y precio para Latinoamérica.

## Para quién
1. Alumnos de los cursos de R360 (cliente principal)
2. Operadores y fotógrafos 360 de Latinoamérica
3. Inmobiliarias y desarrolladores que producen sus propios tours

## Funciones de la v0.1
1. Esferas sin límite por proyecto
2. Multirresolución: esferas de hasta ~150 MP cortadas en tiles; carga ligera primero y detalle al hacer zoom
3. Hotspots animados (APNG con animación de respiración) para saltar entre esferas
4. Capas: texto y polígonos cerrados con relleno, trazo, grosor y color
5. Lotificación inteligente: 4+ puntos de referencia compartidos entre esferas y botón "aplicar a todas" que recoloca los polígonos en la nueva esfera (homografía sobre el plano del terreno)
6. Piloto automático: recorrido de cámara programado
7. Skin ligero adaptable a 16:9 y 9:16
8. Compartir el tour por link

## Metas de calidad
- Primera vista del tour en menos de 2 segundos en celular con datos
- Movimiento fluido en equipos de gama media
- Ninguna actualización rompe algo que ya funcionaba

## Tecnología base
- Motor de visualización: Marzipano (código abierto, licencia Apache 2.0)
- Código: GitHub privado a nombre del propietario
- Alojamiento web: Vercel o Cloudflare Pages
- Almacenamiento de esferas y tiles: Cloudflare R2 (sin costo por visualizaciones)
- Monitoreo de errores: Sentry

## Después de la v0.1 (pedidos registrados)
- Catálogo de hotspots: elegir el estilo de cada hotspot desde una biblioteca (APNG y otros)
- Acciones en hotspots, además de saltar de esfera (ej. abrir info, video, enlace, ficha de lote). Se definen más adelante.
- Rutas: el mapa de nodos marca escenas fuera de la ruta, sin salida, sueltas y con demasiados hotspots (límite actual: 4, ajustable)
