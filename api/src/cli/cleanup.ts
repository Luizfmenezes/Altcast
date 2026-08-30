import { and, isNull, lt } from 'drizzle-orm'
import { db } from '../db/client.js'
import { attachments, sessions } from '../db/schema.js'
import { logger } from '../shared/logger.js'
import { armazemPadrao, type Armazem } from '../media/armazenamento.js'

/** Uma vez por dia basta: sessao vencida ja nao autentica ninguem. */
export const INTERVALO_DE_LIMPEZA_MS = 24 * 60 * 60 * 1000

/**
 * Remove as sessoes vencidas.
 *
 * `validateSession` ja filtra por `expires_at`, entao a linha vencida nunca
 * autentica nada - a faxina existe para a tabela nao crescer para sempre com
 * lixo que so ocupa indice.
 */
export async function limparSessoesExpiradas(): Promise<number> {
  const resultado = await db.delete(sessions).where(lt(sessions.expiresAt, new Date()))
  return resultado.rowCount ?? 0
}

/**
 * Janela de tolerancia do anexo orfao.
 *
 * Generosa de proposito: o orfao normal e de alguem que escolheu o arquivo e
 * ainda esta escrevendo a mensagem, ou que fechou a aba e vai voltar. Apagar
 * cedo demais transformaria uma pausa para o almoco em upload perdido.
 */
export const IDADE_DO_ORFAO_MS = 24 * 60 * 60 * 1000

/**
 * Remove os anexos que nunca viraram mensagem.
 *
 * O upload acontece antes do envio — e o que da progresso e previa —, entao
 * desistir de mandar deixa bytes pagos e sem dono no armazenamento. Sem esta
 * faxina eles ficariam la para sempre, contando contra a cota de um canal por
 * um arquivo que ninguem chegou a ver.
 *
 * O armazem entra por parametro para o teste poder contar o que foi removido
 * sem subir um MinIO.
 */
export async function limparAnexosOrfaos(
  armazem: Armazem | null = armazemPadrao(),
  agora: Date = new Date(),
): Promise<number> {
  const limite = new Date(agora.getTime() - IDADE_DO_ORFAO_MS)

  const orfaos = await db.delete(attachments)
    .where(and(isNull(attachments.messageId), lt(attachments.createdAt, limite)))
    .returning({ objectKey: attachments.objectKey, thumbKey: attachments.thumbKey })

  if (orfaos.length === 0) return 0

  const chaves = orfaos.flatMap(o => o.thumbKey === null ? [o.objectKey] : [o.objectKey, o.thumbKey])
  try {
    await armazem?.remover(chaves)
  } catch (err) {
    // A linha ja saiu do banco, que e o que faz a cota voltar a ser verdadeira.
    // Um objeto que sobrou no armazenamento e disco desperdicado, e nao um
    // erro que alguem ve: registrar e seguir e melhor que abortar a faxina.
    logger.warn({ err, chaves: chaves.length }, 'orfaos removidos do banco, nao do armazenamento')
  }
  return orfaos.length
}

/**
 * Agenda a limpeza dentro do proprio processo da API.
 *
 * Para dez pessoas, um cron externo seria cerimonia sem retorno: mais uma peca
 * para instalar, monitorar e esquecer. O `unref` garante que este timer nunca
 * segure o processo em pe na hora de desligar.
 */
export function agendarLimpeza(): NodeJS.Timeout {
  const relogio = setInterval(() => {
    void limparSessoesExpiradas()
      .then(n => { if (n > 0) logger.info({ removidas: n }, 'sessoes expiradas removidas') })
      .catch(err => logger.error({ err }, 'falha na limpeza de sessoes'))

    // Independentes de proposito: uma falha na faxina de anexos nao pode
    // impedir a de sessoes, que e a que tem consequencia de seguranca.
    void limparAnexosOrfaos()
      .then(n => { if (n > 0) logger.info({ removidos: n }, 'anexos orfaos removidos') })
      .catch(err => logger.error({ err }, 'falha na limpeza de anexos'))
  }, INTERVALO_DE_LIMPEZA_MS)
  relogio.unref()
  return relogio
}

if (process.argv[1]?.includes('cleanup')) {
  const removidas = await limparSessoesExpiradas()
  console.log(`Sessoes expiradas removidas: ${removidas}`)
  const orfaos = await limparAnexosOrfaos()
  console.log(`Anexos orfaos removidos: ${orfaos}`)
  process.exit(0)
}
