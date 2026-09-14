/**
 * urlFotoAluno.test.js
 *
 * A listagem de alunos prefixava `/api/upload/photo/` em qualquer `foto` com
 * mais de 20 caracteres, inclusive no que já era URL. O navegador pedia
 * `/api/upload/photo/api/upload/photo/<id>` e levava 404 — foi o erro que
 * aparecia no console da tela Autorizações dos Pais.
 */
const urlFotoAluno = require('../utils/urlFotoAluno');

const ID = '6a0c6aa552296d437350d3b8';
const URL_CERTA = `/api/upload/photo/${ID}`;

describe('urlFotoAluno', () => {
    it.each([
        ['id cru', ID],
        ['gridfs:<id>', `gridfs:${ID}`],
        ['URL já montada', `/api/upload/photo/${ID}`],
        ['URL sem a barra inicial', `api/upload/photo/${ID}`],
        ['rota pública /api/files', `/api/files/${ID}`],
        [
            'URL dobrada gravada por um salvamento anterior',
            `/api/upload/photo//api/upload/photo/${ID}`,
        ],
    ])('%s vira uma URL só', (_nome, foto) => {
        expect(urlFotoAluno(foto)).toBe(URL_CERTA);
    });

    it('nome de arquivo do upload também é referência do GridFS', () => {
        const nome = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.webp';
        expect(urlFotoAluno(nome)).toBe(`/api/upload/photo/${nome}`);
    });

    it.each([
        ['base64', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'],
        ['URL externa', 'https://lh3.googleusercontent.com/a/foto-do-google'],
        ['valor curto', 'sem-foto'],
        ['texto "null"', 'null'],
        ['vazio', ''],
        ['ausente', undefined],
        ['nulo', null],
    ])('%s fica como está', (_nome, foto) => {
        expect(urlFotoAluno(foto)).toBe(foto);
    });
});
