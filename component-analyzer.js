#!/usr/bin/env node

import fs from "fs";
import { execSync } from "child_process";

const MADGE_OUTPUT_FILE = "madge-output.json";

// Main function to analyze React component dependencies
async function analyzeComponentDependencies(srcPath = "src/app") {
  console.log(`🔧 Analyzing React components in: ${srcPath}\n`);

  // Step 1: Run Madge and save output to JSON file
  const dependencies = await runMadgeAnalysis(srcPath);

  // Step 2: Process the dependencies (TODO: implement index replacement)
  const processedDependencies = processDependencies(dependencies);

  return processedDependencies;
}

// Execute Madge command and read the output
async function runMadgeAnalysis(srcPath) {
  console.log("🔍 Running Madge analysis...");

  try {
    // Run madge command and save to file
    const madgeCommand = `madge --extensions ts,tsx --exclude '.*\\.test\\.tsx$' --ts-config tsconfig.json --json ${srcPath} > ${MADGE_OUTPUT_FILE}`;
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

// Process dependencies to filter and format
function processDependencies(dependencies) {
  console.log("🔄 Processing dependencies...");

  const processed = {};

  // Filter to only include React component files (TSX/JSX)
  Object.entries(dependencies).forEach(([filePath, deps]) => {
    if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) {
      // TODO: Replace index file dependencies with actual component names
      // For now, just keep the original dependencies
      processed[filePath] = deps;
    }
  });

  console.log(`📝 Processed ${Object.keys(processed).length} component files`);

  return processed;
}

// TODO: Implement index replacement functionality
function resolveIndexDependencies(dependencies) {
  // This will analyze index.ts files and replace them with actual exported components
  // Steps:
  // 1. For each dependency that ends with 'index.ts' or 'index.tsx'
  // 2. Parse the index file to find what it exports
  // 3. Match exports with actual JSX usage in the consuming component
  // 4. Replace the index path with the actual component paths

  console.log("🔧 TODO: Implement index file resolution");
  return dependencies;
}

// Generate a simple component-to-component mapping
function generateComponentGraph(dependencies) {
  const componentGraph = {};

  Object.entries(dependencies).forEach(([filePath, deps]) => {
    const componentName = getComponentNameFromPath(filePath);

    // Convert file paths to component names
    const componentDeps = deps.map((depPath) =>
      getComponentNameFromPath(depPath)
    );

    if (componentDeps.length > 0) {
      componentGraph[componentName] = componentDeps;
    }
  });

  return componentGraph;
}

// Extract component name from file path
function getComponentNameFromPath(filePath) {
  const fileName = filePath.split("/").pop();
  const componentName = fileName?.replace(/\.(tsx|jsx|ts|js)$/, "");
  return componentName || filePath;
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
  const srcPath = process.argv[2] || "src/app";
  const outputFormat = process.argv[3] || "detailed"; // 'detailed' or 'simple'
  const keepFiles = process.argv.includes("--keep-files");

  try {
    const dependencies = await analyzeComponentDependencies(srcPath);

    if (outputFormat === "simple") {
      const componentGraph = generateComponentGraph(dependencies);
      console.log("\n📊 Component Dependency Graph:");
      console.log(JSON.stringify(componentGraph, null, 2));
    } else {
      console.log("\n📊 Detailed Component Dependencies:");
      console.log(JSON.stringify(dependencies, null, 2));
    }
  } catch (error) {
    console.error("❌ Analysis failed:", error.message);
  } finally {
    if (!keepFiles) {
      cleanup();
    }
  }
}
