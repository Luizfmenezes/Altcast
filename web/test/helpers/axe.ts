import axe from 'axe-core'

/**
 * Roda a varredura axe sobre um trecho ja renderizado e devolve as violacoes.
 *
 * Verificacao automatizada nao substitui julgamento — ela pega talvez metade
 * dos problemas reais. Serve para que a metade mecanica (rotulo ausente,
 * contraste, papel invalido, ordem de cabecalho) nunca chegue a producao por
 * distracao.
 */
export async function violacoes(elemento: HTMLElement): Promise<string[]> {
  const resultado = await axe.run(elemento, {
    // Regras que dependem da pagina inteira nao fazem sentido sobre um trecho
    // isolado dentro do jsdom.
    rules: {
      region: { enabled: false },
      'page-has-heading-one': { enabled: false },
      // jsdom nao renderiza: a regra de contraste aqui mediria o nada. Quem
      // cobre contraste e o teste de tokens, sobre os valores reais.
      'color-contrast': { enabled: false },
    },
  })
  return resultado.violations.map(v => `${v.id}: ${v.nodes.length} ocorrencia(s)`)
}
