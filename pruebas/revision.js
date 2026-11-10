// Mozari · REVISIÓN COMPLETA
// Hace lo que haría un usuario, de punta a punta, contra una copia local de Mozari (sin tocar la nube real).
// Se corre ANTES de cada actualización: si algo que ya funcionaba se rompe, no se sube.
//
//   cd pruebas && npm install && node revision.js
//
// Cada vez que un usuario reporte un error, se agrega aquí una prueba para que no vuelva a pasar.

const { chromium, devices } = require("playwright");
const { spawn } = require("child_process");
const path = require("path"), fs = require("fs"), os = require("os");

const RAIZ = path.resolve(__dirname, "..");
const ESTUDIO = "http://localhost:8787", TOURS = "http://localhost:8788";
const DATOS = fs.mkdtempSync(path.join(os.tmpdir(), "mozari-revision-"));
const busca = (...rutas) => rutas.find((r) => { try { return fs.existsSync(r); } catch (e) { return false; } });
const LIB = {
  marzipano: busca(path.join(__dirname, "node_modules/marzipano/dist/marzipano.js"), "/tmp/mz/package/dist/marzipano.js"),
  d3: busca(path.join(__dirname, "node_modules/d3/dist/d3.min.js"), "/tmp/mz/package/dist/d3.min.js"),
  fflate: busca(path.join(__dirname, "node_modules/fflate/umd/index.js"), "/tmp/ff/package/umd/index.js"),
  xlsx: busca(path.join(__dirname, "node_modules/xlsx/dist/xlsx.full.min.js"), "/tmp/xl/package/dist/xlsx.full.min.js"),
  qr: busca(path.join(__dirname, "node_modules/qrcode-generator/qrcode.js"), "/tmp/qr/package/qrcode.js"),
  jsqr: busca(path.join(__dirname, "node_modules/jsqr"), "/tmp/qr/node_modules/jsqr"),
  pngjs: busca(path.join(__dirname, "node_modules/pngjs"), "/tmp/qr/node_modules/pngjs"),
};
const DUENO = "amarpreciado93@gmail.com";
// Las herramientas que salieron del Laboratorio a Pro y Desarrollos (nov 2026) y sus tutoriales de primera vez
const LANZADAS = ["manzana-curvas", "estadisticas", "fichas", "referencia", "manzana-desfase", "foto360", "lotes-pdf", "carga-logo"];
const GUIAS_NUEVAS = ["nuevo-capas", "nuevo-referencia", "nuevo-curvas", "nuevo-desfase", "nuevo-fichas", "nuevo-estadisticas", "nuevo-carga-logo"];
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ---------- servidores locales (estudio y tours) ----------
const procesos = [];
function arrancar(carpeta, args) {
  const p = spawn("npx", ["wrangler", "dev", ...args, "--var", "DEV:1", "--persist-to", DATOS], { cwd: path.join(RAIZ, "nube", carpeta), detached: true, stdio: ["ignore", fs.openSync(path.join(DATOS, carpeta + ".log"), "a"), fs.openSync(path.join(DATOS, carpeta + ".log"), "a")], env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: "false" }) });
  procesos.push(p);
}
async function listo(url) { for (let i = 0; i < 90; i++) { try { const r = await fetch(url); if (r.status < 500) return; } catch (e) { /* aún no */ } await espera(1000); } throw new Error("No arrancó " + url); }
function apagar() { procesos.forEach((p) => { try { process.kill(-p.pid, "SIGTERM"); } catch (e) { /* ya estaba apagado */ } }); }

// ---------- resultados ----------
const resultados = [];
// SOLO="parte del nombre": corre solo esas pruebas (para probar una mientras se programa; no guarda el resultado)
const SOLO = process.env.SOLO || "";
async function paso(nombre, fn, pagina) {
  if (SOLO && !SOLO.split("|").some((s) => nombre.includes(s)) && !/^Crear un tour/.test(nombre)) return;
  const antes = pagina ? pagina.errs.length : 0, t0 = Date.now();
  try {
    await fn();
    if (pagina && pagina.errs.length > antes) throw new Error("error en la página: " + pagina.errs.slice(antes).join(" | ").slice(0, 200));
    resultados.push({ nombre, ok: true });
    console.log("  ✓ " + nombre + "  (" + ((Date.now() - t0) / 1000).toFixed(1) + " s)");
  } catch (e) {
    resultados.push({ nombre, ok: false, motivo: String(e.message || e).split("\n")[0].slice(0, 220) });
    if (pagina) await pagina.screenshot({ path: path.join(DATOS, "fallo-" + resultados.length + ".png") }).then(() => console.log("    captura: " + path.join(DATOS, "fallo-" + resultados.length + ".png")), () => {});
    console.log("  ✗ " + nombre + " — " + String(e.message || e).split("\n")[0].slice(0, 220));
    const donde = String(e.message || e).split("\n").find((l) => /waiting for/.test(l)); // en qué botón se atoró
    if (donde) console.log("    " + donde.trim().slice(0, 200));
  }
}
const exige = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---------- ayudantes ----------
let navegador;
async function pagina(correo, opciones = {}) {
  const { limpio, ...otras } = opciones;
  const ctx = await navegador.newContext(Object.assign({ viewport: { width: 1400, height: 900 }, acceptDownloads: true }, otras));
  // Edición limpia (Laboratorio «limpio»): las pruebas de siempre ven Propiedades sin renglones; la suya lo apaga con { limpio: true }
  if (!limpio) await ctx.addInitScript(() => { try { localStorage.setItem("mz-props-plano", "1"); } catch (e) { /* sin almacenamiento */ } });
  const p = await ctx.newPage();
  p.errs = [];
  p.on("pageerror", (e) => p.errs.push(e.message));
  p.on("dialog", (d) => d.accept());
  // Las librerías (esfera 360, etc.) las sirve Mozari mismo desde /lib: aquí no se interceptan
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.route(/cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/, (r) => r.abort()); // si algo aún los pidiera, la prueba falla
  if (correo) { await p.goto(ESTUDIO + "/entrar?dev=" + encodeURIComponent(correo)); await p.waitForTimeout(2500); await cerrarAnuncio(p); }
  return p;
}
async function cerrarAnuncio(p) { if (await p.isVisible("#dlg-nov").catch(() => false)) { await p.click("[data-nov-cerrar]").catch(() => {}); await p.waitForTimeout(300); } }
async function nuevoTour(p, nombre) {
  await p.fill("#nuevo-tour input", nombre); await p.click("#nuevo-tour button"); await p.waitForTimeout(3000);
  await p.click('#nav button:has-text("Panoramas")'); await p.waitForTimeout(600);
  await p.evaluate(async () => {
    const cv = document.createElement("canvas"); cv.width = 4096; cv.height = 2048; const x = cv.getContext("2d");
    x.fillStyle = "#7ab"; x.fillRect(0, 0, 4096, 1024); x.fillStyle = "#6a5"; x.fillRect(0, 1024, 4096, 1024);
    x.strokeStyle = "#cdb"; x.lineWidth = 3; for (let i = 0; i < 64; i++) { x.beginPath(); x.moveTo(i * 64, 1024); x.lineTo(i * 64, 2048); x.stroke(); }
    const bl = await new Promise((o) => cv.toBlob(o, "image/jpeg", 0.85));
    const inp = document.querySelector("#subir-zona input[type=file]"); const dt = new DataTransfer(); dt.items.add(new File([bl], "campo.jpg", { type: "image/jpeg" }));
    inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true }));
  });
  for (let i = 0; i < 45; i++) { await p.waitForTimeout(1000); if (await p.$("#pano-lista [data-abrir]")) break; }
  exige(await p.$("#pano-lista [data-abrir]"), "la esfera no terminó de subir");
  await p.waitForTimeout(1500);
}
const capas = async (p) => (await p.$$eval("#lista li", (l) => l.map((x) => x.innerText.trim().split("\n")[0]))).reverse();
const lotes = async (p) => (await capas(p)).filter((t) => /^Lote/.test(t));
async function irCapas(p) { await p.click('#nav button:has-text("Panoramas")'); await p.waitForTimeout(300); await p.click('#subtabs button:has-text("Capas")'); await p.waitForTimeout(1500); }
// Los tutoriales de primera vez: se avanzan con «Siguiente» hasta que se cierran
async function pasarGuias(p) { for (let i = 0; i < 6; i++) { await p.waitForTimeout(250); if (!(await p.isVisible(".guia-tarjeta").catch(() => false))) return; await p.click('.guia-tarjeta [data-guia="seguir"]'); await p.waitForTimeout(350); } }
async function cerrarGuia(p) { if (await p.isVisible(".guia-tarjeta").catch(() => false)) { await p.keyboard.press("Escape"); await p.waitForTimeout(300); } }
async function dibujarManzana(p, frente, fondo) {
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  await p.click("#add-manzana"); await p.waitForTimeout(500);
  if (await p.isVisible(".guia-tarjeta")) { await p.click('.guia-tarjeta [data-guia="seguir"]'); await p.waitForTimeout(400); } // primera vez: el tutorial
  for (const [x, y] of frente) { await p.mouse.click(x, y); await p.waitForTimeout(120); }
  await p.keyboard.press("Enter"); await p.waitForTimeout(400);
  for (const [x, y] of fondo) { await p.mouse.click(x, y); await p.waitForTimeout(120); }
  await p.keyboard.press("Enter"); await p.waitForTimeout(1400);
  await cerrarGuia(p);
}
const idTour = (p) => p.evaluate(() => (location.hash.match(/t=([a-z0-9-]+)/) || [])[1]);
// Detector de capas pesadas (lección de El Mirador, nov 2026). El iPhone guarda en su propia capa de memoria
// todo lo que va en 3D, se anima (movimiento u opacidad), un canvas, un video o un vidrio esmerilado. Y si algo
// GRANDE se pinta encima de una de esas, también le da su propia capa. Cada capa de pantalla completa pesa
// ~12 MB en un iPhone; con unas 20 Safari cierra la página. Cuenta cuántas capas grandes de más hay.
const MAX_CAPAS_GRANDES = 6; // hoy un tour normal tiene 4 (la esfera, las capas, las asas y el skin), sin importar cuántos lotes
async function capasPesadas(p) {
  return p.evaluate(() => {
    const W = innerWidth, H = innerHeight, rect = (e) => e.getBoundingClientRect();
    const visible = (e) => { const s = getComputedStyle(e); return e.isConnected && s.display !== "none" && s.visibility !== "hidden" && +s.opacity > 0; };
    const cruza = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const propias = new Set();
    document.querySelectorAll("body *").forEach((e) => {
      const s = getComputedStyle(e);
      if (/matrix3d|perspective/.test(s.transform) || s.willChange !== "auto" || (s.backdropFilter || s.webkitBackdropFilter || "none") !== "none" || e.tagName === "CANVAS" || e.tagName === "VIDEO") propias.add(e);
    });
    document.getAnimations().forEach((a) => {
      const ef = a.effect, t = ef && ef.target;
      if (t && a.playState === "running" && ef.getKeyframes().some((k) => "transform" in k || "opacity" in k || "scale" in k)) propias.add(t);
    });
    const contexto = (e) => {
      for (let a = e.parentElement; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        if ((s.position !== "static" && s.zIndex !== "auto") || +s.opacity < 1 || s.transform !== "none" || s.isolation === "isolate" || s.filter !== "none") return a;
      }
      return document.documentElement;
    };
    const lista = [...propias].filter(visible), pesadas = [];
    document.querySelectorAll("body *").forEach((g) => {
      if (!visible(g)) return;
      const rg = rect(g);
      if (Math.min(rg.right, W) - Math.max(rg.left, 0) < W * 0.6 || Math.min(rg.bottom, H) - Math.max(rg.top, 0) < H * 0.6) return; // solo lo grande
      const S = contexto(g);
      if (pesadas.some((x) => x !== S && S.contains(x) && x.contains(g))) return; // ya se pinta dentro de otra capa grande
      const debajo = lista.find((c) => c !== g && S.contains(c) && !c.contains(g) && !g.contains(c) && (c.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING) && cruza(rect(c), rg));
      if (debajo) pesadas.push(g);
    });
    const nombre = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : "");
    return { n: pesadas.length, ejemplos: pesadas.slice(0, 4).map(nombre) };
  });
}

// ---------- la revisión ----------
(async () => {
  console.log("\nMozari · revisión completa\n");
  try {
    // Uno y luego el otro: comparten la misma copia de los datos y si arrancan juntos se estorban
    arrancar("worker-estudio", ["--port", "8787", "--local-upstream", "localhost:8787"]); await listo(ESTUDIO + "/");
    arrancar("worker-tours", ["--port", "8788", "--inspector-port", "9330"]); await listo(TOURS + "/");
    navegador = await chromium.launch();

    // 1. Escaparate
    const visita = await pagina(null);
    await paso("El escaparate abre con planes y precios", async () => {
      await visita.goto(ESTUDIO + "/"); await visita.waitForTimeout(1500);
      const t = await visita.textContent("body");
      exige(/Pro/.test(t) && /Desarrollos/.test(t) && /Gratis/.test(t), "no se ven los planes");
    }, visita);

    // 2. Dueño: tour completo
    const a = await pagina(DUENO);
    // El dueño ya vio los tutoriales nuevos (se prueban con una cuenta Pro); así no estorban a las demás pruebas
    await a.evaluate((l) => Promise.all(l.map((k) => fetch("api/guias/" + k, { method: "POST" }))), GUIAS_NUEVAS); await a.reload(); await a.waitForTimeout(2500); await cerrarAnuncio(a);
    let tour = null;
    await paso("Crear un tour y subir una esfera", async () => { await nuevoTour(a, "Revision"); tour = await idTour(a); exige(tour, "sin id de tour"); }, a);
    await paso("Vista previa del tour", async () => {
      await a.click('button:has-text("Vista previa")'); await a.waitForTimeout(3500);
      exige(await a.$("#previa canvas"), "la vista previa no dibujó la esfera");
      await a.keyboard.press("Escape"); await a.waitForTimeout(500);
    }, a);
    await paso("Dibujar un lote a mano y marcarlo vendido", async () => {
      await irCapas(a);
      await a.click("#add-lote"); await a.waitForTimeout(300); await pasarGuias(a);
      for (const [x, y] of [[460, 700], [560, 700], [560, 780], [460, 780]]) { await a.mouse.click(x, y); await a.waitForTimeout(120); }
      await a.keyboard.press("Enter"); await a.waitForTimeout(800);
      exige((await lotes(a)).length === 1, "no apareció el lote");
      await a.click('[data-estado="vendido"]'); await a.waitForTimeout(400);
      await a.click('[data-acc="quitar-lote"]').catch(() => {}); // lo deja como polígono para no estorbar
      await a.waitForTimeout(400);
    }, a);
    await paso("Manzana con 10 lotes", async () => {
      await dibujarManzana(a, [[500, 640], [620, 630], [740, 625], [860, 630], [980, 640]], [[480, 800], [740, 800], [1000, 800]]);
      const l = await lotes(a);
      exige(l.length === 10, "salieron " + l.length + " lotes en vez de 10");
    }, a);
    await paso("Un número de lote escrito a mano se respeta al ajustar la manzana", async () => {
      await a.click('#lista li:has-text("Lote 3 ·")'); await a.waitForTimeout(500);
      await a.fill('[data-k="lote.numero"]', "30"); await a.press('[data-k="lote.numero"]', "Tab"); await a.waitForTimeout(500);
      await a.click('#lista li:has-text("Manzana 1")'); await a.waitForTimeout(500);
      await a.click('[data-mz-n="1"]'); await a.waitForTimeout(700); await a.click("[data-mz-parejo]"); await a.waitForTimeout(700);
      const l = await lotes(a);
      exige(l.length === 11, "no se agregó el lote (" + l.length + ")");
      exige(l.some((t) => /^Lote 30 ·/.test(t)) && !l.some((t) => /^Lote 3 ·/.test(t)), "el número 30 se perdió");
    }, a);
    await paso("Dos manzanas: cada una con su número y sus lotes no se mezclan", async () => {
      await dibujarManzana(a, [[520, 560], [980, 560]], [[520, 600], [980, 600]]);
      const c = await capas(a);
      exige(c.includes("Manzana 1") && c.includes("Manzana 2"), "las manzanas no tienen números distintos: " + c.filter((t) => /Manzana/.test(t)).join(", "));
      await a.click('#lista li:has-text("Lote 2 · M1")'); await a.waitForTimeout(400);
      await a.click('[data-estado="vendido"]'); await a.waitForTimeout(400);
      const colores = await a.$$eval("#lista li", (l) => l.filter((x) => /^Lote 2 ·/.test(x.innerText)).map((x) => x.innerText.split("\n")[0] + "=" + getComputedStyle(x.querySelector(".punto-estado")).backgroundColor));
      exige(colores.filter((x) => /M1=/.test(x) && /229, 72, 77/.test(x)).length === 1, "el Lote 2 · M1 no quedó vendido");
      exige(!colores.some((x) => /M2=/.test(x) && /229, 72, 77/.test(x)), "también se marcó vendido el de la otra manzana");
    }, a);
    await paso("Desde un lote se puede editar la manzana completa", async () => {
      await a.click('[data-acc="ir-manzana"]'); await a.waitForTimeout(400);
      exige(/Manzana/.test(await a.textContent("#props-titulo")), "no se abrió la manzana");
    }, a);
    await paso("La rueda del mouse acerca la vista aunque el cursor esté sobre un lote", async () => {
      const zona = { x: 385, y: 110, width: 715, height: 780 };
      const antes = await a.screenshot({ clip: zona });
      await a.mouse.move(740, 700); await a.mouse.wheel(0, -400); await a.waitForTimeout(600);
      exige(!antes.equals(await a.screenshot({ clip: zona })), "la vista no cambió");
      await a.mouse.wheel(0, 400); await a.waitForTimeout(400);
    }, a);
    await paso("Barra espaciadora: sale la manita y arrastrar gira la esfera sin mover ni seleccionar lotes", async () => {
      await a.keyboard.press("Escape"); await a.waitForTimeout(300);
      const lote = await a.$$eval(".cp-pol", (ps) => { const r = ps.map((p) => p.getBoundingClientRect()).find((r) => r.width > 20 && r.height > 8 && r.x > 400 && r.y > 150 && r.y < 850); return r && [r.x + r.width / 2, r.y + r.height / 2]; });
      exige(lote, "no encontré un lote en la esfera");
      await a.mouse.click(lote[0], lote[1]); await a.waitForTimeout(400);
      exige((await a.textContent("#props-titulo")) !== "Propiedades", "sin la manita, el clic debería tomar el lote");
      await a.keyboard.press("Escape"); await a.waitForTimeout(300);
      await a.keyboard.down("Space"); await a.waitForTimeout(150);
      exige(await a.evaluate(() => document.body.classList.contains("mano")), "no se activó la manita");
      exige((await a.$eval("#ed-stage", (e) => getComputedStyle(e).cursor)) === "grab", "el cursor no es la manita");
      const zona = { x: 385, y: 110, width: 715, height: 780 };
      const antes = await a.screenshot({ clip: zona });
      await a.mouse.down(); await a.mouse.move(lote[0] + 160, lote[1] + 20, { steps: 8 });
      exige((await a.$eval("#ed-stage", (e) => getComputedStyle(e).cursor)) === "grabbing", "al arrastrar no cierra la manita");
      await a.mouse.up(); await a.waitForTimeout(500);
      exige(!antes.equals(await a.screenshot({ clip: zona })), "la esfera no giró");
      exige((await a.textContent("#props-titulo")) === "Propiedades", "se tomó un lote: " + (await a.textContent("#props-titulo")));
      await a.mouse.click(lote[0], lote[1]); await a.waitForTimeout(400);
      exige((await a.textContent("#props-titulo")) === "Propiedades", "un clic con la manita seleccionó algo");
      await a.keyboard.up("Space"); await a.waitForTimeout(150);
      exige(!(await a.evaluate(() => document.body.classList.contains("mano"))), "la manita no se quitó al soltar la barra");
      await a.mouse.move(lote[0] - 160, lote[1] - 20); await a.mouse.down(); await a.mouse.move(lote[0], lote[1], { steps: 8 }); await a.mouse.up(); await a.waitForTimeout(300);
    }, a);
    await paso("Punto de interés: sigue a la cámara o fijo en el entorno 3D", async () => {
      await a.keyboard.press("Escape"); await a.click("#add-pi"); await a.waitForTimeout(600); await pasarGuias(a);
      exige(await a.$(".cp-interes"), "no apareció el punto de interés");
      exige(!(await a.$eval(".cp-interes", (e) => e.classList.contains("en3d"))), "debería empezar siguiendo a la cámara");
      await a.click('[data-k="en3d"][data-v="true"]'); await a.waitForTimeout(600);
      exige(await a.$eval(".cp-interes", (e) => e.classList.contains("en3d") && /perspective/.test(e.style.transform)), "no quedó fijo en 3D");
      for (const [k, v] of [["t3d.rotar", "30"], ["t3d.inclinar", "40"]]) await a.$eval('[data-k="' + k + '"]', (e, val) => { e.value = val; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); }, v);
      await a.waitForTimeout(500);
      exige(await a.$eval(".cp-interes", (e) => /rotateX\(40deg\)/.test(e.style.transform) && /rotateZ\(30deg\)/.test(e.style.transform)), "no se puede rotar ni inclinar en 3D");
      await a.click('[data-acc="t3d-reset"]'); await a.waitForTimeout(400);
      await a.click('[data-k="en3d"][data-v="false"]'); await a.waitForTimeout(600);
      exige(await a.$eval(".cp-interes", (e) => !e.classList.contains("en3d") && /translate\(/.test(e.style.transform)), "no regresó a seguir la cámara");
    }, a);
    await paso("Laboratorio · calle curva y esquinas redondeadas", async () => {
      await a.click('#lista li:has-text("Manzana 1")'); await a.waitForTimeout(500);
      const cuantos = (await lotes(a)).length;
      exige(await a.$("[data-mz-suave]"), "no aparecen las herramientas de curva para el dueño");
      await a.click("[data-mz-suave]"); await a.waitForTimeout(500); await a.click("[data-mz-esquinas]"); await a.waitForTimeout(600);
      exige(await a.$$eval(".mz-asa.curva", (l) => l.length) > 0 && await a.$$eval(".mz-asa.radio", (l) => l.length) > 0, "no salen las manijas rojas");
      exige((await lotes(a)).length === cuantos, "cambió la cantidad de lotes");
    }, a);
    await paso("Manzana doble y fila de atrás desfasada", async () => {
      const antes = (await lotes(a)).length; // manzana 1 (11 lotes) + manzana 2 (10)
      await a.check('[data-k="_mzDoble"]').catch(async () => { await a.click("text=Doble: lotes por los dos lados"); });
      await a.waitForTimeout(800);
      exige((await lotes(a)).length === antes + 11, "la doble no duplicó los 11 lotes (" + (await lotes(a)).length + ")");
      await a.fill('[data-mz="nB"]', "7"); await a.press('[data-mz="nB"]', "Enter"); await a.waitForTimeout(800);
      exige((await lotes(a)).length === antes + 7, "la fila de atrás no tomó 7 lotes (" + (await lotes(a)).length + ")");
    }, a);
    await paso("Laboratorio · ficha diseñada del lote", async () => {
      await a.click('#subtabs button:has-text("Fichas técnicas")'); await a.waitForTimeout(1200); await pasarGuias(a);
      exige(await a.isVisible("#ficha-editor"), "no aparece el creador de fichas");
      await a.check('[data-fe="activa"]'); await a.waitForTimeout(500);
      exige(await a.$("#fe-lienzo .ficha-d"), "no se dibuja la ficha");
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR4nGPgyt/8Hx9mGBkKACvRisEGqcWiAAAAAElFTkSuQmCC", "base64");
      await a.setInputFiles("#fe-logo2", { name: "inmobiliaria.png", mimeType: "image/png", buffer: png }); await a.waitForTimeout(1800);
      exige(await a.$("#fe-lienzo .fd-logo2"), "el segundo logo no sale al pie de la ficha");
      await a.click('[data-fe-plantilla="ubicacion"]'); await a.waitForTimeout(400); await a.click('[data-fe-plantilla="banda"]'); await a.waitForTimeout(400);
      exige(await a.$("#fe-lienzo .fd-pie .fd-logo2"), "la banda de color perdió el segundo logo");
    }, a);
    await paso("Laboratorio · interiorismo: ficha técnica con plano, datos y planes de pago que recalculan el precio", async () => {
      const foto = (p, n) => (process.env.CAPTURAS ? p.screenshot({ path: path.join(process.env.CAPTURAS, n + ".png") }) : null);
      const png = await a.evaluate(() => { const c = document.createElement("canvas"); c.width = 300; c.height = 420; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 300, 420); g.lineWidth = 8; g.strokeRect(20, 20, 260, 380); g.lineWidth = 4; g.beginPath(); g.moveTo(20, 220); g.lineTo(180, 220); g.lineTo(180, 400); g.stroke(); return c.toDataURL("image/png").split(",")[1]; });
      const fila = await a.$eval("#lotes-tabla tr[data-k]", (tr) => tr.dataset.k);
      await a.click('#lotes-tabla tr[data-k="' + fila + '"] [data-estado="disponible"]'); await a.waitForTimeout(400);
      await a.fill('#lotes-tabla tr[data-k="' + fila + '"] [data-campo="precio"]', "610456"); await a.waitForTimeout(400);
      exige(await a.$('[data-fe-plantilla="tecnica"]'), "no está el diseño Técnica en el Laboratorio");
      await a.click('[data-fe-plantilla="tecnica"]'); await a.waitForTimeout(500);
      await a.selectOption("#fe-muestra", fila); await a.waitForTimeout(500);
      await a.click("[data-ft-mas-tipo]"); await a.waitForTimeout(500);
      const T = '[data-ft-tipo="0"] ';
      await a.fill(T + '[data-ft-t="nombre"]', "A"); await a.fill(T + '[data-ft-t="int"]', "68.58"); await a.fill(T + '[data-ft-t="ext"]', "10.70");
      for (const [i, v] of [[0, "1"], [1, "2.0"], [2, "1"], [3, "Closet"]]) await a.fill(T + '[data-ft-dv="' + i + '"]', v);
      await a.setInputFiles(T + "[data-ft-plano]", { name: "plano-a.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") }); await a.waitForTimeout(2000);
      await a.selectOption(T + '[data-ft-t="esfera"]', { index: 1 }); await a.waitForTimeout(400);
      await a.click("[data-ft-mas-plan]"); await a.waitForTimeout(300); await a.click("[data-ft-mas-plan]"); await a.waitForTimeout(300);
      await a.fill('[data-ft-pt="0"]', "40% de enganche, 30% a 18 meses y 30% a la entrega"); await a.fill('[data-ft-pd="0"]', "20");
      await a.fill('[data-ft-pt="1"]', "30% de enganche y 70% a la entrega"); await a.fill('[data-ft-pd="1"]', "8");
      await a.fill('[data-fe="extraT"]', "Paquete llave en mano"); await a.fill('[data-fe="extraM"]', "39000"); await a.fill('[data-fe="notas"]', "Reserva con $10,000");
      await a.selectOption("#ft-tipo-muestra", { index: 1 }); await a.waitForTimeout(500);
      await a.fill("#ft-vista-muestra", "Laguna"); await a.waitForTimeout(600);
      const f = "#fe-lienzo .fd-tecnica";
      exige(await a.$(f + " .ft-plano img"), "la ficha no muestra el plano del tipo");
      const tabla = (await a.textContent(f + " .ft-tabla")).replace(/\s+/g, " ");
      exige(/Tipo ?A/.test(tabla) && /Recámaras ?1/.test(tabla) && /Vista ?Laguna/.test(tabla), "faltan datos en la tabla: " + tabla);
      exige(/79\.28 m²/.test(await a.textContent(f + " .ft-sup")), "no suma la superficie total");
      const fin = () => a.textContent(f + ' [data-ft-v="final"]');
      exige(/527,365/.test(await fin()), "precio final con el primer plan: " + (await fin()));
      await a.click(f + ' [data-ft-plan="1"]'); await a.waitForTimeout(200);
      exige(/600,620/.test(await fin()), "al elegir otro plan no se recalculó: " + (await fin()));
      exige(await a.$(f + " .ft-360"), "falta el botón Recorrido 360");
      await a.$eval("#fe-lienzo", (e) => e.scrollIntoView({ block: "start" })); await a.waitForTimeout(300); await foto(a, "interior-ficha-editor");
    }, a);
    await paso("Laboratorio · interiorismo: skin Interior con menú por espacios y la ficha técnica en el tour", async () => {
      const foto = (p, n) => (process.env.CAPTURAS ? p.screenshot({ path: path.join(process.env.CAPTURAS, n + ".png") }) : null);
      try {
        await a.click('#nav button:has-text("Interfaz")'); await a.waitForTimeout(1200); await pasarGuias(a);
        exige(await a.$('[data-sk-k="plantilla"][data-v="interior"]'), "no está la plantilla Interior");
        await a.click('[data-sk-k="plantilla"][data-v="interior"]'); await a.waitForTimeout(900);
        exige(await a.$("#sk-ui.t-interior .i-espacio"), "no se dibuja la skin Interior");
        exige((await a.textContent("#sk-ui .i-espacio b")).trim().length > 0, "no dice el nombre del espacio");
        await a.click('#sk-ui [data-sk="cajon"]'); await a.waitForTimeout(300);
        exige(await a.isVisible("#sk-ui .i-menu"), "no abre el menú de espacios");
        await foto(a, "interior-skin"); await a.click('#sk-ui [data-sk="cajon"]'); await a.waitForTimeout(200);
        await a.click('#subtabs button:has-text("9:16")'); await a.waitForTimeout(1000); await foto(a, "interior-skin-v");
        await a.click('#subtabs button:has-text("16:9")'); await a.waitForTimeout(600);
        // Vista previa: tocar la unidad A abre la ficha técnica y «Recorrido 360» lleva a su esfera
        await a.click('button:has-text("Vista previa")'); await a.waitForTimeout(3500);
        const centros = await a.$$eval("#previa path.cp-pol.con-accion", (l) => l.map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.width * r.height]; }).filter((x) => x[2] > 80 && x[0] > 0 && x[1] > 0 && x[0] < 1400 && x[1] < 900).sort((p, q) => q[2] - p[2]));
        let abierta = false;
        for (const [x, y] of centros) {
          await a.mouse.click(x, y); await a.waitForTimeout(600);
          if (await a.$("#previa .pop .fd-tecnica .ft-360")) { abierta = true; break; }
          if (await a.$("#previa .pop .pop-x")) { await a.click("#previa .pop .pop-x"); await a.waitForTimeout(300); }
        }
        exige(abierta, "en la vista previa la unidad A no abrió la ficha técnica (" + centros.length + " lotes tocados)");
        await foto(a, "interior-ficha-tour");
        await a.click("#previa .pop .ft-360"); await a.waitForTimeout(1200);
        exige(!(await a.isVisible("#previa .pop .pop-caja")), "Recorrido 360 no cerró la ficha");
        await a.keyboard.press("Escape"); await a.waitForTimeout(600);
      } finally {
        if (await a.isVisible("#previa")) { await a.keyboard.press("Escape"); await a.waitForTimeout(400); await a.keyboard.press("Escape"); await a.waitForTimeout(400); }
        await a.click('#nav button:has-text("Interfaz")'); await a.waitForTimeout(800);
        await a.click('[data-sk-k="plantilla"][data-v="cine"]'); await a.waitForTimeout(500);
        await a.click('#nav button:has-text("Panoramas")'); await a.waitForTimeout(800); await a.click('#subtabs button:has-text("Fichas técnicas")'); await a.waitForTimeout(1000);
        await a.click('[data-fe-plantilla="banda"]'); await a.waitForTimeout(500);
      }
    }, a);
    await paso("Laboratorio · Edificio: la fachada se parte en pisos y departamentos numerados por piso", async () => {
      const foto = (p, n) => (process.env.CAPTURAS ? p.screenshot({ path: path.join(process.env.CAPTURAS, n + ".png") }) : null);
      await irCapas(a); await a.keyboard.press("Escape"); await a.waitForTimeout(300);
      exige(await a.isVisible("#add-edificio"), "no está el botón Edificio");
      await a.click("#add-edificio"); await a.waitForTimeout(400); await pasarGuias(a);
      for (const [x, y] of [[905, 470], [620, 285], [900, 278], [615, 480]]) { await a.mouse.click(x, y); await a.waitForTimeout(180); }
      await a.waitForTimeout(900);
      exige(/^Edificio/.test(await a.textContent("#props-titulo")), "no se creó el edificio: " + (await a.textContent("#props-titulo")));
      const deps = async () => (await capas(a)).filter((t) => / · Torre A$/.test(t));
      let d = await deps();
      exige(d.length === 32, "debían salir 8 pisos × 4 = 32 departamentos y salieron " + d.length);
      exige(d.some((t) => /^Depto 801 /.test(t)) && d.some((t) => /^Depto 104 /.test(t)), "no se numeran por piso como «Depto 801… arriba, 101… abajo»: " + d.slice(0, 6).join(", "));
      const caja = await a.evaluate(() => { const l = [...document.querySelectorAll("#ed-stage path.cp-pol")].map((e) => e.getBoundingClientRect()).filter((r) => r.top > 260 && r.bottom < 500 && r.width > 4); return l.length; });
      exige(caja >= 32, "los departamentos no se dibujan en la fachada (" + caja + ")");
      await foto(a, "edificio");
      // Nodos verdes: uno por punta de cada línea de piso y de cada división (7 pisos + 3 divisiones, en sus 2 puntas)
      const nodos = await a.$$eval("#ed-stage .mz-asa.corte", (l) => l.map((e) => [+e.getAttribute("cx"), +e.getAttribute("cy")]));
      exige(nodos.length === 20, "debían salir 20 nodos verdes y salieron " + nodos.length);
      const r0 = await a.$eval("#ed-stage", (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y]; });
      const [nx, ny] = nodos[0];
      await a.mouse.move(r0[0] + nx, r0[1] + ny); await a.mouse.down(); await a.mouse.move(r0[0] + nx, r0[1] + ny + 14, { steps: 6 }); await a.mouse.up(); await a.waitForTimeout(600);
      exige(await a.$("[data-ed-parejo]"), "mover un nodo verde no cambió el piso");
      await a.selectOption('[data-ed="unidad"]', "Loft"); await a.waitForTimeout(500);
      exige((await deps()).every((t) => /^Loft /.test(t)), "no se cambió el nombre de los departamentos a Loft");
      await a.click('[data-ed-n="pisos"][data-d="1"]'); await a.waitForTimeout(500);
      d = await deps();
      exige(d.length === 36 && d.some((t) => /^Loft 901 /.test(t)), "al agregar un piso no salió el 9.º: " + d.length);
      await a.fill('[data-ed="prefijo"]', "A-"); await a.press('[data-ed="prefijo"]', "Tab"); await a.waitForTimeout(500);
      exige((await deps()).some((t) => /^Loft A-901 /.test(t)), "el prefijo no se aplicó");
      // Un departamento con su propio color, sin cambiar los demás
      await a.click('#lista li:has-text("Loft A-901 ")'); await a.waitForTimeout(500);
      await a.$eval('[data-k="lote.colorPropio"][type="color"]', (e) => { e.value = "#3366ff"; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); }); await a.waitForTimeout(500);
      const fills = await a.$$eval("#ed-stage path.cp-pol", (l) => l.map((e) => getComputedStyle(e).getPropertyValue("--f").trim()));
      exige(fills.filter((f) => /#3366ff/i.test(f)).length === 1, "el color propio no quedó en un solo departamento: " + fills.filter((f) => /#3366ff/i.test(f)).length);
      await a.click('[data-acc="ir-manzana"]'); await a.waitForTimeout(400);
      exige(/^Edificio/.test(await a.textContent("#props-titulo")), "desde el departamento no se regresa al edificio");
      await a.click("#props-titulo"); await a.keyboard.press("Delete"); await a.waitForTimeout(600);
      exige(!(await deps()).length, "al borrar el edificio quedaron departamentos");
    }, a);
    let link = null;
    await paso("Publicar y abrir el tour público en computadora", async () => {
      await a.click('#nav button:has-text("Publicar")'); await a.waitForTimeout(800);
      // La descarga (.zip) se ve antes de publicar, apagada y con la razón (antes no aparecía y no se encontraba)
      exige(await a.$('#proximo .pub-hosting button[disabled]:has-text("Descargar tour (.zip)")'), "antes de publicar no se ve dónde descargar el tour");
      await a.click("#pub-publicar"); await a.waitForTimeout(3500);
      exige(await a.$("#pub-descargar:not([disabled])"), "después de publicar no se puede descargar el tour");
      link = TOURS + "/" + tour + "/";
      const t = await pagina(null); await t.goto(link); await t.waitForTimeout(4500);
      exige(await t.$("canvas"), "el tour no dibujó la esfera");
      exige(!(await t.$(".agua-mozari")), "el tour del dueño salió con marca de agua");
      exige(!t.errs.length, "errores en el tour: " + t.errs.join(" | ").slice(0, 160));
      await t.context().close();
    }, a);
    await paso("El tour abre sin esperar a bajar toda la esfera en alta (conexión 4G)", async () => {
      // Reporte (nov 2026): el tour tardaba 10-15 s en abrir porque esperaba las 6 caras en alta y las vecinas
      if (!link) { await a.click('#nav button:has-text("Publicar")'); await a.waitForTimeout(800); await a.click("#pub-publicar"); await a.waitForTimeout(3500); link = TOURS + "/" + tour + "/"; }
      // Pantalla angosta y nítida (sin ser celular, que usa la resolución ligera): pide el nivel alto y ve solo una parte
      const ctx = await navegador.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 3 }), t = await ctx.newPage();
      await t.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      const cdp = await ctx.newCDPSession(t); await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 120, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (2 * 1024 * 1024) / 8 });
      const pedidas = []; t.on("request", (r) => { const m = r.url().match(/\/escenas\/([^/]+)\/(\d+)\//); if (m) pedidas.push([m[1], +m[2]]); });
      await t.goto(link, { waitUntil: "commit" });
      await t.waitForFunction(() => { const c = document.getElementById("pv-carga"); return c && c.hidden; }, null, { timeout: 30000 });
      const alAbrir = pedidas.slice();
      const pj = await (await fetch(link + "proyecto.json")).json(), ini = pj.proyecto.escenaInicial || pj.escenas[0].id;
      const meta = await (await fetch(link + "escenas/" + ini + "/escena.json")).json();
      const z = Math.max(...alAbrir.filter((x) => x[0] === ini).map((x) => x[1])), nv = meta.niveles[z], total = 6 * Math.ceil(nv.size / nv.tileSize) ** 2;
      const de = alAbrir.filter((x) => x[0] === ini && x[1] === z).length;
      exige(z >= 2 && de > 0, "no pidió la esfera en alta para abrir");
      exige(de < total, "esperó las " + total + " piezas en alta de la esfera antes de abrir (solo hacen falta las que se ven)");
      exige(!alAbrir.some((x) => x[0] !== ini && x[1] >= 1), "antes de abrir bajó otras esferas");
      await t.waitForTimeout(4000);
      if (pj.escenas.length > 1) exige(pedidas.some((x) => x[0] !== ini), "con el tour abierto no se bajaron las esferas vecinas");
      exige(pedidas.filter((x) => x[0] === ini && x[1] === z).length > de, "con el tour abierto no se bajó el resto de la esfera en alta");
      await ctx.close();
    }, a);
    await paso("En celular el tour usa la resolución ligera (hasta 1024 px por cara) y no baja piezas grandes", async () => {
      // Reporte (nov 2026): en celular se trababa los primeros segundos mientras subía piezas grandes a la tarjeta de video
      if (!link) { await a.click('#nav button:has-text("Publicar")'); await a.waitForTimeout(800); await a.click("#pub-publicar"); await a.waitForTimeout(3500); link = TOURS + "/" + tour + "/"; }
      const ctx = await navegador.newContext(Object.assign({}, devices["iPhone 13"])), t = await ctx.newPage();
      await t.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      const pedidas = []; t.on("request", (r) => { const m = r.url().match(/\/escenas\/([^/]+)\/(\d+)\//); if (m) pedidas.push([m[1], +m[2]]); });
      await t.goto(link); await t.waitForFunction(() => { const c = document.getElementById("pv-carga"); return c && c.hidden; }, null, { timeout: 30000 });
      for (let r = 0; r < 2; r++) { await t.mouse.move(300, 330); await t.mouse.down(); for (let k = 1; k <= 12; k++) await t.mouse.move(300 - k * 18, 330); await t.mouse.up(); }
      await t.waitForTimeout(3000);
      const pj = await (await fetch(link + "proyecto.json")).json(), metas = {};
      for (const e of pj.escenas) metas[e.id] = await (await fetch(link + "escenas/" + e.id + "/escena.json")).json();
      // El nivel más alto permitido: el mayor de hasta 1024 px (o el primero, si la esfera no tiene uno así de chico)
      const tope = (e) => { const nv = metas[e].niveles; let z = 1; nv.forEach((l, i) => { if (i >= 1 && l.size <= 1024) z = i; }); return z; };
      const grandes = pedidas.filter(([e, z]) => metas[e] && z > tope(e));
      exige(pedidas.length > 0, "el celular no pidió ninguna pieza");
      const cuenta = {}; pedidas.forEach(([e, z]) => { const k = metas[e] ? metas[e].niveles[z].size : z; cuenta[k] = (cuenta[k] || 0) + 1; });
      exige(!grandes.length, "en celular bajó piezas de más de 1024 px por cara (" + grandes.length + "; niveles " + Object.values(metas).map((m) => m.niveles.map((l) => l.size).join("/")).join(" · ") + "; pedidas por tamaño " + JSON.stringify(cuenta) + "; celular " + (await t.evaluate(() => matchMedia("(pointer: coarse)").matches + " " + screen.width)) + ")");
      await ctx.close();
    }, a);
    // Pedido de Amar (nov 2026): calidad por tour como en 3DVista (Equilibrada por default)
    await paso("Calidad del tour: Equilibrada por default, Máxima pide la foto completa y Ligera la más ligera", async () => {
      const n = await pagina(DUENO);
      await n.fill("#nuevo-tour input", "Calidad"); await n.click("#nuevo-tour button"); await n.waitForTimeout(3000);
      await n.click('#nav button:has-text("Panoramas")'); await n.waitForTimeout(600);
      await n.evaluate(async () => { // una esfera grande (8192): niveles de 768, 1536 y 3072 por cara
        const cv = document.createElement("canvas"); cv.width = 8192; cv.height = 4096; const x = cv.getContext("2d");
        x.fillStyle = "#7ab"; x.fillRect(0, 0, 8192, 2048); x.fillStyle = "#6a5"; x.fillRect(0, 2048, 8192, 2048);
        x.strokeStyle = "#cdb"; x.lineWidth = 5; for (let i = 0; i < 128; i++) { x.beginPath(); x.moveTo(i * 64, 2048); x.lineTo(i * 64, 4096); x.stroke(); }
        const bl = await new Promise((o) => cv.toBlob(o, "image/jpeg", 0.85));
        const inp = document.querySelector("#subir-zona input[type=file]"), dt = new DataTransfer(); dt.items.add(new File([bl], "grande.jpg", { type: "image/jpeg" }));
        inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true }));
      });
      for (let i = 0; i < 90; i++) { await n.waitForTimeout(1000); if (await n.$("#pano-lista [data-abrir]")) break; }
      await n.waitForTimeout(1500);
      const id = await idTour(n), url = TOURS + "/" + id + "/";
      const publicar = async () => { await n.click('#nav button:has-text("Publicar")'); await n.waitForTimeout(500); await n.click('#subtabs button:has-text("Web")'); await n.waitForTimeout(800); await n.click("#pub-publicar"); await n.waitForTimeout(3500); };
      const elegir = async (c) => { await n.click('#nav button:has-text("Proyecto")'); await n.waitForTimeout(600); await n.click('#p-calidad [data-calidad="' + c + '"]'); await n.waitForTimeout(800); };
      const tamanos = async () => { // compu con pantalla muy nítida: pediría la resolución más alta si la calidad lo deja
        const ctx = await navegador.newContext({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 3 }), t = await ctx.newPage(), z = new Set();
        await t.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
        t.on("request", (r) => { const m = r.url().match(/\/escenas\/[^/]+\/(\d+)\//); if (m) z.add(+m[1]); });
        await t.goto(url); await t.waitForFunction(() => { const c = document.getElementById("pv-carga"); return c && c.hidden; }, null, { timeout: 30000 }); await t.waitForTimeout(3000);
        await ctx.close();
        const meta = await (await fetch(url + "escenas/" + (await (await fetch(url + "proyecto.json")).json()).escenas[0].id + "/escena.json")).json();
        return Math.max(...[...z].map((k) => meta.niveles[k].size));
      };
      await n.click('#nav button:has-text("Proyecto")'); await n.waitForTimeout(600);
      exige(await n.$('#p-calidad [data-calidad="equilibrada"][aria-pressed="true"]'), "la calidad no empieza en Equilibrada");
      if (process.env.CAPTURAS) { await n.$eval("#p-calidad", (e) => e.scrollIntoView({ block: "center" })); await n.waitForTimeout(300); await n.screenshot({ path: path.join(process.env.CAPTURAS, "calidad.png") }); }
      await publicar(); let m = await tamanos();
      exige(m > 1024 && m <= 2048, "Equilibrada pidió caras de " + m + " px (debe ser hasta 2048)");
      await elegir("maxima"); await publicar(); m = await tamanos();
      exige(m > 2048, "Máxima no pidió la foto completa (" + m + " px)");
      await elegir("ligera"); await publicar(); m = await tamanos();
      exige(m <= 1024, "Ligera pidió caras de " + m + " px");
      exige(!n.errs.length, "errores: " + n.errs.join(" | ").slice(0, 160));
      await n.context().close();
    }, a);
    await paso("Laboratorio · estadísticas: una visita al tour se cuenta (con el lote que abrió)", async () => {
      const t = await pagina(null); await t.goto(link); await t.waitForTimeout(4500);
      const centro = await t.$$eval("path.cp-pol.con-accion", (l) => l.map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.width * r.height]; }).filter((x) => x[2] > 400).sort((a, b) => b[2] - a[2])[0]);
      exige(centro, "no hay lotes que tocar en el tour");
      await t.mouse.click(centro[0], centro[1]); await t.waitForTimeout(800);
      await t.evaluate(() => window.dispatchEvent(new Event("pagehide"))); await t.waitForTimeout(1500);
      await t.context().close();
      const d = await a.evaluate((id) => fetch("api/tours/" + id + "/estadisticas?dias=7").then((r) => r.json()), tour);
      exige(d.total >= 1, "no se contó la visita");
      exige(Object.keys(d.lotes || {}).length >= 1, "no se contó el lote que se abrió");
      await a.click('#nav button:has-text("Publicar")'); await a.waitForTimeout(500);
      await a.click('#subtabs button:has-text("Estadísticas")'); await a.waitForTimeout(1500);
      exige(await a.isVisible(".est-kpis"), "no se ve la pestaña de Estadísticas");
      await a.click('#subtabs button:has-text("Web")'); await a.waitForTimeout(800);
    }, a);
    await paso("Arrastrar encima de un lote gira la esfera; solo un toque abre su ficha", async () => {
      const t = await pagina(null); await t.goto(link); await t.waitForTimeout(4500);
      const mayor = () => t.$$eval("path.cp-pol.con-accion", (l) => l.map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.width * r.height]; }).filter((x) => x[2] > 400).sort((a, b) => b[2] - a[2])[0]);
      const antes = await mayor(); exige(antes, "no hay lotes en el tour");
      await t.mouse.move(antes[0], antes[1]); await t.mouse.down();
      for (let i = 1; i <= 12; i++) { await t.mouse.move(antes[0] - i * 18, antes[1]); await t.waitForTimeout(16); }
      await t.mouse.up(); await t.waitForTimeout(900);
      const despues = await mayor();
      exige(despues && Math.abs(despues[0] - antes[0]) > 60, "arrastrar sobre el lote no giró la esfera");
      exige(!(await t.isVisible(".pop .pop-caja")), "al arrastrar se abrió la ficha del lote");
      await t.mouse.click(despues[0], despues[1]); await t.waitForTimeout(700);
      exige(await t.isVisible(".pop .pop-caja"), "un toque en el lote ya no abre su ficha");
      await t.context().close();
    }, a);
    await paso("Botón de escena limpia: esconde puntos y lotes y los regresa", async () => {
      const t = await pagina(null); await t.goto(link); await t.waitForTimeout(4500);
      const vis = () => t.$eval(".capas", (e) => getComputedStyle(e).visibility);
      exige(await t.$('[data-sk="limpiar"]'), "el tour no trae el botón de escena limpia");
      await t.click('[data-sk="limpiar"]'); await t.waitForTimeout(500);
      exige((await vis()) === "hidden", "el botón no escondió los lotes");
      await t.click('[data-sk="limpiar"]'); await t.waitForTimeout(500);
      exige((await vis()) === "visible", "el botón no regresó los lotes");
      await t.context().close();
    }, a);
    await paso("El tour público abre en celular", async () => {
      const m = await pagina(null, Object.assign({}, devices["iPhone 13"], { acceptDownloads: false }));
      await m.goto(link); await m.waitForTimeout(5000);
      exige(await m.$("canvas"), "el tour no dibujó la esfera en celular");
      const cp = await capasPesadas(m); // lo grande encima de algo animado o en 3D le cuesta muchísima memoria al iPhone
      exige(cp.n <= MAX_CAPAS_GRANDES, "demasiadas capas de pantalla completa para un iPhone: " + JSON.stringify(cp));
      exige(!m.errs.length, "errores en celular: " + m.errs.join(" | ").slice(0, 160));
      await m.context().close();
    });
    // Aviso si se cae: si el navegador tumba el tour mientras está en pantalla (sin memoria), la próxima vez que se
    // abre en ese celular llega un reporte al Panel de dueño. Un cierre normal (salir, cambiar de página) no avisa.
    await paso("Aviso si se cae: un tour que se cierra solo en el celular llega como reporte al Panel de dueño", async () => {
      link = link || TOURS + "/" + tour + "/";
      const caidas = async () => (await a.evaluate(() => fetch("api/admin/reportes", { cache: "no-store" }).then((r) => r.json()))).reportes.filter((x) => x.tipo === "caida");
      const antes = (await caidas()).length;
      exige((await a.evaluate((id) => fetch("api/tours/" + id + "/publicar", { method: "POST" }).then((r) => r.status), tour)) === 200, "no se pudo publicar el tour de prueba");
      const m = await pagina(null, Object.assign({}, devices["iPhone 13"], { acceptDownloads: false }));
      await m.goto(link); await m.waitForTimeout(5000);
      const marca = await m.evaluate((id) => JSON.parse(sessionStorage.getItem("mz-vivo:" + id) || "null"), tour);
      exige(marca && marca.visible && marca.esfera, "el tour no deja su marca mientras está abierto: " + JSON.stringify(marca));
      // El navegador lo tumba (como Safari sin memoria): no alcanza a quitar su marca. Aquí se simula dejando la
      // marca tal cual estaba en pantalla y abriendo el tour otra vez en el mismo celular.
      await m.goto(TOURS + "/"); // salir normal: el tour quita su marca
      exige((await m.evaluate((k) => sessionStorage.getItem(k), "mz-vivo:" + tour)) === null, "al salir normal del tour no se quitó su marca");
      // Falsa alarma de El Mirador (nov 2026): cerrar la pestaña y abrir el tour minutos después no es caída
      await m.evaluate(([k, v]) => sessionStorage.setItem(k, JSON.stringify(Object.assign({}, v, { t: Date.now() - 10 * 60e3 }))), ["mz-vivo:" + tour, marca]);
      await m.goto(link); await m.waitForTimeout(3000);
      exige((await caidas()).length === antes, "una marca vieja (pestaña cerrada hace 10 minutos) mandó aviso de caída");
      // Falsa alarma de MAMAP (nov 2026): cerrar Safari desde el multitarea y abrirlo 45 s después tampoco
      await m.goto(TOURS + "/");
      await m.evaluate(([k, v]) => sessionStorage.setItem(k, JSON.stringify(Object.assign({}, v, { t: Date.now() - 45e3 }))), ["mz-vivo:" + tour, marca]);
      await m.goto(link); await m.waitForTimeout(3000);
      exige((await caidas()).length === antes, "reabrir Safari 45 s después mandó aviso de caída");
      // Ni si el tour ya no estaba al frente (en el multitarea pierde el foco) aunque se abra luego luego
      await m.goto(TOURS + "/");
      await m.evaluate(([k, v]) => sessionStorage.setItem(k, JSON.stringify(Object.assign({}, v, { t: Date.now() - 4000, foco: false }))), ["mz-vivo:" + tour, marca]);
      await m.goto(link); await m.waitForTimeout(3000);
      exige((await caidas()).length === antes, "un tour que estaba en el multitarea mandó aviso de caída");
      // Una versión vieja del tour (no dice en cuántos segundos se reabrió) no manda aviso
      exige((await a.evaluate((id) => fetch("/c/" + id, { method: "POST", body: JSON.stringify({ esfera: "x", lotes: 1, dur: 60, veces: 1 }) }).then((r) => r.status).catch(() => 0), tour)) === 204, "el servidor no aceptó (sin guardar) el aviso viejo");
      await m.waitForTimeout(800);
      exige((await caidas()).length === antes, "un aviso sin segundos de reapertura (versión vieja) llegó como caída");
      // Falsa alarma de Senderos del Rejón (nov 2026): lo cerraron (el navegador de una app no avisa) y lo volvieron a abrir
      // con el link a los 4 s. Abrir con el link («navigate») no es caída: cuando Safari se cae, él mismo RECARGA la página.
      await m.goto(TOURS + "/");
      await m.evaluate(([k, v]) => sessionStorage.setItem(k, JSON.stringify(Object.assign({}, v, { t: Date.now() - 4000 }))), ["mz-vivo:" + tour, marca]);
      await m.goto(link); await m.waitForTimeout(3000);
      exige((await caidas()).length === antes, "volver a abrir el tour con su link a los 4 s mandó aviso de caída");
      exige((await a.evaluate((id) => fetch("/c/" + id, { method: "POST", body: JSON.stringify({ esfera: "x", lotes: 1, dur: 60, veces: 1, hueco: 4, nav: "navigate" }) }).then((r) => r.status).catch(() => 0), tour)) === 204, "el servidor no aceptó (sin guardar) el aviso de un tour abierto con su link");
      await m.waitForTimeout(800);
      exige((await caidas()).length === antes, "el servidor guardó como caída un tour abierto con su link");
      // Caída de verdad: el navegador tumba la página (aquí se truena a propósito) y la recarga solo
      await m.goto(link); await m.waitForTimeout(5000);
      // (se simula: al salir, la marca se queda como estaba en pantalla, como cuando el navegador no alcanza a quitarla)
      await m.evaluate((k) => { window.addEventListener("pagehide", () => { const v = JSON.parse(sessionStorage.getItem(k) || "null") || window.__marca; sessionStorage.setItem(k, JSON.stringify(Object.assign({}, v, { t: Date.now() }))); }); window.__marca = JSON.parse(sessionStorage.getItem(k)); }, "mz-vivo:" + tour);
      const m2 = m; m2.errs = [];
      await m2.reload(); await m2.waitForTimeout(4000);
      let lista = []; for (let i = 0; i < 10 && lista.length <= antes; i++) { await new Promise((r) => setTimeout(r, 500)); lista = await caidas(); }
      exige(lista.length === antes + 1, "no llegó el aviso de que el tour se cerró solo (" + lista.length + " vs " + antes + ")");
      const rep = lista[0];
      console.log("    aviso: " + rep.texto);
      exige(rep.contexto.tour === tour && /iPhone/.test(rep.texto) && /esfera «/.test(rep.texto) && /abrir a los \d+ s/.test(rep.texto) && rep.caida && rep.caida.lotes === marca.lotes, "el aviso no dice el tour, el celular, la esfera o los lotes: " + rep.texto);
      // Cerrarlo normal (irse a otra página) no es falla: al volver a abrirlo no llega otro aviso
      await m2.goto("about:blank"); await m2.waitForTimeout(500);
      await m2.goto(link); await m2.waitForTimeout(4000);
      exige((await caidas()).length === antes + 1, "un cierre normal mandó un aviso de caída");
      // En el Panel de dueño sale marcado como aviso automático, con el link al tour
      const dn = await pagina(DUENO);
      await dn.click('#nav button:has-text("Mis Tours")'); await dn.waitForTimeout(800);
      await dn.click("#ver-cuentas"); await dn.waitForTimeout(1200);
      await dn.click('[data-dueno="reportes"]'); await dn.waitForTimeout(1200);
      exige(await dn.isVisible(".rep-item.caida"), "el aviso no sale en el Panel de dueño");
      exige(/Abrir el tour/.test(await dn.textContent(".rep-item.caida")), "el aviso no trae el link al tour");
      if (process.env.CAPTURAS) { await dn.$eval(".rep-item.caida", (e) => e.scrollIntoView({ block: "center" })); await dn.screenshot({ path: path.join(process.env.CAPTURAS, "aviso-caida.png") }); }
      await dn.context().close();
      exige(!m2.errs.length, "errores en el celular: " + m2.errs.join(" | ").slice(0, 160));
      await m.context().close();
    });
    // Manual dentro de Mozari (Laboratorio): primero se busca la respuesta ahí; si no, «Reportar un error»
    await paso("Manual: abre con los temas de la sección, busca, muestra los pasos y lleva a Reportar un error", async () => {
      const dn = await pagina(DUENO);
      await dn.goto(ESTUDIO + "/#t=" + tour); await dn.reload(); await dn.waitForTimeout(2500); await cerrarAnuncio(dn); await cerrarGuia(dn);
      await dn.click('#nav button:has-text("Panoramas")'); await dn.waitForTimeout(500);
      await dn.click('#subtabs button:has-text("Capas")'); await dn.waitForTimeout(1500); await cerrarGuia(dn);
      exige(await dn.isVisible("#abrir-manual"), "no está el botón del Manual");
      await dn.click("#abrir-manual"); await dn.waitForTimeout(400);
      exige(await dn.isVisible("#manual"), "no se abrió el Manual");
      const sug = await dn.$$eval("#mn-cuerpo .mn-cap", (l) => l.map((e) => e.textContent));
      exige(sug[0] === "Para esta sección" && /Hotspots/.test(await dn.textContent("#mn-cuerpo")), "el Manual no sugiere los temas de Capas: " + sug.join(" | "));
      if (process.env.CAPTURAS) await dn.screenshot({ path: path.join(process.env.CAPTURAS, "manual-capas.png") });
      await dn.fill("#mn-buscar", "pdf"); await dn.waitForTimeout(300);
      exige(/Lotes desde tu PDF/.test(await dn.textContent("#mn-cuerpo")), "buscar «pdf» no encontró el tema de Lotes desde tu PDF");
      await dn.click('[data-mn="3.5"]'); await dn.waitForTimeout(300);
      exige(/Lotes desde tu PDF/.test(await dn.textContent("#mn-cuerpo h3")) && (await dn.$$("#mn-cuerpo ol li")).length >= 6 && /Plano bueno/.test(await dn.textContent("#mn-cuerpo")), "el tema 3.5 no muestra sus pasos");
      if (process.env.CAPTURAS) await dn.screenshot({ path: path.join(process.env.CAPTURAS, "manual-tema.png") });
      await dn.click("#manual [data-reportar]"); await dn.waitForTimeout(400);
      exige(await dn.isVisible("#rep-texto"), "«Reportar un error» del Manual no abre el reporte");
      await dn.click("[data-dp-cerrar]").catch(() => dn.keyboard.press("Escape")); await dn.waitForTimeout(300);
      await dn.click("#mn-cerrar"); await dn.waitForTimeout(200);
      exige(!(await dn.isVisible("#manual")), "el Manual no se cierra");
      exige(!dn.errs.length, "errores en el estudio: " + dn.errs.join(" | ").slice(0, 200));
      await dn.context().close();
      // Es del Laboratorio («Solo yo» al nacer): una cuenta normal todavía no lo ve
      const u = await pagina("manual-" + Date.now() + "@prueba.mx");
      exige(!(await u.isVisible("#abrir-manual")), "una cuenta normal ya ve el Manual (debe nacer en el Laboratorio)");
      await u.context().close();
    });
    // Reporte (El Mirador, nov 2026): el tour se cerraba solo en iPhone («Ocurrió un problema varias veces»).
    // Los lotes del PDF se hicieron después del hotspot y del punto de interés, así que quedaban encima de ellos.
    // Cada lote encima de algo animado o en 3D le costaba al iPhone una capa del tamaño de la pantalla.
    // Ahora los polígonos siempre van abajo y los puntos arriba, sin importar en qué orden se crearon.
    await paso("En el tour los lotes van abajo y los puntos arriba aunque se hayan creado después (iPhone sin memoria)", async () => {
      link = link || TOURS + "/" + tour + "/";
      const leer = () => a.evaluate((id) => fetch("api/tours/" + id).then((r) => r.json()), tour);
      const guardar = (d) => a.evaluate(([id, d]) => fetch("api/tours/" + id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(d) }).then((r) => r.status), [tour, d]);
      const publicar = () => a.evaluate((id) => fetch("api/tours/" + id + "/publicar", { method: "POST" }).then((r) => r.status), tour);
      // Como en El Mirador: un texto en 3D hasta abajo de la lista y TODOS los lotes creados después de él
      const original = await leer(), d = JSON.parse(JSON.stringify(original));
      const esc = [d.proyecto.escenaInicial || (d.escenas[0] || {}).id].find((k) => (d.capas[k] || []).some((c) => c.tipo === "poligono" && c.visible !== false));
      exige(esc, "el tour de prueba no tiene lotes");
      const vista = (d.escenas.find((e) => e.id === esc) || {}).vista || {}, y0 = vista.yaw || 0, p0 = vista.pitch || 0; // a la vista, como el hotspot de El Mirador
      d.capas[esc].unshift({ id: "orden-prueba", tipo: "texto", nombre: "Texto", visible: true, en3d: true, yaw: y0, pitch: p0, texto: "Encima", tamano: 18, peso: 600, color: "#FFFFFF", fondo: { activo: false, color: "#0B0B0B" } });
      exige((await guardar(d)) === 200 && (await publicar()) === 200, "no se pudo preparar el tour de prueba");
      const m = await pagina(null, Object.assign({}, devices["iPhone 13"], { acceptDownloads: false }));
      try { await m.goto(link); await m.waitForTimeout(5000); }
      finally { await guardar(original); await publicar(); } // el tour regresa a como estaba
      const r = await m.evaluate(() => {
        const hijos = [...document.querySelectorAll(".capas > *")];
        const pols = hijos.map((e, i) => (e.classList.contains("cp-poligono") ? i : -1)).filter((i) => i >= 0);
        const puntos = hijos.map((e, i) => (e.classList.contains("cp") && !e.classList.contains("cp-poligono") ? i : -1)).filter((i) => i >= 0);
        const etq = hijos.findIndex((e) => e.classList.contains("capa-etq"));
        return { pols: pols.length, puntos: puntos.length, ultimoPol: Math.max(...pols), primerPunto: Math.min(...puntos), etq };
      });
      exige(r.pols && r.puntos, "no se ven lotes y puntos en el tour (" + JSON.stringify(r) + ")");
      const cp = await capasPesadas(m);
      console.log("    capas grandes en el celular: " + JSON.stringify(cp));
      exige(cp.n <= MAX_CAPAS_GRANDES, "demasiadas capas de pantalla completa para un iPhone: " + JSON.stringify(cp));
      exige(r.ultimoPol < r.etq && r.etq < r.primerPunto, "un polígono quedó encima de un punto: " + JSON.stringify(r));
      exige(!m.errs.length, "errores en celular: " + m.errs.join(" | ").slice(0, 160));
      await m.context().close();
    });
    // Reporte (MAMAP, nov 2026): el piloto miraba al suelo y los puntos de interés en 3D del horizonte quedaban
    // estirados miles de píxeles fuera de pantalla, cada uno una capa enorme con su latido en el iPhone
    await paso("Un punto en 3D casi de lado (mirando al suelo) se oculta y vuelve al mirarlo (iPhone sin memoria)", async () => {
      link = link || TOURS + "/" + tour + "/";
      const leer = () => a.evaluate((id) => fetch("api/tours/" + id).then((r) => r.json()), tour);
      const guardar = (d) => a.evaluate(([id, d]) => fetch("api/tours/" + id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(d) }).then((r) => r.status), [tour, d]);
      const publicar = () => a.evaluate((id) => fetch("api/tours/" + id + "/publicar", { method: "POST" }).then((r) => r.status), tour);
      const original = await leer();
      const esc = original.proyecto.escenaInicial || (original.escenas[0] || {}).id;
      const yaw = ((original.escenas.find((e) => e.id === esc) || {}).vista || {}).yaw || 0;
      const pi = (id, nombre, pitch) => ({ id, tipo: "interes", nombre, visible: true, en3d: true, yaw, pitch, t3d: { inclinar: -7, girar: 16, rotar: 0, ancho: 1, alto: 1 },
        pi: { dato: "TERMINAL", nombre, detalle: "a 2 cuadras", color: "#0B0B0B", grosor: 1.5, linea: "continua", punto: "doble", lado: "der", alto: 20, angulo: 63, horiz: 9, tam: 0.6, contraste: "caja-clara", animar: true, latido: true } });
      const probar = async (pitchVista) => {
        const d = JSON.parse(JSON.stringify(original)), e = d.escenas.find((x) => x.id === esc);
        e.vista = Object.assign({}, e.vista, { yaw, pitch: pitchVista, fov: 1.4 }); delete e.piloto;
        d.proyecto.presentacion = { activa: false };
        d.capas[esc] = (d.capas[esc] || []).concat([pi("pi-horizonte", "HORIZONTE", 0.05), pi("pi-abajo", "ABAJO", 1.2)]);
        exige((await guardar(d)) === 200 && (await publicar()) === 200, "no se pudo preparar el tour de prueba");
        const m = await pagina(null, Object.assign({}, devices["iPhone 13"], { acceptDownloads: false }));
        await m.goto(link); await m.waitForTimeout(5000);
        const r = await m.evaluate(() => {
          const de = (txt) => { const el = [...document.querySelectorAll(".cp-interes")].find((x) => x.textContent.includes(txt)); if (!el) return null; const b = el.querySelector(".pi-etq").getBoundingClientRect(); return { display: getComputedStyle(el).display, w: Math.round(b.width), h: Math.round(b.height) }; };
          let grande = 0; document.querySelectorAll(".cp-interes *").forEach((x) => { const b = x.getBoundingClientRect(), s = getComputedStyle(x.closest(".cp-interes")); if (s.display !== "none" && s.visibility !== "hidden") grande = Math.max(grande, b.width, b.height); });
          return { horizonte: de("HORIZONTE"), abajo: de("ABAJO"), grande: Math.round(grande), alto: innerHeight };
        });
        const cp = await capasPesadas(m);
        exige(!m.errs.length, "errores en celular: " + m.errs.join(" | ").slice(0, 160));
        await m.context().close();
        return Object.assign(r, { capas: cp.n });
      };
      let suelo, frente;
      try { suelo = await probar(1.5); frente = await probar(0.05); }
      finally { await guardar(original); await publicar(); } // el tour regresa a como estaba
      console.log("    mirando al suelo: " + JSON.stringify(suelo) + " · al frente: " + JSON.stringify(frente));
      exige(suelo.horizonte && suelo.horizonte.display === "none", "mirando al suelo, el punto del horizonte sigue dibujado fuera de pantalla: " + JSON.stringify(suelo));
      exige(suelo.abajo && suelo.abajo.display !== "none" && suelo.abajo.w > 20, "mirando al suelo, el punto que sí se ve desapareció: " + JSON.stringify(suelo));
      exige(suelo.grande < 3 * suelo.alto, "mirando al suelo, un punto en 3D quedó enorme: " + JSON.stringify(suelo));
      exige(frente.horizonte && frente.horizonte.display !== "none" && frente.horizonte.w > 20, "al mirarlo de frente, el punto del horizonte no regresó: " + JSON.stringify(frente));
      exige(suelo.capas <= MAX_CAPAS_GRANDES && frente.capas <= MAX_CAPAS_GRANDES, "demasiadas capas grandes para un iPhone: " + suelo.capas + " / " + frente.capas);
    });
    await paso("Descargar el tour (.zip) para otro hosting", async () => {
      const [dl] = await Promise.all([a.waitForEvent("download", { timeout: 60000 }), a.click("#pub-descargar")]);
      const destino = path.join(DATOS, "tour.zip"); await dl.saveAs(destino);
      const zip = require(LIB.fflate).unzipSync(new Uint8Array(fs.readFileSync(destino)));
      const nombres = Object.keys(zip);
      exige(nombres.some((n) => n.endsWith("/index.html")) && nombres.some((n) => n.endsWith("/proyecto.json")) && nombres.some((n) => n.includes("/escenas/")), "el zip está incompleto");
      // El tour descargado lleva sus librerías: no depende de jsDelivr ni de ningún otro servidor
      exige(nombres.some((n) => n.endsWith("/lib/marzipano.js")) && nombres.some((n) => n.endsWith("/lib/d3.min.js")), "el zip no trae las librerías del visor");
      const ix = new TextDecoder().decode(zip[nombres.find((n) => n.endsWith("/index.html"))]);
      exige(ix.includes('src="lib/marzipano.js"') && !/cdn\.jsdelivr|unpkg\.com|cdnjs/.test(ix), "el index.html del zip todavía pide librerías a otro servidor");
    }, a);
    // El .zip subido a otro hosting: se descomprime en una carpeta, la sirve un servidor aparte (como el cPanel del
    // cliente) y el tour tiene que abrir completo sin pedirle nada a Mozari
    await paso("El tour descargado (.zip) funciona subido a otro hosting, sin Mozari", async () => {
      const zip = require(LIB.fflate).unzipSync(new Uint8Array(fs.readFileSync(path.join(DATOS, "tour.zip"))));
      const raiz = path.join(DATOS, "hosting");
      for (const [n, datos] of Object.entries(zip)) { if (n.endsWith("/")) continue; const f = path.join(raiz, n); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(datos)); }
      const carpeta = Object.keys(zip).find((n) => n.endsWith("/index.html")).replace(/index\.html$/, "");
      const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".css": "text/css", ".woff2": "font/woff2" };
      const srv = require("http").createServer((req, res) => {
        let ruta = decodeURIComponent(new URL(req.url, "http://x").pathname); if (ruta.endsWith("/")) ruta += "index.html";
        const f = path.join(raiz, ruta);
        if (!f.startsWith(raiz) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("no"); return; }
        res.writeHead(200, { "content-type": TIPOS[path.extname(f).toLowerCase()] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
      });
      await new Promise((ok) => srv.listen(8795, ok));
      try {
        const h = await pagina(null), aMozari = [];
        h.on("request", (r) => { if (/localhost:87(87|88)|mozari\.app/.test(r.url())) aMozari.push(r.url()); });
        await h.goto("http://localhost:8795/" + carpeta); await h.waitForTimeout(5000);
        exige(await h.$("canvas"), "en el otro hosting el tour no dibujó la esfera");
        exige(!h.errs.length, "errores en el otro hosting: " + h.errs.join(" | ").slice(0, 200));
        const lote = await h.$$eval("path.cp-pol.con-accion", (l) => l.map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.width * r.height]; }).filter((x) => x[2] > 300 && x[0] > 0 && x[1] > 0 && x[0] < 1400 && x[1] < 900).sort((p, q) => q[2] - p[2])[0]);
        exige(lote, "en el otro hosting no salen los lotes");
        await h.mouse.click(lote[0], lote[1]); await h.waitForTimeout(700);
        exige(await h.isVisible(".pop .pop-caja"), "en el otro hosting el lote no abre su ficha");
        exige(!aMozari.length, "el tour del otro hosting le pidió cosas a Mozari: " + aMozari.slice(0, 3).join(" , "));
        await h.context().close();
      } finally { srv.close(); }
    }, a);
    await paso("Modo privado: el tour se oculta sin borrarlo y vuelve igual", async () => {
      exige(await a.$("#pub-privado"), "no está el botón de modo privado");
      await a.click("#pub-privado"); await a.waitForTimeout(1500);
      exige(/Mostrar/.test(await a.textContent("#pub-privado")), "el botón no cambió a Mostrar tour");
      if (process.env.CAPTURAS) { await a.$eval("#pub-privado", (e) => e.scrollIntoView({ block: "center" })); await a.screenshot({ path: path.join(process.env.CAPTURAS, "privado-oculto.png") }); }
      const t = await pagina(null), r = await t.goto(TOURS + "/" + tour + "/"); await t.waitForTimeout(500);
      exige(r.status() === 403 && /no está disponible/.test(await t.textContent("body")), "el tour oculto todavía se ve (" + r.status() + ")");
      if (process.env.CAPTURAS) await t.screenshot({ path: path.join(process.env.CAPTURAS, "privado-link.png") });
      exige((await fetch(TOURS + "/" + tour + "/proyecto.json")).status === 404, "los datos del tour oculto siguen a la vista");
      const priv = await a.evaluate((id) => fetch("api/tours").then((x) => x.json()).then((l) => (l.tours.find((x) => x.id === id) || {}).privado), tour);
      exige(priv === "1", "Mis Tours no sabe que está oculto");
      if (process.env.CAPTURAS) {
        const m = await pagina(DUENO); await m.waitForTimeout(1500);
        await m.screenshot({ path: path.join(process.env.CAPTURAS, "privado-mis-tours.png") }); await m.context().close();
      }
      await a.click("#pub-privado"); await a.waitForTimeout(1500);
      exige(/Ocultar/.test(await a.textContent("#pub-privado")), "el botón no regresó a Ocultar tour");
      await t.goto(TOURS + "/" + tour + "/"); await t.waitForTimeout(4000);
      exige(await t.$("canvas"), "al mostrarlo, el tour no volvió");
      await t.context().close();
    }, a);
    await paso("Compartir: link, código para insertar y QR que se lee", async () => {
      await a.click('#subtabs button:has-text("Compartir")'); await a.waitForTimeout(1500);
      const url = (await a.textContent(".comp .pub-caja code")).trim();
      exige(url.endsWith("/" + tour + "/"), "el link de Compartir no es el del tour (" + url + ")");
      exige(!(await a.$(".comp-aviso")), "dice que no está publicado y sí lo está");
      exige((await a.inputValue("#comp-codigo")).includes('src="' + url + '"'), "el código para insertar no trae el link del tour");
      await a.click('[data-comp-modo="alto"]'); await a.waitForTimeout(300); await a.fill("#comp-alto", "700"); await a.waitForTimeout(200);
      exige((await a.inputValue("#comp-codigo")).includes('height="700"'), "el alto fijo no cambió el código");
      await a.waitForSelector("#comp-qr svg", { timeout: 15000 });
      const [dl] = await Promise.all([a.waitForEvent("download", { timeout: 30000 }), a.click('[data-comp="png"]')]);
      const destino = path.join(DATOS, "qr.png"); await dl.saveAs(destino);
      const img = require(LIB.pngjs).PNG.sync.read(fs.readFileSync(destino)), leido = require(LIB.jsqr)(new Uint8ClampedArray(img.data), img.width, img.height);
      exige(leido && leido.data === url + "?utm_source=qr", "el QR descargado no se lee o no lleva al tour (" + (leido && leido.data) + ")");
      const [dl2] = await Promise.all([a.waitForEvent("download", { timeout: 30000 }), a.click('[data-comp="svg"]')]);
      exige((await dl2.suggestedFilename()).endsWith(".svg"), "no bajó el SVG");
    }, a);
    // Pedido de un cliente (OBED, nov 2026): leyenda de colores de los lotes con cuántos hay de cada estado
    await paso("Leyenda de lotes en el tour: el color de cada estado y cuántos hay", async () => {
      const foto = (p, n) => (process.env.CAPTURAS ? p.screenshot({ path: path.join(process.env.CAPTURAS, n + ".png") }) : null);
      await a.click('#nav button:has-text("Interfaz")'); await a.waitForTimeout(1200);
      exige(!(await a.$("#sk-ui .sk-leyenda")), "la leyenda sale sin prenderla");
      await a.check('[data-sk-k="extra.leyenda"]'); await a.waitForTimeout(900);
      const ley = await a.$$eval("#sk-ui .sk-leyenda .ley-it", (l) => l.map((x) => x.textContent.trim()));
      exige(ley.some((x) => /^Disponible\d+$/.test(x)) && ley.some((x) => /^Vendido\d+$/.test(x)), "la leyenda no muestra Disponible y Vendido con su cantidad: " + JSON.stringify(ley));
      exige(!ley.some((x) => /^Apartado/.test(x)), "la leyenda muestra un estado que no tiene lotes");
      for (const pl of ["cine", "desarrollo", "dock", "brujula"]) {
        await a.click('[data-sk-k="plantilla"][data-v="' + pl + '"]'); await a.waitForTimeout(700);
        exige(await a.$("#sk-ui .sk-leyenda"), "la leyenda no sale en la plantilla " + pl);
        await foto(a, "leyenda-" + pl);
      }
      await a.click('#subtabs button:has-text("9:16")'); await a.waitForTimeout(1000); await foto(a, "leyenda-brujula-v");
      await a.click('[data-sk-k="plantilla"][data-v="cine"]'); await a.waitForTimeout(700); await foto(a, "leyenda-cine-v");
      await a.click('#subtabs button:has-text("16:9")'); await a.waitForTimeout(700);
      await a.uncheck('[data-sk-k="extra.leyendaCantidad"]'); await a.waitForTimeout(700);
      exige(await a.$$eval("#sk-ui .sk-leyenda .ley-it b", (l) => l.length) === 0, "«Con cuántos hay» no quita las cantidades");
      await a.check('[data-sk-k="extra.leyendaCantidad"]'); await a.waitForTimeout(500);
      // En el tour publicado
      await a.click('#nav button:has-text("Publicar")'); await a.waitForTimeout(500); await a.click('#subtabs button:has-text("Web")'); await a.waitForTimeout(800); await a.click("#pub-publicar"); await a.waitForTimeout(3500);
      const t = await pagina(null); await t.goto(TOURS + "/" + tour + "/"); await t.waitForTimeout(4500);
      const pub = await t.$$eval(".sk-leyenda .ley-it", (l) => l.map((x) => x.textContent.trim()));
      exige(JSON.stringify(pub) === JSON.stringify(ley), "el tour publicado no muestra la misma leyenda: " + JSON.stringify(pub));
      await foto(t, "leyenda-publicado");
      exige(!t.errs.length, "errores en el tour: " + t.errs.join(" | ").slice(0, 160));
      await t.context().close();
      // Se apaga para no cambiar las demás pruebas
      await a.click('#nav button:has-text("Interfaz")'); await a.waitForTimeout(1000); await a.uncheck('[data-sk-k="extra.leyenda"]'); await a.waitForTimeout(600);
    }, a);
    // Pedido de un cliente (OBED, nov 2026): su propio crédito abajo del tour («Desarrollado por…»)
    await paso("Crédito propio abajo del tour («Desarrollado por…») con su enlace", async () => {
      const foto = (p, n) => (process.env.CAPTURAS ? p.screenshot({ path: path.join(process.env.CAPTURAS, n + ".png") }) : null);
      await a.click('#nav button:has-text("Interfaz")'); await a.waitForTimeout(1000);
      exige(!(await a.$("#sk-ui .sk-credito")), "sale un crédito sin escribirlo");
      await a.fill('[data-sk-k="credito.texto"]', "Desarrollado por R360"); await a.fill('[data-sk-k="credito.enlace"]', "r360.mx"); await a.waitForTimeout(900);
      const c = await a.$eval("#sk-ui .sk-credito", (e) => [e.textContent, e.getAttribute("href"), e.getAttribute("target")]).catch(() => null);
      exige(c && c[0] === "Desarrollado por R360" && c[1] === "https://r360.mx" && c[2] === "_blank", "el crédito no sale con su enlace: " + JSON.stringify(c));
      await a.click('[data-sk-k="plantilla"][data-v="desarrollo"]'); await a.waitForTimeout(700);
      exige(await a.$("#sk-ui .d-pie .sk-credito"), "en la plantilla Desarrollo el crédito no va dentro del panel");
      await foto(a, "credito-desarrollo");
      await a.click('[data-sk-k="plantilla"][data-v="dock"]'); await a.waitForTimeout(700); await foto(a, "credito-dock");
      await a.click('[data-sk-k="plantilla"][data-v="cine"]'); await a.waitForTimeout(700);
      await a.click('#nav button:has-text("Publicar")'); await a.waitForTimeout(500); await a.click('#subtabs button:has-text("Web")'); await a.waitForTimeout(800); await a.click("#pub-publicar"); await a.waitForTimeout(3500);
      const t = await pagina(null); await t.goto(TOURS + "/" + tour + "/"); await t.waitForTimeout(4500);
      exige(await t.$eval(".sk-credito", (e) => e.textContent + " " + e.getAttribute("href")).catch(() => "") === "Desarrollado por R360 https://r360.mx", "el tour publicado no trae el crédito");
      await foto(t, "credito-publicado");
      await t.context().close();
      await a.click('#nav button:has-text("Interfaz")'); await a.waitForTimeout(1000);
      await a.fill('[data-sk-k="credito.texto"]', ""); await a.fill('[data-sk-k="credito.enlace"]', ""); await a.waitForTimeout(600);
      exige(!(await a.$("#sk-ui .sk-credito")), "al borrar el texto el crédito no se quita");
    }, a);
    await paso("Pantalla de carga con el logo del proyecto, no con Mozari", async () => {
      const foto = (p, n) => (process.env.CAPTURAS ? p.screenshot({ path: path.join(process.env.CAPTURAS, n + ".png") }) : null);
      const publicar = async () => { await a.click('#nav button:has-text("Publicar")'); await a.waitForTimeout(500); await a.click('#subtabs button:has-text("Web")'); await a.waitForTimeout(800); await a.click("#pub-publicar"); await a.waitForTimeout(3500); };
      const crudo = async () => (await fetch(TOURS + "/" + tour + "/")).text();
      // Sin logo en el Skin: solo el nombre del proyecto (y nada de Mozari ni del crédito)
      await publicar();
      let h = await crudo();
      exige(/<div class="splash propia sin-logo" id="splash"/.test(h), "sin logo: el servidor no puso la pantalla de carga del proyecto");
      const splash = (x) => { const i = x.indexOf('id="splash"'), j = i < 0 ? -1 : x.indexOf("</div></div>", i); return i < 0 ? "" : x.slice(i, j < 0 ? i + 600 : j + 12); };
      exige(!/MOZARI|Created by|R360/.test(splash(h)), "la pantalla de carga todavía muestra a Mozari: " + splash(h).slice(0, 160));
      exige(h.includes('class="splash-nombre">Revision</b>'), "sin logo: no sale el nombre del proyecto");
      // Con el logo del cliente en el Skin y paneles blancos: sale el logo, con letras oscuras que se leen
      await a.click('#nav button:has-text("Interfaz")'); await a.waitForTimeout(1200);
      await a.click('button[data-sk-k="logo.tipo"][data-v="propio"]'); await a.waitForTimeout(500);
      await a.evaluate(async () => {
        const cv = document.createElement("canvas"); cv.width = 480; cv.height = 200; const x = cv.getContext("2d");
        x.fillStyle = "#1F4D3A"; x.beginPath(); x.moveTo(60, 170); x.lineTo(110, 40); x.lineTo(160, 170); x.closePath(); x.fill();
        x.fillStyle = "#3E7D5E"; x.beginPath(); x.moveTo(110, 170); x.lineTo(150, 70); x.lineTo(190, 170); x.closePath(); x.fill();
        x.fillStyle = "#1F4D3A"; x.font = "700 52px Arial"; x.fillText("BOSQUE", 210, 105); x.font = "400 40px Arial"; x.fillText("ALTO", 212, 160);
        const bl = await new Promise((o) => cv.toBlob(o, "image/png"));
        const inp = document.getElementById("sk-logo-archivo"), dt = new DataTransfer(); dt.items.add(new File([bl], "logo.png", { type: "image/png" }));
        inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await a.waitForTimeout(2000);
      await a.click('button[data-sk-k="panel"][data-v="#FFFFFF"]'); await a.waitForTimeout(400);
      await a.click('button[data-sk-k="acento"][data-v="#127A5E"]'); await a.waitForTimeout(900);
      exige(await a.$eval(".grupo .nota", (e) => /carga con este logo/.test(e.textContent)).catch(() => false) || /carga con este logo/.test(await a.textContent("body")), "el Skin no avisa que el logo sale en la carga");
      await publicar();
      h = await crudo();
      const src = (h.match(/<img class="splash-logo" src="([^"]+)"/) || [])[1];
      exige(src && /^archivos\//.test(src), "con logo: la pantalla de carga no trae el logo del Skin");
      exige((await fetch(TOURS + "/" + tour + "/" + src)).status === 200, "el logo de la carga no se puede abrir en el tour público");
      exige(/--c-fondo:#FFFFFF;--c-acento:#127A5E;--c-texto:#1C1C1C/i.test(h), "la carga no usa los colores del Skin (o el texto no se lee)");
      // El visitante: la carga con el logo se ve desde el inicio y se quita cuando la esfera está lista
      const t = await pagina(null);
      await t.route(/\/escenas\/.*\/[1-9]\//, async (r) => { await espera(1500); r.continue(); }); // esferas lentas, como en celular
      await t.goto(TOURS + "/" + tour + "/", { waitUntil: "commit" }); await t.waitForTimeout(900);
      exige(await t.$eval("#splash", (e) => e.classList.contains("propia") && getComputedStyle(e).visibility !== "hidden" && e.querySelector(".splash-logo").complete && e.querySelector(".splash-logo").naturalWidth > 0).catch(() => false), "el visitante no ve el logo mientras carga");
      await foto(t, "carga-logo");
      for (let i = 0; i < 30 && (await t.$("#splash")); i++) await t.waitForTimeout(500);
      exige(!(await t.$("#splash")), "la pantalla de carga no se quitó al terminar");
      exige(await t.$("canvas") && !(await t.$(".agua-mozari")) && !(await t.$(".intro-mozari")), "el tour no quedó listo o salió con marca de Mozari");
      exige(!t.errs.length, "errores en el tour: " + t.errs.join(" | ").slice(0, 160));
      await t.context().close();
      // Vista previa del estudio: igual que el tour publicado
      await a.click('button:has-text("Vista previa")'); await a.waitForTimeout(300);
      exige(await a.$("#previa .splash.propia.en-previa .splash-logo"), "la vista previa no muestra la carga con el logo");
      await foto(a, "carga-previa");
      for (let i = 0; i < 30 && (await a.$("#previa .splash.en-previa")); i++) await a.waitForTimeout(500);
      exige(!(await a.$("#previa .splash.en-previa")), "en la vista previa la carga no se quitó");
      for (let i = 0; i < 4 && (await a.isVisible("#previa")); i++) { await a.keyboard.press("Escape"); await a.waitForTimeout(500); }
      exige(!(await a.isVisible("#previa")), "la vista previa no se cerró");
      // El tour descargado para otro hosting también trae la carga con el logo
      const d = await a.evaluate((id) => fetch("api/tours/" + id + "/descargar").then((r) => r.json()), tour);
      exige(/<div class="splash propia" id="splash"/.test(d.html || "") && (d.html || "").includes('src="' + src + '"'), "el tour descargado no trae la carga con el logo");
      // Se regresa el Skin como estaba para las demás pruebas
      await a.click('#nav button:has-text("Interfaz")'); await a.waitForTimeout(800);
      await a.click('button[data-sk-k="logo.tipo"][data-v="ninguno"]'); await a.click('button[data-sk-k="panel"][data-v="#111111"]'); await a.waitForTimeout(600);
      await publicar();
    }, a);
    await paso("Panel de dueño: cuentas, links, reportes, laboratorio y actualizaciones", async () => {
      const u = await pagina("pais-" + Date.now() + "@prueba.mx"); await u.waitForTimeout(1500); await u.context().close(); // un usuario que entra (su país se guarda)
      await a.click('#nav button:has-text("Mis Tours")'); await a.waitForTimeout(800); await pasarGuias(a);
      await a.click("#ver-cuentas"); await a.waitForTimeout(1200);
      exige(await a.isVisible(".cuentas-conteo"), "no se ve el conteo de usuarios");
      if (process.env.CAPTURAS) await a.screenshot({ path: path.join(process.env.CAPTURAS, "panel-tours.png") });
      const tt = await a.textContent(".tours-conteo").catch(() => "");
      exige(/[1-9]\d* tours publicados/.test(tt) && /creados en total/.test(tt), "no se ve cuántos tours se han publicado: " + tt);
      // De qué países son los usuarios, con bandera (aquí Cloudflare dice Estados Unidos)
      const pz = await a.textContent(".paises-conteo").catch(() => "");
      exige(/🇺🇸\s*[1-9]\d*\s*Estados Unidos/.test(pz), "no se ven los países de los usuarios con su bandera: " + pz);
      exige(/🇺🇸/.test(await a.textContent(".cuenta-pais").catch(() => "")), "las cuentas no traen su bandera");
      const cs = await a.evaluate(() => fetch("api/admin/cuentas").then((r) => r.json()));
      exige(cs.cuentas.filter((c) => !c.admin && c.pais === "US").length >= 1, "el país no se guarda en las cuentas: " + JSON.stringify(cs.cuentas.slice(0, 3).map((c) => c.pais)));
      if (process.env.CAPTURAS) { await a.$eval(".paises-conteo", (e) => e.scrollIntoView({ block: "center" })); await a.screenshot({ path: path.join(process.env.CAPTURAS, "panel-paises.png") }); }
      for (const t of ["links", "reportes", "laboratorio", "novedades"]) { await a.click('[data-dueno="' + t + '"]'); await a.waitForTimeout(900); }
    }, a);

    // Amar sin su compu (nov 2026): el Panel de dueño se usa desde el celular
    await paso("Panel de dueño en el celular: se lee sin salirse de la pantalla", async () => {
      const u0 = await pagina("alguien-" + Date.now() + "@prueba.mx"); await u0.waitForTimeout(800); await u0.context().close(); // una cuenta más en la lista
      const m = await pagina(DUENO, Object.assign({}, devices["iPhone 13"], { acceptDownloads: false }));
      await m.waitForTimeout(1500); await pasarGuias(m);
      const ver = async (nombre) => { if (process.env.CAPTURAS) await m.screenshot({ path: path.join(process.env.CAPTURAS, "movil-" + nombre + ".png"), fullPage: true }); };
      // Nada se sale de la pantalla a lo ancho (se lee sin mover de lado)
      const ancho = () => m.evaluate(() => { const mv = document.querySelector(".movil"), W = innerWidth; let peor = null;
        mv.querySelectorAll("*").forEach((e) => { const r = e.getBoundingClientRect(); if (r.width && r.right > W + 2 && !e.closest(".rep-tabs") && (!peor || r.right > peor.r)) peor = { r: Math.round(r.right), e: e.tagName + "." + String(e.className).slice(0, 30) }; });
        return { W, peor, scroll: mv.scrollWidth > mv.clientWidth + 2 }; });
      await m.waitForTimeout(2500);
      exige(await m.isVisible(".movil #cuentas .cuentas-conteo"), "en el celular no sale el Panel de dueño");
      exige(!(await m.isVisible("#mv-compu")), "al dueño le sale «Mozari se usa en computadora» en lugar de su panel");
      exige(/usuarios/.test(await m.textContent(".movil .cuentas-conteo")) && (await m.$$(".movil #cuentas tbody tr")).length >= 2, "el panel del celular no trae las cuentas");
      await ver("cuentas");
      if (process.env.CAPTURAS) { await m.$eval(".movil #cuentas table", (e) => e.scrollIntoView({ block: "start" })); await m.waitForTimeout(300); await m.screenshot({ path: path.join(process.env.CAPTURAS, "movil-cuentas-lista.png") }); }
      let a0 = await ancho(); exige(!a0.peor && !a0.scroll, "en el celular algo de las cuentas se sale de la pantalla: " + JSON.stringify(a0));
      for (const t of ["reportes", "links", "laboratorio", "novedades"]) {
        await m.click('.movil [data-dueno="' + t + '"]'); await m.waitForTimeout(1500); await ver(t);
        const a1 = await ancho(); exige(!a1.peor && !a1.scroll, "en el celular algo de «" + t + "» se sale de la pantalla: " + JSON.stringify(a1));
      }
      await m.click('.movil [data-dueno="reportes"]'); await m.waitForTimeout(1200);
      exige(await m.isVisible('.movil [data-dueno="reportes"].primario') && ((await m.$$(".movil .rep-item")).length > 0) === ((await m.evaluate(() => fetch("api/admin/reportes").then((r) => r.json()))).reportes.length > 0), "en el celular no se ven los reportes");
      exige(!m.errs.length, "errores en el celular: " + m.errs.join(" | ").slice(0, 200));
      await m.context().close();
      // Un usuario normal en el celular sigue viendo «se usa en computadora» y nada del panel
      const u = await pagina("cel-" + Date.now() + "@prueba.mx", Object.assign({}, devices["iPhone 13"], { acceptDownloads: false }));
      exige(await u.isVisible("#mv-compu") && !(await u.$(".movil #cuentas")), "a un usuario normal en el celular le salió el panel de dueño");
      await u.context().close();
    });
    // Nov 2026: la cuenta de prueba hace los tours que quiera para practicar (siempre con marca de agua). Si topa con
    // las 5 esferas de un tour, se le dice cómo seguir sin pagar (un usuario creyó que solo podía pagar)
    await paso("Cuenta de prueba: tours sin límite para practicar; al topar las esferas explica cómo seguir", async () => {
      const u = await pagina("practica-" + Date.now() + "@prueba.mx");
      const crear = (n) => u.evaluate((n) => fetch("api/tours", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nombre: n }) }).then(async (r) => ({ s: r.status, d: await r.json().catch(() => ({})) })), n);
      const hechos = []; for (let i = 1; i <= 4; i++) hechos.push(await crear("Práctica " + i));
      exige(hechos.every((t) => t.s === 201), "la cuenta de prueba no deja crear varios tours: " + hechos.map((t) => t.s).join(","));
      const id = hechos[0].d.id, p = hechos[0].d.proyecto;
      p.escenas = Array.from({ length: 6 }, (_, k) => ({ id: "e" + k, nombre: "Esfera " + k }));
      const r = await u.evaluate(([id, p]) => fetch("api/tours/" + id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(p) }).then(async (x) => ({ s: x.status, d: await x.json().catch(() => ({})) })), [id, p]);
      exige(r.s === 403 && /5 esferas/.test(r.d.error) && /borra una/.test(r.d.error) && !/gratis/i.test(r.d.error), "al pasar de 5 esferas no explica cómo seguir practicando: " + JSON.stringify(r));
      // Y lo que publica sigue con marca de agua
      exige((await u.evaluate(() => fetch("api/uso").then((x) => x.json()))).plan.marca === true, "la cuenta de prueba ya no lleva marca de agua");
      await u.context().close();
    });
    // Cupo de cuentas (beta): al llenarse, una cuenta nueva queda en lista de espera; quien compra entra siempre
    await paso("Cupo de cuentas: lleno manda a lista de espera, quien compra entra, y el dueño lo cambia en el Panel", async () => {
      const dn = await pagina(DUENO), api = (ruta, op) => dn.evaluate(([r, o]) => fetch(r, o).then(async (x) => ({ s: x.status, d: await x.json().catch(() => null) })), [ruta, op || {}]);
      const ponerCupo = (n) => api("api/admin/cupo", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ cupo: n }) });
      const antes = (await api("api/admin/cupo")).d;
      exige(antes && antes.cupo === 300, "el cupo no empieza en 300: " + JSON.stringify(antes && antes.cupo));
      const t = Date.now(), ya = "ya-" + t + "@prueba.mx", nuevo = "espera-" + t + "@prueba.mx", compra = "compra-" + t + "@prueba.mx";
      const entra = async (correo, extra) => {
        const x = await pagina(null); await x.goto(ESTUDIO + "/entrar?dev=" + encodeURIComponent(correo) + (extra || "")); await x.waitForTimeout(1500);
        const yo = await x.evaluate(() => fetch("api/yo").then((r) => r.status).catch(() => 0));
        return { x, adentro: yo === 200, texto: await x.textContent("body") };
      };
      const e1 = await entra(ya); await e1.x.context().close(); // una cuenta que ya existía antes de llenarse
      try {
        const n = (await api("api/admin/cupo")).d.cuentas;
        exige((await ponerCupo(n)).s === 200, "no se pudo cambiar el cupo");
        const e2 = await entra(nuevo);
        exige(!e2.adentro && /Cupo lleno/.test(e2.texto) && e2.texto.includes(nuevo), "con el cupo lleno, una cuenta nueva entró o no vio «Cupo lleno»");
        exige(!/gratis/i.test(e2.texto), "la página de cupo lleno dice «gratis»");
        if (process.env.CAPTURAS) { await e2.x.setViewportSize({ width: 430, height: 820 }); await e2.x.screenshot({ path: path.join(process.env.CAPTURAS, "cupo-lleno.png") }); }
        await e2.x.context().close();
        exige((await api("api/admin/cupo")).d.cuentas === n, "con el cupo lleno se creó la cuenta de todos modos");
        const e3 = await entra(ya); exige(e3.adentro, "una cuenta que ya existía no pudo entrar con el cupo lleno"); await e3.x.context().close();
        const e4 = await entra(compra, "&comprar=pro"); exige(e4.adentro, "quien viene a comprar no pudo entrar con el cupo lleno"); await e4.x.context().close();
        // En el Panel de dueño: cupo lleno, la lista de espera con su correo, y se cambia el número
        await dn.click('#nav button:has-text("Mis Tours")'); await dn.waitForTimeout(600);
        await dn.click("#ver-cuentas"); await dn.waitForTimeout(1200);
        exige(await dn.isVisible(".cupo-fila.lleno"), "el Panel no dice que el cupo está lleno");
        await dn.click("#cupo-espera"); await dn.waitForTimeout(200);
        exige((await dn.textContent("#cupo-lista")).includes(nuevo), "la lista de espera no trae el correo de quien llegó");
        if (process.env.CAPTURAS) { await dn.$eval(".cupo-fila", (e) => e.scrollIntoView({ block: "center" })); await dn.screenshot({ path: path.join(process.env.CAPTURAS, "cupo-panel.png") }); }
        await dn.fill("#cupo-num", String(n + 20)); await dn.click("#cupo-guardar"); await dn.waitForTimeout(1200);
        exige((await api("api/admin/cupo")).d.cupo === n + 20, "el botón Guardar no cambió el cupo");
        const e5 = await entra(nuevo); exige(e5.adentro, "con lugar libre, quien estaba en espera no pudo entrar"); await e5.x.context().close();
        exige(!dn.errs.length, "errores en el estudio: " + dn.errs.join(" | ").slice(0, 200));
      } finally { await ponerCupo(antes.cupo); await dn.context().close(); }
    });
    // 3. Plan Gratis
    const g = await pagina("gratis-" + Date.now() + "@prueba.mx");
    await paso("Respaldos: se copian los proyectos y un tour dañado se puede regresar", async () => {
      const api = (ruta, op) => a.evaluate(([r, o]) => fetch(r, o).then(async (x) => ({ s: x.status, d: await x.json().catch(() => null) })), [ruta, op || {}]);
      const r = await api("api/admin/respaldos", { method: "POST" });
      exige(r.s === 200 && r.d.listo && r.d.ultimo.archivos > 0, "no se hizo el respaldo");
      const sello = r.d.ultimo.sello, antes = (await api("api/tours/" + tour)).d;
      const danado = JSON.parse(JSON.stringify(antes)); danado.proyecto.nombre = "DAÑADO";
      await api("api/tours/" + tour, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(danado) });
      exige((await api("api/tours/" + tour)).d.proyecto.nombre === "DAÑADO", "no se pudo cambiar el tour para la prueba");
      exige((await api("api/admin/respaldos/" + sello + "/restaurar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tour }) })).s === 200, "no se pudo restaurar");
      exige((await api("api/tours/" + tour)).d.proyecto.nombre === antes.proyecto.nombre, "el tour no regresó a como estaba");
      exige(((await api("api/admin/respaldos")).d.lista || []).length >= 1, "el panel no lista los respaldos");
      exige((await api("api/admin/tours/" + tour)).d.proyecto.nombre === antes.proyecto.nombre, "el dueño no puede leer un tour para soporte");
    }, a);
    await paso("Plan Gratis: crear, publicar con marca «Creado por Mozari» y sin descarga", async () => {
      await nuevoTour(g, "Gratis");
      const id = await idTour(g);
      await g.click('#nav button:has-text("Publicar")'); await g.waitForTimeout(800);
      exige(!(await g.$("#pub-descargar")), "el plan Gratis ve el botón de descargar");
      await g.click("#pub-publicar"); await g.waitForTimeout(3500);
      const st = await g.evaluate((t) => fetch("api/tours/" + t + "/descargar").then((r) => r.status), id);
      const est = await g.evaluate((t) => fetch("api/tours/" + t + "/estadisticas").then((r) => r.status), id);
      exige(est === 403, "un usuario normal puede ver estadísticas del Laboratorio (" + est + ")");
      exige(st === 403, "el servidor dejó descargar al plan Gratis (" + st + ")");
      const t = await pagina(null); await t.goto(TOURS + "/" + id + "/"); await t.waitForTimeout(4000);
      exige(await t.$(".agua-mozari"), "el tour Gratis salió sin marca de agua");
      exige(!/<div class="splash propia[^"]*" id="splash"/.test(await (await fetch(TOURS + "/" + id + "/")).text()), "el plan Gratis quitó la pantalla de carga de Mozari");
      await t.context().close();
    }, g);
    await paso("Plan Gratis no ve herramientas del Laboratorio ni el panel de dueño", async () => {
      const yo = await g.evaluate(() => fetch("api/yo").then((r) => r.json()));
      exige(!(yo.lab || []).length, "un usuario normal tiene funciones del Laboratorio: " + yo.lab);
      exige(!(await g.$("#ver-cuentas")), "un usuario normal ve el Panel de dueño");
      const st = await g.evaluate(() => fetch("api/admin/cuentas").then((r) => r.status));
      exige(st === 403, "un usuario normal entró a la API del dueño (" + st + ")");
      const st2 = await g.evaluate((t) => fetch("api/admin/tours/" + t).then((r) => r.status), tour);
      exige(st2 === 403, "un usuario normal pudo leer el tour de otra cuenta (" + st2 + ")");
      // Ninguna ruta del dueño responde a una cuenta normal, y no ve nada marcado LAB ni del panel
      for (const r of ["cuentas", "cupones", "reportes", "laboratorio", "novedades", "respaldos", "galeria", "campanas", "correos", "ventas-link"]) {
        const x = await g.evaluate((r) => fetch("api/admin/" + r).then((y) => y.status), r);
        exige(x === 403, "un usuario normal entró a api/admin/" + r + " (" + x + ")");
      }
      exige((await g.evaluate((t) => fetch("api/tours/" + t).then((y) => y.status), tour)) === 404, "un usuario normal pudo abrir el tour de otra cuenta");
      exige(!(await g.$(".chip-lab")), "un usuario normal ve la etiqueta LAB");
      exige(!(await g.$("#cuentas .cuentas-titulo")), "un usuario normal ve algo del Panel de dueño");
      // Si abre el link de edición de un tour ajeno, ve un aviso claro (no una pantalla rota)
      await g.goto("about:blank"); await g.goto(ESTUDIO + "/#t=" + tour); await g.waitForTimeout(2500);
      exige(/Este tour es de otra cuenta/.test(await g.textContent("body")), "el link de edición de un tour ajeno no explica qué pasa");
      await g.goto(ESTUDIO + "/"); await g.waitForTimeout(2500); await cerrarAnuncio(g);
    }, g);

    await paso("Pro: tiene todas las herramientas nuevas, sin etiqueta LAB y con su tutorial la primera vez", async () => {
      const correo = "pro-" + Date.now() + "@prueba.mx", pr = await pagina(correo);
      const foto = (n) => (process.env.CAPTURAS ? pr.screenshot({ path: path.join(process.env.CAPTURAS, n + ".png") }) : null);
      const api = (p, ruta, op) => p.evaluate(([r, o]) => fetch(r, o).then(async (x) => ({ s: x.status, d: await x.json().catch(() => null) })), [ruta, op || {}]);
      const cta = ((await api(a, "api/admin/cuentas")).d.cuentas || []).find((x) => x.email === correo);
      exige(cta, "no aparece la cuenta nueva en el panel");
      exige((await api(a, "api/admin/cuentas/" + cta.uid, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: "pro" }) })).s === 200, "no se pudo poner en Pro");
      await pr.reload(); await pr.waitForTimeout(2500); await cerrarAnuncio(pr);
      const lab = (await api(pr, "api/yo")).d.lab || [];
      exige(LANZADAS.every((k) => lab.includes(k)), "a la cuenta Pro le faltan herramientas: " + LANZADAS.filter((k) => !lab.includes(k)).join(", "));
      await nuevoTour(pr, "Pro"); await irCapas(pr);
      await pr.waitForSelector(".guia-tarjeta", { timeout: 6000 }).catch(() => {});
      exige(/plano de referencia/i.test(await pr.textContent(".guia-tarjeta").catch(() => "")), "en Capas no salió el tutorial de las herramientas nuevas");
      exige(await pr.$(".guia-tarjeta .guia-anim"), "el tutorial no trae su animación");
      await pr.waitForTimeout(2500); await foto("tuto-capas");
      await pr.click('.guia-tarjeta [data-guia="seguir"]'); await pr.waitForTimeout(400);
      exige(/foto 360/i.test(await pr.textContent(".guia-tarjeta").catch(() => "")), "no explica la foto 360");
      await pr.click('.guia-tarjeta [data-guia="seguir"]'); await pr.waitForTimeout(400);
      exige(!(await pr.isVisible(".guia-tarjeta")), "el tutorial no se cerró");
      await pr.click("#ref-boton"); await pr.waitForTimeout(400);
      await pr.waitForSelector(".guia-tarjeta", { timeout: 6000 }).catch(() => {});
      exige(/sube tu plano/i.test(await pr.textContent(".guia-tarjeta").catch(() => "")), "al abrir el plano de referencia no explica cómo usarlo");
      await pr.keyboard.press("Escape"); await pr.click("#ref-boton"); await pr.waitForTimeout(300);
      await pr.click('#nav button:has-text("Interfaz")'); await pr.waitForTimeout(400);
      await pr.waitForSelector(".guia-tarjeta", { timeout: 6000 }).catch(() => {});
      exige(/logo al cargar/i.test(await pr.textContent(".guia-tarjeta").catch(() => "")), "en Skin no salió el tutorial del logo en la carga");
      await pr.waitForTimeout(2500); await foto("tuto-skin");
      await pr.keyboard.press("Escape");
      await pr.click('#nav button:has-text("Publicar")'); await pr.waitForTimeout(400);
      await pr.waitForSelector(".guia-tarjeta", { timeout: 6000 }).catch(() => {});
      exige(/estadísticas/i.test(await pr.textContent(".guia-tarjeta").catch(() => "")), "en Publicar no salió el tutorial de estadísticas");
      await pr.keyboard.press("Escape");
      exige(!(await pr.$(".chip-lab")) && !/\bLAB\b/.test(await pr.innerText("body")), "todavía se ve la etiqueta LAB");
      // Una vez vistos ya no salen
      await pr.reload(); await pr.waitForTimeout(3000); await cerrarAnuncio(pr); await irCapas(pr); await pr.waitForTimeout(2500);
      exige(!(await pr.isVisible(".guia-tarjeta")), "el tutorial de Capas salió otra vez");
      // Si una falla, el dueño la regresa a «Solo yo» y la cuenta Pro deja de tenerla
      const cambia = (modo) => api(a, "api/admin/laboratorio/foto360", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ modo }) });
      exige((await cambia("yo")).s === 200, "no se pudo regresar a «Solo yo»");
      exige(!((await api(pr, "api/yo")).d.lab || []).includes("foto360"), "la cuenta Pro sigue con una función regresada a «Solo yo»");
      exige(((await api(pr, "api/yo")).d.lab || []).includes("fichas"), "al cambiar una, las demás se movieron");
      await cambia("pago");
      exige(((await api(pr, "api/yo")).d.lab || []).includes("foto360"), "no regresó a Pro y Desarrollos");
      exige(!pr.errs.length, "errores: " + pr.errs.join(" | ").slice(0, 160));
      await pr.context().close();
    }, a);
    await paso("Una cuenta se usa en 2 dispositivos; en el 3.º elige cuál cerrar", async () => {
      const correo = "dispositivos-" + Date.now() + "@prueba.mx", UA = ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"];
      const ps = [];
      for (const ua of UA) { const p = await pagina(null, { userAgent: ua }); await p.goto(ESTUDIO + "/entrar?dev=" + correo); await p.waitForTimeout(1500); ps.push(p); }
      const yo = (p) => p.evaluate(() => fetch("/api/yo").then((r) => r.status));
      exige((await yo(ps[0])) === 200 && (await yo(ps[1])) === 200, "los 2 primeros dispositivos no entraron");
      exige(ps[2].url().endsWith("/dispositivos"), "el 3.er dispositivo entró sin elegir cuál cerrar");
      exige((await ps[2].$$(".disp")).length === 2, "no muestra los 2 dispositivos activos");
      exige((await yo(ps[2])) === 401, "el 3.er dispositivo tiene sesión sin haber cerrado otro");
      await ps[2].click(".disp >> nth=0 >> button"); await ps[2].waitForTimeout(1500);
      exige((await yo(ps[2])) === 200, "al cerrar uno, el 3.º no pudo entrar");
      exige((await yo(ps[0])) === 401, "el dispositivo cerrado sigue con sesión");
      await ps[1].goto(ESTUDIO + "/salir"); await ps[1].waitForTimeout(800);
      await ps[0].goto(ESTUDIO + "/entrar?dev=" + correo); await ps[0].waitForTimeout(1500);
      exige((await yo(ps[0])) === 200, "salir no liberó el lugar del dispositivo");
      for (const p of ps) await p.context().close();
    }, a);
    await paso("Tutoriales (manzana, lote, Lotes/Excel): salen la primera vez y luego ya no", async () => {
      const t = await pagina("tutorial-" + Date.now() + "@prueba.mx");
      await nuevoTour(t, "Tutorial"); await irCapas(t);
      await t.click("#add-manzana"); await t.waitForTimeout(600);
      exige(await t.isVisible(".guia-tarjeta .guia-anim"), "no salió el tutorial con su animación");
      await t.click('.guia-tarjeta [data-guia="seguir"]'); await t.waitForTimeout(400);
      exige(await t.evaluate(() => document.body.classList.contains("dibujando")), "después del tutorial no empezó a dibujar");
      for (const [x, y] of [[500, 640], [980, 640]]) { await t.mouse.click(x, y); await t.waitForTimeout(120); }
      await t.keyboard.press("Enter"); await t.waitForTimeout(400);
      for (const [x, y] of [[480, 800], [1000, 800]]) { await t.mouse.click(x, y); await t.waitForTimeout(120); }
      await t.keyboard.press("Enter"); await t.waitForTimeout(1600);
      exige(await t.isVisible(".guia-tarjeta"), "no salió el tutorial de cómo editar la manzana");
      await t.click('.guia-tarjeta [data-guia="seguir"]'); await t.waitForTimeout(300); await t.click('.guia-tarjeta [data-guia="seguir"]'); await t.waitForTimeout(300);
      await t.click('#subtabs button:has-text("Fichas técnicas")'); await t.waitForTimeout(1500);
      exige(await t.isVisible(".guia-tarjeta"), "no salió el tutorial de la vista Lotes (Excel)");
      await pasarGuias(t);
      await irCapas(t); await t.click("#add-lote"); await t.waitForTimeout(500);
      exige(await t.isVisible(".guia-tarjeta .guia-anim"), "no salió el tutorial de Lote");
      await pasarGuias(t); await t.keyboard.press("Escape");
      await t.reload(); await t.waitForTimeout(3500); await irCapas(t);
      await t.click("#add-manzana"); await t.waitForTimeout(600);
      exige(!(await t.isVisible(".guia-tarjeta")), "el tutorial de manzana salió otra vez");
      await t.keyboard.press("Escape"); await t.click("#add-lote"); await t.waitForTimeout(600);
      exige(!(await t.isVisible(".guia-tarjeta")), "el tutorial de lote salió otra vez");
      await t.keyboard.press("Escape");
      await t.click('#subtabs button:has-text("Fichas técnicas")'); await t.waitForTimeout(1500);
      exige(!(await t.isVisible(".guia-tarjeta")), "el tutorial de Lotes salió otra vez");
      exige(!t.errs.length, "errores: " + t.errs.join(" | ").slice(0, 160));
      await t.context().close();
    });

    // 4. Actualizaciones: se ven una sola vez
    await paso("Una actualización publicada se ve una sola vez por cuenta", async () => {
      const id = await a.evaluate(async () => {
        const j = (u, m, b) => fetch(u, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
        const { novedad } = await j("api/admin/novedades", "POST");
        await j("api/admin/novedades/" + novedad.id, "PUT", { titulo: "Prueba de revisión", texto: "Uno\nDos", activa: true });
        return novedad.id;
      });
      const u = await pagina(null); await u.goto(ESTUDIO + "/entrar?dev=una-vez-" + Date.now() + "@prueba.mx"); await u.waitForTimeout(3500);
      exige(await u.isVisible("#dlg-nov"), "no apareció la actualización");
      await u.click("[data-nov-cerrar]"); await u.waitForTimeout(500);
      await u.reload(); await u.waitForTimeout(3500);
      exige(!(await u.isVisible("#dlg-nov")), "la actualización apareció otra vez");
      await u.context().close();
      await a.evaluate((x) => fetch("api/admin/novedades/" + x, { method: "DELETE" }), id);
    });

    // Reporte de un usuario (nov 2026): con el dron mirando hacia abajo, una manzana que empieza casi debajo
    // de él salía con el fondo volteado (lotes cruzados en X, los cortes de atrás amontonados en una punta).
    await paso("Manzana dibujada bajo el dron (mirando hacia abajo): lotes derechos, sin cruzarse", async () => {
      const n = await pagina(DUENO); await nuevoTour(n, "Bajo el dron");
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1800);
      const r = await n.evaluate(() => { const e = [...document.querySelectorAll(".capas")].find((x) => x.getClientRects().length && x.getBoundingClientRect().width > 300); const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
      const [cx, cy] = r;
      for (let i = 0; i < 4; i++) { await n.mouse.move(cx, cy + 250); await n.mouse.down(); for (let k = 1; k <= 10; k++) await n.mouse.move(cx, cy + 250 - k * 50); await n.mouse.up(); await n.waitForTimeout(300); }
      await n.waitForTimeout(800);
      await dibujarManzana(n, [[cx + 6, cy + 6], [cx + 6, cy + 220]], [[cx + 200, cy + 6], [cx + 200, cy + 220]]);
      await n.waitForTimeout(2500);
      const id = await idTour(n), leer = () => n.evaluate((id) => fetch("api/tours/" + id).then((x) => x.json()), id);
      const derecha = (m) => m.manzana.cortes.every((k) => Math.abs(k.b - k.f) < 0.12);
      let d = await leer(), m = Object.values(d.capas).flat().find((c) => c.manzana);
      exige(m && derecha(m), "los lotes salen cruzados: " + JSON.stringify(m && m.manzana.cortes.map((k) => [+k.f.toFixed(2), +k.b.toFixed(2)])));
      // Una manzana que ya quedó volteada se endereza con «Repartir parejo»
      const F = m.manzana.nFrente; m.puntos = m.puntos.slice(0, F).concat(m.puntos.slice(F).reverse());
      await n.evaluate(([id, d]) => fetch("api/tours/" + id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(d) }), [id, d]);
      await n.reload(); await n.waitForTimeout(3500); await cerrarGuia(n);
      await n.click('#nav button:has-text("Panoramas")'); await n.waitForTimeout(800);
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1500); await cerrarGuia(n);
      await n.click('#lista li:has-text("Manzana 1")'); await n.waitForTimeout(500);
      await n.click("[data-mz-parejo]"); await n.waitForTimeout(2500);
      d = await leer(); m = Object.values(d.capas).flat().find((c) => c.manzana);
      exige(derecha(m), "«Repartir parejo» no enderezó una manzana volteada");
      exige(!n.errs.length, "errores: " + n.errs.join(" | ").slice(0, 160));
      await n.context().close();
    }, a);

    // Reporte de Amar (nov 2026): en la foto 360 salía una línea atravesada de lado a lado (la figura que rodea al dron)
    await paso("Foto 360: un lote que rodea al dron no deja una línea atravesada y se rellena hasta abajo", async () => {
      const n = await pagina(DUENO); await nuevoTour(n, "Nadir");
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1800); await cerrarGuia(n);
      const [cx, cy] = await n.evaluate(() => { const e = [...document.querySelectorAll(".capas")].find((x) => x.getClientRects().length && x.getBoundingClientRect().width > 300); const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
      for (let i = 0; i < 4; i++) { await n.mouse.move(cx, cy + 250); await n.mouse.down(); for (let k = 1; k <= 10; k++) await n.mouse.move(cx, cy + 250 - k * 50); await n.mouse.up(); await n.waitForTimeout(300); }
      await n.waitForTimeout(800);
      await n.click("#add-lote"); await n.waitForTimeout(300); await pasarGuias(n);
      // Un triángulo con la punta lejos (como la manzana del reporte) y la cámara adentro
      for (const [x, y] of [[cx, cy - 230], [cx + 90, cy + 70], [cx - 90, cy + 70]]) { await n.mouse.click(x, y); await n.waitForTimeout(150); }
      await n.keyboard.press("Enter"); await n.waitForTimeout(1500);
      if (process.env.CAPTURAS) await n.screenshot({ path: path.join(process.env.CAPTURAS, "nadir.png") });
      await cerrarGuia(n);
      exige((await lotes(n)).length === 1, "no se dibujó el lote debajo del dron");
      await n.keyboard.press("Escape"); await n.waitForTimeout(300);
      const [descarga] = await Promise.all([n.waitForEvent("download", { timeout: 120000 }), n.click("#foto360-boton")]);
      const b64 = fs.readFileSync(await descarga.path()).toString("base64");
      if (process.env.CAPTURAS) fs.copyFileSync(await descarga.path(), path.join(process.env.CAPTURAS, "nadir-360.jpg"));
      const r = await n.evaluate(async (b64) => {
        const bl = await (await fetch("data:image/jpeg;base64," + b64)).blob(), bm = await createImageBitmap(bl), cv = document.createElement("canvas");
        cv.width = bm.width; cv.height = bm.height; const x = cv.getContext("2d"); x.drawImage(bm, 0, 0);
        const W = cv.width, H = cv.height, d = x.getImageData(0, 0, W, H).data;
        // Una línea de lado a lado (aunque vaya un poco inclinada): en una franja de 24 filas, casi todas las
        // columnas tienen un punto más claro que el de 3 filas arriba y 3 abajo
        const L = (y, i) => { const o = (y * W + i) * 4; return 0.3 * d[o] + 0.59 * d[o + 1] + 0.11 * d[o + 2]; };
        const y0 = Math.round(H * 0.05), y1 = Math.round(H * 0.92), pico = new Uint8Array((y1 - y0) * W);
        for (let y = y0; y < y1; y++) for (let i = 0; i < W; i++) if (L(y, i) - Math.max(L(y - 3, i), L(y + 3, i)) > 35) pico[(y - y0) * W + i] = 1;
        let peor = 0, fila = -1;
        for (let y = y0; y + 24 <= y1; y += 4) { let b = 0; for (let i = 0; i < W; i++) { for (let k = 0; k < 24; k++) if (pico[(y - y0 + k) * W + i]) { b++; break; } } if (b / W > peor) { peor = b / W; fila = y; } }
        // Abajo (el nadir): el relleno verde del lote (#22B573) cubre filas completas; sin relleno el pasto es #66AA55
        let abajo = 0; { const y = Math.round(H * 0.975); for (let i = 0; i < W; i++) { const o = (y * W + i) * 4; if (d[o] < 92 && d[o + 1] > 140) abajo++; } abajo /= W; }
        return { W, H, peor: +peor.toFixed(2), fila, abajo: +abajo.toFixed(2) };
      }, b64);
      if (process.env.CAPTURAS) console.log("    nadir:", JSON.stringify(r));
      exige(r.peor < 0.5, "la foto 360 trae una línea atravesada en la fila " + r.fila + " (" + Math.round(r.peor * 100) + "% del ancho)");
      exige(r.abajo > 0.6, "el lote que rodea al dron no se rellena hasta abajo (" + Math.round(r.abajo * 100) + "%)");
      exige(!n.errs.length, "errores: " + n.errs.join(" | ").slice(0, 160));
      await n.context().close();
    }, a);

    // Pedido de Amar (nov 2026): en la foto 360 se pega todo (textos, rutas, polígonos, puntos de interés), no solo los lotes
    await paso("Foto 360: también se pegan los textos, las rutas, los polígonos y los puntos de interés", async () => {
      const n = await pagina(DUENO); await nuevoTour(n, "Todo pegado");
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1800); await cerrarGuia(n);
      const [cx, cy] = await n.evaluate(() => { const e = [...document.querySelectorAll(".capas")].find((x) => x.getClientRects().length && x.getBoundingClientRect().width > 300); const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
      const girar = async () => { await n.mouse.move(cx + 250, cy - 200); await n.mouse.down(); for (let k = 1; k <= 10; k++) await n.mouse.move(cx + 250 - k * 50, cy - 200); await n.mouse.up(); await n.waitForTimeout(400); };
      await n.click("#add-txt"); await n.waitForTimeout(600); await pasarGuias(n); await n.keyboard.press("Escape"); await girar();
      await n.click("#add-pi"); await n.waitForTimeout(600); await pasarGuias(n); await n.keyboard.press("Escape"); await girar();
      await n.click("#add-pol"); await n.waitForTimeout(300); await pasarGuias(n);
      for (const [x, y] of [[cx - 120, cy + 120], [cx + 120, cy + 120], [cx + 120, cy + 260], [cx - 120, cy + 260]]) { await n.mouse.click(x, y); await n.waitForTimeout(150); }
      await n.keyboard.press("Enter"); await n.waitForTimeout(800); await cerrarGuia(n); await n.keyboard.press("Escape"); await girar();
      await n.click("#add-camino"); await n.waitForTimeout(300); await pasarGuias(n);
      for (const [x, y] of [[cx - 200, cy + 250], [cx, cy + 150], [cx + 200, cy + 250]]) { await n.mouse.click(x, y); await n.waitForTimeout(150); }
      await n.keyboard.press("Enter"); await n.waitForTimeout(800); await cerrarGuia(n); await n.keyboard.press("Escape"); await n.waitForTimeout(1500);
      const id = await idTour(n), d = await n.evaluate((id) => fetch("api/tours/" + id).then((x) => x.json()), id), cs = Object.values(d.capas).flat();
      const txt = cs.find((c) => c.tipo === "texto"), pi = cs.find((c) => c.tipo === "interes"), pol = cs.find((c) => c.tipo === "poligono" && !c.camino && !c.lote), ruta = cs.find((c) => c.camino);
      exige(txt && pi && pol && ruta, "no se crearon todas las capas: " + cs.map((c) => c.tipo + (c.camino ? "/ruta" : "")).join(", "));
      const [descarga] = await Promise.all([n.waitForEvent("download", { timeout: 120000 }), n.click("#foto360-boton")]);
      if (process.env.CAPTURAS) fs.copyFileSync(await descarga.path(), path.join(process.env.CAPTURAS, "todo-360.jpg"));
      const b64 = fs.readFileSync(await descarga.path()).toString("base64");
      const centroPol = [pol.puntos.reduce((s, p) => s + p[0], 0) / pol.puntos.length, pol.puntos.reduce((s, p) => s + p[1], 0) / pol.puntos.length];
      const r = await n.evaluate(async ([b64, puntos]) => {
        const bl = await (await fetch("data:image/jpeg;base64," + b64)).blob(), bm = await createImageBitmap(bl), cv = document.createElement("canvas");
        cv.width = bm.width; cv.height = bm.height; const x = cv.getContext("2d"); x.drawImage(bm, 0, 0);
        const W = cv.width, H = cv.height, px = ([yaw, pitch]) => [Math.floor((((yaw / (2 * Math.PI) + 0.5) % 1) + 1) % 1 * W), Math.floor((pitch / Math.PI + 0.5) * H)];
        const cuenta = (pt, rr, f) => { const [X, Y] = px(pt), d = x.getImageData(Math.max(0, X - rr), Math.max(0, Y - rr), 2 * rr, 2 * rr).data; let k = 0; for (let i = 0; i < d.length; i += 4) if (f(d[i], d[i + 1], d[i + 2])) k++; return k; };
        const blanco = (r, g, b) => r > 225 && g > 225 && b > 225, lima = (r, g, b) => r > 180 && g > 225 && b < 130, tinte = (r, g, b) => r > 125 && g > 185 && b < 110;
        return { texto: cuenta(puntos.txt, 40, blanco), interes: cuenta(puntos.pi, 30, blanco), ruta: cuenta(puntos.ruta, 30, lima), poligono: cuenta(puntos.pol, 6, tinte) };
      }, [b64, { txt: [txt.yaw, txt.pitch], pi: [pi.yaw, pi.pitch], ruta: ruta.puntos[1], pol: centroPol }]);
      if (process.env.CAPTURAS) console.log("    todo:", JSON.stringify(r));
      exige(r.texto > 30, "el texto no se pegó en la foto 360");
      exige(r.interes > 15, "el punto de interés no se pegó en la foto 360");
      exige(r.ruta > 15, "la ruta no se pegó en la foto 360");
      exige(r.poligono > 60, "el polígono no se pegó en la foto 360");
      exige(!n.errs.length, "errores: " + n.errs.join(" | ").slice(0, 160));
      await n.context().close();
    }, a);

    // Pedido de Amar (nov 2026): los lados de la manzana (de la calle de enfrente a la de atrás) aceptan puntos, para terrenos con relieve
    await paso("Los lados de la manzana aceptan puntos en medio y los lotes los siguen", async () => {
      const n = await pagina(DUENO); await nuevoTour(n, "Lados con relieve");
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1800);
      await dibujarManzana(n, [[500, 640], [740, 625], [980, 640]], [[480, 820], [1000, 820]]);
      await n.click('#lista li:has-text("Manzana 1")'); await n.waitForTimeout(800);
      const o = await n.evaluate(() => { const e = [...document.querySelectorAll(".capas")].find((x) => x.getClientRects().length && x.getBoundingClientRect().width > 300); const b = e.getBoundingClientRect(); return [b.x, b.y]; });
      const mas = (await n.$$eval("circle.mz-mas", (l) => l.map((e) => [+e.getAttribute("cx"), +e.getAttribute("cy")]))).map(([x, y]) => [x + o[0], y + o[1]]);
      const izq = mas.sort((a, b) => Math.hypot(a[0] - 490, a[1] - 730) - Math.hypot(b[0] - 490, b[1] - 730))[0];
      exige(izq && Math.hypot(izq[0] - 490, izq[1] - 730) < 60, "no hay «+» en el lado de la manzana");
      await n.mouse.move(izq[0], izq[1]); await n.mouse.down(); for (let k = 1; k <= 8; k++) await n.mouse.move(izq[0] - k * 8, izq[1]); await n.mouse.up();
      await n.waitForTimeout(3000);
      const id = await idTour(n), d = await n.evaluate((id) => fetch("api/tours/" + id).then((x) => x.json()), id);
      const todo = Object.values(d.capas).flat(), m = todo.find((c) => c.manzana), l1 = todo.find((c) => c.deManzana === m.id && c.iManzana === 0);
      exige(m.manzana.lados && (m.manzana.lados.a || []).length === 1, "el punto del lado no se guardó");
      exige(l1 && l1.puntos.some((p) => Math.abs(p[0] - m.manzana.lados.a[0][0]) < 1e-4 && Math.abs(p[1] - m.manzana.lados.a[0][1]) < 1e-4), "el lote de la orilla no sigue el punto del lado");
      // Manzana doble: la línea del centro se mueve punto por punto
      await n.check('[data-k="_mzDoble"]').catch(async () => { await n.click("text=Doble: lotes por los dos lados"); }); await n.waitForTimeout(1200);
      const cen = (await n.$$eval("circle.mz-asa.centro", (l) => l.map((e) => [+e.getAttribute("cx"), +e.getAttribute("cy")]))).map(([x, y]) => [x + o[0], y + o[1]]).sort((p, q) => q[0] - p[0]);
      exige(cen.length >= 3, "la manzana doble no muestra los puntos de la línea del centro");
      await n.mouse.move(cen[1][0], cen[1][1]); await n.mouse.down(); for (let k = 1; k <= 8; k++) await n.mouse.move(cen[1][0], cen[1][1] - k * 3); await n.mouse.up();
      await n.waitForTimeout(3000);
      const d2 = await n.evaluate((id) => fetch("api/tours/" + id).then((x) => x.json()), id), m2 = Object.values(d2.capas).flat().find((c) => c.manzana);
      exige(Array.isArray(m2.manzana.centro) && m2.manzana.centro.some((v) => v && Math.abs(v - 0.5) > 0.05), "el punto de la línea del centro no se movió");
      // Laboratorio · plano de referencia: se sube un PDF y se ve en la ventanita (las librerías salen de /lib)
      const hoja = await navegador.newPage(); await hoja.setContent('<svg width="600" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="400" fill="#fff"/><rect x="40" y="40" width="520" height="320" fill="#dfe" stroke="#000"/><text x="300" y="210" font-size="40" text-anchor="middle">MASTERPLAN</text></svg>');
      const pdf = await hoja.pdf({ width: "600px", height: "400px", printBackground: true }); await hoja.close();
      await n.keyboard.press("Escape"); await n.click("#ref-boton"); await n.waitForTimeout(400);
      exige(await n.isVisible("#ref-panel"), "no abre la ventanita del plano de referencia");
      await n.setInputFiles("#ref-archivo2", { name: "masterplan.pdf", mimeType: "application/pdf", buffer: pdf });
      let ancho = 0; for (let i = 0; i < 25 && !ancho; i++) { await n.waitForTimeout(600); ancho = await n.$eval("#ref-img", (e) => (e.hidden ? 0 : e.naturalWidth)); }
      exige(ancho > 500, "el PDF del plano de referencia no se pudo ver");
      await n.waitForTimeout(2500);
      const d3 = await n.evaluate((id) => fetch("api/tours/" + id).then((x) => x.json()), id);
      exige(d3.proyecto.referencia && /^privado\//.test(d3.proyecto.referencia.img), "el plano de referencia no se guardó en privado/");
      // Girar, dibujar con la pluma y mover la ventana
      await n.click("#ref-der"); await n.click("#ref-der"); await n.click("#ref-pluma"); await n.waitForTimeout(200);
      const vv = await n.$eval("#ref-vista", (e) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; });
      await n.mouse.move(vv[0] + vv[2] * 0.3, vv[1] + vv[3] * 0.4); await n.mouse.down(); for (let k = 1; k <= 12; k++) await n.mouse.move(vv[0] + vv[2] * (0.3 + k * 0.03), vv[1] + vv[3] * 0.5); await n.mouse.up();
      const hb = await n.$eval("#ref-panel header b", (e) => { const b = e.getBoundingClientRect(); return [b.x + 10, b.y + b.height / 2]; });
      await n.mouse.move(hb[0], hb[1]); await n.mouse.down(); for (let k = 1; k <= 6; k++) await n.mouse.move(hb[0] + k * 30, hb[1] + k * 20); await n.mouse.up();
      exige(parseFloat(await n.$eval("#ref-panel", (e) => e.style.left)) > 100, "la ventana del plano no se mueve");
      await n.waitForTimeout(2500);
      const d4 = await n.evaluate((id) => fetch("api/tours/" + id).then((x) => x.json()), id), rf = d4.proyecto.referencia;
      exige(rf.giro === 30 && (rf.trazos || []).length === 1 && rf.trazos[0].p.length > 5, "no se guardó el giro o el dibujo del plano (" + JSON.stringify({ giro: rf.giro, trazos: (rf.trazos || []).length }) + ")");
      // Reporte de Amar: al volver a abrir el tour, la manzana debe mostrar todas sus asas desde el primer clic
      await n.reload(); await n.waitForTimeout(3500); await cerrarGuia(n);
      await n.click('#nav button:has-text("Panoramas")'); await n.waitForTimeout(600); await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1800); await cerrarGuia(n);
      await n.click('#lista li:has-text("Manzana 1")'); await n.waitForTimeout(800);
      exige((await n.$$("circle.mz-asa")).length > 5 && (await n.$$("circle.mz-mas")).length > 2, "al reabrir el tour, la manzana solo muestra sus esquinas");
      // Un lote sin número ni manzana (reserva ecológica) no lleva rótulo ni abre ficha
      await n.keyboard.press("Escape"); await n.click("#add-lote"); await n.waitForTimeout(300); await pasarGuias(n);
      for (const [x, y] of [[560, 330], [700, 330], [700, 420], [560, 420]]) { await n.mouse.click(x, y); await n.waitForTimeout(120); }
      await n.keyboard.press("Enter"); await n.waitForTimeout(800);
      for (const k of ["lote.numero", "lote.manzana"]) { await n.fill('[data-k="' + k + '"]', ""); await n.press('[data-k="' + k + '"]', "Tab"); }
      await n.waitForTimeout(800);
      exige(!/sin número/.test(await n.$eval("#ed-stage", (e) => e.innerText + " " + [...e.querySelectorAll("text")].map((t) => t.textContent).join(" "))), "el área sin número muestra «Lote sin número» en la esfera");
      exige(!n.errs.length, "errores: " + n.errs.join(" | ").slice(0, 160));
      await n.context().close();
    }, a);

    // Pedido de Amar (nov 2026): misma letra en toda la lotificación; un lote grande no agranda su texto (salvo a mano)
    await paso("Rótulos parejos: un lote grande no agranda su texto, solo si se le sube a mano", async () => {
      const n = await pagina(DUENO); await nuevoTour(n, "Rotulos parejos");
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1800);
      const [cx, cy] = await n.evaluate(() => { const e = [...document.querySelectorAll(".capas")].find((x) => x.getClientRects().length && x.getBoundingClientRect().width > 300); const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
      for (let i = 0; i < 4; i++) { await n.mouse.move(cx, cy + 250); await n.mouse.down(); for (let k = 1; k <= 10; k++) await n.mouse.move(cx, cy + 250 - k * 50); await n.mouse.up(); await n.waitForTimeout(300); }
      await n.waitForTimeout(800);
      await dibujarManzana(n, [[cx - 320, cy - 170], [cx - 160, cy - 180], [cx, cy - 170]], [[cx - 320, cy + 60], [cx, cy + 60]]);
      await n.click('#lista li:has-text("Manzana 1")'); await n.waitForTimeout(500);
      for (let i = 0; i < 5; i++) { await n.click('[data-mz-n="-1"]'); await n.waitForTimeout(200); }
      await n.keyboard.press("Escape"); await n.click("#add-lote"); await n.waitForTimeout(300); await pasarGuias(n);
      for (const [x, y] of [[cx + 50, cy - 170], [cx + 330, cy - 170], [cx + 330, cy + 140], [cx + 50, cy + 140]]) { await n.mouse.click(x, y); await n.waitForTimeout(120); }
      await n.keyboard.press("Enter"); await n.waitForTimeout(800);
      await n.fill('[data-k="lote.numero"]', "99"); await n.press('[data-k="lote.numero"]', "Tab");
      await n.fill('[data-k="lote.manzana"]', "1"); await n.press('[data-k="lote.manzana"]', "Tab"); await n.waitForTimeout(1200);
      const altos = () => n.evaluate(() => Object.fromEntries([...document.querySelectorAll(".lt-p.nom")].filter((e) => e.style.display !== "none" && e.style.visibility !== "hidden").map((e) => [e.firstChild.textContent, e.getBoundingClientRect().height])));
      let h = await altos();
      const chicos = Object.entries(h).filter(([k]) => !/99/.test(k)).map(([, v]) => v).sort((p, q) => p - q), med = chicos[Math.floor(chicos.length / 2)];
      exige(chicos.length >= 4 && h["Lote 99 · M1"], "no se ven los rótulos (" + JSON.stringify(h) + ")");
      exige(h["Lote 99 · M1"] < med * 1.3, "el lote grande tiene la letra más grande que los demás (" + h["Lote 99 · M1"].toFixed(1) + " vs " + med.toFixed(1) + ")");
      await n.$eval('[data-k="lote.tamRotulo"]', (e) => { e.value = "1"; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); });
      await n.waitForTimeout(1200);
      const antes = h["Lote 99 · M1"]; h = await altos();
      exige(h["Lote 99 · M1"] > antes * 1.4, "subirle el tamaño a mano no agranda su texto (" + h["Lote 99 · M1"].toFixed(1) + " vs " + antes.toFixed(1) + ")");
      exige(!n.errs.length, "errores: " + n.errs.join(" | ").slice(0, 160));
      await n.context().close();
    }, a);

    // Pedido de Amar (nov 2026): la ruta se curva con manijas, como la pluma de Illustrator
    await paso("Ruta curva: manijas rojas en cada punto, como en Illustrator", async () => {
      const n = await pagina(DUENO); await nuevoTour(n, "Ruta curva");
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1800);
      await n.keyboard.press("Escape"); await n.click("#add-camino"); await n.waitForTimeout(300); await pasarGuias(n);
      for (const [x, y] of [[520, 820], [640, 720], [780, 700], [920, 640]]) { await n.mouse.click(x, y); await n.waitForTimeout(150); }
      await n.keyboard.press("Enter"); await n.waitForTimeout(1200);
      const man = await n.$$eval("circle.mz-asa.curva", (l) => l.map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
      exige(man.length === 6, "la ruta no muestra sus manijas de curva (" + man.length + ")");
      const tramos = () => n.$eval("path.cp-camino", (e) => (e.getAttribute("d").match(/[LC]/g) || []).length);
      const antes = await tramos();
      await n.mouse.move(man[2][0], man[2][1]); await n.mouse.down(); await n.mouse.move(man[2][0] + 10, man[2][1] + 40, { steps: 8 }); await n.mouse.up(); await n.waitForTimeout(2500);
      const id = await idTour(n), d = await n.evaluate((id) => fetch("api/tours/" + id).then((x) => x.json()), id);
      const ruta = Object.values(d.capas).flat().find((c) => c.camino);
      exige(ruta && ruta.puntos.some((p) => p.length > 3 && (p[2] || p[3])), "la manija no curvó la ruta");
      exige((await tramos()) > antes + 10, "la ruta no se dibuja curva");
      exige(!n.errs.length, "errores: " + n.errs.join(" | ").slice(0, 160));
      await n.context().close();
    }, a);

    // Pedido de Amar (nov 2026): del PDF del masterplan se arman los lotes de una manzana y se colocan con 4 esquinas.
    // Plano de prueba: manzana con dos filas y línea del centro en escalones (como la MZ-3 de El Mirador).
    await paso("Laboratorio · lotes desde el PDF: recuadro sobre la manzana y 4 esquinas en la esfera", async () => {
      const n = await pagina(DUENO); await nuevoTour(n, "Lotes del PDF");
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1800);
      const st = await n.evaluate(() => { const e = [...document.querySelectorAll(".capas")].find((x) => x.getClientRects().length && x.getBoundingClientRect().width > 300); const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; });
      const [cx, cy] = [st[0] + st[2] / 2, st[1] + st[3] / 2];
      for (let i = 0; i < 4; i++) { await n.mouse.move(cx, cy + 250); await n.mouse.down(); for (let k = 1; k <= 10; k++) await n.mouse.move(cx, cy + 250 - k * 50); await n.mouse.up(); await n.waitForTimeout(300); }
      const L = (pts) => '<polyline fill="none" stroke="#000" stroke-width="1.5" points="' + pts.map((p) => p.join(",")).join(" ") + '"/>';
      const svg = '<svg width="800" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="500" fill="#fff"/>' +
        L([[100, 100], [700, 100], [700, 400], [100, 400], [100, 100]]) +
        L([[100, 250], [220, 250], [220, 300], [340, 300], [340, 250], [460, 250], [460, 300], [580, 300], [580, 250], [700, 250]]) + // centro en escalones
        [220, 340, 460, 580].map((x) => L([[x, 400], [x, 300]])).join("") + L([[250, 100], [250, 300]]) + L([[400, 100], [400, 250]]) + L([[550, 100], [550, 300]]) +
        Array.from({ length: 12 }, (_, i) => L([[110 + i * 9, 120], [125 + i * 9, 150]])).join("") + // achurado suelto
        '<text x="140" y="340" font-size="14">L-1</text><text x="160" y="180" font-size="14">L-9</text></svg>';
      const hoja = await navegador.newPage(); await hoja.setContent('<!doctype html><html><body style="margin:0">' + svg + '</body></html>');
      const pdf = await hoja.pdf({ width: "800px", height: "500px", printBackground: true }); await hoja.close();
      await n.click("#ref-boton"); await n.waitForTimeout(400);
      await n.setInputFiles("#ref-archivo2", { name: "manzana.pdf", mimeType: "application/pdf", buffer: pdf });
      let ancho = 0; for (let i = 0; i < 25 && !ancho; i++) { await n.waitForTimeout(600); ancho = await n.$eval("#ref-img", (e) => (e.hidden ? 0 : e.naturalWidth)); }
      exige(ancho > 500, "el PDF no se pudo ver");
      await n.waitForTimeout(2500);
      const id = await idTour(n), leer = () => n.evaluate((id) => fetch("api/tours/" + id).then((x) => x.json()), id);
      exige(/^privado\/.*\.pdf$/.test((await leer()).proyecto.referencia.pdf || ""), "el PDF original no se guardó en privado/");
      await n.evaluate(() => { const p = document.getElementById("ref-panel"); p.style.width = "560px"; p.style.height = "480px"; });
      await pasarGuias(n); await n.click("#ref-ajustar"); await n.click("#ref-lotes"); await n.waitForTimeout(500);
      exige(await n.isVisible(".guia-tarjeta .guia-anim") && (await n.$$(".guia-tarjeta .puntos i")).length === 5, "no salió el tutorial de 5 pasos de Lotes desde el PDF");
      await pasarGuias(n); await n.waitForTimeout(300);
      await n.click("#ref-lotes-ayuda"); await n.waitForTimeout(300);
      exige(await n.isVisible(".guia-tarjeta"), "el botón ? no vuelve a mostrar el tutorial");
      await pasarGuias(n); await n.waitForTimeout(300);
      const aPant = (x, y) => n.evaluate(([x, y]) => { const v = document.getElementById("ref-vista").getBoundingClientRect(), m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(document.getElementById("ref-lienzo").style.transform); return [v.left + +m[1] + x * +m[3], v.top + +m[2] + y * +m[3]]; }, [x, y]);
      const [ax, ay] = await aPant(ancho * 0.08, ancho * 0.08), [bx, by] = await aPant(ancho * 0.93, ancho * 0.56);
      await n.mouse.move(ax, ay); await n.mouse.down(); await n.mouse.move((ax + bx) / 2, (ay + by) / 2, { steps: 6 }); await n.mouse.move(bx, by, { steps: 6 }); await n.mouse.up();
      let info = ""; for (let i = 0; i < 20 && !/elegid|No /.test(info); i++) { await n.waitForTimeout(400); info = await n.textContent("#ref-lotes-info"); }
      exige(/^9 lotes elegidos/.test(info), "no encontró los 9 lotes de la manzana en escalones (" + info + ")");
      // Un toque sobre un lote lo quita; otro toque lo regresa
      const [tx, ty] = await aPant(ancho * (160 / 800), ancho * (350 / 800));
      await n.mouse.click(tx, ty); await n.waitForTimeout(200);
      exige(/^8 lotes/.test(await n.textContent("#ref-lotes-info")), "tocar un lote no lo quitó");
      // Ctrl+Z en el plano deshace el toque (y no toca el tour); Ctrl+Shift+Z lo rehace
      await n.keyboard.press("Control+z"); await n.waitForTimeout(200);
      exige(/^9 lotes/.test(await n.textContent("#ref-lotes-info")), "Ctrl+Z no deshizo el toque en el plano");
      await n.keyboard.press("Control+Shift+z"); await n.waitForTimeout(200);
      exige(/^8 lotes/.test(await n.textContent("#ref-lotes-info")), "Ctrl+Shift+Z no rehízo el toque en el plano");
      await n.keyboard.press("Control+z"); await n.waitForTimeout(200);
      await n.fill("#ref-mz", "7");
      await n.evaluate(() => { const p = document.getElementById("ref-panel"); p.style.width = "300px"; p.style.height = "230px"; });
      const esquinas = [[st[0] + st[2] * 0.55, st[1] + st[3] * 0.5], [st[0] + st[2] * 0.9, st[1] + st[3] * 0.5], [st[0] + st[2] * 0.9, st[1] + st[3] * 0.9], [st[0] + st[2] * 0.55, st[1] + st[3] * 0.9]];
      // Al revés (espejo) no se acepta
      await n.click("#ref-colocar"); await n.waitForTimeout(300);
      for (const [x, y] of esquinas.slice().reverse()) { await n.mouse.click(x, y); await n.waitForTimeout(250); }
      await n.waitForTimeout(800);
      exige(!(await leer()).capas || !Object.values((await leer()).capas).flat().some((c) => c.lote && c.lote.manzana === "7"), "aceptó las esquinas en espejo");
      await n.keyboard.press("Escape"); await n.waitForTimeout(300);
      await n.click("#ref-colocar"); await n.waitForTimeout(300);
      // Un toque de más al poner las esquinas se quita con Ctrl+Z
      for (const [x, y] of esquinas.slice(0, 2)) { await n.mouse.click(x, y); await n.waitForTimeout(250); }
      await n.mouse.click(st[0] + st[2] * 0.7, st[1] + st[3] * 0.7); await n.waitForTimeout(250);
      await n.keyboard.press("Control+z"); await n.waitForTimeout(250);
      exige(/esquina 3 de 4/.test(await n.textContent("#banda")), "Ctrl+Z no quitó la esquina equivocada");
      for (const [x, y] of esquinas.slice(2)) { await n.mouse.click(x, y); await n.waitForTimeout(250); }
      await n.waitForTimeout(3000);
      const lotes7 = async () => Object.values((await leer()).capas).flat().filter((c) => c.lote && c.lote.manzana === "7");
      let lotes = await lotes7();
      exige(lotes.length === 9, "no se crearon los 9 lotes en la esfera (" + lotes.length + ")");
      // Ctrl+Z justo después de colocarlos los quita; Ctrl+Shift+Z los regresa
      await n.keyboard.press("Control+z"); await n.waitForTimeout(2500);
      exige((await lotes7()).length === 0, "Ctrl+Z no quitó los lotes recién colocados");
      await n.keyboard.press("Control+Shift+z"); await n.waitForTimeout(2500);
      lotes = await lotes7();
      exige(lotes.length === 9, "Ctrl+Shift+Z no regresó los lotes");
      // Laboratorio · foto 360 con lotes: un JPG 2:1 con los datos 360 (XMP GPano) para Facebook y Google Fotos
      exige(await n.isVisible("#foto360-boton"), "no está el botón «Foto 360 con lotes»");
      const [descarga] = await Promise.all([n.waitForEvent("download", { timeout: 120000 }), n.click("#foto360-boton")]);
      const bytes = fs.readFileSync(await descarga.path()), cab = bytes.slice(0, 3000).toString("latin1");
      exige(bytes[0] === 0xff && bytes[1] === 0xd8 && /GPano:ProjectionType="equirectangular"/.test(cab), "la foto 360 no trae los datos 360 (XMP)");
      const anchoF = +(cab.match(/FullPanoWidthPixels="(\d+)"/) || [])[1], altoF = +(cab.match(/FullPanoHeightPixels="(\d+)"/) || [])[1];
      exige(anchoF >= 2048 && anchoF === 2 * altoF && /-lotes-360\.jpg$/.test(descarga.suggestedFilename()), "la foto 360 no es 2:1 (" + anchoF + "×" + altoF + ")");
      // Manzana completa (lo de inicio): los 9 lotes amarrados; jalar una esquina mueve a todos; un «+» agrega un punto que la dobla
      let capas = Object.values((await leer()).capas).flat(), mzc = capas.find((c) => c.mzPlano);
      exige(mzc && lotes.every((c) => c.deManzana === mzc.id), "no se creó la manzana completa con sus lotes amarrados");
      await n.click('#lista li:has-text("Manzana 7")'); await n.waitForTimeout(600);
      const centros = (sel) => n.$$eval(sel, (l) => l.map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
      const esq = await centros("circle.mz-asa.esq"); exige(esq.length === 4, "la manzana del plano no muestra sus 4 esquinas (" + esq.length + ")");
      const antes = JSON.stringify(lotes.map((c) => c.puntos));
      await n.mouse.move(esq[2][0], esq[2][1]); await n.mouse.down(); await n.mouse.move(esq[2][0] + 30, esq[2][1] + 20, { steps: 8 }); await n.mouse.up(); await n.waitForTimeout(2500);
      lotes = await lotes7();
      exige(lotes.filter((c, i) => JSON.stringify(c.puntos) !== JSON.stringify(JSON.parse(antes)[i])).length >= 5, "jalar una esquina no estiró los lotes de la manzana");
      // Los puntos verdes de las divisiones se deslizan por la calle y cambian el ancho de los lotes (como la manzana normal)
      const divs = (await centros("circle.mz-asa.corte:not(.esq)")).filter((p) => p[0] > st[0] + 20 && p[0] < st[0] + st[2] - 20 && p[1] > st[1] + 20 && p[1] < st[1] + st[3] - 20);
      exige(divs.length >= 4 && (await n.$$("circle.mz-asa.centro")).length >= 4, "la manzana del plano no muestra los puntos de sus divisiones (" + divs.length + ")");
      const planoAntes = JSON.stringify(Object.values((await leer()).capas).flat().find((c) => c.mzPlano).mzPlano.lotes);
      await n.mouse.move(divs[0][0], divs[0][1]); await n.mouse.down(); await n.mouse.move(divs[0][0] + 12, divs[0][1] + 22, { steps: 8 }); await n.mouse.up(); await n.waitForTimeout(2500);
      // Reporte de Amar (video): el punto verde se mueve libre, también fuera de la orilla, para cuadrar con la foto
      const pa = JSON.parse(planoAntes), pd = Object.values((await leer()).capas).flat().find((c) => c.mzPlano).mzPlano.lotes;
      const movidos = pa.flatMap((L, i) => L.map((p, j) => [p, pd[i][j]])).filter(([p, q]) => q && Math.hypot(p[0] - q[0], p[1] - q[1]) > 3);
      exige(movidos.length && movidos.every(([p, q]) => Math.abs(p[1] - q[1]) > 3), "el punto verde de una división no se mueve libre (solo se desliza por la orilla)");
      // Reporte de Amar: al mover puntos salía una línea en diagonal (la orilla de la manzana se cortaba). El contorno debe cubrir a sus lotes.
      const suelo = (P) => P.map(([y, p]) => [Math.sin(y) / Math.tan(p), Math.cos(y) / Math.tan(p)]), area = (P) => Math.abs(P.reduce((s, a, i) => { const b = P[(i + 1) % P.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
      const cps = Object.values((await leer()).capas).flat(), mzx = cps.find((c) => c.mzPlano), sumaLotes = cps.filter((c) => c.deManzana === mzx.id).reduce((s, c) => s + area(suelo(c.puntos)), 0), aMz = area(suelo(mzx.puntos));
      exige(Math.abs(aMz - sumaLotes) < sumaLotes * 0.08, "el contorno de la manzana no coincide con sus lotes (" + aMz.toFixed(3) + " vs " + sumaLotes.toFixed(3) + ")");
      exige((await n.$$("circle.mz-asa.corte:not(.esq)")).length + (await n.$$("circle.mz-asa.centro")).length >= 12, "faltan puntos para mover las esquinas de los lotes");
      const mas = await centros("circle.mz-mas"); exige(mas.length >= 4, "la manzana del plano no tiene «+» en la orilla");
      await n.mouse.move(mas[0][0], mas[0][1]); await n.mouse.down(); await n.mouse.move(mas[0][0], mas[0][1] - 15, { steps: 6 }); await n.mouse.up(); await n.waitForTimeout(2500);
      capas = Object.values((await leer()).capas).flat(); mzc = capas.find((c) => c.mzPlano);
      exige(mzc.mzPlano.ctrl.length === 5, "el «+» no agregó un punto para doblar la manzana");
      // Igual que la manzana normal: redondear esquinas y curvar con las manijas rojas
      exige((await n.$$("circle.mz-asa.curva")).length >= 8 && (await n.$$("circle.mz-asa.radio")).length === 4, "la manzana del plano no tiene manijas de curva y aros de esquina");
      let previo = JSON.stringify((await lotes7()).map((c) => c.puntos));
      await n.click("[data-mzp-esquinas]"); await n.waitForTimeout(2500);
      capas = Object.values((await leer()).capas).flat(); mzc = capas.find((c) => c.mzPlano);
      exige(mzc.mzPlano.ctrl.slice(0, 4).every((k) => k.r > 0) && JSON.stringify((await lotes7()).map((c) => c.puntos)) !== previo, "«Redondear las 4 esquinas» no redondeó la manzana");
      const cur = (await centros("circle.mz-asa.curva")).filter((p) => p[0] > st[0] + 20 && p[0] < st[0] + st[2] - 20 && p[1] > st[1] + 20 && p[1] < st[1] + st[3] - 20);
      exige(cur.length, "no hay manijas de curva a la vista");
      await n.mouse.move(cur[0][0], cur[0][1]); await n.mouse.down(); await n.mouse.move(cur[0][0] - 20, cur[0][1] + 20, { steps: 8 }); await n.mouse.up(); await n.waitForTimeout(2500);
      capas = Object.values((await leer()).capas).flat(); mzc = capas.find((c) => c.mzPlano);
      exige(mzc.mzPlano.ctrl.some((k) => k.h && (k.h[0] || k.h[1])), "la manija roja no curvó la orilla");
      // «Soltar los lotes»: la manzana se quita y los 9 quedan sueltos
      await n.click("[data-mzp-soltar]"); await n.waitForTimeout(2500);
      capas = Object.values((await leer()).capas).flat();
      exige(!capas.some((c) => c.mzPlano) && capas.filter((c) => c.lote && c.lote.manzana === "7" && !c.deManzana).length === 9, "«Soltar los lotes» no dejó los 9 lotes sueltos");
      exige(lotes.map((c) => +c.lote.numero).sort((a, b) => a - b).join() === "1,2,3,4,5,6,7,8,9", "los lotes no quedaron numerados del 1 al 9");
      exige(!n.errs.length, "errores: " + n.errs.join(" | ").slice(0, 160));
      await n.context().close();
    }, a);

    // 5. Los errores de JavaScript de todas las páginas
    // Reporte de Amar (Las Alamedas, nov 2026): AutoCAD exporta letras como «MZA XXX» y las cotas dibujadas con
    // líneas. Pasaban encima de los lotes y la herramienta los armaba «mordidos» con la forma de las letras.
    // Además cada plano trae su calificación, para que el usuario sepa si su PDF sirve antes de culpar a Mozari.
    await paso("Plano de referencia: las letras dibujadas con líneas no cortan los lotes y el PDF trae su calificación", async () => {
      const n = await pagina(DUENO); await nuevoTour(n, "Letras en el plano");
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1800);
      const L = (pts, c, w) => '<polyline fill="none" stroke="' + (c || "#000") + '" stroke-width="' + (w || 1.5) + '" points="' + pts.map((p) => p.join(",")).join(" ") + '"/>';
      const P = (pts, c) => L(pts.concat([pts[0]]), c, 1);
      // Manzana de 2 filas × 4 lotes (lotes de 150 × 150)
      let svg = '<svg width="800" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="500" fill="#fff"/>' +
        L([[100, 100], [700, 100], [700, 400], [100, 400], [100, 100]]) + L([[100, 250], [700, 250]]) + [250, 400, 550].map((x) => L([[x, 100], [x, 400]])).join("");
      // «MZA» en letras de contorno (como el SHX de AutoCAD), en café, encima de la división entre el lote 2 y el 3 y de la del 3 y el 4
      const letra = (x, y, f) => f.map((poly) => P(poly.map(([a, b]) => [x + a * 0.4, y + b * 0.4]), "#CD6928")).join(""); // letras de 24 px en lotes de 150
      const M = [[[0, 60], [0, 0], [12, 0], [27, 30], [42, 0], [54, 0], [54, 60], [44, 60], [44, 20], [27, 50], [10, 20], [10, 60]]];
      const Z = [[[0, 0], [50, 0], [50, 10], [14, 50], [50, 50], [50, 60], [0, 60], [0, 50], [36, 10], [0, 10]]];
      const A = [[[0, 60], [22, 0], [34, 0], [56, 60], [44, 60], [39, 46], [17, 46], [12, 60]], [[20, 36], [36, 36], [28, 12]]];
      svg += letra(390, 165, M) + letra(430, 165, Z) + letra(540, 165, A);
      // Cotas en rojo: numeritos dibujados con rayitas junto a cada lote
      for (let k = 0; k < 8; k++) { const x = 120 + (k % 4) * 150, y = k < 4 ? 112 : 388; svg += L([[x, y], [x + 6, y], [x + 6, y + 8], [x, y + 8], [x, y]], "#f00", 0.6) + L([[x + 10, y], [x + 16, y + 8]], "#f00", 0.6); }
      svg += "</svg>";
      const hoja = await navegador.newPage(); await hoja.setContent('<!doctype html><html><body style="margin:0">' + svg + "</body></html>");
      const pdf = await hoja.pdf({ width: "800px", height: "500px", printBackground: true }); await hoja.close();
      await n.click("#ref-boton"); await n.waitForTimeout(400);
      await n.setInputFiles("#ref-archivo2", { name: "manzana-con-letras.pdf", mimeType: "application/pdf", buffer: pdf });
      let ancho = 0; for (let i = 0; i < 25 && !ancho; i++) { await n.waitForTimeout(600); ancho = await n.$eval("#ref-img", (e) => (e.hidden ? 0 : e.naturalWidth)); }
      exige(ancho > 500, "el PDF no se pudo ver");
      await n.waitForTimeout(3000);
      exige(/Plano bueno/.test(await n.textContent("#ref-calidad")) && (await n.isVisible("#ref-calidad")), "el plano vectorial no salió calificado como bueno");
      // Con la apariencia clara, los botones de la ventanita (que siempre es oscura) se siguen leyendo
      const luz = () => n.evaluate(() => { const m = getComputedStyle(document.getElementById("ref-ajustar")).color.match(/\d+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; });
      await n.evaluate(() => { const r = document.getElementById("tema-rango"); r.value = 100; r.dispatchEvent(new Event("input")); }); await n.waitForTimeout(200);
      const luzClaro = await luz();
      await n.evaluate(() => { const r = document.getElementById("tema-rango"); r.value = 0; r.dispatchEvent(new Event("input")); }); await n.waitForTimeout(200);
      exige(luzClaro > 0.6, "con la apariencia clara, los botones del plano casi no se leen (luz " + luzClaro.toFixed(2) + ")");
      await n.evaluate(() => { const p = document.getElementById("ref-panel"); p.style.width = "560px"; p.style.height = "420px"; });
      await pasarGuias(n); await n.click("#ref-ajustar"); await n.click("#ref-lotes"); await n.waitForTimeout(500); await pasarGuias(n); await n.waitForTimeout(300);
      const aPant = (x, y) => n.evaluate(([x, y]) => { const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(document.getElementById("ref-lienzo").style.transform), v = document.getElementById("ref-vista").getBoundingClientRect(); return [v.x + +m[1] + x * +m[3], v.y + +m[2] + y * +m[3]]; }, [x, y]);
      const k = ancho / 800, [ax, ay] = await aPant(80 * k, 80 * k), [bx, by] = await aPant(720 * k, 420 * k);
      await n.mouse.move(ax, ay); await n.mouse.down(); await n.mouse.move((ax + bx) / 2, (ay + by) / 2, { steps: 6 }); await n.mouse.move(bx, by, { steps: 6 }); await n.mouse.up();
      let info = ""; for (let i = 0; i < 20 && !/elegid|No /.test(info); i++) { await n.waitForTimeout(400); info = await n.textContent("#ref-lotes-info"); }
      exige(/^8 lotes elegidos/.test(info), "las letras encima cambiaron los lotes: se esperaban 8 (" + info + ")");
      exige(/Ignoré los textos/.test(info), "no avisó que ignoró los textos dibujados con líneas (" + info + ")");
      // Cada lote salió cuadrado (4 esquinas), no «mordido» con la forma de las letras
      const esquinas = await n.$$eval("#ref-sel path.lf.si", (l) => l.map((e) => (e.getAttribute("d").match(/L/g) || []).length + 1));
      exige(esquinas.length === 8 && esquinas.every((q) => q === 4), "algún lote salió mordido por las letras: " + JSON.stringify(esquinas));
      const capt = (nom) => (process.env.CAPTURAS ? n.screenshot({ path: path.join(process.env.CAPTURAS, nom + ".png") }) : null);
      await capt("plano-bueno");
      // Un plano que es imagen (escaneado) se califica «Solo guía» y lo explica
      // (la «foto» se hace pintando el mismo dibujo en un canvas: sin captura de pantalla, que falla en la revisión completa)
      const png = await n.evaluate((svg) => new Promise((ok) => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = 800; c.height = 500; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 800, 500); g.drawImage(im, 0, 0); ok(c.toDataURL("image/png")); }; im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); }), svg);
      const foto = await navegador.newPage(); await foto.setContent('<!doctype html><html><body style="margin:0"><img src="' + png + '" style="width:800px;height:500px;display:block"></body></html>');
      const escaneado = await foto.pdf({ width: "800px", height: "500px", printBackground: true }); await foto.close();
      await n.setInputFiles("#ref-archivo", { name: "escaneado.pdf", mimeType: "application/pdf", buffer: escaneado });
      let cal = ""; for (let i = 0; i < 25 && !/guía/.test(cal); i++) { await n.waitForTimeout(600); cal = await n.textContent("#ref-calidad").catch(() => ""); }
      exige(/Solo guía/.test(cal), "un PDF escaneado no salió como «Solo guía» (" + cal + ")");
      // Al cambiar de plano no se queda la selección del anterior (ni números ni esquinas ni el texto)
      exige(/^Arrastra un recuadro/.test(await n.textContent("#ref-lotes-info")) && !(await n.$$("#ref-sel text, #ref-sel path, #ref-sel g")).length, "al cambiar de plano se quedó la selección del plano anterior");
      await n.waitForTimeout(800); await capt("plano-guia");
      exige(!n.errs.length, "errores en el estudio: " + n.errs.join(" | ").slice(0, 200));
      await n.context().close();
    });
    // Lección de El Mirador (nov 2026): los lotes que salen del PDF se colocan DESPUÉS de los puntos que ya había
    // (hotspot, punto de interés, texto en 3D). Así fue como el iPhone se quedó sin memoria. Esta prueba hace el
    // camino completo del usuario con la herramienta del PDF y revisa el tour publicado en un iPhone.
    await paso("Lotes del PDF colocados después de un punto en 3D: en el tour de iPhone van abajo y sin capas pesadas", async () => {
      const n = await pagina(DUENO); await nuevoTour(n, "PDF después de un punto");
      const id = await idTour(n), leer = () => n.evaluate((id) => fetch("api/tours/" + id).then((x) => x.json()), id);
      // 1) Primero un texto en 3D en la vista inicial (como el hotspot de El Mirador)
      const d = await leer(), esc = d.proyecto.escenaInicial || d.escenas[0].id;
      d.capas = d.capas || {}; d.capas[esc] = [{ id: "punto-antes", tipo: "texto", nombre: "Texto", visible: true, en3d: true, yaw: 0, pitch: 0, texto: "Ventas", tamano: 18, peso: 600, color: "#FFFFFF", fondo: { activo: false, color: "#0B0B0B" } }];
      exige((await n.evaluate(([id, d]) => fetch("api/tours/" + id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(d) }).then((r) => r.status), [id, d])) === 200, "no se pudo poner el texto en 3D");
      await n.reload(); await n.waitForTimeout(3000); await cerrarGuia(n);
      await n.click('#nav button:has-text("Panoramas")'); await n.waitForTimeout(600);
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1800);
      // 2) Mirar hacia el suelo, subir el PDF con letras y cotas encima, y elegir la manzana
      const st = await n.evaluate(() => { const e = [...document.querySelectorAll(".capas")].find((x) => x.getClientRects().length && x.getBoundingClientRect().width > 300); const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; });
      const [cx, cy] = [st[0] + st[2] / 2, st[1] + st[3] / 2];
      for (let i = 0; i < 4; i++) { await n.mouse.move(cx, cy + 250); await n.mouse.down(); for (let k = 1; k <= 10; k++) await n.mouse.move(cx, cy + 250 - k * 50); await n.mouse.up(); await n.waitForTimeout(300); }
      const L = (pts, c, w) => '<polyline fill="none" stroke="' + (c || "#000") + '" stroke-width="' + (w || 1.5) + '" points="' + pts.map((p) => p.join(",")).join(" ") + '"/>';
      const letra = (x, y, f) => f.map((poly) => L(poly.concat([poly[0]]).map(([a, b]) => [x + a * 0.4, y + b * 0.4]), "#CD6928", 1)).join("");
      const svg = '<svg width="800" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="500" fill="#fff"/>' +
        L([[100, 100], [700, 100], [700, 400], [100, 400], [100, 100]]) + L([[100, 250], [700, 250]]) + [250, 400, 550].map((x) => L([[x, 100], [x, 400]])).join("") +
        letra(390, 165, [[[0, 60], [0, 0], [12, 0], [27, 30], [42, 0], [54, 0], [54, 60], [44, 60], [44, 20], [27, 50], [10, 20], [10, 60]]]) +
        letra(540, 165, [[[0, 60], [22, 0], [34, 0], [56, 60], [44, 60], [39, 46], [17, 46], [12, 60]], [[20, 36], [36, 36], [28, 12]]]) + "</svg>";
      const hoja = await navegador.newPage(); await hoja.setContent('<!doctype html><html><body style="margin:0">' + svg + "</body></html>");
      const pdf = await hoja.pdf({ width: "800px", height: "500px", printBackground: true }); await hoja.close();
      await n.click("#ref-boton"); await n.waitForTimeout(400);
      await n.setInputFiles("#ref-archivo2", { name: "manzana.pdf", mimeType: "application/pdf", buffer: pdf });
      let ancho = 0; for (let i = 0; i < 25 && !ancho; i++) { await n.waitForTimeout(600); ancho = await n.$eval("#ref-img", (e) => (e.hidden ? 0 : e.naturalWidth)); }
      exige(ancho > 500, "el PDF no se pudo ver");
      await n.waitForTimeout(3000);
      await n.evaluate(() => { const p = document.getElementById("ref-panel"); p.style.width = "560px"; p.style.height = "420px"; });
      await pasarGuias(n); await n.click("#ref-ajustar"); await n.click("#ref-lotes"); await n.waitForTimeout(500); await pasarGuias(n); await n.waitForTimeout(300);
      const aPant = (x, y) => n.evaluate(([x, y]) => { const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(document.getElementById("ref-lienzo").style.transform), v = document.getElementById("ref-vista").getBoundingClientRect(); return [v.x + +m[1] + x * +m[3], v.y + +m[2] + y * +m[3]]; }, [x, y]);
      const k = ancho / 800, [ax, ay] = await aPant(80 * k, 80 * k), [bx, by] = await aPant(720 * k, 420 * k);
      await n.mouse.move(ax, ay); await n.mouse.down(); await n.mouse.move((ax + bx) / 2, (ay + by) / 2, { steps: 6 }); await n.mouse.move(bx, by, { steps: 6 }); await n.mouse.up();
      let info = ""; for (let i = 0; i < 20 && !/elegid|No /.test(info); i++) { await n.waitForTimeout(400); info = await n.textContent("#ref-lotes-info"); }
      exige(/^8 lotes elegidos/.test(info), "no salieron los 8 lotes del PDF (" + info + ")");
      // 3) Colocar en la esfera: las 4 esquinas en el suelo
      await n.fill("#ref-mz", "1");
      await n.evaluate(() => { const p = document.getElementById("ref-panel"); p.style.width = "300px"; p.style.height = "230px"; });
      await n.click("#ref-colocar"); await n.waitForTimeout(300);
      for (const [x, y] of [[0.4, 0.5], [0.9, 0.5], [0.9, 0.9], [0.4, 0.9]]) { await n.mouse.click(st[0] + st[2] * x, st[1] + st[3] * y); await n.waitForTimeout(250); }
      await n.waitForTimeout(3000);
      const lista = (await leer()).capas[esc] || [], iLotes = lista.map((c, i) => (c.tipo === "poligono" && c.lote ? i : -1)).filter((i) => i >= 0);
      console.log("    en la esfera: " + lista.map((c) => c.tipo + (c.lote ? "·lote" : "")).join(", "));
      exige(iLotes.length === 8, "no se colocaron los 8 lotes en la esfera (" + iLotes.length + ")");
      exige(lista.findIndex((c) => c.id === "punto-antes") < Math.min(...iLotes), "los lotes no quedaron creados después del texto (no es el caso de El Mirador)");
      // 4) Publicar y abrirlo en un iPhone
      exige((await n.evaluate((id) => fetch("api/tours/" + id + "/publicar", { method: "POST" }).then((r) => r.status), id)) === 200, "no se pudo publicar");
      await n.context().close();
      const m = await pagina(null, Object.assign({}, devices["iPhone 13"], { acceptDownloads: false }));
      await m.goto(TOURS + "/" + id + "/"); await m.waitForTimeout(5000);
      const r = await m.evaluate(() => {
        const hijos = [...document.querySelectorAll(".capas > *")];
        const pols = hijos.map((e, i) => (e.classList.contains("cp-poligono") ? i : -1)).filter((i) => i >= 0);
        const puntos = hijos.map((e, i) => (e.classList.contains("cp") && !e.classList.contains("cp-poligono") ? i : -1)).filter((i) => i >= 0);
        return { pols: pols.length, puntos: puntos.length, ultimoPol: Math.max(...pols), primerPunto: Math.min(...puntos) };
      });
      exige(r.pols >= 8 && r.puntos === 1, "en el tour no se ven los 8 lotes y el texto (" + JSON.stringify(r) + ")");
      exige(r.ultimoPol < r.primerPunto, "un lote del PDF quedó encima del texto en 3D: " + JSON.stringify(r));
      const cp = await capasPesadas(m);
      console.log("    capas grandes en el iPhone: " + JSON.stringify(cp));
      exige(cp.n <= MAX_CAPAS_GRANDES, "demasiadas capas de pantalla completa para un iPhone: " + JSON.stringify(cp));
      exige(!m.errs.length, "errores en el iPhone: " + m.errs.join(" | ").slice(0, 160));
      await m.context().close();
    });
    // Pasó con Amar en El Mirador (nov 2026): se fue a otra app y la música del tour siguió sonando de fondo
    await paso("La música del tour se pausa al irse a otra app y sigue al regresar (no se queda sonando)", async () => {
      const n = await pagina(DUENO); await nuevoTour(n, "Tour con música");
      await n.click('#nav button:has-text("Proyecto")'); await n.waitForTimeout(500);
      await n.click('#subtabs button:has-text("Música")'); await n.waitForTimeout(500);
      const sr = 8000, k = sr * 20, wav = Buffer.alloc(44 + k * 2); // 20 s de un tono suave
      wav.write("RIFF", 0); wav.writeUInt32LE(36 + k * 2, 4); wav.write("WAVE", 8); wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(k * 2, 40);
      for (let i = 0; i < k; i++) wav.writeInt16LE(Math.round(Math.sin(i / 8) * 1500), 44 + i * 2);
      await n.setInputFiles("#m-archivo", { name: "fondo.wav", mimeType: "audio/wav", buffer: wav }); await n.waitForTimeout(3500);
      const id = await idTour(n);
      exige((await n.evaluate((id) => fetch("api/tours/" + id + "/publicar", { method: "POST" }).then((r) => r.status), id)) === 200, "no se pudo publicar");
      await n.context().close();
      const t = await pagina(null);
      await t.addInitScript(() => { window.__medios = []; const p = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { if (!window.__medios.includes(this)) window.__medios.push(this); return p.apply(this, arguments); }; });
      await t.goto(TOURS + "/" + id + "/"); await t.waitForTimeout(4000);
      await t.mouse.click(700, 450); await t.waitForTimeout(1500); // la música empieza con el primer toque
      const sonando = () => t.evaluate(() => (window.__medios || []).some((m) => !m.paused));
      exige(await sonando(), "la música no empezó al tocar el tour");
      const ver = (e) => t.evaluate((e) => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => e }); document.dispatchEvent(new Event("visibilitychange")); }, e);
      await ver("hidden"); await t.waitForTimeout(300);
      exige(!(await sonando()), "al irse a otra app la música se quedó sonando de fondo");
      await ver("visible"); await t.waitForTimeout(800);
      exige(await sonando(), "al regresar al tour la música no siguió");
      // Si el cliente la silenció con el botón, al irse y regresar se queda callada
      await t.click('[data-sk="musica"]'); await t.waitForTimeout(400);
      exige(!(await sonando()), "el botón de música no la silenció");
      await ver("hidden"); await t.waitForTimeout(200); await ver("visible"); await t.waitForTimeout(800);
      exige(!(await sonando()), "la música silenciada volvió a sonar al regresar al tour");
      exige(!t.errs.length, "errores en el tour: " + t.errs.join(" | ").slice(0, 200));
      await t.context().close();
    });
    // Pedido de un usuario de Perú (nov 2026): allá se dice «Reservado», no «Apartado». Los nombres de los estados se editan.
    await paso("Estados de los lotes con el nombre de cada país: «Apartado» se cambia a «Reservado» y sale en el tour", async () => {
      const n = await pagina(DUENO); await nuevoTour(n, "Estados por país");
      await n.click('#subtabs button:has-text("Fichas técnicas")'); await n.waitForTimeout(1200); await pasarGuias(n);
      const campo = '#lt-estados [data-nombre-estado="apartado"]';
      exige(await n.isVisible(campo) && (await n.inputValue(campo)) === "Apartado", "no está el campo para cambiar el nombre de «Apartado»");
      await n.fill(campo, "Reservado"); await n.waitForTimeout(1500);
      const id = await idTour(n), leer = () => n.evaluate((id) => fetch("api/tours/" + id).then((x) => x.json()), id);
      const est = (d) => Object.fromEntries((d.lotesEstados || []).map((e) => [e.id, e.nombre]));
      exige(est(await leer()).apartado === "Reservado", "el nombre nuevo no se guardó: " + JSON.stringify(est(await leer())));
      exige(/Reservado/.test(await n.textContent("#lotes-resumen")) && !/Apartado/.test(await n.textContent("#lotes-resumen")), "el resumen de lotes sigue diciendo «Apartado»");
      // Un nombre vacío regresa al de siempre (no se queda un estado sin nombre)
      await n.fill('#lt-estados [data-nombre-estado="vendido"]', ""); await n.waitForTimeout(1200);
      exige(est(await leer()).vendido === "Vendido", "un nombre vacío dejó el estado sin nombre");
      if (process.env.CAPTURAS) { await n.$eval("#lt-estados-fila", (e) => e.scrollIntoView({ block: "center" })); await n.screenshot({ path: path.join(process.env.CAPTURAS, "estados-nombres.png") }); }
      // Publicado: el tour del cliente trae «Reservado»
      exige((await n.evaluate((id) => fetch("api/tours/" + id + "/publicar", { method: "POST" }).then((r) => r.status), id)) === 200, "no se pudo publicar");
      const pub = await n.evaluate((u) => fetch(u).then((r) => r.json()), TOURS + "/" + id + "/proyecto.json").catch(() => null);
      exige(pub && est(pub).apartado === "Reservado", "el tour publicado no trae «Reservado»: " + JSON.stringify(pub && pub.lotesEstados));
      exige(!n.errs.length, "errores en el estudio: " + n.errs.join(" | ").slice(0, 200));
      await n.context().close();
    });
    // Pasó con Alexis en Firefox (nov 2026): subió su esfera y no la veía. Si el navegador entrega en negro la imagen que
    // dibuja la tarjeta de video, Mozari la lee pixel por pixel. Aquí se imita ese navegador y la esfera debe verse igual.
    await paso("Esfera subida en un navegador que entrega el WebGL en negro (Firefox): se ve igual que en Chrome", async () => {
      const color = (pg, id) => pg.evaluate(async (id) => {
        const d = await fetch("api/tours/" + id).then((r) => r.json()), esc = d.escenas[0].id, base = "t/" + id + "/escenas/" + esc + "/";
        const e = await fetch(base + "escena.json").then((r) => r.json()), L = e.niveles.length - 1;
        const out = {};
        for (const [k, ruta] of [["pieza", L + "/f/0/0.jpg"], ["vista", "preview.jpg"]]) {
          const b = await createImageBitmap(await fetch(base + ruta).then((r) => r.blob())), c = new OffscreenCanvas(32, 32), x = c.getContext("2d");
          x.drawImage(b, 0, 0, 32, 32); const px = x.getImageData(0, 0, 32, 32).data; let n = 0; for (let i = 0; i < px.length; i += 4) n += (px[i] + px[i + 1] + px[i + 2]) / 3;
          out[k] = Math.round(n / (32 * 32));
        }
        return out;
      }, id);
      const normal = await color(a, tour);
      const u = await pagina("firefox-" + Date.now() + "@prueba.mx");
      await u.addInitScript(() => {
        // Como el Firefox de Alexis: lo que sale del WebGL llega vacío
        const ctx = OffscreenCanvas.prototype.getContext, pasa = OffscreenCanvas.prototype.transferToImageBitmap, gl = new WeakSet();
        OffscreenCanvas.prototype.getContext = function (t, o) { const c = ctx.call(this, t, o); if (/webgl/.test(t)) gl.add(this); return c; };
        OffscreenCanvas.prototype.transferToImageBitmap = function () { const b = pasa.call(this); if (!gl.has(this)) return b; const w = b.width, h = b.height; b.close(); const v = new OffscreenCanvas(w, h); v.getContext("2d"); return v.transferToImageBitmap(); };
      });
      await u.reload(); await u.waitForTimeout(2500); await cerrarAnuncio(u); await cerrarGuia(u);
      try { await nuevoTour(u, "Firefox"); }
      catch (e) { throw new Error(e.message + " · " + (await u.textContent("#subir-zona").catch(() => "")).replace(/\s+/g, " ").slice(0, 160) + " · " + u.errs.join(" | ").slice(0, 300)); }
      const raro = await color(u, await idTour(u));
      console.log("    brillo de la esfera · normal: " + JSON.stringify(normal) + " · navegador con WebGL en negro: " + JSON.stringify(raro));
      exige(normal.pieza > 60 && normal.vista > 60, "la esfera normal salió oscura: " + JSON.stringify(normal));
      exige(raro.pieza > 60 && raro.vista > 60, "con el WebGL en negro la esfera se subió negra: " + JSON.stringify(raro));
      exige(Math.abs(raro.pieza - normal.pieza) <= 6 && Math.abs(raro.vista - normal.vista) <= 6, "la esfera leída pixel por pixel no salió igual (¿al revés?): " + JSON.stringify({ normal, raro }));
      exige(!u.errs.length, "errores en el estudio: " + u.errs.join(" | ").slice(0, 200));
      await u.context().close();
    });
    // Pasó con Diego (nov 2026): compró Pro para quitarle la marca a un tour con 36 lotes, pero los lotes son de
    // Desarrollos. Al pagar, si su tour tiene lotes, se le dice claro y se le sugiere Desarrollos.
    await paso("Al comprar con un tour con lotes: sugiere Desarrollos y avisa que con Pro sigue la marca", async () => {
      const u = await pagina("pago-" + Date.now() + "@prueba.mx"); await nuevoTour(u, "Con lotes");
      const id = await idTour(u), d = await u.evaluate((id) => fetch("api/tours/" + id).then((x) => x.json()), id);
      const esc = d.proyecto.escenaInicial || d.escenas[0].id, v = d.escenas.find((e) => e.id === esc).vista || {}, y = v.yaw || 0, p = (v.pitch || 0) + 0.25;
      d.capas[esc] = (d.capas[esc] || []).concat([{ id: "lote-1", tipo: "poligono", nombre: "Lote", visible: true, puntos: [[y - 0.1, p], [y, p], [y, p + 0.08], [y - 0.1, p + 0.08]],
        relleno: { color: "#D5FF40", opacidad: 0.35 }, trazo: { color: "#D5FF40", grosor: 1.5, opacidad: 1 }, lote: { numero: "1", manzana: "A", area: "100", precio: "", lados: [], frente: 0, estado: "disponible" } }]);
      exige((await u.evaluate(([id, d]) => fetch("api/tours/" + id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(d) }).then((r) => r.status), [id, d])) === 200, "no se pudo poner el lote de prueba");
      await u.goto(ESTUDIO + "/#t=" + id); await u.reload(); await u.waitForTimeout(2500); await cerrarAnuncio(u); await cerrarGuia(u);
      // Desde «Ver licencias» (pide Pro): como el tour tiene lotes, abre con Desarrollos elegido
      await u.evaluate(() => { const b = document.querySelector('[data-comprar="pro"]'); if (b) b.click(); });
      await u.waitForTimeout(800);
      exige(await u.isVisible("#dlg-pago"), "no se abrió la ventana de pago");
      exige(await u.$('[data-dp-plan="desarrollos"][aria-pressed="true"]'), "con un tour con lotes no sugirió Desarrollos");
      exige(/tours sin lotes/.test(await u.textContent('[data-dp-plan="pro"]')), "la tarjeta de Pro no dice que es para tours sin lotes");
      exige(!(await u.isVisible("#dp-aviso-lotes")), "el aviso de lotes salió con Desarrollos elegido");
      await u.click('[data-dp-plan="pro"]'); await u.waitForTimeout(400);
      exige(await u.isVisible("#dp-aviso-lotes") && /sigue publicando con marca/.test(await u.textContent("#dp-aviso-lotes")), "al elegir Pro con un tour con lotes no avisó que sigue la marca");
      if (process.env.CAPTURAS) await u.screenshot({ path: path.join(process.env.CAPTURAS, "pago-lotes.png") });
      await u.click("[data-dp-cerrar]"); await u.waitForTimeout(300);
      exige(!u.errs.length, "errores en el estudio: " + u.errs.join(" | ").slice(0, 200));
      await u.context().close();
    });
    // Pedido de Icaro (nov 2026): además de cambiarles el nombre, agregar más estados. Nace en el Laboratorio.
    await paso("Más estados de lote: «+ Estado» agrega uno propio, se usa en un lote, sale en el tour y se quita sin perder lotes", async () => {
      const n = await pagina(DUENO); await nuevoTour(n, "Más estados");
      const id = await idTour(n), leer = () => n.evaluate((id) => fetch("api/tours/" + id).then((x) => x.json()), id);
      // Dos lotes de prueba (manzana A) a la vista de la esfera
      const d = await leer(), esc = d.proyecto.escenaInicial || d.escenas[0].id, v = d.escenas.find((e) => e.id === esc).vista || {}, y = v.yaw || 0, p = (v.pitch || 0) + 0.25;
      const lote = (num, dy) => ({ id: "lote-" + num, tipo: "poligono", nombre: "Lote", visible: true, puntos: [[y - 0.1 + dy, p], [y + dy, p], [y + dy, p + 0.08], [y - 0.1 + dy, p + 0.08]],
        relleno: { color: "#D5FF40", opacidad: 0.35 }, trazo: { color: "#D5FF40", grosor: 1.5, opacidad: 1 }, lote: { numero: num, manzana: "A", area: "100", precio: "250000", lados: [], frente: 0, estado: "disponible" } });
      d.capas[esc] = (d.capas[esc] || []).concat([lote("1", 0), lote("2", 0.12)]);
      exige((await n.evaluate(([id, d]) => fetch("api/tours/" + id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(d) }).then((r) => r.status), [id, d])) === 200, "no se pudieron poner los lotes de prueba");
      await n.goto(ESTUDIO + "/#t=" + id); await n.reload(); await n.waitForTimeout(2500); await cerrarAnuncio(n); await cerrarGuia(n);
      await n.click('#nav button:has-text("Panoramas")'); await n.waitForTimeout(500);
      await n.click('#subtabs button:has-text("Fichas técnicas")'); await n.waitForTimeout(1200); await pasarGuias(n);
      exige(!(await n.$("#lt-estados .lt-quitar")), "los 3 estados de siempre se pueden quitar (no deben)");
      await n.click("#lt-estados [data-mas-estado]"); await n.waitForTimeout(1500);
      const propios = async () => ((await leer()).lotesEstados || []).filter((e) => /^e-/.test(e.id));
      let nuevos = await propios();
      exige(nuevos.length === 1 && nuevos[0].nombre === "En negociación" && /^#/.test(nuevos[0].color), "«+ Estado» no agregó «En negociación»: " + JSON.stringify(nuevos));
      const eid = nuevos[0].id, campo = '#lt-estados [data-nombre-estado="' + eid + '"]';
      exige(await n.evaluate((c) => document.activeElement === document.querySelector(c), campo), "el estado nuevo no quedó listo para escribirle el nombre");
      await n.fill(campo, "Negociando"); await n.waitForTimeout(1500);
      exige((await propios())[0].nombre === "Negociando", "el nombre del estado nuevo no se guardó");
      // Se usa en un lote desde la tabla
      const boton = '#lotes-tabla tr[data-k]:has(td:nth-child(2) b:text-is("1")) [data-estado="' + eid + '"]';
      exige(await n.isVisible(boton), "el estado nuevo no sale para elegirlo en los lotes");
      await n.click(boton); await n.waitForTimeout(1500);
      const estDe = (dd, num) => (Object.values(dd.capas).flat().find((c) => c.lote && c.lote.numero === num) || {}).lote.estado;
      exige(estDe(await leer(), "1") === eid, "el lote 1 no quedó «Negociando»");
      exige(/1\s*Negociando/.test(await n.textContent("#lotes-resumen")), "el resumen no cuenta el lote «Negociando»: " + (await n.textContent("#lotes-resumen")));
      if (process.env.CAPTURAS) { await n.$eval("#lt-estados-fila", (e) => e.scrollIntoView({ block: "center" })); await n.screenshot({ path: path.join(process.env.CAPTURAS, "estados-mas.png") }); }
      // Publicado: el tour trae el estado con su color y la leyenda lo cuenta
      exige((await n.evaluate((id) => fetch("api/tours/" + id + "/publicar", { method: "POST" }).then((r) => r.status), id)) === 200, "no se pudo publicar");
      const pub = await n.evaluate((u) => fetch(u).then((r) => r.json()), TOURS + "/" + id + "/proyecto.json").catch(() => null);
      exige(pub && (pub.lotesEstados || []).some((e) => e.id === eid && e.nombre === "Negociando") && estDe(pub, "1") === eid, "el tour publicado no trae el estado nuevo");
      // Hasta 8: luego ya no sale el botón
      for (let i = 0; i < 6 && (await n.$("#lt-estados [data-mas-estado]")); i++) { await n.click("#lt-estados [data-mas-estado]"); await n.waitForTimeout(500); }
      await n.waitForTimeout(1200);
      exige(((await leer()).lotesEstados || []).length === 8 && !(await n.$("#lt-estados [data-mas-estado]")), "el límite de 8 estados no funciona");
      // Quitarlo: el lote regresa a Disponible, nada se pierde
      await n.click('#lt-estados [data-quitar-estado="' + eid + '"]'); await n.waitForTimeout(1500);
      const fin = await leer();
      exige(!(fin.lotesEstados || []).some((e) => e.id === eid) && fin.lotesEstados.length === 7, "el estado no se quitó");
      exige(estDe(fin, "1") === "disponible" && estDe(fin, "2") === "disponible", "al quitar el estado, el lote no regresó a Disponible: " + estDe(fin, "1"));
      exige(/regres/.test(await n.textContent("#toast")), "no avisó que el lote regresó a Disponible");
      exige(await n.isVisible("#lt-estados [data-mas-estado]"), "con 7 estados no regresó el botón «+ Estado»");
      exige(!n.errs.length, "errores en el estudio: " + n.errs.join(" | ").slice(0, 200));
      await n.context().close();
      // Es del Laboratorio («Solo yo» al nacer): una cuenta normal todavía no lo ve
      const u = await pagina("estados-" + Date.now() + "@prueba.mx"); await nuevoTour(u, "Sin lab");
      await u.click('#subtabs button:has-text("Fichas técnicas")'); await u.waitForTimeout(1000); await pasarGuias(u);
      exige(await u.isVisible('#lt-estados [data-nombre-estado="apartado"]') && !(await u.$("#lt-estados [data-mas-estado]")), "una cuenta normal ya ve «+ Estado» (debe nacer en el Laboratorio)");
      await u.context().close();
    });
    // Pasó con Las Alamedas (nov 2026): la manzana del tour quedó como «1» (la de siempre) y en el inventario era la 30,
    // con un lote 15-A. El plano sí traía escrito, como texto, el número y la superficie de cada lote. Ahora Mozari los lee,
    // y al importar el Excel avisa antes de cambiar nada si las superficies no van con los lotes dibujados.
    // Nov 2026: íconos que se mueven (espacios, amenidades, dron…) para los hotspots, con sus 3 colores. Nace en el Laboratorio.
    await paso("Íconos animados: un hotspot con la cocina, sus colores y así se ve en el tour", async () => {
      const n = await pagina(DUENO); await nuevoTour(n, "Iconos animados");
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1500); await pasarGuias(n);
      await n.click("#add-hs"); await n.waitForTimeout(600); await pasarGuias(n);
      exige(await n.isVisible('.anim-op[data-v="cocina"]'), "en el hotspot no sale para elegir un ícono animado");
      exige((await n.$$(".anim-op[data-v]:not([data-v=''])")).length === 56, "no salen los 56 íconos animados");
      await n.click('.anim-op[data-v="cocina"]'); await n.waitForTimeout(600);
      exige(await n.$(".capas .hs-boton.con-animado svg.ma-cocina"), "el hotspot no muestra la cocina animada en la esfera");
      // Se mueve de verdad (tiene animaciones corriendo) y toma sus colores
      const anima = await n.evaluate(() => { const s = document.querySelector(".capas .hs-anim"); return { corre: s.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length, a: s.style.getPropertyValue("--a").trim(), linea: s.style.color }; });
      exige(anima.corre > 0, "la cocina no se mueve");
      exige(/^#[0-9A-F]{6}$/i.test(anima.a) && anima.a.toUpperCase() !== "#FFFFFF", "el acento no salió de color (debe tomar la Interfaz o dorado): " + JSON.stringify(anima));
      // Cambiar el acento a azul
      await n.$eval('input[type=color][data-k="animColores.acento"]', (e) => { e.value = "#3366ff"; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); });
      await n.waitForTimeout(1200);
      const id = await idTour(n), leer = () => n.evaluate((id) => fetch("api/tours/" + id).then((x) => x.json()), id);
      const hs = Object.values((await leer()).capas).flat().find((c) => c.tipo === "hotspot");
      exige(hs && hs.animado === "cocina" && hs.animColores && hs.animColores.acento.toLowerCase() === "#3366ff", "no se guardó el ícono o su color: " + JSON.stringify(hs && { animado: hs.animado, col: hs.animColores }));
      exige((await n.$eval(".capas .hs-anim", (e) => e.style.getPropertyValue("--a").trim().toLowerCase())) === "#3366ff", "la esfera no cambió al acento azul");
      if (process.env.CAPTURAS) await n.screenshot({ path: path.join(process.env.CAPTURAS, "iconos-hotspot.png") });
      // En la vista previa (como en el tour) también se mueve
      await n.click('button:has-text("Vista previa")'); await n.waitForTimeout(3500);
      exige(await n.$("#previa .hs-boton.con-animado svg.ma-cocina"), "en la vista previa el hotspot no trae la cocina animada");
      await n.keyboard.press("Escape"); await n.waitForTimeout(500);
      // «Sin»: regresa al hotspot de siempre
      await n.click('.anim-op[data-v=""]'); await n.waitForTimeout(600);
      exige(!(await n.$(".capas .hs-boton.con-animado")) && (await n.$(".capas .hs-boton .hs-nucleo")), "«Sin» no regresó el hotspot normal");
      exige(!n.errs.length, "errores en el estudio: " + n.errs.join(" | ").slice(0, 200));
      await n.context().close();
      // Es del Laboratorio («Solo yo» al nacer): una cuenta normal no lo ve
      const u = await pagina("iconos-" + Date.now() + "@prueba.mx"); await nuevoTour(u, "Sin iconos");
      await u.click('#subtabs button:has-text("Capas")'); await u.waitForTimeout(1500); await pasarGuias(u);
      await u.click("#add-hs"); await u.waitForTimeout(600); await pasarGuias(u);
      exige(!(await u.$(".anim-op")), "una cuenta normal ya ve los íconos animados (deben nacer en el Laboratorio)");
      await u.context().close();
    });
    // Pedido de Amar (nov 2026): «que no se sienta invasivo como Photoshop». Cada grupo de Propiedades tiene su flechita.
    // Segundo pedido (10 nov): «todo cerrado no invita a usar la app»: todo sale abierto y tú cierras lo que no usas.
    await paso("Edición limpia: todo sale abierto, cada grupo se cierra con su flechita y se recuerda; «Agregar» esconde los botones", async () => {
      const n = await pagina(DUENO, { limpio: true }); await nuevoTour(n, "Edicion limpia");
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1500); await pasarGuias(n);
      exige(await n.isVisible("#agregar-abrir") && await n.isVisible("#add-hs"), "«Agregar» y sus botones no se ven de inicio");
      await n.click("#add-hs"); await n.waitForTimeout(700); await pasarGuias(n);
      exige(await n.isVisible("#add-hs") && await n.isVisible("#add-lote"), "al elegir el hotspot los botones de agregar se escondieron");
      const abiertos = () => n.$$eval("#props > .grupo.acor.abierto", (gs) => gs.map((g) => g.dataset.acor));
      const titulos = await n.$$eval("#props > .grupo.acor", (gs) => gs.map((g) => g.dataset.acor));
      for (const t of ["Hotspot", "Estilo", "Ícono animado", "Fijo en 3D", "Al hacer clic", "Orden"]) exige(titulos.includes(t), "falta el renglón «" + t + "» en Propiedades: " + titulos.join(", "));
      exige(JSON.stringify(await abiertos()) === JSON.stringify(titulos), "no salen todos los grupos abiertos: " + (await abiertos()).join(", "));
      exige(await n.isVisible('.anim-op[data-v="cocina"]') && await n.isVisible('[data-acc="eliminar"]'), "los íconos animados o Duplicar/Eliminar no se ven");
      exige((await n.textContent("#props-todo")).trim() === "Cerrar todo", "el botón de arriba no ofrece «Cerrar todo»");
      if (process.env.CAPTURAS) await n.screenshot({ path: path.join(process.env.CAPTURAS, "limpio-hotspot.png") });
      // La flechita cierra solo ese grupo; sigue cerrado aunque el panel se vuelva a pintar
      await n.click('#props .acor-btn:has-text("Ícono animado")'); await n.waitForTimeout(300);
      exige(!(await abiertos()).includes("Ícono animado") && (await abiertos()).length === titulos.length - 1, "la flechita no cerró solo «Ícono animado»: " + (await abiertos()).join(", "));
      exige(!(await n.isVisible('.anim-op[data-v="cocina"]')), "el grupo cerrado se sigue viendo");
      await n.click('#props .hs-estilo >> nth=1'); await n.waitForTimeout(700);
      exige(!(await abiertos()).includes("Ícono animado") && (await abiertos()).includes("Estilo"), "al cambiar el estilo se volvió a abrir el grupo cerrado");
      // Otro hotspot: lo que cerraste sigue cerrado
      await n.click("#add-hs"); await n.waitForTimeout(900); await pasarGuias(n);
      exige((await n.$$("#lista li[data-id]")).length === 2 && !(await abiertos()).includes("Ícono animado") && (await abiertos()).includes("Al hacer clic"), "el segundo hotspot no recordó lo cerrado: " + (await abiertos()).join(", "));
      // «Cerrar todo» / «Abrir todo»
      await n.click("#props-todo"); await n.waitForTimeout(300);
      exige((await abiertos()).length === 0 && (await n.textContent("#props-todo")).trim() === "Abrir todo", "«Cerrar todo» no cerró todo");
      exige(await n.isVisible('#props input[data-k="nombre"]') && await n.isVisible('[data-acc="eliminar"]'), "con todo cerrado el nombre o Duplicar/Eliminar no quedaron a la vista");
      await n.click("#props-todo"); await n.waitForTimeout(300);
      exige((await abiertos()).length === titulos.length, "«Abrir todo» no abrió todo");
      // «Agregar» esconde los botones y se recuerda al volver a entrar
      await n.click('#props .acor-btn:has-text("Orden")'); await n.waitForTimeout(200);
      await n.click("#agregar-abrir"); await n.waitForTimeout(300);
      exige(!(await n.isVisible("#add-hs")), "«Agregar» no escondió los botones");
      await n.reload(); await n.waitForTimeout(3000); await cerrarAnuncio(n);
      await n.click('#nav button:has-text("Panoramas")').catch(() => {}); await n.waitForTimeout(500);
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1500); await pasarGuias(n);
      exige(await n.isVisible("#agregar-abrir") && !(await n.isVisible("#add-hs")), "los botones escondidos no se recordaron");
      await n.click("#lista li[data-id]"); await n.waitForTimeout(500);
      exige(!(await abiertos()).includes("Orden") && (await abiertos()).includes("Estilo"), "lo cerrado no se recordó al volver a entrar: " + (await abiertos()).join(", "));
      await n.click("#agregar-abrir"); await n.waitForTimeout(300);
      exige(await n.isVisible("#add-hs"), "«Agregar» no volvió a mostrar los botones");
      // Una manzana: todo abierto, con la ayuda «?» en su renglón
      await dibujarManzana(n, [[500, 640], [740, 625], [980, 640]], [[480, 820], [1000, 820]]);
      await n.click('#lista li:has-text("Manzana 1")'); await n.waitForTimeout(600);
      const tm = await n.$$eval("#props > .grupo.acor", (gs) => gs.map((g) => g.dataset.acor));
      exige(tm.includes("Lotes de la manzana") && JSON.stringify(await abiertos()) === JSON.stringify(tm) && await n.isVisible('#props .acor-fila [data-guia-ayuda="manzana"]'), "la manzana no sale toda abierta con su ayuda: " + (await abiertos()).join(", "));
      exige(await n.isVisible("#add-manzana"), "después de dibujar la manzana se escondieron los botones");
      if (process.env.CAPTURAS) await n.screenshot({ path: path.join(process.env.CAPTURAS, "limpio-manzana.png") });
      exige(!n.errs.length, "errores en el estudio: " + n.errs.join(" | ").slice(0, 200));
      await n.context().close();
      // Es del Laboratorio («Solo yo» al nacer): una cuenta normal sigue con la vista de siempre
      const u = await pagina("limpio-" + Date.now() + "@prueba.mx", { limpio: true }); await nuevoTour(u, "Sin limpia");
      await u.click('#subtabs button:has-text("Capas")'); await u.waitForTimeout(1500); await pasarGuias(u);
      await u.click("#add-hs"); await u.waitForTimeout(600); await pasarGuias(u);
      exige(!(await u.isVisible("#agregar-abrir")) && !(await u.isVisible("#props-todo")) && !(await u.$("#props > .grupo.acor")) && await u.isVisible("#add-lote"), "una cuenta normal ya ve la edición limpia (debe nacer en el Laboratorio)");
      await u.context().close();
    });
    // Pedido de Amar (10 nov 2026): «ya puse un chingo de puntos en dos esferas y no sé dónde duplicar las manzanas».
    // Una manzana pasa completa, con sus lotes, a las demás esferas del terreno; en Terreno un botón pasa todas las de la
    // Base; «Duplicar» en una manzana hace otra igual a un lado. Nace en el Laboratorio («manzanas-esferas»).
    await paso("Manzanas en todas las esferas: pasa con sus lotes, el botón de Terreno pasa todas y Duplicar hace otra", async () => {
      const n = await pagina(DUENO); await nuevoTour(n, "Manzanas terreno");
      // Segunda esfera del mismo terreno: la misma foto, así cada punto cae en el mismo lugar de las dos
      await n.evaluate(async () => {
        const cv = document.createElement("canvas"); cv.width = 4096; cv.height = 2048; const x = cv.getContext("2d");
        x.fillStyle = "#7ab"; x.fillRect(0, 0, 4096, 1024); x.fillStyle = "#6a5"; x.fillRect(0, 1024, 4096, 1024);
        const bl = await new Promise((o) => cv.toBlob(o, "image/jpeg", 0.85));
        const inp = document.querySelector("#subir-zona input[type=file]"); const dt = new DataTransfer(); dt.items.add(new File([bl], "campo-2.jpg", { type: "image/jpeg" }));
        inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true }));
      });
      for (let i = 0; i < 45; i++) { await n.waitForTimeout(1000); if ((await n.$$("#pano-lista [data-abrir]")).length >= 2) break; }
      exige((await n.$$("#pano-lista [data-abrir]")).length >= 2, "la segunda esfera no terminó de subir");
      await n.waitForTimeout(1500);
      // Terreno: las dos esferas y 4 puntos en el suelo
      await n.click('#subtabs button:has-text("Terreno")'); await n.waitForTimeout(1500); await pasarGuias(n);
      for (let i = 0; i < 2; i++) { const v = await n.$eval("#tr-agregar", (x) => x.options[1].value); await n.selectOption("#tr-agregar", v); await n.waitForTimeout(1500); }
      const A = await n.locator("#tr-stage-a").boundingBox(), B = await n.locator("#tr-stage-b").boundingBox();
      for (const [fx, fy] of [[0.2, 0.72], [0.8, 0.72], [0.7, 0.84], [0.3, 0.84]]) { // arriba del aviso de abajo (tapa los clics)
        await n.mouse.click(A.x + A.width * fx, A.y + A.height * fy); await n.waitForTimeout(400);
        await n.mouse.click(B.x + B.width * fx, B.y + B.height * fy); await n.waitForTimeout(600);
      }
      if (process.env.CAPTURAS) await n.screenshot({ path: path.join(process.env.CAPTURAS, "manzana-terreno.png") });
      exige(/4 puntos/.test(await n.textContent("#tr-prec")), "el terreno no quedó con 4 puntos: " + (await n.textContent("#tr-prec")) + " · " + (await n.textContent("#tr-panel")).replace(/\s+/g, " ").slice(0, 200));
      // Capas, esfera 1: una manzana y «Aplicar a todas las esferas»
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1500); await pasarGuias(n);
      await n.click("#panos-tira li:nth-child(1)"); await n.waitForTimeout(1200);
      await dibujarManzana(n, [[500, 640], [740, 625], [980, 640]], [[480, 820], [1000, 820]]);
      await n.click('#lista li:has-text("Manzana 1")'); await n.waitForTimeout(600);
      const nLotes = (await lotes(n)).length;
      exige(nLotes >= 5, "la manzana no hizo sus lotes: " + nLotes);
      exige(await n.isVisible('#props input[data-k="_vinculo"]'), "la manzana no ofrece «Aplicar a todas las esferas»");
      await n.click('#props .interruptor:has(input[data-k="_vinculo"])'); await n.waitForTimeout(900);
      exige(await n.$eval('#props input[data-k="_vinculo"]', (x) => x.checked), "no se prendió «Aplicar a todas las esferas»");
      // Esfera 2: la manzana con todos sus lotes, con los mismos números
      await n.click("#panos-tira li:nth-child(2)"); await n.waitForTimeout(1500);
      exige((await capas(n)).some((t) => /^Manzana 1/.test(t)) && (await lotes(n)).length === nLotes, "la manzana no llegó con sus lotes a la otra esfera: " + (await capas(n)).join(", "));
      if (process.env.CAPTURAS) await n.screenshot({ path: path.join(process.env.CAPTURAS, "manzana-otra-esfera.png") });
      // Un lote de la copia: dice que viaja con su manzana
      await n.click('#lista li:has-text("Lote 1")'); await n.waitForTimeout(500);
      exige(/con su manzana/.test(await n.textContent("#props")), "el lote de la copia no explica que viaja con su manzana");
      // Duplicar en la esfera 1: Manzana 2 con sus lotes nuevos
      await n.click("#panos-tira li:nth-child(1)"); await n.waitForTimeout(1500);
      await n.click('#lista li:has-text("Manzana 1")'); await n.waitForTimeout(500);
      await n.click('#props [data-acc="duplicar"]'); await n.waitForTimeout(900);
      exige((await capas(n)).some((t) => /^Manzana 2/.test(t)) && (await lotes(n)).length === 2 * nLotes, "Duplicar no hizo la Manzana 2 con sus lotes: " + (await capas(n)).join(", "));
      // Terreno: el botón pasa la Manzana 2 a la otra esfera
      await n.click('#subtabs button:has-text("Terreno")'); await n.waitForTimeout(1500);
      exige(/1 manzana/.test(await n.textContent('[data-tr="pasar"]')), "el botón de Terreno no ofrece pasar la Manzana 2");
      await n.click('[data-tr="pasar"]'); await n.waitForTimeout(900);
      exige(!(await n.$('[data-tr="pasar"]')) && /2 manzanas/.test(await n.textContent("#tr-panel")), "el botón no pasó la manzana: " + (await n.textContent("#tr-panel")).slice(0, 300));
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1500);
      await n.click("#panos-tira li:nth-child(2)"); await n.waitForTimeout(1500);
      exige((await capas(n)).some((t) => /^Manzana 2/.test(t)) && (await lotes(n)).length === 2 * nLotes, "la Manzana 2 no llegó a la otra esfera: " + (await capas(n)).join(", "));
      // Quitarla de las demás esferas: se van la manzana y sus lotes
      await n.click("#panos-tira li:nth-child(1)"); await n.waitForTimeout(1500);
      await n.click('#lista li:has-text("Manzana 1")'); await n.waitForTimeout(500);
      await n.click('#props .interruptor:has(input[data-k="_vinculo"])'); await n.waitForTimeout(900);
      await n.click("#panos-tira li:nth-child(2)"); await n.waitForTimeout(1500);
      exige(!(await capas(n)).some((t) => /^Manzana 1/.test(t)) && (await lotes(n)).length === nLotes, "al apagarlo no se quitaron la manzana y sus lotes de la otra esfera: " + (await capas(n)).join(", "));
      exige(!n.errs.length, "errores en el estudio: " + n.errs.join(" | ").slice(0, 200));
      await n.context().close();
      // Cuenta normal: la manzana no ofrece pasarse (sus lotes no viajaban) y Duplicar sigue diciendo que no
      const u = await pagina("mzesf-" + Date.now() + "@prueba.mx"); await nuevoTour(u, "Sin manzanas esferas");
      await u.click('#subtabs button:has-text("Capas")'); await u.waitForTimeout(1500); await pasarGuias(u);
      await dibujarManzana(u, [[500, 640], [740, 625], [980, 640]], [[480, 820], [1000, 820]]);
      await u.click('#lista li:has-text("Manzana 1")'); await u.waitForTimeout(600);
      exige(!(await u.$('#props input[data-k="_vinculo"]')), "una cuenta normal ya ve «Aplicar a todas las esferas» en una manzana (debe nacer en el Laboratorio)");
      await u.context().close();
    });
    // Pedido de Amar (nov 2026): correo de bienvenida a cada cuenta nueva y las actualizaciones también por correo,
    // solo a quien quiera recibirlas (link para darse de baja). Cloudflare Email Service; aquí el envío es simulado
    // y wrangler deja cada correo en su registro (De, Para, Asunto y el archivo con el HTML).
    await paso("Correos: bienvenida (se prende en el panel), novedad por correo una vez y link para darse de baja", async () => {
      const LOG = path.join(DATOS, "worker-estudio.log"), registro = () => fs.readFileSync(LOG, "utf8");
      const correosA = (para) => registro().split("send_email binding called").slice(1).filter((b) => b.includes("To: " + para));
      const htmlDe = (bloque) => { const m = bloque.match(/HTML: (\S+\.html)/); return m ? fs.readFileSync(m[1], "utf8") : ""; };
      const n = await pagina(DUENO);
      const api = (url, op) => n.evaluate(([u, o]) => fetch(u, o).then(async (r) => ({ s: r.status, d: await r.json().catch(() => ({})) })), [url, op || {}]);
      const ini = await api("api/admin/correos");
      exige(ini.s === 200 && ini.d.activo && ini.d.conf.bienvenida === false, "los correos no están listos o la bienvenida no nace apagada: " + JSON.stringify(ini.d));
      // Apagada: una cuenta nueva no recibe nada
      const c1 = "sin-bienvenida-" + Date.now() + "@prueba.mx";
      await (await pagina(c1)).context().close();
      exige(correosA(c1).length === 0, "con la bienvenida apagada igual se mandó");
      // Se prende desde el panel de dueño → Actualizaciones
      await n.click('#nav button:has-text("Mis Tours")'); await n.waitForTimeout(800); await pasarGuias(n);
      await n.click("#ver-cuentas"); await n.waitForTimeout(1200);
      await n.click('[data-dueno="novedades"]'); await n.waitForTimeout(1200);
      exige(await n.isVisible(".cor-caja") && /de 3,000 incluidos/.test(await n.textContent(".cor-caja")), "no se ve la caja de correos con lo que va del mes");
      if (process.env.CAPTURAS) await n.screenshot({ path: path.join(process.env.CAPTURAS, "correos-panel.png") });
      await n.click("[data-cor-bienvenida]"); await n.waitForTimeout(800);
      exige((await api("api/admin/correos")).d.conf.bienvenida === true, "el interruptor no prendió la bienvenida");
      const c2 = "bienvenida-" + Date.now() + "@prueba.mx";
      const u2 = await pagina(c2); await u2.context().close();
      const b2 = correosA(c2);
      exige(b2.length === 1 && /From: "Mozari" <hola@mozari\.app>/.test(b2[0]) && /Subject: .*bienvenido a Mozari/.test(b2[0]), "a la cuenta nueva no le llegó la bienvenida de hola@mozari.app: " + (b2[0] || "").slice(0, 200));
      const h2 = htmlDe(b2[0]);
      exige(/Tu primer tour, en 3 pasos/.test(h2) && /cuenta de prueba/.test(h2) && !/gratis/i.test(h2), "el correo de bienvenida no trae su contenido (o dice «gratis»)");
      await (await pagina(c2)).context().close();
      exige(correosA(c2).length === 1, "al volver a entrar le llegó otra bienvenida");
      // Prueba al dueño
      await n.click("[data-cor-prueba]"); await n.waitForTimeout(1500);
      exige(correosA(DUENO).some((b) => /Subject: \[Prueba\]/.test(b)), "«Mandarme la bienvenida» no le llegó al dueño");
      // Una actualización publicada, por correo: a quien la recibe, una sola vez y con su link de baja
      const nv = (await api("api/admin/novedades", { method: "POST" })).d.novedad;
      await api("api/admin/novedades/" + nv.id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ titulo: "Lotes desde un KMZ", texto: "Sube el KMZ de Google Earth\nMozari lee número, manzana y superficie", activa: true }) });
      const cuantos = (await api("api/admin/novedades/" + nv.id + "/correo")).d.cuantos;
      exige(cuantos >= 3, "no cuenta a quién le llega la novedad: " + cuantos);
      await n.click('[data-dueno="novedades"]'); await n.waitForTimeout(900);
      await n.click('[data-nf-editar="' + nv.id + '"]'); await n.waitForTimeout(900);
      await n.click("[data-nf-correo]"); await n.waitForTimeout(4000); // confirma solo (las pruebas aceptan los avisos)
      const env = (await api("api/admin/novedades/" + nv.id + "/correo")).d.correo;
      exige(env && env.total === cuantos && env.enviados === Math.min(cuantos, 40) && env.faltan === cuantos - env.enviados, "la novedad no se mandó por correo (o no por tandas): " + JSON.stringify(env));
      exige((await api("api/admin/novedades/" + nv.id + "/correo", { method: "POST" })).s === 409, "se pudo mandar dos veces la misma novedad");
      const nc = correosA(c2).find((b) => /Subject: Mozari · Lotes desde un KMZ/.test(b));
      if (cuantos <= 40) exige(nc, "la novedad no le llegó a la cuenta nueva");
      if (nc) {
        const hn = htmlDe(nc), baja = (hn.match(/href="([^"]*\/baja\?t=[^"]+)"/) || [])[1];
        exige(/Sube el KMZ de Google Earth/.test(hn) && baja, "el correo de la novedad no trae su texto o el link para darse de baja");
        // Darse de baja (sin sesión, desde el link del correo)
        const x = await pagina(null); await x.goto(baja.replace(/&amp;/g, "&")); await x.waitForTimeout(600);
        exige(/¿Ya no quieres recibir novedades\?/.test(await x.textContent("body")), "el link de baja no pregunta");
        await x.click("button"); await x.waitForTimeout(800);
        exige(/ya no te llegarán novedades/.test(await x.textContent("body")), "no se dio de baja");
        exige((await api("api/admin/novedades/" + nv.id + "/correo")).d.cuantos === cuantos - 1, "después de darse de baja sigue en la lista");
        await x.click("button"); await x.waitForTimeout(800);
        exige(/te volverán a llegar/.test(await x.textContent("body")) && (await api("api/admin/novedades/" + nv.id + "/correo")).d.cuantos === cuantos, "no pudo volver a recibirlas");
        await x.goto(ESTUDIO + "/baja?t=falso.123"); exige(/ya no sirve/.test(await x.textContent("body")), "un link falso no se rechaza");
        await x.context().close();
      }
      exige((await api("api/admin/correos")).d.mes >= 3, "no se cuentan los correos del mes");
      // Se queda apagada para lo demás de la revisión
      await api("api/admin/correos", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ bienvenida: false }) });
      await api("api/admin/novedades/" + nv.id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ activa: false }) });
      exige(!n.errs.length, "errores en el estudio: " + n.errs.join(" | ").slice(0, 200));
      await n.context().close();
    });
    // Pedido de Amar (nov 2026): «Ya salió Mozari» con el 30 % de la beta a sus exalumnos (lista de correos) y a quien
    // tiene cuenta de prueba. Cada quien su cupón de un solo uso; a quien ya pagó no le llega; link de baja sin cuenta.
    await paso("Correo con descuento: lista + cuentas de prueba, cupón personal, no a quien pagó, y baja sin cuenta", async () => {
      const LOG = path.join(DATOS, "worker-estudio.log"), registro = () => fs.readFileSync(LOG, "utf8");
      const correosA = (para) => registro().split("send_email binding called").slice(1).filter((b) => b.includes("To: " + para));
      const htmlDe = (bloque) => { const m = bloque.match(/HTML: (\S+\.html)/); return m ? fs.readFileSync(m[1], "utf8") : ""; };
      const n = await pagina(DUENO);
      const api = (url, op) => n.evaluate(([u, o]) => fetch(u, o).then(async (r) => ({ s: r.status, d: await r.json().catch(() => ({})) })), [url, op || {}]);
      const pon = (o) => ({ method: o.m || "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o.b || {}) });
      // Una cuenta de prueba y una que ya pagó (Pro)
      const prueba = "camp-prueba-" + Date.now() + "@prueba.mx", pago = "camp-pro-" + Date.now() + "@prueba.mx";
      await (await pagina(prueba)).context().close(); await (await pagina(pago)).context().close();
      const cs = (await api("api/admin/cuentas")).d.cuentas, cPro = cs.find((c) => c.email === pago);
      exige((await api("api/admin/cuentas/" + cPro.uid, pon({ m: "PUT", b: { plan: "pro" } }))).s === 200, "no se pudo poner en Pro");
      const ext1 = "exalumno-" + Date.now() + "@ejemplo.com", ext2 = "colega-" + Date.now() + "@ejemplo.com";
      // Desde el panel: Preparar con la lista pegada como venga (con nombres, comas, renglones)
      await n.click('#nav button:has-text("Mis Tours")'); await n.waitForTimeout(800); await pasarGuias(n);
      await n.click("#ver-cuentas"); await n.waitForTimeout(1200);
      await n.click('[data-dueno="novedades"]'); await n.waitForTimeout(1200);
      await n.click("[data-camp-nueva]"); await n.waitForTimeout(500);
      await n.fill('[data-cf="correos"]', "Ana López <" + ext1 + ">\n" + ext2.toUpperCase() + ", " + pago + "\n" + ext1);
      await n.click("[data-camp-preparar]"); await n.waitForTimeout(2500);
      const lista = (await api("api/admin/campanas")).d.campanas, k = lista[0];
      exige(k && k.estado === "borrador" && k.pct === 30 && k.cuenta.lista === 2 && k.cuenta.yaPagaron >= 1 && k.cuenta.usuarios >= 2, "la campaña no cuenta bien a quién le llega: " + JSON.stringify(k && k.cuenta));
      exige(await n.isVisible('[data-camp-id="' + k.id + '"] [data-camp-enviar]'), "no sale el botón para mandarla");
      if (process.env.CAPTURAS) await n.screenshot({ path: path.join(process.env.CAPTURAS, "campana-panel.png") });
      // Prueba al dueño: link de ejemplo, sin crear cupones
      const cupAntes = (await api("api/admin/cupones")).d.cupones.length;
      await n.click('[data-camp-id="' + k.id + '"] [data-camp-prueba]'); await n.waitForTimeout(1500);
      const pr = correosA(DUENO).filter((b) => /Subject: \[Prueba\] .*salió Mozari/.test(b));
      exige(pr.length && /AL-EJEMPLO/.test(htmlDe(pr[pr.length - 1])) && (await api("api/admin/cupones")).d.cupones.length === cupAntes, "la prueba no llegó al dueño o creó cupones");
      // Mandar: cada quien su cupón; al que pagó no
      await n.click('[data-camp-id="' + k.id + '"] [data-camp-enviar]'); await n.waitForTimeout(5000);
      const k2 = (await api("api/admin/campanas")).d.campanas.find((x) => x.id === k.id);
      exige(k2.estado !== "borrador" && k2.envio && k2.envio.enviados >= 3, "la campaña no se mandó: " + JSON.stringify(k2));
      const m1 = correosA(ext1), m2 = correosA(ext2), mp = correosA(prueba);
      exige(m1.length === 1 && m2.length === 1 && mp.length >= 1 && correosA(pago).filter((b) => /salió Mozari/.test(b)).length === 0, "no le llegó a la lista y a la cuenta de prueba, o le llegó al que pagó");
      const h1 = htmlDe(m1[0]), c1 = (h1.match(/entrar\?cupon=(AL-[A-Z0-9]+)/) || [])[1], c2 = (htmlDe(m2[0]).match(/entrar\?cupon=(AL-[A-Z0-9]+)/) || [])[1];
      exige(c1 && c2 && c1 !== c2 && /30 % de descuento/.test(h1) && !/gratis/i.test(h1), "cada correo no trae su propio cupón del 30 %");
      const cup = (await api("api/admin/cupones")).d.cupones.find((x) => x.codigo === c1);
      exige(cup && cup.pct === 30 && cup.max === 1 && cup.nota === ext1 && cup.planes.join() === "pro,desarrollos" && /2026-12-1[56]/.test(cup.vence || ""), "el cupón no es de un solo uso, 30 % y con su correo: " + JSON.stringify(cup));
      exige((await api("api/admin/campanas/" + k.id + "/enviar", { method: "POST" })).s === 409, "se pudo mandar dos veces");
      // Baja sin cuenta: ya no recibe la siguiente campaña
      const baja = (h1.match(/href="([^"]*\/baja\?t=[^"]+)"/) || [])[1];
      const x = await pagina(null); await x.goto(baja.replace(/&amp;/g, "&")); await x.waitForTimeout(600);
      exige(/¿Ya no quieres recibir correos de Mozari\?/.test(await x.textContent("body")), "el link de baja de la lista no pregunta");
      await x.click("button"); await x.waitForTimeout(800); await x.context().close();
      const k3 = (await api("api/admin/campanas", pon({ b: { correos: ext1 + " " + ext2, usuarios: false, vence: "2026-12-20" } }))).d.campana;
      await api("api/admin/campanas/" + k3.id + "/enviar", { method: "POST" }); await n.waitForTimeout(1500);
      exige(correosA(ext1).length === 1 && correosA(ext2).length === 2, "quien se dio de baja recibió otra campaña (o el otro no)");
      exige(!n.errs.length, "errores en el estudio: " + n.errs.join(" | ").slice(0, 200));
      await n.context().close();
    });
    // Pedido de Amar (nov 2026, video de Loom): poner una imagen (el plano de CAD, unas manzanas) en la esfera, que crezca
    // sin deformarse y se acueste sobre el terreno con Inclinar. Nace en el Laboratorio.
    await paso("Imagen en 3D: un PNG transparente pegado a la esfera, crece sin deformarse y se inclina sobre el terreno", async () => {
      const hoja = await navegador.newPage({ viewport: { width: 800, height: 400 } });
      await hoja.setContent('<!doctype html><html><body style="margin:0;background:transparent"><svg width="800" height="400" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#ffffff" stroke-width="6"><rect x="40" y="40" width="340" height="320"/><rect x="420" y="40" width="340" height="320"/><path d="M210 40v320M590 40v320M40 200h340M420 200h340"/></g></svg></body></html>');
      const png = path.join(DATOS, "manzanas.png"); await hoja.screenshot({ path: png, omitBackground: true }); await hoja.close();
      const n = await pagina(DUENO); await nuevoTour(n, "Imagen 3D");
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1500); await pasarGuias(n);
      exige(await n.isVisible("#add-img"), "no sale el botón «Imagen 3D» en Capas");
      await n.setInputFiles("#add-img-archivo", png); await n.waitForTimeout(3000);
      const id = await idTour(n), leer = () => n.evaluate((id) => fetch("api/tours/" + id).then((x) => x.json()), id);
      let c = Object.values((await leer()).capas).flat().find((x) => x.tipo === "imagen");
      exige(c && /^archivos\/capa-.*\.png$/.test(c.foto) && Math.abs(c.proporcion - 0.5) < 0.01 && c.tamano === 320, "no se creó la capa de imagen (PNG, proporción 2:1): " + JSON.stringify(c));
      await n.waitForFunction(() => { const e = document.querySelector(".capas .cp-img"); return e && e.complete; }, null, { timeout: 8000 }).catch(() => {});
      const caja = () => n.$eval(".capas .cp-img", (e) => ({ w: e.offsetWidth, h: e.offsetHeight, cargada: e.complete && e.naturalWidth > 0, src: e.getAttribute("src"), tr: e.closest(".cp").style.transform.slice(-60) }));
      let b = await caja();
      exige(b.cargada && b.w === 800 && b.h === 400, "la imagen no se ve o no guarda su proporción: " + JSON.stringify(b) + " | " + (await n.$eval(".capas .cp-img", (e) => e.outerHTML.slice(0, 200))) + " | " + JSON.stringify(c));
      exige(await n.$('.asas [data-h="escala"]') && !(await n.$('.asas [data-h="ancho"]')) && !(await n.$('.asas [data-h="alto"]')), "la imagen tiene asas para deformarla (solo debe crecer y rotar)");
      // Tamaño desde Propiedades (sigue sin deformarse) e Inclinar para acostarla sobre el terreno
      await n.$eval('input[type=range][data-k="tamano"]', (e) => { e.value = "600"; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); });
      await n.$eval('input[type=range][data-k="t3d.inclinar"]', (e) => { e.value = "60"; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); });
      await n.waitForTimeout(1500);
      b = await caja();
      exige(b.w === 1500 && b.h === 750 && /rotateX\(60deg\)/.test(b.tr), "no creció parejo o no se inclinó: " + JSON.stringify(b));
      c = Object.values((await leer()).capas).flat().find((x) => x.tipo === "imagen");
      exige(c.tamano === 600 && c.t3d && c.t3d.inclinar === 60, "no se guardó el tamaño o la inclinación: " + JSON.stringify({ t: c.tamano, t3d: c.t3d }));
      if (process.env.CAPTURAS) await n.screenshot({ path: path.join(process.env.CAPTURAS, "imagen3d.png") });
      // En la vista previa (como en el tour) se ve, y no tapa los clics de lo que tenga abajo
      await n.click('button:has-text("Vista previa")'); await n.waitForTimeout(3500);
      const pv = await n.$eval("#previa .cp-img", (e) => ({ ok: e.complete && e.naturalWidth > 0, pe: getComputedStyle(e).pointerEvents }));
      exige(pv.ok && pv.pe === "none", "en la vista previa la imagen no se ve o tapa los clics: " + JSON.stringify(pv));
      await n.keyboard.press("Escape"); await n.waitForTimeout(500);
      exige(!n.errs.length, "errores en el estudio: " + n.errs.join(" | ").slice(0, 200));
      await n.context().close();
      // Es del Laboratorio («Solo yo» al nacer)
      const u = await pagina("img3d-" + Date.now() + "@prueba.mx"); await nuevoTour(u, "Sin imagen");
      await u.click('#subtabs button:has-text("Capas")'); await u.waitForTimeout(1500); await pasarGuias(u);
      exige(!(await u.isVisible("#add-img")), "una cuenta normal ya ve «Imagen 3D» (debe nacer en el Laboratorio)");
      await u.context().close();
    });
    // Pedido de Amar (nov 2026): un apartado en mozari.app con tours hechos con Mozari. Los elige él en su panel
    // (solo los de clientes que le dieron permiso); si no hay ninguno, la sección no aparece.
    await paso("Tours hechos con Mozari: el dueño elige tours publicados y salen en el sitio con portada y link", async () => {
      exige((await a.evaluate((id) => fetch("api/tours/" + id + "/publicar", { method: "POST" }).then((r) => r.status), tour)) === 200, "no se pudo publicar el tour de prueba");
      const n = await pagina(DUENO);
      const api = (url, op) => n.evaluate(([u, o]) => fetch(u, o).then(async (r) => ({ s: r.status, d: await r.json().catch(() => ({})) })), [url, op || {}]);
      await api("api/admin/galeria", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ tours: [] }) });
      const x = await pagina(null);
      await x.goto(ESTUDIO + "/"); await x.waitForTimeout(1500);
      exige(!(await x.isVisible("#tours")), "sin tours elegidos la sección se ve vacía");
      // Panel de dueño → Tours en la web: agregar el tour, ponerle nombre y lugar
      await n.click('#nav button:has-text("Mis Tours")'); await n.waitForTimeout(800); await pasarGuias(n);
      await n.click("#ver-cuentas"); await n.waitForTimeout(1200);
      await n.click('[data-dueno="galeria"]'); await n.waitForTimeout(1500);
      exige(await n.isVisible('[data-gal-libre="' + tour + '"]'), "el tour publicado no sale para elegirlo");
      await n.click('[data-gal-libre="' + tour + '"] [data-gal-agregar]'); await n.waitForTimeout(1200);
      await n.fill('[data-gal-id="' + tour + '"] [data-gal-titulo]', "Desarrollo de prueba"); await n.press('[data-gal-id="' + tour + '"] [data-gal-titulo]', "Tab"); await n.waitForTimeout(800);
      await n.fill('[data-gal-id="' + tour + '"] [data-gal-lugar]', "León, Guanajuato"); await n.press('[data-gal-id="' + tour + '"] [data-gal-lugar]', "Tab"); await n.waitForTimeout(1000);
      if (process.env.CAPTURAS) await n.screenshot({ path: path.join(process.env.CAPTURAS, "galeria-panel.png") });
      const g = await x.evaluate(() => fetch("/galeria.json", { cache: "no-store" }).then((r) => r.json()));
      const t = g.tours[0];
      exige(g.tours.length === 1 && t.titulo === "Desarrollo de prueba" && t.lugar === "León, Guanajuato" && t.url === TOURS + "/" + tour + "/" && /\/escenas\/.+\.jpg$|archivos\//.test(t.portada), "la lista pública no trae el tour con su nombre, lugar, link y portada: " + JSON.stringify(g));
      exige((await x.request.get(t.portada)).status() === 200, "la portada del tour no se puede ver sin sesión");
      // El sitio lo muestra
      await x.goto(ESTUDIO + "/"); await x.waitForTimeout(2000);
      exige(await x.isVisible("#tours") && (await x.$$("#tours .tour-card")).length === 1 && /Desarrollo de prueba/.test(await x.textContent("#tours")) && await x.$('nav.links a[href="#tours"]'), "el sitio no muestra el tour en «Tours hechos con Mozari»");
      exige((await x.getAttribute("#tours .tour-card", "href")) === t.url, "la tarjeta no lleva al tour");
      if (process.env.CAPTURAS) { await x.$eval("#tours", (e) => e.scrollIntoView()); await x.waitForTimeout(800); await x.screenshot({ path: path.join(process.env.CAPTURAS, "galeria-web.png") }); }
      // Quitarlo: la sección desaparece
      await n.click('[data-gal-id="' + tour + '"] [data-gal-quitar]'); await n.waitForTimeout(1200);
      exige(((await x.evaluate(() => fetch("/galeria.json", { cache: "no-store" }).then((r) => r.json()))).tours || []).length === 0, "al quitarlo sigue en la web");
      exige(!n.errs.length && !x.errs.length, "errores: " + n.errs.concat(x.errs).join(" | ").slice(0, 200));
      await n.context().close(); await x.context().close();
    });
    // Pedido de Amar (nov 2026): la hoja «Ventas de Mozari» se actualiza sola (IMPORTDATA de un link con clave, sin correos)
    await paso("Ventas para Google Sheets: CSV con clave, sin correos, y sin clave no existe", async () => {
      const lk = await a.evaluate(() => fetch("api/admin/ventas-link").then((r) => r.json()));
      exige(/\/ventas\.csv\?k=[0-9a-f]{48}$/.test(lk.url || ""), "no da el link de ventas: " + JSON.stringify(lk));
      const lk2 = await a.evaluate(() => fetch("api/admin/ventas-link").then((r) => r.json()));
      exige(lk2.url === lk.url, "la clave cambia cada vez (la hoja dejaría de leerla)");
      const x = await pagina(null);
      const r = await x.request.get(lk.url), t = await r.text();
      exige(r.status() === 200 && /text\/csv/.test(r.headers()["content-type"]) && t.startsWith("Fecha,Cliente,ID cliente,Plan,Método,Moneda,Monto"), "el CSV no sale o no trae sus columnas: " + t.slice(0, 120));
      exige(!/@/.test(t), "el CSV trae correos");
      exige((await x.request.get(ESTUDIO + "/ventas.csv")).status() === 404 && (await x.request.get(ESTUDIO + "/ventas.csv?k=" + "0".repeat(48))).status() === 404, "sin la clave correcta igual se ven las ventas");
      await x.context().close();
    });
    // Pedido de Amar (nov 2026): los desarrollos suelen tener sus lotes en Google Earth (KMZ). Nace en el Laboratorio.
    await paso("Lotes desde un KMZ: dibuja el plano, lee número, manzana y superficie, y los coloca con 4 esquinas con su medida real", async () => {
      // Un KMZ de prueba como el de Google Earth: 2 manzanas de 6 lotes de 10 × 20 m, una calle, y el perímetro
      const lat0 = 21.1235, lon0 = -101.6801, mLat = 1 / 111195, mLon = 1 / (111195 * Math.cos((lat0 * Math.PI) / 180));
      const ll = (x, y) => (lon0 + x * mLon).toFixed(8) + "," + (lat0 + y * mLat).toFixed(8) + ",0";
      const rect = (x, y, w, h) => [ll(x, y), ll(x + w, y), ll(x + w, y + h), ll(x, y + h), ll(x, y)].join(" ");
      const pol = (nombre, coords, datos) => "<Placemark><name>" + nombre + "</name>" + (datos ? "<ExtendedData>" + Object.entries(datos).map(([k, v]) => '<Data name="' + k + '"><value>' + v + "</value></Data>").join("") + "</ExtendedData>" : "") +
        "<Polygon><outerBoundaryIs><LinearRing><coordinates>" + coords + "</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>";
      let m7 = "", m8 = "";
      for (let k = 0; k < 6; k++) { const x = (k % 3) * 10, y = k < 3 ? 0 : 20; m7 += pol("Lote " + (k + 1), rect(x, y, 10, 20)); }
      const nums8 = ["10", "11", "12A", "13", "14", "15"];
      for (let k = 0; k < 6; k++) { const x = 60 + (k % 3) * 10, y = k < 3 ? 0 : 20; m8 += pol("Polígono " + k, rect(x, y, 10, 20), Object.assign({ LOTE: nums8[k], MANZANA: "8" }, k === 1 ? { SUPERFICIE: "205.5" } : {})); }
      const kml = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Desarrollo</name>' +
        pol("Perímetro", rect(-15, -15, 120, 70)) + "<Folder><name>Manzana 7</name>" + m7 + "</Folder>" + m8 +
        "<Placemark><name>Calle</name><LineString><coordinates>" + ll(45, -10) + " " + ll(45, 50) + "</coordinates></LineString></Placemark></Document></kml>";
      // KMZ = ZIP con doc.kml comprimido (deflate), como lo exporta Google Earth
      const zlib = require("zlib"), crc32 = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
      const datos = Buffer.from(kml, "utf8"), comp = zlib.deflateRawSync(datos), nombre = Buffer.from("doc.kml");
      const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(8, 8); loc.writeUInt32LE(crc32(datos), 14); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(datos.length, 22); loc.writeUInt16LE(nombre.length, 26);
      const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(crc32(datos), 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(datos.length, 24); cen.writeUInt16LE(nombre.length, 28);
      const fin = Buffer.alloc(22), dirIni = 30 + nombre.length + comp.length; fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(1, 8); fin.writeUInt16LE(1, 10); fin.writeUInt32LE(46 + nombre.length, 12); fin.writeUInt32LE(dirIni, 16);
      const kmz = Buffer.concat([loc, nombre, comp, cen, nombre, fin]);
      const n = await pagina(DUENO); await nuevoTour(n, "Desde KMZ");
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1800);
      const st = await n.evaluate(() => { const e = [...document.querySelectorAll(".capas")].find((x) => x.getClientRects().length && x.getBoundingClientRect().width > 300); const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; });
      const [cx, cy] = [st[0] + st[2] / 2, st[1] + st[3] / 2];
      for (let i = 0; i < 4; i++) { await n.mouse.move(cx, cy + 250); await n.mouse.down(); for (let k = 1; k <= 10; k++) await n.mouse.move(cx, cy + 250 - k * 50); await n.mouse.up(); await n.waitForTimeout(300); }
      await n.click("#ref-boton"); await n.waitForTimeout(400);
      exige(/\.kmz/.test(await n.getAttribute("#ref-archivo2", "accept")) && /KMZ/.test(await n.textContent("#ref-subir-txt")), "el plano de referencia no acepta KMZ");
      await n.setInputFiles("#ref-archivo2", { name: "desarrollo.kmz", mimeType: "application/vnd.google-earth.kmz", buffer: kmz });
      let ancho = 0; for (let i = 0; i < 25 && !ancho; i++) { await n.waitForTimeout(600); ancho = await n.$eval("#ref-img", (e) => (e.hidden ? 0 : e.naturalWidth)); }
      exige(ancho > 1000, "el KMZ no se pudo ver como plano: " + (await n.textContent("#toast").catch(() => "")) + " · " + n.errs.join(" | ").slice(0, 300)); await n.waitForTimeout(800);
      exige(/Plano bueno/.test(await n.textContent("#ref-calidad")), "el KMZ no salió como plano bueno: " + (await n.textContent("#ref-calidad")));
      const alto = await n.$eval("#ref-img", (e) => e.naturalHeight);
      if (process.env.CAPTURAS) await n.screenshot({ path: path.join(process.env.CAPTURAS, "kmz-plano.png") });
      await n.evaluate(() => { const p = document.getElementById("ref-panel"); p.style.width = "560px"; p.style.height = "420px"; });
      await pasarGuias(n); await n.click("#ref-ajustar"); await n.click("#ref-lotes"); await n.waitForTimeout(500); await pasarGuias(n); await n.waitForTimeout(300);
      const aPant = (x, y) => n.evaluate(([x, y]) => { const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(document.getElementById("ref-lienzo").style.transform), v = document.getElementById("ref-vista").getBoundingClientRect(); return [v.x + +m[1] + x * +m[3], v.y + +m[2] + y * +m[3]]; }, [x, y]);
      // El terreno mide 120 m: la manzana 7 va de 15 a 45 m (de izquierda a derecha) y la 8 de 75 a 105 m
      const recuadro = async (a, b) => {
        const [ax, ay] = await aPant((a / 120) * ancho, alto * 0.05), [bx, by] = await aPant((b / 120) * ancho, alto * 0.95);
        await n.mouse.move(ax, ay); await n.mouse.down(); await n.mouse.move((ax + bx) / 2, (ay + by) / 2, { steps: 6 }); await n.mouse.move(bx, by, { steps: 6 }); await n.mouse.up();
        let info = ""; for (let i = 0; i < 20 && !/elegid|No /.test(info); i++) { await n.waitForTimeout(400); info = await n.textContent("#ref-lotes-info"); }
        return info;
      };
      const colocar = async () => {
        await n.evaluate(() => { const p = document.getElementById("ref-panel"); p.style.width = "300px"; p.style.height = "230px"; });
        await n.click("#ref-colocar"); await n.waitForTimeout(300);
        for (const [x, y] of [[0.4, 0.5], [0.9, 0.5], [0.9, 0.9], [0.4, 0.9]]) { await n.mouse.click(st[0] + st[2] * x, st[1] + st[3] * y); await n.waitForTimeout(250); }
        await n.waitForTimeout(2500);
      };
      let info = await recuadro(8, 52);
      exige(/^6 lotes elegidos/.test(info), "no salieron los 6 lotes de la manzana 7 (" + info + ")");
      exige(/Manzana 7, leída del plano/.test(info) && /números y las superficies salen del plano/.test(info), "no leyó la manzana (de la carpeta), los números o la superficie del KMZ: " + info);
      if (process.env.CAPTURAS) await n.screenshot({ path: path.join(process.env.CAPTURAS, "kmz-manzana.png") });
      await colocar();
      const id = await idTour(n), leer = () => n.evaluate((id) => fetch("api/tours/" + id).then((x) => x.json()), id);
      const deMz = async (mz) => Object.values((await leer()).capas).flat().filter((c) => c.lote && c.lote.manzana === mz);
      const l7 = await deMz("7");
      exige(l7.length === 6 && ["1", "2", "3", "4", "5", "6"].every((x) => l7.some((c) => c.lote.numero === x)), "los lotes de la manzana 7 no salieron con sus números del KMZ: " + l7.map((c) => c.lote.numero).join(","));
      exige(l7.every((c) => Math.abs(+c.lote.area - 200) < 1), "la superficie no salió de la medida real (200 m²): " + l7.map((c) => c.lote.area).join(","));
      exige(l7.every((c) => c.lote.lados.length === 4 && c.lote.lados.map(Number).sort((a, b) => a - b).every((v, i) => Math.abs(v - [10, 10, 20, 20][i]) < 0.2)), "las medidas de los lados no salieron reales (10 × 20 m): " + JSON.stringify(l7.map((c) => c.lote.lados)));
      // Manzana 8: los datos vienen en columnas (LOTE, MANZANA, SUPERFICIE), con un «12A»
      await n.keyboard.press("Escape"); await n.waitForTimeout(300);
      await n.evaluate(() => { const p = document.getElementById("ref-panel"); p.style.width = "560px"; p.style.height = "420px"; });
      await n.click("#ref-ajustar"); await n.waitForTimeout(300);
      info = await recuadro(68, 112);
      exige(/^6 lotes elegidos/.test(info) && /Manzana 8, leída del plano/.test(info), "la manzana 8 no salió con sus 6 lotes y su nombre: " + info);
      await colocar();
      const l8 = await deMz("8");
      exige(l8.length === 6 && l8.some((c) => c.lote.numero === "12-A") && l8.some((c) => c.lote.numero === "10"), "los lotes de la manzana 8 no salieron con los números de sus datos: " + l8.map((c) => c.lote.numero).join(","));
      exige(+l8.find((c) => c.lote.numero === "11").lote.area === 205.5, "la superficie escrita en el KMZ (205.5) no se respetó");
      exige(!Object.values((await leer()).capas).flat().some((c) => c.lote && Math.abs(+c.lote.area - 8400) < 50), "el perímetro del terreno salió como lote");
      exige(!n.errs.length, "errores en el estudio: " + n.errs.join(" | ").slice(0, 200));
      await n.context().close();
      // Es del Laboratorio («Solo yo» al nacer): una cuenta normal no puede subir KMZ
      const u = await pagina("kmz-" + Date.now() + "@prueba.mx");
      exige(!/kmz/.test((await u.getAttribute("#ref-archivo2", "accept")) || ""), "una cuenta normal ya puede subir KMZ (debe nacer en el Laboratorio)");
      await u.context().close();
    });
    await paso("Plano con textos: lee número, superficie y manzana; y el Excel de otra manzana avisa antes de importar", async () => {
      const n = await pagina(DUENO); await nuevoTour(n, "Plano con textos");
      await n.click('#subtabs button:has-text("Capas")'); await n.waitForTimeout(1800);
      const st = await n.evaluate(() => { const e = [...document.querySelectorAll(".capas")].find((x) => x.getClientRects().length && x.getBoundingClientRect().width > 300); const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; });
      const [cx, cy] = [st[0] + st[2] / 2, st[1] + st[3] / 2];
      for (let i = 0; i < 4; i++) { await n.mouse.move(cx, cy + 250); await n.mouse.down(); for (let k = 1; k <= 10; k++) await n.mouse.move(cx, cy + 250 - k * 50); await n.mouse.up(); await n.waitForTimeout(300); }
      // Manzana de 2 × 4 con el número y la superficie escritos (texto de verdad) dentro de cada lote, y «MZA XXX» arriba
      const L = (pts) => '<polyline fill="none" stroke="#000" stroke-width="1.5" points="' + pts.map((p) => p.join(",")).join(" ") + '"/>';
      const T = (x, y, t, tam) => '<text x="' + x + '" y="' + y + '" font-family="Arial" font-size="' + (tam || 9) + '" text-anchor="middle">' + t + "</text>";
      const nums = ["L-1", "L-2", "L-3A", "L-4", "L-5", "L-6", "L-7", "L-8"], sups = [1000, 1010.5, 1200, 1210, 990, 1005, 1499.99, 1500];
      let svg = '<svg width="800" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="500" fill="#fff"/>' +
        L([[100, 100], [700, 100], [700, 400], [100, 400], [100, 100]]) + L([[100, 250], [700, 250]]) + [250, 400, 550].map((x) => L([[x, 100], [x, 400]])).join("") + T(400, 80, "MZA XXX", 14);
      for (let k = 0; k < 8; k++) { const x = 175 + (k % 4) * 150, y = k < 4 ? 170 : 320; svg += T(x, y, nums[k]) + T(x, y + 14, "S=" + sups[k].toLocaleString("en-US", { minimumFractionDigits: 2 }) + "m2", 7); }
      svg += "</svg>";
      const hoja = await navegador.newPage(); await hoja.setContent('<!doctype html><html><body style="margin:0">' + svg + "</body></html>");
      const pdf = await hoja.pdf({ width: "800px", height: "500px", printBackground: true }); await hoja.close();
      await n.click("#ref-boton"); await n.waitForTimeout(400);
      await n.setInputFiles("#ref-archivo2", { name: "manzana-con-textos.pdf", mimeType: "application/pdf", buffer: pdf });
      let ancho = 0; for (let i = 0; i < 25 && !ancho; i++) { await n.waitForTimeout(600); ancho = await n.$eval("#ref-img", (e) => (e.hidden ? 0 : e.naturalWidth)); }
      exige(ancho > 500, "el PDF no se pudo ver"); await n.waitForTimeout(3000);
      exige(/Plano bueno/.test(await n.textContent("#ref-calidad")), "un PDF vectorial sencillo (una manzana) no salió como «Plano bueno»: " + (await n.textContent("#ref-calidad")));
      await n.evaluate(() => { const p = document.getElementById("ref-panel"); p.style.width = "560px"; p.style.height = "420px"; });
      await pasarGuias(n); await n.click("#ref-ajustar"); await n.click("#ref-lotes"); await n.waitForTimeout(500); await pasarGuias(n); await n.waitForTimeout(300);
      const aPant = (x, y) => n.evaluate(([x, y]) => { const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(document.getElementById("ref-lienzo").style.transform), v = document.getElementById("ref-vista").getBoundingClientRect(); return [v.x + +m[1] + x * +m[3], v.y + +m[2] + y * +m[3]]; }, [x, y]);
      const k = ancho / 800, [ax, ay] = await aPant(80 * k, 60 * k), [bx, by] = await aPant(720 * k, 420 * k);
      await n.mouse.move(ax, ay); await n.mouse.down(); await n.mouse.move((ax + bx) / 2, (ay + by) / 2, { steps: 6 }); await n.mouse.move(bx, by, { steps: 6 }); await n.mouse.up();
      let info = ""; for (let i = 0; i < 20 && !/elegid|No /.test(info); i++) { await n.waitForTimeout(400); info = await n.textContent("#ref-lotes-info"); }
      exige(/^8 lotes elegidos/.test(info), "no salieron los 8 lotes (" + info + ")");
      exige(/números y las superficies salen del plano/.test(info) && /Manzana 30, leída del plano/.test(info), "no leyó del plano los números, las superficies o la manzana: " + info);
      exige((await n.inputValue("#ref-mz")) === "30", "la manzana no quedó en 30 (leída de «MZA XXX»)");
      const vistos = await n.$$eval("#ref-sel text.num", (l) => l.map((e) => e.textContent));
      exige(vistos.includes("3-A") && vistos.includes("8"), "el plano no muestra los números leídos: " + vistos.join(","));
      if (process.env.CAPTURAS) await n.screenshot({ path: path.join(process.env.CAPTURAS, "plano-textos.png") });
      // Colocar la manzana: los lotes salen con el número y la superficie del plano
      await n.evaluate(() => { const p = document.getElementById("ref-panel"); p.style.width = "300px"; p.style.height = "230px"; });
      await n.click("#ref-colocar"); await n.waitForTimeout(300);
      for (const [x, y] of [[0.4, 0.5], [0.9, 0.5], [0.9, 0.9], [0.4, 0.9]]) { await n.mouse.click(st[0] + st[2] * x, st[1] + st[3] * y); await n.waitForTimeout(250); }
      await n.waitForTimeout(3000);
      const id = await idTour(n), leer = () => n.evaluate((id) => fetch("api/tours/" + id).then((x) => x.json()), id);
      const lotes = async () => Object.values((await leer()).capas).flat().filter((c) => c.lote && c.lote.manzana === "30");
      const ls = await lotes(), porNum = Object.fromEntries(ls.map((c) => [c.lote.numero, c.lote]));
      exige(ls.length === 8 && ["1", "2", "3-A", "4", "5", "6", "7", "8"].every((x) => porNum[x]), "los lotes no salieron con los números del plano: " + ls.map((c) => c.lote.numero).join(","));
      exige(+porNum["3-A"].area === 1200 && +porNum["7"].area === 1499.99, "los lotes no salieron con la superficie del plano: " + ls.map((c) => c.lote.numero + "=" + c.lote.area).join(", "));
      // Excel de otra manzana (superficies que no van): avisa y, si dices que no, no cambia nada
      await n.keyboard.press("Escape"); await n.waitForTimeout(300);
      await n.click('#subtabs button:has-text("Fichas técnicas")'); await n.waitForTimeout(1200); await pasarGuias(n);
      await n.evaluate(() => { window.__conf = []; window.confirm = (m) => { window.__conf.push(m); return window.__si === true; }; });
      const csv = (filas) => ({ name: "lotes.csv", mimeType: "text/csv", buffer: Buffer.from("Manzana,Lote,Superficie m2,Precio\n" + filas.map((f) => f.join(",")).join("\n")) });
      const otra = [[30, 1, 1757.75, 500000], [30, 2, 1428.38, 500000], [30, "3-A", 1050.21, 500000], [30, 4, 999.91, 500000], [30, 5, 2205.1, 500000], [30, 6, 1683.02, 500000], [30, 7, 1000.51, 500000], [30, 8, 6189.57, 500000]];
      await n.setInputFiles("#lx-archivo", csv(otra)); await n.waitForTimeout(1200);
      const conf1 = await n.evaluate(() => window.__conf.slice());
      exige(conf1.length === 1 && /no se parecen a los lotes dibujados/.test(conf1[0]), "con superficies de otra manzana no avisó: " + JSON.stringify(conf1));
      exige(+(await lotes()).find((c) => c.lote.numero === "1").lote.area === 1000 && !(await lotes()).some((c) => c.lote.precio), "dijo que no y aun así cambió los lotes");
      // Números recorridos (el Excel trae el 9 y lo dibujado el 8): también avisa
      await n.evaluate(() => (window.__conf = []));
      await n.setInputFiles("#lx-archivo", csv(sups.map((a, i) => [30, i === 2 ? "3A" : i === 7 ? 9 : i + 1, a, 750000]))); await n.waitForTimeout(1200);
      const conf2 = await n.evaluate(() => window.__conf.slice());
      exige(conf2.length === 1 && /recorridos/.test(conf2[0]) && /lote 9/i.test(conf2[0]), "con los números recorridos no avisó: " + JSON.stringify(conf2));
      // El Excel correcto (con «3A» escrito sin guion) entra sin preguntar
      await n.evaluate(() => (window.__conf = []));
      await n.setInputFiles("#lx-archivo", csv(sups.map((a, i) => [30, i === 2 ? "3A" : i + 1, a, 750000 + i]))); await n.waitForTimeout(1200);
      exige(!(await n.evaluate(() => window.__conf.length)), "con el Excel correcto preguntó de todos modos");
      const ls2 = await lotes();
      exige(ls2.every((c) => +c.lote.precio >= 750000) && +ls2.find((c) => c.lote.numero === "3-A").lote.precio === 750002, "el Excel correcto no llenó los precios (incluido el 3-A escrito «3A»)");
      // Lotes sin superficie (como los que se hicieron antes de leer el plano): se compara el tamaño dibujado en la esfera
      const d = await leer(); Object.values(d.capas).flat().forEach((c) => { if (c.lote && c.lote.manzana === "30") { c.lote.area = ""; c.lote.precio = ""; } });
      exige((await n.evaluate(([id, d]) => fetch("api/tours/" + id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(d) }).then((r) => r.status), [id, d])) === 200, "no se pudieron quitar las superficies");
      await n.goto(ESTUDIO + "/#t=" + id); await n.reload(); await n.waitForTimeout(2500); await cerrarAnuncio(n);
      await n.click('#nav button:has-text("Panoramas")'); await n.waitForTimeout(400); await n.click('#subtabs button:has-text("Fichas técnicas")'); await n.waitForTimeout(1200); await pasarGuias(n);
      await n.evaluate(() => { window.__conf = []; window.confirm = (m) => { window.__conf.push(m); return false; }; });
      await n.setInputFiles("#lx-archivo", csv(otra)); await n.waitForTimeout(1200);
      const conf3 = await n.evaluate(() => window.__conf.slice());
      exige(conf3.length === 1 && /no se parecen a los lotes dibujados/.test(conf3[0]), "sin superficies, el Excel de otra manzana no avisó: " + JSON.stringify(conf3));
      await n.evaluate(() => (window.__conf = []));
      await n.setInputFiles("#lx-archivo", csv(sups.map((a, i) => [30, i === 2 ? "3-A" : i + 1, a, 750000]))); await n.waitForTimeout(1200);
      exige(!(await n.evaluate(() => window.__conf.length)), "sin superficies, el Excel correcto preguntó de todos modos");
      exige((await lotes()).every((c) => +c.lote.area > 0), "sin superficies, el Excel correcto no las llenó");
      exige(!n.errs.length, "errores en el estudio: " + n.errs.join(" | ").slice(0, 200));
      await n.context().close();
    });
    // Reporte de OBED (nov 2026): en un lote de la fila de atrás (su calle real es otra) la ficha ponía el frente de lado.
    // El botón «Frente» existía pero la ficha no le hacía caso en lotes de manzana, y al mover la manzana se borraba.
    await paso("El frente que elige el usuario manda en la ficha, también en lotes de manzana, y no se borra al mover la manzana", async () => {
      const leer = () => a.evaluate((id) => fetch("api/tours/" + id).then((r) => r.json()), tour);
      const guardar = (d) => a.evaluate(([id, d]) => fetch("api/tours/" + id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(d) }).then((r) => r.status), [tour, d]);
      await a.keyboard.press("Escape"); await a.waitForTimeout(1500);
      const original = await leer(), esc = original.proyecto.escenaInicial || original.escenas[0].id, l = original.capas[esc] || [];
      const x = l.find((c) => c.lote && c.deManzana && (l.find((m) => m.id === c.deManzana) || {}).manzana && c.puntos.length === 4);
      exige(x, "el tour de prueba no tiene un lote de manzana");
      try {
        await a.goto(ESTUDIO + "/#t=" + tour); await a.reload(); await a.waitForTimeout(2500); await cerrarAnuncio(a); await irCapas(a);
        const elegirLote = async () => {
          const nom = await a.evaluate(([n, mz]) => { const li = [...document.querySelectorAll("#lista li")].find((e) => new RegExp("^\\S+ " + n + "( |$)").test(e.innerText.trim()) && e.innerText.trim().endsWith(mz)); if (li) li.querySelector("span").click(); return li ? li.querySelector("span").textContent.trim() : null; }, [x.lote.numero, x.lote.manzana]);
          exige(nom, "no encontré el lote " + x.lote.numero + " en la lista"); await a.waitForTimeout(500);
          return nom;
        };
        const nombre = await elegirLote();
        for (const [i, v] of [["0", "11"], ["1", "22"], ["2", "33"], ["3", "44"]]) { await a.fill('[data-lado="' + i + '"]', v); await a.dispatchEvent('[data-lado="' + i + '"]', "change"); await a.waitForTimeout(150); }
        await a.click('[data-frente="1"]'); await a.waitForTimeout(400);
        // Se mueve la manzana (un lote más y uno menos): el frente elegido sigue ahí
        await a.click('[data-acc="ir-manzana"]'); await a.waitForTimeout(500);
        await a.click('[data-mz-n="1"]'); await a.waitForTimeout(500); await a.click('[data-mz-n="-1"]'); await a.waitForTimeout(800);
        await elegirLote();
        exige(await a.isChecked('[data-frente="1"]'), "al mover la manzana se borró el frente que eligió el usuario");
        // La ficha dibuja ese lado abajo
        await a.click('#subtabs button:has-text("Fichas técnicas")'); await a.waitForTimeout(1200); await pasarGuias(a);
        await a.check('[data-fe="activa"]'); await a.waitForTimeout(400);
        const op = await a.evaluate((nom) => { const o = [...document.querySelectorAll("#fe-muestra option")].find((e) => e.textContent.trim() === nom); return o && o.value; }, nombre);
        exige(op, "el lote no está en «Ver con» de la ficha");
        await a.selectOption("#fe-muestra", op); await a.waitForTimeout(500);
        const abajo = await a.evaluate(() => { const t = [...document.querySelectorAll("#fe-lienzo .fd-medida")]; t.sort((p, q) => +q.getAttribute("y") - +p.getAttribute("y")); return t.map((e) => e.textContent); });
        exige(abajo.length === 4, "la ficha no muestra las 4 medidas: " + JSON.stringify(abajo));
        exige(/^22/.test(abajo[0]), "en la ficha el frente elegido (22 m) no quedó abajo: " + JSON.stringify(abajo));
      } finally {
        await a.waitForTimeout(1200); await guardar(original); await a.goto(ESTUDIO + "/#t=" + tour); await a.reload(); await a.waitForTimeout(2500); await cerrarAnuncio(a); // el tour regresa a como estaba
      }
    }, a);
    // Límite probado en un iPhone real (nov 2026): 1,100 lotes en una esfera aguanta, 1,500 cierra Safari.
    // Con margen para iPhones viejos: aviso desde 300 lotes por esfera y tope en 500.
    await paso("Tope de lotes por esfera: avisa en 300 y no deja pasar de 500 (el celular no lo aguanta)", async () => {
      const leer = () => a.evaluate((id) => fetch("api/tours/" + id).then((r) => r.json()), tour);
      const guardar = (d) => a.evaluate(([id, d]) => fetch("api/tours/" + id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(d) }).then((r) => r.status), [tour, d]);
      await a.keyboard.press("Escape"); await a.waitForTimeout(1500); // que termine de guardar lo pendiente
      const original = await leer(), esc = original.proyecto.escenaInicial || original.escenas[0].id;
      const cuantos = (d) => (d.capas[esc] || []).filter((c) => c.lote).length;
      // Lotes de relleno a espaldas de la vista inicial, para no estorbar al dibujar el lote nuevo
      const yv = ((original.escenas.find((e) => e.id === esc) || {}).vista || {}).yaw || 0;
      const conLotes = (total) => {
        const d = JSON.parse(JSON.stringify(original)), faltan = total - cuantos(d);
        const suelo = (x, z) => { const a2 = Math.atan2(x, z) + yv + Math.PI; return [+a2.toFixed(5), +Math.asin(1 / Math.hypot(x, 1, z)).toFixed(5)]; };
        for (let i = 0; i < faltan; i++) {
          const x0 = (i % 40) * 0.12 - 2.4, z0 = 1 + Math.floor(i / 40) * 0.2;
          d.capas[esc].push({ id: "relleno" + i, tipo: "poligono", nombre: "Lote", visible: true, puntos: [[x0, z0], [x0 + 0.1, z0], [x0 + 0.1, z0 + 0.18], [x0, z0 + 0.18]].map(([x, z]) => suelo(x, z)),
            relleno: { color: "#D5FF40", opacidad: 0.35 }, trazo: { color: "#D5FF40", grosor: 1.5, opacidad: 1 }, lote: { numero: String(900 + i), manzana: "Z", estado: "disponible", lados: ["", "", "", ""] } });
        }
        return d;
      };
      const dibujarLote = async () => {
        await a.goto(ESTUDIO + "/#t=" + tour); await a.reload(); await a.waitForTimeout(2500); await cerrarAnuncio(a); await irCapas(a);
        await a.click("#add-lote"); await a.waitForTimeout(300); await pasarGuias(a);
        for (const [x, y] of [[460, 700], [560, 700], [560, 780], [460, 780]]) { await a.mouse.click(x, y); await a.waitForTimeout(120); }
        await a.keyboard.press("Enter"); await a.waitForTimeout(600);
        const aviso = await a.textContent("#toast").catch(() => "");
        if (process.env.CAPTURAS) await a.screenshot({ path: path.join(process.env.CAPTURAS, "tope-" + (/Máximo/.test(aviso) ? "500" : "300") + ".png") });
        await a.waitForTimeout(1500); // guardado en la nube
        return aviso;
      };
      try {
        exige((await guardar(conLotes(299))) === 200, "no se pudo preparar el tour con 299 lotes");
        const a1 = await dibujarLote();
        exige(/ya tiene 300 lotes/.test(a1), "al llegar a 300 lotes no avisó (dijo: «" + a1 + "»)");
        exige(cuantos(await leer()) === 300, "el lote 300 no se guardó");
        exige((await guardar(conLotes(500))) === 200, "no se pudo preparar el tour con 500 lotes");
        const a2 = await dibujarLote();
        exige(/Máximo 500 lotes por esfera/.test(a2), "el lote 501 no avisó del tope (dijo: «" + a2 + "»)");
        exige(cuantos(await leer()) === 500, "dejó pasar de 500 lotes: " + cuantos(await leer()));
        exige(await a.evaluate(() => [...document.querySelectorAll("#lista li")].length > 0), "la lista de capas quedó vacía después del tope");
      } finally {
        await guardar(original); await a.goto(ESTUDIO + "/#t=" + tour); await a.reload(); await a.waitForTimeout(2500); await cerrarAnuncio(a); // el tour regresa a como estaba
      }
    }, a);
    await paso("Sin errores de JavaScript en el estudio", async () => { exige(!a.errs.length && !g.errs.length, (a.errs.concat(g.errs)).join(" | ").slice(0, 200)); });
    await navegador.close();
  } catch (e) {
    resultados.push({ nombre: "Arranque de la revisión", ok: false, motivo: e.message });
    console.log("  ✗ " + e.message);
  } finally {
    apagar();
  }
  const bien = resultados.filter((r) => r.ok).length;
  console.log("\n" + (bien === resultados.length ? "✓" : "✗") + " " + bien + " de " + resultados.length + " pruebas pasaron\n");
  if (!SOLO) fs.writeFileSync(path.join(__dirname, "ultima-revision.json"), JSON.stringify({ fecha: new Date().toISOString(), bien, total: resultados.length, resultados }, null, 1));
  process.exit(bien === resultados.length ? 0 : 1);
})();
