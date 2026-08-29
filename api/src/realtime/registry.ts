import type { WebSocket } from 'ws'
import { newId } from '../shared/ids.js'

/**
 * Limites da spec 04 secao 10. Cinco abas cobrem uso legitimo com folga; acima
 * disso a mais antiga cai, para que um cliente em laco de reconexao nao acumule
 * conexoes zumbis ate consumir a memoria do processo.
 */
const MAX_CONEXOES_POR_USUARIO = 5

type Conn = { id: string; userId: string; socket: WebSocket; alive: boolean }

const porConexao = new Map<string, Conn>()
/** Set preserva a ordem de insercao — e por isso que "a mais antiga" e o primeiro. */
const porUsuario = new Map<string, Set<string>>()

function conexoesDe(userId: string): Set<string> {
  const atual = porUsuario.get(userId)
  if (atual) return atual
  const nova = new Set<string>()
  porUsuario.set(userId, nova)
  return nova
}

/**
 * Registro em memoria das conexoes vivas. Nao persiste porque nao e dado: e um
 * fato sobre sockets que existem agora. Reiniciar a API zera o registro, e os
 * clientes o reconstroem em segundos ao reconectar.
 *
 * Este mapa e o unico ponto que muda para escalar horizontalmente — com mais de
 * uma instancia da API ele vira Redis Pub/Sub, e nada mais no desenho muda.
 */
export const registry = {
  add(userId: string, socket: WebSocket): string {
    const conexoes = conexoesDe(userId)

    // Derrubar antes de inserir mantem o teto exato em cinco, sem uma janela
    // momentanea de seis conexoes abertas.
    while (conexoes.size >= MAX_CONEXOES_POR_USUARIO) {
      const maisAntiga = conexoes.values().next().value
      if (maisAntiga === undefined) break
      porConexao.get(maisAntiga)?.socket.close(4000, 'conexao substituida')
      registry.remove(maisAntiga)
    }

    const id = newId()
    porConexao.set(id, { id, userId, socket, alive: true })
    conexoes.add(id)
    return id
  },

  remove(id: string): void {
    const conn = porConexao.get(id)
    if (!conn) return
    porConexao.delete(id)
    const conexoes = porUsuario.get(conn.userId)
    conexoes?.delete(id)
    // Sem esta limpeza, userIds() devolveria para sempre quem ja saiu, e a
    // presenca passaria a mentir.
    if (conexoes && conexoes.size === 0) porUsuario.delete(conn.userId)
  },

  socketsOf(userIds: string[]): WebSocket[] {
    const saida: WebSocket[] = []
    for (const userId of userIds) {
      for (const id of porUsuario.get(userId) ?? []) {
        const conn = porConexao.get(id)
        if (conn) saida.push(conn.socket)
      }
    }
    return saida
  },

  userIds(): string[] {
    return [...porUsuario.keys()]
  },

  connectionsOf(userId: string): number {
    return porUsuario.get(userId)?.size ?? 0
  },

  /** O pong do cliente chega aqui e desarma o encerramento do proximo ciclo. */
  markAlive(id: string): void {
    const conn = porConexao.get(id)
    if (conn) conn.alive = true
  },

  /**
   * Um ciclo de heartbeat: quem nao respondeu ao ping anterior morreu e sai;
   * o resto recebe um novo ping e volta a ser suspeito ate provar o contrario.
   *
   * Sem isso, NAT corporativo e rede movel deixam conexoes aparentemente
   * abertas que morreram ha uma hora — e a presenca vira decoracao.
   */
  heartbeat(): void {
    for (const conn of [...porConexao.values()]) {
      if (!conn.alive) {
        conn.socket.terminate()
        registry.remove(conn.id)
        continue
      }
      conn.alive = false
      conn.socket.ping()
    }
  },

  /** So para teste e para desligamento limpo do processo. */
  clear(): void {
    porConexao.clear()
    porUsuario.clear()
  },
}
