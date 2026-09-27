import { create } from 'zustand'
import type { Anexo } from '../../lib/tipos.js'

/**
 * O que cada canal tem por escrever: texto, citacao e arquivos.
 *
 * Mora fora do composer — e fora da store principal — por um defeito concreto:
 * o texto vivia num `useState` do `Composer`, e o `Composer` nao era remontado
 * na troca de canal. Escrever em #geral, trocar para #avisos e apertar Enter
 * mandava a frase para o canal errado, com o anexo de #geral junto. A
 * conversa e a unidade do rascunho, entao o rascunho e indexado pelo canal.
 *
 * Os envios em andamento moram aqui tambem, e nao no componente: trocar de
 * canal no meio de um upload de 20 MB nao pode cancela-lo nem esconder o seu
 * progresso para sempre. Cada envio carrega o canal em que nasceu, e so sai
 * junto com uma mensagem daquele canal.
 */

export type Resposta = { id: string; autor: string; trecho: string }

export type Rascunho = {
  texto: string
  resposta: Resposta | null
}

/** Um arquivo escolhido, do clique ate virar anexo. */
export type EnvioDeArquivo = {
  /**
   * A chave e local e nao vem do servidor: o item precisa de identidade na
   * lista ANTES de existir no banco, senao a barra de progresso nao teria a
   * que se prender e a remocao removeria o item errado.
   */
  chave: string
  channelId: string
  nome: string
  tamanho: number
  progresso: number
  anexo: Anexo | null
  erro: string | null
}

type EstadoDosRascunhos = {
  rascunhos: Record<string, Rascunho>
  envios: EnvioDeArquivo[]
  definirTexto: (channelId: string, texto: string) => void
  definirResposta: (channelId: string, resposta: Resposta | null) => void
  /** Esvazia o rascunho do canal: texto, citacao e os anexos PRONTOS dele. */
  esvaziar: (channelId: string) => void
  acrescentarEnvio: (envio: EnvioDeArquivo) => void
  mexerNoEnvio: (chave: string, mudanca: Partial<EnvioDeArquivo>) => void
  tirarEnvio: (chave: string) => void
}

const VAZIO: Rascunho = { texto: '', resposta: null }

/**
 * Onde o rascunho sobrevive a um F5.
 *
 * `sessionStorage`, e nao `localStorage`: o rascunho e da ABA. Duas abas no
 * mesmo canal escrevendo coisas diferentes e legitimo, e uma sobrescrever a
 * outra seria perder texto sem aviso.
 */
const CHAVE_DE_ARMAZENAMENTO = 'altcast:rascunhos'

/**
 * Le o que ficou guardado. Qualquer falha — armazenamento bloqueado, aba
 * anonima, JSON corrompido — vira "nada guardado": perder um rascunho num
 * modo privado e aceitavel, derrubar o chat por causa dele nao e.
 */
function lerGuardados(): { rascunhos: Record<string, Rascunho>; anexos: EnvioDeArquivo[] } {
  try {
    const bruto = sessionStorage.getItem(CHAVE_DE_ARMAZENAMENTO)
    if (bruto === null) return { rascunhos: {}, anexos: [] }
    const lido = JSON.parse(bruto) as {
      rascunhos?: Record<string, Rascunho>
      anexos?: EnvioDeArquivo[]
    }
    return {
      rascunhos: lido.rascunhos ?? {},
      // So o que ja estava pronto volta: um upload interrompido pelo F5
      // morreu com a pagina, e mostra-lo "enviando" seria mentir.
      anexos: (lido.anexos ?? []).filter(e => e.anexo !== null && e.erro === null),
    }
  } catch {
    return { rascunhos: {}, anexos: [] }
  }
}

function guardar(estado: Pick<EstadoDosRascunhos, 'rascunhos' | 'envios'>): void {
  try {
    const rascunhos = Object.fromEntries(
      Object.entries(estado.rascunhos)
        .filter(([, r]) => r.texto !== '' || r.resposta !== null),
    )
    const anexos = estado.envios.filter(e => e.anexo !== null && e.erro === null)
    sessionStorage.setItem(CHAVE_DE_ARMAZENAMENTO, JSON.stringify({ rascunhos, anexos }))
  } catch {
    // Cheio ou bloqueado: o rascunho continua vivo em memoria nesta aba.
  }
}

const iniciais = lerGuardados()

export const useRascunhos = create<EstadoDosRascunhos>((set, get) => {
  const mudar = (parcial: Partial<Pick<EstadoDosRascunhos, 'rascunhos' | 'envios'>>): void => {
    set(parcial)
    guardar(get())
  }

  return {
    rascunhos: iniciais.rascunhos,
    envios: iniciais.anexos,

    definirTexto: (channelId, texto) => {
      const atual = get().rascunhos[channelId] ?? VAZIO
      mudar({ rascunhos: { ...get().rascunhos, [channelId]: { ...atual, texto } } })
    },

    definirResposta: (channelId, resposta) => {
      const atual = get().rascunhos[channelId] ?? VAZIO
      mudar({ rascunhos: { ...get().rascunhos, [channelId]: { ...atual, resposta } } })
    },

    esvaziar: channelId => {
      const { [channelId]: _saiu, ...resto } = get().rascunhos
      mudar({
        rascunhos: resto,
        // Os que ainda estao subindo ficam: a pessoa mandou a mensagem sem
        // eles, e o proximo envio do canal os leva quando terminarem.
        envios: get().envios.filter(e => !(e.channelId === channelId && e.anexo !== null)),
      })
    },

    acrescentarEnvio: envio => { mudar({ envios: [...get().envios, envio] }) },

    mexerNoEnvio: (chave, mudanca) => {
      // Progresso nao vai para o armazenamento: dezenas de escritas por
      // segundo em `sessionStorage` por um numero que o F5 descarta de todo
      // jeito. So o fim do envio muda o que vale a pena guardar.
      const envios = get().envios.map(e => e.chave === chave ? { ...e, ...mudanca } : e)
      if (Object.keys(mudanca).every(k => k === 'progresso')) set({ envios })
      else mudar({ envios })
    },

    tirarEnvio: chave => { mudar({ envios: get().envios.filter(e => e.chave !== chave) }) },
  }
})

/** Referencia estavel para canal sem rascunho, pelo mesmo motivo do `VAZIO` da lista. */
export const RASCUNHO_VAZIO: Rascunho = VAZIO

/**
 * Cancelamentos dos uploads em curso, por chave.
 *
 * Fora do zustand de proposito: uma funcao nao serializa, e o estado acima vai
 * para o `sessionStorage`. O mapa so vive enquanto a pagina vive — que e
 * exatamente o tempo de vida de um XMLHttpRequest.
 */
export const cancelamentos = new Map<string, () => void>()
