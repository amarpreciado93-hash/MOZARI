// Construye estudio/recorrido.html: la página que va dentro del .zip «Descargar para otro hosting».
//
// Uso:  node herramientas/exportable.mjs estudio/index.html estudio/recorrido.html
//       (necesita terser: npm i -g terser)
//
// Pedido de OBED (licencia Desarrollos, nov 2026) y de Amar: el tour en el hosting del cliente va como marca blanca.
// Nada del programa dice de dónde viene: sin comentarios, sin el manual del estudio, sin el logo ni el nombre de
// la plataforma en el código y sin links hacia ella. El servidor además quita los metadatos de vista previa.
import fs from "fs";
import { createRequire } from "module";
import { execSync } from "child_process";
const requerir = createRequire(import.meta.url);
let terser;
try { terser = requerir("terser"); } catch (e) { terser = requerir(execSync("npm root -g").toString().trim() + "/terser"); }
const { minify } = terser;

const [, , origen, destino] = process.argv;
let h = fs.readFileSync(origen, "utf8");

// 1. El manual es del estudio: en el tour no se usa
h = h.split("\n").map((l) => (/^\s*const MANUAL = \[/.test(l) ? "  const MANUAL = [];" : l)).join("\n");

// 2. Pantalla de carga sin el crédito de quien hizo el programa (el servidor pone la del proyecto)
h = h.replace(/<div class="splash-credito">[\s\S]*?<\/svg><\/div>/, "");

// 3. El logo de la plataforma (#iso) se cambia por un aro neutro
h = h.replace(/<path id="iso" fill="currentColor" d="[^"]*"\s*\/>/, '<path id="iso" fill="currentColor" d="M306.5 40a266.5 266.5 0 1 0 0 533 266.5 266.5 0 1 0 0-533zm0 70a196.5 196.5 0 1 1 0 393 196.5 196.5 0 1 1 0-393z"/>');

// 4. Sin comentarios en HTML y CSS; el JavaScript se compacta (sin comentarios y con nombres cortos)
h = h.replace(/<!--[\s\S]*?-->/g, "");
h = h.replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => "<style>" + css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n\s+/g, "\n") + "</style>");
const partes = [];
let ultimo = 0;
for (const m of h.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  const r = await minify(m[1], { compress: false, mangle: true, format: { comments: false } });
  if (!r.code) throw new Error("terser no devolvió código");
  partes.push(h.slice(ultimo, m.index), "<script>" + r.code + "</script>");
  ultimo = m.index + m[0].length;
}
partes.push(h.slice(ultimo));
h = partes.join("");

// 5. Ninguna referencia a la plataforma: los links a su sitio no llevan a ningún lado y el nombre se cambia
h = h.replace(/https?:\/\/(?:[a-z0-9-]+\.)*mozari\.app[^"'`\s)]*/gi, "#");
h = h.replace(/mozari/gi, (w) => (w === w.toUpperCase() ? "RECORRIDO" : w[0] === "M" ? "Recorrido" : "recorrido"));
h = h.replace(/R360 Team|R360/g, "");

const quedan = (h.match(/mozari|r360/gi) || []).length;
if (quedan) throw new Error("quedan " + quedan + " menciones");
fs.writeFileSync(destino, h);
console.log("ok", destino, h.length);
