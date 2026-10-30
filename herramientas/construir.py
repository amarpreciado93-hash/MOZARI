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
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n'
    '<meta name="description" content="Sube tus esferas, conéctalas y comparte un link.">\n'
    '<meta property="og:title" content="Mozari · Arma tours 360 profesionales">\n'
    '<meta property="og:description" content="Sube tus esferas, conéctalas y comparte un link.">\n'
    + """<meta property="og:type" content="website">\n<meta property="og:site_name" content="Mozari">\n<meta property="og:url" content="https://mozari.app/">\n<meta property="og:image" content="https://mozari.app/og.jpg">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta property="og:image:alt" content="Mozari · Tours 360 profesionales desde tu navegador">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="https://mozari.app/og.jpg">\n<link rel="icon" href="/favicon.ico" sizes="any">\n<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n<meta name="theme-color" content="#0B0B0B">\n"""
    + cabeza + "\n</head>\n<body>" + cuerpo.rstrip("\n") + "\n</body>\n</html>\n"
)
assert doc.count("<body") == 1 and doc.count("</head>") == 1
open(dst, "w", encoding="utf-8").write(doc)
print("ok", dst, len(doc))
