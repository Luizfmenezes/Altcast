import { useRef, useState } from 'react'
import type {
  ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent, ReactNode, RefObject,
} from 'react'
import { Paperclip, X } from 'lucide-react'
import { useStore } from '../../lib/store.js'
import {
  MAXIMO_POR_MENSAGEM, descartarAnexo, enviarArquivo, formatarTamanho,
} from '../../lib/anexos.js'
import type { Anexo } from '../../lib/tipos.js'
import { LIMITE_DE_CARACTERES, enviarMensagem } from './envio.js'

/**
 * Um arquivo escolhido, do clique ate virar anexo.
 *
 * A chave e local e nao vem do servidor: o item precisa de identidade na lista
 * ANTES de existir no banco, senao a barra de progresso nao teria a que se
 * prender e a remocao removeria o item errado.
 */
type Pendente = {
  chave: string
  nome: string
  tamanho: number
  progresso: number
  anexo: Anexo | null
  erro: string | null
  cancelar: () => void
}

let proximaChave = 0

/** Spec 04 secao 9: o cliente emite `typing` no maximo a cada 3 segundos. */
const INTERVALO_DE_TYPING_MS = 3000

/** Contador so aparece perto do limite; mostra-lo sempre seria ruido. */
const AVISAR_A_PARTIR_DE = 3800

/**
 * Campo de escrita.
 *
 * Enter envia e Shift+Enter quebra linha - a convencao da categoria, e trocar
 * isso obrigaria a reaprender o gesto mais repetido do dia.
 */
export function Composer({ campo, aoDigitar, aoFocar, aoDesfocar, desativado }: {
  campo: RefObject<HTMLTextAreaElement | null>
  aoDigitar?: () => void
  aoFocar?: () => void
  aoDesfocar?: () => void
  desativado?: boolean
}): ReactNode {
  const canalAtivo = useStore(e => e.canalAtivo)
  const [texto, setTexto] = useState('')
  const [pendentes, setPendentes] = useState<Pendente[]>([])
  const [arrastando, setArrastando] = useState(false)
  const seletor = useRef<HTMLInputElement>(null)
  const ultimoTyping = useRef(0)

  const excedeu = texto.length > LIMITE_DE_CARACTERES
  const prontos = pendentes.filter(p => p.anexo !== null)
  const subindo = pendentes.some(p => p.anexo === null && p.erro === null)
  // Foto sem legenda e mensagem legitima — o servidor aceita —, mas esperar o
  // upload terminar nao e opcional: mandar antes prenderia zero anexos e a
  // mensagem sairia sem o arquivo que era o motivo dela.
  const podeEnviar = (texto.trim() !== '' || prontos.length > 0)
    && !excedeu && !subindo && canalAtivo !== null

  function anexar(arquivos: FileList | File[]): void {
    if (canalAtivo === null) return
    const espaco = MAXIMO_POR_MENSAGEM - pendentes.length
    for (const arquivo of [...arquivos].slice(0, Math.max(0, espaco))) {
      const chave = `p${String(proximaChave++)}`
      const envio = enviarArquivo(canalAtivo, arquivo, fracao => {
        setPendentes(atual => atual.map(p => p.chave === chave ? { ...p, progresso: fracao } : p))
      })

      setPendentes(atual => [...atual, {
        chave, nome: arquivo.name, tamanho: arquivo.size,
        progresso: 0, anexo: null, erro: null, cancelar: envio.cancelar,
      }])

      void envio.pronto
        .then(anexo => {
          setPendentes(atual => atual.map(p => p.chave === chave ? { ...p, anexo } : p))
        })
        .catch((erro: { code: string; message: string }) => {
          // Cancelar foi decisao da pessoa: some da lista em vez de virar erro.
          if (erro.code === 'cancelado') {
            setPendentes(atual => atual.filter(p => p.chave !== chave))
            return
          }
          setPendentes(atual => atual.map(
            p => p.chave === chave ? { ...p, erro: erro.message } : p,
          ))
        })
    }
  }

  function tirar(chave: string): void {
    const alvo = pendentes.find(p => p.chave === chave)
    if (alvo === undefined) return
    // Ainda subindo: abortar. Ja no servidor: descartar o orfao.
    if (alvo.anexo === null) alvo.cancelar()
    else void descartarAnexo(alvo.anexo.id)
    setPendentes(atual => atual.filter(p => p.chave !== chave))
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
    // Limpar antes de esperar a rede: o eco ja segurou o texto, e o campo
    // pronto para a proxima frase e o que faz a conversa fluir.
    setTexto('')
    setPendentes([])
    void enviarMensagem(canalAtivo, conteudo, undefined, anexos)
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
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault()
      enviar()
    }
  }

  function aoMudar(valor: string): void {
    setTexto(valor)
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
              <span className="font-mono text-[11px] text-fg-muted">
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
      <textarea
        id="composer"
        ref={campo}
        rows={2}
        value={texto}
        disabled={desativado ?? false}
        aria-invalid={excedeu ? true : undefined}
        aria-describedby={texto.length >= AVISAR_A_PARTIR_DE ? 'contador' : undefined}
        onChange={e => aoMudar(e.target.value)}
        onKeyDown={aoTeclar}
        onFocus={aoFocar}
        onBlur={aoDesfocar}
        onPaste={aoColar}
        placeholder="Escrever..."
        className="w-full resize-none rounded border border-border bg-bg px-3 py-2 text-sm
                   text-fg placeholder:text-fg-muted"
      />

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
            ? `No maximo ${String(MAXIMO_POR_MENSAGEM)} arquivos por mensagem`
            : 'Anexar arquivo'}
          className="rounded p-1.5 text-fg-muted hover:text-fg disabled:cursor-not-allowed
                     disabled:opacity-50"
        >
          <Paperclip aria-hidden="true" className="size-4" />
        </button>

        {subindo && (
          // `polite` e nao `assertive`: o aviso nao pode interromper quem esta
          // digitando a legenda da propria foto.
          <p role="status" className="text-[11px] text-fg-muted">
            Enviando arquivo...
          </p>
        )}
      </div>

      {texto.length >= AVISAR_A_PARTIR_DE && (
        <p
          id="contador"
          className={`mt-1 text-right font-mono text-[11px] ${
            excedeu ? 'text-danger' : 'text-fg-muted'
          }`}
        >
          {texto.length} / {LIMITE_DE_CARACTERES}
        </p>
      )}
    </div>
  )
}
