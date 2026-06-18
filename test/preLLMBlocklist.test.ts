import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { isBlocked } from "../src/preLLMBlocklist.js";

describe("preLLMBlocklist", () => {
  describe("blocks dangerous content", () => {
    it("blocks <script>", () => {
      assert.equal(isBlocked("please add a <script> tag"), true);
      assert.equal(isBlocked("</script>"), true);
    });

    it("blocks <style>", () => {
      assert.equal(isBlocked("add a <style> block"), true);
    });

    it("blocks javascript: URLs", () => {
      assert.equal(isBlocked('href="javascript:alert(1)"'), true);
    });

    it("blocks data:text/html", () => {
      assert.equal(isBlocked("data:text/html,<script>"), true);
    });

    it("blocks event handler attributes", () => {
      assert.equal(isBlocked('onclick="x"'), true);
      assert.equal(isBlocked("onerror='x'"), true);
    });

    it("blocks <iframe>, <form>, <object>, <embed>, <base>", () => {
      assert.equal(isBlocked("add an <iframe>"), true);
      assert.equal(isBlocked("add a <form>"), true);
      assert.equal(isBlocked("<object>"), true);
      assert.equal(isBlocked("<embed>"), true);
      assert.equal(isBlocked("<base href='...'>"), true);
    });

    it("blocks <meta http-equiv>", () => {
      assert.equal(isBlocked('<meta http-equiv="refresh">'), true);
    });
  });

  describe("allows safe content", () => {
    it("allows benign suggestions", () => {
      assert.equal(isBlocked("add a heading that says Welcome"), false);
      assert.equal(isBlocked("change the background color to blue"), false);
      assert.equal(isBlocked("add a link to the gallery"), false);
      assert.equal(isBlocked(""), false);
    });
  });
});
