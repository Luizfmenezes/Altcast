import { useId, useRef, useState } from 'react'
import type {
  ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent, ReactNode, RefObject,
} from 'react'
import { Paperclip, SendHorizontal, X } from 'lucide-react'
import { useStore } from '../../lib/store.js'
import {
  MAXIMO_POR_MENSAGEM, descartarAnexo, enviarArquivo, formatarTamanho,
} from '../../lib/anexos.js'
import type { Membro } from '../../lib/tipos.js'
import { LIMITE_DE_CARACTERES, enviarMensagem } from './envio.js'
import {
  RASCUNHO_VAZIO, cancelamentos, useRascunhos, type EnvioDeArquivo,
} from './rascunhos.js'
import { Mencoes, candidatosDeMencao, idDaOpcao } from './Mencoes.js'

let proximaChave = 0

/** Spec 04 secao 9: o cliente emite `typing` no maximo a cada 3 segundos. */
const INTERVALO_DE_TYPING_MS = 3000

/** Contador so aparece perto do limite; mostra-lo sempre seria ruido. */
const AVISAR_A_PARTIR_DE = 3800

/** Referencia estavel para canal sem envios, pelo mesmo motivo do `VAZIO` da lista. */
const SEM_ENVIOS: EnvioDeArquivo[] = []

/**
 * O `@` que ainda esta sendo escrito, no ponto onde o cursor esta.
 *
 * Casa so o trecho IMEDIATAMENTE antes do cursor: um `@` escrito tres frases
 * atras nao pode reabrir a lista enquanto a pessoa digita outra coisa. E como
 * a classe exclui espaco, a lista fecha sozinha assim que o nome termina.
 */
const MENCAO_PARCIAL = /(?:^|\s)@([^\s@]*)$/

/**
 * Campo de escrita.
 *
 * Enter envia e Shift+Enter quebra linha - a convencao da categoria, e trocar
 * isso obrigaria a reaprender o gesto mais repetido do dia. Com a lista de
 * mencao aberta, Enter e Tab completam: mandar "@An" cru, com a sugestao
 * certa na tela, era o defeito mais irritante do campo.
 *
 * O texto, a citacao e os arquivos pertencem ao CANAL, e moram em
 * `rascunhos.ts`. O componente so desenha o rascunho do canal ativo.
 */
export function Composer({
  campo, aoDigitar, aoFocar, aoDesfocar, desativado,
}: {
  campo: RefObject<HTMLTextAreaElement | null>
  aoDigitar?: () => void
  aoFocar?: () => void
  aoDesfocar?: () => void
  desativado?: boolean
}): ReactNode {
  const canalAtivo = useStore(e => e.canalAtivo)
  const grupoDoCanal = useStore(
    e => e.channels.find(c => c.id === e.canalAtivo)?.groupId ?? null,
  )
  const members = useStore(e => e.members)
  const eu = useStore(e => e.user?.id ?? null)

  const rascunho = useRascunhos(
    e => canalAtivo === null ? RASCUNHO_VAZIO : e.rascunhos[canalAtivo] ?? RASCUNHO_VAZIO,
  )
  const todosOsEnvios = useRascunhos(e => e.envios)
  const pendentes = canalAtivo === null
    ? SEM_ENVIOS
    : todosOsEnvios.filter(p => p.channelId === canalAtivo)
  const {
    definirTexto, definirResposta, esvaziar, acrescentarEnvio, mexerNoEnvio, tirarEnvio,
  } = useRascunhos.getState()

  const texto = rascunho.texto
  const respondendo = rascunho.resposta

  const [arrastando, setArrastando] = useState(false)
  const [cursor, setCursor] = useState(texto.length)
  const [ativo, setAtivo] = useState(0)
  /** O trecho em que a pessoa apertou Esc: a lista so volta se ele mudar. */
  const [fechadaEm, setFechadaEm] = useState<string | null>(null)
  const seletor = useRef<HTMLInputElement>(null)
  const ultimoTyping = useRef(0)
  const idDaLista = useId()

  const excedeu = texto.length > LIMITE_DE_CARACTERES
  const prontos = pendentes.filter(p => p.anexo !== null)
  const subindo = pendentes.some(p => p.anexo === null && p.erro === null)
  // Foto sem legenda e mensagem legitima — o servidor aceita —, mas esperar o
  // upload terminar nao e opcional: mandar antes prenderia zero anexos e a
  // mensagem sairia sem o arquivo que era o motivo dela.
  const podeEnviar = (texto.trim() !== '' || prontos.length > 0)
    && !excedeu && !subindo && canalAtivo !== null

  const parcial = MENCAO_PARCIAL.exec(texto.slice(0, cursor))
  const trecho = parcial?.[1] ?? null
  const candidatos = trecho === null || trecho === fechadaEm || grupoDoCanal === null
    ? []
    : candidatosDeMencao(members, grupoDoCanal, trecho, eu)
  const listaAberta = candidatos.length > 0
  const indiceAtivo = Math.min(ativo, Math.max(candidatos.length - 1, 0))

  function anexar(arquivos: FileList | File[]): void {
    if (canalAtivo === null) return
    // O canal fica preso ao envio no momento do clique. E o que impede o
    // arquivo escolhido em #geral de sair numa mensagem de #avisos.
    const canal = canalAtivo
    const espaco = MAXIMO_POR_MENSAGEM - pendentes.length
    for (const arquivo of [...arquivos].slice(0, Math.max(0, espaco))) {
      const chave = `p${String(proximaChave++)}`
      const envio = enviarArquivo(canal, arquivo, fracao => {
        mexerNoEnvio(chave, { progresso: fracao })
      })
      cancelamentos.set(chave, envio.cancelar)

      acrescentarEnvio({
        chave, channelId: canal, nome: arquivo.name, tamanho: arquivo.size,
        progresso: 0, anexo: null, erro: null,
      })

      void envio.pronto
        .then(anexo => { mexerNoEnvio(chave, { anexo }) })
        .catch((erro: { code: string; message: string }) => {
          // Cancelar foi decisao da pessoa: some da lista em vez de virar erro.
          if (erro.code === 'cancelado') tirarEnvio(chave)
          else mexerNoEnvio(chave, { erro: erro.message })
        })
        .finally(() => { cancelamentos.delete(chave) })
    }
  }

  function tirar(chave: string): void {
    const alvo = pendentes.find(p => p.chave === chave)
    if (alvo === undefined) return
    // Ainda subindo: abortar. Ja no servidor: descartar o orfao.
    if (alvo.anexo === null) cancelamentos.get(chave)?.()
    else void descartarAnexo(alvo.anexo.id)
    tirarEnvio(chave)
  }

  function aoEscolherArquivo(evento: ChangeEvent<HTMLInputElement>): void {
    const escolhidos = evento.target.files
    if (escolhidos !== null) anexar(escolhidos)
    // Zerar permite escolher o MESMO arquivo de novo: sem isto o segundo
    // clique no mesmo nome nao dispara evento nenhum.
    evento.target.value = ''
  }

  function enviar(): void {
    if (!podeEnviar || canalAtivo === null) return
    const conteudo = texto.trim()
    const anexos = prontos.map(p => p.anexo!)
    const replyToId = respondendo?.id
    // Limpar antes de esperar a rede: o eco ja segurou o texto, e o campo
    // pronto para a proxima frase e o que faz a conversa fluir.
    esvaziar(canalAtivo)
    setCursor(0)
    void enviarMensagem(canalAtivo, conteudo, undefined, anexos, replyToId)
  }

  function completar(membro: Membro): void {
    if (parcial === null || canalAtivo === null) return
    // Substitui so o trecho parcial e preserva o que veio antes E depois do
    // cursor: reescrever o campo inteiro perderia a frase em andamento.
    const inicio = cursor - parcial[1]!.length
    const inserido = `${membro.displayName} `
    const novo = `${texto.slice(0, inicio)}${inserido}${texto.slice(cursor)}`
    definirTexto(canalAtivo, novo)
    const posicao = inicio + inserido.length
    setCursor(posicao)
    setAtivo(0)
    // O cursor so pode ser posto depois de o React escrever o valor novo.
    requestAnimationFrame(() => {
      campo.current?.focus()
      campo.current?.setSelectionRange(posicao, posicao)
    })
  }

  /**
   * Colar imagem com Ctrl+V.
   *
   * Só intercepta quando ha ARQUIVO na area de transferencia: colar texto
   * precisa continuar colando texto, e uma captura de tela colada por engano
   * como nome de arquivo seria pior que nao ter o recurso.
   */
  function aoColar(evento: ClipboardEvent<HTMLTextAreaElement>): void {
    const arquivos = [...evento.clipboardData.files]
    if (arquivos.length === 0) return
    evento.preventDefault()
    anexar(arquivos)
  }

  function aoSoltar(evento: DragEvent<HTMLDivElement>): void {
    evento.preventDefault()
    setArrastando(false)
    if (evento.dataTransfer.files.length > 0) anexar(evento.dataTransfer.files)
  }

  function aoTeclar(evento: KeyboardEvent<HTMLTextAreaElement>): void {
    if (listaAberta) {
      if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
        evento.preventDefault()
        const passo = evento.key === 'ArrowDown' ? 1 : -1
        // Da a volta nas pontas, como todo listbox: a lista tem no maximo
        // oito itens, e parar no fim obrigaria a subir tudo de novo.
        setAtivo((indiceAtivo + passo + candidatos.length) % candidatos.length)
        return
      }
      if ((evento.key === 'Enter' && !evento.shiftKey) || evento.key === 'Tab') {
        evento.preventDefault()
        completar(candidatos[indiceAtivo]!)
        return
      }
      if (evento.key === 'Escape') {
        // So a lista fecha. Sem o `stopPropagation` o mesmo Esc fecharia
        // tambem a gaveta ou a paleta por baixo — duas camadas por uma tecla.
        evento.preventDefault()
        evento.stopPropagation()
        setFechadaEm(trecho)
        return
      }
    }
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault()
      enviar()
    }
  }

  function aoMudar(valor: string, posicao: number): void {
    if (canalAtivo === null) return
    definirTexto(canalAtivo, valor)
    setCursor(posicao)
    setAtivo(0)
    setFechadaEm(null)
    // Estrangular no cliente: um evento por tecla digitada inundaria o socket
    // com a informacao menos valiosa que ele carrega.
    const agora = Date.now()
    if (agora - ultimoTyping.current >= INTERVALO_DE_TYPING_MS) {
      ultimoTyping.current = agora
      aoDigitar?.()
    }
  }

  return (
    <div
      className={`border-t ${arrastando ? 'border-accent bg-bg-raised' : 'border-border-subtle'}`}
      style={{ padding: 'var(--space-gutter)' }}
      // `dragover` precisa do preventDefault para o navegador parar de tratar
      // o arquivo como navegacao e abri-lo numa aba por cima da conversa.
      onDragOver={e => { e.preventDefault(); setArrastando(true) }}
      onDragLeave={() => { setArrastando(false) }}
      onDrop={aoSoltar}
    >
      {pendentes.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {pendentes.map(p => (
            <li
              key={p.chave}
              className="flex items-center gap-2 rounded border border-border-subtle
                         bg-bg-raised px-2 py-1 text-xs"
            >
              <span className="min-w-0 flex-1 truncate text-fg">{p.nome}</span>
              <span className="numerico font-mono text-xs text-fg-muted">
                {formatarTamanho(p.tamanho)}
              </span>

              {p.erro !== null ? (
                <span className="text-danger">{p.erro}</span>
              ) : p.anexo === null ? (
                <span
                  role="progressbar"
                  aria-label={`Enviando ${p.nome}`}
                  aria-valuenow={Math.round(p.progresso * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1.5 w-20 overflow-hidden rounded bg-border-subtle"
                >
                  <span
                    className="block h-full bg-accent transition-[width]"
                    style={{ width: `${String(Math.round(p.progresso * 100))}%` }}
                  />
                </span>
              ) : (
                <span className="text-fg-muted">pronto</span>
              )}

              <button
                type="button"
                onClick={() => { tirar(p.chave) }}
                aria-label={`Tirar ${p.nome}`}
                className="rounded p-0.5 text-fg-muted hover:text-fg"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <label htmlFor="composer" className="sr-only">Escrever mensagem</label>
      {/*
        A quem se responde, mostrado ANTES do campo.

        Sem esta linha a citacao seria invisivel: a pessoa nao teria como saber
        que ainda esta respondendo a algo de tres minutos atras, nem como
        desfazer.
      */}
      {respondendo !== null && (
        <div
          className="mb-1 flex items-center gap-2 rounded border-l-2 border-accent
                     bg-bg-raised px-2 py-1 text-xs text-fg-muted"
        >
          <span className="min-w-0 truncate">
            Respondendo a <span className="font-medium text-fg">{respondendo.autor}</span>
            : {respondendo.trecho}
          </span>
          <button
            type="button"
            onClick={() => { if (canalAtivo !== null) definirResposta(canalAtivo, null) }}
            aria-label="Cancelar resposta"
            className="ml-auto shrink-0 rounded px-1 text-fg-muted hover:text-fg"
          >
            Cancelar
          </button>
        </div>
      )}

      <div className="relative">
        <textarea
          id="composer"
          ref={campo}
          rows={2}
          value={texto}
          disabled={desativado ?? false}
          // Sem `role="combobox"`: a ARIA em HTML nao permite papel nenhum em
          // `textarea`. O papel implicito de caixa de texto aceita
          // `aria-autocomplete` e `aria-activedescendant`, que e o que o leitor
          // de tela precisa para seguir a opcao ativa sem tirar o foco daqui.
          aria-autocomplete="list"
          aria-controls={listaAberta ? idDaLista : undefined}
          aria-activedescendant={listaAberta ? idDaOpcao(idDaLista, indiceAtivo) : undefined}
          aria-invalid={excedeu ? true : undefined}
          aria-describedby={texto.length >= AVISAR_A_PARTIR_DE ? 'contador' : undefined}
          onChange={e => { aoMudar(e.target.value, e.target.selectionStart) }}
          onSelect={e => { setCursor(e.currentTarget.selectionStart) }}
          onKeyDown={aoTeclar}
          onFocus={aoFocar}
          onBlur={aoDesfocar}
          onPaste={aoColar}
          placeholder="Escrever..."
          className="w-full resize-none rounded-md border border-border bg-bg-sunken px-3 py-2
                     text-corpo text-fg placeholder:text-fg-muted
                     max-md:rounded-[22px] max-md:px-4 max-md:py-2.5"
        />
        <Mencoes
          id={idDaLista}
          candidatos={candidatos}
          ativo={indiceAtivo}
          aoEscolher={completar}
          aoApontar={setAtivo}
        />
      </div>

      <div className="mt-1 flex items-center gap-2">
        {/*
          O campo de arquivo real fica escondido porque nao ha como estiliza-lo
          de forma consistente entre navegadores. O botao visivel e quem tem
          rotulo e foco; o campo so guarda o estado e abre o dialogo.

          Fora da arvore de acessibilidade de proposito: `aria-hidden` com
          `tabIndex={-1}` tira do caminho um controle que duplicaria o botao ao
          lado. Sem isso a varredura axe acusa campo sem rotulo — e rotular os
          dois faria o leitor de tela anunciar "anexar arquivo" duas vezes
          seguidas, com so um deles funcionando ao ser ativado.
        */}
        <input
          ref={seletor}
          type="file"
          multiple
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
          onChange={aoEscolherArquivo}
        />
        <button
          type="button"
          onClick={() => seletor.current?.click()}
          disabled={(desativado ?? false) || pendentes.length >= MAXIMO_POR_MENSAGEM}
          aria-label="Anexar arquivo"
          title={pendentes.length >= MAXIMO_POR_MENSAGEM
            ? `No máximo ${String(MAXIMO_POR_MENSAGEM)} arquivos por mensagem`
            : 'Anexar arquivo'}
          className="rounded p-1.5 text-fg-muted hover:text-fg disabled:cursor-not-allowed
                     disabled:opacity-50"
        >
          <Paperclip aria-hidden="true" className="size-4" />
        </button>

        {subindo && (
          // `polite` e nao `assertive`: o aviso nao pode interromper quem esta
          // digitando a legenda da propria foto.
          <p role="status" className="text-xs text-fg-muted">
            Enviando arquivo…
          </p>
        )}

        {/*
          No celular, um botao de enviar. O teclado de toque nao tem Shift, e o
          Enter dele e o lugar natural de quebrar linha; esperar que a pessoa
          descubra que "pular linha" envia seria esconder a acao principal.
          Acima de md continua o Enter, como em todo chat de desktop.
        */}
        <button
          type="button"
          onClick={enviar}
          disabled={!podeEnviar || canalAtivo === null}
          aria-label="Enviar mensagem"
          className="ml-auto flex size-11 items-center justify-center rounded-full bg-accent
                     text-accent-fg transition-transform active:scale-95 disabled:opacity-40 md:hidden"
        >
          <SendHorizontal aria-hidden="true" className="size-5" />
        </button>
      </div>

      {texto.length >= AVISAR_A_PARTIR_DE && (
        <p
          id="contador"
          className={`numerico mt-1 text-right font-mono text-xs ${
            excedeu ? 'text-danger' : 'text-fg-muted'
          }`}
        >
          {texto.length} / {LIMITE_DE_CARACTERES}
        </p>
      )}
    </div>
  )
}
