from pathlib import Path

from PIL import Image, ImageDraw


ROOT_DIR = Path('/Users/gui/querobroapp')
CARDAPIO_DIR = ROOT_DIR / 'apps' / 'web' / 'public' / 'querobroa-brand' / 'cardapio'

TRADITIONAL = CARDAPIO_DIR / 'tradicional.jpg'
MISTA_TARGETS = {
    'mista-goiabada.jpg': CARDAPIO_DIR / 'goiabada.jpg',
    'mista-doce-de-leite.jpg': CARDAPIO_DIR / 'doce-de-leite.jpg',
    'mista-queijo-do-serro.jpg': CARDAPIO_DIR / 'queijo-do-serro-camadas.jpg',
    'mista-requeijao-de-corte.jpg': CARDAPIO_DIR / 'requeijao-de-corte.jpg',
}


def build_right_mask(size: tuple[int, int]) -> Image.Image:
    width, height = size
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon(
        [
            (round(width * 0.62), 0),
            (width, 0),
            (width, height),
            (round(width * 0.38), height),
        ],
        fill=255,
    )
    return mask


def generate_mista_image(traditional_path: Path, flavor_path: Path, output_path: Path) -> None:
    with Image.open(traditional_path).convert('RGB') as traditional_image, Image.open(flavor_path).convert(
        'RGB'
    ) as flavor_image:
        if traditional_image.size != flavor_image.size:
            flavor_image = flavor_image.resize(traditional_image.size, Image.Resampling.LANCZOS)

        result = traditional_image.copy()
        right_mask = build_right_mask(traditional_image.size)
        result.paste(flavor_image, (0, 0), right_mask)
        result.save(output_path, format='JPEG', quality=92, subsampling=0, optimize=True)


def main() -> None:
    for target_name, flavor_path in MISTA_TARGETS.items():
        generate_mista_image(TRADITIONAL, flavor_path, CARDAPIO_DIR / target_name)
        print(f'updated {target_name}')


if __name__ == '__main__':
    main()
