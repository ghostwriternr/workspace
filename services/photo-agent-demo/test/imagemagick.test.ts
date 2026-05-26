import { describe, expect, it } from "vitest";

import {
  buildDemoImageCommand,
  buildGrayscaleCommand,
  buildSquareCropCommand,
} from "../src/image/imagemagick";

describe("ImageMagick command builders", () => {
  it("builds a constrained generated demo image command", () => {
    expect(buildDemoImageCommand("/workspace/original.png")).toBe(
      "convert -size '96x64' 'gradient:#5b8cff-#111827' '/workspace/original.png'",
    );
  });

  it("builds a constrained grayscale conversion command", () => {
    expect(buildGrayscaleCommand("/workspace/input.jpg", "/workspace/output.png")).toBe(
      "convert '/workspace/input.jpg' -colorspace Gray '/workspace/output.png'",
    );
  });

  it("builds a constrained square crop command", () => {
    expect(buildSquareCropCommand("/workspace/input.jpg", "/workspace/output.png", 512)).toBe(
      "convert '/workspace/input.jpg' -resize '512x512^' -gravity center -extent '512x512' '/workspace/output.png'",
    );
  });

  it("shell-quotes paths instead of interpolating raw strings", () => {
    expect(buildGrayscaleCommand("/workspace/user's input.jpg", "/workspace/out.png")).toBe(
      "convert '/workspace/user'\\''s input.jpg' -colorspace Gray '/workspace/out.png'",
    );
  });

  it("rejects non-workspace paths", () => {
    expect(() => buildGrayscaleCommand("/tmp/input.jpg", "/workspace/output.png")).toThrow(
      "Image path must live under /workspace/",
    );
  });
});
