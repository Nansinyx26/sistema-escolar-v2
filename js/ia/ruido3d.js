/**
 * ruido3d.js — ruído gradiente 3D (Perlin melhorado) usado pela esfera do
 * assistente para deslocar os pontos como se fossem superfície de água.
 *
 * Existe como função própria, e não como dependência, por dois motivos: a
 * página é servida como ES module sem bundler (não há como fazer tree-shaking
 * de uma lib de ruído) e o CSP desta aplicação autoriza scripts por origem
 * `'self'` — cada CDN a mais é uma exceção a manter.
 *
 * O algoritmo é o "Improved Perlin Noise" de Ken Perlin (2002): interpola
 * gradientes nos 8 vértices do cubo unitário com a curva de suavização
 * 6t⁵-15t⁴+10t³, que tem primeira e segunda derivadas nulas nos extremos — é
 * isso que evita a aparência de grade nas cristas da onda.
 */

/** Curva de suavização de Perlin: derivadas 1ª e 2ª nulas em t=0 e t=1. */
function suavizar(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function interpolar(a, b, t) {
    return a + t * (b - a);
}

/**
 * Produto escalar entre a posição e um dos 12 gradientes do cubo, escolhido
 * pelos 4 bits baixos do hash. A forma abaixo é a do próprio Perlin: evita o
 * array de gradientes e resolve tudo em desvios de sinal.
 */
function gradiente(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/**
 * Cria uma função de ruído 3D determinística.
 *
 * A semente é fixa por padrão de propósito: duas abas da mesma página devem
 * desenhar a mesma esfera, e um relatório de bug com "a onda ficou estranha"
 * precisa ser reproduzível.
 *
 * @param {number} [semente=1337]
 * @returns {(x: number, y: number, z: number) => number} valor em [-1, 1]
 */
export function criarRuido3D(semente = 1337) {
    const permutacao = new Uint8Array(256);
    for (let i = 0; i < 256; i++) permutacao[i] = i;

    // LCG (Numerical Recipes) em vez de Math.random: embaralhamento estável
    // entre carregamentos, sem depender do gerador do navegador.
    let estado = semente >>> 0;
    const sortear = () => {
        estado = (Math.imul(estado, 1664525) + 1013904223) >>> 0;
        return estado / 4294967296;
    };

    for (let i = 255; i > 0; i--) {
        const j = Math.floor(sortear() * (i + 1));
        const troca = permutacao[i];
        permutacao[i] = permutacao[j];
        permutacao[j] = troca;
    }

    // Tabela duplicada para 512: dispensa o `& 255` em cada uma das 8 buscas
    // por amostra, que é o laço mais quente do render.
    const p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) p[i] = permutacao[i & 255];

    return function ruido3D(x, y, z) {
        const xi = Math.floor(x) & 255;
        const yi = Math.floor(y) & 255;
        const zi = Math.floor(z) & 255;

        const xf = x - Math.floor(x);
        const yf = y - Math.floor(y);
        const zf = z - Math.floor(z);

        const u = suavizar(xf);
        const v = suavizar(yf);
        const w = suavizar(zf);

        const a = p[xi] + yi;
        const aa = p[a] + zi;
        const ab = p[a + 1] + zi;
        const b = p[xi + 1] + yi;
        const ba = p[b] + zi;
        const bb = p[b + 1] + zi;

        const x1 = interpolar(gradiente(p[aa], xf, yf, zf), gradiente(p[ba], xf - 1, yf, zf), u);
        const x2 = interpolar(
            gradiente(p[ab], xf, yf - 1, zf),
            gradiente(p[bb], xf - 1, yf - 1, zf),
            u
        );
        const y1 = interpolar(x1, x2, v);

        const x3 = interpolar(
            gradiente(p[aa + 1], xf, yf, zf - 1),
            gradiente(p[ba + 1], xf - 1, yf, zf - 1),
            u
        );
        const x4 = interpolar(
            gradiente(p[ab + 1], xf, yf - 1, zf - 1),
            gradiente(p[bb + 1], xf - 1, yf - 1, zf - 1),
            u
        );
        const y2 = interpolar(x3, x4, v);

        return interpolar(y1, y2, w);
    };
}
