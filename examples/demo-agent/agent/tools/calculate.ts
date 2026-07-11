import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * Evaluates a basic arithmetic expression made of numbers, the operators
 * + - * / and parentheses. Implemented as a small recursive-descent parser —
 * NO eval() / Function() — so untrusted input can never execute code.
 *
 * Grammar:
 *   expr   = term   { ("+" | "-") term }
 *   term   = factor { ("*" | "/") factor }
 *   factor = ("+" | "-") factor | "(" expr ")" | number
 */
function evaluate(expression: string): number {
  let pos = 0;

  function skipWs() {
    while (pos < expression.length && /\s/.test(expression[pos]!)) pos++;
  }

  function parseExpr(): number {
    let value = parseTerm();
    for (;;) {
      skipWs();
      const op = expression[pos];
      if (op === "+" || op === "-") {
        pos++;
        const rhs = parseTerm();
        value = op === "+" ? value + rhs : value - rhs;
      } else {
        return value;
      }
    }
  }

  function parseTerm(): number {
    let value = parseFactor();
    for (;;) {
      skipWs();
      const op = expression[pos];
      if (op === "*" || op === "/") {
        pos++;
        const rhs = parseFactor();
        if (op === "/") {
          if (rhs === 0) throw new Error("division by zero");
          value = value / rhs;
        } else {
          value = value * rhs;
        }
      } else {
        return value;
      }
    }
  }

  function parseFactor(): number {
    skipWs();
    const ch = expression[pos];
    if (ch === "+") {
      pos++;
      return parseFactor();
    }
    if (ch === "-") {
      pos++;
      return -parseFactor();
    }
    if (ch === "(") {
      pos++;
      const value = parseExpr();
      skipWs();
      if (expression[pos] !== ")") throw new Error("expected closing ')'");
      pos++;
      return value;
    }
    return parseNumber();
  }

  function parseNumber(): number {
    skipWs();
    const start = pos;
    while (pos < expression.length && /[0-9.]/.test(expression[pos]!)) pos++;
    const raw = expression.slice(start, pos);
    if (raw === "" || raw === ".") {
      throw new Error(`unexpected token at position ${start}`);
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`invalid number: ${raw}`);
    return value;
  }

  const result = parseExpr();
  skipWs();
  if (pos !== expression.length) {
    throw new Error(`unexpected token at position ${pos}`);
  }
  return result;
}

export default defineTool({
  description:
    "Evaluate a basic arithmetic expression. Supports +, -, *, / and parentheses over numbers, e.g. \"1847 * 23\" or \"(2 + 3) * 4\". Returns the numeric result.",
  inputSchema: z.object({ expression: z.string().min(1) }),
  outputSchema: z.object({ expression: z.string(), result: z.number() }),
  execute({ expression }) {
    return { expression, result: evaluate(expression) };
  },
});
