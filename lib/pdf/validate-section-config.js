import { getSectionsForDocumentType } from '../constants/document-sections.js';
import { isValidDocumentType } from '../constants/document-types.js';

/**
 * Validate a section_config object against a document type's section
 * registry. Used by the document-templates POST/PUT endpoints to
 * reject malformed payloads at the API boundary so the renderer
 * doesn't have to re-validate.
 *
 * Allowed shape:
 *   {
 *     visibility: { sectionId: bool },
 *     order:      [sectionId, ...],
 *     perSection: { sectionId: { ... } }
 *   }
 *
 * All three keys are optional. Unknown top-level keys are rejected.
 *
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateSectionConfig(sectionConfig, documentType) {
  if (sectionConfig === null || sectionConfig === undefined) {
    return { ok: false, error: 'section_config required' };
  }
  if (typeof sectionConfig !== 'object' || Array.isArray(sectionConfig)) {
    return { ok: false, error: 'section_config must be an object' };
  }
  if (!isValidDocumentType(documentType)) {
    return { ok: false, error: `invalid document_type: ${documentType}` };
  }
  const validKeys = new Set(['visibility', 'order', 'perSection', 'colors']);
  for (const k of Object.keys(sectionConfig)) {
    if (!validKeys.has(k)) {
      return { ok: false, error: `unknown section_config key: ${k}` };
    }
  }
  const sectionsForType = getSectionsForDocumentType(documentType);
  const validSectionIds = new Set(sectionsForType.map((s) => s.id));
  const fieldIdsBySection = new Map(
    sectionsForType
      .filter((s) => Array.isArray(s.fields))
      .map((s) => [s.id, new Set(s.fields.map((f) => f.id))])
  );
  if (sectionConfig.visibility !== undefined) {
    if (
      typeof sectionConfig.visibility !== 'object' ||
      Array.isArray(sectionConfig.visibility) ||
      sectionConfig.visibility === null
    ) {
      return { ok: false, error: 'visibility must be an object' };
    }
    for (const [k, v] of Object.entries(sectionConfig.visibility)) {
      if (!validSectionIds.has(k)) {
        return { ok: false, error: `unknown section id in visibility: ${k}` };
      }
      if (typeof v !== 'boolean') {
        return { ok: false, error: `visibility.${k} must be boolean` };
      }
    }
  }
  if (sectionConfig.order !== undefined) {
    if (!Array.isArray(sectionConfig.order)) {
      return { ok: false, error: 'order must be an array' };
    }
    for (const sid of sectionConfig.order) {
      if (typeof sid !== 'string' || !validSectionIds.has(sid)) {
        return { ok: false, error: `unknown section id in order: ${sid}` };
      }
    }
  }
  if (sectionConfig.perSection !== undefined) {
    if (
      typeof sectionConfig.perSection !== 'object' ||
      Array.isArray(sectionConfig.perSection) ||
      sectionConfig.perSection === null
    ) {
      return { ok: false, error: 'perSection must be an object' };
    }
    for (const [sectionId, sectionOpts] of Object.entries(sectionConfig.perSection)) {
      if (!validSectionIds.has(sectionId)) {
        return { ok: false, error: `unknown section id in perSection: ${sectionId}` };
      }
      // Optional fields-level validation. Other keys (e.g., legacy move_events.show_driver)
      // pass through unchecked for back-compat with pre-FU-035-D shape.
      if (sectionOpts && typeof sectionOpts === 'object' && 'fields' in sectionOpts) {
        const fields = sectionOpts.fields;
        if (
          typeof fields !== 'object' ||
          Array.isArray(fields) ||
          fields === null
        ) {
          return { ok: false, error: `perSection.${sectionId}.fields must be an object` };
        }
        const validFieldIds = fieldIdsBySection.get(sectionId);
        if (!validFieldIds) {
          return {
            ok: false,
            error: `perSection.${sectionId}.fields invalid — section "${sectionId}" does not accept field-level toggles`,
          };
        }
        for (const [fieldId, value] of Object.entries(fields)) {
          if (!validFieldIds.has(fieldId)) {
            return {
              ok: false,
              error: `unknown field id in perSection.${sectionId}.fields: ${fieldId}`,
            };
          }
          if (typeof value !== 'boolean') {
            return {
              ok: false,
              error: `perSection.${sectionId}.fields.${fieldId} must be boolean`,
            };
          }
        }
      }
    }
  }
  if (sectionConfig.colors !== undefined) {
    if (
      typeof sectionConfig.colors !== 'object' ||
      Array.isArray(sectionConfig.colors) ||
      sectionConfig.colors === null
    ) {
      return { ok: false, error: 'colors must be an object' };
    }
    const allowedColorKeys = new Set(['accent', 'text']);
    const hexRegex = /^#[0-9a-fA-F]{6}$/;
    for (const [k, v] of Object.entries(sectionConfig.colors)) {
      if (!allowedColorKeys.has(k)) {
        return { ok: false, error: `unknown key in colors: ${k}` };
      }
      if (typeof v !== 'string' || !hexRegex.test(v)) {
        return { ok: false, error: `colors.${k} must be a 6-digit hex string like #3B82F6` };
      }
    }
  }
  return { ok: true };
}
