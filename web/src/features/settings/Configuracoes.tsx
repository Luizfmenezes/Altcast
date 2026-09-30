import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Headphones, Keyboard, Settings, ShieldCheck, UserRound, Users, X } from 'lucide-react'
import { ConfiguracoesGrupo } from './ConfiguracoesGrupo.js'
import { ConfiguracoesUsuario } from './ConfiguracoesUsuario.js'
import { Perfil } from './Perfil.js'
import { PreferenciasDeMidia } from '../voice/ConfiguracaoDeMidia.js'
import { AtalhosDeVoz } from '../voice/AtalhosDeVoz.js'
import { Abas, PainelDeAba } from '../../ui/Abas.js'
import { cn } from '../../lib/utils.js'
import type { Aba as DescricaoDeAba } from '../../ui/Abas.js'
import { Botao } from '../../ui/Botao.js'
import { usaLarguraMinima } from '../../lib/pontosDeQuebra.js'
import { useDialogoDeConfiguracoes, type AbaDeConfiguracoes } from './dialogoDeConfiguracoes.js'

/**
 * Porta de entrada das configuracoes.
 *
 * O dialogo vem do Radix porque ele resolve o que uma sobreposicao manual
 * quase sempre erra: prender o foco enquanto aberta, devolve-lo ao gatilho ao
 * fechar e reagir ao Escape (SC 2.1.2).
 *
 * As abas passaram a ser abas de verdade. A versao anterior anunciava
 * `role="tab"` sem responder a seta — o que diz ao leitor de tela "use as
 * setas aqui" e depois nao cumpre.
 *
 * Trilha VERTICAL a partir de 640px: seis abas horizontais nao cabem em 320px
 * sem estourar a largura, e o teste de refluxo em 400% de zoom e implacavel
 * com isso.
 */

type Chave = AbaDeConfiguracoes

export function Configuracoes({ groupId, podeAdministrar }: {
  groupId: string | null
  podeAdministrar: boolean
}): ReactNode {
  const aberto = useDialogoDeConfiguracoes(e => e.aberto)
  const setAberto = useDialogoDeConfiguracoes(e => e.definirAberto)
  const aba = useDialogoDeConfiguracoes(e => e.aba)
  const setAba = useDialogoDeConfiguracoes(e => e.definirAba)
  const vertical = usaLarguraMinima(640)

  const mostraGrupo = podeAdministrar && groupId !== null

  const abas: DescricaoDeAba[] = [
    { valor: 'perfil', rotulo: 'Perfil', icone: UserRound },
    { valor: 'conta', rotulo: 'Conta', icone: ShieldCheck },
    { valor: 'midia', rotulo: 'Áudio e vídeo', icone: Headphones },
    { valor: 'atalhos', rotulo: 'Atalhos', icone: Keyboard },
    // O rotulo "Grupo" e consultado pelo teste de acessibilidade ponta a
    // ponta. Renomear quebra a suite, e com razao: e o nome que as pessoas
    // aprenderam.
    ...(mostraGrupo ? [{ valor: 'grupo', rotulo: 'Grupo', icone: Users }] : []),
  ]

  // A aba de grupo some quando a pessoa perde o cargo ou troca de grupo. Sem
  // isto o dialogo ficaria apontando para um painel que nao existe mais.
  const atual: Chave = aba === 'grupo' && !mostraGrupo ? 'perfil' : aba

  return (
    <Dialog.Root open={aberto} onOpenChange={setAberto}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Configurações"
          className="flex size-10 items-center justify-center rounded text-fg-muted
                     hover:bg-bg-hover hover:text-fg"
        >
          <Settings aria-hidden="true" className="size-5" />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            `fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] -translate-x-1/2 -translate-y-1/2
             flex-col overflow-hidden rounded-lg border border-border-subtle bg-bg-raised
             text-fg shadow-dialog`,
            // A aba de grupo carrega a propria barra de secoes, e dentro dela
            // os cargos ainda abrem lista mais editor. Em 46rem isso virava
            // tres colunas de navegacao espremendo o conteudo em uns 330px, e
            // o editor de permissoes saia cortado pela borda do dialogo.
            //
            // A largura e condicional, e nao simplesmente maior: as outras
            // abas sao formularios de uma coluna so, e estica-las por causa
            // desta deixaria linhas de texto longas demais para ler com
            // conforto.
            atual === 'grupo' ? 'w-[min(95vw,66rem)]' : 'w-[min(92vw,46rem)]',
          )}
        >
          <div className="flex items-start justify-between gap-4 px-4 pt-3">
            <div>
              <Dialog.Title className="text-[15px] font-semibold text-fg">
                Configurações
              </Dialog.Title>
              <Dialog.Description className="sr-only">
                Preferências da sua conta e administração do grupo.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Botao variante="fantasma" tamanho="iconeSm">
                <X aria-hidden="true" />
                <span className="sr-only">Fechar</span>
              </Botao>
            </Dialog.Close>
          </div>

          <Abas
            abas={abas}
            valor={atual}
            aoMudar={v => setAba(v as Chave)}
            rotulo="Seções de configuração"
            orientacao={vertical ? 'vertical' : 'horizontal'}
          >
            <PainelDeAba valor="perfil"><Perfil /></PainelDeAba>
            <PainelDeAba valor="conta"><ConfiguracoesUsuario /></PainelDeAba>
            <PainelDeAba valor="midia">
              <section aria-label="Áudio e vídeo" className="flex flex-col gap-4 p-4">
                <p className="text-sm text-fg-muted">
                  Os dispositivos e a qualidade valem para a próxima chamada. Dentro
                  de uma chamada, o mesmo painel aparece com o medidor ao vivo.
                </p>
                {/*
                  O MESMO componente que o painel de voz usa. Uma segunda tela
                  de dispositivos envelheceria em separado, e as duas
                  discordariam sobre o que esta selecionado.
                */}
                <PreferenciasDeMidia />
              </section>
            </PainelDeAba>
            <PainelDeAba valor="atalhos">
              <section aria-label="Atalhos de voz" className="flex flex-col gap-4 p-4">
                <p className="text-sm text-fg-muted">
                  As teclas que mutam, ensurdecem e abrem o microfone numa chamada.
                  Valem na hora, inclusive com a chamada em curso.
                </p>
                <AtalhosDeVoz />
              </section>
            </PainelDeAba>
            {mostraGrupo && (
              <PainelDeAba valor="grupo">
                <ConfiguracoesGrupo groupId={groupId} />
              </PainelDeAba>
            )}
          </Abas>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
