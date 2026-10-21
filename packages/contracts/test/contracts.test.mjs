import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import test from "node:test";
import ts from "typescript";
import {
  ApiErrorResponseSchema,
  ReadinessResponseSchema,
  readinessEndpoint,
} from "@instagram/contracts";
import {
  readinessReadyFixture,
  readinessUnavailableFixture,
} from "@instagram/contracts/fixtures";

test("serializable UI fixtures conform to the same public schemas", () => {
  assert.deepEqual(
    ReadinessResponseSchema.parse(
      JSON.parse(JSON.stringify(readinessReadyFixture)),
    ),
    { status: "ready" },
  );
  assert.deepEqual(
    ApiErrorResponseSchema.parse(
      JSON.parse(JSON.stringify(readinessUnavailableFixture)),
    ),
    readinessUnavailableFixture,
  );
  assert.equal(readinessEndpoint.successStatus, 200);
  assert.equal(readinessEndpoint.unavailableStatus, 503);
});

test("readiness rejects false success and internal database fields", () => {
  for (const value of [
    null,
    {},
    { status: "not_ready" },
    { status: "ready", databaseUrl: "private" },
  ]) {
    assert.equal(ReadinessResponseSchema.safeParse(value).success, false);
  }
});

test("errors reject driver details, unknown codes and invalid request IDs", () => {
  const valid = readinessUnavailableFixture.error;
  for (const error of [
    { ...valid, message: "connection failed for private-role" },
    { ...valid, code: "UNAPPROVED_FUTURE_CODE" },
    { ...valid, requestId: "not-a-uuid" },
    { ...valid, stack: "internal stack trace" },
  ]) {
    assert.equal(ApiErrorResponseSchema.safeParse({ error }).success, false);
  }
  assert.equal(
    ApiErrorResponseSchema.safeParse({ error: valid, passwordHash: "private" })
      .success,
    false,
  );
});

test("published ESM exports and their dependency graph contain no Node/server imports", async () => {
  const visited = new Set();
  const pending = [
    new URL("../dist/index.js", import.meta.url),
    new URL("../dist/fixtures.js", import.meta.url),
  ];
  const builtins = new Set(builtinModules);
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file.href)) continue;
    visited.add(file.href);
    const source = await readFile(file, "utf8");
    const imports = [];
    const syntax = ts.createSourceFile(
      file.pathname,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    function visit(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        imports.push(node.moduleSpecifier.text);
      }
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      ) {
        assert.ok(
          node.arguments[0] && ts.isStringLiteral(node.arguments[0]),
          "Uninspectable dynamic dependency",
        );
        imports.push(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    }
    visit(syntax);
    for (const specifier of imports) {
      assert.equal(
        specifier.startsWith("node:") || builtins.has(specifier),
        false,
        `Node import: ${specifier}`,
      );
      if (specifier.startsWith(".")) {
        pending.push(new URL(specifier, file));
      } else {
        assert.equal(
          specifier,
          "zod",
          `Unexpected runtime dependency: ${specifier}`,
        );
        pending.push(new URL(import.meta.resolve(specifier)));
      }
    }
  }
  assert.ok(
    visited.size > 2,
    "The actual Zod dependency graph must be checked",
  );
});
