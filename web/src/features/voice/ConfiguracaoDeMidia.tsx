import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  guardarProcessamento, guardarQualidade, lerPreferencias, lerProcessamento, lerQualidade,
  listarDispositivos, QUALIDADES,
} from '../../lib/midia.js'
import type {
  Dispositivo, Processamento, QualidadeDaTela, TipoDeDispositivo,
} from '../../lib/midia.js'
import { guardarFala, lerFala } from './atalhos.js'
import type { ModoDeFala } from './atalhos.js'
import { AjusteDeSons } from './AjusteDeSons.js'

/**
 * Os tres tratamentos que o navegador aplica ao microfone.
 *
 * Cada um traz o que ele CUSTA junto do que ele resolve. Sem isso, "supressao
 * de ruido" parece um bem incondicional que ninguem desligaria — e quem
 * transmite musica passaria a tarde procurando por que o instrumento sai
 * picotado.
 */
const TRATAMENTOS: { chave: keyof Processamento; rotulo: string; nota: string }[] = [
  {
    chave: 'ruido',
    rotulo: 'Supressão de ruido',
    nota: 'Otima para voz. Desligue para transmitir música ou instrumento.',
  },
  {
    chave: 'eco',
    rotulo: 'Cancelamento de eco',
    nota: 'Indispensável sem fone de ouvido.',
  },
  {
    chave: 'ganho',
    rotulo: 'Volume automático',
    nota: 'Nivela a voz, mas levanta o chiado no silencio.',
  },
]

const ROTULOS: Record<TipoDeDispositivo, string> = {
  audioinput: 'Microfone',
  videoinput: 'Câmera',
  audiooutput: 'Saída de som',
}

const TIPOS: TipoDeDispositivo[] = ['audioinput', 'videoinput', 'audiooutput']

function Escolha({ tipo, valor, aoEscolher, dispositivos, aoPedirPermissao }: {
  tipo: TipoDeDispositivo
  valor: string
  aoEscolher: (deviceId: string) => void
  dispositivos: Dispositivo[]
  /** Ausente onde nao ha permissao a pedir (a saida de som nao tem). */
  aoPedirPermissao?: () => void
}): ReactNode {
  return (
    <div className="flex min-w-[180px] flex-1 flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-fg">{ROTULOS[tipo]}</span>
        <select
          value={valor}
          onChange={e => aoEscolher(e.target.value)}
          disabled={dispositivos.length === 0}
          className="h-9 rounded border border-border bg-bg-raised px-2 text-sm text-fg
                     disabled:cursor-not-allowed disabled:opacity-60"
        >
          {dispositivos.length === 0 && <option value="">Nenhum encontrado</option>}
          {dispositivos.map(d => (
            <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
          ))}
        </select>
      </label>
      {/*
        Lista vazia quase nunca e "nao ha microfone": e o navegador escondendo
        os aparelhos ate a pessoa conceder a permissao. "Nenhum disponivel",
        sozinho, mandava procurar defeito no fone; o botao e o passo que falta.
      */}
      {dispositivos.length === 0 && aoPedirPermissao !== undefined && (
        <button
          type="button"
          onClick={aoPedirPermissao}
          className="self-start text-xs font-medium text-accent underline underline-offset-2"
        >
          Permitir acesso {tipo === 'videoinput' ? 'à câmera' : 'ao microfone'}
        </button>
      )}
    </div>
  )
}

/**
 * Pede a permissao e solta o aparelho em seguida.
 *
 * So o PEDIDO interessa: concedida a permissao, o navegador passa a revelar os
 * aparelhos com nome. Segurar a faixa acenderia a luz da camera sem motivo.
 */
async function pedirPermissao(tipo: 'audioinput' | 'videoinput'): Promise<void> {
  try {
    const fluxo = await navigator.mediaDevices.getUserMedia(
      tipo === 'audioinput' ? { audio: true } : { video: true },
    )
    for (const faixa of fluxo.getTracks()) faixa.stop()
  } catch {
    // Negada: a lista continua vazia, e o botao continua la para a proxima
    // tentativa — que e onde o navegador mostra como desfazer a recusa.
  }
}

/**
 * A qualidade da propria tela compartilhada.
 *
 * Fica ao lado dos dispositivos porque e a mesma classe de decisao: uma
 * escolha da MAQUINA e da rede dela, tomada antes de transmitir. A banda de
 * cada opcao aparece no rotulo porque e o unico numero que permite escolher
 * com informacao — "maxima" e "leve" sozinhos nao dizem se o link aguenta.
 */
function EscolhaDeQualidade({ valor, aoEscolher, compartilhando }: {
  valor: QualidadeDaTela
  aoEscolher: (qualidade: QualidadeDaTela) => void
  compartilhando: boolean
}): ReactNode {
  const chaves = Object.keys(QUALIDADES) as QualidadeDaTela[]

  return (
    <label className="flex min-w-[180px] flex-1 flex-col gap-1">
      <span className="text-[13px] font-medium text-fg">Qualidade da minha tela</span>
      <select
        value={valor}
        onChange={e => aoEscolher(e.target.value as QualidadeDaTela)}
        // `aria-describedby` e nao `title`: o aviso de que a troca so vale na
        // proxima partilha precisa ser lido, e nao so aparecer no ponteiro.
        aria-describedby={compartilhando ? 'aviso-qualidade' : undefined}
        className="h-9 rounded border border-border bg-bg-raised px-2 text-sm text-fg"
      >
        {chaves.map(chave => (
          <option key={chave} value={chave}>
            {QUALIDADES[chave].rotulo} ({QUALIDADES[chave].bandaAproximada})
          </option>
        ))}
      </select>
      {/*
        Trocar no meio da partilha exigiria recapturar a tela, e o navegador
        perguntaria de novo qual janela mostrar — uma caixa de dialogo que
        ninguem pediu, no meio de uma apresentacao. Dizer a verdade custa uma
        linha e evita a pessoa concluir que o seletor nao funciona.
      */}
      {compartilhando && (
        <span id="aviso-qualidade" className="text-xs text-fg-muted">
          Vale quando você recomecar a compartilhar.
        </span>
      )}
    </label>
  )
}

/**
 * Medidor do que o microfone esta captando.
 *
 * A barra existe porque "o microfone esta ligado" e "estao me ouvindo" sao
 * duas coisas diferentes: o botao responde a primeira, e so o nivel responde a
 * segunda. Sem ela, descobrir que o microfone escolhido era o errado depende
 * de alguem do outro lado avisar.
 */
function Medidor({ nivel, ativo }: { nivel: number; ativo: boolean }): ReactNode {
  const porcento = Math.round(Math.min(1, Math.max(0, nivel)) * 100)

  return (
    <div className="flex min-w-[180px] flex-1 flex-col gap-1">
      <span className="text-[13px] font-medium text-fg">
        {ativo ? 'O que estão ouvindo' : 'Microfone desligado'}
      </span>
      <div
        role="meter"
        aria-label="Nivel do microfone"
        aria-valuenow={porcento}
        aria-valuemin={0}
        aria-valuemax={100}
        // O texto acompanha o valor porque uma barra que so cresce em pixels
        // nao existe para quem usa leitor de tela.
        aria-valuetext={ativo ? `${String(porcento)} por cento` : 'Microfone desligado'}
        className="h-9 overflow-hidden rounded border border-border bg-bg-raised"
      >
        <div
          className={`h-full transition-[width] duration-75 ${
            ativo ? 'bg-accent' : 'bg-transparent'}`}
          style={{ width: `${String(porcento)}%` }}
        />
      </div>
    </div>
  )
}

/**
 * Escolher microfone, camera e saida de som.
 *
 * A lista so traz os NOMES depois que o navegador concede a permissao — antes
 * disso ele devolve rotulos vazios de proposito, para que um site nao consiga
 * identificar a maquina sem pedir. Por isso a lista e relida quando o microfone
 * liga: e nesse instante que os nomes de verdade aparecem.
 */
/**
 * As preferencias de midia, com ou sem chamada em curso.
 *
 * Tudo o que esta aqui — dispositivo, qualidade, modo de fala, tratamento de
 * audio, sons — ja le e escreve `localStorage` por conta propria. Por isso
 * NENHUMA prop e obrigatoria: nas configuracoes o componente monta sozinho e
 * apenas persiste a escolha, que e o comportamento certo quando nao ha
 * chamada nenhuma para reapontar.
 *
 * Dentro da chamada, o painel de voz passa os callbacks e o medidor, e entao a
 * troca vale na hora em vez de na proxima entrada.
 *
 * Um componente so, e nao dois: uma segunda tela de dispositivos envelheceria
 * em separado e as duas acabariam discordando sobre o que esta selecionado.
 */
export function ConfiguracaoDeMidia({
  nivel = 0, microfoneLigado = false, aoTrocar, qualidade, aoTrocarQualidade,
  compartilhandoTela = false, aoRestaurarVolumes, comMedidor = true, comMoldura = true,
}: {
  nivel?: number
  microfoneLigado?: boolean
  aoTrocar?: (tipo: TipoDeDispositivo, deviceId: string) => void
  qualidade?: QualidadeDaTela
  aoTrocarQualidade?: (qualidade: QualidadeDaTela) => void
  compartilhandoTela?: boolean
  aoRestaurarVolumes?: () => void
  /** O medidor nao tem o que medir fora de uma chamada. */
  comMedidor?: boolean
  /** Dentro da chamada e um `<details>` dobravel; nas configuracoes, nao. */
  comMoldura?: boolean
} = {}): ReactNode {
  const [dispositivos, setDispositivos] = useState<Record<TipoDeDispositivo, Dispositivo[]>>({
    audioinput: [], videoinput: [], audiooutput: [],
  })
  const [escolhido, setEscolhido] = useState<Partial<Record<TipoDeDispositivo, string>>>(
    () => lerPreferencias(),
  )
  const [tratamento, setTratamento] = useState<Processamento>(lerProcessamento)
  const [fala, setFala] = useState(lerFala)
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    let vigente = true

    void Promise.all(TIPOS.map(listarDispositivos)).then(([entrada, video, saida]) => {
      if (!vigente) return
      setDispositivos({
        audioinput: entrada ?? [], videoinput: video ?? [], audiooutput: saida ?? [],
      })
    })

    return () => { vigente = false }
    // Reler quando o microfone liga: e o momento em que a permissao sai e os
    // nomes de verdade substituem os rotulos vazios. `recarga` e o mesmo
    // momento, provocado pelo botao de permissao.
  }, [microfoneLigado, recarga])

  function escolher(tipo: TipoDeDispositivo, deviceId: string): void {
    setEscolhido(atual => ({ ...atual, [tipo]: deviceId }))
    // Sem callback nao ha chamada para reapontar: a escolha fica guardada e
    // vale na proxima entrada, que e o que a propria tela ja promete.
    aoTrocar?.(tipo, deviceId)
  }

  /** O primeiro da lista e o que o navegador ja usa quando nada foi escolhido. */
  const valorDe = (tipo: TipoDeDispositivo): string =>
    escolhido[tipo] ?? dispositivos[tipo][0]?.deviceId ?? ''

  const corpo = (
    <>
      <div className="flex flex-wrap items-end gap-3 border-t border-border-subtle p-3">
        {TIPOS.map(tipo => (
          <Escolha
            key={tipo}
            tipo={tipo}
            valor={valorDe(tipo)}
            aoEscolher={id => escolher(tipo, id)}
            dispositivos={dispositivos[tipo]}
            {...(tipo === 'audiooutput' ? {} : {
              aoPedirPermissao: () => {
                void pedirPermissao(tipo).then(() => { setRecarga(n => n + 1) })
              },
            })}
          />
        ))}

        {comMedidor && <Medidor nivel={nivel} ativo={microfoneLigado} />}

        <EscolhaDeQualidade
          valor={qualidade ?? lerQualidade()}
          aoEscolher={q => { guardarQualidade(q); aoTrocarQualidade?.(q) }}
          compartilhando={compartilhandoTela}
        />

        {/*
          Como o microfone abre.

          `aberto` e o que sempre existiu. `apertar` e o push-to-talk, e o
          aviso ao lado nao e detalhe: quem liga o modo e nao sabe qual tecla
          usar conclui, com razao, que o microfone quebrou.
        */}
        <label className="flex min-w-[180px] flex-1 flex-col gap-1">
          <span className="text-[13px] font-medium text-fg">Como falar</span>
          <select
            value={fala.modo}
            onChange={e => {
              const proximo = { ...fala, modo: e.target.value as ModoDeFala }
              setFala(proximo)
              guardarFala(proximo)
            }}
            className="h-9 rounded border border-border bg-bg-raised px-2 text-sm text-fg"
          >
            <option value="aberto">Microfone aberto</option>
            <option value="apertar">Apertar para falar (barra de espaço)</option>
          </select>
          {fala.modo === 'apertar' && (
            <span className="text-xs text-fg-muted">
              Segure a barra de espaço para falar. Fora desta aba o navegador não
              entrega a tecla, e o microfone fecha sozinho.
            </span>
          )}
        </label>
      </div>

      {/*
        O tratamento do microfone.

        A troca so vale na PROXIMA entrada porque ela e aplicada na captura, e
        recapturar no meio da chamada faria o navegador pedir a permissao de
        novo. Dizer isso custa uma linha e evita a conclusao de que o
        interruptor nao funciona.
      */}
      <fieldset className="flex flex-wrap gap-4 border-t border-border-subtle p-3">
        <legend className="sr-only">Tratamento do microfone</legend>
        {TRATAMENTOS.map(({ chave, rotulo, nota }) => (
          <label key={chave} className="flex max-w-[240px] flex-col gap-1">
            <span className="flex items-center gap-2 text-[13px] font-medium text-fg">
              <input
                type="checkbox"
                checked={tratamento[chave]}
                onChange={e => {
                  const proximo = { ...tratamento, [chave]: e.target.checked }
                  setTratamento(proximo)
                  guardarProcessamento(proximo)
                }}
                className="size-4 accent-accent"
              />
              {rotulo}
            </span>
            <span className="text-xs text-fg-muted">{nota}</span>
          </label>
        ))}
        <p className="basis-full text-xs text-fg-muted">
          Vale na próxima vez que você entrar numa chamada.
        </p>
      </fieldset>

      <AjusteDeSons />

      {dispositivos.audioinput.length === 0 && (
        <p className="px-3 pb-3 text-xs text-fg-muted">
          O navegador ainda não liberou os dispositivos. Ligue o microfone uma vez
          para conceder a permissão e ver os nomes.
        </p>
      )}

      {/*
        A saida de emergencia de um defeito com uma forma muito particular: um
        volume zerado numa chamada antiga silencia alguem para SEMPRE, e viaja
        com o navegador em vez de com o codigo — nenhuma correcao do sistema o
        alcanca. Quem cai nele ouve todo mundo menos uma pessoa, e nao tem
        nenhuma razao para suspeitar de um ajuste que fez semanas atras.

        Fica aqui, junto dos dispositivos, porque e a mesma classe de decisao:
        preferencia da MAQUINA, guardada no navegador.
      */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-3 py-2">
        <button
          type="button"
          onClick={aoRestaurarVolumes}
          disabled={aoRestaurarVolumes === undefined}
          className="rounded border border-border px-2 text-sm text-fg hover:bg-bg-hover
                     focus-visible:bg-bg-hover"
          style={{ minHeight: 'var(--height-row)' }}
        >
          Restaurar volumes
        </button>
        <span className="text-xs text-fg-muted">
          Devolve todas as transmissões ao som cheio.
        </span>
      </div>
    </>
  )

  // Dentro da chamada o painel e dobravel, para nao ocupar a coluna inteira.
  // Nas configuracoes ele JA esta dentro de uma aba que alguem escolheu abrir,
  // e uma segunda dobra ali seria um clique a mais por nada.
  if (!comMoldura) return <div className="rounded border border-border-subtle">{corpo}</div>

  return (
    <details className="rounded border border-border-subtle">
      <summary className="cursor-pointer px-3 py-2 text-sm text-fg">
        Configurar dispositivos
      </summary>
      {corpo}
    </details>
  )
}

/**
 * As mesmas preferencias, fora de qualquer chamada.
 *
 * Um alias com o enquadramento certo para a aba de configuracoes: sem medidor
 * (nao ha o que medir) e sem dobra (a aba ja e a dobra). O componente por tras
 * e exatamente o mesmo, e e isso que impede as duas telas de divergirem.
 */
export function PreferenciasDeMidia(): ReactNode {
  return <ConfiguracaoDeMidia comMedidor={false} comMoldura={false} />
}
