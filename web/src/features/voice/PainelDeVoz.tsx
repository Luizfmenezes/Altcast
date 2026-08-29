import type { ReactNode } from 'react'
import { Mic, MicOff, MonitorUp, Video, VideoOff, PhoneOff } from 'lucide-react'
import { Botao } from '../../ui/Botao.js'
import { useStore } from '../../lib/store.js'
import { FaixaDeMidia } from './FaixaDeMidia.js'
import { useChamada } from './useChamada.js'
import { ConfiguracaoDeMidia } from './ConfiguracaoDeMidia.js'
import type { ParticipanteDeVoz } from '../../lib/store.js'

/**
 * Uma referencia estavel para "ninguem na chamada".
 *
 * Sem ela, o seletor `e.chamadas[id] ?? []` devolveria um array NOVO a cada
 * render; o zustand compara por identidade, concluiria que mudou toda vez, e o
 * componente entraria em laco infinito ate travar a aba.
 */
const NINGUEM: ParticipanteDeVoz[] = []

/**
 * O canal de voz.
 *
 * Duas listas se sobrepoem aqui de proposito. A de PARTICIPANTES vem do
 * WebSocket da API e existe mesmo para quem nao entrou na chamada — e o que
 * deixa alguem ver que a reuniao ja comecou antes de decidir entrar. A de
 * FAIXAS vem do SFU e so existe para quem entrou. Uma sala com tres pessoas
 * mostra tres nomes para quem esta de fora, e tres nomes mais os videos para
 * quem esta dentro.
 */
export function PainelDeVoz({ channelId, nomeDoCanal }: {
  channelId: string
  nomeDoCanal: string
}): ReactNode {
  const {
    estado, entrar, sair, alternarMicrofone, alternarCamera, alternarTela, trocarDispositivo,
  } = useChamada(channelId)
  const participantes = useStore(e => e.chamadas[channelId]) ?? NINGUEM
  const members = useStore(e => e.members)
  const eu = useStore(e => e.user)

  const nomeDe = (userId: string): string =>
    userId === eu?.id
      ? 'Voce'
      : members.find(m => m.userId === userId)?.displayName ?? 'Alguem'

  const dentro = estado.fase === 'dentro'
  const videos = estado.faixas.filter(f => f.papel !== 'audio')
  const audios = estado.faixas.filter(f => f.papel === 'audio')

  return (
    <section
      aria-label={`Chamada de ${nomeDoCanal}`}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
    >
      {/*
        Uma unica regiao de status para a chamada inteira. Anunciar cada entrada
        e cada camera separadamente transformaria uma reuniao de seis pessoas
        numa metralhadora de avisos.
      */}
      <p role="status" className="sr-only">
        {estado.fase === 'entrando' ? 'Entrando na chamada'
          : dentro ? `Na chamada, ${participantes.length} participantes`
            : 'Fora da chamada'}
      </p>

      {estado.erro !== null && (
        <p role="alert" className="rounded border border-danger px-3 py-2 text-sm text-danger">
          {estado.erro}
        </p>
      )}

      {participantes.length === 0 && !dentro && (
        <p className="text-sm text-fg-muted">
          Ninguem na chamada ainda. Entre para comecar.
        </p>
      )}

      {videos.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
          {videos.map(faixa => (
            <FaixaDeMidia
              key={faixa.track.sid ?? `${faixa.userId}-${faixa.papel}`}
              faixa={faixa}
              rotulo={nomeDe(faixa.userId)}
            />
          ))}
        </div>
      )}

      {/* Fora da grade: audio nao ocupa espaco, so precisa existir. */}
      {audios.map(faixa => (
        <FaixaDeMidia
          key={faixa.track.sid ?? `${faixa.userId}-audio`}
          faixa={faixa}
          rotulo={nomeDe(faixa.userId)}
        />
      ))}

      <ul className="flex flex-col">
        {participantes.map(p => (
          <li
            key={p.userId}
            aria-label={`${nomeDe(p.userId)}, ${p.microfone ? 'microfone ligado' : 'microfone desligado'}`}
            className="flex items-center gap-2 rounded px-2 text-sm"
            style={{ minHeight: 'var(--height-row)' }}
          >
            {/*
              O icone repete o que o rotulo do item ja diz, entao ele e
              decorativo: anuncia-lo de novo seria ouvir a mesma coisa duas
              vezes.
            */}
            {p.microfone
              ? <Mic aria-hidden="true" className="size-4 text-fg" />
              : <MicOff aria-hidden="true" className="size-4 text-fg-muted" />}
            <span
              className={`truncate ${estado.falando.includes(p.userId) ? 'text-accent' : 'text-fg'}`}
            >
              {nomeDe(p.userId)}
            </span>
            {p.tela && <MonitorUp aria-hidden="true" className="size-4 text-fg-muted" />}
          </li>
        ))}
      </ul>

      {/*
        Disponivel tambem FORA da chamada: escolher o microfone antes de entrar
        e o que evita a primeira frase sair pelo dispositivo errado.
      */}
      <ConfiguracaoDeMidia
        nivel={estado.nivel}
        microfoneLigado={estado.microfone}
        aoTrocar={trocarDispositivo}
      />

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
        {!dentro ? (
          <Botao onClick={entrar} disabled={estado.fase === 'entrando'}>
            {estado.fase === 'entrando' ? 'Entrando...' : 'Entrar na chamada'}
          </Botao>
        ) : (
          <>
            <Botao
              variante="discreto"
              onClick={alternarMicrofone}
              disabled={!estado.podePublicar}
              aria-pressed={estado.microfone}
              // Quem so escuta precisa saber POR QUE o botao esta apagado.
              // Um controle desabilitado sem explicacao parece defeito.
              title={estado.podePublicar ? undefined : 'Voce nao pode transmitir neste canal'}
            >
              {estado.microfone
                ? <Mic aria-hidden="true" className="size-4" />
                : <MicOff aria-hidden="true" className="size-4" />}
              {estado.microfone ? 'Microfone ligado' : 'Microfone desligado'}
            </Botao>

            <Botao
              variante="discreto"
              onClick={alternarCamera}
              disabled={!estado.podePublicar}
              aria-pressed={estado.camera}
            >
              {estado.camera
                ? <Video aria-hidden="true" className="size-4" />
                : <VideoOff aria-hidden="true" className="size-4" />}
              {estado.camera ? 'Camera ligada' : 'Camera desligada'}
            </Botao>

            <Botao
              variante="discreto"
              onClick={alternarTela}
              disabled={!estado.podePublicar}
              aria-pressed={estado.tela}
            >
              <MonitorUp aria-hidden="true" className="size-4" />
              {estado.tela ? 'Parar de compartilhar' : 'Compartilhar tela'}
            </Botao>

            <Botao variante="perigo" onClick={sair}>
              <PhoneOff aria-hidden="true" className="size-4" />
              Sair
            </Botao>
          </>
        )}
      </div>
    </section>
  )
}
