import type { ReactNode } from 'react'
import { Mic, MicOff, MonitorUp, Video, VideoOff, PhoneOff, Volume2 } from 'lucide-react'
import { Botao } from '../../ui/Botao.js'
import { useStore } from '../../lib/store.js'
import { ControleDeVolume, FaixaDeMidia } from './FaixaDeMidia.js'
import { useChamada } from './useChamada.js'
import { ConfiguracaoDeMidia } from './ConfiguracaoDeMidia.js'
import { chaveDeVolume } from '../../lib/midia.js'
import type { ParticipanteDeVoz } from '../../lib/store.js'
import type { PapelSonoro } from '../../lib/midia.js'

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
    destravarAudio, definirVolume, definirQualidade,
  } = useChamada(channelId)
  const participantes = useStore(e => e.chamadas[channelId]) ?? NINGUEM
  const members = useStore(e => e.members)
  const eu = useStore(e => e.user)

  const nomeDe = (userId: string): string =>
    userId === eu?.id
      ? 'Voce'
      : members.find(m => m.userId === userId)?.displayName ?? 'Alguem'

  const dentro = estado.fase === 'dentro'
  const ehSom = (papel: string): boolean => papel === 'audio' || papel === 'audio-tela'
  const videos = estado.faixas.filter(f => !ehSom(f.papel))
  const audios = estado.faixas.filter(f => ehSom(f.papel))

  /**
   * Um volume nao ajustado e 1, e nao 0: o padrao de uma sala e todo mundo se
   * ouvindo. O `??` cobre tanto quem nunca foi ajustado quanto quem foi
   * ajustado num navegador em que o armazenamento esta bloqueado.
   */
  const volumeDe = (userId: string, papel: PapelSonoro): number =>
    estado.volumes[chaveDeVolume(userId, papel)] ?? 1

  /**
   * O som de uma tela compartilhada pertence a ELA, e nao a quem a transmite:
   * quem baixa o volume de um jogo que estao mostrando nao quer,
   * com isso, deixar de ouvir a pessoa comentando o jogo. Por isso o controle
   * do `audio-tela` mora no quadro do video, e o do microfone mora na lista de
   * participantes — sao duas fontes independentes da mesma pessoa.
   */
  const volumeDaTela = (faixa: { userId: string; papel: string; local: boolean }): {
    volume?: number
    aoMudarVolume?: (v: number) => void
  } => {
    if (faixa.papel !== 'tela' || faixa.local) return {}
    // Sem faixa de som publicada nao ha o que ajustar. Mostrar o cursor assim
    // mesmo prometeria um controle sobre um silencio.
    const temSom = audios.some(a => a.userId === faixa.userId && a.papel === 'audio-tela')
    if (!temSom) return {}
    return {
      volume: volumeDe(faixa.userId, 'audio-tela'),
      aoMudarVolume: (v: number) => { definirVolume(faixa.userId, 'audio-tela', v) },
    }
  }

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

      {/*
        O navegador segurou a reproducao. Isto e um BOTAO, e nao um aviso, por
        uma razao tecnica: a politica de autoplay so libera o som dentro de um
        gesto da pessoa, entao o unico jeito de destravar e ela clicar.
      */}
      {estado.audioBloqueado && (
        <Botao onClick={destravarAudio}>
          <Volume2 aria-hidden="true" className="size-4" />
          Ativar o som da chamada
        </Botao>
      )}

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
              {...volumeDaTela(faixa)}
            />
          ))}
        </div>
      )}

      {/* Fora da grade: audio nao ocupa espaco, so precisa existir. */}
      {audios.map(faixa => (
        <FaixaDeMidia
          key={faixa.track.sid ?? `${faixa.userId}-${faixa.papel}`}
          faixa={faixa}
          rotulo={nomeDe(faixa.userId)}
        />
      ))}

      <ul className="flex flex-col">
        {participantes.map(p => (
          <li
            key={p.userId}
            aria-label={`${nomeDe(p.userId)}, ${p.microfone ? 'microfone ligado' : 'microfone desligado'}`}
            className="group flex items-center gap-2 rounded px-2 text-sm"
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

            {/*
              O volume do MICROFONE desta pessoa. Fica na lista, e nao no
              quadro de video, porque a maior parte de uma sala de voz nao tem
              video nenhum — amarrar o controle a um quadrado deixaria sem
              ajuste justamente o caso comum.

              So aparece dentro da chamada: fora dela nao existe faixa de audio
              nenhuma, e um cursor que nao move som e pior do que a ausencia
              dele.
            */}
            {dentro && p.userId !== eu?.id && (
              <span
                className="ml-auto flex items-center opacity-0 transition-opacity
                           focus-within:opacity-100 group-hover:opacity-100
                           [@media(hover:none)]:opacity-100"
              >
                <ControleDeVolume
                  tom="lista"
                  rotulo={nomeDe(p.userId)}
                  volume={volumeDe(p.userId, 'audio')}
                  aoMudar={v => { definirVolume(p.userId, 'audio', v) }}
                />
              </span>
            )}
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
        qualidade={estado.qualidade}
        aoTrocarQualidade={definirQualidade}
        compartilhandoTela={estado.tela}
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
