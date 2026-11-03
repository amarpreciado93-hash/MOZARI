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
async function paso(nombre, fn, pagina) {
  const antes = pagina ? pagina.errs.length : 0, t0 = Date.now();
  try {
    await fn();
    if (pagina && pagina.errs.length > antes) throw new Error("error en la página: " + pagina.errs.slice(antes).join(" | ").slice(0, 200));
    resultados.push({ nombre, ok: true });
    console.log("  ✓ " + nombre + "  (" + ((Date.now() - t0) / 1000).toFixed(1) + " s)");
  } catch (e) {
    resultados.push({ nombre, ok: false, motivo: String(e.message || e).split("\n")[0].slice(0, 220) });
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
  await p.route("**/marzipano.js", (r) => r.fulfill({ path: LIB.marzipano, contentType: "application/javascript" }));
  await p.route("**/d3.min.js", (r) => r.fulfill({ path: LIB.d3, contentType: "application/javascript" }));
  await p.route("**/fflate@*/umd/index.js", (r) => r.fulfill({ path: LIB.fflate, contentType: "application/javascript" }));
  await p.route("**/xlsx.full.min.js", (r) => r.fulfill({ path: LIB.xlsx, contentType: "application/javascript" }));
  await p.route("**/qrcode-generator@*/qrcode.js", (r) => r.fulfill({ path: LIB.qr, contentType: "application/javascript" }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
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
    }, g);

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
  fs.writeFileSync(path.join(__dirname, "ultima-revision.json"), JSON.stringify({ fecha: new Date().toISOString(), bien, total: resultados.length, resultados }, null, 1));
  process.exit(bien === resultados.length ? 0 : 1);
})();
