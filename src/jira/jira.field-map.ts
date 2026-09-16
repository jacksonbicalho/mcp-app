/**
 * Mapped fields from the Jira "Gestão de mudança" tab (SQOT project).
 * `id` is the happy path; `names` are fallbacks if the field is recreated/renamed in Jira.
 */
export type GestaoMudancaFieldKey = 'desenvolvedorResponsavel' | 'cenarioProposto' | 'procedimentoValidacao' | 'sistemasNecessarios';

export interface FieldMapping {
  id: string;
  names: string[];
}

export const GESTAO_MUDANCA_FIELDS: Record<GestaoMudancaFieldKey, FieldMapping> = {
  desenvolvedorResponsavel: {
    id: 'customfield_10358',
    names: ['Desenvolvedor Responsável'],
  },
  cenarioProposto: {
    id: 'customfield_10359',
    names: ['Cenário Proposto'],
  },
  procedimentoValidacao: {
    // Jira field name includes a trailing colon
    id: 'customfield_10315',
    names: ['Procedimento de Validação Técnica e Funcional:', 'Procedimento de Validação Técnica e Funcional'],
  },
  // No exact field in catalog named "Sistemas necessários"; resolve by name fallback.
  sistemasNecessarios: {
    id: '',
    names: ['Sistemas necessários', 'Sistemas Necessários'],
  },
};

/** Set of mapped customfield IDs (non-empty) so they are not duplicated in customFields. */
export const GESTAO_MUDANCA_FIELD_IDS = new Set(
  Object.values(GESTAO_MUDANCA_FIELDS)
    .map((m) => m.id)
    .filter(Boolean),
);
