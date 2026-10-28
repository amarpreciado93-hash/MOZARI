#!/usr/bin/env python3
"""
Mozari · Little Planet
Genera la vista "planetita" (proyección estereográfica desde el cenit) de una esfera
equirectangular. El visor la usa como intro antes de entrar al tour.

Uso: python3 planeta.py esfera.jpg salida.jpg --tam 1400 --yaw 0
"""
import argparse, math
import numpy as np
import cv2

p = argparse.ArgumentParser()
p.add_argument("esfera"); p.add_argument("salida")
p.add_argument("--tam", type=int, default=1400)
p.add_argument("--yaw", type=float, default=0, help="grados; lo que queda arriba del planeta")
p.add_argument("--horizonte", type=float, default=0.32, help="radio del horizonte como fracción del ancho")
a = p.parse_args()

img = cv2.imread(a.esfera, cv2.IMREAD_COLOR)
h, w = img.shape[:2]
n = a.tam
t = np.arange(n, dtype=np.float32) - n / 2 + 0.5
x, y = np.meshgrid(t, t)
r = np.sqrt(x * x + y * y)
k = a.horizonte * n
phi = 2 * np.arctan(r / k)                       # 0 = nadir, pi/2 = horizonte, -> pi = cenit
elev = phi - math.pi / 2                         # -90..+90
yaw = np.arctan2(x, -y) + math.radians(a.yaw)    # arriba del planeta = yaw elegido
mx = (((yaw / (2 * math.pi) + 0.5) % 1.0) * w - 0.5).astype(np.float32)
my = ((0.5 - elev / math.pi) * h - 0.5).astype(np.float32)
out = cv2.remap(img, mx, my, cv2.INTER_AREA if False else cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
cv2.imwrite(a.salida, out, [cv2.IMWRITE_JPEG_QUALITY, 84, cv2.IMWRITE_JPEG_PROGRESSIVE, 1])
print("planeta:", a.salida, n, "px")
