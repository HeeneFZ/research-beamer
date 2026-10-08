// KaTeX Size4 outlines: (c) 2009-2010 Design Science, Inc.; (c) 2014-2018 Khan Academy.
// SIL OFL 1.1, see electron/font-OFL.txt. Preserve em geometry and baseline;
// one vector path prevents font hinting and SVG rasterization from splitting joins.
const GLYPHS: Record<string, string> = {
  '⎧': 'M712 899L718 893L718 876Q718 857 717 856Q711 850 704 846Q627 793 576.5 709.5Q526 626 510 525Q510 524 509 521Q505 493 504 349Q504 344 504 334Q504 277 504 240Q504 -2 503 -4Q502 -8 494 -9Q486 -10 444 -10Q392 -10 390 -9Q387 -8 386 -5Q384 8 384 230Q384 467 385 476Q397 663 546 807Q596 854 664 892L677 899L712 899Z',
  '⎨': 'M389 1159Q391 1160 455 1160Q496 1160 498 1159Q501 1158 502 1155Q504 1143 504 924Q504 691 503 682Q492 525 396 398Q332 314 229 250Q235 246 243 241Q373 161 442 30Q496 -70 503 -182Q504 -191 504 -424Q504 -600 503.5 -629.5Q503 -659 499 -659L498 -659L490 -660Q481 -660 468.5 -660Q456 -660 444 -660Q432 -660 419.5 -660Q407 -660 398 -660L390 -659Q387 -658 386 -655Q384 -643 384 -425Q384 -191 383 -179Q367 84 183 221Q171 230 171 232L170 235Q170 238 170 242Q170 246 170 250Q170 254 170 258Q170 262 170 265L171 268Q171 270 183 279Q272 346 324 449Q376 552 383 679Q384 691 384 925Q384 1152 385 1155L389 1159Z',
  '⎩': 'M718 -893L712 -899L677 -899L666 -893Q510 -809 434 -655Q391 -569 385 -476Q384 -466 384 -282Q384 3 385 5L389 9Q392 10 444 10Q486 10 494 9Q502 8 503 4Q504 2 504 -239Q505 -484 506 -496Q514 -561 530 -609Q579 -760 704 -846Q711 -850 717 -856Q718 -857 718 -876L718 -893Z',
  '⎫': 'M175 898Q177 899 194 899L211 899L222 893Q356 820 435 692Q496 580 503 476Q504 467 504 230Q504 51 503.5 21Q503 -9 499 -9L498 -9Q496 -10 444 -10Q402 -10 394 -9Q386 -8 385 -4Q384 -2 384 240Q383 484 382 496Q374 561 358 609Q309 760 184 846Q177 850 171 856Q170 857 170 875Q170 894 175 898Z',
  '⎬': 'M389 1159Q391 1160 455 1160Q496 1160 498 1159Q501 1158 502 1155Q504 1143 504 925Q504 691 505 679Q521 416 705 279Q717 270 717 268L718 265Q718 262 718 258Q718 254 718 250Q718 246 718 242Q718 238 718 235L717 232Q717 230 705 221Q616 154 564 51Q512 -52 505 -179Q504 -191 504 -425Q504 -600 503.5 -629.5Q503 -659 499 -659L498 -659L490 -660Q481 -660 468.5 -660Q456 -660 444 -660Q432 -660 419.5 -660Q407 -660 398 -660L390 -659Q387 -658 386 -655Q384 -643 384 -424Q384 -191 385 -182Q396 -25 492 102Q556 186 659 250Q653 254 645 259Q515 339 446 470Q392 570 385 682Q384 692 384 873Q384 1153 385 1155L389 1159Z',
  '⎭': 'M389 9Q391 10 455 10Q496 10 498 9Q501 8 502 5Q504 -8 504 -230Q504 -467 503 -476Q496 -587 435 -691Q357 -820 222 -893L211 -899L195 -899Q176 -899 173 -896Q170 -893 170 -874Q170 -857 171 -856Q177 -850 184 -846Q262 -793 312.5 -709Q363 -625 378 -525Q378 -524 379 -522Q383 -493 384 -351Q384 -345 384 -334Q384 -276 384 -239Q384 2 385 4Q386 6 389 9Z',
};

function atBaseline(outline: string, baseline: number): string {
  return outline.replace(/([MLQZ])([^MLQZ]*)/g, (_all, command: string, args: string) => {
    const values = args.match(/-?\d+(?:\.\d+)?/g) ?? [];
    return command + values.map((v, i) => i % 2 ? Number((baseline - Number(v)).toFixed(4)) : v).join(' ');
  });
}

export function unifyKatexBrace(mult: HTMLElement): void {
  if (mult.dataset.vectorBrace) return;
  const host = mult.querySelector<HTMLElement>('.vlist');
  if (!host) return;
  const pieces = [...host.children] as HTMLElement[];
  const glyphs = pieces.map((piece) => piece.querySelector('.delimsizinginner')?.textContent ?? '');
  if (glyphs.filter((glyph) => GLYPHS[glyph]).length !== 3) return;
  const top = parseFloat(host.style.height);
  const depth = parseFloat(mult.querySelectorAll<HTMLElement>('.vlist')[1]?.style.height ?? '0');
  const height = top + depth;
  if (!(height > 0)) return;
  let path = '';
  let width = 0;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    const strut = piece.querySelector<HTMLElement>('.pstrut');
    const baseline = (top + parseFloat(piece.style.top) + parseFloat(strut?.style.height ?? '0')) * 1000;
    if (!Number.isFinite(baseline)) return;
    if (GLYPHS[glyphs[i]]) {
      path += atBaseline(GLYPHS[glyphs[i]], baseline);
    } else {
      const bar = piece.querySelector('svg');
      if (!bar) continue;
      const view = (bar.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
      if (!(view[3] > 0)) return;
      width = view[2];
      path += `M384 ${baseline - view[3]}H504V${baseline}H384Z`;
    }
  }
  if (!(width > 0)) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height * 1000}`);
  svg.setAttribute('width', `${width / 1000}em`);
  svg.setAttribute('height', `${height}em`);
  svg.setAttribute('aria-hidden', 'true');
  // KaTeX's svg rule sets width:100%; height:inherit. Override it explicitly.
  svg.style.cssText = `position:absolute;left:0;top:0;overflow:visible;pointer-events:none;width:${width / 1000}em;height:${height}em`;
  const shape = document.createElementNS(svg.namespaceURI, 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('fill', 'currentColor');
  svg.appendChild(shape);
  // Original baseline boxes and text index remain available to annotation anchors.
  for (const piece of pieces) piece.style.opacity = '0';
  host.appendChild(svg);
  mult.dataset.vectorBrace = '1';
}
