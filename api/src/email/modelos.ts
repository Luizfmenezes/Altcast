import type { Mensagem } from './tipos.js'

/**
 * Os dois e-mails que o Altcast manda.
 *
 * Escritos em pt-BR, na segunda pessoa, sem assunto em maiuscula e sem
 * "clique aqui": o link inteiro aparece em texto, porque quem desconfia de
 * e-mail — e deveria — precisa poder ler para onde vai antes de ir.
 *
 * O HTML e deliberadamente pobre. Cliente de e-mail nao e navegador: nada de
 * folha externa, nada de fonte remota, nada de layout que dependa de flexbox.
 * O que existe aqui sobrevive no Gmail, no Outlook e no cliente do celular.
 */

const CINZA = '#475569'
const AZUL = '#1d4ed8'
const TINTA = '#0f172a'

function moldura(titulo: string, corpo: string, botao: { texto: string; url: string }): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f1f5f9;
             font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
             color:${TINTA};line-height:1.6">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"
         style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;
                border:1px solid #cbd5e1">
    <tr><td style="padding:28px 28px 8px">
      <p style="margin:0 0 20px;font-size:13px;letter-spacing:3px;
                text-transform:uppercase;color:${CINZA}">Altcast</p>
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3">${titulo}</h1>
      ${corpo}
    </td></tr>
    <tr><td style="padding:8px 28px 28px">
      <a href="${botao.url}"
         style="display:inline-block;background:${AZUL};color:#ffffff;text-decoration:none;
                padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px">
        ${botao.texto}
      </a>
      <p style="margin:20px 0 0;font-size:13px;color:${CINZA}">
        Se o botao nao funcionar, copie este endereco:<br>
        <span style="word-break:break-all;color:${TINTA}">${botao.url}</span>
      </p>
    </td></tr>
  </table>
</body></html>`
}

export function emailDeVerificacao(opcoes: {
  para: string
  nome: string
  url: string
}): Mensagem {
  return {
    para: opcoes.para,
    assunto: 'Confirme seu e-mail no Altcast',
    texto: [
      `Ola, ${opcoes.nome}.`,
      '',
      'Confirme este endereco para liberar a criacao de grupos e o envio de',
      'convites no Altcast. O link vale por 24 horas.',
      '',
      opcoes.url,
      '',
      'Se nao foi voce quem criou a conta, ignore esta mensagem — sem a',
      'confirmacao, nada acontece.',
    ].join('\n'),
    html: moldura(
      'Confirme seu e-mail',
      `<p style="margin:0 0 8px">Ola, ${opcoes.nome}.</p>
       <p style="margin:0 0 8px">Confirme este endereco para liberar a criacao de
       grupos e o envio de convites. O link vale por 24 horas.</p>
       <p style="margin:0;font-size:13px;color:${CINZA}">Se nao foi voce quem criou
       a conta, ignore esta mensagem — sem a confirmacao, nada acontece.</p>`,
      { texto: 'Confirmar e-mail', url: opcoes.url },
    ),
  }
}

export function emailDeRecuperacao(opcoes: {
  para: string
  nome: string
  url: string
}): Mensagem {
  return {
    para: opcoes.para,
    assunto: 'Redefinir sua senha do Altcast',
    texto: [
      `Ola, ${opcoes.nome}.`,
      '',
      'Alguem pediu para redefinir a senha desta conta. O link abaixo vale por',
      'uma hora e so pode ser usado uma vez.',
      '',
      opcoes.url,
      '',
      'Se nao foi voce, nao ha nada a fazer: sua senha continua a mesma, e este',
      'link expira sozinho.',
    ].join('\n'),
    html: moldura(
      'Redefinir sua senha',
      `<p style="margin:0 0 8px">Ola, ${opcoes.nome}.</p>
       <p style="margin:0 0 8px">Alguem pediu para redefinir a senha desta conta.
       O link vale por uma hora e so pode ser usado uma vez.</p>
       <p style="margin:0;font-size:13px;color:${CINZA}">Se nao foi voce, nao ha nada
       a fazer: sua senha continua a mesma, e este link expira sozinho.</p>`,
      { texto: 'Redefinir senha', url: opcoes.url },
    ),
  }
}
