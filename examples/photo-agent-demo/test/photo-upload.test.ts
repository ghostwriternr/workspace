import { describe, expect, it } from "vitest";

import { photoPathForContentType } from "../src/photo/upload";

describe("photo upload helpers", () => {
  it("stores png uploads at a png original path", () => {
    expect(photoPathForContentType("image/png")).toBe("/photos/original.png");
  });

  it("stores jpeg uploads at a jpg original path", () => {
    expect(photoPathForContentType("image/jpeg; charset=binary")).toBe("/photos/original.jpg");
  });

  it("rejects unsupported upload content types", () => {
    expect(() => photoPathForContentType("text/plain")).toThrow("Unsupported photo content type: text/plain");
  });
});
