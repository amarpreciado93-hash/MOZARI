"""Construye estudio/index.html a partir del visor (fuente única del programa).

Uso:  python3 construir.py <visor.html> <salida index.html>

El visor se escribe sin <html>/<head>/<body> (formato de artifact); aquí se envuelve
en un documento completo para servirlo desde Cloudflare.
"""
import re
import sys

src, dst = sys.argv[1], sys.argv[2]
txt = open(src, encoding="utf-8").read()
txt = txt.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")
fin_style = txt.index("</style>") + len("</style>")
cabeza, cuerpo = txt[:fin_style], txt[fin_style:]
doc = (
    '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    + cabeza + "\n</head>\n<body>" + cuerpo.rstrip("\n") + "\n</body>\n</html>\n"
)
assert doc.count("<body") == 1 and doc.count("</head>") == 1
open(dst, "w", encoding="utf-8").write(doc)
print("ok", dst, len(doc))
