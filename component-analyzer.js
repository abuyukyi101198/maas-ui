#!/usr/bin/env node

import fs from "fs";
import { parse } from "@babel/parser";
import { execSync } from "child_process";
import path from "path";

const MADGE_OUTPUT_FILE = "madge-output.json";
let SOURCE_PATH = "src/app";

// Main function to analyze React component dependencies
async function analyzeComponentDependencies(tsConfig) {
  console.log(`🔧 Analyzing React components in: ${SOURCE_PATH}\n`);

  // Step 1: Run Madge and save output to JSON file
  const dependencies = await runMadgeAnalysis(tsConfig);

  // Step 2: Process the dependencie
  return processDependencies(dependencies);
}

// Execute Madge command and read the output
async function runMadgeAnalysis(tsConfig) {
  console.log("🔍 Running Madge analysis...");

  try {
    // Run madge command and save to file
    const madgeCommand = `madge --extensions ts,tsx --exclude '.*\\.test\\.tsx$' --ts-config ${tsConfig} --json ${SOURCE_PATH} > ${MADGE_OUTPUT_FILE}`;
    execSync(madgeCommand, { encoding: "utf8" });

    console.log(`✅ Madge output saved to ${MADGE_OUTPUT_FILE}`);

    // Read the JSON file
    const jsonContent = fs.readFileSync(MADGE_OUTPUT_FILE, "utf8");
    const dependencies = JSON.parse(jsonContent);

    console.log(
      `📊 Found ${Object.keys(dependencies).length} files with dependencies`
    );

    return dependencies;
  } catch (error) {
    console.error("❌ Error running Madge analysis:", error.message);

    // Check if the file was created but is malformed
    if (fs.existsSync(MADGE_OUTPUT_FILE)) {
      console.log("📁 Madge output file exists, checking content...");
      const content = fs.readFileSync(MADGE_OUTPUT_FILE, "utf8");
      console.log(`File size: ${content.length} characters`);
      console.log("First 200 characters:", content.substring(0, 200));
    }

    process.exit(1);
  }
}

function processDependencies(dependencies) {
  console.log("🔄 Processing dependencies...");

  const processed = {};

  for (const [filePath, deps] of Object.entries(dependencies)) {
    const baseName = path.basename(filePath, path.extname(filePath));

    if (!/^[A-Z]/.test(baseName)) continue;

    if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) {
      const importNames = getImportsBabel(filePath);
      const filteredDeps = deps.flatMap((dep) => {
        const expandedImports = expandIndex(dep, dependencies);
        return expandedImports.filter((file) => {
          const base = path.basename(file, path.extname(file));
          return importNames.has(base) && /^[A-Z]/.test(base);
        });
      });

      processed[filePath] = {
        dependencies: [...new Set(filteredDeps)],
        loc: countLoC(filePath),
      };
    }
  }

  console.log(`📝 Processed ${Object.keys(processed).length} component files`);

  return processed;
}

function expandIndex(dep, dependencies, seen = new Set()) {
  // Avoid infinite loops if circular deps
  if (seen.has(dep)) return [dep];
  seen.add(dep);

  if (/index\.(ts|tsx|js|jsx)$/.test(dep) && dependencies[dep]) {
    // Flatten its dependencies instead of keeping the index itself
    return dependencies[dep].flatMap((d) => {
      return expandIndex(d, dependencies, seen);
    });
  }

  return [dep];
}

export function getImportsBabel(filePath) {
  const code = fs.readFileSync(path.join(SOURCE_PATH, filePath), "utf8");
  const ast = parse(code, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });

  const imports = new Set();
  for (const node of ast.program.body) {
    if (node.type === "ImportDeclaration") {
      node.specifiers.forEach((spec) => {
        if (spec.type === "ImportDefaultSpecifier") {
          imports.add(spec.local.name);
        } else if (spec.type === "ImportSpecifier") {
          imports.add(spec.imported.name);
        } else if (spec.type === "ImportNamespaceSpecifier") {
          imports.add(spec.local.name);
        }
      });
    }
  }
  return imports;
}

function countLoC(filePath) {
  const absPath = path.join(SOURCE_PATH, filePath);
  if (!fs.existsSync(absPath)) return 0;

  const content = fs.readFileSync(absPath, "utf8");
  return content
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("//"))
    .length;
}

// Clean up generated files
function cleanup() {
  if (fs.existsSync(MADGE_OUTPUT_FILE)) {
    fs.unlinkSync(MADGE_OUTPUT_FILE);
    console.log(`🧹 Cleaned up ${MADGE_OUTPUT_FILE}`);
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  // Default values
  SOURCE_PATH = "src/app";
  let tsConfig = "tsconfig.json";
  let jsonOutFile = null;

  // Parse CLI args
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--ts-config" && args[i + 1]) {
      tsConfig = args[i + 1];
      i++;
    } else if (arg === "--json" && args[i + 1]) {
      jsonOutFile = args[i + 1];
      i++;
    } else {
      // Treat anything else as SOURCE_PATH
      SOURCE_PATH = arg;
    }
  }

  try {
    const dependencies = await analyzeComponentDependencies(tsConfig);

    if (jsonOutFile) {
      await fs.promises.writeFile(
        jsonOutFile,
        JSON.stringify(dependencies, null, 2),
        "utf8"
      );
      console.log(`✅ JSON written to ${jsonOutFile}`);
    }
  } catch (error) {
    console.error("❌ Analysis failed:", error.message);
  } finally {
    cleanup();
  }
}
