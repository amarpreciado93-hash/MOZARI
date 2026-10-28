#!/usr/bin/env python3
"""
Mozari · Tiler de esferas
Convierte una esfera equirectangular (2:1) en un cubo multirresolución
compatible con el motor Marzipano.

Salida:
  <salida>/<id>/preview.jpg                 tira vertical 256 px (caras b,d,f,l,r,u)
  <salida>/<id>/<nivel>/<cara>/<y>/<x>.jpg  tiles por nivel
  <salida>/<id>/escena.json                 niveles y datos para el visor

Uso:
  python3 tiler.py esfera.jpg --id playa --salida proyectos/demo
  python3 tiler.py esfera.jpg --id playa --tile 512          (producción)
"""
import argparse, json, math, os, time
import numpy as np
import cv2

CARAS = "bdflru"  # orden que espera Marzipano en el preview


def direcciones(cara, n):
    """Vector de dirección (x derecha, y arriba, z al frente) para cada píxel de una cara."""
    t = (np.arange(n, dtype=np.float32) + 0.5) / n * 2 - 1
    u, v = np.meshgrid(t, t)  # u: izquierda→derecha, v: arriba→abajo
    uno = np.ones_like(u)
    if cara == "f": d = (u, -v, uno)
    elif cara == "r": d = (uno, -v, -u)
    elif cara == "b": d = (-u, -v, -uno)
    elif cara == "l": d = (-uno, -v, u)
    elif cara == "u": d = (u, uno, v)
    elif cara == "d": d = (u, -uno, -v)
    return d


def cara_desde_equirect(img, cara, n):
    h, w = img.shape[:2]
    x, y, z = direcciones(cara, n)
    yaw = np.arctan2(x, z)
    pitch = np.arctan2(y, np.sqrt(x * x + z * z))
    mx = ((yaw / (2 * math.pi) + 0.5) * w - 0.5).astype(np.float32)
    my = ((0.5 - pitch / math.pi) * h - 0.5).astype(np.float32)
    return cv2.remap(img, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)


def tam_cara(ancho, maximo):
    """Tamaño de cara: 2^n o 3·2^n, para que cada nivel sea mitad exacta del siguiente."""
    ideal = ancho / math.pi
    candidatos = sorted({b * 2 ** n for b in (1, 3) for n in range(8, 15)})
    for c in candidatos:
        if c >= 0.9 * ideal and c >= 512:
            return min(c, maximo)
    return maximo


def niveles(cara, tile):
    """Del más chico al más grande. Cada nivel es el doble del anterior (regla de Marzipano)."""
    tamanos = []
    s = cara
    while s >= 512 and s % 256 == 0:
        tamanos.append(s)
        s //= 2
    lista = [{"tileSize": 256, "size": 256, "fallbackOnly": True}]
    n = 1  # tiles por lado; Marzipano exige que cada nivel tenga un múltiplo de los del nivel anterior
    for s in reversed(tamanos):
        while s // n > tile:
            n *= 2
        lista.append({"tileSize": s // n, "size": s})
    return lista


def main():
    p = argparse.ArgumentParser()
    p.add_argument("esfera")
    p.add_argument("--id", required=True)
    p.add_argument("--nombre")
    p.add_argument("--salida", default="proyectos/demo")
    p.add_argument("--tile", type=int, default=512)
    p.add_argument("--max-cara", type=int, default=8192)
    p.add_argument("--calidad", type=int, default=82)
    a = p.parse_args()

    t0 = time.time()
    img = cv2.imread(a.esfera, cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit("No pude abrir " + a.esfera)
    h, w = img.shape[:2]
    if abs(w / h - 2) > 0.02:
        print(f"Aviso: la esfera mide {w}x{h}, no es 2:1 exacto")

    cara_n = tam_cara(w, a.max_cara)
    lv = niveles(cara_n, a.tile)
    base = os.path.join(a.salida, a.id)
    os.makedirs(base, exist_ok=True)
    jpg = [cv2.IMWRITE_JPEG_QUALITY, a.calidad, cv2.IMWRITE_JPEG_PROGRESSIVE, 1]
    preview = []
    total = 0

    for c in CARAS:
        grande = cara_desde_equirect(img, c, cara_n)
        for z, nivel in enumerate(lv):
            s, ts = nivel["size"], nivel["tileSize"]
            capa = grande if s == cara_n else cv2.resize(grande, (s, s), interpolation=cv2.INTER_AREA)
            if nivel.get("fallbackOnly"):
                preview.append(capa)
                continue
            for ty in range(s // ts):
                for tx in range(s // ts):
                    d = os.path.join(base, str(z), c, str(ty))
                    os.makedirs(d, exist_ok=True)
                    cv2.imwrite(os.path.join(d, f"{tx}.jpg"), capa[ty*ts:(ty+1)*ts, tx*ts:(tx+1)*ts], jpg)
                    total += 1
        del grande

    cv2.imwrite(os.path.join(base, "preview.jpg"), np.vstack(preview), jpg)
    escena = {
        "id": a.id,
        "nombre": a.nombre or a.id,
        "origen": {"archivo": os.path.basename(a.esfera), "ancho": w, "alto": h},
        "cara": cara_n,
        "niveles": lv,
        "vista": {"yaw": 0, "pitch": 0, "fov": 1.5708},
    }
    with open(os.path.join(base, "escena.json"), "w") as f:
        json.dump(escena, f, indent=2, ensure_ascii=False)
    print(f"{a.id}: {w}x{h} → cara {cara_n}px, {len(lv)} niveles, {total} tiles en {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
