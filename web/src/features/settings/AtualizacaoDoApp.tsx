import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { nativo } from '../../lib/nativo.js'
import type { EstadoDaAtualizacao } from '../../lib/nativo.js'
import { Botao } from '../../ui/Botao.js'

/**
 * A versao do app de Windows e o que a atualizacao automatica esta fazendo.
 *
 * So MOSTRA. A decisao de produto e atualizar sozinho, sem perguntar: o app
 * baixa em segundo plano e instala quando a pessoa fecha o Altcast. Esta secao
 * existe para quem quer saber em que versao esta ou forcar uma procura.
 *
 * No navegador, e em app antigo (sem a ponte de atualizacao), nao aparece.
 */
export function textoDaAtualizacao(estado: EstadoDaAtualizacao): string {
  switch (estado.fase) {
    case 'indisponivel': return 'A atualização automática só funciona no app instalado.'
    case 'parado': return 'A atualização automática está ligada.'
    case 'procurando': return 'Procurando atualização…'
    case 'em-dia': return 'Você está na versão mais recente.'
    case 'baixando': return `Baixando a versão ${estado.versao}… ${String(estado.progresso)}%`
    case 'pronta': return `Versão ${estado.versao} baixada. Ela é instalada sozinha quando você fechar o Altcast.`
    case 'erro': return 'Não foi possível procurar atualização agora. O app tenta de novo sozinho.'
  }
}

export function AtualizacaoDoApp(): ReactNode {
  const ponte = nativo()?.atualizacao
  const [versao, setVersao] = useState<string | null>(null)
  const [estado, setEstado] = useState<EstadoDaAtualizacao | null>(null)

  useEffect(() => {
    if (ponte === undefined) return
    let vigente = true
    ponte.ler()
      .then(l => {
        if (!vigente || l === null) return
        setVersao(l.versao)
        setEstado(l.estado)
      })
      .catch(() => undefined)
    const soltar = ponte.aoMudar(e => { if (vigente) setEstado(e) })
    return () => {
      vigente = false
      soltar()
    }
  }, [ponte])

  if (ponte === undefined || versao === null || estado === null) return null

  const ocupado = estado.fase === 'procurando' || estado.fase === 'baixando'

  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        App de Windows
      </h2>
      <p className="text-sm text-fg">Versão {versao}</p>
      <p role="status" className="mb-3 mt-0.5 text-[13px] text-fg-muted">
        {textoDaAtualizacao(estado)}
      </p>
      {estado.fase !== 'indisponivel' && estado.fase !== 'pronta' && (
        <Botao
          variante="discreto" tamanho="sm" disabled={ocupado}
          onClick={() => { ponte.procurar().catch(() => undefined) }}
        >
          Procurar atualização
        </Botao>
      )}
    </div>
  )
}
