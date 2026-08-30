import { env } from '../env.js'
import { correioPadrao } from '../email/index.js'
import { emailDeVerificacao } from '../email/modelos.js'

/**
 * Prova que o correio desta instalacao entrega de verdade.
 *
 * Existe porque a configuracao de e-mail so falha onde ninguem olha: a chave
 * errada, o dominio nao verificado e o remetente de outro dominio produzem, os
 * tres, exatamente o mesmo sintoma — a pessoa que perdeu a senha nunca recebe
 * nada, e nenhuma tela tem como saber disso. Rodar isto depois de subir custa
 * dez segundos e transforma um silencio numa mensagem de erro.
 *
 *   npm run email:teste -- voce@seu-dominio.com
 *
 * Sem RESEND_API_KEY, o correio padrao escreve no log em vez de enviar — e o
 * comando diz isso em vez de fingir sucesso.
 */
async function principal(): Promise<void> {
  const destino = process.argv[2]

  if (destino === undefined || !destino.includes('@')) {
    console.error('Uso: npm run email:teste -- destinatario@exemplo.com')
    process.exitCode = 1
    return
  }

  if (env.RESEND_API_KEY === undefined) {
    console.error(
      'RESEND_API_KEY ausente: o correio vai escrever no log, e nao enviar.\n'
      + 'Preencha a chave no .env antes de testar a entrega de verdade.',
    )
    process.exitCode = 1
    return
  }

  console.log(`remetente: ${env.EMAIL_FROM}`)
  console.log(`destino:   ${destino}`)
  console.log(`links:     ${env.PUBLIC_URL}/verificar/...`)

  try {
    await correioPadrao().enviar(emailDeVerificacao({
      para: destino,
      nome: 'Teste de entrega',
      url: `${env.PUBLIC_URL}/verificar/token-de-teste-sem-valor`,
    }))
    console.log('\nEnviado. Se nao chegar em um minuto, olhe a caixa de spam e')
    console.log('confira no painel do Resend se o dominio do remetente esta verificado.')
  } catch (e) {
    console.error(`\nFalhou: ${e instanceof Error ? e.message : String(e)}`)
    console.error('Causas comuns: chave invalida, ou EMAIL_FROM de um dominio')
    console.error('que nao foi verificado no Resend.')
    process.exitCode = 1
  }
}

await principal()
