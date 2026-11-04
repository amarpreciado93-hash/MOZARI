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
  if (SOLO && !nombre.includes(SOLO) && !/^Crear un tour/.test(nombre)) return;
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
  }
}
const exige = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---------- ayudantes ----------
let navegador;
async function pagina(correo, opciones = {}) {
  const ctx = await navegador.newContext(Object.assign({ viewport: { width: 1400, height: 900 }, acceptDownloads: true }, opciones));
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
      await a.click('#subtabs button:has-text("Lotes")'); await a.waitForTimeout(1200); await pasarGuias(a);
      exige(await a.isVisible("#ficha-editor"), "no aparece el creador de fichas");
      await a.check('[data-fe="activa"]'); await a.waitForTimeout(500);
      exige(await a.$("#fe-lienzo .ficha-d"), "no se dibuja la ficha");
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR4nGPgyt/8Hx9mGBkKACvRisEGqcWiAAAAAElFTkSuQmCC", "base64");
      await a.setInputFiles("#fe-logo2", { name: "inmobiliaria.png", mimeType: "image/png", buffer: png }); await a.waitForTimeout(1800);
      exige(await a.$("#fe-lienzo .fd-logo2"), "el segundo logo no sale al pie de la ficha");
      await a.click('[data-fe-plantilla="ubicacion"]'); await a.waitForTimeout(400); await a.click('[data-fe-plantilla="banda"]'); await a.waitForTimeout(400);
      exige(await a.$("#fe-lienzo .fd-pie .fd-logo2"), "la banda de color perdió el segundo logo");
    }, a);
    let link = null;
    await paso("Publicar y abrir el tour público en computadora", async () => {
      await a.click('#nav button:has-text("Publicar")'); await a.waitForTimeout(800);
      await a.click("#pub-publicar"); await a.waitForTimeout(3500);
      link = TOURS + "/" + tour + "/";
      const t = await pagina(null); await t.goto(link); await t.waitForTimeout(4500);
      exige(await t.$("canvas"), "el tour no dibujó la esfera");
      exige(!(await t.$(".agua-mozari")), "el tour del dueño salió con marca de agua");
      exige(!t.errs.length, "errores en el tour: " + t.errs.join(" | ").slice(0, 160));
      await t.context().close();
    }, a);
    await paso("El tour abre sin esperar a bajar toda la esfera en alta (celular con 4G)", async () => {
      // Reporte (nov 2026): en celular el tour tardaba 10-15 s en abrir porque esperaba las 6 caras en alta y las vecinas
      if (!link) { await a.click('#nav button:has-text("Publicar")'); await a.waitForTimeout(800); await a.click("#pub-publicar"); await a.waitForTimeout(3500); link = TOURS + "/" + tour + "/"; }
      const ctx = await navegador.newContext(Object.assign({}, devices["iPhone 13"])), t = await ctx.newPage();
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
      exige(!m.errs.length, "errores en celular: " + m.errs.join(" | ").slice(0, 160));
      await m.context().close();
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
      await a.click('#nav button:has-text("Skin")'); await a.waitForTimeout(1200);
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
      await a.click('#nav button:has-text("Skin")'); await a.waitForTimeout(800);
      await a.click('button[data-sk-k="logo.tipo"][data-v="ninguno"]'); await a.click('button[data-sk-k="panel"][data-v="#111111"]'); await a.waitForTimeout(600);
      await publicar();
    }, a);
    await paso("Panel de dueño: cuentas, links, reportes, laboratorio y actualizaciones", async () => {
      await a.click('#nav button:has-text("Mis Tours")'); await a.waitForTimeout(800);
      await a.click("#ver-cuentas"); await a.waitForTimeout(1200);
      exige(await a.isVisible(".cuentas-conteo"), "no se ve el conteo de usuarios");
      for (const t of ["links", "reportes", "laboratorio", "novedades"]) { await a.click('[data-dueno="' + t + '"]'); await a.waitForTimeout(900); }
    }, a);

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
      for (const r of ["cuentas", "cupones", "reportes", "laboratorio", "novedades", "respaldos"]) {
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
      await pr.click('#nav button:has-text("Skin")'); await pr.waitForTimeout(400);
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
      await t.click('#subtabs button:has-text("Lotes")'); await t.waitForTimeout(1500);
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
      await t.click('#subtabs button:has-text("Lotes")'); await t.waitForTimeout(1500);
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
      await n.evaluate(() => { const p = document.getElementById("ref-panel"); p.style.width = "560px"; p.style.height = "420px"; });
      await n.click("#ref-ajustar"); await n.click("#ref-lotes"); await n.waitForTimeout(500);
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
