/**
 * Minimal glob matcher supporting the subset used in aitg.config.json:
 *   **  -> any number of path segments
 *   *   -> any characters except "/"
 *   ?   -> a single character except "/"
 *
 * Deliberately dependency-free: minimatch/picomatch pull in a nontrivial
 * tree for what amounts to a handful of exclusion patterns evaluated once
 * per changed file.
 */

function globToRegExp(pattern: string): RegExp {
  let out = "";

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    // Bounds are guaranteed by the loop condition, but the index signature
    // is `string | undefined` under noUncheckedIndexedAccess and the
    // lookahead below rules out a for...of rewrite.
    if (char === undefined) continue;
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        // "**/" consumes the slash so it can also match zero segments.
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      out += "[^/]";
      continue;
    }

    // Escape every other regex metacharacter.
    out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }

  return new RegExp(`^${out}$`);
}

const cache = new Map<string, RegExp>();

export function matchesGlob(path: string, pattern: string): boolean {
  let regex = cache.get(pattern);
  if (!regex) {
    regex = globToRegExp(pattern);
    cache.set(pattern, regex);
  }
  return regex.test(path);
}

export function matchesAnyGlob(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(path, pattern));
}
