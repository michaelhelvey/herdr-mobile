import { describe, expect, test } from "bun:test";

import { optionTone, shapeQuestion } from "./question.ts";

const TRUST = `Accessing workspace:

/private/tmp/scratchpad/trust-test-68671

Quick safety check: Is this a project you created or one you trust? (Like your own code, a
well-known open source project, or work from your team). If not, take a moment to review what's in
this folder first.`;

describe("shapeQuestion", () => {
  test("uses the asked sentence as the headline and keeps the rest as details", () => {
    const shape = shapeQuestion(TRUST);

    expect(shape.headline).toBe("Is this a project you created or one you trust?");
    expect(shape.details).toEqual([
      { kind: "text", text: "Accessing workspace:" },
      { kind: "path", text: "/private/tmp/scratchpad/trust-test-68671" },
      {
        kind: "text",
        text: "Quick safety check: (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what's in this folder first.",
      },
    ]);
  });

  test("takes the last question when there are many", () => {
    const shape = shapeQuestion(
      "Bash command\n\n  rm -rf build\n  Remove old output\n\nDo you want to proceed?",
    );

    expect(shape.headline).toBe("Do you want to proceed?");
    expect(shape.details.map((detail) => detail.text)).toEqual([
      "Bash command",
      "rm -rf build Remove old output",
    ]);
  });

  test("uses the first paragraph when nothing is asked", () => {
    expect(shapeQuestion("Pick a theme\n\nDark is easier on the eyes.")).toEqual({
      headline: "Pick a theme",
      details: [{ kind: "text", text: "Dark is easier on the eyes." }],
    });
  });
});

describe("optionTone", () => {
  test("knows agreeing and refusing labels", () => {
    expect(optionTone("Yes, I trust this folder")).toBe("yes");
    expect(optionTone("No, exit")).toBe("no");
    expect(optionTone("Dark mode")).toBe("plain");
  });
});
