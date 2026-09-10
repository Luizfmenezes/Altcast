const { execFileSync } = require('node:child_process')
const path = require('node:path')

/**
 * Compila antes de empacotar. Sempre, sem excecao.
 *
 * Existe por causa de um defeito real que chegou a producao: `electron-builder`
 * empacota o que estiver em `dist/`, e nao tem como saber que aquilo esta
 * velho. Invocado direto — sem o `npm run build` que o script `dist` faz antes
 * — ele produziu um instalador com o `config.js` de uma versao anterior, e o
 * app apontava para um dominio que nao existe. O binario estava perfeito; o
 * conteudo, nao. E nada no processo reclamou.
 *
 * Falhas assim nao se resolvem com disciplina, porque a forma errada de
 * invocar continua disponivel e continua parecendo certa. Este gancho tira a
 * possibilidade: qualquer caminho que chegue ao empacotamento passa por aqui
 * primeiro.
 *
 * `tsc` e incremental e o esbuild leva milissegundos; quando `npm run dist` ja
 * compilou, isto custa quase nada e nao muda nada.
 */
module.exports = async function antesDeEmpacotar() {
  const raiz = path.resolve(__dirname, '..')
  process.stdout.write('  • compilando antes de empacotar\n')
  execFileSync('npm', ['run', 'build'], {
    cwd: raiz,
    stdio: 'inherit',
    // `npm` no Windows e um .cmd, e sem shell o spawn nao o encontra.
    shell: process.platform === 'win32',
  })
}
