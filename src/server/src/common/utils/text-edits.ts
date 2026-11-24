export type TextEdit = { old_string: string; new_string: string; replace_all?: boolean };

export const TEXT_EDITS_SCHEMA = {
  type: "array",
  description: "Exact-text replacements applied in order, all or nothing",
  items: {
    type: "object",
    properties: {
      old_string: { type: "string", description: "Exact text to find, including indentation. Must match one place unless replace_all" },
      new_string: { type: "string", description: "Text to put in its place (empty string deletes it)" },
      replace_all: { type: "boolean", description: "Replace every match instead of requiring exactly one" },
    },
    required: ["old_string", "new_string"],
  },
};

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

export function applyTextEdits(text: string, edits: unknown, readHint: string): { text: string; replacements: number } {
  if (!Array.isArray(edits) || edits.length === 0) throw new Error('"edits" must be a non-empty array of { old_string, new_string, replace_all? }');
  let next = text;
  let replacements = 0;
  edits.forEach((raw, i) => {
    const edit = (raw ?? {}) as Partial<TextEdit>;
    const at = edits.length > 1 ? `edits[${i}]` : "edit";
    if (typeof edit.old_string !== "string" || edit.old_string === "") throw new Error(`${at}.old_string must be a non-empty string`);
    if (typeof edit.new_string !== "string") throw new Error(`${at}.new_string must be a string`);
    if (edit.old_string === edit.new_string) throw new Error(`${at}: old_string and new_string are the same`);
    const count = countOf(next, edit.old_string);
    if (count === 0) throw new Error(`${at}.old_string was not found${i > 0 ? " (after the earlier edits)" : ""}. Nothing was changed. ${readHint} and copy the text exactly, including indentation.`);
    if (count > 1 && edit.replace_all !== true) throw new Error(`${at}.old_string matches ${count} places. Nothing was changed. Include more surrounding lines so it matches one place, or set replace_all=true.`);
    const replacement = edit.new_string;
    next = edit.replace_all === true ? next.split(edit.old_string).join(replacement) : next.replace(edit.old_string, () => replacement);
    replacements += edit.replace_all === true ? count : 1;
  });
  return { text: next, replacements };
}
