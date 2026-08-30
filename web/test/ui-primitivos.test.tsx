import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { violacoes } from './helpers/axe.js'
import { Botao } from '../src/ui/Botao.js'
import { Campo } from '../src/ui/Campo.js'
import { Card, CardCabecalho, CardTitulo, CardDescricao, CardCorpo } from '../src/ui/Card.js'
import { Badge } from '../src/ui/Badge.js'
import { Kbd } from '../src/ui/Kbd.js'
import { Avatar } from '../src/ui/Avatar.js'
import { Separador } from '../src/ui/Separador.js'

describe('Botao', () => {
  it('e um <button> por padrao', () => {
    render(<Botao>Entrar</Botao>)
    expect(screen.getByRole('button', { name: 'Entrar' }).tagName).toBe('BUTTON')
  })

  // Um link que so parece botao continua precisando ser <a>: trocar a tag pela
  // aparencia tiraria dele o "abrir em nova aba" e o menu de contexto.
  it('asChild preserva a tag do filho', () => {
    render(<Botao asChild><a href="/convite/K7M2P9XQ">Abrir convite</a></Botao>)
    const alvo = screen.getByRole('link', { name: 'Abrir convite' })
    expect(alvo.tagName).toBe('A')
    expect(alvo.className).toContain('inline-flex')
  })

  it('desabilitado nao dispara', async () => {
    let cliques = 0
    render(<Botao disabled onClick={() => { cliques++ }}>Enviar</Botao>)
    await userEvent.click(screen.getByRole('button')).catch(() => undefined)
    expect(cliques).toBe(0)
  })

  it('className de quem chama vence o da variante', () => {
    render(<Botao className="h-20">Alto</Botao>)
    expect(screen.getByRole('button').className).toContain('h-20')
    expect(screen.getByRole('button').className).not.toContain('h-9')
  })

  it('nao tem violacao de acessibilidade em nenhuma variante', async () => {
    const { container } = render(
      <div>
        <Botao variante="primario">Salvar</Botao>
        <Botao variante="discreto">Cancelar</Botao>
        <Botao variante="perigo">Apagar</Botao>
        <Botao variante="fantasma">Fechar</Botao>
        <Botao variante="vinculo">Saiba mais</Botao>
        <Botao tamanho="icone" aria-label="Configuracoes">*</Botao>
      </div>,
    )
    expect(await violacoes(container)).toEqual([])
  })
})

function CampoDeTeste(props: { erro?: string; aparencia?: 'caixa' | 'linha' }): React.ReactNode {
  const [v, setV] = useState('')
  return (
    <Campo
      rotulo="E-mail" tipo="email" valor={v} aoMudar={setV}
      {...(props.aparencia === undefined ? {} : { aparencia: props.aparencia })}
      {...(props.erro === undefined ? {} : { erro: props.erro })}
      dica="Usamos so para entrar."
    />
  )
}

describe('Campo', () => {
  it('o rotulo aponta para o campo nas duas aparencias', () => {
    const { unmount } = render(<CampoDeTeste />)
    expect(screen.getByLabelText('E-mail')).toBeTruthy()
    unmount()
    render(<CampoDeTeste aparencia="linha" />)
    expect(screen.getByLabelText('E-mail')).toBeTruthy()
  })

  // Borda vermelha sozinha nao existe para quem nao distingue vermelho.
  it('o erro chega como texto associado, e nao so como cor', () => {
    render(<CampoDeTeste erro="Endereco invalido." />)
    const campo = screen.getByLabelText('E-mail')
    expect(campo.getAttribute('aria-invalid')).toBe('true')
    const descrito = campo.getAttribute('aria-describedby') ?? ''
    const textos = descrito.split(' ').map(id => document.getElementById(id)?.textContent)
    expect(textos).toContain('Endereco invalido.')
  })

  it('a dica tambem e associada', () => {
    render(<CampoDeTeste />)
    const descrito = screen.getByLabelText('E-mail').getAttribute('aria-describedby') ?? ''
    const textos = descrito.split(' ').map(id => document.getElementById(id)?.textContent)
    expect(textos).toContain('Usamos so para entrar.')
  })

  it('aceita digitacao', async () => {
    render(<CampoDeTeste />)
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@exemplo.br')
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('ana@exemplo.br')
  })

  it('nao tem violacao de acessibilidade, com e sem erro', async () => {
    const { container } = render(
      <div><CampoDeTeste /><CampoDeTeste erro="Endereco invalido." aparencia="linha" /></div>,
    )
    expect(await violacoes(container)).toEqual([])
  })
})

describe('Card, Badge, Kbd, Avatar e Separador', () => {
  it('o Card monta uma regiao com titulo real', () => {
    render(
      <Card>
        <CardCabecalho>
          <CardTitulo>Convites ativos</CardTitulo>
          <CardDescricao>Quem tiver o codigo entra no grupo.</CardDescricao>
        </CardCabecalho>
        <CardCorpo>K7M2P9XQ</CardCorpo>
      </Card>,
    )
    expect(screen.getByRole('heading', { name: 'Convites ativos' })).toBeTruthy()
  })

  it('o Badge usa figuras de largura fixa para a lista nao tremer', () => {
    render(<Badge>12</Badge>)
    expect(screen.getByText('12').className).toContain('numerico')
  })

  it('o Kbd e um <kbd> de verdade', () => {
    render(<Kbd>Alt</Kbd>)
    expect(screen.getByText('Alt').tagName).toBe('KBD')
  })

  // O nome ja e escrito ao lado pelo componente que chama; repetir aqui faria
  // o leitor de tela anunciar a mesma pessoa duas vezes seguidas.
  it('o Avatar e decorativo e nao duplica o nome', () => {
    const { container } = render(<Avatar nome="Ana Paula" />)
    const marca = container.firstElementChild!
    expect(marca.getAttribute('aria-hidden')).toBe('true')
    expect(marca.textContent).toBe('A')
  })

  it('o Avatar com imagem nao vira conteudo anunciado', () => {
    const { container } = render(<Avatar nome="Ana" url="/a.png" />)
    const img = container.querySelector('img')!
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('aria-hidden')).toBe('true')
  })

  it('o Separador nao e anunciado como quebra tematica', () => {
    const { container } = render(<Separador />)
    expect(container.firstElementChild!.getAttribute('role')).toBe('none')
  })

  it('nada disso tem violacao de acessibilidade', async () => {
    const { container } = render(
      <Card>
        <CardCabecalho><CardTitulo>Membros</CardTitulo></CardCabecalho>
        <CardCorpo>
          <Avatar nome="Ana Paula" /><span>Ana Paula</span>
          <Badge>3</Badge><Separador /><Kbd>Alt</Kbd>
        </CardCorpo>
      </Card>,
    )
    expect(await violacoes(container)).toEqual([])
  })
})
