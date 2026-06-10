export function titleize(value: string): string {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

export function firstSentence(value: string): string {
  const index = value.indexOf(".");
  return index >= 0 ? value.slice(0, index + 1) : value;
}

export function roundedCount(value: number): string {
  if (value <= 10) return String(value);

  const modulo = value % 10;
  if (modulo === 0) return String(value);
  if (modulo <= 5) return `${value - modulo}+`;
  return `${value - modulo + 5}+`;
}

export function paragraphs(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function unitLabel(unit: string): string {
  return unit.charAt(0).toUpperCase() + unit.slice(1);
}

export function unitMark(unit: string): string {
  switch (unit) {
    case "money":
      return "$";
    case "percentage":
      return "%";
    case "time":
      return "time";
    case "number":
      return "#";
    case "score":
      return "score";
    case "ratio":
      return "ratio";
    default:
      return unit;
  }
}
