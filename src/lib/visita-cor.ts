// Aplicada somente às visitas marcadas; os demais destaques mantêm sua paleta.
export function corVisitaMarcada(visitaObrigatoria: boolean | null | undefined): string {
  return visitaObrigatoria === true ? '#ef4444' : '#3b82f6'
}
