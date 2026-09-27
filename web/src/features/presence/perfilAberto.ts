import { create } from 'zustand'

/**
 * De quem e o cartao de perfil aberto agora, se houver.
 *
 * Fora dos componentes pelo mesmo motivo do dialogo de configuracoes: o
 * cartao abre da lista de membros, do nome na conversa e da paleta de
 * comandos, e cada um desses teria de carregar o estado ate o shell.
 */
type Estado = {
  userId: string | null
  abrirPerfil: (userId: string) => void
  fecharPerfil: () => void
}

export const usePerfilAberto = create<Estado>(set => ({
  userId: null,
  abrirPerfil: userId => set({ userId }),
  fecharPerfil: () => set({ userId: null }),
}))
