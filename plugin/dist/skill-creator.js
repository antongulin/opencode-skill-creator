// @bun
// skill-creator.ts
import { tool } from "@opencode-ai/plugin";
import { join as join10, dirname as dirname3, isAbsolute as isAbsolute3, relative as relative4, sep as sep3 } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { existsSync as existsSync8, mkdirSync as mkdirSync6, readFileSync as readFileSync8, rmSync as rmSync3, writeFileSync as writeFileSync8 } from "fs";

// lib/validate.ts
import { existsSync, readFileSync } from "fs";
import { join } from "path";
var ALLOWED_PROPERTIES = new Set([
  "name",
  "description",
  "license",
  "allowed-tools",
  "metadata",
  "compatibility"
]);
function isQuotedValue(value) {
  return value.length >= 2 && (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'"));
}
function isBlockScalarMarker(value) {
  return /^[|>](?:[1-9][+-]?|[+-][1-9]?)?$/.test(value);
}
function validateSkill(skillPath) {
  const skillMdPath = join(skillPath, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    return { valid: false, message: "SKILL.md not found" };
  }
  const content = readFileSync(skillMdPath, "utf-8").replace(/\r\n/g, `
`);
  if (!content.startsWith("---")) {
    return { valid: false, message: "No YAML frontmatter found" };
  }
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return { valid: false, message: "Invalid frontmatter format" };
  }
  const frontmatterText = match[1];
  const frontmatter = {};
  let currentKey = "";
  let currentValue = "";
  let inMultiline = false;
  const frontmatterLines = frontmatterText.split(`
`);
  for (const [index, line] of frontmatterLines.entries()) {
    if (inMultiline) {
      if (line.startsWith("  ") || line.startsWith("\t")) {
        currentValue += " " + line.trim();
        continue;
      } else {
        frontmatter[currentKey] = currentValue.trim();
        inMultiline = false;
      }
    }
    const kvMatch = line.match(/^([a-z][a-z0-9_-]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value && !isQuotedValue(value) && !isBlockScalarMarker(value) && (/:[ \t]/.test(value) || value.endsWith(":"))) {
        return {
          valid: false,
          message: `Invalid frontmatter value for '${currentKey}' on line ${index + 2}: unquoted values containing ': ' or ending with ':' are invalid YAML and the runtime will drop this skill. Hint: quote the value (e.g. ${currentKey}: "your text here").`
        };
      }
      if (isBlockScalarMarker(value)) {
        currentValue = "";
        inMultiline = true;
      } else if (currentKey === "metadata" && (value === "" || value === "{}")) {
        frontmatter[currentKey] = value;
      } else {
        frontmatter[currentKey] = value.replace(/^['"]|['"]$/g, "");
      }
    } else if (line.match(/^\s+\w+\s*:/)) {
      if (!frontmatter["metadata"]) {
        frontmatter["metadata"] = "(map)";
      }
    }
  }
  if (inMultiline && currentKey) {
    frontmatter[currentKey] = currentValue.trim();
  }
  const unexpectedKeys = Object.keys(frontmatter).filter((k) => !ALLOWED_PROPERTIES.has(k));
  if (unexpectedKeys.length > 0) {
    return {
      valid: false,
      message: `Unexpected key(s) in SKILL.md frontmatter: ${unexpectedKeys.sort().join(", ")}. Allowed properties are: ${[...ALLOWED_PROPERTIES].sort().join(", ")}`
    };
  }
  if (!frontmatter["name"]) {
    return { valid: false, message: "Missing 'name' in frontmatter" };
  }
  if (!frontmatter["description"]) {
    return { valid: false, message: "Missing 'description' in frontmatter" };
  }
  const name = frontmatter["name"].trim();
  if (name) {
    if (!/^[a-z0-9-]+$/.test(name)) {
      return {
        valid: false,
        message: `Name '${name}' should be kebab-case (lowercase letters, digits, and hyphens only)`
      };
    }
    if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
      return {
        valid: false,
        message: `Name '${name}' cannot start/end with hyphen or contain consecutive hyphens`
      };
    }
    if (name.length > 64) {
      return {
        valid: false,
        message: `Name is too long (${name.length} characters). Maximum is 64 characters.`
      };
    }
  }
  const description = frontmatter["description"].trim();
  if (description) {
    if (description.includes("<") || description.includes(">")) {
      return {
        valid: false,
        message: "Description cannot contain angle brackets (< or >)"
      };
    }
    if (description.length > 1024) {
      return {
        valid: false,
        message: `Description is too long (${description.length} characters). Maximum is 1024 characters.`
      };
    }
  }
  const compatibility = frontmatter["compatibility"];
  if (compatibility) {
    if (compatibility.length > 500) {
      return {
        valid: false,
        message: `Compatibility is too long (${compatibility.length} characters). Maximum is 500 characters.`
      };
    }
  }
  return { valid: true, message: "Skill is valid!" };
}

// lib/utils.ts
import { readFileSync as readFileSync2 } from "fs";
import { join as join2 } from "path";
var BLOCK_SCALAR_HEADER_RE = /^[|>](?:[1-9][+-]?|[+-][1-9]?)?$/;
function parseBlockScalarHeader(header) {
  const literal = header.startsWith("|");
  const chomp = header.includes("-") ? "strip" : header.includes("+") ? "keep" : "clip";
  const indentMatch = header.match(/[1-9]/);
  return { literal, chomp, indent: indentMatch ? Number(indentMatch[0]) : null };
}
function stripTrailingCr(line) {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
function joinLiteral(lines) {
  return lines.map((line) => line.text).join(`
`);
}
function foldLines(lines) {
  let out = "";
  for (let index = 0;index < lines.length; index++) {
    const line = lines[index];
    if (index === 0) {
      out += line.blank ? `
` : line.text;
      continue;
    }
    const previous = lines[index - 1];
    if (line.blank) {
      out += `
`;
    } else if (previous.blank) {
      out += (line.moreIndented ? `
` : "") + line.text;
    } else if (previous.moreIndented || line.moreIndented) {
      out += `
` + line.text;
    } else {
      out += " " + line.text;
    }
  }
  return out;
}
function parseBlockScalar(header, lines, startIndex) {
  const { literal, chomp, indent } = parseBlockScalarHeader(header);
  const body = [];
  let blockIndent = indent;
  let index = startIndex;
  while (index < lines.length) {
    const raw = stripTrailingCr(lines[index]);
    if (raw.trim() === "") {
      body.push({ text: "", blank: true, moreIndented: false });
      index++;
      continue;
    }
    const lineIndent = raw.length - raw.trimStart().length;
    if (blockIndent === null) {
      if (lineIndent === 0)
        break;
      blockIndent = lineIndent;
    }
    if (lineIndent < blockIndent)
      break;
    body.push({
      text: raw.slice(blockIndent),
      blank: false,
      moreIndented: lineIndent > blockIndent
    });
    index++;
  }
  let end = body.length;
  while (end > 0 && body[end - 1].blank)
    end--;
  const trailingBlanks = body.length - end;
  const content = body.slice(0, end);
  const joined = literal ? joinLiteral(content) : foldLines(content);
  let suffix = "";
  if (chomp === "keep") {
    const breaks = (content.length > 0 ? 1 : 0) + trailingBlanks;
    suffix = `
`.repeat(breaks);
  } else if (chomp === "clip" && content.length > 0) {
    suffix = `
`;
  }
  return { value: joined + suffix, next: index };
}
function parseSkillMd(skillPath) {
  const content = readFileSync2(join2(skillPath, "SKILL.md"), "utf-8");
  const lines = content.split(`
`);
  if (lines[0].trim() !== "---") {
    throw new Error("SKILL.md missing frontmatter (no opening ---)");
  }
  let endIdx = null;
  for (let i = 1;i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === null) {
    throw new Error("SKILL.md missing frontmatter (no closing ---)");
  }
  let name = "";
  let description = "";
  const frontmatterLines = lines.slice(1, endIdx);
  let i = 0;
  while (i < frontmatterLines.length) {
    const line = frontmatterLines[i];
    if (line.startsWith("name:")) {
      name = line.slice("name:".length).trim().replace(/^['"]|['"]$/g, "");
    } else if (line.startsWith("description:")) {
      const value = line.slice("description:".length).trim();
      if (BLOCK_SCALAR_HEADER_RE.test(value)) {
        const parsed = parseBlockScalar(value, frontmatterLines, i + 1);
        description = parsed.value;
        i = parsed.next;
        continue;
      } else {
        description = value.replace(/^['"]|['"]$/g, "");
      }
    }
    i++;
  }
  return { name, description, fullContent: content };
}

// lib/run-eval.ts
import {
  cpSync,
  existsSync as existsSync2,
  mkdirSync,
  mkdtempSync,
  readFileSync as readFileSync3,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "fs";
import { dirname, isAbsolute, join as join3, parse as parse3, relative, resolve, sep } from "path";
import { randomBytes } from "crypto";
import { tmpdir as osTmpdir } from "os";

// node_modules/jsonc-parser/lib/esm/impl/scanner.js
function createScanner(text, ignoreTrivia = false) {
  const len = text.length;
  let pos = 0, value = "", tokenOffset = 0, token = 16, lineNumber = 0, lineStartOffset = 0, tokenLineStartOffset = 0, prevTokenLineStartOffset = 0, scanError = 0;
  function scanHexDigits(count, exact) {
    let digits = 0;
    let value = 0;
    while (digits < count || !exact) {
      let ch = text.charCodeAt(pos);
      if (ch >= 48 && ch <= 57) {
        value = value * 16 + ch - 48;
      } else if (ch >= 65 && ch <= 70) {
        value = value * 16 + ch - 65 + 10;
      } else if (ch >= 97 && ch <= 102) {
        value = value * 16 + ch - 97 + 10;
      } else {
        break;
      }
      pos++;
      digits++;
    }
    if (digits < count) {
      value = -1;
    }
    return value;
  }
  function setPosition(newPosition) {
    pos = newPosition;
    value = "";
    tokenOffset = 0;
    token = 16;
    scanError = 0;
  }
  function scanNumber() {
    let start = pos;
    if (text.charCodeAt(pos) === 48) {
      pos++;
    } else {
      pos++;
      while (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
      }
    }
    if (pos < text.length && text.charCodeAt(pos) === 46) {
      pos++;
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
      } else {
        scanError = 3;
        return text.substring(start, pos);
      }
    }
    let end = pos;
    if (pos < text.length && (text.charCodeAt(pos) === 69 || text.charCodeAt(pos) === 101)) {
      pos++;
      if (pos < text.length && text.charCodeAt(pos) === 43 || text.charCodeAt(pos) === 45) {
        pos++;
      }
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
        end = pos;
      } else {
        scanError = 3;
      }
    }
    return text.substring(start, end);
  }
  function scanString() {
    let result = "", start = pos;
    while (true) {
      if (pos >= len) {
        result += text.substring(start, pos);
        scanError = 2;
        break;
      }
      const ch = text.charCodeAt(pos);
      if (ch === 34) {
        result += text.substring(start, pos);
        pos++;
        break;
      }
      if (ch === 92) {
        result += text.substring(start, pos);
        pos++;
        if (pos >= len) {
          scanError = 2;
          break;
        }
        const ch2 = text.charCodeAt(pos++);
        switch (ch2) {
          case 34:
            result += '"';
            break;
          case 92:
            result += "\\";
            break;
          case 47:
            result += "/";
            break;
          case 98:
            result += "\b";
            break;
          case 102:
            result += "\f";
            break;
          case 110:
            result += `
`;
            break;
          case 114:
            result += "\r";
            break;
          case 116:
            result += "\t";
            break;
          case 117:
            const ch3 = scanHexDigits(4, true);
            if (ch3 >= 0) {
              result += String.fromCharCode(ch3);
            } else {
              scanError = 4;
            }
            break;
          default:
            scanError = 5;
        }
        start = pos;
        continue;
      }
      if (ch >= 0 && ch <= 31) {
        if (isLineBreak(ch)) {
          result += text.substring(start, pos);
          scanError = 2;
          break;
        } else {
          scanError = 6;
        }
      }
      pos++;
    }
    return result;
  }
  function scanNext() {
    value = "";
    scanError = 0;
    tokenOffset = pos;
    lineStartOffset = lineNumber;
    prevTokenLineStartOffset = tokenLineStartOffset;
    if (pos >= len) {
      tokenOffset = len;
      return token = 17;
    }
    let code = text.charCodeAt(pos);
    if (isWhiteSpace(code)) {
      do {
        pos++;
        value += String.fromCharCode(code);
        code = text.charCodeAt(pos);
      } while (isWhiteSpace(code));
      return token = 15;
    }
    if (isLineBreak(code)) {
      pos++;
      value += String.fromCharCode(code);
      if (code === 13 && text.charCodeAt(pos) === 10) {
        pos++;
        value += `
`;
      }
      lineNumber++;
      tokenLineStartOffset = pos;
      return token = 14;
    }
    switch (code) {
      case 123:
        pos++;
        return token = 1;
      case 125:
        pos++;
        return token = 2;
      case 91:
        pos++;
        return token = 3;
      case 93:
        pos++;
        return token = 4;
      case 58:
        pos++;
        return token = 6;
      case 44:
        pos++;
        return token = 5;
      case 34:
        pos++;
        value = scanString();
        return token = 10;
      case 47:
        const start = pos - 1;
        if (text.charCodeAt(pos + 1) === 47) {
          pos += 2;
          while (pos < len) {
            if (isLineBreak(text.charCodeAt(pos))) {
              break;
            }
            pos++;
          }
          value = text.substring(start, pos);
          return token = 12;
        }
        if (text.charCodeAt(pos + 1) === 42) {
          pos += 2;
          const safeLength = len - 1;
          let commentClosed = false;
          while (pos < safeLength) {
            const ch = text.charCodeAt(pos);
            if (ch === 42 && text.charCodeAt(pos + 1) === 47) {
              pos += 2;
              commentClosed = true;
              break;
            }
            pos++;
            if (isLineBreak(ch)) {
              if (ch === 13 && text.charCodeAt(pos) === 10) {
                pos++;
              }
              lineNumber++;
              tokenLineStartOffset = pos;
            }
          }
          if (!commentClosed) {
            pos++;
            scanError = 1;
          }
          value = text.substring(start, pos);
          return token = 13;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
      case 45:
        value += String.fromCharCode(code);
        pos++;
        if (pos === len || !isDigit(text.charCodeAt(pos))) {
          return token = 16;
        }
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        value += scanNumber();
        return token = 11;
      default:
        while (pos < len && isUnknownContentCharacter(code)) {
          pos++;
          code = text.charCodeAt(pos);
        }
        if (tokenOffset !== pos) {
          value = text.substring(tokenOffset, pos);
          switch (value) {
            case "true":
              return token = 8;
            case "false":
              return token = 9;
            case "null":
              return token = 7;
          }
          return token = 16;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
    }
  }
  function isUnknownContentCharacter(code) {
    if (isWhiteSpace(code) || isLineBreak(code)) {
      return false;
    }
    switch (code) {
      case 125:
      case 93:
      case 123:
      case 91:
      case 34:
      case 58:
      case 44:
      case 47:
        return false;
    }
    return true;
  }
  function scanNextNonTrivia() {
    let result;
    do {
      result = scanNext();
    } while (result >= 12 && result <= 15);
    return result;
  }
  return {
    setPosition,
    getPosition: () => pos,
    scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
    getToken: () => token,
    getTokenValue: () => value,
    getTokenOffset: () => tokenOffset,
    getTokenLength: () => pos - tokenOffset,
    getTokenStartLine: () => lineStartOffset,
    getTokenStartCharacter: () => tokenOffset - prevTokenLineStartOffset,
    getTokenError: () => scanError
  };
}
function isWhiteSpace(ch) {
  return ch === 32 || ch === 9;
}
function isLineBreak(ch) {
  return ch === 10 || ch === 13;
}
function isDigit(ch) {
  return ch >= 48 && ch <= 57;
}
var CharacterCodes;
(function(CharacterCodes) {
  CharacterCodes[CharacterCodes["lineFeed"] = 10] = "lineFeed";
  CharacterCodes[CharacterCodes["carriageReturn"] = 13] = "carriageReturn";
  CharacterCodes[CharacterCodes["space"] = 32] = "space";
  CharacterCodes[CharacterCodes["_0"] = 48] = "_0";
  CharacterCodes[CharacterCodes["_1"] = 49] = "_1";
  CharacterCodes[CharacterCodes["_2"] = 50] = "_2";
  CharacterCodes[CharacterCodes["_3"] = 51] = "_3";
  CharacterCodes[CharacterCodes["_4"] = 52] = "_4";
  CharacterCodes[CharacterCodes["_5"] = 53] = "_5";
  CharacterCodes[CharacterCodes["_6"] = 54] = "_6";
  CharacterCodes[CharacterCodes["_7"] = 55] = "_7";
  CharacterCodes[CharacterCodes["_8"] = 56] = "_8";
  CharacterCodes[CharacterCodes["_9"] = 57] = "_9";
  CharacterCodes[CharacterCodes["a"] = 97] = "a";
  CharacterCodes[CharacterCodes["b"] = 98] = "b";
  CharacterCodes[CharacterCodes["c"] = 99] = "c";
  CharacterCodes[CharacterCodes["d"] = 100] = "d";
  CharacterCodes[CharacterCodes["e"] = 101] = "e";
  CharacterCodes[CharacterCodes["f"] = 102] = "f";
  CharacterCodes[CharacterCodes["g"] = 103] = "g";
  CharacterCodes[CharacterCodes["h"] = 104] = "h";
  CharacterCodes[CharacterCodes["i"] = 105] = "i";
  CharacterCodes[CharacterCodes["j"] = 106] = "j";
  CharacterCodes[CharacterCodes["k"] = 107] = "k";
  CharacterCodes[CharacterCodes["l"] = 108] = "l";
  CharacterCodes[CharacterCodes["m"] = 109] = "m";
  CharacterCodes[CharacterCodes["n"] = 110] = "n";
  CharacterCodes[CharacterCodes["o"] = 111] = "o";
  CharacterCodes[CharacterCodes["p"] = 112] = "p";
  CharacterCodes[CharacterCodes["q"] = 113] = "q";
  CharacterCodes[CharacterCodes["r"] = 114] = "r";
  CharacterCodes[CharacterCodes["s"] = 115] = "s";
  CharacterCodes[CharacterCodes["t"] = 116] = "t";
  CharacterCodes[CharacterCodes["u"] = 117] = "u";
  CharacterCodes[CharacterCodes["v"] = 118] = "v";
  CharacterCodes[CharacterCodes["w"] = 119] = "w";
  CharacterCodes[CharacterCodes["x"] = 120] = "x";
  CharacterCodes[CharacterCodes["y"] = 121] = "y";
  CharacterCodes[CharacterCodes["z"] = 122] = "z";
  CharacterCodes[CharacterCodes["A"] = 65] = "A";
  CharacterCodes[CharacterCodes["B"] = 66] = "B";
  CharacterCodes[CharacterCodes["C"] = 67] = "C";
  CharacterCodes[CharacterCodes["D"] = 68] = "D";
  CharacterCodes[CharacterCodes["E"] = 69] = "E";
  CharacterCodes[CharacterCodes["F"] = 70] = "F";
  CharacterCodes[CharacterCodes["G"] = 71] = "G";
  CharacterCodes[CharacterCodes["H"] = 72] = "H";
  CharacterCodes[CharacterCodes["I"] = 73] = "I";
  CharacterCodes[CharacterCodes["J"] = 74] = "J";
  CharacterCodes[CharacterCodes["K"] = 75] = "K";
  CharacterCodes[CharacterCodes["L"] = 76] = "L";
  CharacterCodes[CharacterCodes["M"] = 77] = "M";
  CharacterCodes[CharacterCodes["N"] = 78] = "N";
  CharacterCodes[CharacterCodes["O"] = 79] = "O";
  CharacterCodes[CharacterCodes["P"] = 80] = "P";
  CharacterCodes[CharacterCodes["Q"] = 81] = "Q";
  CharacterCodes[CharacterCodes["R"] = 82] = "R";
  CharacterCodes[CharacterCodes["S"] = 83] = "S";
  CharacterCodes[CharacterCodes["T"] = 84] = "T";
  CharacterCodes[CharacterCodes["U"] = 85] = "U";
  CharacterCodes[CharacterCodes["V"] = 86] = "V";
  CharacterCodes[CharacterCodes["W"] = 87] = "W";
  CharacterCodes[CharacterCodes["X"] = 88] = "X";
  CharacterCodes[CharacterCodes["Y"] = 89] = "Y";
  CharacterCodes[CharacterCodes["Z"] = 90] = "Z";
  CharacterCodes[CharacterCodes["asterisk"] = 42] = "asterisk";
  CharacterCodes[CharacterCodes["backslash"] = 92] = "backslash";
  CharacterCodes[CharacterCodes["closeBrace"] = 125] = "closeBrace";
  CharacterCodes[CharacterCodes["closeBracket"] = 93] = "closeBracket";
  CharacterCodes[CharacterCodes["colon"] = 58] = "colon";
  CharacterCodes[CharacterCodes["comma"] = 44] = "comma";
  CharacterCodes[CharacterCodes["dot"] = 46] = "dot";
  CharacterCodes[CharacterCodes["doubleQuote"] = 34] = "doubleQuote";
  CharacterCodes[CharacterCodes["minus"] = 45] = "minus";
  CharacterCodes[CharacterCodes["openBrace"] = 123] = "openBrace";
  CharacterCodes[CharacterCodes["openBracket"] = 91] = "openBracket";
  CharacterCodes[CharacterCodes["plus"] = 43] = "plus";
  CharacterCodes[CharacterCodes["slash"] = 47] = "slash";
  CharacterCodes[CharacterCodes["formFeed"] = 12] = "formFeed";
  CharacterCodes[CharacterCodes["tab"] = 9] = "tab";
})(CharacterCodes || (CharacterCodes = {}));

// node_modules/jsonc-parser/lib/esm/impl/string-intern.js
var cachedSpaces = new Array(20).fill(0).map((_, index) => {
  return " ".repeat(index);
});
var maxCachedValues = 200;
var cachedBreakLinesWithSpaces = {
  " ": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `
` + " ".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + " ".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `\r
` + " ".repeat(index);
    })
  },
  "\t": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `
` + "\t".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + "\t".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `\r
` + "\t".repeat(index);
    })
  }
};

// node_modules/jsonc-parser/lib/esm/impl/parser.js
var ParseOptions;
(function(ParseOptions) {
  ParseOptions.DEFAULT = {
    allowTrailingComma: false
  };
})(ParseOptions || (ParseOptions = {}));
function parse(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentProperty = null;
  let currentParent = [];
  const previousParents = [];
  function onValue(value) {
    if (Array.isArray(currentParent)) {
      currentParent.push(value);
    } else if (currentProperty !== null) {
      currentParent[currentProperty] = value;
    }
  }
  const visitor = {
    onObjectBegin: () => {
      const object = {};
      onValue(object);
      previousParents.push(currentParent);
      currentParent = object;
      currentProperty = null;
    },
    onObjectProperty: (name) => {
      currentProperty = name;
    },
    onObjectEnd: () => {
      currentParent = previousParents.pop();
    },
    onArrayBegin: () => {
      const array = [];
      onValue(array);
      previousParents.push(currentParent);
      currentParent = array;
      currentProperty = null;
    },
    onArrayEnd: () => {
      currentParent = previousParents.pop();
    },
    onLiteralValue: onValue,
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  return currentParent[0];
}
function visit(text, visitor, options = ParseOptions.DEFAULT) {
  const _scanner = createScanner(text, false);
  const _jsonPath = [];
  let suppressedCallbacks = 0;
  function toNoArgVisit(visitFunction) {
    return visitFunction ? () => suppressedCallbacks === 0 && visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisit(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisitWithPath(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice()) : () => true;
  }
  function toBeginVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks++;
      } else {
        let cbReturn = visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice());
        if (cbReturn === false) {
          suppressedCallbacks = 1;
        }
      }
    } : () => true;
  }
  function toEndVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks--;
      }
      if (suppressedCallbacks === 0) {
        visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter());
      }
    } : () => true;
  }
  const onObjectBegin = toBeginVisit(visitor.onObjectBegin), onObjectProperty = toOneArgVisitWithPath(visitor.onObjectProperty), onObjectEnd = toEndVisit(visitor.onObjectEnd), onArrayBegin = toBeginVisit(visitor.onArrayBegin), onArrayEnd = toEndVisit(visitor.onArrayEnd), onLiteralValue = toOneArgVisitWithPath(visitor.onLiteralValue), onSeparator = toOneArgVisit(visitor.onSeparator), onComment = toNoArgVisit(visitor.onComment), onError = toOneArgVisit(visitor.onError);
  const disallowComments = options && options.disallowComments;
  const allowTrailingComma = options && options.allowTrailingComma;
  function scanNext() {
    while (true) {
      const token = _scanner.scan();
      switch (_scanner.getTokenError()) {
        case 4:
          handleError(14);
          break;
        case 5:
          handleError(15);
          break;
        case 3:
          handleError(13);
          break;
        case 1:
          if (!disallowComments) {
            handleError(11);
          }
          break;
        case 2:
          handleError(12);
          break;
        case 6:
          handleError(16);
          break;
      }
      switch (token) {
        case 12:
        case 13:
          if (disallowComments) {
            handleError(10);
          } else {
            onComment();
          }
          break;
        case 16:
          handleError(1);
          break;
        case 15:
        case 14:
          break;
        default:
          return token;
      }
    }
  }
  function handleError(error, skipUntilAfter = [], skipUntil = []) {
    onError(error);
    if (skipUntilAfter.length + skipUntil.length > 0) {
      let token = _scanner.getToken();
      while (token !== 17) {
        if (skipUntilAfter.indexOf(token) !== -1) {
          scanNext();
          break;
        } else if (skipUntil.indexOf(token) !== -1) {
          break;
        }
        token = scanNext();
      }
    }
  }
  function parseString(isValue) {
    const value = _scanner.getTokenValue();
    if (isValue) {
      onLiteralValue(value);
    } else {
      onObjectProperty(value);
      _jsonPath.push(value);
    }
    scanNext();
    return true;
  }
  function parseLiteral() {
    switch (_scanner.getToken()) {
      case 11:
        const tokenValue = _scanner.getTokenValue();
        let value = Number(tokenValue);
        if (isNaN(value)) {
          handleError(2);
          value = 0;
        }
        onLiteralValue(value);
        break;
      case 7:
        onLiteralValue(null);
        break;
      case 8:
        onLiteralValue(true);
        break;
      case 9:
        onLiteralValue(false);
        break;
      default:
        return false;
    }
    scanNext();
    return true;
  }
  function parseProperty() {
    if (_scanner.getToken() !== 10) {
      handleError(3, [], [2, 5]);
      return false;
    }
    parseString(false);
    if (_scanner.getToken() === 6) {
      onSeparator(":");
      scanNext();
      if (!parseValue()) {
        handleError(4, [], [2, 5]);
      }
    } else {
      handleError(5, [], [2, 5]);
    }
    _jsonPath.pop();
    return true;
  }
  function parseObject() {
    onObjectBegin();
    scanNext();
    let needsComma = false;
    while (_scanner.getToken() !== 2 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 2 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (!parseProperty()) {
        handleError(4, [], [2, 5]);
      }
      needsComma = true;
    }
    onObjectEnd();
    if (_scanner.getToken() !== 2) {
      handleError(7, [2], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseArray() {
    onArrayBegin();
    scanNext();
    let isFirstElement = true;
    let needsComma = false;
    while (_scanner.getToken() !== 4 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 4 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (isFirstElement) {
        _jsonPath.push(0);
        isFirstElement = false;
      } else {
        _jsonPath[_jsonPath.length - 1]++;
      }
      if (!parseValue()) {
        handleError(4, [], [4, 5]);
      }
      needsComma = true;
    }
    onArrayEnd();
    if (!isFirstElement) {
      _jsonPath.pop();
    }
    if (_scanner.getToken() !== 4) {
      handleError(8, [4], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseValue() {
    switch (_scanner.getToken()) {
      case 3:
        return parseArray();
      case 1:
        return parseObject();
      case 10:
        return parseString(true);
      default:
        return parseLiteral();
    }
  }
  scanNext();
  if (_scanner.getToken() === 17) {
    if (options.allowEmptyContent) {
      return true;
    }
    handleError(4, [], []);
    return false;
  }
  if (!parseValue()) {
    handleError(4, [], []);
    return false;
  }
  if (_scanner.getToken() !== 17) {
    handleError(9, [], []);
  }
  return true;
}

// node_modules/jsonc-parser/lib/esm/main.js
var ScanError;
(function(ScanError) {
  ScanError[ScanError["None"] = 0] = "None";
  ScanError[ScanError["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
  ScanError[ScanError["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
  ScanError[ScanError["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
  ScanError[ScanError["InvalidUnicode"] = 4] = "InvalidUnicode";
  ScanError[ScanError["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
  ScanError[ScanError["InvalidCharacter"] = 6] = "InvalidCharacter";
})(ScanError || (ScanError = {}));
var SyntaxKind;
(function(SyntaxKind) {
  SyntaxKind[SyntaxKind["OpenBraceToken"] = 1] = "OpenBraceToken";
  SyntaxKind[SyntaxKind["CloseBraceToken"] = 2] = "CloseBraceToken";
  SyntaxKind[SyntaxKind["OpenBracketToken"] = 3] = "OpenBracketToken";
  SyntaxKind[SyntaxKind["CloseBracketToken"] = 4] = "CloseBracketToken";
  SyntaxKind[SyntaxKind["CommaToken"] = 5] = "CommaToken";
  SyntaxKind[SyntaxKind["ColonToken"] = 6] = "ColonToken";
  SyntaxKind[SyntaxKind["NullKeyword"] = 7] = "NullKeyword";
  SyntaxKind[SyntaxKind["TrueKeyword"] = 8] = "TrueKeyword";
  SyntaxKind[SyntaxKind["FalseKeyword"] = 9] = "FalseKeyword";
  SyntaxKind[SyntaxKind["StringLiteral"] = 10] = "StringLiteral";
  SyntaxKind[SyntaxKind["NumericLiteral"] = 11] = "NumericLiteral";
  SyntaxKind[SyntaxKind["LineCommentTrivia"] = 12] = "LineCommentTrivia";
  SyntaxKind[SyntaxKind["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
  SyntaxKind[SyntaxKind["LineBreakTrivia"] = 14] = "LineBreakTrivia";
  SyntaxKind[SyntaxKind["Trivia"] = 15] = "Trivia";
  SyntaxKind[SyntaxKind["Unknown"] = 16] = "Unknown";
  SyntaxKind[SyntaxKind["EOF"] = 17] = "EOF";
})(SyntaxKind || (SyntaxKind = {}));
var parse2 = parse;
var ParseErrorCode;
(function(ParseErrorCode) {
  ParseErrorCode[ParseErrorCode["InvalidSymbol"] = 1] = "InvalidSymbol";
  ParseErrorCode[ParseErrorCode["InvalidNumberFormat"] = 2] = "InvalidNumberFormat";
  ParseErrorCode[ParseErrorCode["PropertyNameExpected"] = 3] = "PropertyNameExpected";
  ParseErrorCode[ParseErrorCode["ValueExpected"] = 4] = "ValueExpected";
  ParseErrorCode[ParseErrorCode["ColonExpected"] = 5] = "ColonExpected";
  ParseErrorCode[ParseErrorCode["CommaExpected"] = 6] = "CommaExpected";
  ParseErrorCode[ParseErrorCode["CloseBraceExpected"] = 7] = "CloseBraceExpected";
  ParseErrorCode[ParseErrorCode["CloseBracketExpected"] = 8] = "CloseBracketExpected";
  ParseErrorCode[ParseErrorCode["EndOfFileExpected"] = 9] = "EndOfFileExpected";
  ParseErrorCode[ParseErrorCode["InvalidCommentToken"] = 10] = "InvalidCommentToken";
  ParseErrorCode[ParseErrorCode["UnexpectedEndOfComment"] = 11] = "UnexpectedEndOfComment";
  ParseErrorCode[ParseErrorCode["UnexpectedEndOfString"] = 12] = "UnexpectedEndOfString";
  ParseErrorCode[ParseErrorCode["UnexpectedEndOfNumber"] = 13] = "UnexpectedEndOfNumber";
  ParseErrorCode[ParseErrorCode["InvalidUnicode"] = 14] = "InvalidUnicode";
  ParseErrorCode[ParseErrorCode["InvalidEscapeCharacter"] = 15] = "InvalidEscapeCharacter";
  ParseErrorCode[ParseErrorCode["InvalidCharacter"] = 16] = "InvalidCharacter";
})(ParseErrorCode || (ParseErrorCode = {}));

// lib/process.ts
import { spawn } from "child_process";
function isFailedExitCode(exitCode) {
  return exitCode != null && exitCode !== 0;
}
function isFailedProcess(result) {
  return result.timedOut || isFailedExitCode(result.exitCode);
}
function buildOpencodeEnv(cwd) {
  return { ...process.env, PWD: cwd };
}
function runProcess(command, opts) {
  return new Promise((resolve, reject) => {
    const [file, ...args] = command;
    if (!file) {
      reject(new Error("Cannot spawn an empty command"));
      return;
    }
    const maxStderrChars = opts.maxStderrChars ?? 64 * 1024;
    const killGraceMs = opts.killGraceMs ?? 1000;
    if (opts.signal?.aborted) {
      resolve({ exitCode: null, stdout: "", stderr: "", timedOut: false, aborted: true });
      return;
    }
    const proc = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let stopRequested = false;
    let killTimeoutId;
    const requestStop = () => {
      if (settled || stopRequested)
        return;
      stopRequested = true;
      proc.kill();
      killTimeoutId = setTimeout(() => {
        if (!settled) {
          proc.kill("SIGKILL");
        }
      }, killGraceMs);
    };
    const onAbort = () => {
      if (settled)
        return;
      aborted = true;
      requestStop();
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill();
      killTimeoutId = setTimeout(() => {
        if (!settled) {
          proc.kill("SIGKILL");
        }
      }, killGraceMs);
    }, opts.timeoutMs);
    proc.stdout.setEncoding("utf-8");
    proc.stdout.on("data", (chunk) => {
      stdout += chunk;
      const shouldStop = opts.onStdoutChunk?.(chunk);
      if (shouldStop)
        requestStop();
    });
    proc.stderr.setEncoding("utf-8");
    proc.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > maxStderrChars) {
        stderr = stderr.slice(-maxStderrChars);
      }
    });
    const detach = () => {
      opts.signal?.removeEventListener("abort", onAbort);
    };
    proc.on("error", (error) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timeoutId);
      if (killTimeoutId)
        clearTimeout(killTimeoutId);
      detach();
      reject(error);
    });
    proc.on("close", (exitCode) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timeoutId);
      if (killTimeoutId)
        clearTimeout(killTimeoutId);
      detach();
      resolve({ exitCode, stdout, stderr, timedOut, aborted });
    });
  });
}

// lib/run-eval.ts
var SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var ROOT_CONFIG_FILES = ["opencode.json", "opencode.jsonc"];
function abortError(message = "skill evaluation aborted by the caller") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
function isAbortError(error) {
  return error instanceof Error && (error.name === "AbortError" || error.code === "ABORT_ERR");
}
var ALL_ZERO_WARNING = "All should-trigger queries produced 0 triggers with no run errors. Check that trigger evals are using an agent that exposes skill tool events, such as the build agent.";
function buildOpenCodeRunCommand(query, opts) {
  const cmd = [
    "opencode",
    "run",
    "--format",
    "json",
    "--agent",
    opts.agent ?? "build"
  ];
  if (opts.model)
    cmd.push("--model", opts.model);
  cmd.push(query);
  return cmd;
}
function buildEvalWarnings(results) {
  const shouldTriggerResults = results.filter((r) => r.should_trigger);
  if (shouldTriggerResults.length === 0)
    return [];
  const allZeroWithoutErrors = shouldTriggerResults.every((r) => r.triggers === 0 && r.errors === 0);
  return allZeroWithoutErrors ? [ALL_ZERO_WARNING] : [];
}
function parseCliSkillList(stdoutText) {
  try {
    const parsed = JSON.parse(stdoutText);
    if (!Array.isArray(parsed))
      return null;
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object")
        return [];
      const record = entry;
      if (typeof record.name !== "string")
        return [];
      return [
        {
          name: record.name,
          location: typeof record.location === "string" ? record.location : undefined
        }
      ];
    });
  } catch {
    return null;
  }
}
function findSkillConflictsInList(skills, skillName) {
  return skills.filter((entry) => entry.name === skillName).map((entry) => typeof entry.location === "string" && entry.location.trim() ? entry.location : "unknown location");
}
var cliInstalledSkillEnumerator = async (projectRoot) => {
  let result;
  try {
    result = await runProcess(["opencode", "debug", "skill"], {
      cwd: projectRoot,
      env: buildOpencodeEnv(projectRoot),
      timeoutMs: 1e4
    });
  } catch {
    return null;
  }
  if (isFailedProcess(result))
    return null;
  return parseCliSkillList(result.stdout);
};
function skillConflictMessage(skillName, locations) {
  return `skill_eval conflict: skill "${skillName}" is already available to opencode at ${locations.join(", ")}. Remove that installed skill or its skills.paths entry before running skill_eval. The eval tool creates a synthetic skill named "${skillName}-skill-<id>" and only counts that temporary skill as triggered; an installed skill with the base name can steal triggers and produce false negatives.`;
}
function skillEnumerationUnavailableMessage(skillName) {
  return `skill_eval aborted: could not enumerate the skills installed in this project to check whether "${skillName}" is already available. A pre-installed skill with the base name can steal triggers and produce false negatives, so the eval does not run rather than return misleading results. In OpenCode V2 the plugin uses the skill list API; if that call fails, retry once the server is healthy. In V1 the check uses \`opencode debug skill\`.`;
}
async function assertNoInstalledSkillConflict(skillName, projectRoot, enumerate = cliInstalledSkillEnumerator) {
  const skills = await enumerate(projectRoot);
  if (skills === null) {
    throw new Error(skillEnumerationUnavailableMessage(skillName));
  }
  const locations = findSkillConflictsInList(skills, skillName);
  if (locations.length === 0)
    return;
  throw new Error(skillConflictMessage(skillName, locations));
}
function createV2SkillEnumerator(ctx) {
  return async (projectRoot) => {
    try {
      const output = await ctx.skill.list({
        location: { directory: projectRoot }
      });
      if (!output || !Array.isArray(output.data))
        return null;
      return output.data.flatMap((entry) => {
        if (!entry || typeof entry.name !== "string")
          return [];
        return [
          {
            name: entry.name,
            location: typeof entry.path === "string" ? entry.path : undefined
          }
        ];
      });
    } catch {
      return null;
    }
  };
}
function findProjectRoot(cwd) {
  let current = cwd ?? process.cwd();
  const { root } = parse3(current);
  while (true) {
    if (existsSync2(join3(current, ".opencode")))
      return current;
    if (existsSync2(join3(current, ".claude")))
      return current;
    const parent = dirname(current);
    if (parent === current || parent === root)
      break;
    current = parent;
  }
  return cwd ?? process.cwd();
}
function linkOrCopyConfigEntry(source, target, isDirectory) {
  if (existsSync2(target))
    return;
  mkdirSync(dirname(target), { recursive: true });
  try {
    symlinkSync(source, target, isDirectory ? "dir" : "file");
  } catch {
    if (!existsSync2(target))
      cpSync(source, target, { recursive: true });
  }
}
function isInsidePath(parent, child) {
  const rel = relative(parent, child);
  if (rel === "" || isAbsolute(rel))
    return false;
  return rel !== ".." && !rel.startsWith(`..${sep}`);
}
function canonicalizeForExclusion(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
function referencesSkillsRoot(skillsRoot, absolute) {
  const canonicalRoot = canonicalizeForExclusion(skillsRoot);
  const canonicalAbsolute = canonicalizeForExclusion(absolute);
  if (canonicalAbsolute === canonicalRoot || isInsidePath(canonicalRoot, canonicalAbsolute)) {
    return true;
  }
  return absolute === skillsRoot || isInsidePath(skillsRoot, absolute);
}
function isWithinExcludedSkill(excludedSkillPath, absolute) {
  if (!excludedSkillPath)
    return false;
  const canonicalExcluded = canonicalizeForExclusion(excludedSkillPath);
  const canonicalAbsolute = canonicalizeForExclusion(absolute);
  return canonicalAbsolute === canonicalExcluded || isInsidePath(canonicalExcluded, canonicalAbsolute);
}
function isAncestorOfExcludedSkill(excludedSkillPath, absolute) {
  if (!excludedSkillPath)
    return false;
  const canonicalExcluded = canonicalizeForExclusion(excludedSkillPath);
  const canonicalAbsolute = canonicalizeForExclusion(absolute);
  return isInsidePath(canonicalAbsolute, canonicalExcluded);
}
function collectRelativeConfigRefs(projectRoot, configFileName) {
  const text = readFileSync3(join3(projectRoot, configFileName), "utf-8");
  const data = parse2(text);
  if (!data || typeof data !== "object")
    return [];
  const referenced = [];
  const pushLocal = (value) => {
    if (typeof value !== "string" || !value)
      return;
    if (/^\{file:.+\}$/.test(value))
      return;
    if (value.startsWith("/") || value.startsWith("~") || value.includes("://"))
      return;
    referenced.push(value);
  };
  if (Array.isArray(data.instructions))
    data.instructions.forEach(pushLocal);
  const fromFiles = (value) => {
    if (typeof value === "string") {
      const match = /^\{file:(.+)\}$/.exec(value);
      if (match)
        pushLocal(match[1]);
      return;
    }
    if (Array.isArray(value))
      value.forEach(fromFiles);
    else if (value && typeof value === "object") {
      Object.values(value).forEach(fromFiles);
    }
  };
  fromFiles(data);
  return referenced;
}
function expandConfigGlob(projectRoot, pattern) {
  const segments = pattern.split("/").filter((part) => part !== "" && part !== ".");
  if (segments.some((segment) => segment === "..")) {
    console.error(`skill_eval: instruction pattern "${pattern}" references a parent directory (".."), which the isolated eval-root mirror cannot mirror; move the reference inside the project if eval runs must see it.`);
    return [];
  }
  if (segments.some((segment) => segment.includes("{") || segment.includes("}"))) {
    console.error(`skill_eval: instruction pattern "${pattern}" uses brace alternation, which the isolated eval-root mirror does not support; list one explicit file or glob per entry such as "dir/a.md", "dir/b.md", or "dir/*.md".`);
    return [];
  }
  if (segments.some((segment) => segment.includes("**"))) {
    console.error(`skill_eval: instruction pattern "${pattern}" uses "**" recursion, which the isolated eval-root mirror does not support; list explicit files or a single-directory glob such as "dir/*.md".`);
    return [];
  }
  let bases = [""];
  for (let index = 0;index < segments.length; index++) {
    const segment = segments[index];
    const next = [];
    const hasGlob = /[*?[]/.test(segment);
    for (const base of bases) {
      const dirAbsolute = base ? join3(projectRoot, base) : projectRoot;
      if (!existsSync2(dirAbsolute))
        continue;
      let entries;
      try {
        entries = readdirSync(dirAbsolute);
      } catch {
        continue;
      }
      let matcher;
      if (hasGlob) {
        try {
          matcher = globSegmentToRegExp(segment);
        } catch (error) {
          console.error(`skill_eval: instruction pattern "${pattern}" contains an unsupported or malformed glob segment "${segment}" (${error instanceof Error ? error.message : String(error)}); the reference is not mirrored into the isolated eval root.`);
          return [];
        }
      } else {
        matcher = null;
      }
      for (const entry of entries) {
        if (matcher ? !matcher.test(entry) : entry !== segment)
          continue;
        const childRelative = base ? `${base}/${entry}` : entry;
        const childAbsolute = join3(projectRoot, childRelative);
        if (index !== segments.length - 1) {
          try {
            if (!statSync(childAbsolute).isDirectory())
              continue;
          } catch {
            continue;
          }
          next.push(childRelative);
        } else {
          next.push(childRelative);
        }
      }
    }
    bases = next;
    if (bases.length === 0)
      break;
  }
  return bases;
}
function globSegmentToRegExp(segment) {
  let out = "^";
  for (let i = 0;i < segment.length; i++) {
    const ch = segment[i];
    if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else if (ch === "[") {
      const close = segment.indexOf("]", i + 1);
      if (close === -1) {
        throw new Error("unterminated character class (missing ']')");
      }
      let body = segment.slice(i + 1, close);
      if (body.startsWith("!"))
        body = `^${body.slice(1)}`;
      try {
        new RegExp(`[${body}]`);
      } catch {
        throw new Error(`unsupported character class "[${body}]"`);
      }
      out += `[${body}]`;
      i = close;
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${out}$`);
}
function expandConfigReference(projectRoot, reference) {
  const hasGlob = /[*?[\]{}]/.test(reference);
  let matches;
  if (hasGlob) {
    matches = expandConfigGlob(projectRoot, reference);
  } else {
    matches = [reference];
  }
  const resolved = [];
  for (const match of matches) {
    const absolute = resolve(projectRoot, match);
    if (!isInsidePath(projectRoot, absolute)) {
      console.error(`skill_eval: instruction reference "${reference}" resolves outside the project root and is not mirrored into the isolated eval root; move it inside the project if eval runs must see it.`);
      continue;
    }
    if (existsSync2(absolute))
      resolved.push(absolute);
  }
  return resolved;
}
function mirrorRootConfigDocuments(projectRoot, evalRoot, excludedSkillPath) {
  const skillsRoot = join3(projectRoot, ".opencode", "skills");
  for (const name of ROOT_CONFIG_FILES) {
    const source = join3(projectRoot, name);
    if (!existsSync2(source))
      continue;
    linkOrCopyConfigEntry(source, join3(evalRoot, name), false);
    for (const reference of collectRelativeConfigRefs(projectRoot, name)) {
      for (const absolute of expandConfigReference(projectRoot, reference)) {
        if (referencesSkillsRoot(skillsRoot, absolute))
          continue;
        if (isWithinExcludedSkill(excludedSkillPath, absolute))
          continue;
        if (isAncestorOfExcludedSkill(excludedSkillPath, absolute)) {
          console.error(`skill_eval: instruction reference "${reference}" resolves to a directory containing the tested skill; the isolated eval-root mirror refuses to copy that parent tree (it would reintroduce the skill under test). Reference the specific file instead.`);
          continue;
        }
        const relativeTarget = relative(projectRoot, absolute);
        const target = join3(evalRoot, relativeTarget);
        if (!isInsidePath(evalRoot, target))
          continue;
        linkOrCopyConfigEntry(absolute, target, statSync(absolute).isDirectory());
      }
    }
  }
}
function symlinkProjectOpenCodeConfig(projectRoot, evalRoot, skillName, excludedSkillPath) {
  const sourceOpenCode = join3(projectRoot, ".opencode");
  if (existsSync2(sourceOpenCode)) {
    const targetOpenCode = join3(evalRoot, ".opencode");
    mkdirSync(targetOpenCode, { recursive: true });
    const sourceSkillsRoot = join3(sourceOpenCode, "skills");
    for (const entry of readdirSync(sourceOpenCode, { withFileTypes: true })) {
      if (entry.name === "skills")
        continue;
      const entryPath = join3(sourceOpenCode, entry.name);
      if (referencesSkillsRoot(sourceSkillsRoot, entryPath))
        continue;
      if (isWithinExcludedSkill(excludedSkillPath, entryPath))
        continue;
      if (isAncestorOfExcludedSkill(excludedSkillPath, entryPath))
        continue;
      linkOrCopyConfigEntry(entryPath, join3(targetOpenCode, entry.name), entry.isDirectory());
    }
    const sourceSkills = join3(sourceOpenCode, "skills");
    if (existsSync2(sourceSkills)) {
      const targetSkills = join3(targetOpenCode, "skills");
      mkdirSync(targetSkills, { recursive: true });
      const canonicalSkillsRoot = canonicalizeForExclusion(sourceSkills);
      const candidatePath = excludedSkillPath ?? join3(sourceSkills, skillName);
      for (const entry of readdirSync(sourceSkills, { withFileTypes: true })) {
        if (entry.name === skillName)
          continue;
        const entryPath = join3(sourceSkills, entry.name);
        const canonicalEntry = canonicalizeForExclusion(entryPath);
        if (canonicalEntry === canonicalSkillsRoot)
          continue;
        if (isWithinExcludedSkill(candidatePath, entryPath))
          continue;
        if (isAncestorOfExcludedSkill(candidatePath, entryPath))
          continue;
        linkOrCopyConfigEntry(entryPath, join3(targetSkills, entry.name), entry.isDirectory());
      }
    }
  }
  mirrorRootConfigDocuments(projectRoot, evalRoot, excludedSkillPath);
}
async function runSingleQuery(query, skillName, skillDescription, timeout, projectRoot, agent, triggerOnly, model, signal, excludedSkillPath) {
  if (!SKILL_NAME_RE.test(skillName)) {
    throw new Error(`Invalid skill name "${skillName}". Expected kebab-case (lowercase letters, numbers, and hyphens only).`);
  }
  const uniqueId = randomBytes(4).toString("hex");
  const cleanName = `${skillName}-skill-${uniqueId}`;
  if (signal?.aborted)
    throw abortError();
  const evalRoot = mkdtempSync(join3(osTmpdir(), "opencode-skill-eval-"));
  const skillsDir = join3(evalRoot, ".opencode", "skills", cleanName);
  const skillFile = join3(skillsDir, "SKILL.md");
  try {
    symlinkProjectOpenCodeConfig(projectRoot, evalRoot, skillName, excludedSkillPath);
    mkdirSync(skillsDir, { recursive: true });
    const indentedDesc = skillDescription.split(`
`).join(`
  `);
    const skillContent = [
      "---",
      `name: ${cleanName}`,
      "description: |",
      `  ${indentedDesc}`,
      "---",
      "",
      `# ${skillName}`,
      "",
      `This skill handles: ${skillDescription}`,
      ""
    ].join(`
`);
    writeFileSync(skillFile, skillContent);
    const cmd = buildOpenCodeRunCommand(query, { agent, model });
    let buffer = "";
    let triggered = false;
    const maxStderrChars = 64 * 1024;
    const timeoutMs = timeout * 1000;
    const consumeLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed)
        return;
      try {
        const event = JSON.parse(trimmed);
        if (event.type !== "tool_use")
          return;
        const part = event.part;
        if (!part || typeof part !== "object")
          return;
        const toolName = typeof part.tool === "string" ? part.tool : "";
        if (toolName !== "skill" && toolName !== "read")
          return;
        const serialized = JSON.stringify(part);
        if (serialized.includes(cleanName)) {
          triggered = true;
        }
      } catch {}
    };
    const flushBuffer = (final = false) => {
      let newlineIndex = buffer.indexOf(`
`);
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        consumeLine(line);
        newlineIndex = buffer.indexOf(`
`);
      }
      if (final && buffer.trim()) {
        consumeLine(buffer);
        buffer = "";
      }
    };
    const result = await runProcess(cmd, {
      cwd: evalRoot,
      env: buildOpencodeEnv(evalRoot),
      timeoutMs,
      maxStderrChars,
      signal,
      onStdoutChunk(chunk) {
        buffer += chunk;
        flushBuffer();
        return triggerOnly && triggered;
      }
    });
    flushBuffer(true);
    if (result.aborted || signal?.aborted) {
      throw abortError();
    }
    if (triggered && triggerOnly) {
      return true;
    }
    if (isFailedProcess(result)) {
      const cleanedStderr = result.stderr.trim();
      throw new Error(cleanedStderr ? `opencode run exited ${result.exitCode}: ${cleanedStderr}` : `opencode run exited ${result.exitCode}`);
    }
    return triggered;
  } finally {
    if (existsSync2(evalRoot)) {
      rmSync(evalRoot, { recursive: true, force: true });
    }
  }
}
function aggregateEvalResults(evalSet, jobResults, triggerThreshold) {
  const byItem = new Map;
  for (const jr of jobResults) {
    let bucket = byItem.get(jr.itemIndex);
    if (!bucket) {
      bucket = { triggers: [], errors: 0 };
      byItem.set(jr.itemIndex, bucket);
    }
    bucket.triggers.push(jr.triggered);
    if (jr.errored)
      bucket.errors += 1;
  }
  const results = [];
  for (const [itemIndex, item] of evalSet.entries()) {
    const bucket = byItem.get(itemIndex);
    if (!bucket)
      continue;
    const triggers = bucket.triggers;
    const errors = bucket.errors;
    const successfulRuns = triggers.length - errors;
    const triggerRate = successfulRuns > 0 ? triggers.filter(Boolean).length / successfulRuns : 0;
    const shouldTrigger = item.should_trigger;
    const thresholdPass = shouldTrigger ? triggerRate >= triggerThreshold : triggerRate < triggerThreshold;
    const didPass = errors === 0 && thresholdPass;
    results.push({
      query: item.query,
      should_trigger: shouldTrigger,
      trigger_rate: triggerRate,
      triggers: triggers.filter(Boolean).length,
      runs: triggers.length,
      successful_runs: successfulRuns,
      errors,
      pass: didPass
    });
  }
  return results;
}
async function runEval(opts) {
  const {
    evalSet,
    skillName,
    description,
    numWorkers,
    timeout,
    projectRoot,
    runsPerQuery = 3,
    triggerThreshold = 0.5,
    triggerOnly = true,
    model,
    agent = "build",
    signal,
    excludedSkillPath
  } = opts;
  if (signal?.aborted)
    throw abortError();
  const jobs = [];
  evalSet.forEach((item, itemIndex) => {
    for (let r = 0;r < runsPerQuery; r++) {
      jobs.push({ item, runIdx: r, itemIndex });
    }
  });
  const jobResults = [];
  let idx = 0;
  let abortedDuringRun = false;
  async function worker() {
    while (idx < jobs.length) {
      if (signal?.aborted) {
        abortedDuringRun = true;
        return;
      }
      const job = jobs[idx++];
      if (!job)
        break;
      try {
        const triggered = await runSingleQuery(job.item.query, skillName, description, timeout, projectRoot, agent, triggerOnly, model, signal, excludedSkillPath);
        jobResults.push({
          itemIndex: job.itemIndex,
          triggered,
          errored: false
        });
      } catch (e) {
        if (isAbortError(e) || signal?.aborted) {
          abortedDuringRun = true;
          return;
        }
        console.error(`Warning: query failed: ${e}`);
        jobResults.push({
          itemIndex: job.itemIndex,
          triggered: false,
          errored: true
        });
      }
    }
  }
  const workers = Array.from({ length: Math.min(numWorkers, jobs.length) }, () => worker());
  await Promise.all(workers);
  if (signal?.aborted || abortedDuringRun) {
    throw abortError();
  }
  const results = aggregateEvalResults(evalSet, jobResults, triggerThreshold);
  const passed = results.filter((r) => r.pass).length;
  const runErrors = results.reduce((acc, r) => acc + r.errors, 0);
  const queriesWithErrors = results.filter((r) => r.errors > 0).length;
  return {
    skill_name: skillName,
    description,
    results,
    warnings: buildEvalWarnings(results),
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      run_errors: runErrors,
      queries_with_errors: queriesWithErrors
    }
  };
}

// lib/improve-description.ts
import { mkdirSync as mkdirSync2, unlinkSync, writeFileSync as writeFileSync2 } from "fs";
import { join as join4 } from "path";
import { tmpdir } from "os";
import { randomBytes as randomBytes2 } from "crypto";

// lib/failure-taxonomy.ts
function classifyEvalFailures(results) {
  return results.filter((result) => !result.pass).map((result) => {
    if (result.errors > 0) {
      return {
        category: "run_error",
        query: result.query,
        explanation: "The eval run had execution errors, so trigger accuracy is not trustworthy.",
        remediation: "Fix the eval execution error before optimizing this description."
      };
    }
    if (result.should_trigger) {
      return {
        category: "false_negative",
        query: result.query,
        explanation: "The skill should have triggered but did not.",
        remediation: "Broaden the description around this intent without listing only this exact query."
      };
    }
    return {
      category: "false_positive",
      query: result.query,
      explanation: "The skill triggered for a query that should not use it.",
      remediation: "Add clearer boundaries for when not to use the skill."
    };
  });
}
function formatFailureDiagnostics(diagnostics) {
  if (diagnostics.length === 0)
    return "";
  return diagnostics.map((diagnostic) => `- [${diagnostic.category}] ${diagnostic.query}: ${diagnostic.explanation} ${diagnostic.remediation}`).join(`
`);
}

// lib/improve-description.ts
async function callOpenCode(prompt, model, timeout = 300, opts = {}) {
  const tmpPath = join4(tmpdir(), `skill-creator-${randomBytes2(6).toString("hex")}.md`);
  writeFileSync2(tmpPath, prompt);
  try {
    if (opts.signal?.aborted)
      throw abortError();
    const cmd = ["opencode", "run", "--format", "json"];
    if (model)
      cmd.push("--model", model);
    cmd.push("--file", tmpPath, "--", "Process the attached file and follow its instructions.");
    let stdout = "";
    let lineBuffer = "";
    const textParts = [];
    const maxStderrChars = 64 * 1024;
    const timeoutMs = timeout * 1000;
    const consumeLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed)
        return;
      try {
        const event = JSON.parse(trimmed);
        if (event.type !== "text")
          return;
        const part = event.part;
        if (!part || typeof part !== "object")
          return;
        const text = part.text;
        if (typeof text === "string") {
          textParts.push(text);
        }
      } catch {}
    };
    const flushLines = (final = false) => {
      let idx = lineBuffer.indexOf(`
`);
      while (idx !== -1) {
        const line = lineBuffer.slice(0, idx);
        lineBuffer = lineBuffer.slice(idx + 1);
        consumeLine(line);
        idx = lineBuffer.indexOf(`
`);
      }
      if (final && lineBuffer.trim()) {
        consumeLine(lineBuffer);
        lineBuffer = "";
      }
    };
    const cwd = opts.projectRoot ?? process.cwd();
    const result = await runProcess(cmd, {
      cwd,
      env: buildOpencodeEnv(cwd),
      timeoutMs,
      maxStderrChars,
      signal: opts.signal,
      onStdoutChunk(chunk) {
        stdout += chunk;
        lineBuffer += chunk;
        flushLines();
      }
    });
    flushLines(true);
    if (result.aborted || opts.signal?.aborted) {
      throw abortError();
    }
    if (isFailedProcess(result)) {
      throw new Error(`opencode run exited ${result.exitCode}
stderr: ${result.stderr}`);
    }
    if (textParts.length > 0) {
      return textParts.join("");
    }
    return stdout;
  } finally {
    try {
      unlinkSync(tmpPath);
    } catch {}
  }
}
async function improveDescription(opts) {
  const {
    skillName,
    skillContent,
    currentDescription,
    evalResults,
    history,
    model,
    testResults,
    logDir,
    iteration,
    projectRoot,
    signal
  } = opts;
  const failedTriggers = evalResults.results.filter((r) => r.should_trigger && !r.pass);
  const falseTriggers = evalResults.results.filter((r) => !r.should_trigger && !r.pass);
  const trainScore = `${evalResults.summary.passed}/${evalResults.summary.total}`;
  let scoresSummary;
  if (testResults) {
    const testScore = `${testResults.summary.passed}/${testResults.summary.total}`;
    scoresSummary = `Train: ${trainScore}, Test: ${testScore}`;
  } else {
    scoresSummary = `Train: ${trainScore}`;
  }
  let prompt = `You are optimizing a skill description for an OpenCode skill called "${skillName}". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that the agent sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.

The description appears in the agent's "available_skills" list. When a user sends a query, the agent decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.

Here's the current description:
<current_description>
"${currentDescription}"
</current_description>

Current scores (${scoresSummary}):
<scores_summary>
`;
  if (failedTriggers.length > 0) {
    prompt += `FAILED TO TRIGGER (should have triggered but didn't):
`;
    for (const r of failedTriggers) {
      prompt += `  - "${r.query}" (triggered ${r.triggers}/${r.runs} times)
`;
    }
    prompt += `
`;
  }
  if (falseTriggers.length > 0) {
    prompt += `FALSE TRIGGERS (triggered but shouldn't have):
`;
    for (const r of falseTriggers) {
      prompt += `  - "${r.query}" (triggered ${r.triggers}/${r.runs} times)
`;
    }
    prompt += `
`;
  }
  if (history.length > 0) {
    prompt += `PREVIOUS ATTEMPTS (do NOT repeat these \u2014 try something structurally different):

`;
    for (const h of history) {
      const trainS = `${h.train_passed ?? h.passed ?? 0}/${h.train_total ?? h.total ?? 0}`;
      const testS = h.test_passed != null ? `${h.test_passed}/${h.test_total ?? "?"}` : null;
      const scoreStr = `train=${trainS}` + (testS ? `, test=${testS}` : "");
      prompt += `<attempt ${scoreStr}>
`;
      prompt += `Description: "${h.description}"
`;
      if (h.results) {
        prompt += `Train results:
`;
        for (const r of h.results) {
          const status = r.pass ? "PASS" : "FAIL";
          prompt += `  [${status}] "${r.query.slice(0, 80)}" (triggered ${r.triggers}/${r.runs})
`;
        }
      }
      if (h.note) {
        prompt += `Note: ${h.note}
`;
      }
      prompt += `</attempt>

`;
    }
  }
  const diagnostics = formatFailureDiagnostics(classifyEvalFailures(evalResults.results ?? []));
  const failureDiagnosticsSection = diagnostics ? `
FAILURE DIAGNOSTICS:
${diagnostics}
` : "";
  prompt += `</scores_summary>

Skill content (for context on what the skill does):
<skill_content>
${skillContent}
</skill_content>

Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:

1. Avoid overfitting
2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.

Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters \u2014 descriptions over that will be truncated, so stay comfortably under it.

Here are some tips that we've found to work well in writing these descriptions:
- The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
- The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
- The description competes with other skills for the agent's attention \u2014 make it distinctive and immediately recognizable.
- If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.

I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end.
${failureDiagnosticsSection}

Please respond with only the new description text in <new_description> tags, nothing else.`;
  let text = await callOpenCode(prompt, model, undefined, { projectRoot, signal });
  const match = text.match(/<new_description>([\s\S]*?)<\/new_description>/);
  let description = match ? match[1].trim().replace(/^["']|["']$/g, "") : text.trim().replace(/^["']|["']$/g, "");
  const transcript = {
    iteration,
    prompt,
    response: text,
    parsed_description: description,
    char_count: description.length,
    over_limit: description.length > 1024
  };
  if (description.length > 1024) {
    const shortenPrompt = `${prompt}

` + `---

` + `A previous attempt produced this description, which at ` + `${description.length} characters is over the 1024-character hard limit:

` + `"${description}"

` + `Rewrite it to be under 1024 characters while keeping the most ` + `important trigger words and intent coverage. Respond with only ` + `the new description in <new_description> tags.`;
    const shortenText = await callOpenCode(shortenPrompt, model, undefined, { projectRoot, signal });
    const shortenMatch = shortenText.match(/<new_description>([\s\S]*?)<\/new_description>/);
    const shortened = shortenMatch ? shortenMatch[1].trim().replace(/^["']|["']$/g, "") : shortenText.trim().replace(/^["']|["']$/g, "");
    transcript.rewrite_prompt = shortenPrompt;
    transcript.rewrite_response = shortenText;
    transcript.rewrite_description = shortened;
    transcript.rewrite_char_count = shortened.length;
    description = shortened;
  }
  transcript.final_description = description;
  if (logDir) {
    mkdirSync2(logDir, { recursive: true });
    const logFile = join4(logDir, `improve_iter_${iteration ?? "unknown"}.json`);
    writeFileSync2(logFile, JSON.stringify(transcript, null, 2));
  }
  return description;
}

// lib/run-loop.ts
import { writeFileSync as writeFileSync3 } from "fs";

// lib/report.ts
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function generateHtml(data, opts = {}) {
  const d = data;
  const { autoRefresh = false, skillName = "" } = opts;
  const history = d.history ?? [];
  const titlePrefix = skillName ? escapeHtml(skillName) + " \u2014 " : "";
  const trainQueries = [];
  const testQueries = [];
  if (history.length > 0) {
    const first = history[0];
    for (const r of first.train_results ?? first.results ?? []) {
      trainQueries.push({ query: r.query, should_trigger: r.should_trigger ?? true });
    }
    if (first.test_results) {
      for (const r of first.test_results) {
        testQueries.push({ query: r.query, should_trigger: r.should_trigger ?? true });
      }
    }
  }
  const refreshTag = autoRefresh ? `    <meta http-equiv="refresh" content="5">
` : "";
  const parts = [];
  parts.push(`<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
${refreshTag}    <title>${titlePrefix}Skill Description Optimization</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600&family=Lora:wght@400;500&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Lora', Georgia, serif;
            max-width: 100%;
            margin: 0 auto;
            padding: 20px;
            background: #faf9f5;
            color: #141413;
        }
        h1 { font-family: 'Poppins', sans-serif; color: #141413; }
        .explainer {
            background: white;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
            border: 1px solid #e8e6dc;
            color: #b0aea5;
            font-size: 0.875rem;
            line-height: 1.6;
        }
        .summary {
            background: white;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
            border: 1px solid #e8e6dc;
        }
        .summary p { margin: 5px 0; }
        .best { color: #788c5d; font-weight: bold; }
        .table-container {
            overflow-x: auto;
            width: 100%;
        }
        table {
            border-collapse: collapse;
            background: white;
            border: 1px solid #e8e6dc;
            border-radius: 6px;
            font-size: 12px;
            min-width: 100%;
        }
        th, td {
            padding: 8px;
            text-align: left;
            border: 1px solid #e8e6dc;
            white-space: normal;
            word-wrap: break-word;
        }
        th {
            font-family: 'Poppins', sans-serif;
            background: #141413;
            color: #faf9f5;
            font-weight: 500;
        }
        th.test-col {
            background: #6a9bcc;
        }
        th.query-col { min-width: 200px; }
        td.description {
            font-family: monospace;
            font-size: 11px;
            word-wrap: break-word;
            max-width: 400px;
        }
        td.result {
            text-align: center;
            font-size: 16px;
            min-width: 40px;
        }
        td.test-result {
            background: #f0f6fc;
        }
        .pass { color: #788c5d; }
        .fail { color: #c44; }
        .rate {
            font-size: 9px;
            color: #b0aea5;
            display: block;
        }
        tr:hover { background: #faf9f5; }
        .score {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 11px;
        }
        .score-good { background: #eef2e8; color: #788c5d; }
        .score-ok { background: #fef3c7; color: #d97706; }
        .score-bad { background: #fceaea; color: #c44; }
        .train-label { color: #b0aea5; font-size: 10px; }
        .test-label { color: #6a9bcc; font-size: 10px; font-weight: bold; }
        .best-row { background: #f5f8f2; }
        th.positive-col { border-bottom: 3px solid #788c5d; }
        th.negative-col { border-bottom: 3px solid #c44; }
        th.test-col.positive-col { border-bottom: 3px solid #788c5d; }
        th.test-col.negative-col { border-bottom: 3px solid #c44; }
        .legend { font-family: 'Poppins', sans-serif; display: flex; gap: 20px; margin-bottom: 10px; font-size: 13px; align-items: center; }
        .legend-item { display: flex; align-items: center; gap: 6px; }
        .legend-swatch { width: 16px; height: 16px; border-radius: 3px; display: inline-block; }
        .swatch-positive { background: #141413; border-bottom: 3px solid #788c5d; }
        .swatch-negative { background: #141413; border-bottom: 3px solid #c44; }
        .swatch-test { background: #6a9bcc; }
        .swatch-train { background: #141413; }
    </style>
</head>
<body>
    <h1>${titlePrefix}Skill Description Optimization</h1>
    <div class="explainer">
        <strong>Optimizing your skill's description.</strong> This page updates automatically as OpenCode tests different versions of your skill's description. Each row is an iteration \u2014 a new description attempt. The columns show test queries: green checkmarks mean the skill triggered correctly (or correctly didn't trigger), red crosses mean it got it wrong. The "Train" score shows performance on queries used to improve the description; the "Test" score shows performance on held-out queries the optimizer hasn't seen. When it's done, OpenCode will apply the best-performing description to your skill.
    </div>
`);
  parts.push(`
    <div class="summary">
        <p><strong>Original:</strong> ${escapeHtml(d.original_description ?? "N/A")}</p>
        <p class="best"><strong>Best:</strong> ${escapeHtml(d.best_description ?? "N/A")}</p>
        <p><strong>Best Score:</strong> ${d.best_score ?? "N/A"} ${d.best_test_score ? "(test)" : "(train)"}</p>
        <p><strong>Iterations:</strong> ${d.iterations_run ?? 0} | <strong>Train:</strong> ${d.train_size ?? "?"} | <strong>Test:</strong> ${d.test_size ?? "?"}</p>
    </div>
`);
  parts.push(`
    <div class="legend">
        <span style="font-weight:600">Query columns:</span>
        <span class="legend-item"><span class="legend-swatch swatch-positive"></span> Should trigger</span>
        <span class="legend-item"><span class="legend-swatch swatch-negative"></span> Should NOT trigger</span>
        <span class="legend-item"><span class="legend-swatch swatch-train"></span> Train</span>
        <span class="legend-item"><span class="legend-swatch swatch-test"></span> Test</span>
    </div>
`);
  parts.push(`
    <div class="table-container">
    <table>
        <thead>
            <tr>
                <th>Iter</th>
                <th>Train</th>
                <th>Test</th>
                <th class="query-col">Description</th>
`);
  for (const qinfo of trainQueries) {
    const polarity = qinfo.should_trigger ? "positive-col" : "negative-col";
    parts.push(`                <th class="${polarity}">${escapeHtml(qinfo.query)}</th>
`);
  }
  for (const qinfo of testQueries) {
    const polarity = qinfo.should_trigger ? "positive-col" : "negative-col";
    parts.push(`                <th class="test-col ${polarity}">${escapeHtml(qinfo.query)}</th>
`);
  }
  parts.push(`            </tr>
        </thead>
        <tbody>
`);
  let bestIter;
  if (testQueries.length > 0) {
    bestIter = history.reduce((best, h) => (h.test_passed ?? 0) >= (best.test_passed ?? 0) ? h : best).iteration;
  } else {
    bestIter = history.reduce((best, h) => (h.train_passed ?? h.passed ?? 0) >= (best.train_passed ?? best.passed ?? 0) ? h : best).iteration;
  }
  function aggregateRuns(results) {
    let correct = 0;
    let total = 0;
    for (const r of results) {
      total += r.runs;
      if (r.should_trigger ?? true) {
        correct += r.triggers;
      } else {
        correct += r.runs - r.triggers;
      }
    }
    return [correct, total];
  }
  function scoreClass(correct, total) {
    if (total > 0) {
      const ratio = correct / total;
      if (ratio >= 0.8)
        return "score-good";
      if (ratio >= 0.5)
        return "score-ok";
    }
    return "score-bad";
  }
  for (const h of history) {
    const iteration = h.iteration ?? "?";
    const description = h.description ?? "";
    const trainResults = h.train_results ?? h.results ?? [];
    const testResults = h.test_results ?? [];
    const trainByQuery = new Map(trainResults.map((r) => [r.query, r]));
    const testByQuery = new Map((testResults ?? []).map((r) => [r.query, r]));
    const [trainCorrect, trainRuns] = aggregateRuns(trainResults);
    const [testCorrect, testRuns] = aggregateRuns(testResults ?? []);
    const trainClass = scoreClass(trainCorrect, trainRuns);
    const testClass = scoreClass(testCorrect, testRuns);
    const rowClass = iteration === bestIter ? "best-row" : "";
    parts.push(`            <tr class="${rowClass}">
                <td>${iteration}</td>
                <td><span class="score ${trainClass}">${trainCorrect}/${trainRuns}</span></td>
                <td><span class="score ${testClass}">${testCorrect}/${testRuns}</span></td>
                <td class="description">${escapeHtml(description)}</td>
`);
    for (const qinfo of trainQueries) {
      const r = trainByQuery.get(qinfo.query);
      const didPass = r?.pass ?? false;
      const triggers = r?.triggers ?? 0;
      const runs = r?.runs ?? 0;
      const icon = didPass ? "\u2713" : "\u2717";
      const cssClass = didPass ? "pass" : "fail";
      parts.push(`                <td class="result ${cssClass}">${icon}<span class="rate">${triggers}/${runs}</span></td>
`);
    }
    for (const qinfo of testQueries) {
      const r = testByQuery.get(qinfo.query);
      const didPass = r?.pass ?? false;
      const triggers = r?.triggers ?? 0;
      const runs = r?.runs ?? 0;
      const icon = didPass ? "\u2713" : "\u2717";
      const cssClass = didPass ? "pass" : "fail";
      parts.push(`                <td class="result test-result ${cssClass}">${icon}<span class="rate">${triggers}/${runs}</span></td>
`);
    }
    parts.push(`            </tr>
`);
  }
  parts.push(`        </tbody>
    </table>
    </div>

</body>
</html>
`);
  return parts.join("");
}

// lib/run-loop.ts
function splitEvalSet(evalSet, holdout, seed = 42) {
  let state = seed;
  function rand() {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) % 1e4 / 1e4;
  }
  const trigger = evalSet.filter((e) => e.should_trigger);
  const noTrigger = evalSet.filter((e) => !e.should_trigger);
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1;i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const shuffledTrigger = shuffle(trigger);
  const shuffledNoTrigger = shuffle(noTrigger);
  const nTriggerTest = Math.max(1, Math.floor(shuffledTrigger.length * holdout));
  const nNoTriggerTest = Math.max(1, Math.floor(shuffledNoTrigger.length * holdout));
  const testSet = [
    ...shuffledTrigger.slice(0, nTriggerTest),
    ...shuffledNoTrigger.slice(0, nNoTriggerTest)
  ];
  const trainSet = [
    ...shuffledTrigger.slice(nTriggerTest),
    ...shuffledNoTrigger.slice(nNoTriggerTest)
  ];
  return [trainSet, testSet];
}
async function runLoop(opts) {
  const {
    evalSet,
    skillPath,
    descriptionOverride,
    numWorkers,
    timeout,
    maxIterations,
    runsPerQuery,
    triggerThreshold,
    triggerOnly,
    holdout,
    model,
    agent,
    verbose,
    liveReportPath,
    logDir,
    projectRoot,
    signal,
    excludedSkillPath
  } = opts;
  if (signal?.aborted)
    throw abortError();
  const { name, description: originalDescription, fullContent: content } = parseSkillMd(skillPath);
  const excludePath = excludedSkillPath ?? skillPath;
  let currentDescription = descriptionOverride ?? originalDescription;
  let trainSet;
  let testSet;
  if (holdout > 0) {
    [trainSet, testSet] = splitEvalSet(evalSet, holdout);
    if (verbose) {
      console.error(`Split: ${trainSet.length} train, ${testSet.length} test (holdout=${holdout})`);
    }
  } else {
    trainSet = evalSet;
    testSet = [];
  }
  const history = [];
  let exitReason = "unknown";
  for (let iteration = 1;iteration <= maxIterations; iteration++) {
    if (signal?.aborted)
      throw abortError();
    if (verbose) {
      console.error(`
${"=".repeat(60)}`);
      console.error(`Iteration ${iteration}/${maxIterations}`);
      console.error(`Description: ${currentDescription}`);
      console.error("=".repeat(60));
    }
    const allQueries = [...trainSet, ...testSet];
    const t0 = Date.now();
    const allResults = await runEval({
      evalSet: allQueries,
      skillName: name,
      description: currentDescription,
      numWorkers,
      timeout,
      projectRoot,
      runsPerQuery,
      triggerThreshold,
      triggerOnly,
      model,
      agent,
      signal,
      excludedSkillPath: excludePath
    });
    const evalElapsed = (Date.now() - t0) / 1000;
    const trainResultList = allResults.results.slice(0, trainSet.length);
    const testResultList = allResults.results.slice(trainSet.length);
    const trainWarnings = buildEvalWarnings(trainResultList);
    const testWarnings = buildEvalWarnings(testResultList);
    const trainPassed = trainResultList.filter((r) => r.pass).length;
    const trainTotal = trainResultList.length;
    const trainRunErrors = trainResultList.reduce((acc, r) => acc + r.errors, 0);
    const trainSummary = {
      passed: trainPassed,
      failed: trainTotal - trainPassed,
      total: trainTotal,
      run_errors: trainRunErrors,
      queries_with_errors: trainResultList.filter((r) => r.errors > 0).length
    };
    const trainResults = {
      skill_name: name,
      description: currentDescription,
      results: trainResultList,
      warnings: trainWarnings,
      summary: trainSummary
    };
    let testResults = null;
    let testSummary = null;
    if (testSet.length > 0) {
      const testPassed = testResultList.filter((r) => r.pass).length;
      const testTotal = testResultList.length;
      const testRunErrors = testResultList.reduce((acc, r) => acc + r.errors, 0);
      testSummary = {
        passed: testPassed,
        failed: testTotal - testPassed,
        total: testTotal,
        run_errors: testRunErrors,
        queries_with_errors: testResultList.filter((r) => r.errors > 0).length
      };
      testResults = {
        skill_name: name,
        description: currentDescription,
        results: testResultList,
        warnings: testWarnings,
        summary: testSummary
      };
    }
    history.push({
      iteration,
      description: currentDescription,
      train_passed: trainSummary.passed,
      train_failed: trainSummary.failed,
      train_total: trainSummary.total,
      train_results: trainResultList,
      test_passed: testSummary?.passed ?? null,
      test_failed: testSummary?.failed ?? null,
      test_total: testSummary?.total ?? null,
      test_results: testResultList.length > 0 ? testResultList : null,
      passed: trainSummary.passed,
      failed: trainSummary.failed,
      total: trainSummary.total,
      results: trainResultList
    });
    if (liveReportPath) {
      const partialOutput = {
        original_description: originalDescription,
        best_description: currentDescription,
        best_score: "in progress",
        iterations_run: history.length,
        holdout,
        train_size: trainSet.length,
        test_size: testSet.length,
        history
      };
      writeFileSync3(liveReportPath, generateHtml(partialOutput, { autoRefresh: true, skillName: name }));
    }
    if (verbose) {
      console.error(`Train: ${trainSummary.passed}/${trainSummary.total} passed (${evalElapsed.toFixed(1)}s)`);
      if (testSummary) {
        console.error(`Test:  ${testSummary.passed}/${testSummary.total} passed`);
      }
      for (const warning of new Set([...trainWarnings, ...testWarnings])) {
        console.error(`Warning: ${warning}`);
      }
    }
    if (trainSummary.failed === 0) {
      exitReason = `all_passed (iteration ${iteration})`;
      if (verbose) {
        console.error(`
All train queries passed on iteration ${iteration}!`);
      }
      break;
    }
    if (iteration === maxIterations) {
      exitReason = `max_iterations (${maxIterations})`;
      if (verbose) {
        console.error(`
Max iterations reached (${maxIterations}).`);
      }
      break;
    }
    if (signal?.aborted)
      throw abortError();
    if (verbose) {
      console.error(`
Improving description...`);
    }
    const t1 = Date.now();
    const blindedHistory = history.map((h) => {
      const stripped = {};
      for (const [k, v] of Object.entries(h)) {
        if (!k.startsWith("test_"))
          stripped[k] = v;
      }
      return stripped;
    });
    const newDescription = await improveDescription({
      skillName: name,
      skillContent: content,
      currentDescription,
      evalResults: trainResults,
      history: blindedHistory,
      model,
      logDir,
      iteration,
      projectRoot,
      signal
    });
    const improveElapsed = (Date.now() - t1) / 1000;
    if (verbose) {
      console.error(`Proposed (${improveElapsed.toFixed(1)}s): ${newDescription}`);
    }
    currentDescription = newDescription;
  }
  let best;
  if (testSet.length > 0) {
    best = history.reduce((a, b) => (a.test_passed ?? 0) >= (b.test_passed ?? 0) ? a : b);
  } else {
    best = history.reduce((a, b) => (a.train_passed ?? 0) >= (b.train_passed ?? 0) ? a : b);
  }
  const bestScore = testSet.length > 0 ? `${best.test_passed}/${best.test_total}` : `${best.train_passed}/${best.train_total}`;
  if (verbose) {
    console.error(`
Exit reason: ${exitReason}`);
    console.error(`Best score: ${bestScore} (iteration ${best.iteration})`);
  }
  return {
    exit_reason: exitReason,
    original_description: originalDescription,
    best_description: best.description,
    best_score: bestScore,
    best_train_score: `${best.train_passed}/${best.train_total}`,
    best_test_score: testSet.length > 0 ? `${best.test_passed}/${best.test_total}` : null,
    final_description: currentDescription,
    iterations_run: history.length,
    holdout,
    train_size: trainSet.length,
    test_size: testSet.length,
    history
  };
}

// lib/aggregate.ts
import { existsSync as existsSync3, readFileSync as readFileSync4, readdirSync as readdirSync2, statSync as statSync2 } from "fs";
import { join as join5, basename } from "path";
function compareEvalIds(a, b) {
  const parseNumeric = (value) => {
    if (typeof value === "number" && Number.isFinite(value))
      return value;
    if (typeof value !== "string")
      return null;
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed))
      return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  };
  const aNum = parseNumeric(a);
  const bNum = parseNumeric(b);
  if (aNum !== null && bNum !== null)
    return aNum - bNum;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}
function computeRunsPerConfiguration(results, evalIds) {
  const counts = [];
  for (const runs of Object.values(results)) {
    if (runs.length === 0) {
      counts.push(0);
      continue;
    }
    const byEval = new Map;
    for (const run of runs) {
      const evalKey = String(run.eval_id);
      if (!byEval.has(evalKey)) {
        byEval.set(evalKey, new Set);
      }
      byEval.get(evalKey).add(run.run_number);
    }
    if (evalIds.length === 0) {
      counts.push(0);
      continue;
    }
    for (const evalId of evalIds) {
      const set = byEval.get(String(evalId));
      counts.push(set ? set.size : 0);
    }
  }
  if (counts.length === 0)
    return 0;
  return Math.min(...counts);
}
function calculateStats(values) {
  if (values.length === 0) {
    return { mean: 0, stddev: 0, min: 0, max: 0 };
  }
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  let stddev = 0;
  if (n > 1) {
    const variance = values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1);
    stddev = Math.sqrt(variance);
  }
  return {
    mean: Math.round(mean * 1e4) / 1e4,
    stddev: Math.round(stddev * 1e4) / 1e4,
    min: Math.round(Math.min(...values) * 1e4) / 1e4,
    max: Math.round(Math.max(...values) * 1e4) / 1e4
  };
}
function sortedDirs(dir, pattern) {
  if (!existsSync3(dir))
    return [];
  return readdirSync2(dir).filter((name) => {
    const full = join5(dir, name);
    return statSync2(full).isDirectory() && (!pattern || pattern.test(name));
  }).sort().map((name) => join5(dir, name));
}
function loadRunResults(benchmarkDir) {
  const runsDir = join5(benchmarkDir, "runs");
  let searchDir;
  if (existsSync3(runsDir)) {
    searchDir = runsDir;
  } else if (sortedDirs(benchmarkDir, /^eval-/).length > 0) {
    searchDir = benchmarkDir;
  } else {
    console.error(`No eval directories found in ${benchmarkDir} or ${runsDir}`);
    return { results: {}, evalIds: [] };
  }
  const results = {};
  const evalIds = new Set;
  for (const [evalIdx, evalDir] of sortedDirs(searchDir, /^eval-/).entries()) {
    const metadataPath = join5(evalDir, "eval_metadata.json");
    let evalId = evalIdx;
    if (existsSync3(metadataPath)) {
      try {
        const meta = JSON.parse(readFileSync4(metadataPath, "utf-8"));
        evalId = meta.eval_id ?? evalIdx;
      } catch {}
    } else {
      const parsedEvalId = Number.parseInt(basename(evalDir).split("-")[1] ?? "", 10);
      if (Number.isFinite(parsedEvalId)) {
        evalId = parsedEvalId;
      }
    }
    let hasLoadedRuns = false;
    for (const configDir of sortedDirs(evalDir)) {
      if (sortedDirs(configDir, /^run-/).length === 0)
        continue;
      const config = basename(configDir);
      if (!results[config])
        results[config] = [];
      for (const runDir of sortedDirs(configDir, /^run-/)) {
        const parsedRunNumber = Number.parseInt(basename(runDir).split("-")[1] ?? "", 10);
        if (!Number.isFinite(parsedRunNumber)) {
          console.error(`Warning: Invalid run directory name: ${runDir}`);
          continue;
        }
        const runNumber = parsedRunNumber;
        const gradingFile = join5(runDir, "grading.json");
        if (!existsSync3(gradingFile)) {
          console.error(`Warning: grading.json not found in ${runDir}`);
          continue;
        }
        let grading;
        try {
          grading = JSON.parse(readFileSync4(gradingFile, "utf-8"));
        } catch (e) {
          console.error(`Warning: Invalid JSON in ${gradingFile}: ${e}`);
          continue;
        }
        const summary = grading.summary ?? {};
        const result = {
          eval_id: evalId,
          run_number: runNumber,
          pass_rate: summary.pass_rate ?? 0,
          passed: summary.passed ?? 0,
          failed: summary.failed ?? 0,
          total: summary.total ?? 0,
          time_seconds: 0,
          tokens: 0,
          tool_calls: 0,
          errors: 0,
          expectations: grading.expectations ?? [],
          notes: []
        };
        const timing = grading.timing ?? {};
        result.time_seconds = timing.total_duration_seconds ?? 0;
        const timingFile = join5(runDir, "timing.json");
        if (result.time_seconds === 0 && existsSync3(timingFile)) {
          try {
            const timingData = JSON.parse(readFileSync4(timingFile, "utf-8"));
            result.time_seconds = timingData.total_duration_seconds ?? 0;
            result.tokens = timingData.total_tokens ?? 0;
          } catch {}
        }
        const metrics = grading.execution_metrics ?? {};
        result.tool_calls = metrics.total_tool_calls ?? 0;
        if (!result.tokens)
          result.tokens = metrics.output_chars ?? 0;
        result.errors = metrics.errors_encountered ?? 0;
        for (const exp of result.expectations) {
          if (!("text" in exp) || !("passed" in exp)) {
            console.error(`Warning: expectation in ${gradingFile} missing required fields (text, passed, evidence)`);
          }
        }
        const notesSummary = grading.user_notes_summary ?? {};
        const notes = [];
        if (notesSummary.uncertainties)
          notes.push(...notesSummary.uncertainties);
        if (notesSummary.needs_review)
          notes.push(...notesSummary.needs_review);
        if (notesSummary.workarounds)
          notes.push(...notesSummary.workarounds);
        result.notes = notes;
        results[config].push(result);
        hasLoadedRuns = true;
      }
    }
    if (hasLoadedRuns) {
      evalIds.add(evalId);
    }
  }
  return {
    results,
    evalIds: [...evalIds].sort(compareEvalIds)
  };
}
function aggregateResults(results) {
  const runSummary = {};
  const configs = Object.keys(results);
  if (configs.length === 0) {
    runSummary.delta = {
      pass_rate: "+0.00",
      time_seconds: "+0.0",
      tokens: "+0"
    };
    return runSummary;
  }
  for (const config of configs) {
    const runs = results[config] ?? [];
    if (runs.length === 0) {
      runSummary[config] = {
        pass_rate: { mean: 0, stddev: 0, min: 0, max: 0 },
        time_seconds: { mean: 0, stddev: 0, min: 0, max: 0 },
        tokens: { mean: 0, stddev: 0, min: 0, max: 0 }
      };
      continue;
    }
    runSummary[config] = {
      pass_rate: calculateStats(runs.map((r) => r.pass_rate)),
      time_seconds: calculateStats(runs.map((r) => r.time_seconds)),
      tokens: calculateStats(runs.map((r) => r.tokens))
    };
  }
  const primary = runSummary[configs[0]] ?? {};
  const baselineSummary = configs.length >= 2 ? runSummary[configs[1]] ?? {} : {};
  const deltaPR = (primary.pass_rate?.mean ?? 0) - (baselineSummary.pass_rate?.mean ?? 0);
  const deltaTime = (primary.time_seconds?.mean ?? 0) - (baselineSummary.time_seconds?.mean ?? 0);
  const deltaTokens = (primary.tokens?.mean ?? 0) - (baselineSummary.tokens?.mean ?? 0);
  runSummary.delta = {
    pass_rate: `${deltaPR >= 0 ? "+" : ""}${deltaPR.toFixed(2)}`,
    time_seconds: `${deltaTime >= 0 ? "+" : ""}${deltaTime.toFixed(1)}`,
    tokens: `${deltaTokens >= 0 ? "+" : ""}${Math.round(deltaTokens)}`
  };
  return runSummary;
}
function generateBenchmark(benchmarkDir, skillName = "", skillPath = "") {
  const loaded = loadRunResults(benchmarkDir);
  const results = loaded.results;
  const runSummary = aggregateResults(results);
  const runs = [];
  for (const config of Object.keys(results)) {
    for (const result of results[config]) {
      runs.push({
        eval_id: result.eval_id,
        configuration: config,
        run_number: result.run_number,
        result: {
          pass_rate: result.pass_rate,
          passed: result.passed,
          failed: result.failed,
          total: result.total,
          time_seconds: result.time_seconds,
          tokens: result.tokens,
          tool_calls: result.tool_calls,
          errors: result.errors
        },
        expectations: result.expectations,
        notes: result.notes
      });
    }
  }
  const runsPerConfiguration = computeRunsPerConfiguration(results, loaded.evalIds);
  return {
    metadata: {
      skill_name: skillName || "<skill-name>",
      skill_path: skillPath || "<path/to/skill>",
      executor_model: "<model-name>",
      analyzer_model: "<model-name>",
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      evals_run: loaded.evalIds,
      runs_per_configuration: runsPerConfiguration
    },
    runs,
    run_summary: runSummary,
    notes: []
  };
}
function generateMarkdown(benchmark) {
  const metadata = benchmark.metadata;
  const runSummary = benchmark.run_summary;
  const configs = Object.keys(runSummary).filter((k) => k !== "delta");
  const configA = configs[0] ?? "config_a";
  const configB = configs[1] ?? "config_b";
  const labelA = configA.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const labelB = configB.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const a = runSummary[configA] ?? {};
  const b = runSummary[configB] ?? {};
  const delta = runSummary.delta ?? {};
  const lines = [
    `# Skill Benchmark: ${metadata.skill_name}`,
    "",
    `**Model**: ${metadata.executor_model}`,
    `**Date**: ${metadata.timestamp}`,
    `**Evals**: ${(metadata.evals_run ?? []).join(", ")} (${metadata.runs_per_configuration} runs each per configuration)`,
    "",
    "## Summary",
    "",
    `| Metric | ${labelA} | ${labelB} | Delta |`,
    "|--------|------------|---------------|-------|"
  ];
  const fmtPR = (s) => s && typeof s.mean === "number" && typeof s.stddev === "number" ? `${(s.mean * 100).toFixed(0)}% \xB1 ${(s.stddev * 100).toFixed(0)}%` : "\u2014";
  const fmtTime = (s) => s && typeof s.mean === "number" && typeof s.stddev === "number" ? `${s.mean.toFixed(1)}s \xB1 ${s.stddev.toFixed(1)}s` : "\u2014";
  const fmtTokens = (s) => s && typeof s.mean === "number" && typeof s.stddev === "number" ? `${s.mean.toFixed(0)} \xB1 ${s.stddev.toFixed(0)}` : "\u2014";
  lines.push(`| Pass Rate | ${fmtPR(a.pass_rate)} | ${fmtPR(b.pass_rate)} | ${delta.pass_rate ?? "\u2014"} |`);
  lines.push(`| Time | ${fmtTime(a.time_seconds)} | ${fmtTime(b.time_seconds)} | ${delta.time_seconds ?? "\u2014"}s |`);
  lines.push(`| Tokens | ${fmtTokens(a.tokens)} | ${fmtTokens(b.tokens)} | ${delta.tokens ?? "\u2014"} |`);
  if (benchmark.notes?.length) {
    lines.push("", "## Notes", "");
    for (const note of benchmark.notes) {
      lines.push(`- ${note}`);
    }
  }
  return lines.join(`
`);
}

// lib/review-server.ts
import { spawn as spawn2 } from "child_process";
import {
  existsSync as existsSync4,
  mkdirSync as mkdirSync3,
  readFileSync as readFileSync5,
  readdirSync as readdirSync3,
  statSync as statSync3,
  writeFileSync as writeFileSync5
} from "fs";
import { createServer } from "http";
import { basename as basename2, extname, join as join6, relative as relative2 } from "path";
var METADATA_FILES = new Set(["transcript.md", "user_notes.md", "metrics.json"]);
var TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".py",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".css",
  ".sh",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".sql",
  ".r",
  ".toml"
]);
var IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);
var MAX_FEEDBACK_BODY_BYTES = 1e6;
var MIME_OVERRIDES = {
  ".svg": "image/svg+xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};
function getMimeType(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext in MIME_OVERRIDES)
    return MIME_OVERRIDES[ext];
  const mimeMap = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".xml": "application/xml",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".zip": "application/zip"
  };
  return mimeMap[ext] ?? "application/octet-stream";
}
function embedFile(filePath) {
  const name = basename2(filePath);
  const ext = extname(filePath).toLowerCase();
  const mime = getMimeType(filePath);
  if (TEXT_EXTENSIONS.has(ext)) {
    try {
      const content = readFileSync5(filePath, "utf-8");
      return { name, type: "text", content };
    } catch {
      return { name, type: "error", content: "(Error reading file)" };
    }
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    try {
      const raw = readFileSync5(filePath);
      const b64 = raw.toString("base64");
      return { name, type: "image", mime, data_uri: `data:${mime};base64,${b64}` };
    } catch {
      return { name, type: "error", content: "(Error reading file)" };
    }
  }
  if (ext === ".pdf") {
    try {
      const raw = readFileSync5(filePath);
      const b64 = raw.toString("base64");
      return { name, type: "pdf", data_uri: `data:${mime};base64,${b64}` };
    } catch {
      return { name, type: "error", content: "(Error reading file)" };
    }
  }
  if (ext === ".xlsx") {
    try {
      const raw = readFileSync5(filePath);
      const b64 = raw.toString("base64");
      return { name, type: "xlsx", data_b64: b64 };
    } catch {
      return { name, type: "error", content: "(Error reading file)" };
    }
  }
  try {
    const raw = readFileSync5(filePath);
    const b64 = raw.toString("base64");
    return { name, type: "binary", mime, data_uri: `data:${mime};base64,${b64}` };
  } catch {
    return { name, type: "error", content: "(Error reading file)" };
  }
}
function findRunsRecursive(root, current, runs) {
  if (!existsSync4(current) || !statSync3(current).isDirectory())
    return;
  const outputsDir = join6(current, "outputs");
  if (existsSync4(outputsDir) && statSync3(outputsDir).isDirectory()) {
    const run = buildRun(root, current);
    if (run)
      runs.push(run);
    return;
  }
  const skip = new Set(["node_modules", ".git", "__pycache__", "skill", "inputs"]);
  const entries = readdirSync3(current).sort();
  for (const entry of entries) {
    const full = join6(current, entry);
    if (statSync3(full).isDirectory() && !skip.has(entry)) {
      findRunsRecursive(root, full, runs);
    }
  }
}
function findRuns(workspace) {
  const runs = [];
  findRunsRecursive(workspace, workspace, runs);
  runs.sort((a, b) => {
    const aId = typeof a.eval_id === "number" ? a.eval_id : Infinity;
    const bId = typeof b.eval_id === "number" ? b.eval_id : Infinity;
    if (aId !== bId)
      return aId - bId;
    return a.id.localeCompare(b.id);
  });
  return runs;
}
function buildRun(root, runDir) {
  let prompt = "";
  let evalId = null;
  for (const candidate of [join6(runDir, "eval_metadata.json"), join6(runDir, "..", "eval_metadata.json")]) {
    if (existsSync4(candidate)) {
      try {
        const metadata = JSON.parse(readFileSync5(candidate, "utf-8"));
        prompt = metadata.prompt ?? "";
        evalId = metadata.eval_id ?? null;
      } catch {}
      if (prompt)
        break;
    }
  }
  if (!prompt) {
    for (const candidate of [join6(runDir, "transcript.md"), join6(runDir, "outputs", "transcript.md")]) {
      if (existsSync4(candidate)) {
        try {
          const text = readFileSync5(candidate, "utf-8");
          const match = text.match(/## Eval Prompt\n\n([\s\S]*?)(?=\n##|$)/);
          if (match)
            prompt = match[1].trim();
        } catch {}
        if (prompt)
          break;
      }
    }
  }
  if (!prompt)
    prompt = "(No prompt found)";
  const runId = relative2(root, runDir).replace(/[/\\]/g, "-");
  const outputsDir = join6(runDir, "outputs");
  const outputFiles = [];
  if (existsSync4(outputsDir) && statSync3(outputsDir).isDirectory()) {
    const files = readdirSync3(outputsDir).sort();
    for (const f of files) {
      const full = join6(outputsDir, f);
      if (statSync3(full).isFile() && !METADATA_FILES.has(f)) {
        outputFiles.push(embedFile(full));
      }
    }
  }
  let grading = null;
  for (const candidate of [join6(runDir, "grading.json"), join6(runDir, "..", "grading.json")]) {
    if (existsSync4(candidate)) {
      try {
        grading = JSON.parse(readFileSync5(candidate, "utf-8"));
      } catch {}
      if (grading)
        break;
    }
  }
  return { id: runId, prompt, eval_id: evalId, outputs: outputFiles, grading };
}
function isValidFeedbackPayload(value) {
  if (typeof value !== "object" || value === null)
    return false;
  if (!Object.prototype.hasOwnProperty.call(value, "reviews"))
    return false;
  const record = value;
  if (!Array.isArray(record.reviews))
    return false;
  for (const item of record.reviews) {
    if (typeof item !== "object" || item === null)
      return false;
    const review = item;
    if (typeof review.run_id !== "string")
      return false;
    if (typeof review.feedback !== "string")
      return false;
    if (Object.prototype.hasOwnProperty.call(review, "timestamp") && typeof review.timestamp !== "string") {
      return false;
    }
  }
  if (Object.prototype.hasOwnProperty.call(record, "status") && typeof record.status !== "string") {
    return false;
  }
  return true;
}
function loadPreviousIteration(workspace) {
  const result = {};
  const feedbackMap = {};
  const feedbackPath = join6(workspace, "feedback.json");
  if (existsSync4(feedbackPath)) {
    try {
      const data = JSON.parse(readFileSync5(feedbackPath, "utf-8"));
      for (const r of data.reviews ?? []) {
        if (r.feedback?.trim()) {
          feedbackMap[r.run_id] = r.feedback;
        }
      }
    } catch {}
  }
  const prevRuns = findRuns(workspace);
  for (const run of prevRuns) {
    result[run.id] = {
      feedback: feedbackMap[run.id] ?? "",
      outputs: run.outputs ?? []
    };
  }
  for (const [runId, fb] of Object.entries(feedbackMap)) {
    if (!(runId in result)) {
      result[runId] = { feedback: fb, outputs: [] };
    }
  }
  return result;
}
function generateReviewHtml(opts) {
  const { runs, skillName, previous, benchmark, templatePath } = opts;
  const template = readFileSync5(templatePath, "utf-8");
  const previousFeedback = {};
  const previousOutputs = {};
  if (previous) {
    for (const [runId, data] of Object.entries(previous)) {
      if (data.feedback)
        previousFeedback[runId] = data.feedback;
      if (data.outputs?.length)
        previousOutputs[runId] = data.outputs;
    }
  }
  const embedded = {
    skill_name: skillName,
    runs,
    previous_feedback: previousFeedback,
    previous_outputs: previousOutputs
  };
  if (benchmark)
    embedded.benchmark = benchmark;
  const dataJson = JSON.stringify(embedded);
  return template.replace("/*__EMBEDDED_DATA__*/", `const EMBEDDED_DATA = ${dataJson};`);
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
    this.name = "PayloadTooLargeError";
    Object.setPrototypeOf(this, PayloadTooLargeError.prototype);
  }
}
function readStream(stream, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let rejected = false;
    stream.setEncoding("utf-8");
    stream.on("data", (chunk) => {
      if (rejected)
        return;
      const chunkBytes = Buffer.byteLength(chunk, "utf-8");
      if (bytes + chunkBytes > maxBytes) {
        rejected = true;
        reject(new PayloadTooLargeError);
        return;
      }
      bytes += chunkBytes;
      body += chunk;
    });
    stream.on("end", () => {
      if (!rejected)
        resolve(body);
    });
    stream.on("error", reject);
  });
}
function isAddressInUse(error) {
  return error instanceof Error && error.code === "EADDRINUSE";
}
function jsonResponse(body, status = 200) {
  return {
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}
function textResponse(body, status = 200, contentType = "text/plain") {
  return {
    status,
    headers: { "Content-Type": contentType },
    body
  };
}
async function handleReviewRequest(method, requestUrl, requestBody, context) {
  const url = new URL(requestUrl, "http://localhost");
  if (method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const runs = findRuns(context.workspace);
    let benchmark = null;
    if (context.benchmarkPath && existsSync4(context.benchmarkPath)) {
      try {
        benchmark = JSON.parse(readFileSync5(context.benchmarkPath, "utf-8"));
      } catch {}
    }
    const html = generateReviewHtml({
      runs,
      skillName: context.skillName,
      previous: context.previous,
      benchmark,
      templatePath: context.templatePath
    });
    return textResponse(html, 200, "text/html; charset=utf-8");
  }
  if (method === "GET" && url.pathname === "/api/feedback") {
    let data = "{}";
    if (existsSync4(context.feedbackPath)) {
      try {
        data = readFileSync5(context.feedbackPath, "utf-8");
      } catch {}
    }
    return textResponse(data, 200, "application/json");
  }
  if (method === "POST" && url.pathname === "/api/feedback") {
    let body;
    try {
      body = JSON.parse(requestBody);
    } catch (e) {
      return jsonResponse({ error: String(e) }, 400);
    }
    if (!isValidFeedbackPayload(body)) {
      return jsonResponse({ error: "Expected JSON object with a valid 'reviews' array" }, 400);
    }
    try {
      writeFileSync5(context.feedbackPath, JSON.stringify(body, null, 2) + `
`);
    } catch (e) {
      return jsonResponse({ error: String(e) }, 500);
    }
    return jsonResponse({ ok: true });
  }
  return textResponse("Not Found", 404);
}
async function handleNodeRequest(req, res, context) {
  try {
    const body = req.method === "POST" ? await readStream(req, MAX_FEEDBACK_BODY_BYTES) : "";
    const result = await handleReviewRequest(req.method ?? "GET", req.url ?? "/", body, context);
    res.writeHead(result.status, result.headers);
    res.end(result.body);
  } catch (e) {
    if (e instanceof PayloadTooLargeError) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e) }));
  }
}
function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("error", onError);
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
}
async function bindReviewServer(server, port) {
  try {
    await listen(server, port);
    return;
  } catch (error) {
    if (isAddressInUse(error)) {
      throw new Error(`Review server port ${port} is already in use by another process. Stop that process or pass a different port (skill_serve_review accepts a "port" argument, and port 0 picks a free port).`);
    }
    throw error;
  }
}
function closeServer(server, sockets) {
  for (const socket of sockets) {
    socket.destroy();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error)
        reject(error);
      else
        resolve();
    });
  });
}
function browserOpenDisabledByEnv(env = process.env) {
  const value = env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER;
  return value === "0" || value === "false";
}
function browserOpenCommand(url, platform = process.platform) {
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  return { command: "xdg-open", args: [url] };
}
function defaultOpenBrowser(url, onError) {
  const { command, args } = browserOpenCommand(url);
  let openProc;
  try {
    openProc = spawn2(command, args, {
      detached: true,
      stdio: "ignore"
    });
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)));
    return;
  }
  openProc.on("error", onError);
  openProc.unref();
}
async function serveReview(opts) {
  const {
    workspace,
    port = 3117,
    skillName: skillNameOpt,
    previousWorkspace,
    benchmarkPath,
    templatePath,
    openBrowser = true,
    openBrowserImpl = defaultOpenBrowser
  } = opts;
  if (!existsSync4(workspace) || !statSync3(workspace).isDirectory()) {
    throw new Error(`Workspace is not a directory: ${workspace}`);
  }
  const skillName = skillNameOpt ?? basename2(workspace).replace(/-workspace$/, "");
  const feedbackPath = join6(workspace, "feedback.json");
  let previous = null;
  if (previousWorkspace && existsSync4(previousWorkspace)) {
    previous = loadPreviousIteration(previousWorkspace);
  }
  const context = {
    workspace,
    skillName,
    feedbackPath,
    previous,
    benchmarkPath,
    templatePath
  };
  const server = createServer((req, res) => {
    handleNodeRequest(req, res, context);
  });
  const sockets = new Set;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });
  await bindReviewServer(server, port);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Review server did not bind to a TCP port");
  }
  const actualPort = address.port;
  const serverUrl = `http://localhost:${actualPort}`;
  if (openBrowser && !browserOpenDisabledByEnv()) {
    const reportOpenFailure = (error) => {
      console.warn(`Could not open the review page automatically (${error.message}). ` + `Open it manually: ${serverUrl}`);
    };
    try {
      openBrowserImpl(serverUrl, reportOpenFailure);
    } catch (error) {
      reportOpenFailure(error instanceof Error ? error : new Error(String(error)));
    }
  }
  return {
    server,
    url: serverUrl,
    feedbackPath,
    stop: () => closeServer(server, sockets)
  };
}
function exportStaticReview(opts) {
  const {
    workspace,
    outputPath,
    skillName: skillNameOpt,
    previousWorkspace,
    benchmarkPath,
    templatePath
  } = opts;
  const skillName = skillNameOpt ?? basename2(workspace).replace(/-workspace$/, "");
  const runs = findRuns(workspace);
  if (runs.length === 0) {
    throw new Error(`No runs found in ${workspace}`);
  }
  let previous = null;
  if (previousWorkspace && existsSync4(previousWorkspace)) {
    previous = loadPreviousIteration(previousWorkspace);
  }
  let benchmark = null;
  if (benchmarkPath && existsSync4(benchmarkPath)) {
    try {
      benchmark = JSON.parse(readFileSync5(benchmarkPath, "utf-8"));
    } catch {}
  }
  const html = generateReviewHtml({
    runs,
    skillName,
    previous,
    benchmark,
    templatePath
  });
  const parentDir = join6(outputPath, "..");
  mkdirSync3(parentDir, { recursive: true });
  writeFileSync5(outputPath, html);
  return outputPath;
}

// lib/workflow-guard.ts
import { existsSync as existsSync5, readdirSync as readdirSync4, statSync as statSync4 } from "fs";
import { basename as basename3, join as join7 } from "path";
function sortedDirs2(dir, pattern) {
  if (!existsSync5(dir) || !statSync4(dir).isDirectory())
    return [];
  return readdirSync4(dir).map((name) => join7(dir, name)).filter((full) => statSync4(full).isDirectory()).filter((full) => pattern ? pattern.test(basename3(full)) : true).sort();
}
function hasAtLeastOneRun(configDir) {
  const runDirs = sortedDirs2(configDir, /^run-/);
  if (runDirs.length > 0)
    return true;
  const outputsDir = join7(configDir, "outputs");
  return existsSync5(outputsDir) && statSync4(outputsDir).isDirectory();
}
function validateComparisonWorkspace(workspace) {
  const issues = [];
  const foundConfigs = new Set;
  if (!existsSync5(workspace)) {
    return {
      valid: false,
      evalCount: 0,
      issues: [
        {
          evalDir: basename3(workspace),
          issue: "workspace path does not exist"
        }
      ],
      foundConfigs: [],
      searchRoot: workspace
    };
  }
  if (!statSync4(workspace).isDirectory()) {
    return {
      valid: false,
      evalCount: 0,
      issues: [
        {
          evalDir: basename3(workspace),
          issue: "workspace path is not a directory"
        }
      ],
      foundConfigs: [],
      searchRoot: workspace
    };
  }
  let searchRoot = workspace;
  let evalDirs = sortedDirs2(searchRoot, /^eval-/);
  if (evalDirs.length === 0) {
    const runsRoot = join7(workspace, "runs");
    const nested = sortedDirs2(runsRoot, /^eval-/);
    if (nested.length > 0) {
      searchRoot = runsRoot;
      evalDirs = nested;
    }
  }
  if (evalDirs.length === 0) {
    issues.push({
      evalDir: basename3(workspace),
      issue: "no eval-* directories found (expected evals with with_skill and baseline runs)"
    });
  }
  for (const evalDir of evalDirs) {
    const withSkillDir = join7(evalDir, "with_skill");
    const withoutSkillDir = join7(evalDir, "without_skill");
    const oldSkillDir = join7(evalDir, "old_skill");
    if (existsSync5(withSkillDir) && statSync4(withSkillDir).isDirectory()) {
      foundConfigs.add("with_skill");
    }
    if (existsSync5(withoutSkillDir) && statSync4(withoutSkillDir).isDirectory()) {
      foundConfigs.add("without_skill");
    }
    if (existsSync5(oldSkillDir) && statSync4(oldSkillDir).isDirectory()) {
      foundConfigs.add("old_skill");
    }
    const hasWithSkill = existsSync5(withSkillDir) && statSync4(withSkillDir).isDirectory() && hasAtLeastOneRun(withSkillDir);
    const hasWithoutSkill = existsSync5(withoutSkillDir) && statSync4(withoutSkillDir).isDirectory() && hasAtLeastOneRun(withoutSkillDir);
    const hasOldSkill = existsSync5(oldSkillDir) && statSync4(oldSkillDir).isDirectory() && hasAtLeastOneRun(oldSkillDir);
    if (!hasWithSkill) {
      issues.push({
        evalDir: basename3(evalDir),
        issue: "missing with_skill run outputs"
      });
    }
    if (!hasWithoutSkill && !hasOldSkill) {
      issues.push({
        evalDir: basename3(evalDir),
        issue: "missing baseline run outputs (without_skill or old_skill)"
      });
    }
  }
  return {
    valid: issues.length === 0,
    evalCount: evalDirs.length,
    issues,
    foundConfigs: [...foundConfigs].sort(),
    searchRoot
  };
}

// lib/gold-standards.ts
import {
  existsSync as existsSync6,
  mkdirSync as mkdirSync4,
  readFileSync as readFileSync6,
  renameSync,
  writeFileSync as writeFileSync6
} from "fs";
import { randomUUID } from "crypto";
import { basename as basename4, dirname as dirname2, join as join8 } from "path";
function readStore(path) {
  if (!existsSync6(path))
    return [];
  try {
    return JSON.parse(readFileSync6(path, "utf-8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to read gold standards store at ${path}: malformed JSON`);
    }
    throw error;
  }
}
function sortStandards(standards) {
  return [...standards].sort((a, b) => b.passRate - a.passRate);
}
function writeStore(path, standards) {
  const dir = dirname2(path);
  mkdirSync4(dir, { recursive: true });
  const tmpPath = join8(dir, `.${basename4(path)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync6(tmpPath, JSON.stringify(sortStandards(standards).slice(0, 50), null, 2));
  renameSync(tmpPath, path);
}
function listGoldStandards(path) {
  return sortStandards(readStore(path));
}
function addGoldStandard(path, input) {
  if (!Number.isFinite(input.passRate) || input.passRate < 0 || input.passRate > 1) {
    throw new Error("passRate must be a finite number between 0 and 1");
  }
  const standard = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString()
  };
  writeStore(path, [...readStore(path), standard]);
  return standard;
}
function removeGoldStandard(path, id) {
  const standards = readStore(path);
  const remaining = standards.filter((standard) => standard.id !== id);
  if (remaining.length === standards.length)
    return false;
  writeStore(path, remaining);
  return true;
}
function getGoldAdvice(path) {
  const standards = listGoldStandards(path).slice(0, 5);
  if (standards.length === 0)
    return "";
  const examples = standards.map((standard) => {
    const percent = Math.round(standard.passRate * 100);
    const notes = standard.notes ? ` Notes: ${standard.notes}` : "";
    return `- ${standard.skillName} (${percent}%): ${standard.description}${notes}`;
  });
  return ["GOLD STANDARD EXAMPLES:", ...examples].join(`
`);
}

// lib/skill-install.ts
import { createHash } from "crypto";
import {
  copyFileSync,
  existsSync as existsSync7,
  lstatSync,
  mkdirSync as mkdirSync5,
  readdirSync as readdirSync5,
  readFileSync as readFileSync7,
  realpathSync as realpathSync2,
  renameSync as renameSync2,
  rmSync as rmSync2,
  statSync as statSync5,
  writeFileSync as writeFileSync7
} from "fs";
import { isAbsolute as isAbsolute2, join as join9, relative as relative3, sep as sep2 } from "path";
var SKILL_NAME = "opencode-skill-creator";
var LEGACY_SKILL_NAME = "skill-creator";
var INSTALL_VERSION_FILE = ".opencode-skill-creator-version";
var INSTALL_MANIFEST_FILE = ".opencode-skill-creator-manifest.json";
var RESERVED_ROOT_PATHS = new Set([
  "SKILL.md",
  "SKILL.md.user-backup",
  INSTALL_VERSION_FILE,
  INSTALL_MANIFEST_FILE
]);
function copyDirRecursive(src, dest) {
  mkdirSync5(dest, { recursive: true });
  for (const entry of readdirSync5(src)) {
    const srcPath = join9(src, entry);
    const destPath = join9(dest, entry);
    if (statSync5(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}
function sha256File(path) {
  return createHash("sha256").update(readFileSync7(path)).digest("hex");
}
function isSafeRelativePath(rel) {
  if (typeof rel !== "string" || rel.length === 0)
    return false;
  if (rel.includes("\\"))
    return false;
  if (isAbsolute2(rel))
    return false;
  if (/^[a-zA-Z]:/.test(rel))
    return false;
  return rel.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
function readManifest(skillsDir) {
  const manifestPath = join9(skillsDir, INSTALL_MANIFEST_FILE);
  if (!existsSync7(manifestPath))
    return null;
  try {
    const parsed = JSON.parse(readFileSync7(manifestPath, "utf-8"));
    if (!parsed || typeof parsed !== "object")
      return null;
    const record = parsed;
    if (record.schema !== 1)
      return null;
    const files = record.files;
    if (!files || typeof files !== "object")
      return null;
    const checked = {};
    for (const [rel, hash] of Object.entries(files)) {
      if (!isSafeRelativePath(rel) || typeof hash !== "string")
        return null;
      checked[rel] = hash;
    }
    return {
      schema: 1,
      packageVersion: typeof record.packageVersion === "string" ? record.packageVersion : "",
      files: checked
    };
  } catch {
    return null;
  }
}
function writeManifest(skillsDir, manifest) {
  writeFileSync7(join9(skillsDir, INSTALL_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}
`);
}
function listRegularFilesExcludingReserved(root) {
  const files = new Set;
  const walk = (dir) => {
    for (const entry of readdirSync5(dir, { withFileTypes: true })) {
      const abs = join9(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        const rel = relative3(root, abs).split(sep2).join("/");
        if (RESERVED_ROOT_PATHS.has(rel))
          continue;
        files.add(rel);
      }
    }
  };
  walk(root);
  return files;
}
function listBundleFiles(bundledSkillDir) {
  return listRegularFilesExcludingReserved(bundledSkillDir);
}
function buildManifest(tmpInstallDir, packageVersion) {
  const files = {};
  for (const rel of listRegularFilesExcludingReserved(tmpInstallDir)) {
    files[rel] = sha256File(join9(tmpInstallDir, rel));
  }
  return { schema: 1, packageVersion, files };
}
function pruneStaleManagedFiles(skillsDir, oldManifest, newBundleFiles) {
  if (!oldManifest)
    return;
  let rootStats;
  try {
    rootStats = lstatSync(skillsDir);
  } catch {
    return;
  }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory())
    return;
  const canonicalRoot = (() => {
    try {
      return realpathSync2(skillsDir);
    } catch {
      return skillsDir;
    }
  })();
  const isInside = (child) => {
    const rel = relative3(canonicalRoot, child);
    if (rel === "" || isAbsolute2(rel))
      return false;
    return rel !== ".." && !rel.startsWith(`..${sep2}`);
  };
  for (const [rel, recordedHash] of Object.entries(oldManifest.files)) {
    if (!isSafeRelativePath(rel))
      continue;
    if (RESERVED_ROOT_PATHS.has(rel))
      continue;
    if (newBundleFiles.has(rel))
      continue;
    const segments = rel.split("/");
    let ancestor = skillsDir;
    let ancestorIsSymlink = false;
    for (let i = 0;i < segments.length - 1; i++) {
      ancestor = join9(ancestor, segments[i]);
      try {
        if (lstatSync(ancestor).isSymbolicLink()) {
          ancestorIsSymlink = true;
          break;
        }
      } catch {
        ancestorIsSymlink = true;
        break;
      }
    }
    if (ancestorIsSymlink)
      continue;
    const target = join9(skillsDir, rel);
    let stats;
    try {
      stats = lstatSync(target);
    } catch {
      continue;
    }
    if (!stats.isFile())
      continue;
    let canonicalTarget;
    try {
      canonicalTarget = realpathSync2(target);
    } catch {
      continue;
    }
    if (!isInside(canonicalTarget))
      continue;
    let onDiskHash;
    try {
      onDiskHash = sha256File(target);
    } catch {
      continue;
    }
    if (onDiskHash !== recordedHash)
      continue;
    rmSync2(target, { force: true });
  }
}
function defaultBackupTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
}
function uniqueBackupDir(skillsRoot, timestamp) {
  const base = join9(skillsRoot, `${LEGACY_SKILL_NAME}.opencode-skill-creator-backup-${timestamp}`);
  if (!existsSync7(base))
    return base;
  for (let index = 1;index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existsSync7(candidate))
      return candidate;
  }
  throw new Error("Could not find an available legacy skill backup path");
}
function archiveLegacySkill(args) {
  const legacyVersionFile = join9(args.legacySkillDir, INSTALL_VERSION_FILE);
  if (!existsSync7(legacyVersionFile))
    return;
  const backupDir = uniqueBackupDir(args.skillsRoot, args.backupTimestamp());
  const backupSkillFile = join9(args.legacySkillDir, "SKILL.md");
  if (existsSync7(backupSkillFile)) {
    renameSync2(backupSkillFile, join9(args.legacySkillDir, "SKILL.md.backup"));
  }
  renameSync2(args.legacySkillDir, backupDir);
}
function ensureBundledSkillInstalled(options) {
  const skillsRoot = join9(options.configDir, "opencode", "skills");
  const skillsDir = join9(skillsRoot, SKILL_NAME);
  const legacySkillDir = join9(skillsRoot, LEGACY_SKILL_NAME);
  const marker = join9(skillsDir, "SKILL.md");
  const versionFile = join9(skillsDir, INSTALL_VERSION_FILE);
  const userSkillFile = join9(skillsDir, "SKILL.md");
  const userSkillBackup = join9(skillsDir, "SKILL.md.user-backup");
  if (!existsSync7(options.bundledSkillDir))
    return;
  let installedVersion = "";
  if (existsSync7(versionFile)) {
    try {
      installedVersion = readFileSync7(versionFile, "utf-8").trim();
    } catch {
      installedVersion = "";
    }
  }
  const shouldInstall = !existsSync7(marker) || installedVersion !== options.packageVersion;
  const tmpInstallDir = `${skillsDir}.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    if (shouldInstall) {
      const oldManifest = readManifest(skillsDir);
      copyDirRecursive(options.bundledSkillDir, tmpInstallDir);
      if (existsSync7(userSkillFile)) {
        try {
          copyFileSync(userSkillFile, userSkillBackup);
        } catch (error) {
          options.onError?.(`Failed to back up existing user skill file before updating ${SKILL_NAME}`, error);
        }
        try {
          copyFileSync(userSkillFile, join9(tmpInstallDir, "SKILL.md"));
        } catch {}
      }
      const newManifest = buildManifest(tmpInstallDir, options.packageVersion);
      const newBundleFiles = listBundleFiles(options.bundledSkillDir);
      if (!existsSync7(skillsDir)) {
        renameSync2(tmpInstallDir, skillsDir);
      } else {
        pruneStaleManagedFiles(skillsDir, oldManifest, newBundleFiles);
        copyDirRecursive(tmpInstallDir, skillsDir);
      }
      writeManifest(skillsDir, newManifest);
      writeFileSync7(versionFile, `${options.packageVersion}
`);
    }
    if (existsSync7(legacySkillDir)) {
      archiveLegacySkill({
        skillsRoot,
        legacySkillDir,
        backupTimestamp: options.backupTimestamp ?? defaultBackupTimestamp
      });
    }
  } catch (error) {
    options.onError?.("Failed to install opencode-skill-creator skill", error);
  } finally {
    if (existsSync7(tmpInstallDir)) {
      rmSync2(tmpInstallDir, { recursive: true, force: true });
    }
  }
}

// skill-creator.ts
var PLUGIN_DIR = dirname3(fileURLToPath(import.meta.url));
var TEMPLATES_DIR = join10(PLUGIN_DIR, "templates");
var BUNDLED_SKILL_DIR = join10(PLUGIN_DIR, "skill");
var PACKAGE_JSON_PATH = join10(PLUGIN_DIR, "package.json");
var AUTO_UPDATE_TTL_MS = 24 * 60 * 60 * 1000;
var AUTO_UPDATE_STATUS_FILE = "opencode-skill-creator-update-check.json";
var NPM_REGISTRY_URL = "https://registry.npmjs.org/opencode-skill-creator/latest";
var AUTO_UPDATE_TIMEOUT_MS = 2500;
var GOLD_STANDARDS_PATH = join10(homedir(), ".config", "opencode", "gold-standards.json");
var PACKAGE_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync8(PACKAGE_JSON_PATH, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
function prepareReviewLaunch(args) {
  const strictMode = !(args.allowPartial ?? false);
  const validation = validateComparisonWorkspace(args.workspace);
  if (strictMode && !validation.valid) {
    const issueLines = validation.issues.map((issue) => `- ${issue.evalDir}: ${issue.issue}`);
    throw new Error([
      `Strict review preflight failed for ${args.workspace}.`,
      "Preflight issues:",
      ...issueLines,
      "Resolve the issues above, or set allowPartial=true to override."
    ].join(`
`));
  }
  let resolvedBenchmarkPath = args.benchmarkPath ?? null;
  if (!resolvedBenchmarkPath) {
    try {
      const benchmark = generateBenchmark(args.workspace, args.skillName ?? "", "");
      const jsonPath = join10(args.workspace, "benchmark.json");
      const mdPath = join10(args.workspace, "benchmark.md");
      writeFileSync8(jsonPath, JSON.stringify(benchmark, null, 2));
      writeFileSync8(mdPath, generateMarkdown(benchmark));
      resolvedBenchmarkPath = jsonPath;
    } catch {
      resolvedBenchmarkPath = null;
    }
  }
  return {
    strictMode,
    allowPartial: args.allowPartial ?? false,
    validation,
    benchmarkPath: resolvedBenchmarkPath
  };
}
function normalizeDescriptionOverride(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
function getAutoUpdatePaths() {
  const cacheDir = process.env.XDG_CACHE_HOME || join10(homedir(), ".cache");
  const configDir = process.env.XDG_CONFIG_HOME || join10(homedir(), ".config");
  const packageCacheRoot = join10(cacheDir, "opencode", "packages", "opencode-skill-creator@latest");
  return {
    packageCacheRoot,
    cachedPackageDir: join10(packageCacheRoot, "node_modules", "opencode-skill-creator"),
    cachedPackageJson: join10(packageCacheRoot, "node_modules", "opencode-skill-creator", "package.json"),
    statusPath: join10(configDir, "opencode", AUTO_UPDATE_STATUS_FILE)
  };
}
function compareVersions(a, b) {
  const parse = (value) => value.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  });
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0;index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0)
      return diff > 0 ? 1 : -1;
  }
  return 0;
}
function readAutoUpdateStatus(path) {
  try {
    return JSON.parse(readFileSync8(path, "utf-8"));
  } catch {
    return {};
  }
}
function writeAutoUpdateStatus(path, status) {
  try {
    mkdirSync6(dirname3(path), { recursive: true });
    writeFileSync8(path, `${JSON.stringify(status, null, 2)}
`, "utf-8");
  } catch {}
}
function isInsidePath2(parent, child, pathModule = {
  isAbsolute: isAbsolute3,
  relative: relative4,
  sep: sep3
}) {
  const rel = pathModule.relative(parent, child);
  return rel === "" || !rel.startsWith("..") && !pathModule.isAbsolute(rel) && !rel.startsWith("/") && !rel.startsWith("\\") && !rel.includes(`..${pathModule.sep}`);
}
function scheduleCacheClear(path) {
  process.once("exit", () => {
    try {
      rmSync3(path, { recursive: true, force: true });
    } catch {}
  });
}
async function maybeAutoRefreshPluginCache(options = {}) {
  try {
    if (process.env.OPENCODE_SKILL_CREATOR_AUTO_UPDATE === "0") {
      return { checked: false, cleared: false, reason: "disabled" };
    }
    const currentVersion = options.currentVersion ?? PACKAGE_VERSION;
    if (currentVersion === "0.0.0") {
      return { checked: false, cleared: false, reason: "unknown-version" };
    }
    const paths = getAutoUpdatePaths();
    const now = options.now ?? Date.now();
    const status = readAutoUpdateStatus(paths.statusPath);
    if (typeof status.lastCheckedAt === "number" && now - status.lastCheckedAt < AUTO_UPDATE_TTL_MS) {
      return { checked: false, cleared: false, reason: "recently-checked" };
    }
    const controller = new AbortController;
    const timeout = setTimeout(() => controller.abort(), AUTO_UPDATE_TIMEOUT_MS);
    try {
      const response = await (options.fetchImpl ?? fetch)(NPM_REGISTRY_URL, {
        signal: controller.signal
      });
      if (!response.ok)
        return { checked: false, cleared: false, reason: "error" };
      const metadata = await response.json();
      const latestVersion = metadata.version;
      if (!latestVersion)
        return { checked: false, cleared: false, reason: "error" };
      writeAutoUpdateStatus(paths.statusPath, {
        lastCheckedAt: now,
        currentVersion,
        latestVersion
      });
      if (compareVersions(latestVersion, currentVersion) <= 0) {
        return { checked: true, cleared: false, reason: "up-to-date" };
      }
      if (!existsSync8(paths.cachedPackageJson)) {
        return { checked: true, cleared: false, reason: "missing-cache" };
      }
      const currentPluginDir = options.currentPluginDir ?? PLUGIN_DIR;
      if (isInsidePath2(paths.packageCacheRoot, currentPluginDir)) {
        (options.scheduleClearImpl ?? scheduleCacheClear)(paths.packageCacheRoot);
        return { checked: true, cleared: false, reason: "scheduled-clear" };
      }
      rmSync3(paths.packageCacheRoot, { recursive: true, force: true });
      return { checked: true, cleared: true, reason: "newer-version" };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return { checked: false, cleared: false, reason: "error" };
  }
}
function createPluginInstance(overrides = {}) {
  return {
    projectRoot: () => findProjectRoot(),
    enumerate: cliInstalledSkillEnumerator,
    servers: new Map,
    ...overrides
  };
}
var initialized = false;
async function initialize() {
  if (initialized)
    return;
  initialized = true;
  ensureBundledSkillInstalled({
    bundledSkillDir: BUNDLED_SKILL_DIR,
    configDir: process.env.XDG_CONFIG_HOME || join10(homedir(), ".config"),
    packageVersion: PACKAGE_VERSION,
    onError: (message, error) => console.warn(message, error)
  });
  maybeAutoRefreshPluginCache();
}
function deriveJsonSchema(args) {
  const schema = tool.schema;
  const jsonSchema = schema.toJSONSchema(schema.object(args ?? {}));
  const { $schema: _dialect, ...rest } = jsonSchema;
  return rest;
}
function resolveAbortSignal(context) {
  if (!context || typeof context !== "object")
    return;
  const candidate = context.signal ?? context.abort;
  if (!candidate || typeof candidate !== "object")
    return;
  const maybe = candidate;
  return typeof maybe.aborted === "boolean" && typeof maybe.addEventListener === "function" ? maybe : undefined;
}
function buildPluginTools(instance) {
  return {
    tool: {
      skill_validate: tool({
        description: "Validate a skill directory. Checks that SKILL.md exists with well-formed YAML frontmatter, required fields, naming conventions, and description limits.",
        args: {
          skillPath: tool.schema.string().describe("Path to the skill directory containing SKILL.md")
        },
        async execute(args) {
          const result = validateSkill(args.skillPath);
          return JSON.stringify(result, null, 2);
        }
      }),
      skill_parse: tool({
        description: "Parse a SKILL.md file and return its name, description, and full content.",
        args: {
          skillPath: tool.schema.string().describe("Path to the skill directory containing SKILL.md")
        },
        async execute(args) {
          const meta = parseSkillMd(args.skillPath);
          return JSON.stringify({
            name: meta.name,
            description: meta.description,
            content: meta.fullContent,
            contentLength: meta.fullContent.length
          }, null, 2);
        }
      }),
      skill_add_gold_standard: tool({
        description: "Save a durable gold-standard skill description example for future meta-learning experiments.",
        args: {
          skillName: tool.schema.string().describe("Skill name for this example"),
          description: tool.schema.string().describe("High-performing skill description"),
          passRate: tool.schema.number().describe("Observed pass rate as a decimal from 0 to 1"),
          notes: tool.schema.string().optional().describe("Optional notes about why this example worked")
        },
        async execute(args) {
          const standard = addGoldStandard(GOLD_STANDARDS_PATH, {
            skillName: args.skillName,
            description: args.description,
            passRate: args.passRate,
            notes: args.notes
          });
          return JSON.stringify(standard, null, 2);
        }
      }),
      skill_list_gold_standards: tool({
        description: "List saved gold-standard skill description examples.",
        args: {},
        async execute() {
          return JSON.stringify(listGoldStandards(GOLD_STANDARDS_PATH), null, 2);
        }
      }),
      skill_remove_gold_standard: tool({
        description: "Remove a saved gold-standard skill description example by id.",
        args: {
          id: tool.schema.string().describe("Gold-standard example id")
        },
        async execute(args) {
          return JSON.stringify({
            removed: removeGoldStandard(GOLD_STANDARDS_PATH, args.id)
          });
        }
      }),
      skill_get_gold_advice: tool({
        description: "Return formatted gold-standard advice for description optimization prompts.",
        args: {},
        async execute() {
          return JSON.stringify({ advice: getGoldAdvice(GOLD_STANDARDS_PATH) });
        }
      }),
      skill_eval: tool({
        description: "Test whether a skill description causes OpenCode to invoke the skill for a set of queries. Runs each query against `opencode run` and checks if the skill was triggered. Returns pass/fail results per query.",
        args: {
          evalSetPath: tool.schema.string().describe("Path to eval_set.json (array of {query, should_trigger})"),
          skillPath: tool.schema.string().describe("Path to the skill directory containing SKILL.md"),
          descriptionOverride: tool.schema.string().optional().describe("Override description to test (uses SKILL.md description if omitted)"),
          numWorkers: tool.schema.number().optional().describe("Parallel workers (default: 10)"),
          timeout: tool.schema.number().optional().describe("Timeout per query in seconds (default: 30)"),
          runsPerQuery: tool.schema.number().optional().describe("Number of runs per query for reliability (default: 3)"),
          triggerThreshold: tool.schema.number().optional().describe("Trigger rate threshold to count as triggered (default: 0.5)"),
          triggerOnly: tool.schema.boolean().optional().describe("Stop each eval run as soon as the synthetic skill is triggered and ignore later workflow failures (default: true)"),
          model: tool.schema.string().optional().describe("Model ID in provider/model format"),
          agent: tool.schema.string().optional().describe("OpenCode agent for trigger eval runs (default: build)")
        },
        async execute(args, context) {
          const { readFileSync } = await import("fs");
          const evalSet = JSON.parse(readFileSync(args.evalSetPath, "utf-8"));
          const validation = validateSkill(args.skillPath);
          if (!validation.valid) {
            throw new Error(`Invalid skill at ${args.skillPath}: ${validation.message}`);
          }
          const meta = parseSkillMd(args.skillPath);
          const projectRoot = instance.projectRoot();
          await assertNoInstalledSkillConflict(meta.name, projectRoot, instance.enumerate);
          const result = await runEval({
            evalSet,
            skillName: meta.name,
            description: normalizeDescriptionOverride(args.descriptionOverride) ?? meta.description,
            numWorkers: args.numWorkers ?? 10,
            timeout: args.timeout ?? 30,
            projectRoot,
            runsPerQuery: args.runsPerQuery ?? 3,
            triggerThreshold: args.triggerThreshold ?? 0.5,
            triggerOnly: args.triggerOnly ?? true,
            model: args.model,
            agent: args.agent ?? "build",
            signal: resolveAbortSignal(context),
            excludedSkillPath: args.skillPath
          });
          return JSON.stringify(result, null, 2);
        }
      }),
      skill_improve_description: tool({
        description: "Call OpenCode to generate an improved skill description based on eval results. Uses the current description and failure patterns to propose a better one.",
        args: {
          skillPath: tool.schema.string().describe("Path to the skill directory"),
          evalResultsPath: tool.schema.string().describe("Path to JSON file with eval results (output of skill_eval)"),
          historyPath: tool.schema.string().optional().describe("Path to JSON file with previous improvement history"),
          model: tool.schema.string().optional().describe("Model ID in provider/model format"),
          logDir: tool.schema.string().optional().describe("Directory to save improvement transcripts"),
          iteration: tool.schema.number().optional().describe("Current iteration number")
        },
        async execute(args, context) {
          const { readFileSync } = await import("fs");
          const meta = parseSkillMd(args.skillPath);
          const evalResults = JSON.parse(readFileSync(args.evalResultsPath, "utf-8"));
          const history = args.historyPath ? JSON.parse(readFileSync(args.historyPath, "utf-8")) : [];
          const newDescription = await improveDescription({
            skillName: meta.name,
            skillContent: meta.fullContent,
            currentDescription: meta.description,
            evalResults,
            history,
            model: args.model,
            logDir: args.logDir ?? null,
            iteration: args.iteration ?? null,
            projectRoot: instance.projectRoot(),
            signal: resolveAbortSignal(context)
          });
          return JSON.stringify({ description: newDescription, charCount: newDescription.length });
        }
      }),
      skill_optimize_loop: tool({
        description: "Run the full description optimization loop: split eval set into train/test, evaluate, improve description based on failures, repeat. Returns the best description found. This can take several minutes.",
        args: {
          evalSetPath: tool.schema.string().describe("Path to eval_set.json"),
          skillPath: tool.schema.string().describe("Path to the skill directory"),
          descriptionOverride: tool.schema.string().optional().describe("Starting description override"),
          maxIterations: tool.schema.number().optional().describe("Max optimization iterations (default: 5)"),
          numWorkers: tool.schema.number().optional().describe("Parallel workers (default: 10)"),
          timeout: tool.schema.number().optional().describe("Timeout per query in seconds (default: 30)"),
          runsPerQuery: tool.schema.number().optional().describe("Runs per query (default: 3)"),
          triggerThreshold: tool.schema.number().optional().describe("Trigger rate threshold (default: 0.5)"),
          triggerOnly: tool.schema.boolean().optional().describe("Stop each eval run as soon as the synthetic skill is triggered and ignore later workflow failures (default: true)"),
          holdout: tool.schema.number().optional().describe("Test set holdout fraction (default: 0.4)"),
          model: tool.schema.string().optional().describe("Model ID in provider/model format"),
          agent: tool.schema.string().optional().describe("OpenCode agent for trigger eval runs (default: build)"),
          liveReportPath: tool.schema.string().optional().describe("Path to write live HTML report"),
          logDir: tool.schema.string().optional().describe("Directory for improvement transcripts")
        },
        async execute(args, context) {
          const { readFileSync } = await import("fs");
          const evalSet = JSON.parse(readFileSync(args.evalSetPath, "utf-8"));
          const meta = parseSkillMd(args.skillPath);
          const projectRoot = instance.projectRoot();
          await assertNoInstalledSkillConflict(meta.name, projectRoot, instance.enumerate);
          const result = await runLoop({
            evalSet,
            skillPath: args.skillPath,
            descriptionOverride: normalizeDescriptionOverride(args.descriptionOverride) ?? null,
            numWorkers: args.numWorkers ?? 10,
            timeout: args.timeout ?? 30,
            maxIterations: args.maxIterations ?? 5,
            runsPerQuery: args.runsPerQuery ?? 3,
            triggerThreshold: args.triggerThreshold ?? 0.5,
            triggerOnly: args.triggerOnly ?? true,
            holdout: args.holdout ?? 0.4,
            model: args.model,
            agent: args.agent ?? "build",
            verbose: true,
            liveReportPath: args.liveReportPath ?? null,
            logDir: args.logDir ?? null,
            projectRoot,
            signal: resolveAbortSignal(context)
          });
          return JSON.stringify(result, null, 2);
        }
      }),
      skill_aggregate_benchmark: tool({
        description: "Aggregate grading.json files from benchmark run directories into summary statistics. Produces benchmark.json with pass rates, timing, and token usage per configuration.",
        args: {
          benchmarkDir: tool.schema.string().describe("Path to the benchmark directory (containing eval-N/ subdirectories)"),
          skillName: tool.schema.string().optional().describe("Skill name for the report header"),
          skillPath: tool.schema.string().optional().describe("Path to the skill directory"),
          outputPath: tool.schema.string().optional().describe("Path to write benchmark.json (default: <benchmarkDir>/benchmark.json)"),
          markdownPath: tool.schema.string().optional().describe("Path to write benchmark.md (default: <benchmarkDir>/benchmark.md)")
        },
        async execute(args) {
          const { writeFileSync } = await import("fs");
          const benchmark = generateBenchmark(args.benchmarkDir, args.skillName ?? "", args.skillPath ?? "");
          const jsonPath = args.outputPath ?? join10(args.benchmarkDir, "benchmark.json");
          writeFileSync(jsonPath, JSON.stringify(benchmark, null, 2));
          const mdPath = args.markdownPath ?? join10(args.benchmarkDir, "benchmark.md");
          writeFileSync(mdPath, generateMarkdown(benchmark));
          return JSON.stringify({
            benchmarkJsonPath: jsonPath,
            benchmarkMdPath: mdPath,
            summary: benchmark.run_summary
          }, null, 2);
        }
      }),
      skill_generate_report: tool({
        description: "Generate a self-contained HTML report showing description optimization results per iteration with pass/fail indicators for each eval query.",
        args: {
          dataPath: tool.schema.string().describe("Path to the optimization results JSON (output of skill_optimize_loop)"),
          outputPath: tool.schema.string().describe("Path to write the HTML report"),
          skillName: tool.schema.string().optional().describe("Skill name for the report title"),
          autoRefresh: tool.schema.boolean().optional().describe("Add auto-refresh meta tag (default: false)")
        },
        async execute(args) {
          const { readFileSync, writeFileSync } = await import("fs");
          const data = JSON.parse(readFileSync(args.dataPath, "utf-8"));
          const html = generateHtml(data, {
            autoRefresh: args.autoRefresh ?? false,
            skillName: args.skillName ?? ""
          });
          writeFileSync(args.outputPath, html);
          return JSON.stringify({ reportPath: args.outputPath });
        }
      }),
      skill_serve_review: tool({
        description: "Start an HTTP server that serves the eval review viewer. Regenerates HTML on each page load so refreshing picks up new outputs. Opens the browser automatically.",
        args: {
          workspace: tool.schema.string().describe("Path to the workspace directory containing eval results"),
          port: tool.schema.number().optional().describe("Server port (default: 3117)"),
          skillName: tool.schema.string().optional().describe("Skill name for the viewer header"),
          previousWorkspace: tool.schema.string().optional().describe("Path to previous iteration's workspace (for showing old outputs and feedback)"),
          benchmarkPath: tool.schema.string().optional().describe("Path to benchmark.json for the Benchmark tab"),
          allowPartial: tool.schema.boolean().optional().describe("Allow launching review even if with_skill/baseline run pairs are incomplete (default: false)"),
          openBrowser: tool.schema.boolean().optional().describe("Open the review URL in the default browser (default: true for interactive use). Automated callers should pass false or set OPENCODE_SKILL_CREATOR_OPEN_BROWSER=0.")
        },
        async execute(args) {
          const prep = prepareReviewLaunch(args);
          const existing = instance.servers.get(args.workspace);
          if (existing) {
            await existing.stop();
            instance.servers.delete(args.workspace);
          }
          const templatePath = join10(TEMPLATES_DIR, "viewer.html");
          const { server, url, feedbackPath, stop } = await serveReview({
            workspace: args.workspace,
            port: args.port ?? 3117,
            skillName: args.skillName,
            previousWorkspace: args.previousWorkspace ?? null,
            benchmarkPath: prep.benchmarkPath,
            templatePath,
            openBrowser: args.openBrowser ?? true
          });
          instance.servers.set(args.workspace, { stop, url });
          return JSON.stringify({
            url,
            feedbackPath,
            benchmarkPath: prep.benchmarkPath,
            workflowGuard: {
              strictMode: prep.strictMode,
              allowPartial: prep.allowPartial,
              evalCount: prep.validation.evalCount,
              foundConfigs: prep.validation.foundConfigs,
              issues: prep.validation.issues
            },
            message: `Eval viewer running at ${url}. Press Ctrl+C or call skill_stop_review to stop.`
          });
        }
      }),
      skill_stop_review: tool({
        description: "Stop a running eval review viewer server.",
        args: {
          workspace: tool.schema.string().optional().describe("Workspace path of the server to stop (stops all if omitted)")
        },
        async execute(args) {
          if (args.workspace) {
            const srv = instance.servers.get(args.workspace);
            if (srv) {
              await srv.stop();
              instance.servers.delete(args.workspace);
              return JSON.stringify({ stopped: args.workspace });
            }
            return JSON.stringify({ error: "No server running for this workspace" });
          }
          const stopped = [];
          for (const [ws, srv] of instance.servers) {
            await srv.stop();
            stopped.push(ws);
          }
          instance.servers.clear();
          return JSON.stringify({ stopped });
        }
      }),
      skill_export_static_review: tool({
        description: "Generate a standalone HTML eval review file (no server needed). Use in headless environments or for sharing.",
        args: {
          workspace: tool.schema.string().describe("Path to the workspace directory"),
          outputPath: tool.schema.string().describe("Path to write the HTML file"),
          skillName: tool.schema.string().optional().describe("Skill name for the viewer header"),
          previousWorkspace: tool.schema.string().optional().describe("Path to previous iteration's workspace"),
          benchmarkPath: tool.schema.string().optional().describe("Path to benchmark.json"),
          allowPartial: tool.schema.boolean().optional().describe("Allow exporting review even if with_skill/baseline run pairs are incomplete (default: false)")
        },
        async execute(args) {
          const prep = prepareReviewLaunch(args);
          const templatePath = join10(TEMPLATES_DIR, "viewer.html");
          const outPath = exportStaticReview({
            workspace: args.workspace,
            outputPath: args.outputPath,
            skillName: args.skillName,
            previousWorkspace: args.previousWorkspace ?? null,
            benchmarkPath: prep.benchmarkPath,
            templatePath
          });
          return JSON.stringify({
            outputPath: outPath,
            benchmarkPath: prep.benchmarkPath,
            workflowGuard: {
              strictMode: prep.strictMode,
              allowPartial: prep.allowPartial,
              evalCount: prep.validation.evalCount,
              foundConfigs: prep.validation.foundConfigs,
              issues: prep.validation.issues
            },
            message: `Static viewer written to ${outPath}`
          });
        }
      })
    }
  };
}
var SkillCreatorPlugin = async () => {
  await initialize();
  const instance = createPluginInstance();
  const hooks = buildPluginTools(instance);
  return {
    ...hooks,
    async dispose() {
      const servers = [...instance.servers.values()];
      instance.servers.clear();
      await Promise.all(servers.map(async (server) => {
        try {
          await server.stop();
        } catch {}
      }));
    }
  };
};
var v2Plugin = {
  id: "opencode-skill-creator",
  async setup(ctx) {
    await initialize();
    const locationDirectory = ctx.location?.directory;
    if (typeof locationDirectory !== "string" || !locationDirectory) {
      throw new Error("opencode-skill-creator: setup() received no ctx.location.directory; cannot resolve the project root for skill evaluation.");
    }
    const instance = createPluginInstance({
      projectRoot: () => findProjectRoot(locationDirectory),
      enumerate: createV2SkillEnumerator(ctx)
    });
    const tools = buildPluginTools(instance).tool;
    await ctx.tool.transform((editor) => {
      for (const [name, definition] of Object.entries(tools)) {
        editor.add({
          name,
          description: definition.description,
          input: deriveJsonSchema(definition.args),
          async execute(raw, context) {
            return {
              content: await definition.execute(raw, context)
            };
          }
        });
      }
    });
    return async () => {
      const servers = [...instance.servers.values()];
      instance.servers.clear();
      await Promise.all(servers.map(async (server) => {
        try {
          await server.stop();
        } catch {}
      }));
    };
  }
};
var skill_creator_default = {
  ...v2Plugin,
  async server() {
    return SkillCreatorPlugin({});
  }
};

// runtime-entry.ts
var runtime_entry_default = skill_creator_default;
export {
  runtime_entry_default as default
};
