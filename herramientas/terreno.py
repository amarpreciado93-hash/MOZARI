#!/usr/bin/env python3
"""
Mozari · Puntos de referencia automáticos entre dos esferas aéreas

Proyecta cada esfera hacia abajo (vista de dron), busca los mismos detalles del
suelo en ambas (SIFT), calcula la homografía del terreno y devuelve puntos de
referencia en (yaw, pitch) listos para "terreno.puntos" del proyecto.

Uso:
  python3 terreno.py base.jpg otra.jpg --base central --otra frontal
  python3 terreno.py base.jpg otra.jpg --base central --otra frontal --puntos 8 --salida terreno.json

Revisión visual: con --revision se guarda una mezcla de las dos vistas cenitales
alineadas; si las calles se ven dobles, la detección falló.
"""
import argparse, json, math
import numpy as np
import cv2

N, R = 3000, 3.0  # vista cenital de 3000 px que cubre ±3 alturas del dron


def cenital(eq):
    h, w = eq.shape[:2]
    t = np.linspace(-R, R, N, dtype=np.float32)
    u, v = np.meshgrid(t, t)
    yaw = np.arctan2(u, -v)
    pitch = np.arctan2(1.0, np.sqrt(u * u + v * v))
    mx = ((yaw / (2 * np.pi) + 0.5) * w) % w
    my = (0.5 + pitch / np.pi) * h
    return cv2.remap(eq, mx.astype(np.float32), my.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)


def px_a_yp(x, y):
    u = -R + x * 2 * R / (N - 1)
    v = -R + y * 2 * R / (N - 1)
    return [round(math.atan2(u, -v), 5), round(math.atan2(1, math.hypot(u, v)), 5)]


def repartidos(pts, k):
    """k puntos lo más separados posible (muestreo del punto más lejano)."""
    elegidos = [int(np.argmin(np.linalg.norm(pts - pts.mean(0), axis=1)))]
    d = np.linalg.norm(pts - pts[elegidos[0]], axis=1)
    while len(elegidos) < min(k, len(pts)):
        i = int(np.argmax(d))
        elegidos.append(i)
        d = np.minimum(d, np.linalg.norm(pts - pts[i], axis=1))
    return elegidos


def main():
    p = argparse.ArgumentParser()
    p.add_argument("base"); p.add_argument("otra")
    p.add_argument("--base-id", "--base", dest="base_id", default="base")
    p.add_argument("--otra-id", "--otra", dest="otra_id", default="otra")
    p.add_argument("--puntos", type=int, default=8)
    p.add_argument("--salida")
    p.add_argument("--revision")
    a = p.parse_args()

    A = cenital(cv2.imread(a.base)); B = cenital(cv2.imread(a.otra))
    cl = cv2.createCLAHE(2.0, (8, 8))
    ga, gb = cl.apply(cv2.cvtColor(A, cv2.COLOR_BGR2GRAY)), cl.apply(cv2.cvtColor(B, cv2.COLOR_BGR2GRAY))
    sift = cv2.SIFT_create(nfeatures=0, contrastThreshold=0.015)
    ka, da = sift.detectAndCompute(ga, None)
    kb, db = sift.detectAndCompute(gb, None)
    m = cv2.FlannBasedMatcher({"algorithm": 1, "trees": 5}, {"checks": 64}).knnMatch(da, db, k=2)
    buenos = [x for x, y in m if x.distance < 0.8 * y.distance]
    pa = np.float32([ka[g.queryIdx].pt for g in buenos])
    pb = np.float32([kb[g.trainIdx].pt for g in buenos])
    H, mask = cv2.findHomography(pa, pb, cv2.USAC_MAGSAC, 3.0, maxIters=20000, confidence=0.999)
    if H is None:
        raise SystemExit("No se encontró el mismo terreno en las dos esferas.")
    inl = mask.ravel().astype(bool)
    print(f"coincidencias: {len(buenos)} · en el plano del suelo: {int(inl.sum())}")
    if inl.sum() < 12:
        print("Aviso: pocas coincidencias; revisa la mezcla con --revision.")

    sel = repartidos(pa[inl], a.puntos)
    qa = pa[inl][sel]
    qb = cv2.perspectiveTransform(qa[None], H)[0]
    terreno = {"base": a.base_id, "puntos": {a.base_id: [px_a_yp(*q) for q in qa], a.otra_id: [px_a_yp(*q) for q in qb]}}
    texto = json.dumps(terreno, indent=1)
    if a.salida:
        open(a.salida, "w").write(texto)
        print("guardado:", a.salida)
    else:
        print(texto)
    if a.revision:
        mezcla = cv2.addWeighted(cv2.warpPerspective(A, H, (N, N)), 0.5, B, 0.5, 0)
        cv2.imwrite(a.revision, cv2.resize(mezcla, (1500, 1500), interpolation=cv2.INTER_AREA))
        print("revisión:", a.revision)


if __name__ == "__main__":
    main()
