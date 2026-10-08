/** One paragraph of the details of a question. A `path` paragraph is a file or folder path. */
export interface QuestionPart {
  kind: "text" | "path";
  text: string;
}

/** A question of an agent, split for a phone: a short headline and the details below it. */
export interface QuestionShape {
  headline: string;
  details: QuestionPart[];
}

/** How an option shows: `yes` agrees, `no` refuses or cancels, `plain` is something else. */
export type OptionTone = "yes" | "no" | "plain";

const PATH = /^(?:~|\.{0,2})\/\S*$/;

const SENTENCE_END = /(?<=[.?!:])\s+/;

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

function part(text: string): QuestionPart {
  return { kind: PATH.test(text) ? "path" : "text", text };
}

/**
 * Splits the question text into a headline and details. The headline is the last sentence that
 * ends with a question mark. If there is no such sentence, the headline is the first paragraph.
 */
export function shapeQuestion(text: string): QuestionShape {
  const all = paragraphs(text);

  for (let index = all.length - 1; index >= 0; index--) {
    const sentences = all[index]!.split(SENTENCE_END);
    const asked = sentences.findLastIndex((sentence) => sentence.endsWith("?"));

    if (asked === -1) {
      continue;
    }

    const rest = sentences.filter((_, i) => i !== asked).join(" ");
    const details = [...all.slice(0, index), ...(rest ? [rest] : []), ...all.slice(index + 1)];

    return { headline: sentences[asked]!, details: details.map(part) };
  }

  return { headline: all[0] ?? "", details: all.slice(1).map(part) };
}

/** Tells if an option agrees, refuses, or does something else, from its label. */
export function optionTone(label: string): OptionTone {
  if (/^(yes|allow|approve|accept|trust|continue|proceed|ok)\b/i.test(label)) {
    return "yes";
  }

  if (/^(no|deny|reject|cancel|exit|quit|stop|don't)\b/i.test(label)) {
    return "no";
  }

  return "plain";
}
