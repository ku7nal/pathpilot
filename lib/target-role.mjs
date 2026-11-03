const roleAliases = [
  [/\b(ai|artificial intelligence)\s+engineer\b/i, "AI Engineer"],
  [/\b(machine learning|ml)\s+engineer\b/i, "Machine Learning Engineer"],
  [/\b(front[ -]?end)\s+(developer|engineer)\b/i, "Frontend Developer"],
  [/\b(back[ -]?end)\s+(developer|engineer)\b/i, "Backend Developer"],
  [/\b(full[ -]?stack)\s+(developer|engineer)\b/i, "Full Stack Developer"],
  [/\b(data scientist)\b/i, "Data Scientist"],
  [/\b(data analyst)\b/i, "Data Analyst"],
  [/\b(software engineer|software developer)\b/i, "Software Engineer"],
  [/\b(game developer|game programmer)\b/i, "Game Developer"],
];

export function inferTargetRole(goal) {
  for (const [pattern, role] of roleAliases) {
    if (pattern.test(goal)) return role;
  }

  const intent = goal.match(/\b(?:become|work as|career as|job as)\s+(?:a|an|the)?\s*([^.!?]+)/i);
  if (intent) return titleCase(intent[1].trim().replace(/^(?:a|an|the)\s+/i, ""));

  const topic = goal.match(/\b(?:learn|study|master)\s+([^.!?]+)/i)?.[1];
  if (topic) {
    const normalized = topic.trim().replace(/^(?:a|an|the)\s+/i, "");
    if (/\b(front[ -]?end|react|javascript|html|css)\b/i.test(normalized)) return "Frontend Developer";
    if (/\b(back[ -]?end|node(?:\.js)?|api development)\b/i.test(normalized)) return "Backend Developer";
    if (/\b(sql|data analysis|pandas)\b/i.test(normalized)) return "Data Analyst";
    if (/\b(machine learning|ml|artificial intelligence|\bai\b)\b/i.test(normalized)) return "AI Engineer";
    return titleCase(normalized);
  }

  return titleCase(goal.trim());
}

function titleCase(value) {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
