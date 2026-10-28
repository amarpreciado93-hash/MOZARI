# Visor (bloque 1)

Muestra las escenas de un proyecto con multirresolución.

## Cómo preparar un proyecto

1. Corta cada esfera con el tiler:

   ```
   python3 herramientas/tiler.py muestras/PlayaLinda-1.jpg --id playa-linda --nombre "Playa Linda" --salida visor/escenas
   ```

   Por defecto usa tiles de 512 px (producción). Requiere Python 3 con `numpy` y `opencv-python`.

2. Lista las escenas en `visor/proyecto.json`:

   ```json
   { "nombre": "Mi proyecto", "escenas": ["playa-linda"] }
   ```

3. Agrega a cada `escena.json` el campo `peso` (bytes totales de sus tiles) para la barra de descarga.

El visor necesita abrirse desde un servidor web (no funciona con doble clic al archivo).

## Reglas de Marzipano que respeta el tiler

- Cada nivel mide exactamente el doble que el anterior.
- El número de tiles por lado de cada nivel es múltiplo del nivel anterior.
- Por eso la cara del cubo siempre mide 2^n o 3·2^n px.

> Nota (27 oct): el visor se integró al **Estudio** (`estudio/index.html`). Esta carpeta queda como referencia del bloque 1.
