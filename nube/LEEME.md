# Mozari en la nube (Cloudflare)

Dos Workers que comparten el mismo almacén R2 (`mozari`):

| Worker | Para qué | Quién entra |
|---|---|---|
| `mozari-estudio` (`estudio.jsonc`) | El estudio y su API para guardar tours y subir esferas | Solo correos autorizados en Cloudflare Access |
| `mozari-tours` (`tours.jsonc`) | Los tours publicados, de solo lectura | Cualquiera con el link |

## Estructura en R2
- `tours/<id>/proyecto.json`: borrador que edita el estudio
- `tours/<id>/escenas/<esfera>/...`: piezas multirresolución de cada esfera
- `tours/<id>/archivos/...`: imágenes de acciones, logos, audio
- `publicado/<id>/proyecto.json`: versión congelada que ve el público al dar "Publicar"
- `indice/<id>`: metadatos para la lista de Mis Tours

## Seguridad
- El estudio rechaza toda petición sin un token válido de Cloudflare Access (firma, AUD, vencimiento y emisor).
  Si faltan `ACCESS_EQUIPO` o `ACCESS_AUD`, no deja entrar a nadie.
- El Worker de tours no tiene código para escribir ni borrar, y nunca sirve el borrador.

## Probar en la computadora
```
npm install
npx wrangler dev -c estudio.jsonc --port 8787 --var DEV:1 --persist-to .r2local
npx wrangler dev -c tours.jsonc   --port 8788 --persist-to .r2local --inspector-port 9231
```
Abrir http://localhost:8787 (el modo DEV solo funciona en localhost).

## Publicar en Cloudflare
Se conecta este repositorio en Cloudflare (Workers & Pages → Importar repositorio) dos veces:
- `mozari-estudio`: comando de deploy `npx wrangler deploy -c nube/estudio.jsonc`
- `mozari-tours`: comando de deploy `npx wrangler deploy -c nube/tours.jsonc`
Cada "Push origin" publica solo.
