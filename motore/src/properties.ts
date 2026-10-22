/** Le proprietà dello script: i segreti e gli identificativi del motore, fuori dal codice. */
export function requiredProperty(name: string): string {
  const value = PropertiesService.getScriptProperties().getProperty(name)
  if (!value) throw new Error(`Manca la proprietà ${name}: si mette da Impostazioni progetto, Proprietà dello script.`)
  return value
}
