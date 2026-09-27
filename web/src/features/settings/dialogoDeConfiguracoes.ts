import { create } from 'zustand'

/** As abas do dialogo de configuracoes. */
export type AbaDeConfiguracoes = 'perfil' | 'conta' | 'midia' | 'grupo'

/**
 * Aberto ou fechado, e em qual aba — fora do componente.
 *
 * O dialogo tinha um unico gatilho, a engrenagem. O menu do avatar precisa
 * abri-lo direto em "Perfil", e a paleta de comandos direto em "Conta"; com o
 * estado preso num `useState` do proprio dialogo, cada novo ponto de entrada
 * seria mais uma propriedade atravessando tres componentes.
 */
type Estado = {
  aberto: boolean
  aba: AbaDeConfiguracoes
  abrir: (aba?: AbaDeConfiguracoes) => void
  definirAberto: (aberto: boolean) => void
  definirAba: (aba: AbaDeConfiguracoes) => void
}

export const useDialogoDeConfiguracoes = create<Estado>(set => ({
  aberto: false,
  aba: 'perfil',
  abrir: aba => set(estado => ({ aberto: true, aba: aba ?? estado.aba })),
  definirAberto: aberto => set({ aberto }),
  definirAba: aba => set({ aba }),
}))
