/**
 * controladorDados.ts — quem aparece como controladora dos dados no termo do
 * cadastro do responsável (#474).
 *
 * O controlador é a escola em que o aluno está matriculado, não uma escola
 * fixa. Sem nenhum `import`, para o Jest do backend carregar o arquivo como
 * ele é (ver backend/src/tests/controladorDados.test.js).
 */

/** "A", "A e B", "A, B e C". */
function juntarNomes(nomes: string[]): string {
  if (nomes.length < 2) return nomes.join('');
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

/**
 * Frases do termo com o nome da escola de cada aluno. Sem o nome (lista
 * ainda não carregada, e-mail não confirmado), o texto fala da escola de
 * forma genérica — nunca de outra.
 */
export function textoDoControlador(escolasDosAlunos: Array<string | undefined>) {
  const nomes = [
    ...new Set(escolasDosAlunos.map((n) => n?.trim()).filter((n): n is string => !!n)),
  ];
  if (nomes.length === 0) {
    return {
      coleta: 'A escola em que o aluno está matriculado coleta',
      matriculados: 'matriculados nas escolas atendidas por este portal',
    };
  }
  if (nomes.length === 1) {
    return {
      coleta: `A escola em que o aluno está matriculado, ${nomes[0]}, coleta`,
      matriculados: `matriculados na escola ${nomes[0]}`,
    };
  }
  return {
    coleta: `As escolas em que os alunos estão matriculados, ${juntarNomes(nomes)}, coletam`,
    matriculados: `matriculados nas escolas ${juntarNomes(nomes)}`,
  };
}
