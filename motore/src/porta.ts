// La porta di servizio (ADR 0003): un progetto a parte, distribuito «Chiunque». In imbastitura risponde solo
// «pronta», per provare se il dominio di RAMI permette una web app aperta a tutti e come arriva una POST da Cloudflare.
// Le sei azioni firmate arrivano con T9 e T10.

export function doPost(): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, porta: 'pronta' })).setMimeType(
    ContentService.MimeType.JSON,
  )
}
