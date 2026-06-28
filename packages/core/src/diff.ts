export interface SkillDiff {
  name: string;
  text: string;
  truncated: boolean;
}

const MAX_LINES = 2_000;

export function createTextDiff(
  name: string,
  leftLabel: string,
  left: string,
  rightLabel: string,
  right: string
): SkillDiff {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const output = [`--- ${leftLabel}`, `+++ ${rightLabel}`];
  const length = Math.max(leftLines.length, rightLines.length);

  for (let index = 0; index < length; index += 1) {
    const leftLine = leftLines[index];
    const rightLine = rightLines[index];
    if (leftLine === rightLine) {
      if (leftLine !== undefined) output.push(` ${leftLine}`);
    } else {
      if (leftLine !== undefined) output.push(`-${leftLine}`);
      if (rightLine !== undefined) output.push(`+${rightLine}`);
    }
    if (output.length >= MAX_LINES) {
      output.push("... diff truncated ...");
      return { name, text: output.join("\n"), truncated: true };
    }
  }

  return { name, text: output.join("\n"), truncated: false };
}
