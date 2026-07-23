"""
Gera os icones do PWA a partir de img/logo-jaguari.png.

Os navegadores (Chrome/Edge/Samsung Internet) so exibem "Instalar aplicativo"
quando o manifest aponta para icones PNG QUADRADOS de 192x192 e 512x512 cujo
tamanho real bate com o atributo "sizes". O logo original e 521x479 (nao
quadrado), por isso os icones precisam ser gerados.

Uso: python scripts/generate-pwa-icons.py
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'img', 'logo-jaguari.png')
OUT_DIR = os.path.join(ROOT, 'img', 'icons')

BG = (9, 9, 11, 255)          # #09090b - fundo oficial do tema escuro
CONTENT_RATIO_ANY = 0.86      # icone comum: logo quase preenchendo o quadro
CONTENT_RATIO_MASKABLE = 0.58  # maskable: conteudo dentro da safe zone (80%)


def render(size, ratio, opaque=True):
    logo = Image.open(SRC).convert('RGBA')
    box = int(size * ratio)
    w, h = logo.size
    scale = min(box / w, box / h)
    logo = logo.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)

    canvas = Image.new('RGBA', (size, size), BG if opaque else (0, 0, 0, 0))
    canvas.alpha_composite(logo, ((size - logo.width) // 2, (size - logo.height) // 2))
    return canvas


def save(img, name):
    path = os.path.join(OUT_DIR, name)
    img.save(path, 'PNG', optimize=True)
    print('  {:<28} {}x{}'.format(name, img.width, img.height))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print('Gerando icones PWA em img/icons/')

    for size in (72, 96, 128, 144, 192, 256, 384, 512):
        save(render(size, CONTENT_RATIO_ANY), 'icon-{}.png'.format(size))

    for size in (192, 512):
        save(render(size, CONTENT_RATIO_MASKABLE), 'maskable-{}.png'.format(size))

    # iOS ignora transparencia; sempre opaco.
    save(render(180, CONTENT_RATIO_ANY), 'apple-touch-icon-180.png')
    save(render(32, CONTENT_RATIO_ANY), 'favicon-32.png')

    print('Concluido.')


if __name__ == '__main__':
    main()
