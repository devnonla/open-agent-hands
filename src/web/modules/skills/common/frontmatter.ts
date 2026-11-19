/** Starter body for a new skill. Name and description are fields on the skill, not part of this text. */
export function defaultSkillTemplate(name: string): string {
  return `# ${name}\n\n## Instructions\n\nDescribe how the agent should perform this skill.\n\n## Additional resources\n\n- Put detailed docs under \`references/\` and mention them here (e.g. \`api-details\`).\n`;
}
